import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { find as _find, isEqual as _isEqual, last as _last } from 'lodash-es';
import { combineLatest, debounceTime, fromEvent, merge, Subject, Subscription, take, timer } from 'rxjs';
import { DOC_TYPES } from '@medic/constants';
import { Store } from '@ngrx/store';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { MessageContactService } from '@mm-services/message-contact.service';
import { GlobalActions } from '@mm-actions/global';
import { MessagesActions } from '@mm-actions/messages';
import { Selectors } from '@mm-selectors/index';
import { ChangesService } from '@mm-services/changes.service';
import { ExportService } from '@mm-services/export.service';
import { ModalService } from '@mm-services/modal.service';
import { SendMessageComponent } from '@mm-modals/send-message/send-message.component';
import { ResponsiveService } from '@mm-services/responsive.service';
import { FastAction, FastActionButtonService } from '@mm-services/fast-action-button.service';
import { PerformanceService } from '@mm-services/performance.service';
import { ButtonType, FastActionButtonComponent } from '@mm-components/fast-action-button/fast-action-button.component';
import { ToolBarComponent } from '@mm-components/tool-bar/tool-bar.component';
import { LanguageSwitcherComponent } from '@mm-components/language-switcher/language-switcher.component';
import { MessagesMoreMenuComponent } from '@mm-modules/messages/messages-more-menu.component';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { LineagePipe } from '@mm-pipes/message.pipe';
import { RelativeDatePipe } from '@mm-pipes/date.pipe';
import {
  DATA_CONVERSATION,
  DataMessagingConversationsService,
} from '@mm-services/data-messaging-conversations.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingLabelsService } from '@mm-services/data-messaging-labels.service';
import { SessionService } from '@mm-services/session.service';

const DASHBOARD_REFRESH_INTERVAL = 30_000;

@Component({
  templateUrl: './messages.component.html',
  imports: [
    ToolBarComponent,
    MessagesMoreMenuComponent,
    NgIf,
    NgFor,
    NgClass,
    RouterLink,
    FastActionButtonComponent,
    RouterOutlet,
    TranslatePipe,
    LineagePipe,
    RelativeDatePipe,
    LanguageSwitcherComponent,
  ]
})
export class MessagesComponent implements OnInit, OnDestroy {
  private readonly globalActions: GlobalActions;
  private readonly messagesActions: MessagesActions;
  private destroyed = false;
  private dataConversations: Record<string, any>[] = [];
  private readonly dataReadChanges = new Subject<void>();
  private dataRequest = 0;
  private initialDataSelectionPending = true;
  readonly buttonType = ButtonType;
  readonly dataConversationType = DATA_CONVERSATION;

  subscriptions: Subscription = new Subscription();
  fastActionList?: FastAction[];
  loading = true;
  loadingContent = false;
  conversations: Record<string, any>[] = [];
  error = false;
  dataError = false;
  trackPerformance;

  constructor(
    private readonly router: Router,
    private readonly store: Store,
    private readonly changesService: ChangesService,
    private readonly fastActionButtonService: FastActionButtonService,
    private readonly messageContactService: MessageContactService,
    private readonly exportService: ExportService,
    private readonly modalService: ModalService,
    private readonly responsiveService: ResponsiveService,
    private readonly performanceService: PerformanceService,
    private readonly dataHistory: DataMessagingHistoryService,
    private readonly dataMessagingConversations: DataMessagingConversationsService,
    private readonly ngZone: NgZone,
    private readonly sessionService: SessionService,
    protected readonly dataMessagingLabels: DataMessagingLabelsService,
  ) {
    this.globalActions = new GlobalActions(store);
    this.messagesActions = new MessagesActions(store);
  }

  ngOnInit() {
    this.trackPerformance = this.performanceService.track();
    this.subscribeToStore();
    this.updateConversations().then(() => this.displayFirstConversation(this.conversations));
    this.watchForChanges();
    this.watchDataConversations();
    void this.updateDataConversations();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.subscriptions.unsubscribe();
    this.globalActions.unsetSelected();
    this.messagesActions.setConversations([]);
  }

  private subscribeToStore() {
    const assignments$ = combineLatest([
      this.store.select(Selectors.getLoadingContent),
      this.store.select(Selectors.getMessagesError),
    ]).subscribe(([
      loadingContent,
      error,
    ]) => {
      this.loadingContent = loadingContent;
      this.error = error;
    });
    this.subscriptions.add(assignments$);

    const conversations$ = combineLatest([
      this.store.select(Selectors.getConversations),
      this.store.select(Selectors.getSelectedConversation),
    ]).subscribe(([
      conversations = [],
      selectedConversation,
    ]) => {
      // Make new reference because the one from store is read-only. Fixes: ExpressionChangedAfterItHasBeenCheckedError
      this.conversations = conversations.map(conversation => {
        const sameChannel = (conversation.type === DATA_CONVERSATION) ===
          (selectedConversation?.type === DATA_CONVERSATION);
        return { ...conversation, selected: sameChannel && conversation.key === selectedConversation?.id };
      });
    });
    this.subscriptions.add(conversations$);
  }

  private displayFirstConversation(conversations: Record<string, any>[] = []) {
    if (this.responsiveService.isMobile()) {
      return;
    }

    const parts = this.router.url.split('/');
    const lastPart = parts[parts.length - 1];
    const [type, id] = lastPart ? lastPart.split(':') : [];

    if ((!type || !id) && conversations.length) {
      this.router.navigate(['/messages', `${conversations[0].type}:${conversations[0].key}`]);
    }
  }

  private watchForChanges() {
    const subscription = this.changesService.subscribe({
      key: 'messages-list',
      callback: () => this.updateConversations({ merge: true }),
      filter: change => this.messageContactService.isRelevantChange(change),
    });
    this.subscriptions.add(subscription);
  }

  private watchDataConversations() {
    const updates = merge(this.dataHistory.changes, this.dataReadChanges).pipe(debounceTime(100));
    this.subscriptions.add(updates.subscribe(() => {
      void this.updateDataConversations();
    }));
    this.subscriptions.add(this.changesService.subscribe({
      metaDb: true,
      key: 'messages-data-read',
      filter: change => change.id?.startsWith(`read:${DOC_TYPES.DATA_MESSAGE}:`),
      callback: () => this.dataReadChanges.next(),
    }));
    if (!this.sessionService.isOnlineOnly()) {
      return;
    }
    this.ngZone.runOutsideAngular(() => {
      this.subscriptions.add(merge(timer(0, DASHBOARD_REFRESH_INTERVAL), fromEvent(window, 'online')).subscribe(() => {
        this.ngZone.run(() => void this.dataHistory.refreshOnline().catch(() => {}));
      }));
    });
  }

  private async updateDataConversations() {
    const request = ++this.dataRequest;
    try {
      const threads = await this.dataMessagingConversations.getConversations();
      if (this.destroyed || request !== this.dataRequest) {
        return;
      }
      this.dataError = false;
      this.dataConversations = threads.map(thread => {
        const last = _last(thread.messages)!;
        return {
          key: thread.id,
          type: thread.type,
          contact: thread.name,
          message: last.doc.text,
          date: last.doc.created_at,
          read: thread.messages.every(message => message.read),
          recipient: thread.recipient,
        };
      });
      const sms = this.conversations.filter(conversation => conversation.type !== DATA_CONVERSATION);
      const conversations = [...sms, ...this.dataConversations];
      this.messagesActions.setConversations(conversations);
      if (this.initialDataSelectionPending) {
        this.initialDataSelectionPending = false;
        if (!this.loading) {
          this.displayFirstConversation(conversations);
        }
      }
    } catch {
      if (!this.destroyed && request === this.dataRequest) {
        this.dataError = true;
      }
    }
  }

  private async updateFastActions() {
    if (this.destroyed) {
      // Don't update the fast actions, if the component has already been destroyed
      // This callback can be queued up and persist even after component destruction
      return;
    }

    this.fastActionList = await this.fastActionButtonService.getMessageActions({
      callbackOpenSendMessage: () => {
        const modal = this.modalService.show(SendMessageComponent, { data: { allowDataMessages: true } });
        const closed = modal.afterClosed().pipe(take(1)).subscribe((recipientId: string | string[] | undefined) => {
          if (Array.isArray(recipientId)) {
            void this.router.navigate(['/messages']);
          } else if (recipientId) {
            void this.router.navigate(['/messages', `${DATA_CONVERSATION}:${recipientId}`]);
          }
        });
        this.subscriptions.add(closed);
      },
    });
  }

  private setConversations(conversations: Record<string, any>[] = [], {merge = false} = {}) {
    if (merge) {
      const sms = this.conversations.filter(conversation => conversation.type !== DATA_CONVERSATION);
      this.removeDeleted(sms, conversations);
      this.mergeUpdated(sms, conversations);
      this.conversations = [...sms, ...this.dataConversations];
    }

    this.messagesActions.setConversations([...conversations, ...this.dataConversations]);
    this.updateFastActions();
    this.recordPerformance();
  }

  private async recordPerformance() {
    if (!this.trackPerformance) {
      return;
    }
    await this.trackPerformance.stop({ name: 'message_list:load', recordApdex: true });
    this.trackPerformance = null;
  }

  updateConversations({ merge = false } = {}) {
    return this.messageContactService
      .getList()
      .then(conversations => {
        this.setConversations(conversations, { merge });
        this.loading = false;
      });
  }

  private removeDeleted(
    currentConversations: Record<string, any>[] = [],
    updatedConversations: Record<string, any>[] = []
  ) {
    for (let i = currentConversations.length - 1; i >= 0; i--) {
      if (!updatedConversations.some(changed => currentConversations[i].key === changed.key)) {
        currentConversations.splice(i, 1);
      }
    }
  }

  private mergeUpdated(
    currentConversations: Record<string, any>[] = [],
    updatedConversations: Record<string, any>[] = []
  ) {
    updatedConversations.forEach(updated => {
      const match = _find(currentConversations, existing => existing.key === updated.key);

      if (match) {
        if (!_isEqual(updated.message, match.message)) {
          match.message = updated.message;
          match.read = false;
        }
      } else {
        currentConversations.push(updated);
      }
    });
  }

  listTrackBy(index, message) {
    if (message.type === DATA_CONVERSATION) {
      return `${DATA_CONVERSATION}:${message.key}`;
    }
    const identifier = message.doc ? message.doc._id + message.doc._rev : message.id;
    return message.key + identifier;
  }

  exportMessages() {
    this.exportService.export('messages', {}, { humanReadable: true });
  }
}
