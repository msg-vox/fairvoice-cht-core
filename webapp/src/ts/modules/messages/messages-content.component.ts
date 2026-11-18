import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component, NgZone,
  OnDestroy,
  OnInit
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { combineLatest, debounceTime, Subscription, take } from 'rxjs';
import { select, Store } from '@ngrx/store';
import { last as _last, minBy as _minBy } from 'lodash-es';
import { DOC_TYPES } from '@medic/constants';

import { GlobalActions } from '@mm-actions/global';
import { MessagesActions } from '@mm-actions/messages';
import { Selectors } from '@mm-selectors/index';
import { ChangesService } from '@mm-services/changes.service';
import { MessageContactService } from '@mm-services/message-contact.service';
import { SessionService } from '@mm-services/session.service';
import { LineageModelGeneratorService } from '@mm-services/lineage-model-generator.service';
import { MarkReadService } from '@mm-services/mark-read.service';
import { SendMessageService } from '@mm-services/send-message.service';
import { ModalService } from '@mm-services/modal.service';
import { SendMessageComponent } from '@mm-modals/send-message/send-message.component';
import { PerformanceService } from '@mm-services/performance.service';
import { NgIf, NgFor, NgClass, AsyncPipe } from '@angular/common';
import { SenderComponent } from '@mm-components/sender/sender.component';
import { AuthDirective } from '@mm-directives/auth.directive';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { AutoreplyPipe, StatePipe } from '@mm-pipes/date.pipe';
import { DataMessageComposerComponent } from './data-message-composer.component';
import {
  DATA_CONVERSATION,
  DataMessagingConversationsService,
} from '@mm-services/data-messaging-conversations.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';

/**
*  In this context the URL parameter "id", can be:
*    - the _id of the contact who is sending these messages
*    - the phone number if it couldn't be resolved into a contact
*    - the _id of the data_record if there is no discernible phone number
*    - the peer's full user account ID for a data conversation
*  This is determined by the URL parameter "type": 'contact', 'phone', 'unknown' or 'data' respectively.
*/
@Component({
  selector: 'messages-content',
  templateUrl: './messages-content.component.html',
  imports: [
    NgIf,
    SenderComponent,
    NgFor,
    NgClass,
    AuthDirective,
    FormsModule,
    ClipboardModule,
    DataMessageComposerComponent,
    AsyncPipe,
    TranslatePipe,
    AutoreplyPipe,
    StatePipe
  ]
})
export class MessagesContentComponent implements OnInit, OnDestroy, AfterViewInit, AfterViewChecked {
  readonly dataMessageType = DOC_TYPES.DATA_MESSAGE;
  readonly dataConversationType = DATA_CONVERSATION;
  private userCtx;
  private globalActions!: GlobalActions;
  private messagesActions!: MessagesActions;
  loadingContent;
  loadingMoreContent = false;
  selectedConversation;
  firstUnread;
  send = { message: '' };
  subscriptions: Subscription = new Subscription();
  textAreaFocused = false;
  isAddRecipientBtnActive = false;
  allLoaded = false;
  trackPerformance;

  private urlParameters = { type: '', id: '' };
  private hasToScroll = false;
  private checkScrollFnDef;
  private dataRequest = 0;

  constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private route: ActivatedRoute,
    private store: Store,
    private changesService: ChangesService,
    private messageContactService: MessageContactService,
    private sessionService: SessionService,
    private lineageModelGeneratorService: LineageModelGeneratorService,
    private markReadService: MarkReadService,
    private sendMessageService: SendMessageService,
    private modalService: ModalService,
    private performanceService: PerformanceService,
    private ngZone:NgZone,
    private dataHistory: DataMessagingHistoryService,
    private dataConversations: DataMessagingConversationsService,
  ) { }

  ngOnInit(): void {
    this.trackPerformance = this.performanceService.track();
    const selectorsSubscription = combineLatest(
      this.store.pipe(select(Selectors.getSelectedConversation)),
      this.store.pipe(select(Selectors.getLoadingContent)),
    ).subscribe(([selectedConversation, loadingContent]) => {
      this.selectedConversation = selectedConversation;
      this.loadingContent = loadingContent;
    });
    this.subscriptions.add(selectorsSubscription);

    this.globalActions = new GlobalActions(this.store);
    this.messagesActions = new MessagesActions(this.store);
    this.userCtx = this.sessionService.userCtx();
    this.watchForChanges();
    this.subscriptions.add(this.dataHistory.changes.pipe(debounceTime(100)).subscribe(() => {
      if (this.urlParameters.type === DATA_CONVERSATION) {
        void this.refreshDataConversation(this.urlParameters.id);
      }
    }));
  }

  ngAfterViewInit(): void {
    const routeSubscription = this.route.params.subscribe((params) => {
      const path = params.type_id || '';
      const separator = path.indexOf(':');
      const type = separator < 0 ? '' : path.slice(0, separator);
      const id = separator < 0 ? '' : path.slice(separator + 1);
      this.urlParameters.type = type;
      this.urlParameters.id = id;
      this.dataRequest++;
      this.send.message = '';
      this.firstUnread = null;
      this.hasToScroll = false;
      this.allLoaded = false;
      this.loadingMoreContent = false;
      if (type === DATA_CONVERSATION && id) {
        $('.message-content-wrapper').off('scroll', this.checkScrollFnDef);
        this.messagesActions.setSelected({ id, type, messages: [] }, false);
        this.globalActions.setLoadingShowContent(id);
        void this.refreshDataConversation(id, true);
      } else {
        this.selectContact(id, type);
      }
      this.changeDetectorRef.detectChanges();
    });
    this.subscriptions.add(routeSubscription);

    this.ngZone.runOutsideAngular(() => {
      $('body')
        .on('focus', '#message-footer textarea', () => {
          this.ngZone.run(() => this.textAreaFocused = true);
        })
        .on('blur', '#message-footer textarea', () => {
          if (!this.isAddRecipientBtnActive) {
            this.ngZone.run(() => this.textAreaFocused = false);
          }
        });
    });
  }

  ngAfterViewChecked(): void {
    const lastMessage = $('.message-content-wrapper .last-message');
    // Scrolling only when last message is rendered.
    if (this.hasToScroll && !this.loadingContent && lastMessage.length) {
      // ToDo: Determine when the view has finished rendering and scroll to unread messages.
      this.ngZone.runOutsideAngular(() => {
        setTimeout(() => this.scrollToUnread());
      });
    }
  }

  ngOnDestroy(): void {
    this.dataRequest++;
    this.subscriptions.unsubscribe();
    $('body').off('focus', '#message-footer textarea');
    $('body').off('blur', '#message-footer textarea');
  }

  listTrackBy(index, message) {
    if (message.doc?.type === DOC_TYPES.DATA_MESSAGE) {
      return message.id || message.doc._id;
    }
    return message.doc ? message.doc._id + message.doc._rev : message.id;
  }

  private async refreshDataConversation(id: string, opening = false) {
    const request = ++this.dataRequest;
    try {
      const threads = await this.dataConversations.getConversations();
      if (request !== this.dataRequest) {
        return;
      }
      const thread = threads.find(thread => thread.id === id);
      const messages = thread?.messages || [];
      const unread = messages.filter(message => !message.read);
      const previous: { id: string; doc: { _id: string } }[] = this.selectedConversation?.messages || [];
      const newUnread = unread.find(message => !previous.some(existing => existing.id === message.id));
      if (opening || newUnread || _last(messages)?.doc._id !== _last(previous)?.doc?._id) {
        this.firstUnread = newUnread || unread[0];
        this.hasToScroll = true;
      }
      this.allLoaded = true;
      this.messagesActions.setSelectedConversation(thread || { id, type: DATA_CONVERSATION, messages });
      this.globalActions.setTitle(thread?.name || id);
      this.globalActions.setLoadingContent(false);
      this.messagesActions.setMessagesError(false);
      if (opening) {
        this.trackPerformance?.stop({ name: 'messages_detail:load', recordApdex: true });
      }
      if (unread.length) {
        this.markReadService.markAsRead(unread.map(message => message.doc))
          .catch(() => console.error('Error marking data messages as read'));
      }
    } catch {
      if (request === this.dataRequest) {
        this.globalActions.setLoadingContent(false);
        this.messagesActions.setMessagesError(true);
      }
    }
  }

  private checkScroll(elem) {
    if (elem && elem.scrollTop() === 0 && !this.allLoaded) {
      this.ngZone.run(() => {
        this.updateConversation({ skip: true });
      });
    }
  }

  private scrollToUnread() {
    const content = $('.message-content-wrapper');

    if (!content || !content.length) {
      return;
    }

    const markers = content.find('.marker');
    const scrollTo = markers.length ? markers[0].offsetTop - 50 : content[0].scrollHeight;
    content.scrollTop(scrollTo);
    this.hasToScroll = false;

    this.checkScrollFnDef = () => this.checkScroll(content);
    $('.message-content-wrapper').off('scroll', this.checkScrollFnDef);
    $('.message-content-wrapper').on('scroll', this.checkScrollFnDef);
  }

  // See URL parameter "id" note at top of file
  private getContactable(id, type) {
    if (type === 'contact') {
      return this.lineageModelGeneratorService
        .contact(id)
        .catch(err => {
          if (err.code === 404) {
            return;
          }
          throw err;
        });
    }

    if (type === 'phone') {
      return { name: id };
    }

    return {};
  }

  private markConversationReadIfNeeded() {
    if (!this.selectedConversation) {
      return;
    }

    const hasUnreadDoc = this.selectedConversation.messages.some(message => !message.read && message.doc);

    if (hasUnreadDoc) {
      const docs = this.selectedConversation.messages.map(message => message.doc);
      this.markReadService
        .markAsRead(docs)
        .then(() => {
          this.messagesActions.markSelectedConversationRead();
        })
        .catch(err => console.error('Error marking all as read', err));
    }
  }

  selectContact(id, type) {
    // See URL param "id" note at top of file.
    if (!id) {
      this.messagesActions.setMessagesError(false);
      this.globalActions.setLoadingContent(false);
      this.globalActions.unsetSelected();
      return;
    }

    $('.message-content-wrapper').off('scroll', this.checkScrollFnDef);
    const refreshSelected = this.selectedConversation && this.selectedConversation.id === id;
    this.messagesActions.setSelected({ id: id, messages: [] }, refreshSelected);
    this.globalActions.setLoadingShowContent(id);

    return Promise
      .all([
        this.getContactable(id, type),
        this.messageContactService.getConversation(id)
      ])
      .then(([contactModel, conversation]) => {
        if (!contactModel && conversation.length) {
          const firstTaskWithContact = conversation[0].doc?.tasks?.find((task) => {
            const message = task.messages && task.messages[0];
            return message && message.contact && message.contact._id === id;
          });

          const firstMessageWithContact = firstTaskWithContact?.messages?.find(message => message.contact._id === id);
          contactModel = {
            doc: {
              name: '',
              phone: firstMessageWithContact?.to
            }
          };
        }

        if (this.urlParameters.type === DATA_CONVERSATION ||
            (this.selectedConversation && this.selectedConversation.id !== id)) {
          // ignore response for previous request
          return;
        }

        this.globalActions.setLoadingShowContent(false);
        this.messagesActions.setMessagesError(false);
        const unread = conversation.filter(message => !message.read);
        this.firstUnread = _minBy(unread, (message:any) => message?.doc?.reported_date);
        this.messagesActions.updateSelectedConversation({ contact: contactModel, messages: conversation });
        this.globalActions.setTitle((contactModel && contactModel.doc && contactModel.doc.name) || id);
        this.markConversationReadIfNeeded();
        this.hasToScroll = true; // Indication to scroll to unread message.
        this.trackPerformance?.stop({ name: 'messages_detail:load', recordApdex: true });
      })
      .catch((err) => {
        if (this.urlParameters.type === DATA_CONVERSATION) {
          return;
        }
        this.globalActions.setLoadingContent(false);
        this.messagesActions.setMessagesError(true);
        console.error('Error fetching contact conversation', err);
      });
  }

  private updateConversation(options: any = {}) {
    const selectedId = this.selectedConversation && this.selectedConversation.id;

    if (!selectedId || this.urlParameters.type === DATA_CONVERSATION) {
      return;
    }

    if (options.change && options.change.deleted) {
      return this.messagesActions.removeMessageFromSelectedConversation(options.change.id);
    }

    const skip = options.skip && this.selectedConversation.messages.length;
    const limit = !options.skip && this.selectedConversation.messages.length;

    if (skip) {
      this.loadingMoreContent = true;
    }

    return this.messageContactService
      .getConversation(selectedId, skip, limit)
      .then((conversation) => {
        this.loadingMoreContent = false;
        if (this.urlParameters.type === DATA_CONVERSATION || this.selectedConversation?.id !== selectedId) {
          return;
        }

        const newMessageFromUser = conversation.find(message => (
          message.doc.sent_by === this.userCtx.name &&
          !this.selectedConversation.messages.find(existent => existent.id === message.id)
        ));

        this.messagesActions.updateSelectedConversation({ messages: conversation });

        if (options.skip) {
          this.allLoaded = conversation.length < this.messageContactService.minLimit;
          this.firstUnread = null;
        }

        const first = $('.item-content .body #message-content ul > li').filter(':first');
        this.markConversationReadIfNeeded();
        // ToDo: determine when view had finished rendering to the scrolling can be calculated correctly.
        this.ngZone.runOutsideAngular(() => {
          setTimeout(() => {
            let scroll:any = false;
            if (options.skip) {
              const spinnerHeight = 102;
              scroll = $('.message-content-wrapper li')[conversation.length].offsetTop - spinnerHeight;
            } else if (first.length && newMessageFromUser) {
              scroll = $('.message-content-wrapper')[0].scrollHeight;
            }

            if (scroll) {
              $('.message-content-wrapper').scrollTop(scroll);
            }
          });
        });
      })
      .catch(err => console.error('Error fetching contact conversation', err));
  }

  private watchForChanges() {
    const subscription = this.changesService.subscribe({
      key: 'messages-content',
      callback: change => this.updateConversation({ change }),
      filter: change => this.urlParameters.type !== DATA_CONVERSATION &&
        this.messageContactService.isRelevantChange(change, this.selectedConversation),
    });
    this.subscriptions.add(subscription);
  }

  sendMessage() {
    if (!this.send.message) {
      return;
    }

    if (!this.selectedConversation) {
      console.error('Error sending message', new Error('No facility selected'));
      return;
    }

    const recipient: Record<string, any> = { doc: null };

    if (this.selectedConversation.contact && this.selectedConversation.contact.doc) { // known contact
      recipient.doc = this.selectedConversation.contact.doc;
    } else { // unknown sender
      recipient.doc = { contact: { phone: this.selectedConversation.id } };
    }

    this.sendMessageService
      .send(recipient, this.send.message)
      .then(() => {
        this.send.message = '';
      })
      .catch(err => {
        console.error('Error sending message', err);
      });
  }

  deleteDoc(doc) {
    if (doc) {
      this.globalActions.deleteDocConfirm(doc);
    }
  }

  addRecipients() {
    const data = { to: this.selectedConversation.id, message: this.send.message };
    this.modalService
      .show(SendMessageComponent, { data })
      .afterClosed()
      .pipe(take(1))
      .subscribe(() => $('#message-footer textarea').focus());
    this.send.message = '';
  }

}
