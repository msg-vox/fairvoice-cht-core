const assert = require('node:assert/strict');
const sinon = require('sinon');
const { PREFIXES, USER_ROLES } = require('@medic/constants');
const defaultSettings = require('../../../../config/default/app_settings.json');
const auth = require('../../../src/auth');
const config = require('../../../src/config');
const db = require('../../../src/db');
const dataMessaging = require('../../../src/services/data-messaging');
const users = require('@medic/user-management/src/users');

describe('Data messaging contract', () => {
  afterEach(() => sinon.restore());

  describe('configuration', () => {
    it('is off for both existing deployments and the default app settings', () => {
      const get = sinon.stub(config, 'get');
      assert.equal(dataMessaging.getConfig().enabled, false);

      get.withArgs('data_messaging').returns(defaultSettings.data_messaging);
      assert.equal(dataMessaging.getConfig().enabled, false);
    });

    it('requires explicit enablement and a configured pilot', () => {
      const get = sinon.stub(config, 'get').withArgs('data_messaging');
      const pilot = { pilot_root_place_ids: ['pilot'] };
      get.returns({ ...pilot, enabled: 'true' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ enabled: true, pilot_root_place_ids: 'pilot' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ ...pilot, enabled: true });
      const settings = dataMessaging.getConfig();
      assert.deepEqual(settings, {
        enabled: true,
        pilotRootPlaceIds: ['pilot'],
      });
    });
  });

  describe('session account', () => {
    it('uses the authenticated name for either an online or offline account', async () => {
      const req = { body: { sender_id: 'supplied-id' }, userCtx: { name: 'supplied-name' } };
      const getUserCtx = sinon.stub(auth, 'getUserCtx');
      const getMessagingAccount = sinon.stub(users, 'getMessagingAccount');
      const account = { id: PREFIXES.COUCH_USER + 'authenticated', facilityIds: ['place-a', 'place-b'] };
      getMessagingAccount.withArgs('authenticated').resolves(account);
      for (const roles of [[USER_ROLES.ONLINE], ['cr']]) {
        getUserCtx.withArgs(req).resolves({ name: 'authenticated', roles });
        assert.deepEqual(await dataMessaging.getAccount(req), account);
      }
      assert.deepEqual(getUserCtx.args, [[req], [req]]);
      assert.deepEqual(getMessagingAccount.args, [['authenticated'], ['authenticated']]);
    });

    it('rejects an unauthenticated request before looking up the account', async () => {
      sinon.stub(auth, 'getUserCtx').rejects({ code: 401 });
      const getMessagingAccount = sinon.stub(users, 'getMessagingAccount');
      await assert.rejects(dataMessaging.getAccount({}), { code: 401 });
      assert.equal(getMessagingAccount.callCount, 0);
    });
  });

  describe('recipient eligibility', () => {
    const accountId = name => PREFIXES.COUCH_USER + name;
    const canMessage = (first, second) => dataMessaging.canMessage(accountId(first), accountId(second));
    const place = (_id, contact_type, parent) => ({ _id, _rev: '1-test', type: 'contact', contact_type, parent });
    let getAccount;
    let readPlace;
    let getSettings;

    beforeEach(() => {
      getSettings = sinon.stub(config, 'get').withArgs('data_messaging');
      getSettings.returns({ enabled: true, pilot_root_place_ids: ['pilot'] });
      sinon.stub(config, 'getAll').returns({ contact_types: [
        { id: 'country' },
        { id: 'region', parents: ['country'] },
        { id: 'zone', parents: ['region', 'zone'] },
        { id: 'hub', parents: ['zone'] },
        { id: 'site', parents: ['hub'] },
        { id: 'person', person: true },
      ] });
      readPlace = sinon.stub(db.medic, 'get').rejects({ status: 404 });
      [
        place('country', 'country'),
        place('pilot', 'region', { _id: 'country' }),
        place('elsewhere', 'region', { _id: 'country' }),
        place('zone', 'zone', { _id: 'pilot' }),
        place('other-zone', 'zone', { _id: 'pilot' }),
        place('outside-zone', 'zone', { _id: 'elsewhere' }),
        place('hub', 'hub', { _id: 'zone' }),
        place('site', 'site', { _id: 'hub', parent: { _id: 'zone', parent: { _id: 'pilot' } } }),
        place('person', 'person', { _id: 'hub' }),
      ].forEach(doc => readPlace.withArgs(doc._id).resolves(doc));
      getAccount = sinon.stub(users, 'getMessagingAccount').resolves();
      const assignments = {
        site: ['site'],
        peer: ['site'],
        hub: ['hub'],
        zone: ['zone'],
        pilot: ['pilot'],
        country: ['country'],
        unrelated: ['other-zone'],
        multiple: ['other-zone', 'hub'],
        unassigned: [],
        missingPlace: ['missing'],
        person: ['person'],
      };
      Object.entries(assignments).forEach(([name, facilityIds]) => {
        getAccount.withArgs(name).resolves({ id: accountId(name), facilityIds, roles: ['custom'] });
      });
    });

    [
      ['site', 'pilot', true],
      ['site', 'zone', true],
      ['site', 'hub', true],
      ['hub', 'pilot', true],
      ['site', 'multiple', true],
      ['site', 'peer', false],
      ['zone', 'unrelated', false],
      ['site', 'unrelated', false],
      ['site', 'country', false],
      ['site', 'unassigned', false],
      ['site', 'inactive', false],
      ['site', 'missingPlace', false],
      ['hub', 'person', false],
      ['site', 'site', false],
    ].forEach(([first, second, allowed]) => {
      it(`${allowed ? 'allows' : 'denies'} ${first} and ${second} in both directions`, async () => {
        assert.equal(await canMessage(first, second), allowed);
        assert.equal(await canMessage(second, first), allowed);
      });
    });

    it('filters and deduplicates directory candidates using the send policy', async () => {
      const sender = accountId('site');
      const candidates = ['hub', 'peer', 'pilot', 'hub', 'inactive', 'site'].map(accountId);
      assert.deepEqual(await dataMessaging.getEligibleRecipientIds(sender, candidates), [
        accountId('hub'),
        accountId('pilot'),
      ]);
      assert.equal(getAccount.withArgs('site').callCount, 1);
      assert.equal(getAccount.withArgs('hub').callCount, 1);

      getAccount.withArgs('site').resolves({ id: sender, facilityIds: ['other-zone'] });
      assert.equal(await canMessage('site', 'hub'), false);
      assert.deepEqual(await dataMessaging.getEligibleRecipientIds(sender, candidates), [accountId('pilot')]);
    });

    it('honors an outer pilot root when another pilot root is nested below it', async () => {
      getSettings.returns({ enabled: true, pilot_root_place_ids: ['hub', 'pilot'] });
      assert.equal(await canMessage('site', 'pilot'), true);
    });

    it('uses current place parents and account assignments on every check', async () => {
      assert.equal(await canMessage('site', 'pilot'), true);
      readPlace.withArgs('hub').resolves(place('hub', 'hub', { _id: 'outside-zone' }));
      assert.equal(await canMessage('site', 'pilot'), false);
      getAccount.withArgs('site').resolves({ id: accountId('site'), facilityIds: ['zone'] });
      assert.equal(await canMessage('site', 'pilot'), true);
    });

    it('rejects a disallowed parent type or cyclic chain', async () => {
      readPlace.withArgs('site').resolves(place('site', 'site', { _id: 'zone' }));
      assert.equal(await canMessage('site', 'pilot'), false);
      readPlace.withArgs('zone').resolves(place('zone', 'zone', { _id: 'zone' }));
      assert.equal(await canMessage('zone', 'pilot'), false);
    });

    it('rejects malformed IDs and disabled messaging before loading accounts', async () => {
      assert.equal(await dataMessaging.canMessage(null, accountId('pilot')), false);
      getSettings.returns({ enabled: false, pilot_root_place_ids: ['pilot'] });
      assert.equal(await canMessage('site', 'pilot'), false);
      assert.equal(getAccount.callCount, 0);
    });

    describe('directory rebuild', () => {
      const directoryPrefix = 'data-message-directory:';
      let listAccounts;
      let readDirectories;
      let save;

      beforeEach(() => {
        listAccounts = sinon.stub(users, 'listMessagingAccounts');
        readDirectories = sinon.stub(db.dataMessaging, 'allDocs').resolves({ rows: [] });
        save = sinon.stub(db.dataMessaging, 'put').resolves();
      });

      it('publishes entries matching the live send policy and tracks all visited places', async () => {
        const accounts = await Promise.all(['site', 'peer', 'pilot', 'multiple', 'country', 'missingPlace'].map(
          async name => ({ ...await users.getMessagingAccount(name), displayName: name })
        ));
        listAccounts.resolves(accounts);
        const watchPlace = sinon.spy();
        await dataMessaging.rebuildDirectories(watchPlace);
        assert.equal(save.callCount, accounts.length);
        for (const [doc] of save.args) {
          const ids = accounts.map(account => account.id).sort();
          const expected = await dataMessaging.getEligibleRecipientIds(doc.owner_id, ids);
          assert.deepEqual(doc.entries.map(entry => entry.account_id), expected);
        }
        assert.equal(watchPlace.calledWith('missing'), true);
        assert.equal(watchPlace.calledWith('country'), true);
      });

      it('uses the pilot parent for display and preserves recipient assignments', async () => {
        config.getAll().data_messaging = { directory_parent_place_types: ['site'] };
        const hub = await db.medic.get('hub');
        hub.name = 'Hub name';
        const site = await db.medic.get('site');
        site.name = 'Site name';
        listAccounts.resolves(await Promise.all(['site', 'peer', 'pilot', 'hub'].map(async name => ({
          ...await users.getMessagingAccount(name), displayName: name,
        }))));

        await dataMessaging.rebuildDirectories();

        const directory = save.args.map(([doc]) => doc).find(doc => doc.owner_id === accountId('pilot'));
        const { entries } = directory;
        assert.deepEqual(entries.map(({ account_id, place_label, place_group }) => [
          account_id, place_label, place_group,
        ]), [
          [accountId('hub'), 'Hub name', 'Hub name'],
          [accountId('peer'), 'Hub name', 'Hub name'],
          [accountId('site'), 'Hub name', 'Hub name'],
        ]);
        const siteEntries = save.args.map(([doc]) => doc).find(doc => doc.owner_id === accountId('site')).entries;
        assert.deepEqual(siteEntries.map(entry => entry.account_id), [accountId('hub'), accountId('pilot')]);

        sinon.stub(db.dataMessaging, 'get').withArgs(directory._id).resolves(directory);
        sinon.stub(db.dataMessaging, 'changes').resolves({ results: [], last_seq: '1-test' });
        const page = await dataMessaging.getSyncPage(directory.owner_id, '0');
        assert.deepEqual(page.directory, entries);
      });

      it('combines distinct display places for accounts with multiple assignments', async () => {
        config.getAll().data_messaging = { directory_parent_place_types: ['hub'] };
        (await db.medic.get('zone')).name = 'Zone';
        (await db.medic.get('other-zone')).name = 'Other zone';
        listAccounts.resolves(await Promise.all(['pilot', 'multiple'].map(name => getAccount(name))));

        await dataMessaging.rebuildDirectories();

        const [{ place_label, place_group }] = save.firstCall.args[0].entries;
        assert.equal(place_label, 'Other zone, Zone');
        assert.equal(place_group, place_label);
      });

      it('includes configured role keys and their fallbacks in sync and preserves older entries', async () => {
        Object.assign(config.getAll(), {
          locale: 'fr',
          roles: { custom: { name: 'role.custom' }, officer: { name: 'role.officer' } },
        });
        const translate = sinon.stub(config, 'translate');
        translate.withArgs('role.custom', 'fr').returns('Chercheur');
        translate.withArgs('role.officer', 'fr').returns('Agent');
        const pilot = await getAccount('pilot');
        const site = { ...await getAccount('site'), displayName: 'Alex', roles: ['custom', 'officer', 'unconfigured'] };
        listAccounts.resolves([pilot, site]);
        await dataMessaging.rebuildDirectories();

        const directory = save.args.map(([doc]) => doc).find(doc => doc.owner_id === pilot.id);
        const { role_labels, ...legacyEntry } = directory.entries[0];
        assert.deepEqual(role_labels, [
          { key: 'role.custom', fallback: 'Chercheur' },
          { key: 'role.officer', fallback: 'Agent' },
        ]);
        assert.equal(legacyEntry.role_label, 'Chercheur, Agent');
        const get = sinon.stub(db.dataMessaging, 'get').withArgs(directory._id).resolves(directory);
        sinon.stub(db.dataMessaging, 'changes').resolves({ results: [], last_seq: '1-test' });
        assert.deepEqual((await dataMessaging.getSyncPage(pilot.id, '0')).directory, directory.entries);

        get.resolves({ ...directory, entries: [legacyEntry] });
        assert.deepEqual((await dataMessaging.getSyncPage(pilot.id, '0')).directory, [legacyEntry]);
      });

      it('omits the display place if the assigned pilot root has a parent outside the pilot', async () => {
        getSettings.returns({ enabled: true, pilot_root_place_ids: ['hub'] });
        config.getAll().data_messaging = { directory_parent_place_types: ['hub'] };
        (await db.medic.get('zone')).name = 'Outside';
        (await db.medic.get('hub')).name = 'Intermediate';
        listAccounts.resolves(await Promise.all(['site', 'hub'].map(name => getAccount(name))));

        await dataMessaging.rebuildDirectories();

        const [recipient] = save.firstCall.args[0].entries;
        assert.equal(recipient.account_id, accountId('hub'));
        assert.equal(recipient.place_label, '');
        assert.equal(Object.hasOwn(recipient, 'place_group'), false);
      });

      it('only clears previously published directories when disabled and skips identical revisions', async () => {
        const owner_id = accountId('site');
        const id = directoryPrefix + owner_id;
        const doc = { _id: id, _rev: '1-test', type: 'data_message_directory', owner_id, entries: [{ old: true }] };
        readDirectories.resolves({ rows: [{ id, doc }] });
        getSettings.returns({ enabled: false });

        await dataMessaging.rebuildDirectories();
        assert.deepEqual(save.args, [[{ ...doc, entries: [] }]]);
        assert.equal(listAccounts.callCount, 0);
        readDirectories.resolves({ rows: [{ id, doc: { ...doc, entries: [] } }] });
        await dataMessaging.rebuildDirectories();
        assert.equal(save.callCount, 1);
      });
    });

    describe('send', () => {
      const message = {
        _id: 'data-message:01a1f048-0d7b-711f-af1d-36de5dda8242',
        type: 'data_message',
        sender_id: accountId('site'),
        recipient_id: accountId('pilot'),
        text: 'Hello',
        created_at: 100,
      };
      let read;
      let put;
      const send = (doc = message, sender = message.sender_id) => dataMessaging.send(sender, doc);

      beforeEach(() => {
        read = sinon.stub(db.dataMessaging, 'get').rejects({ status: 404 });
        put = sinon.stub(db.dataMessaging, 'put').resolves();
      });

      it('rejects malformed messages and forged senders before accessing storage', async () => {
        const { text, ...withoutText } = message;
        for (const doc of [
          null,
          { ...withoutText, tasks: [] },
          { ...message, _id: 123 },
          { ...message, _id: 'other:' + message._id },
          { ...message, _id: message._id.replace('af1d', 'AF1D') },
          { ...message, _id: 'data-message:invalid' },
          { ...message, type: 'data_record' },
          { ...message, sender_id: 'site' },
          { ...message, recipient_id: 'pilot' },
          { ...message, created_at: Infinity },
          { ...message, text: 123 },
          { ...message, text: ' \n\t' },
          { ...message, text: text.repeat(2000) },
          { ...message, text: text.repeat(801) },
        ]) {
          await assert.rejects(send(doc), { code: 400 });
        }
        await assert.rejects(send(message, accountId('unrelated')), { code: 403 });
        assert.equal(read.callCount, 0);
        assert.equal(put.callCount, 0);
      });

      it('validates eligibility for a new send and creates the document without modification', async () => {
        await assert.rejects(send({ ...message, recipient_id: accountId('peer') }), { code: 403 });
        assert.equal(await send(), true);
        assert.deepEqual(put.args, [[message]]);
      });

      it('accepts a new message independently of Firebase availability', async () => {
        const request = sinon.stub(globalThis, 'fetch').rejects(new Error('Firebase unavailable'));
        assert.equal(await send(), true);
        sinon.assert.calledOnce(put);
        sinon.assert.notCalled(request);
      });

      it('acknowledges a stored match with the pilot disabled and rejects changes', async () => {
        read.resolves({ ...message, _rev: '1-test' });
        getSettings.returns({ enabled: false });
        assert.equal(await send(), false);
        await assert.rejects(send({ ...message, created_at: 101 }), { code: 409 });
        assert.equal(put.callCount, 0);
      });

      it('compares the canonical document again after a create conflict', async () => {
        put.rejects({ status: 409 });
        read.onSecondCall().resolves({ ...message, _rev: '1-test' });
        assert.equal(await send(), false);

        read.resetHistory();
        read.onSecondCall().resolves({ ...message, text: 'Different' });
        await assert.rejects(send(), { code: 409 });

        read.resetHistory();
        read.onSecondCall().rejects({ status: 404 });
        await assert.rejects(send(), { code: 409 });
      });

      it('propagates storage errors so they can be retried', async () => {
        read.onFirstCall().rejects({ status: 503 });
        put.rejects({ status: 503 });
        await assert.rejects(send(), { status: 503 });
        assert.equal(put.callCount, 0);
        await assert.rejects(send(), { status: 503 });
      });
    });
  });
});
