import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import sinon from 'sinon';
import { expect } from 'chai';
import { FormsModule } from '@angular/forms';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { SendMessageComponent } from '@mm-modals/send-message/send-message.component';
import { SendMessageService } from '@mm-services/send-message.service';
import { Select2SearchService } from '@mm-services/select2-search.service';
import { FormatProvider } from '@mm-providers/format.provider';
import { SettingsService } from '@mm-services/settings.service';
import { ContactTypesService } from '@mm-services/contact-types.service';
import { ModalLayoutComponent } from '@mm-components/modal-layout/modal-layout.component';
import { PanelHeaderComponent } from '@mm-components/panel-header/panel-header.component';
import { DataMessagingHistoryService } from '@mm-services/data-messaging-history.service';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingStoreService } from '@mm-services/data-messaging-store.service';

describe('SendMessageComponent', () => {
  let component: SendMessageComponent;
  let fixture: ComponentFixture<SendMessageComponent>;
  let formatProvider;
  let settingsService;
  let contactTypesService;
  let matDialogRef;
  let sendMessageService;
  let select2SearchService;
  let dataHistory;
  let messaging;
  let dataStore;
  let dialogData: { allowDataMessages?: boolean; to?: string };

  beforeEach(() => {
    matDialogRef = { close: sinon.stub() };
    sendMessageService = { send: sinon.stub().resolves() };
    select2SearchService = { init: sinon.stub().resolves() };
    formatProvider = {};
    settingsService = { get: sinon.stub().resolves() };
    contactTypesService = { getAll: sinon.stub().resolves() };
    dataHistory = { changes: new Subject(), getDirectory: sinon.stub().resolves(null) };
    messaging = { compose: sinon.stub(), accountId: () => 'org.couchdb.user:sender' };
    dataStore = { submit: sinon.stub().resolves('waiting') };
    dialogData = {};

    return TestBed
      .configureTestingModule({
        imports: [
          FormsModule,
          TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
          SendMessageComponent,
          ModalLayoutComponent,
          PanelHeaderComponent,
        ],
        providers: [
          { provide: SendMessageService, useValue: sendMessageService },
          { provide: Select2SearchService, useValue: select2SearchService },
          { provide: FormatProvider, useValue: formatProvider },
          { provide: SettingsService, useValue: settingsService },
          { provide: ContactTypesService, useValue: contactTypesService },
          { provide: MatDialogRef, useValue: matDialogRef },
          { provide: MAT_DIALOG_DATA, useValue: dialogData },
          { provide: DataMessagingHistoryService, useValue: dataHistory },
          { provide: DataMessagingService, useValue: messaging },
          { provide: DataMessagingStoreService, useValue: dataStore },
        ]
      })
      .compileComponents()
      .then(() => {
        fixture = TestBed.createComponent(SendMessageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should create', () => {
    expect(component).to.exist;
  });

  it('should close modal', () => {
    component.close();

    expect(matDialogRef.close.calledOnce).to.be.true;
  });

  const render = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const openModal = async (enabled: boolean, data: typeof dialogData = { allowDataMessages: true }) => {
    fixture.destroy();
    Object.assign(dialogData, data);
    settingsService.get.resolves({ data_messaging: { enabled } });
    fixture = TestBed.createComponent(SendMessageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await render();
  };

  it('uses the phone picker to send an SMS when data messaging is disabled', async () => {
    await openModal(false);
    const phone = [{ id: '+12025550101', text: '+12025550101' }];
    const select2 = sinon.stub($.fn, 'select2').withArgs('data').returns(phone);
    component.messageInput = '  An SMS  ';
    await component.submit();
    await render();

    expect(select2.called).to.be.true;
    expect(sendMessageService.send.calledOnceWithExactly(phone, 'An SMS')).to.be.true;
    expect(dataStore.submit.called).to.be.false;
    expect(matDialogRef.close.calledOnceWithExactly()).to.be.true;
  });

  it('keeps the preselected phone recipient for SMS actions when data messaging is enabled', async () => {
    const to = '+12025550101';
    await openModal(true, { to });
    expect(fixture.nativeElement.querySelector('#send-message-channel')).to.equal(null);
    expect(fixture.nativeElement.querySelector('.message-form').hidden).to.be.false;
    expect(select2SearchService.init.lastCall.args[2].initialValue).to.equal(to);
    expect(dataHistory.getDirectory.called).to.be.false;
  });

  it('distinguishes a pending directory from a published empty list', async () => {
    await openModal(true);
    expect(fixture.nativeElement.textContent).to.include('messages.data.directory_pending');

    dataHistory.getDirectory.resolves([]);
    dataHistory.changes.next();
    await render();
    expect(fixture.nativeElement.textContent).to.include('messages.data.no_recipients');
    expect(fixture.nativeElement.textContent).not.to.include('messages.data.directory_pending');
  });

  it('disambiguates same-name accounts and sends to the selected account using the shared composer', async () => {
    const first = 'org.couchdb.user:first';
    const second = 'org.couchdb.user:second';
    const entry = { display_name: 'Alex', role_label: 'CHW', place_label: 'Clinic' };
    const text = 'From the Messages screen';
    const message = { recipient_id: second, sender_id: messaging.accountId(), text };
    dataHistory.getDirectory.resolves([
      { ...entry, account_id: first },
      { ...entry, account_id: second },
    ]);
    messaging.compose.returns(message);
    select2SearchService.init.resetHistory();
    await openModal(true);

    expect(fixture.nativeElement.querySelector('#send-message-channel')).to.equal(null);
    expect(fixture.nativeElement.querySelector('.message-form').hidden).to.be.true;
    expect(select2SearchService.init.called).to.be.false;
    expect(dataHistory.getDirectory.calledOnceWithExactly({ refreshOnline: true })).to.be.true;
    const selector = fixture.nativeElement.querySelector('#send-message-account');
    expect(Array.from<HTMLOptionElement>(selector.options).slice(1).map(option => option.text)).to.deep.equal([
      'Alex · CHW · Clinic (first)', 'Alex · CHW · Clinic (second)',
    ]);

    selector.value = second;
    selector.dispatchEvent(new Event('change'));
    await render();
    const draft = fixture.nativeElement.querySelector('#send-data-message-draft');
    draft.value = text;
    draft.dispatchEvent(new Event('input'));
    draft.form.dispatchEvent(new Event('submit', { cancelable: true }));
    await render();

    expect(dataStore.submit.calledOnceWithExactly(message)).to.be.true;
    expect(sendMessageService.send.called).to.be.false;
    expect(matDialogRef.close.calledOnceWithExactly(second)).to.be.true;
  });
});
