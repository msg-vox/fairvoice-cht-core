import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { expect } from 'chai';
import sinon from 'sinon';
import { v7 as uuid } from 'uuid';
import { DataMessage, DataMessagingDirectory, DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingStoreService } from '@mm-services/data-messaging-store.service';
import { DataMessagingSyncService } from '@mm-services/data-messaging-sync.service';
import { DataMessagingDirectoryService, readMessagingCheckpoint } from '@mm-services/data-messaging-directory.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingConversationsService } from '@mm-services/data-messaging-conversations.service';
import { AddReadStatusService } from '@mm-services/add-read-status.service';
import { MarkReadService } from '@mm-services/mark-read.service';
import { ReadDocsProvider } from '@mm-providers/read-docs.provider';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';

describe('Data messaging sync', () => {
  const sendPath = '/api/v1/data-messaging/messages';
  const syncPath = '/api/v1/data-messaging/sync';
  const recipient = 'org.couchdb.user:recipient';
  const account_id = 'org.couchdb.user:sender';
  let onlineOnly = false;
  let dbName: string;
  let db;
  let pouch;
  let getMessaging: sinon.SinonStub;
  let http: HttpTestingController;
  let api: DataMessagingService;
  let storage: DataMessagingStoreService;
  let sync: DataMessagingSyncService;

  const restart = () => {
    const session = TestBed.inject(SessionService);
    api = new DataMessagingService(TestBed.inject(HttpClient), session);
    storage = new DataMessagingStoreService(session, TestBed.inject(DbService), api);
    sync = new DataMessagingSyncService(api, storage, session);
  };

  beforeEach(() => {
    pouch = require('pouchdb-browser').default;
    dbName = 'message-sync-test-' + uuid();
    db = pouch(dbName);
    getMessaging = sinon.stub().callsFake(() => db);
    onlineOnly = false;
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { userCtx: () => ({ name: 'sender' }), isOnlineOnly: () => onlineOnly } },
      { provide: DbService, useValue: { getMessaging } },
    ] });
    http = TestBed.inject(HttpTestingController);
    restart();
  });

  afterEach(async () => {
    http.verify();
    sinon.restore();
    await db.destroy();
  });

  const nextRequest = async (url: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const requests = http.match(request => request.url === url);
      if (requests.length) {
        expect(requests).to.have.length(1);
        return requests[0];
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Expected messaging request to ' + url);
  };

  const page = (
    messages: DataMessage[], next_since: string, has_more = false, directory: DataMessagingDirectory | null = []
  ) => ({
    account_id,
    messages: messages.map(({ type: _type, ...message }) => message),
    directory,
    next_since,
    has_more,
  });

  it('persists offline sends and retries the original payload after restart and a lost response', async () => {
    const message = api.compose(recipient, 'Saved while offline');
    expect(await storage.submit(message)).to.equal('waiting');
    restart();
    db = pouch(dbName);
    expect(await storage.open().getPending()).to.deep.equal([message]);

    const interrupted = sync.sync();
    const overlapping = sync.sync();
    const first = await nextRequest(sendPath);
    expect(first.request.body).to.deep.equal(message);
    first.error(new ProgressEvent('lost response'));
    (await nextRequest(syncPath)).flush(page([], '0'));
    await Promise.all([interrupted, overlapping]);
    expect((await storage.open().getMessages())[0].delivery).to.equal('waiting');

    restart();
    const retry = sync.sync();
    const second = await nextRequest(sendPath);
    expect(second.request.body).to.deep.equal(message);
    second.flush({ id: message._id });
    (await nextRequest(syncPath)).flush(page([message], '1-test'));
    await retry;

    restart();
    expect(await storage.open().getPending()).to.deep.equal([]);
    expect(await storage.open().getMessages()).to.deep.equal([{ localId: message._id, message, delivery: 'sent' }]);
  });

  it('keeps an ineligible send available for copying and continues the queue', async () => {
    const stale = api.compose(recipient, 'Recipient has moved');
    const valid = api.compose(recipient, 'Accepted despite an interrupted response');
    await storage.submit(stale);
    await storage.submit(valid);

    const run = sync.sync();
    const first = await nextRequest(sendPath);
    expect(first.request.body).to.deep.equal(stale);
    first.flush({ details: 'recipient_ineligible' }, { status: 403, statusText: 'Forbidden' });
    const second = await nextRequest(sendPath);
    expect(second.request.body).to.deep.equal(valid);
    second.error(new ProgressEvent('lost response'));
    (await nextRequest(syncPath)).flush(page([valid], '1-test'));
    await run;

    restart();
    const nextRun = sync.sync();
    const download = await nextRequest(syncPath);
    expect(download.request.params.get('since')).to.equal('1-test');
    download.flush(page([], '1-test'));
    await nextRun;
    expect(await storage.open().getPending()).to.deep.equal([]);
    expect(await storage.open().getMessages()).to.deep.equal([
      { localId: valid._id, message: valid, delivery: 'sent' },
      { localId: 'data-message-outbox:' + stale._id, message: stale, delivery: 'recipient_ineligible' },
    ]);
  });

  it('replays an incomplete page from the last saved cursor without duplicating its messages', async () => {
    const incoming = text => ({ ...api.compose(recipient, text), sender_id: recipient, recipient_id: account_id });
    const first = incoming('First page');
    const second = incoming('Saved before the error');
    const third = incoming('Write failed');
    const directory = [{ account_id: recipient, display_name: 'Recipient', place_label: 'Site', role_label: 'CHW' }];
    const put = sinon.stub(db, 'put').callThrough().withArgs(sinon.match({ _id: third._id }));
    put.onFirstCall().rejects(new Error('Write failed'));
    const run = sync.sync();
    const failedRun = expect(run).to.be.rejectedWith('Write failed');
    (await nextRequest(syncPath)).flush(page([first], '1-test', true, directory));
    const download = await nextRequest(syncPath);
    expect(download.request.params.get('since')).to.equal('1-test');
    download.flush(page([second, third], '2-test'));
    await failedRun;
    const beforeRetry = await readMessagingCheckpoint(db);
    expect(beforeRetry?.since).to.equal('1-test');
    expect(beforeRetry?.entries).to.deep.equal(directory);

    const retry = sync.sync();
    const repeated = await nextRequest(syncPath);
    expect(repeated.request.params.get('since')).to.equal('1-test');
    repeated.flush(page([second, third], '2-test'));
    await retry;
    const afterRetry = await readMessagingCheckpoint(db);
    expect(afterRetry?.since).to.equal('2-test');
    expect(afterRetry?.entries).to.deep.equal([]);
    expect((await storage.open().getMessages()).map(item => item.message)).to.deep.equal([first, second, third]);
  });

  it('submits immediately for online-only accounts without opening PouchDB', async () => {
    onlineOnly = true;
    const message = api.compose(recipient, 'Online');
    const submit = storage.submit(message);
    http.expectOne(sendPath).flush({ id: message._id });
    expect(await submit).to.equal('sent');
    await sync.sync();
    expect(getMessaging.callCount).to.equal(0);
  });

  it('exchanges a queued message and a dashboard reply with independent unread markers', async () => {
    const workerMeta = pouch(dbName + '-worker-meta');
    const dashboardMeta = pouch(dbName + '-dashboard-meta');
    const workerSession = TestBed.inject(SessionService);
    const dashboardSession = {
      userCtx: () => ({ name: 'recipient' }), isOnlineOnly: () => true,
    } as SessionService;
    const devices = { getMessaging } as unknown as DbService;
    const workerDirectory = [{
      account_id: recipient, display_name: 'Alex', role_label: 'Nurse', place_label: 'Clinic',
    }];
    const dashboardDirectory = [{ account_id, display_name: 'Jo', role_label: 'CHW', place_label: 'Village' }];
    const workerHistory = new DataMessagingHistoryService(
      api, storage, new DataMessagingDirectoryService(api, workerSession, devices), workerSession
    );
    const dashboardApi = new DataMessagingService(TestBed.inject(HttpClient), dashboardSession);
    const dashboardStore = new DataMessagingStoreService(dashboardSession, devices, dashboardApi);
    const dashboardHistory = new DataMessagingHistoryService(
      dashboardApi,
      dashboardStore,
      new DataMessagingDirectoryService(dashboardApi, dashboardSession, devices),
      dashboardSession
    );
    const workerMetadata = { get: () => workerMeta } as unknown as DbService;
    const dashboardMetadata = { get: () => dashboardMeta } as unknown as DbService;
    const workerThreads = new DataMessagingConversationsService(
      workerHistory, new AddReadStatusService(workerMetadata)
    );
    const dashboardThreads = new DataMessagingConversationsService(
      dashboardHistory, new AddReadStatusService(dashboardMetadata)
    );

    try {
      const initialise = sync.sync();
      (await nextRequest(syncPath)).flush(page([], '0', false, workerDirectory));
      await initialise;
      expect(await workerHistory.getDirectory()).to.deep.equal(workerDirectory);

      const first = api.compose(recipient, 'Sent from the offline device');
      expect(await storage.submit(first)).to.equal('waiting');
      const [waitingThread] = await workerThreads.getConversations();
      expect(waitingThread.messages[0]).to.include({ delivery: 'waiting', outgoing: true });
      const openDashboard = dashboardThreads.getConversations();
      (await nextRequest(syncPath)).flush({ ...page([], '0', false, dashboardDirectory), account_id: recipient });
      expect(await openDashboard).to.deep.equal([]);

      const upload = sync.sync();
      const firstRequest = await nextRequest(sendPath);
      expect(firstRequest.request.body).to.deep.equal(first);
      firstRequest.flush({ id: first._id });
      (await nextRequest(syncPath)).flush(page([first], '1-test', false, workerDirectory));
      await upload;

      const downloadDashboard = dashboardHistory.refreshOnline();
      const dashboardRequest = await nextRequest(syncPath);
      expect(dashboardRequest.request.params.get('since')).to.equal('0');
      dashboardRequest.flush({ ...page([first], '1-test', false, dashboardDirectory), account_id: recipient });
      await downloadDashboard;
      const [inbox] = await dashboardThreads.getConversations();
      expect(inbox).to.include({ id: account_id, name: 'Jo' });
      expect(inbox.messages[0]).to.include({ read: false, outgoing: false });
      expect(await dashboardThreads.getUnreadCount()).to.equal(1);
      await new MarkReadService(dashboardMetadata, new ReadDocsProvider()).markAsRead([inbox.messages[0].doc]);
      expect(await dashboardThreads.getUnreadCount()).to.equal(0);

      const reply = dashboardApi.compose(account_id, 'Replied from the dashboard');
      const sendReply = dashboardStore.submit(reply);
      (await nextRequest(sendPath)).flush({ id: reply._id });
      expect(await sendReply).to.equal('sent');
      const [dashboardThread] = await dashboardThreads.getConversations();
      expect(dashboardThread.messages[1]).to.include({ delivery: 'sent', outgoing: true });
      expect(await workerThreads.getUnreadCount()).to.equal(0);

      const downloadWorker = sync.sync();
      const workerRequest = await nextRequest(syncPath);
      expect(workerRequest.request.params.get('since')).to.equal('1-test');
      workerRequest.flush(page([reply], '2-test', false, []));
      await downloadWorker;
      const [workerThread] = await workerThreads.getConversations();
      expect(workerThread).to.include({ name: recipient, recipient: undefined });
      expect(workerThread.messages.map(({ doc }) => doc.text)).to.deep.equal([first.text, reply.text]);
      expect(workerThread.messages[1]).to.include({ read: false, outgoing: false });
      expect(await workerThreads.getUnreadCount()).to.equal(1);
      await new MarkReadService(workerMetadata, new ReadDocsProvider()).markAsRead([workerThread.messages[1].doc]);
      expect(await workerThreads.getUnreadCount()).to.equal(0);
      const dashboardMarkers = await dashboardMeta.allDocs();
      expect(dashboardMarkers.rows.map(({ id }) => id)).to.deep.equal(['read:data_message:' + first._id]);
      expect((await workerMeta.allDocs()).rows.map(({ id }) => id)).to.deep.equal(['read:data_message:' + reply._id]);
    } finally {
      await Promise.all([workerMeta.destroy(), dashboardMeta.destroy()]);
    }
  });

  it('leaves a session rejection pending and preserves a conflicting attempt beside canonical history', async () => {
    const message = api.compose(recipient, 'My pending text');
    const canonical = { ...message, text: 'Different accepted text' };
    await storage.submit(message);
    expect(await storage.submit(message)).to.equal('waiting');
    await expect(storage.submit(canonical)).to.be.rejected;

    const unauthorized = sync.sync();
    (await nextRequest(sendPath)).flush({ error: 'Permission denied' }, { status: 403, statusText: 'Forbidden' });
    (await nextRequest(syncPath)).flush(page([], '0'));
    await unauthorized;
    expect(await storage.open().getPending()).to.deep.equal([message]);

    const conflict = sync.sync();
    (await nextRequest(sendPath)).flush({}, { status: 409, statusText: 'Conflict' });
    (await nextRequest(syncPath)).flush(page([canonical], '1-test'));
    await conflict;
    expect(await storage.open().getPending()).to.deep.equal([]);
    const records = await storage.open().getMessages();
    expect(records.map(({ message, delivery }) => [message.text, delivery])).to.deep.equal([
      [canonical.text, 'sent'], [message.text, 'failed'],
    ]);
  });
});
