import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { NgZone } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { expect } from 'chai';
import { of, Subject, throwError } from 'rxjs';
import sinon from 'sinon';

import { DataMessagingPushBridgeService } from '@mm-services/data-messaging-push-bridge.service';
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
  const receive = (message: Record<string, unknown>) => {
    bridge.onmessage(new MessageEvent('message', { data: JSON.stringify(message) }));
  };
  const emit = (fields = {}, type = 'received') => receive({ type, detail: { ...detail, ...fields } });
  const registered = (recipient_binding = detail.recipient_binding) => {
    receive({ type: 'registration', account_id: account, recipient_binding });
  };
  const sent = (type: string) => bridge.postMessage.args
    .map(([message]) => JSON.parse(message))
    .filter(message => message.type === type);
  const acks = () => sent('acknowledge').map(({ delivery_id, status }) => [delivery_id, status]);
  const ready = () => sent('ready').map(({ version }) => [version]);
  const start = () => {
    service.init();
    registered();
  };

  let service: DataMessagingPushService;
  let pushBridge: DataMessagingPushBridgeService;
  let bridge;
  let originalBridge;
  let http;
  let router;
  let messaging;
  let history;
  let online;
  let draft: HTMLTextAreaElement;

  beforeEach(() => {
    online = true;
    sinon.stub(navigator, 'onLine').get(() => online);
    originalBridge = window.fairvoice_push_registration;
    bridge = { postMessage: sinon.stub(), onmessage: null };
    window.fairvoice_push_registration = bridge;
    http = { post: sinon.stub() };
    const zone = { run: (callback: () => void) => callback() } as NgZone;
    pushBridge = new DataMessagingPushBridgeService(http as HttpClient, zone);
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
      pushBridge,
    );
    draft = document.createElement('textarea');
    document.body.append(draft);
  });

  afterEach(() => {
    service.ngOnDestroy();
    draft.remove();
    window.fairvoice_push_registration = originalBridge;
    sinon.restore();
  });

  it('keeps an ordinary browser idle when the Android bridge is absent', () => {
    delete window.fairvoice_push_registration;
    service.init();
    expect(http.post.called).to.be.false;
    expect(bridge.postMessage.called).to.be.false;
  });

  it('posts registration and refresh with the signed-in account and returns only the status and binding',
    fakeAsync(() => {
      const account_id = 'org.couchdb.user:clinic:Ǻlice';
      messaging.accountId.returns(account_id);
      service.init();
      expect(sent('session')).to.deep.equal([{ type: 'session', account_id }]);
      http.post.onFirstCall().returns(of(new HttpResponse({ status: 200, body: { recipient_binding: 'binding' } })));
      http.post.onSecondCall().returns(throwError(() => new HttpErrorResponse({ status: 409 })));
      const body = { installation_key: 'key', fcm_token: 'token' };
      receive({ type: 'request', id: 'first', operation: 'register', account_id, body });
      receive({ type: 'request', id: 'second', operation: 'refresh', account_id, body });
      receive({ type: 'request', id: 'mismatch', operation: 'register', account_id: account, body });
      tick();
      expect(http.post.args.map(([path]) => path)).to.deep.equal([
        '/api/v1/data-messaging/push-registrations',
        '/api/v1/data-messaging/push-registrations/refresh',
      ]);
      expect(http.post.firstCall.args[1]).to.deep.equal(body);
      expect(http.post.firstCall.args[2].headers['X-CHT-Push-Account']).to.equal(encodeURIComponent(account_id));
      expect(sent('result')).to.have.deep.members([
        { type: 'result', id: 'first', status: 200, recipient_binding: 'binding' },
        { type: 'result', id: 'second', status: 409 },
        { type: 'result', id: 'mismatch', status: 412 },
      ]);
    }));

  it('clears registration on logout, completes unregister before sign-out, and stays signed out', fakeAsync(() => {
    start();
    let finished = false;
    void pushBridge.logout()?.then(() => finished = true);
    expect(pushBridge.registration).to.be.undefined;
    expect(sent('logout')).to.have.lengthOf(1);
    http.post.returns(of(new HttpResponse({ status: 204 })));
    receive({ type: 'request', id: 'last', operation: 'unregister', account_id: account, body: {} });
    tick();
    expect(http.post.firstCall.args[0]).to.equal('/api/v1/data-messaging/push-registrations/unregister');
    expect(sent('result')).to.deep.equal([{ type: 'result', id: 'last', status: 204 }]);
    expect(finished).to.be.false;
    receive({ type: 'signed_out' });
    tick();
    expect(finished).to.be.true;
    window.dispatchEvent(new Event('online'));
    expect(sent('session')).to.have.lengthOf(1);
  }));

  it('bounds sign-out when Android does not respond', fakeAsync(() => {
    start();
    let finished = false;
    void pushBridge.logout()?.then(() => finished = true);
    tick(3_000);
    expect(finished).to.be.true;
  }));

  it('coalesces a burst and replays duplicate acknowledgements without changing an unsaved form', fakeAsync(() => {
    draft.value = 'Unsaved form response';
    draft.focus();
    start();
    expect(ready()).to.deep.equal([['1']]);

    emit();
    emit();
    emit({ delivery_id: 'receipt-2' });
    expect(history.refreshFromServer.called).to.be.false;
    tick(100);

    emit();
    tick(100);
    expect(history.refreshFromServer.calledOnce).to.be.true;
    expect(history.refreshFromServer.firstCall.args[0]).to.equal(account);
    expect(acks()).to.deep.equal([
      ['receipt-1', 'handled'], ['receipt-1', 'handled'], ['receipt-2', 'handled'], ['receipt-1', 'handled'],
    ]);
    expect(router.navigate.called).to.be.false;
    expect(router.url).to.equal('/reports/add');
    expect(draft.value).to.equal('Unsaved form response');
    expect(document.activeElement).to.equal(draft);
  }));

  it('waits for router and registration readiness and checks the complete binding', fakeAsync(() => {
    router.navigated = false;
    service.init();
    service.init();
    emit();
    router.events.next(new NavigationEnd(1, '/', '/tasks'));
    expect(ready()).to.be.empty;
    registered('Binding');

    emit();
    emit({ delivery_id: 'invalid-version', version: '2', recipient_binding: 'Binding' });
    tick(100);
    expect(ready()).to.deep.equal([['1']]);
    expect(acks()).to.deep.equal([
      ['receipt-1', 'discarded'], ['invalid-version', 'discarded'],
    ]);
    expect(history.refreshFromServer.called).to.be.false;
    expect(router.navigate.called).to.be.false;
  }));

  it('retains a failed refresh for foreground resume or reconnect', fakeAsync(() => {
    start();
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
    start();
    emit();
    messaging.accountId.returns('org.couchdb.user:another');
    online = true;
    window.dispatchEvent(new Event('online'));
    tick(100);
    expect(history.refreshFromServer.called).to.be.false;
  }));

  const tap = (fields = {}) => emit({ delivery_id: 'tap', ...fields }, 'tapped');

  it('waits for a cold-start tap and navigates using the entire sender account ID', fakeAsync(() => {
    router.navigated = false;
    start();
    tap();
    tick();
    expect(router.navigate.called).to.be.false;
    expect(acks()).to.be.empty;

    router.events.next(new NavigationEnd(1, '/', '/reports/add'));
    tap();
    tap();
    tick(100);
    expect(router.navigate.args).to.deep.equal([[['/messages', 'data:org.couchdb.user:clinic:alice']]]);
    expect(history.refreshFromServer.args).to.deep.equal([[account]]);
    expect(acks().at(-1)).to.deep.equal(['tap', 'handled']);
    tap();
    tick(100);
    expect(router.navigate.calledOnce).to.be.true;
    expect(history.refreshFromServer.calledOnce).to.be.true;
  }));

  it('opens two distinct sender threads and skips navigation when a tapped thread is already open', fakeAsync(() => {
    start();
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
    expect(acks().at(-1)).to.deep.equal(['new-tap', 'handled']);
  }));

  it('discards a declined navigation and a tap for an old binding', fakeAsync(() => {
    router.navigate.resolves(false);
    start();
    tap();
    tick(100);
    tap();
    tap({ delivery_id: 'wrong-account', recipient_binding: 'old-binding' });
    tick(100);
    expect(router.navigate.calledOnce).to.be.true;
    expect(history.refreshFromServer.called).to.be.false;
    expect(acks()).to.deep.equal([
      ['tap', 'discarded'], ['tap', 'discarded'], ['wrong-account', 'discarded'],
    ]);
  }));

  it('runs one follow-up when fresh receipts arrive during a refresh', fakeAsync(() => {
    let finish!: () => void;
    history.refreshFromServer.onFirstCall().returns(new Promise<void>(resolve => finish = resolve));
    start();
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
