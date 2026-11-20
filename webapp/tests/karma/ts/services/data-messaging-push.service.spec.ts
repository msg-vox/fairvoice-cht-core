import { fakeAsync, tick } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { expect } from 'chai';
import { Subject } from 'rxjs';
import sinon from 'sinon';

import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingPushService } from '@mm-services/data-messaging-push.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingSyncService } from '@mm-services/data-messaging-sync.service';
import { SessionService } from '@mm-services/session.service';

describe('DataMessagingPushService', () => {
  const account = 'org.couchdb.user:recipient';
  const detail = {
    version: '1',
    event: 'data_message',
    message_id: 'data-message:550e8400-e29b-41d4-a716-446655440000',
    sender_account_id: 'org.couchdb.user:clinic:alice',
    sender_display_name: 'Alice Doe',
    recipient_binding: 'binding',
    delivery_id: 'receipt-1',
  };
  const emit = (fields = {}, type = 'cht:data-message:received') => {
    window.dispatchEvent(new CustomEvent(type, { detail: { ...detail, ...fields } }));
  };

  let service: DataMessagingPushService;
  let bridge;
  let originalBridge;
  let router;
  let messaging;
  let sync;
  let history;
  let session;
  let online;
  let draft: HTMLTextAreaElement;

  beforeEach(() => {
    online = true;
    sinon.stub(navigator, 'onLine').get(() => online);
    originalBridge = window.medicmobile_android;
    bridge = {
      getDataMessagePushRegistration: sinon.stub().returns(JSON.stringify({
        account_id: account, recipient_binding: detail.recipient_binding,
      })),
      dataMessagePushReady: sinon.stub(),
      ackDataMessagePush: sinon.stub(),
    };
    window.medicmobile_android = bridge;
    router = { events: new Subject(), navigated: true, navigate: sinon.stub(), url: '/reports/add' };
    messaging = { accountId: sinon.stub().returns(account) };
    sync = { requestSync: sinon.stub().resolves() };
    history = { refreshOnline: sinon.stub().resolves() };
    session = { isOnlineOnly: sinon.stub().returns(false) };
    service = new DataMessagingPushService(
      router as Router,
      messaging as DataMessagingService,
      sync as DataMessagingSyncService,
      history as DataMessagingHistoryService,
      session as SessionService,
    );
    draft = document.createElement('textarea');
    document.body.append(draft);
  });

  afterEach(() => {
    service.ngOnDestroy();
    draft.remove();
    window.medicmobile_android = originalBridge;
    sinon.restore();
  });

  it('coalesces a burst and replays duplicate acknowledgements without changing an unsaved form', fakeAsync(() => {
    draft.value = 'Unsaved form response';
    draft.focus();
    service.init();
    expect(bridge.dataMessagePushReady.args).to.deep.equal([['1']]);

    emit();
    emit();
    emit({ delivery_id: 'receipt-2' });
    expect(sync.requestSync.called).to.be.false;
    tick(100);

    emit();
    tick(100);
    expect(sync.requestSync.calledOnce).to.be.true;
    expect(sync.requestSync.firstCall.args[1]).to.equal(account);
    expect(bridge.ackDataMessagePush.args).to.deep.equal([
      ['receipt-1', 'handled'], ['receipt-1', 'handled'], ['receipt-2', 'handled'], ['receipt-1', 'handled'],
    ]);
    expect(router.navigate.called).to.be.false;
    expect(router.url).to.equal('/reports/add');
    expect(draft.value).to.equal('Unsaved form response');
    expect(document.activeElement).to.equal(draft);
  }));

  it('waits for router and registration readiness and checks the complete binding', fakeAsync(() => {
    router.navigated = false;
    bridge.getDataMessagePushRegistration.returns('');
    service.init();
    service.init();
    emit();
    router.events.next(new NavigationEnd(1, '/', '/tasks'));
    expect(bridge.dataMessagePushReady.called).to.be.false;
    bridge.getDataMessagePushRegistration.returns(JSON.stringify({
      account_id: account, recipient_binding: 'Binding',
    }));
    window.dispatchEvent(new Event('cht:data-message:registration-changed'));

    emit();
    emit({ delivery_id: 'invalid-version', version: '2', recipient_binding: 'Binding' });
    emit({ delivery_id: 'tap', recipient_binding: 'Binding' }, 'cht:data-message:tapped');
    tick(100);
    expect(bridge.dataMessagePushReady.args).to.deep.equal([['1']]);
    expect(bridge.ackDataMessagePush.args).to.deep.equal([
      ['receipt-1', 'retry'], ['receipt-1', 'discarded'], ['invalid-version', 'discarded'], ['tap', 'retry'],
    ]);
    expect(sync.requestSync.called).to.be.false;
    expect(router.navigate.called).to.be.false;
  }));

  it('retains a failed refresh for foreground resume or reconnect', fakeAsync(() => {
    service.init();
    sync.requestSync.onFirstCall().rejects();
    sync.requestSync.onSecondCall().rejects();
    emit();
    tick(100);
    expect(sync.requestSync.callCount).to.equal(1);

    sinon.stub(document, 'visibilityState').get(() => 'visible');
    document.dispatchEvent(new Event('visibilitychange'));
    tick(100);
    expect(sync.requestSync.callCount).to.equal(2);

    online = false;
    window.dispatchEvent(new Event('focus'));
    tick(100);
    expect(sync.requestSync.callCount).to.equal(2);

    online = true;
    window.dispatchEvent(new Event('online'));
    tick(100);
    expect(sync.requestSync.callCount).to.equal(3);
  }));

  it('clears pending work on an account switch before reconnect', fakeAsync(() => {
    online = false;
    service.init();
    emit();
    messaging.accountId.returns('org.couchdb.user:another');
    online = true;
    window.dispatchEvent(new Event('online'));
    tick(100);
    expect(sync.requestSync.called).to.be.false;
  }));

  it('uses the account-scoped online history for dashboard users', fakeAsync(() => {
    session.isOnlineOnly.returns(true);
    service.init();
    emit();
    tick(100);
    expect(history.refreshOnline.calledOnceWithExactly({ afterCurrent: true })).to.be.true;
    expect(sync.requestSync.called).to.be.false;
  }));

  it('runs one follow-up when fresh receipts arrive during a refresh', fakeAsync(() => {
    let finish!: () => void;
    sync.requestSync.onFirstCall().returns(new Promise<void>(resolve => finish = resolve));
    service.init();
    emit();
    tick(100);
    emit({ delivery_id: 'receipt-2' });
    emit({ delivery_id: 'receipt-3' });
    tick(100);
    expect(sync.requestSync.callCount).to.equal(1);

    finish();
    tick(100);
    expect(sync.requestSync.callCount).to.equal(2);
  }));
});
