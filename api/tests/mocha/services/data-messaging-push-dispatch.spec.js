const assert = require('node:assert/strict');
const sinon = require('sinon');
const { GoogleAuth } = require('google-auth-library');
const db = require('../../../src/db');
const messaging = require('../../../src/services/data-messaging');
const fcm = require('../../../src/services/data-messaging-fcm');
const dispatch = require('../../../src/services/data-messaging-push-dispatch');
const { JOB_PREFIX, JOB_TYPE } = require('../../../src/services/data-messaging-push-queue');

describe('Data message push dispatch', () => {
  const now = 1000000;
  const installationId = 'data-message-push-registration:installation';
  const messageId = 'data-message:01a1f048-0d7b-711f-af1d-36de5dda8242';
  const jobId = JOB_PREFIX + messageId + ':' + installationId;
  const sender = 'org.couchdb.user:clinic:sender';
  const recipient = 'org.couchdb.user:recipient';
  const send = fcm.createSender('pilot-project');
  let clock;
  let docs;
  let put;
  let fetchStub;
  let eligibility;
  let settings;
  let accessToken;

  const processPage = () => dispatch.processPage(send);

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now, toFake: ['Date'] });
    docs = new Map([
      [jobId, {
        _id: jobId, _rev: 'job-rev', type: JOB_TYPE, queued_at: now,
        message_id: messageId, sender_account_id: sender, recipient_account_id: recipient,
        installation_id: installationId, recipient_binding: 'binding',
      }],
      [installationId, {
        _id: installationId, _rev: 'installation-rev', type: 'data_message_push_registration',
        generation: 4, account_id: recipient, recipient_binding: 'binding', fcm_token: 'current-token',
      }],
    ]);
    sinon.stub(db.vault, 'allDocs').callsFake(() => Promise.resolve({
      rows: [{ id: jobId, doc: docs.get(jobId) }],
    }));
    sinon.stub(db.vault, 'get').callsFake(id => Promise.resolve(docs.get(id)));
    put = sinon.stub(db.vault, 'put').callsFake(doc => {
      if (docs.get(doc._id)?._rev !== doc._rev) {
        return Promise.reject({ status: 409 });
      }
      const rev = String(put.callCount);
      docs.set(doc._id, { ...doc, _rev: rev });
      return Promise.resolve({ rev });
    });
    settings = sinon.stub(messaging, 'getConfig').returns({ enabled: true });
    eligibility = sinon.stub(messaging, 'canMessage').resolves(true);
    sinon.stub(db.medic, 'get').withArgs(sender).resolves({ fullname: '  Alice Doe  ' });
    accessToken = sinon.stub(GoogleAuth.prototype, 'getAccessToken').resolves('runtime-access-token');
    fetchStub = sinon.stub(globalThis, 'fetch').resolves(new Response(null, { status: 200 }));
  });

  afterEach(() => sinon.restore());

  it('sends the data-only contract with the current token and a bounded Android TTL', async () => {
    await processPage();
    const [url, request] = fetchStub.firstCall.args;
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/pilot-project/messages:send');
    assert.equal(request.headers.authorization, 'Bearer runtime-access-token');
    assert.deepEqual(JSON.parse(request.body), {
      message: {
        token: 'current-token',
        android: { priority: 'high', ttl: '300s' },
        data: {
          version: '1',
          event: 'data_message',
          message_id: messageId,
          sender_account_id: sender,
          sender_display_name: 'Alice Doe',
          recipient_binding: 'binding',
        },
      },
    });
    assert.equal(docs.get(jobId).status, 'sent');
    await processPage();
    sinon.assert.calledOnce(fetchStub);
  });

  it('uses the full username when sender settings are missing', async () => {
    db.medic.get.withArgs(sender).rejects({ status: 404 });
    await processPage();
    assert.equal(JSON.parse(fetchStub.firstCall.args[1].body).message.data.sender_display_name, 'clinic:sender');
  });

  it('skips jobs when messaging is disabled or the relationship is outside the current pilot', async () => {
    settings.returns({ enabled: false });
    await processPage();
    sinon.assert.notCalled(db.vault.allDocs);
    settings.returns({ enabled: true });
    eligibility.resolves(false);
    await processPage();
    assert.equal(docs.get(jobId).status, 'discarded');
    sinon.assert.notCalled(accessToken);
  });

  it('skips an installation reassigned while acquiring the OAuth credential', async () => {
    accessToken.callsFake(() => {
      docs.get(installationId).recipient_binding = 'new-binding';
      return Promise.resolve('runtime-access-token');
    });
    await processPage();
    assert.equal(docs.get(jobId).status, 'discarded');
    sinon.assert.notCalled(fetchStub);
  });

  it('drops expired jobs and jobs created before the queue recorded a timestamp', async () => {
    clock.tick(300000);
    await processPage();
    assert.equal(docs.get(jobId).status, 'discarded');
    docs.set(jobId, { ...docs.get(jobId), queued_at: undefined, status: undefined });
    await processPage();
    assert.equal(docs.get(jobId).status, 'discarded');
    sinon.assert.notCalled(fetchStub);
  });

  it('backs off during an FCM outage and honors Retry-After', async () => {
    fetchStub.onFirstCall().resolves(new Response(null, { status: 503, headers: { 'Retry-After': '30' } }));
    await processPage();
    assert.equal(docs.get(jobId).next_attempt_at, now + 30000);
    assert.equal(docs.get(jobId).attempts, 1);
    clock.tick(29000);
    await processPage();
    sinon.assert.calledOnce(fetchStub);
    clock.tick(1000);
    await processPage();
    assert.equal(docs.get(jobId).status, 'sent');
    assert.equal(JSON.parse(fetchStub.secondCall.args[1].body).message.android.ttl, '270s');
  });

  const unregistered = () => Response.json({
    error: {
      details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
    },
  }, { status: 404 });

  it('retires an unregistered token and keeps the generation record', async () => {
    fetchStub.resolves(unregistered());
    await processPage();
    assert.equal(docs.get(installationId).fcm_token, null);
    assert.equal(docs.get(installationId).generation, 4);
    assert.equal(docs.get(jobId).status, 'discarded');
  });

  it('retires an explicitly invalid token while preserving tokens after other bad requests', async () => {
    fetchStub.onFirstCall().resolves(Response.json({
      error: { status: 'INVALID_ARGUMENT' },
    }, { status: 400 }));
    await processPage();
    assert.equal(docs.get(jobId).status, 'failed');
    assert.equal(docs.get(installationId).fcm_token, 'current-token');

    docs.set(jobId, { ...docs.get(jobId), status: undefined, next_attempt_at: now });
    fetchStub.onSecondCall().resolves(Response.json({
      error: {
        message: 'The registration token is not a valid FCM registration token',
        details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }],
      },
    }, { status: 400 }));
    await processPage();
    assert.equal(docs.get(installationId).fcm_token, null);
    assert.equal(docs.get(jobId).status, 'discarded');
  });

  it('lets only one worker claim the same CouchDB revision', async () => {
    await Promise.all([processPage(), processPage()]);
    sinon.assert.calledOnce(fetchStub);
    assert.equal(docs.get(jobId).status, 'sent');
  });

  it('preserves a token rotated while FCM was responding and retries using the new token', async () => {
    fetchStub.onFirstCall().callsFake(() => {
      docs.set(installationId, { ...docs.get(installationId), _rev: 'rotated', fcm_token: 'new-token' });
      return Promise.resolve(unregistered());
    });
    await processPage();
    assert.equal(docs.get(installationId).fcm_token, 'new-token');
    assert.equal(docs.get(jobId).status, undefined);
    clock.tick(60000);
    await processPage();
    assert.equal(JSON.parse(fetchStub.secondCall.args[1].body).message.token, 'new-token');
  });

  it('replays the same canonical message ID after FCM accepts it but the acknowledgement write fails', async () => {
    put.onSecondCall().rejects({ status: 503 });
    await processPage();
    assert.equal(docs.get(jobId).status, undefined);
    await processPage();
    sinon.assert.calledOnce(fetchStub);
    clock.tick(60000);
    await processPage();
    assert.equal(docs.get(jobId).status, 'sent');
    assert.deepEqual(fetchStub.args.map(([, req]) => JSON.parse(req.body).message.data.message_id), [
      messageId, messageId,
    ]);
  });
});
