import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, NgZone } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { logPushDebug } from '@mm-services/data-messaging-push-debug';

const REGISTRATIONS = '/api/v1/data-messaging/push-registrations';
const LOGOUT_TIMEOUT_MS = 3_000;

export interface FairvoicePushBridge {
  postMessage(message: string): void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
}

declare global {
  interface Window {
    fairvoice_push_registration?: FairvoicePushBridge;
  }
}

type Registration = { account_id: string; recipient_binding: string };
type Operation = 'register' | 'refresh' | 'unregister';
type BridgeResponse =
  | ({ type: 'registration' } & Partial<Registration>)
  | { type: 'request'; id: string; operation: Operation; account_id: string; body: Record<string, unknown> }
  | { type: 'received' | 'tapped'; detail: Record<string, unknown> }
  | { type: 'signed_out' };

export const isPushBinding = (value: unknown): value is string => typeof value === 'string' &&
  /^[!-~]{1,128}$/.test(value);

@Injectable({ providedIn: 'root' })
export class DataMessagingPushBridgeService {
  readonly changes = new Subject<void>();
  readonly deliveries = new Subject<Extract<BridgeResponse, { type: 'received' | 'tapped' }>>();
  registration?: Registration;
  private bridge?: FairvoicePushBridge;
  private getAccount?: () => string | undefined;
  private account?: string;
  private signingOut = false;
  private signedOut?: () => void;
  private logoutPending?: Promise<void>;

  constructor(private http: HttpClient, private zone: NgZone) {}

  connect(getAccount: () => string | undefined): boolean {
    const bridge = window.fairvoice_push_registration;
    if (typeof bridge?.postMessage !== 'function') {
      logPushDebug('Android bridge unavailable');
      return false;
    }
    logPushDebug('Android bridge connected');
    this.bridge = bridge;
    this.getAccount = getAccount;
    bridge.onmessage = event => this.zone.run(() => this.receive(event.data));
    return true;
  }

  disconnect(): void {
    if (this.bridge) {
      this.bridge.onmessage = null;
    }
    this.bridge = undefined;
    this.getAccount = undefined;
    this.account = undefined;
    this.registration = undefined;
    this.signedOut?.();
    this.signingOut = false;
    this.logoutPending = undefined;
  }

  syncSession(): void {
    if (this.signingOut) {
      return;
    }
    const account = this.getAccount?.();
    logPushDebug('Session check', { accountPresent: Boolean(account), online: navigator.onLine });
    if (this.account !== account) {
      this.account = account;
      this.registration = undefined;
      this.changes.next();
    }
    if (account) {
      this.send({ type: 'session', account_id: account });
    }
  }

  ready(registration: Registration): void {
    this.send({ ...registration, type: 'ready', version: '1' });
  }

  acknowledge(registration: Registration, delivery_id: string, status: 'handled' | 'discarded' | 'retry'): void {
    if (registration === this.registration) {
      this.send({ ...registration, type: 'acknowledge', delivery_id, status });
    }
  }

  logout(): Promise<void> | undefined {
    if (!this.bridge || !this.account) {
      return;
    }
    if (this.signingOut) {
      return this.logoutPending;
    }
    this.signingOut = true;
    this.registration = undefined;
    this.changes.next();
    this.logoutPending = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        logPushDebug('Timed out waiting for Android logout');
        this.signedOut?.();
      }, LOGOUT_TIMEOUT_MS);
      this.signedOut = () => {
        clearTimeout(timer);
        this.signedOut = undefined;
        resolve();
      };
      if (!this.send({ type: 'logout' })) {
        this.signedOut();
      }
    });
    return this.logoutPending;
  }

  private send(message: { type: string; [key: string]: unknown }): boolean {
    try {
      if (this.bridge) {
        this.bridge.postMessage(JSON.stringify(message));
        logPushDebug('Sent to Android', { type: message.type });
        return true;
      }
    } catch {
      // A WebView navigation can invalidate the bridge.
    }
    logPushDebug('Could not send to Android', { type: message.type });
    return false;
  }

  private receive(data: string): void {
    let message: BridgeResponse;
    try {
      message = JSON.parse(data);
    } catch {
      logPushDebug('Ignored malformed Android message');
      return;
    }
    switch (message?.type) {
      case 'registration':
        this.updateRegistration(message);
        break;
      case 'request':
        void this.request(message);
        break;
      case 'received':
      case 'tapped':
        logPushDebug('Delivery from Android', { type: message.type, signingOut: this.signingOut });
        if (!this.signingOut && message.detail) {
          this.deliveries.next(message);
        }
        break;
      case 'signed_out':
        logPushDebug('Android completed logout');
        this.signedOut?.();
        break;
      default:
        logPushDebug('Ignored unknown Android message type');
    }
  }

  private updateRegistration(message: Extract<BridgeResponse, { type: 'registration' }>): void {
    const account = this.getAccount?.();
    const binding = message.recipient_binding;
    const valid = !this.signingOut && account && message.account_id === account && isPushBinding(binding);
    logPushDebug('Registration from Android', {
      accepted: Boolean(valid), bindingPresent: isPushBinding(binding), matchesAccount: !!account &&
        message.account_id === account,
    });
    if (valid && this.registration?.account_id === account && this.registration.recipient_binding === binding) {
      return;
    }
    this.registration = valid ? { account_id: account, recipient_binding: binding } : undefined;
    this.changes.next();
  }

  private async request(message: Extract<BridgeResponse, { type: 'request' }>): Promise<void> {
    const bridge = this.bridge;
    const { id, operation, account_id, body } = message;
    if (typeof id !== 'string' || !['register', 'refresh', 'unregister'].includes(operation)) {
      logPushDebug('Ignored invalid registration request from Android');
      return;
    }
    const unregister = operation === 'unregister';
    const reply = (status: number, recipient_binding?: string) => {
      this.send({ type: 'result', id, status, recipient_binding });
    };
    if (!account_id || account_id !== this.account || account_id !== this.getAccount?.() ||
        (unregister ? !this.signedOut : this.signingOut)) {
      logPushDebug('Rejected registration request locally', { operation, status: 412 });
      reply(412);
      return;
    }

    const path = operation === 'register' ? REGISTRATIONS : REGISTRATIONS + '/' + operation;
    const started = performance.now();
    logPushDebug('Registration HTTP request started', { operation });
    let status: number;
    let binding: string | undefined;
    try {
      const response = await firstValueFrom(this.http.post<{ recipient_binding: string }>(path, body, {
        headers: { Accept: 'application/json', 'X-CHT-Push-Account': encodeURIComponent(account_id) },
        observe: 'response',
        timeout: unregister ? LOGOUT_TIMEOUT_MS - 500 : 8_000,
      }));
      status = response.status;
      binding = isPushBinding(response.body?.recipient_binding) ? response.body.recipient_binding : undefined;
    } catch (err) {
      status = err instanceof HttpErrorResponse ? err.status : 0;
    }
    logPushDebug('Registration HTTP request finished', {
      operation, status, bindingPresent: Boolean(binding), elapsedMs: Math.round(performance.now() - started),
    });
    if (this.bridge === bridge && this.account === account_id && this.getAccount?.() === account_id &&
        (unregister || !this.signingOut)) {
      reply(status, binding);
    }
  }
}
