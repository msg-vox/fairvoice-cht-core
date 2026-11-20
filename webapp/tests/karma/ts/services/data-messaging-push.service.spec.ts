import { fakeAsync, tick } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { expect } from 'chai';
import { Subject } from 'rxjs';
import sinon from 'sinon';

import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingPushService } from '@mm-services/data-messaging-push.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';

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
  let history;
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
    router = {
      events: new Subject(), navigated: true, url: '/reports/add',
      createUrlTree: (segments: string[]) => segments.join('/'),
      isActive: (target: string) => router.url === target,
      navigate: sinon.stub().callsFake((segments: string[]) => {
        router.url = segments.join('/');
        return Promise.resolve(true);
      }),
    };
    messaging = { accountId: sinon.stub().returns(account) };
    history = { refreshFromServer: sinon.stub().resolves() };
    service = new DataMessagingPushService(
      router as Router,
      messaging as DataMessagingService,
      history as DataMessagingHistoryService,
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
    expect(history.refreshFromServer.called).to.be.false;
    tick(100);

    emit();
    tick(100);
    expect(history.refreshFromServer.calledOnce).to.be.true;
    expect(history.refreshFromServer.firstCall.args[0]).to.equal(account);
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
    tick(100);
    expect(bridge.dataMessagePushReady.args).to.deep.equal([['1']]);
    expect(bridge.ackDataMessagePush.args).to.deep.equal([
      ['receipt-1', 'retry'], ['receipt-1', 'discarded'], ['invalid-version', 'discarded'],
    ]);
    expect(history.refreshFromServer.called).to.be.false;
    expect(router.navigate.called).to.be.false;
  }));

  it('retains a failed refresh for foreground resume or reconnect', fakeAsync(() => {
    service.init();
    history.refreshFromServer.onFirstCall().rejects();
    history.refreshFromServer.onSecondCall().rejects();
    emit();
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(1);

    sinon.stub(document, 'visibilityState').get(() => 'visible');
    document.dispatchEvent(new Event('visibilitychange'));
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(2);

    online = false;
    window.dispatchEvent(new Event('focus'));
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(2);

    online = true;
    window.dispatchEvent(new Event('online'));
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(3);
  }));

  it('clears pending work on an account switch before reconnect', fakeAsync(() => {
    online = false;
    service.init();
    emit();
    messaging.accountId.returns('org.couchdb.user:another');
    online = true;
    window.dispatchEvent(new Event('online'));
    tick(100);
    expect(history.refreshFromServer.called).to.be.false;
  }));

  const tap = (fields = {}) => emit({ delivery_id: 'tap', ...fields }, 'cht:data-message:tapped');

  it('waits for a cold-start tap and navigates using the entire sender account ID', fakeAsync(() => {
    router.navigated = false;
    service.init();
    tap();
    tick();
    expect(router.navigate.called).to.be.false;
    expect(bridge.ackDataMessagePush.lastCall.args).to.deep.equal(['tap', 'retry']);

    router.events.next(new NavigationEnd(1, '/', '/reports/add'));
    tap();
    tap();
    tick(100);
    expect(router.navigate.args).to.deep.equal([[['/messages', 'data:org.couchdb.user:clinic:alice']]]);
    expect(history.refreshFromServer.args).to.deep.equal([[account]]);
    expect(bridge.ackDataMessagePush.lastCall.args).to.deep.equal(['tap', 'handled']);
    tap();
    tick(100);
    expect(router.navigate.calledOnce).to.be.true;
    expect(history.refreshFromServer.calledOnce).to.be.true;
  }));

  it('opens two distinct sender threads and skips navigation when a tapped thread is already open', fakeAsync(() => {
    service.init();
    tap();
    tap({ delivery_id: 'second', sender_account_id: 'org.couchdb.user:zone:bob' });
    tick(100);
    expect(router.navigate.args).to.deep.equal([
      [['/messages', 'data:org.couchdb.user:clinic:alice']],
      [['/messages', 'data:org.couchdb.user:zone:bob']],
    ]);
    tap({ delivery_id: 'new-tap', sender_account_id: 'org.couchdb.user:zone:bob' });
    tick(100);
    expect(router.navigate.calledTwice).to.be.true;
    expect(bridge.ackDataMessagePush.lastCall.args).to.deep.equal(['new-tap', 'handled']);
  }));

  it('discards a declined navigation and a tap for an old binding', fakeAsync(() => {
    router.navigate.resolves(false);
    service.init();
    tap();
    tick(100);
    tap();
    tap({ delivery_id: 'wrong-account', recipient_binding: 'old-binding' });
    tick(100);
    expect(router.navigate.calledOnce).to.be.true;
    expect(history.refreshFromServer.called).to.be.false;
    expect(bridge.ackDataMessagePush.args).to.deep.equal([
      ['tap', 'discarded'], ['tap', 'discarded'], ['wrong-account', 'discarded'],
    ]);
  }));

  it('runs one follow-up when fresh receipts arrive during a refresh', fakeAsync(() => {
    let finish!: () => void;
    history.refreshFromServer.onFirstCall().returns(new Promise<void>(resolve => finish = resolve));
    service.init();
    emit();
    tick(100);
    emit({ delivery_id: 'receipt-2' });
    emit({ delivery_id: 'receipt-3' });
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(1);

    finish();
    tick(100);
    expect(history.refreshFromServer.callCount).to.equal(2);
  }));
});
