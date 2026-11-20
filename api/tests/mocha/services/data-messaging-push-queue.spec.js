const assert = require('node:assert/strict');
const sinon = require('sinon');
const db = require('../../../src/db');
const messaging = require('../../../src/services/data-messaging');
const queue = require('../../../src/services/data-messaging-push-queue');

describe('Data message push queue', () => {
  const activation = '10-pilot';
  const accepted = '11-upload';
  const checkpointId = 'data-message-push-checkpoint';
  const message = {
    _id: 'data-message:01a1f048-0d7b-711f-af1d-36de5dda8242',
    type: 'data_message',
    sender_id: 'org.couchdb.user:clinic:sender',
    recipient_id: 'org.couchdb.user:recipient',
    created_at: 1,
    text: 'Delayed offline message',
  };
  const doc = { ...message, _rev: '1-message' };
  const registration = {
    _id: 'data-message-push-registration:installation',
    type: 'data_message_push_registration',
    account_id: message.recipient_id,
    recipient_binding: 'binding',
    fcm_token: 'token',
  };
  let vault;
  let changes;
  let put;

  beforeEach(() => {
    vault = new Map();
    sinon.stub(db.vault, 'get').callsFake(id => {
      if (!vault.has(id)) {
        return Promise.reject({ status: 404 });
      }
      return Promise.resolve(vault.get(id));
    });
    put = sinon.stub(db.vault, 'put').callsFake(doc => {
      if (vault.get(doc._id)?._rev !== doc._rev) {
        return Promise.reject({ status: 409 });
      }
      const rev = String(put.callCount);
      vault.set(doc._id, { ...doc, _rev: rev });
      return Promise.resolve({ rev });
    });
    sinon.stub(db.vault, 'query').callsFake((view, options) => {
      assert.equal(view, 'data-message-push-registrations-v1/data-message-push-registrations-v1');
      assert.deepEqual(options, { key: message.recipient_id });
      return Promise.resolve({
        rows: [
          { id: registration._id, value: registration.recipient_binding },
          { id: registration._id + '2', value: 'binding2' },
        ],
      });
    });
    changes = sinon.stub(db.dataMessaging, 'changes').callsFake(({ since }) => {
      assert.ok([activation, accepted].includes(since));
      return Promise.resolve({
        results: since === activation ? [
          { doc: { ...doc, _rev: '2-edit' } },
          { doc },
        ] : [],
        last_seq: accepted,
      });
    });
  });

  afterEach(() => sinon.restore());

  const jobs = () => [...vault.values()].filter(doc => doc.type === 'data_message_push_job');

  it('queues a delayed upload by acceptance sequence for each active recipient installation', async () => {
    await queue.processPage(activation);

    assert.equal(changes.firstCall.args[0].since, activation);
    assert.deepEqual(jobs().map(job => job.recipient_binding), ['binding', 'binding2']);
    const [{ _rev, _id, queued_at, ...job }] = jobs();
    assert.ok(_rev);
    assert.ok(Number.isFinite(queued_at));
    assert.equal(_id, `data-message-push-job:${message._id}:${registration._id}`);
    assert.deepEqual(job, {
      type: 'data_message_push_job',
      message_id: message._id,
      sender_account_id: message.sender_id,
      recipient_account_id: message.recipient_id,
      installation_id: registration._id,
      recipient_binding: 'binding',
    });
    assert.equal(vault.get(checkpointId).since, accepted);
  });

  it('keeps the same jobs after identical submission retries', async () => {
    sinon.stub(db.dataMessaging, 'get').withArgs(message._id).resolves(doc);
    const save = sinon.stub(db.dataMessaging, 'put');
    await queue.processPage(activation);

    assert.equal(await messaging.send(message.sender_id, message), false);
    assert.equal(await messaging.send(message.sender_id, message), false);
    sinon.assert.notCalled(save);
    await queue.processPage(activation);

    assert.equal(changes.secondCall.args[0].since, accepted);
    assert.equal(jobs().length, 2);
  });

  it('replays safely after jobs are saved but the checkpoint write fails', async () => {
    put.onCall(3).rejects({ status: 503 });
    await assert.rejects(queue.processPage(activation), { status: 503 });
    assert.equal(vault.get(checkpointId).since, activation);
    const savedJobs = jobs();
    assert.equal(savedJobs.length, 2);

    await queue.processPage('ignored-after-restart');

    assert.deepEqual(jobs(), savedJobs);
    assert.equal(vault.get(checkpointId).since, accepted);
  });
});
