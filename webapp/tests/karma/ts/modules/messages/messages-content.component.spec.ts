import { ComponentFixture, fakeAsync, TestBed, tick, waitForAsync } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateFakeLoader, TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { provideMockStore } from '@ngrx/store/testing';
import sinon from 'sinon';
import { assert, expect } from 'chai';
import { Observable, Subject } from 'rxjs';

import { MessagesContentComponent } from '@mm-modules/messages/messages-content.component';
import { MessageContactService } from '@mm-services/message-contact.service';
import { SettingsService } from '@mm-services/settings.service';
import { ChangesService } from '@mm-services/changes.service';
import { SessionService } from '@mm-services/session.service';
import { LineageModelGeneratorService } from '@mm-services/lineage-model-generator.service';
import { MarkReadService } from '@mm-services/mark-read.service';
import { SendMessageService } from '@mm-services/send-message.service';
import { ModalService } from '@mm-services/modal.service';
import { ActivatedRoute } from '@angular/router';
import { MessagesActions } from '@mm-actions/messages';
import { SenderComponent } from '@mm-components/sender/sender.component';
import { PerformanceService } from '@mm-services/performance.service';
import { AuthDirective } from '@mm-directives/auth.directive';
import { AuthService } from '@mm-services/auth.service';
import { DataMessagingConversationsService } from '@mm-services/data-messaging-conversations.service';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingStoreService } from '@mm-services/data-messaging-store.service';

describe('MessagesContentComponent', () => {
  let component: MessagesContentComponent;
  let fixture: ComponentFixture<MessagesContentComponent>;
  let messageContactService;
  let changesService;
  let sessionService;
  let lineageModelGeneratorService;
  let markReadService;
  let sendMessageService;
  let modalService;
  let changesFilter;
  let changesCallback;
  let activatedRoute;
  let activatedRouteParams;
  let performanceService;
  let stopPerformanceTrackStub;
  let dataHistory;
  let dataConversations;

  beforeEach(waitForAsync(() => {
    stopPerformanceTrackStub = sinon.stub();
    performanceService = { track: sinon.stub().returns({ stop: stopPerformanceTrackStub }) };
    messageContactService = {
      getConversation: sinon.stub().resolves([]),
      isRelevantChange: sinon.stub()
    };
    changesService = {
      subscribe: sinon.stub().callsFake((opts) => {
        changesCallback = opts.callback;
        changesFilter = opts.filter;
        return { unsubscribe: sinon.stub() };
      })
    };
    sessionService = { userCtx: sinon.stub().returns({ name: 'Sarah' }), isOnlineOnly: sinon.stub().returns(false) };
    lineageModelGeneratorService = { contact: sinon.stub().resolves() };
    markReadService = { markAsRead: sinon.stub().resolves() };
    sendMessageService = { send: sinon.stub().resolves() };
    modalService = { show: sinon.stub() };
    dataHistory = { changes: new Subject(), refreshFromServer: sinon.stub().resolves() };
    dataConversations = { getConversations: sinon.stub().resolves([]) };
    const mockedSelectors = [
      { selector: 'getSelectedConversation', value: {} },
      { selector: 'getLoadingContent', value: false },
    ];
    activatedRoute = {
      params: new Observable(subscriber => activatedRouteParams = subscriber),
    };


    return TestBed
      .configureTestingModule({
        imports: [
          TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
          RouterTestingModule,
          FormsModule,
          CommonModule,
          MessagesContentComponent,
          SenderComponent,
          AuthDirective,
        ],
        providers: [
          provideMockStore({ selectors: mockedSelectors }),
          { provide: ChangesService, useValue: changesService },
          { provide: MessageContactService, useValue: messageContactService },
          { provide: SettingsService, useValue: {} }, // Needed because of ngx-translate provider's constructor.
          { provide: SessionService, useValue: sessionService },
          { provide: LineageModelGeneratorService, useValue: lineageModelGeneratorService },
          { provide: MarkReadService, useValue: markReadService },
          { provide: SendMessageService, useValue: sendMessageService },
          { provide: ModalService, useValue: modalService },
          { provide: ActivatedRoute, useValue: activatedRoute },
          { provide: PerformanceService, useValue: performanceService },
          { provide: AuthService, useValue: { has: sinon.stub().resolves(true) } },
          { provide: DataMessagingHistoryService, useValue: dataHistory },
          { provide: DataMessagingConversationsService, useValue: dataConversations },
          { provide: DataMessagingService, useValue: {} },
          { provide: DataMessagingStoreService, useValue: {} },
        ]
      })
      .compileComponents()
      .then(() => {
        fixture = TestBed.createComponent(MessagesContentComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
      });
  }));

  afterEach(() => {
    sinon.restore();
  });

  it('should create', () => {
    expect(component).to.exist;
  });

  it('renders a data message as plain text without SMS actions', () => {
    const text = '<b>Hello</b>\nHow are you?';
    component.selectedConversation = { messages: [{ doc: { type: 'data_message', text } }] };
    fixture.detectChanges();

    const body = fixture.debugElement.query(By.css('[test-id="data-message-content"]'));
    expect(body.nativeElement.textContent).to.equal(text);
    expect(body.nativeElement.children.length).to.equal(0);
    expect(fixture.debugElement.query(By.css('.task-state, .fa-trash-o, #message-footer'))).to.equal(null);
  });

  it('shows data message delivery states and lets the sender copy rejected text', () => {
    const copy = sinon.stub(TestBed.inject(Clipboard), 'copy').returns(true);
    const text = 'Text to send to another recipient';
    component.selectedConversation = { messages: [
      { doc: { _id: 'first', type: 'data_message', text: 'Pending' }, delivery: 'waiting' },
      { doc: { _id: 'second', type: 'data_message', text: 'Accepted' }, delivery: 'sent' },
      { doc: { _id: 'third', type: 'data_message', text }, delivery: 'recipient_ineligible' },
    ] };
    fixture.detectChanges();
    const statuses = fixture.debugElement.queryAll(By.css('.task-state'));
    expect(statuses.map(status => status.nativeElement.textContent.trim())).to.deep.equal([
      'messages.data.delivery.waiting', 'messages.data.delivery.sent', 'messages.data.delivery.recipient_ineligible',
    ]);
    fixture.debugElement.query(By.css('[data-id="third"] button')).nativeElement.click();
    expect(copy.calledOnceWithExactly(text)).to.equal(true);
  });

  it('updates the open conversation header and keeps legacy role labels readable', () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { 'role.supervisor': 'Supervisor' });
    translate.setTranslation('fr', { 'role.supervisor': 'Responsable', Clinic: 'Clinique', Alex: 'Alexandre' });
    translate.use('en');
    const recipient = { role_label: 'Supervisor', place_label: 'Clinic' };
    component.selectedConversation = {
      name: 'Alex', type: 'data', recipient,
      messages: [{ doc: { type: 'data_message', text: 'Hello' } }],
    };
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('#message-header');
    expect(header.querySelector('div').textContent).to.equal('Supervisor · Clinic');

    translate.use('fr');
    fixture.detectChanges();
    expect(header.querySelector('div').textContent).to.equal('Supervisor · Clinic');
    component.selectedConversation.recipient = {
      ...recipient, role_labels: [{ key: 'role.supervisor', fallback: 'Supervisor' }],
    };
    fixture.detectChanges();
    expect(header.querySelector('div').textContent).to.equal('Responsable · Clinic');
    expect(header.querySelector('strong').textContent).to.equal('Alex');
    translate.use('en');
    fixture.detectChanges();
    expect(header.querySelector('div').textContent).to.equal('Supervisor · Clinic');
  });

  it('opens data routes by full account ID, marks incoming messages read and shows reassignment', fakeAsync(() => {
    const id = 'org.couchdb.user:supervisor';
    const ownId = 'org.couchdb.user:Sarah';
    const incoming = { _id: 'data-message:first', type: 'data_message', text: 'Hello', sender_id: id };
    const outgoing = { _id: 'data-message:second', type: 'data_message', text: 'Reply', sender_id: ownId };
    const thread = { id, type: 'data', name: 'Supervisor', recipient: { account_id: id }, messages: [
      { id: incoming._id, doc: incoming, outgoing: false, read: false },
      { id: outgoing._id, doc: outgoing, outgoing: true, read: true },
    ] };
    dataConversations.getConversations.resolves([thread]);
    const setSelected = sinon.spy(MessagesActions.prototype, 'setSelectedConversation');

    activatedRouteParams.next({ type_id: 'data:' + id });
    tick();
    expect(setSelected.lastCall.args[0]).to.equal(thread);
    expect(markReadService.markAsRead.firstCall.args[0]).to.deep.equal([incoming]);
    expect(messageContactService.getConversation.called).to.be.false;
    expect(changesFilter({ deleted: true })).to.be.false;
    component.selectedConversation = thread;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.incoming [test-id="data-message-content"]').textContent)
      .to.equal('Hello');
    expect(fixture.nativeElement.querySelector('.outgoing [test-id="data-message-content"]').textContent)
      .to.equal('Reply');
    expect(fixture.nativeElement.querySelector('#data-message-draft').disabled).to.be.false;

    const downloaded = { ...incoming, _id: 'data-message:third', text: 'Another message' };
    tick();
    const draft = fixture.nativeElement.querySelector('#data-message-draft');
    draft.value = 'Unsent reply';
    draft.dispatchEvent(new Event('input'));
    const refreshed = { ...thread, messages: [
      { ...thread.messages[0], read: true }, thread.messages[1],
      { id: downloaded._id, doc: downloaded, outgoing: false, read: false },
    ] };
    dataConversations.getConversations.resolves([refreshed]);
    dataHistory.changes.next();
    tick(100);
    expect(setSelected.lastCall.args[0]).to.equal(refreshed);
    component.selectedConversation = refreshed;
    fixture.detectChanges();
    tick();
    expect(fixture.nativeElement.querySelector('#data-message-draft')).to.equal(draft);
    expect(draft.value).to.equal('Unsent reply');
    expect(markReadService.markAsRead.lastCall.args[0]).to.deep.equal([downloaded]);

    const archived = { ...refreshed, name: id, recipient: undefined,
      messages: refreshed.messages.map(message => ({ ...message, read: true })) };
    dataConversations.getConversations.resolves([archived]);
    dataHistory.changes.next();
    tick(100);
    expect(setSelected.lastCall.args[0]).to.equal(archived);
    component.selectedConversation = archived;
    fixture.detectChanges();
    tick();
    expect(fixture.nativeElement.querySelector('#message-header').textContent).to.include(id);
    expect(fixture.nativeElement.querySelector('#data-message-draft').disabled).to.be.true;
    expect(fixture.nativeElement.querySelector('[data-id="data-message:third"]').textContent)
      .to.include('Another message');
    expect(markReadService.markAsRead.callCount).to.equal(2);
    expect(markReadService.markAsRead.lastCall.args[0]).to.deep.equal([downloaded]);
  }));

  it('shows a retry for empty offline history and marks only the opened thread read', fakeAsync(() => {
    let online = false;
    sinon.stub(navigator, 'onLine').get(() => online);
    const id = 'org.couchdb.user:clinic:alice';
    const ownId = 'org.couchdb.user:recipient';
    const other = 'org.couchdb.user:zone:bob';
    const first = { _id: 'data-message:alice', type: 'data_message', sender_id: id, recipient_id: ownId, text: 'Hi' };
    const second = { ...first, _id: 'data-message:bob', sender_id: other };
    const setSelected = sinon.spy(MessagesActions.prototype, 'setSelectedConversation');
    activatedRouteParams.next({ type_id: 'data:' + id });
    tick();
    expect(dataConversations.getConversations.lastCall.args).to.deep.equal([{
      loadOnline: false, loadReadMarkers: true,
    }]);
    component.selectedConversation = setSelected.lastCall.args[0];
    fixture.detectChanges();
    const retry = fixture.nativeElement.querySelector('.empty-selection button');
    expect(retry).to.exist;

    online = true;
    const thread = (sender, doc) => ({ id: sender, type: 'data', messages: [{ id: doc._id, doc, read: false }] });
    dataConversations.getConversations.resolves([thread(id, first), thread(other, second)]);
    retry.click();
    tick();
    expect(dataHistory.refreshFromServer.calledOnce).to.be.true;
    expect(setSelected.lastCall.args[0].id).to.equal(id);
    expect(markReadService.markAsRead.args).to.deep.equal([[[first]]]);
  }));

  it('renders cached history while offline and defers dashboard read markers', fakeAsync(() => {
    sinon.stub(navigator, 'onLine').get(() => false);
    sessionService.isOnlineOnly.returns(true);
    const id = 'org.couchdb.user:clinic:alice';
    const doc = {
      _id: 'data-message:cached', type: 'data_message', sender_id: id, text: 'Cached message',
    };
    const thread = { id, type: 'data', messages: [{ id: doc._id, doc, read: false }] };
    dataConversations.getConversations.resolves([thread]);
    const setSelected = sinon.spy(MessagesActions.prototype, 'setSelectedConversation');
    activatedRouteParams.next({ type_id: 'data:' + id });
    tick();
    expect(dataConversations.getConversations.lastCall.args).to.deep.equal([{
      loadOnline: false, loadReadMarkers: false,
    }]);
    expect(setSelected.lastCall.args[0]).to.equal(thread);
    expect(markReadService.markAsRead.called).to.be.false;
  }));

  it('keeps the requested account thread selected when an older request completes', fakeAsync(() => {
    const first = 'org.couchdb.user:first';
    const second = 'org.couchdb.user:second';
    let resolveObsolete!: (threads: unknown[]) => void;
    const obsolete = new Promise(resolve => resolveObsolete = resolve);
    const setSelected = sinon.spy(MessagesActions.prototype, 'setSelectedConversation');
    const setError = sinon.spy(MessagesActions.prototype, 'setMessagesError');

    dataConversations.getConversations.returns(obsolete);
    activatedRouteParams.next({ type_id: 'data:' + first });

    dataConversations.getConversations.rejects(new Error('Unavailable'));
    activatedRouteParams.next({ type_id: 'data:' + second });
    tick();
    expect(setError.lastCall.args[0]).to.be.true;

    dataConversations.getConversations.resolves([]);
    dataHistory.changes.next();
    tick(100);
    expect(setSelected.lastCall.args[0]).to.deep.equal({ id: second, type: 'data', messages: [] });
    expect(setError.lastCall.args[0]).to.be.false;

    setSelected.resetHistory();
    resolveObsolete([{ id: first, name: 'First', messages: [] }]);
    tick();
    expect(setSelected.called).to.be.false;
    expect(markReadService.markAsRead.called).to.be.false;
  }));

  it('ngOnDestroy() should unsubscribe from observables', () => {
    const spySubscriptionsUnsubscribe = sinon.spy(component.subscriptions, 'unsubscribe');

    component.ngOnDestroy();

    expect(spySubscriptionsUnsubscribe.callCount).to.equal(1);
  });

  describe('Messages without contact', () => {
    it('should pull the contact phone number from the first message and show empty user name', async () => {
      const id = '12';
      const type = 'contact';
      const phone = '+12';
      const res = {
        doc: {
          tasks: [
            { messages: [ { to: phone, contact: { _id: id }} ] },
            { messages: [ { to: phone, contact: { _id: id }} ] }
          ]
        }
      };
      activatedRouteParams.next(`${type}:${id}`);
      lineageModelGeneratorService.contact.rejects({ code: 404 });
      messageContactService.getConversation.resolves([res]);
      const updateSelectedConversationSpy = sinon.spy(MessagesActions.prototype, 'updateSelectedConversation');

      await component.selectContact(id, type);

      expect(lineageModelGeneratorService.contact.callCount).to.equal(1);
      expect(lineageModelGeneratorService.contact.getCall(0).args[0]).to.equal(id);
      expect(messageContactService.getConversation.callCount).to.equal(1);
      expect(messageContactService.getConversation.getCall(0).args[0]).to.equal(id);
      expect(updateSelectedConversationSpy.callCount).to.equal(1);
      expect(updateSelectedConversationSpy.getCall(0).args[0].contact.doc.name).to.equal('');
      expect(updateSelectedConversationSpy.getCall(0).args[0].contact.doc.phone).to.equal(phone);
      expect(performanceService.track.calledOnce).to.be.true;
      expect(stopPerformanceTrackStub.calledOnce).to.be.true;
      expect(stopPerformanceTrackStub.args[0][0]).to.deep.equal({
        name: 'messages_detail:load',
        recordApdex: true,
      });
    });

    it('should not fail when no contact and no conversation', () => {
      const id = '12';
      const type = 'contact';
      activatedRouteParams.next(`${type}:${id}`);
      lineageModelGeneratorService.contact.rejects({ code: 404 });
      messageContactService.getConversation.resolves([]);
      const updateSelectedConversationSpy = sinon.spy(MessagesActions.prototype, 'updateSelectedConversation');

      return component
        .selectContact(id, type)!
        .then(() => {
          expect(lineageModelGeneratorService.contact.callCount).to.equal(1);
          expect(lineageModelGeneratorService.contact.getCall(0).args[0]).to.equal(id);
          expect(messageContactService.getConversation.callCount).to.equal(1);
          expect(messageContactService.getConversation.getCall(0).args[0]).to.equal(id);
          expect(updateSelectedConversationSpy.callCount).to.equal(1);
          expect(updateSelectedConversationSpy.args[0][0]).to.deep.include({ contact: undefined, messages: [] });
        })
        .catch(() => assert.fail('Should not fail'));
    });
  });

  describe('Watching changesService.subscribe', () => {
    it('should start watching changesService.subscribe', () => {
      component.ngOnInit();

      expect(changesService.subscribe.callCount).to.equal(2);
      expect(changesService.subscribe.args[0][0].key).to.equal('messages-content');
      expect(changesService.subscribe.args[0][0].callback).to.be.a('function');
      expect(changesService.subscribe.args[0][0].filter).to.be.a('function');
      expect(sessionService.userCtx.callCount).to.equal(2);
    });

    it('should filter relevant changesService.subscribe', () => {
      const change = { id: 'id' };
      const change2 = { id: 'id' };
      const selectedConversation = {
        contact: { name: 'peter' },
        messages: [
          { id: 'message1' },
          { id: 'message2' },
          { id: 'message3' }
        ]
      };
      component.selectedConversation = selectedConversation;

      messageContactService.isRelevantChange.returns(false);
      expect(!!changesFilter(change)).to.equal(false);
      expect(messageContactService.isRelevantChange.callCount).to.deep.equal(1);
      expect(messageContactService.isRelevantChange.args[0]).to.deep.equal([change, selectedConversation]);
      messageContactService.isRelevantChange.returns(true);
      expect(!!changesFilter(change2)).to.equal(true);
      expect(messageContactService.isRelevantChange.callCount).to.deep.equal(2);
      expect(messageContactService.isRelevantChange.args[1]).to.deep.equal([change2, selectedConversation]);
    });
  });

  describe('Update Conversation', () => {
    it('should not do anything when no conversation is selected', () => {
      component.selectedConversation = null;
      const change = { id: 'id', deleted: true };

      component.ngOnInit();

      expect(messageContactService.getConversation.callCount).to.equal(0);
      changesCallback(change);
      expect(messageContactService.getConversation.callCount).to.equal(0);
    });

    it('should update the conversation when conversation is selected', async () => {
      const change = { id: 'message3' };
      const contact = { name: 'contact', _id: 'c1' };
      const messages = [ { doc: { _id: 'message1' } }, { doc: { _id: 'message2' } } ];
      lineageModelGeneratorService.contact.resolves(contact);
      const updateSelectedConversationSpy = sinon.spy(MessagesActions.prototype, 'updateSelectedConversation');
      messageContactService.getConversation.resolves([...messages, { doc: { _id: 'message3' } }]);
      component.selectedConversation = { contact, messages, id: contact._id };
      activatedRouteParams.next('contact:c1');

      await changesCallback(change);

      expect(messageContactService.getConversation.callCount).to.equal(1);
      expect(messageContactService.getConversation.args[0]).to.deep.equal(['c1', undefined, messages.length]);
      expect(updateSelectedConversationSpy.callCount).to.equal(1);
      expect(updateSelectedConversationSpy.args[0]).to.deep.equal([
        { messages: [...messages, { doc: { _id: 'message3' } }] }
      ]);
    });

    it('should remove deleted messages from selected conversation', () => {
      const change = { id: 'message2', deleted: true };
      const contact = { name: 'contact', _id: 'c1' };
      const messages = [{ doc: { _id: 'message1' } }, { doc: { _id: 'message2' } } ];
      const updateSelectedConversationSpy = sinon.spy(MessagesActions.prototype, 'updateSelectedConversation');
      const removeMessageFromSelectedConversationSpy =
        sinon.spy(MessagesActions.prototype, 'removeMessageFromSelectedConversation');
      messageContactService.getConversation.resolves(messages);
      lineageModelGeneratorService.contact.resolves(contact);
      component.selectedConversation = { contact, messages, id: contact._id };
      activatedRouteParams.next('contact:c1');

      changesCallback(change);

      expect(messageContactService.getConversation.callCount).to.equal(0);
      expect(updateSelectedConversationSpy.callCount).to.equal(0);
      expect(removeMessageFromSelectedConversationSpy.callCount).to.equal(1);
      expect(removeMessageFromSelectedConversationSpy.args[0]).to.deep.equal(['message2']);
    });
  });

  describe('New message section', () => {
    it('should display the "new message" section in a conversation with a known recipient', async () => {
      component.selectedConversation = {
        id: '7aeaa4bc-ae5e-4964-8771-697209d2c6dd',
        messages: [
          { id: '68e4ae1a-bb6c-4561-98e7-3f7cdfd00486' }
        ],
        contact: {
          doc: { name: 'Groot' }
        }
      };

      fixture.detectChanges();
      await fixture.whenStable();

      const newMessageInput = fixture
        .debugElement
        .query(By.css('#message-footer textarea[name="message"]'))
        ?.nativeElement;
      expect(newMessageInput).to.not.be.undefined;

      const unknownContactMessage = fixture
        .debugElement
        .query(By.css('#unknown-contact-error-message'))
        ?.nativeElement;
      expect(unknownContactMessage).to.be.undefined;
    });

    it('should hide the "new message" section in a conversation with an unknown recipient', async () => {
      component.selectedConversation = {
        id: '52c1de4a-33dd-4d22-9916-24e7c77451f5',
        messages: [
          { id: '40b0678a-0f16-47cb-8591-fb3eab3b81d2' }
        ],
        contact: {
          doc: {
            name: ''
          }
        }
      };

      fixture.detectChanges();
      await fixture.whenStable();

      const unknownContactMessage = fixture
        .debugElement
        .query(By.css('#unknown-contact-error-message'))
        ?.nativeElement;
      expect(unknownContactMessage).to.not.be.undefined;

      const newMessageInput = fixture
        .debugElement
        .query(By.css('#message-footer textarea[name="message"]'))
        ?.nativeElement;
      expect(newMessageInput).to.be.undefined;
    });
  });
});

