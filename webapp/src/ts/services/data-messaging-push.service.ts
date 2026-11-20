import { Injectable, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { fromEvent, Subscription } from 'rxjs';
import { validate as isUuid } from 'uuid';
import { PREFIXES } from '@medic/constants';

import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingSyncService } from '@mm-services/data-messaging-sync.service';
import { SessionService } from '@mm-services/session.service';

const RECEIVED = 'cht:data-message:received';
const TAPPED = 'cht:data-message:tapped';
const REGISTRATION_CHANGED = 'cht:data-message:registration-changed';
const COALESCE_MS = 75;

type TerminalStatus = 'handled' | 'discarded';
type Registration = { account_id: string; recipient_binding: string };
type PushSession = {
  registration: Registration;
  outcomes: Map<string, TerminalStatus>;
  pending: boolean;
  refreshing: boolean;
};

const isNonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const isBinding = (value: unknown): value is string => typeof value === 'string' && /^[!-~]{1,128}$/.test(value);
const isMessageId = (id: unknown): boolean => typeof id === 'string' && id.startsWith(PREFIXES.DATA_MESSAGE) &&
  id === id.toLowerCase() && isUuid(id.slice(PREFIXES.DATA_MESSAGE.length));

@Injectable({ providedIn: 'root' })
export class DataMessagingPushService implements OnDestroy {
  private readonly subscriptions = new Subscription();
  private current?: PushSession;
  private timer?: ReturnType<typeof setTimeout>;
  private routerReady = false;
  private initialized = false;

  constructor(
    private router: Router,
    private messaging: DataMessagingService,
    private sync: DataMessagingSyncService,
    private history: DataMessagingHistoryService,
    private session: SessionService,
  ) {}

  init(): void {
    const bridge = window.medicmobile_android;
    if (!bridge || this.subscriptions.closed || this.initialized ||
        typeof bridge.getDataMessagePushRegistration !== 'function' ||
        typeof bridge.dataMessagePushReady !== 'function' || typeof bridge.ackDataMessagePush !== 'function') {
      return;
    }

    this.initialized = true;
    this.subscriptions.add(fromEvent(window, RECEIVED).subscribe(event => this.handle(event as CustomEvent)));
    this.subscriptions.add(fromEvent(window, TAPPED).subscribe(event => this.handle(event as CustomEvent)));
    this.subscriptions.add(fromEvent(window, REGISTRATION_CHANGED).subscribe(() => this.resume()));
    this.subscriptions.add(fromEvent(window, 'online').subscribe(() => this.resume()));
    this.subscriptions.add(fromEvent(window, 'focus').subscribe(() => this.resume()));
    this.subscriptions.add(fromEvent(document, 'visibilitychange').subscribe(() => {
      if (document.visibilityState === 'visible') {
        this.resume();
      }
    }));
    this.subscriptions.add(this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.routerReady = true;
        this.resume();
      }
    }));
    this.routerReady = this.router.navigated;
    this.resume();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.clearSession();
  }

  private clearSession(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current = undefined;
  }

  private getRegistration(): Registration | undefined {
    try {
      const registration = JSON.parse(window.medicmobile_android?.getDataMessagePushRegistration()) as Registration;
      if (isNonempty(registration?.account_id) && registration.account_id === this.messaging.accountId() &&
          isBinding(registration.recipient_binding)) {
        return registration;
      }
    } catch {
      // The bridge can be between sign-in associations or removed during navigation.
    }
  }

  private updateSession(): PushSession | undefined {
    const registration = this.routerReady ? this.getRegistration() : undefined;
    if (!registration) {
      this.clearSession();
      return;
    }

    if (registration.account_id !== this.current?.registration.account_id ||
        registration.recipient_binding !== this.current.registration.recipient_binding) {
      this.clearSession();
      this.current = { registration, outcomes: new Map(), pending: false, refreshing: false };
      window.medicmobile_android.dataMessagePushReady('1');
    }
    return this.current;
  }

  private handle(event: CustomEvent): void {
    const detail = event.detail;
    if (!isNonempty(detail?.delivery_id)) {
      return;
    }
    const current = this.updateSession();
    const ack = (status: TerminalStatus | 'retry') => {
      if (status !== 'retry') {
        current?.outcomes.set(detail.delivery_id, status);
      }
      window.medicmobile_android?.ackDataMessagePush(detail.delivery_id, status);
    };
    const previous = current?.outcomes.get(detail.delivery_id);
    if (previous) {
      ack(previous);
      return;
    }
    if (detail.version !== '1' || detail.event !== 'data_message' || !isMessageId(detail.message_id) ||
        typeof detail.sender_account_id !== 'string' || !detail.sender_account_id.startsWith(PREFIXES.COUCH_USER) ||
        !detail.sender_account_id.slice(PREFIXES.COUCH_USER.length).trim() || !isNonempty(detail.sender_display_name) ||
        !isBinding(detail.recipient_binding)) {
      ack('discarded');
      return;
    }

    if (!current) {
      ack('retry');
      return;
    }
    if (detail.recipient_binding !== current.registration.recipient_binding) {
      ack('discarded');
      return;
    }
    if (event.type === TAPPED) {
      ack('retry');
      return;
    }
    current.pending = true;
    this.schedule(current);
    ack('handled');
  }

  private resume(): void {
    const current = this.updateSession();
    if (current) {
      this.schedule(current);
    }
  }

  private schedule(current: PushSession): void {
    if (!current.pending || current.refreshing || this.timer !== undefined || !navigator.onLine) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.updateSession() === current && navigator.onLine) {
        void this.refresh(current);
      }
    }, COALESCE_MS);
  }

  private async refresh(current: PushSession): Promise<void> {
    current.pending = false;
    current.refreshing = true;
    let succeeded = false;
    try {
      if (this.session.isOnlineOnly()) {
        await this.history.refreshOnline({ afterCurrent: true });
      } else {
        await this.sync.requestSync(() => navigator.onLine, current.registration.account_id);
      }
      succeeded = navigator.onLine;
    } catch {
      // A later resume or reconnect will retry the scoped refresh.
    } finally {
      current.refreshing = false;
      current.pending ||= !succeeded;
      if (succeeded && this.current === current && this.updateSession() === current) {
        this.schedule(current);
      }
    }
  }
}
