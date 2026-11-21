import { Injectable, OnDestroy } from '@angular/core';
import { IsActiveMatchOptions, NavigationEnd, Router } from '@angular/router';
import { fromEvent, Subscription } from 'rxjs';
import { validate as isUuid } from 'uuid';
import { PREFIXES } from '@medic/constants';

import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';

import { DataMessagingPushBridgeService, isPushBinding } from '@mm-services/data-messaging-push-bridge.service';
import { logPushDebug } from '@mm-services/data-messaging-push-debug';

const COALESCE_MS = 75;
const THREAD_MATCH: IsActiveMatchOptions = {
  paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored',
};

type TerminalStatus = 'handled' | 'discarded';
type Registration = { account_id: string; recipient_binding: string };
type PushSession = {
  registration: Registration;
  outcomes: Map<string, TerminalStatus>;
  taps: Set<string>;
  tapQueue: Promise<void>;
  pending: boolean;
  refreshing: boolean;
};

const isNonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
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
    private history: DataMessagingHistoryService,
    private bridge: DataMessagingPushBridgeService,
  ) {}

  init(): void {
    if (this.subscriptions.closed || this.initialized || !this.bridge.connect(() => this.messaging.accountId())) {
      return;
    }

    this.initialized = true;
    this.subscriptions.add(this.bridge.deliveries.subscribe(message => this.handle(message.type, message.detail)));
    this.subscriptions.add(this.bridge.changes.subscribe(() => this.resume()));
    this.subscriptions.add(fromEvent(window, 'online').subscribe(() => this.syncSession()));
    this.subscriptions.add(fromEvent(window, 'focus').subscribe(() => this.syncSession()));
    this.subscriptions.add(fromEvent(document, 'visibilitychange').subscribe(() => {
      if (document.visibilityState === 'visible') {
        this.syncSession();
      }
    }));
    this.subscriptions.add(this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.routerReady = true;
        this.syncSession();
      }
    }));
    this.routerReady = this.router.navigated;
    this.syncSession();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    if (this.initialized) {
      this.bridge.disconnect();
    }
    this.clearSession();
  }

  private clearSession(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current = undefined;
  }

  private updateSession(): PushSession | undefined {
    const registration = this.bridge.registration;
    if (!this.routerReady || !registration || registration.account_id !== this.messaging.accountId()) {
      logPushDebug('Waiting for a delivery session', {
        routerReady: this.routerReady, registrationPresent: Boolean(registration),
      });
      this.clearSession();
      return;
    }

    if (registration.account_id !== this.current?.registration.account_id ||
        registration.recipient_binding !== this.current.registration.recipient_binding) {
      this.clearSession();
      this.current = {
        registration, outcomes: new Map(), taps: new Set(), tapQueue: Promise.resolve(),
        pending: false, refreshing: false,
      };
      this.bridge.ready(registration);
    }
    return this.current;
  }

  private handle(type: 'received' | 'tapped', detail: Record<string, unknown>): void {
    const id = detail.delivery_id;
    if (!isNonempty(id)) {
      logPushDebug('Ignored delivery without an ID', { type });
      return;
    }
    const current = this.updateSession();
    const ack = (status: TerminalStatus) => {
      logPushDebug('Delivery outcome', { type, status, sessionPresent: Boolean(current) });
      if (current) {
        current.outcomes.set(id, status);
        this.bridge.acknowledge(current.registration, id, status);
      }
    };
    const previous = current?.outcomes.get(id);
    if (previous) {
      ack(previous);
      return;
    }
    if (detail.version !== '1' || detail.event !== 'data_message' || !isMessageId(detail.message_id) ||
        typeof detail.sender_account_id !== 'string' || !detail.sender_account_id.startsWith(PREFIXES.COUCH_USER) ||
        !detail.sender_account_id.slice(PREFIXES.COUCH_USER.length).trim() || !isNonempty(detail.sender_display_name) ||
        !isPushBinding(detail.recipient_binding)) {
      ack('discarded');
      return;
    }

    if (!current) {
      logPushDebug('Deferred delivery until the session is ready', { type });
      return;
    }
    if (detail.recipient_binding !== current.registration.recipient_binding) {
      ack('discarded');
      return;
    }
    if (type === 'tapped') {
      const sender = detail.sender_account_id;
      if (!current.taps.has(id)) {
        current.taps.add(id);
        current.tapQueue = current.tapQueue.then(async () => {
          const status = await this.openThread(current, sender);
          current.taps.delete(id);
          ack(status);
        });
      }
      return;
    }
    current.pending = true;
    this.schedule(current);
    ack('handled');
  }

  private async openThread(current: PushSession, sender: string): Promise<TerminalStatus> {
    try {
      if (this.current !== current || this.updateSession() !== current) {
        return 'discarded';
      }
      const segments = ['/messages', 'data:' + sender];
      const target = this.router.createUrlTree(segments);
      if (!this.router.isActive(target, THREAD_MATCH) && !await this.router.navigate(segments)) {
        return 'discarded';
      }
      if (this.current !== current || this.updateSession() !== current || !this.router.isActive(target, THREAD_MATCH)) {
        return 'discarded';
      }
      current.pending = true;
      this.schedule(current);
      return 'handled';
    } catch {
      return 'discarded';
    }
  }

  private syncSession(): void {
    this.bridge.syncSession();
    this.resume();
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
      await this.history.refreshFromServer(current.registration.account_id);
      succeeded = navigator.onLine;
    } catch {
      // A later resume or reconnect will retry the scoped refresh.
    } finally {
      logPushDebug('History refresh finished', { succeeded, online: navigator.onLine });
      current.refreshing = false;
      current.pending ||= !succeeded;
      if (succeeded && this.current === current && this.updateSession() === current) {
        this.schedule(current);
      }
    }
  }
}
