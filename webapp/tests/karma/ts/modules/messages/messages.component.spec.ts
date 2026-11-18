import { ComponentFixture, fakeAsync, TestBed, tick, waitForAsync } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { expect } from 'chai';
import sinon from 'sinon';
import { of, Subject } from 'rxjs';

import { MessagesComponent } from '@mm-modules/messages/messages.component';
import { ChangesService } from '@mm-services/changes.service';
import { MessageContactService } from '@mm-services/message-contact.service';
import { RelativeDatePipe } from '@mm-pipes/date.pipe';
import { SettingsService } from '@mm-services/settings.service';
import { ModalService } from '@mm-services/modal.service';
import { NavigationComponent } from '@mm-components/navigation/navigation.component';
import { NavigationService } from '@mm-services/navigation.service';
import { FastActionButtonService } from '@mm-services/fast-action-button.service';
import { SendMessageComponent } from '@mm-modals/send-message/send-message.component';
import { MessagesMoreMenuComponent } from '@mm-modules/messages/messages-more-menu.component';
import { SessionService } from '@mm-services/session.service';
import { FastActionButtonComponent } from '@mm-components/fast-action-button/fast-action-button.component';
import { ToolBarComponent } from '@mm-components/tool-bar/tool-bar.component';
import { PerformanceService } from '@mm-services/performance.service';
import { ExportService } from '@mm-services/export.service';
import { AuthService } from '@mm-services/auth.service';
import { MessagesActions } from '@mm-actions/messages';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingConversationsService } from '@mm-services/data-messaging-conversations.service';
import { LanguagesService } from '@mm-services/languages.service';
import { LanguageService, SetLanguageService } from '@mm-services/language.service';

describe('Messages Component', () => {
  let component: MessagesComponent;
  let fixture: ComponentFixture<MessagesComponent>;
  let messageContactService;
  let changesService;
  let modalService;
  let fastActionButtonService;
  let authService;
  let sessionService;
  let performanceService;
  let stopPerformanceTrackStub;
  let dataHistory;
  let dataConversations;

  beforeEach(waitForAsync(() => {
    stopPerformanceTrackStub = sinon.stub();
    performanceService = { track: sinon.stub().returns({ stop: stopPerformanceTrackStub }) };
    modalService = { show: sinon.stub().returns({ afterClosed: () => of(undefined) }) };
    dataHistory = { changes: new Subject(), refreshOnline: sinon.stub().resolves() };
    dataConversations = { getConversations: sinon.stub().resolves([]) };
    messageContactService = {
      getList: sinon.stub().resolves([]),
      isRelevantChange: sinon.stub()
    };
    changesService = { subscribe: sinon.stub().returns({ unsubscribe: sinon.stub() }) };
    fastActionButtonService = {
      getMessageActions: sinon.stub(),
      getButtonTypeForContentList: sinon.stub(),
    };
    authService = {
      online: sinon.stub().returns(false),
      any: sinon.stub(),
      has: sinon.stub()
    };
    sessionService = { isAdmin: sinon.stub(), isOnlineOnly: sinon.stub().returns(false) };
    const mockedSelectors = [
      { selector: 'getSelectedConversation', value: {} },
      { selector: 'getLoadingContent', value: false },
      { selector: 'getMessagesError', value: false },
    ];

    return TestBed
      .configureTestingModule({
        imports: [
          TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
          RouterTestingModule,
          MatIconModule,
          MessagesComponent,
          RelativeDatePipe,
          NavigationComponent,
          MessagesMoreMenuComponent,
          FastActionButtonComponent,
          ToolBarComponent,
        ],
        providers: [
          provideMockStore({ selectors: mockedSelectors }),
          { provide: ChangesService, useValue: changesService },
          { provide: MessageContactService, useValue: messageContactService },
          { provide: SettingsService, useValue: {} }, // Needed because of ngx-translate provider's constructor.
          { provide: ExportService, useValue: {} },
          { provide: SessionService, useValue: sessionService },
          { provide: ModalService, useValue: modalService },
          { provide: NavigationService, useValue: {} },
          { provide: AuthService, useValue: authService },
          { provide: FastActionButtonService, useValue: fastActionButtonService },
          { provide: PerformanceService, useValue: performanceService },
          { provide: DataMessagingHistoryService, useValue: dataHistory },
          { provide: DataMessagingConversationsService, useValue: dataConversations },
          { provide: LanguagesService, useValue: { get: sinon.stub().resolves([]) } },
          { provide: LanguageService, useValue: { get: sinon.stub().resolves('en') } },
          { provide: SetLanguageService, useValue: {} },
          { provide: MatBottomSheet, useValue: { open: sinon.stub() } },
          { provide: MatDialog, useValue: { open: sinon.stub() } },
        ]
      })
      .compileComponents()
      .then(() => {
        fixture = TestBed.createComponent(MessagesComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
      });
  }));

  afterEach(() => {
    sinon.restore();
  });

  it('should create MessagesComponent', () => {
    expect(component).to.exist;
  });

  it('ngOnInit() should update conversations and watch for changes', () => {
    const spyUpdateConversations = sinon.spy(component, 'updateConversations');
    changesService.subscribe.reset();
    const spySubscriptionsAdd = sinon.spy(component.subscriptions, 'add');

    component.ngOnInit();

    expect(spyUpdateConversations.callCount).to.equal(1);
    expect(changesService.subscribe.callCount).to.equal(2);
    expect(spySubscriptionsAdd.callCount).to.equal(5);
    expect(performanceService.track.calledTwice).to.be.true;
    expect(stopPerformanceTrackStub.calledOnce).to.be.true;
    expect(stopPerformanceTrackStub.args[0][0]).to.deep.equal({ name: 'message_list:load', recordApdex: true });
  });

  it('listTrackBy() should return unique identifier', () => {
    const messageWithDoc = { key: '134', id: 'abc', doc: { _id: 'xyz', _rev: '567' } };
    const messageNoDoc = { key: '134', id: 'abc' };

    const resultWithDoc = component.listTrackBy(0, messageWithDoc);
    const resultNoDoc = component.listTrackBy(0, messageNoDoc);

    expect(resultWithDoc).to.equal('134xyz567');
    expect(resultNoDoc).to.equal('134abc');
  });

  it('refreshes data previews and unread state alongside SMS without sharing thread keys', fakeAsync(() => {
    sinon.stub(TestBed.inject(Router), 'navigate').resolves(true);
    const id = 'org.couchdb.user:peer';
    const sms = { key: id, type: 'contact', message: 'SMS', read: true, date: 1 };
    component.conversations = [sms];
    const incoming = { read: false, doc: { created_at: 2, text: 'Incoming' } };
    const outgoing = { read: true, doc: { created_at: 3, text: 'Reply' } };
    const thread = { id, type: 'data', name: 'Peer', messages: [incoming, outgoing] };
    const setConversations = sinon.spy(MessagesActions.prototype, 'setConversations');
    dataConversations.getConversations.resolves([thread]);

    dataHistory.changes.next();
    tick(100);
    const [smsRow, dataRow] = setConversations.lastCall.args[0];
    expect(smsRow).to.equal(sms);
    expect(dataRow).to.include({ key: id, type: 'data', message: 'Reply', date: 3, read: false });
    expect(component.listTrackBy(0, dataRow)).not.to.equal(component.listTrackBy(0, smsRow));

    incoming.read = true;
    const { filter, callback } = changesService.subscribe.secondCall.args[0];
    expect(filter({ id: 'read:message:message-id' })).to.be.false;
    expect(filter({ id: 'read:data_message:data-message:1' })).to.be.true;
    dataConversations.getConversations.resetHistory();
    callback();
    callback();
    tick(100);
    expect(dataConversations.getConversations.calledOnce).to.be.true;
    expect(setConversations.lastCall.args[0][1].read).to.be.true;
  }));

  it('ngOnDestroy() should unsubscribe from observables', () => {
    const spySubscriptionsUnsubscribe = sinon.spy(component.subscriptions, 'unsubscribe');

    component.ngOnDestroy();

    expect(spySubscriptionsUnsubscribe.callCount).to.equal(1);
  });

  it('should update fast actions', async () => {
    sinon.resetHistory();
    messageContactService.getList.resolves([
      { key: 'a', message: { inAllMessages: true } },
      { key: 'c', message: { inAllMessages: true } },
    ]);

    await component.updateConversations();

    expect(fastActionButtonService.getMessageActions.calledOnce).to.be.true;

    const params = fastActionButtonService.getMessageActions.args[0][0];
    params.callbackOpenSendMessage();
    expect(modalService.show.calledOnce).to.be.true;
    expect(modalService.show.args[0][0]).to.equal(SendMessageComponent);
    expect(modalService.show.args[0][1]).to.deep.equal({ data: { allowDataMessages: true } });
  });

  it('opens the account thread when the send modal reports a saved data message', async () => {
    const id = 'org.couchdb.user:peer';
    const navigate = sinon.stub(TestBed.inject(Router), 'navigate').resolves(true);
    modalService.show.returns({ afterClosed: () => of(id) });
    await component.updateConversations();
    fastActionButtonService.getMessageActions.lastCall.args[0].callbackOpenSendMessage();
    expect(navigate.calledOnceWithExactly(['/messages', 'data:' + id])).to.be.true;
  });

  describe('updateConversations()', () => {
    it('should get conversations and add new one', async () => {
      const newConversations = [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'c', message: { inAllMessages: true } },
        { key: 'b', message: { fromUpdatedMessages: true } }
      ];
      messageContactService.getList.reset();
      messageContactService.getList.resolves(newConversations);
      component.conversations = [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'c', message: { inAllMessages: true } }
      ];
      fixture.detectChanges();

      await component.updateConversations({ merge: true });

      expect(messageContactService.getList.callCount).to.equal(1);
      expect(component.loading).to.be.false;
      expect(component.conversations.length).to.equal(3);
      expect(component.conversations).to.eql(newConversations);
    });

    it('should get conversations and replace updated ones', async () => {
      const newConversations = [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'b', message: { fromUpdatedMessages: true } }
      ];
      messageContactService.getList.reset();
      messageContactService.getList.resolves(newConversations);
      const expectedConversations =  [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'b', message: { fromUpdatedMessages: true }, read: false }
      ];
      component.conversations = [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'b', message: { inAllMessages: true }, read: true }
      ];
      fixture.detectChanges();

      await component.updateConversations({ merge: true });

      expect(messageContactService.getList.callCount).to.equal(1);
      expect(component.loading).to.be.false;
      expect(component.conversations).to.eql( expectedConversations);
    });

    it('should get conversations and remove conversations that no longer exist', async () => {
      const newConversations = [
        { key: 'a', message: { updatedMessage: true }, read: false },
        { key: 'b', message: { updatedMessage: true }, read: false }
      ];
      messageContactService.getList.reset();
      messageContactService.getList.resolves(newConversations);
      component.conversations = [
        { key: 'a', message: { inAllMessages: true } },
        { key: 'b', message: { inAllMessages: true } },
        { key: 'c', message: { inAllMessages: true } },
        { key: 'd', message: { inAllMessages: true } },
      ];
      fixture.detectChanges();

      await component.updateConversations({ merge: true });

      expect(messageContactService.getList.callCount).to.equal(1);
      expect(component.loading).to.be.false;
      expect(component.conversations).to.eql( newConversations);
    });
  });

});

