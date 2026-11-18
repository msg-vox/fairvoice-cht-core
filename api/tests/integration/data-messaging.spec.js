const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const sinon = require('sinon');
const { v7: uuid } = require('uuid');
const config = require('../../src/config');
const db = require('../../src/db');
const migration = require('../../src/migrations/create-data-messaging-db');
const environment = require('@medic/environment');
const { PREFIXES } = require('@medic/constants');

const accountId = name => PREFIXES.COUCH_USER + name;
const databasePath = `/${environment.db}-data-messaging`;
const syncPath = '/api/v1/data-messaging/sync';
const sendPath = '/api/v1/data-messaging/messages';
const password = 'test-messaging-password';
const sender = 'test-messaging-sender';
const recipient = 'test-messaging-recipient';
const unrelated = 'test-messaging-unrelated';
const administrator = 'test-messaging-admin';
const message = {
  _id: 'data-message:initial',
  type: 'data_message',
  sender_id: accountId(sender),
  recipient_id: accountId(recipient),
  text: 'An accepted message',
  created_at: 100,
};
const directory = {
  _id: 'data-message-directory:' + accountId(sender),
  type: 'data_message_directory',
  owner_id: accountId(sender),
  entries: [{
    account_id: accountId(recipient),
    display_name: 'Recipient',
    role_label: 'Coordinator',
    place_label: 'Pilot place',
  }],
};

const request = (origin, path, name, options = {}) => fetch(origin + path, {
  ...options,
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    ...(name && { authorization: 'Basic ' + Buffer.from(name + ':' + password).toString('base64') }),
  },
});

describe('Dedicated data messaging storage', () => {
  let server;
  let api;
  let sms;
  const users = [];
  const couch = environment.serverUrlNoAuth;

  before(async () => {
    await db.get('_users').info();
    await migration.run();
    await migration.run();
    for (const [name, roles] of [
      [sender, []],
      [recipient, ['mm-online']],
      [unrelated, ['mm-online']],
      [administrator, ['admin', 'mm-online']],
    ]) {
      const { id } = await db.users.put({ _id: accountId(name), name, roles, type: 'user', password });
      users.push(id);
    }
    await db.dataMessaging.put(message);
    await db.dataMessaging.put(directory);

    // Loading the router starts the SMS background intervals in a normal API process.
    const clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const app = express();
    try {
      app.use(require('../../src/routing'));
      sms = require('../../src/services/messaging');
    } finally {
      clock.restore();
    }
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    api = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      const closed = once(server, 'close');
      server.close();
      await closed;
    }
    await db.users.bulkDocs(await Promise.all(users.map(async id => {
      const { _rev } = await db.users.get(id);
      return { _id: id, _rev, _deleted: true };
    })));
    await db.dataMessaging.destroy();
  });

  const sync = async (api, name, query = '') => {
    const response = await request(api, syncPath + query, name);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };

  it('serves each participant and only the directory owner through the authenticated sync route', async () => {
    const senderPage = await sync(api, sender);
    const recipientPage = await sync(api, recipient);
    const unrelatedPage = await sync(api, unrelated, '?account_id=' + encodeURIComponent(accountId(sender)));
    const expected = {
      _id: message._id,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id,
      text: message.text,
      created_at: message.created_at,
    };
    assert.deepEqual(senderPage.messages, [expected]);
    assert.deepEqual(recipientPage.messages, [expected]);
    assert.deepEqual(senderPage.directory, directory.entries);
    assert.equal(recipientPage.directory, null);
    assert.deepEqual(unrelatedPage.messages, []);
    assert.equal(unrelatedPage.directory, null);
    assert.equal(senderPage.has_more, false);
    assert.equal(typeof senderPage.next_since, 'string');
  });

  it('preserves accepted history after reassignment and returns a published empty directory', async () => {
    const user = await db.users.get(accountId(sender));
    await db.users.put({ ...user, facility_id: ['another-place'] });
    const storedDirectory = await db.dataMessaging.get(directory._id);
    await db.dataMessaging.put({ ...storedDirectory, entries: [] });

    const page = await sync(api, sender);
    assert.deepEqual(page.messages.map(doc => doc._id), [message._id]);
    assert.deepEqual(page.directory, []);
  });

  it('enforces database membership for raw reads and writes for online and offline users', async () => {
    for (const origin of [api, couch]) {
      for (const name of [sender, unrelated]) {
        const response = await request(origin, databasePath + '/_all_docs?include_docs=true', name);
        assert.ok([401, 403].includes(response.status), `unexpected raw read status for ${name}: ${response.status}`);
        const write = await request(origin, databasePath + '/data-message:forged', name, {
          method: 'PUT',
          body: JSON.stringify({ ...message, _id: 'data-message:forged' }),
        });
        assert.ok([401, 403].includes(write.status), `unexpected raw write status for ${name}: ${write.status}`);
      }
      const response = await request(origin, databasePath + '/data-message:initial', administrator);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).text, message.text);
    }
    await assert.rejects(db.medic.get(message._id), { status: 404 });
  });

  it('rejects invalid cursors and requests with invalid credentials', async () => {
    for (const query of ['?since=now', '?since=0&since=0']) {
      assert.equal((await request(api, syncPath + query, sender)).status, 400);
    }
    assert.equal((await request(api, syncPath, 'missing-messaging-user')).status, 401);
  });

  it('resumes after the saved cursor and pages late uploads without using the compose time', async () => {
    const initial = await sync(api, sender);
    const docs = Array.from({ length: 101 }, (_, i) => ({
      ...message, _id: 'data-message:late-' + i, created_at: 1,
    }));
    const results = await db.dataMessaging.bulkDocs(docs);
    assert.ok(results.every(result => result.ok));

    const first = await sync(api, sender, '?since=' + encodeURIComponent(initial.next_since));
    assert.equal(first.messages.length, 100);
    assert.equal(first.has_more, true);
    const last = await sync(api, sender, '?since=' + encodeURIComponent(first.next_since));
    assert.equal(last.has_more, false);
    assert.deepEqual(
      [...first.messages, ...last.messages].map(doc => doc._id).sort(),
      docs.map(doc => doc._id).sort(),
    );
    const empty = await sync(api, sender, '?since=' + encodeURIComponent(last.next_since));
    assert.deepEqual(empty.messages, []);
  });

  describe('message uploads', () => {
    const root = 'messaging-pilot';
    const site = 'messaging-site';
    const enabled = { enabled: true, pilot_root_place_ids: [root] };
    const settings = { contact_types: [{ id: 'region' }, { id: 'site', parents: ['region'] }] };
    const clinicalIds = [];
    const compose = () => ({ ...message, _id: 'data-message:' + uuid() });
    const upload = (doc, name = sender) => request(api, sendPath, name, {
      method: 'POST',
      body: JSON.stringify(doc),
    });
    let originalSettings;

    before(async () => {
      originalSettings = config.getAll();
      for (const [name, place] of [[sender, site], [recipient, root]]) {
        const login = await db.users.get(accountId(name));
        await db.users.put({ ...login, facility_id: [place] });
      }
      const smsView = readFileSync(path.join(
        __dirname, '../../../ddocs/medic-db/medic/views/messages_by_state/map.js'
      ), 'utf8');
      const results = await db.medic.bulkDocs([
        { _id: root, type: 'contact', contact_type: 'region' },
        { _id: site, type: 'contact', contact_type: 'site', parent: { _id: root } },
        { _id: accountId(sender), type: 'user-settings' },
        { _id: accountId(recipient), type: 'user-settings' },
        { _id: '_design/medic', views: { messages_by_state: { map: smsView } } },
        {
          _id: 'pending-sms', type: 'data_record', reported_date: 100,
          tasks: [{ state: 'pending', messages: [{ uuid: 'sms-id', to: '+1234567890', message: 'SMS' }] }],
        },
      ]);
      clinicalIds.push(...results.filter(result => result.ok).map(result => result.id));
      assert.equal(clinicalIds.length, results.length);
    });

    beforeEach(() => config.set({ ...settings, data_messaging: enabled }));

    after(async () => {
      config.set(originalSettings);
      const docs = await Promise.all(clinicalIds.map(id => db.medic.get(id)));
      await db.medic.bulkDocs(docs.map(({ _id, _rev }) => ({ _id, _rev, _deleted: true })));
    });

    it('validates the schema and text by Unicode code point, and creates no SMS work', async () => {
      const doc = compose();
      const outgoing = await sms.getOutgoingMessages();
      assert.deepEqual(outgoing.map(sms => sms.id), ['sms-id']);
      for (const fields of [
        { text: ' \n\t' },
        { text: '😀'.repeat(4001) },
        { _id: 'data-message:invalid' },
        { type: 'data_record' },
        { recipient_id: 'not-an-account' },
        { created_at: '100' },
        { created_at: null },
        { tasks: [] },
        { scheduled_tasks: [] },
        { _rev: '1-fake' },
        { _deleted: true },
      ]) {
        assert.equal((await upload({ ...doc, ...fields })).status, 400, JSON.stringify(Object.keys(fields)));
      }
      assert.equal((await upload(doc, 'missing-messaging-user')).status, 401);
      assert.equal((await upload(doc, unrelated)).status, 403);
      await assert.rejects(db.dataMessaging.get(doc._id), { status: 404 });

      doc.text = '😀'.repeat(4000);
      const response = await upload(doc);
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { id: doc._id });
      const { _rev, ...stored } = await db.dataMessaging.get(doc._id);
      assert.match(_rev, /^1-/);
      assert.deepEqual(stored, doc);
      await assert.rejects(db.medic.get(doc._id), { status: 404 });
      assert.deepEqual(await sms.getOutgoingMessages(), outgoing);
    });

    it('acknowledges a retry after reassignment or pilot disablement and rejects conflicting reuse', async () => {
      const doc = {
        ...compose(), sender_id: accountId(recipient), recipient_id: accountId(sender), text: '<b>Plain text</b>',
      };
      let initial = await sync(api, sender);
      while (initial.has_more) {
        initial = await sync(api, sender, '?since=' + encodeURIComponent(initial.next_since));
      }
      assert.equal((await upload(doc, recipient)).status, 201);

      const login = await db.users.get(accountId(sender));
      await db.users.put({ ...login, facility_id: [root] });
      try {
        assert.equal((await upload(doc, recipient)).status, 200);
        const stale = { ...doc, _id: compose()._id };
        assert.equal((await upload(stale, recipient)).status, 403);
        await assert.rejects(db.dataMessaging.get(stale._id), { status: 404 });

        config.set({ ...settings, data_messaging: { ...enabled, enabled: false } });
        const retry = await upload(doc, recipient);
        assert.equal(retry.status, 200);
        assert.deepEqual(await retry.json(), { id: doc._id });
        assert.equal((await upload({ ...doc, text: 'Changed' }, recipient)).status, 409);
        assert.equal((await upload({ ...doc, recipient_id: accountId(unrelated) }, recipient)).status, 409);
        const page = await sync(api, sender, '?since=' + encodeURIComponent(initial.next_since));
        assert.deepEqual(page.messages, [{
          _id: doc._id, sender_id: doc.sender_id, recipient_id: doc.recipient_id,
          text: doc.text, created_at: doc.created_at,
        }]);
      } finally {
        const current = await db.users.get(accountId(sender));
        await db.users.put({ ...current, facility_id: login.facility_id });
      }
    });

    it('acknowledges concurrent identical requests, with one canonical revision', async () => {
      const doc = compose();
      const responses = await Promise.all([upload(doc), upload(doc)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
      assert.match((await db.dataMessaging.get(doc._id))._rev, /^1-/);
    });
  });
});
