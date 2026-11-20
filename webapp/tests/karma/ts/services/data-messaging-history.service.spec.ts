import { expect } from 'chai';
import { Subject } from 'rxjs';
import sinon from 'sinon';

import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';

describe('DataMessagingHistoryService', () => {
  const accountId = 'org.couchdb.user:worker';
  const peer = 'org.couchdb.user:supervisor';
  const incoming = {
    _id: 'data-message:1', sender_id: peer, recipient_id: accountId, text: 'Hello', created_at: 10,
  };
  const page = {
    account_id: accountId,
    messages: [],
    directory: [{ account_id: peer, display_name: 'Supervisor', role_label: '', place_label: '' }],
    next_since: 'page-1',
    has_more: false,
  };
  let service: DataMessagingHistoryService;
  let messaging;
  let storage;
  let directory;
  let local;
  let session;

  beforeEach(() => {
    messaging = { accountId: sinon.stub().returns(accountId), getSyncPage: sinon.stub() };
    local = { getMessages: sinon.stub().resolves([]) };
    storage = { open: sinon.stub().returns(local), changes: new Subject() };
    directory = { getDirectory: sinon.stub().resolves(page.directory) };
    session = { isOnlineOnly: sinon.stub().returns(true) };
    service = new DataMessagingHistoryService(messaging, storage, directory, session);
  });

  afterEach(() => sinon.restore());

  it('shares paginated dashboard downloads and resumes with the last applied cursor', async () => {
    const changed = sinon.spy();
    service.changes.subscribe(changed);
    const expected = { localId: incoming._id, message: { ...incoming, type: 'data_message' } };
    messaging.getSyncPage.onFirstCall().resolves({ ...page, messages: [incoming], has_more: true });
    messaging.getSyncPage.onSecondCall().resolves({ ...page, next_since: 'page-2', directory: null });

    const [first, second] = await Promise.all([service.read(), service.read()]);
    expect(first).to.deep.equal({ accountId, directory: page.directory, messages: [expected] });
    expect(first).to.deep.equal(second);
    expect(messaging.getSyncPage.args).to.deep.equal([[undefined], ['page-1']]);

    messaging.getSyncPage.onThirdCall().resolves({ ...page, next_since: 'page-3', directory: [] });
    await service.refreshOnline();
    expect(messaging.getSyncPage.thirdCall.args).to.deep.equal(['page-2']);
    expect(await service.read()).to.deep.equal({ accountId, directory: [], messages: [expected] });
    expect(changed.callCount).to.equal(2);
    expect(storage.open.called).to.be.false;
  });

  it('shares one fresh download after a dashboard refresh already in progress', async () => {
    messaging.getSyncPage.onFirstCall().resolves(page);
    messaging.getSyncPage.onSecondCall().resolves({ ...page, messages: [incoming], next_since: 'page-2' });
    const initial = service.refreshOnline();
    const firstReceipt = service.refreshOnline({ afterCurrent: true });
    const secondReceipt = service.refreshOnline({ afterCurrent: true });

    await Promise.all([initial, firstReceipt, secondReceipt]);

    expect(messaging.getSyncPage.args).to.deep.equal([[undefined], ['page-1']]);
    expect((await service.read()).messages[0].message._id).to.equal(incoming._id);
  });

  it('shows a dashboard acknowledgement immediately and deduplicates the later download', async () => {
    const reply = { ...incoming, _id: 'data-message:2', sender_id: accountId, recipient_id: peer };
    messaging.getSyncPage.onFirstCall().resolves(page);
    messaging.getSyncPage.onSecondCall().resolves({ ...page, messages: [reply] });
    await service.read();

    storage.changes.next({ accountId, accepted: { ...reply, type: 'data_message' } });
    const initial = await service.read();
    expect(initial.messages).to.deep.equal([{
      localId: reply._id, message: { ...reply, type: 'data_message' }, delivery: 'sent',
    }]);
    await service.refreshOnline();
    expect(await service.read()).to.deep.equal(initial);
  });

  it('retains earlier pages after an interrupted dashboard refresh and isolates the next account', async () => {
    messaging.getSyncPage.onFirstCall().resolves({ ...page, messages: [incoming], has_more: true });
    messaging.getSyncPage.onSecondCall().rejects(new Error('Interrupted'));
    try {
      await service.refreshOnline();
      expect.fail('Expected the second page to fail');
    } catch (err) {
      expect(err.message).to.equal('Interrupted');
    }
    expect((await service.read()).messages.length).to.equal(1);

    messaging.accountId.returns(peer);
    messaging.getSyncPage.onThirdCall().resolves({ ...page, account_id: peer, directory: [] });
    expect(await service.read()).to.deep.equal({ accountId: peer, directory: [], messages: [] });
    expect(messaging.getSyncPage.thirdCall.args).to.deep.equal([undefined]);
  });

  it('refreshes directory changes on demand and keeps the saved snapshot when a page has no directory', async () => {
    const changed = sinon.spy();
    service.changes.subscribe(changed);
    messaging.getSyncPage.onFirstCall().resolves(page);
    messaging.getSyncPage.onSecondCall().resolves({ ...page, directory: null, next_since: 'page-2' });
    messaging.getSyncPage.onThirdCall().resolves({ ...page, directory: [], next_since: 'page-3' });

    expect(await service.getDirectory()).to.deep.equal(page.directory);
    expect(await service.getDirectory()).to.deep.equal(page.directory);
    expect(messaging.getSyncPage.calledOnce).to.be.true;
    expect(await service.getDirectory({ refreshOnline: true })).to.deep.equal(page.directory);
    expect(changed.calledOnce).to.be.true;
    expect(await service.getDirectory({ refreshOnline: true })).to.deep.equal([]);
    expect(changed.calledTwice).to.be.true;

    messaging.accountId.returns(undefined);
    expect(await service.read()).to.deep.equal({ directory: null, messages: [] });
    expect(await service.getDirectory()).to.be.null;
    await service.refreshOnline();
    expect(messaging.getSyncPage.callCount).to.equal(3);
  });

  it('loads offline history and directory from local storage after a sync notification', async () => {
    session.isOnlineOnly.returns(false);
    const change = sinon.spy();
    service.changes.subscribe(change);
    expect(await service.read()).to.deep.equal({ accountId, directory: page.directory, messages: [] });

    const record = { localId: incoming._id, message: { ...incoming, type: 'data_message' } };
    directory.getDirectory.resolves([]);
    local.getMessages.resolves([record]);
    storage.changes.next({ accountId: peer });
    storage.changes.next({ accountId });

    expect(change.calledOnce).to.be.true;
    expect(await service.read()).to.deep.equal({ accountId, directory: [], messages: [record] });
    expect(messaging.getSyncPage.called).to.be.false;
  });
});
