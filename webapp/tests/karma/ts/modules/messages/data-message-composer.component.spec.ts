import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { expect } from 'chai';
import sinon from 'sinon';
import { DataMessageComposerComponent } from '@mm-modules/messages/data-message-composer.component';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingStoreService } from '@mm-services/data-messaging-store.service';

describe('Data message composer', () => {
  const sender_id = 'org.couchdb.user:sender';
  const recipient_id = 'org.couchdb.user:recipient';
  const text = 'Keep this draft until it is saved or accepted';
  const message = { _id: 'test-id', recipient_id, sender_id, text };
  let fixture: ComponentFixture<DataMessageComposerComponent>;
  let component: DataMessageComposerComponent;
  let submit: sinon.SinonStub;
  let compose: sinon.SinonStub;
  const feedback = (role: string) => fixture.nativeElement.querySelector(`[role="${role}"]`).textContent;

  beforeEach(() => {
    submit = sinon.stub();
    compose = sinon.stub().returns(message);
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: DataMessagingStoreService, useValue: { submit } },
        { provide: DataMessagingService, useValue: { compose, accountId: () => sender_id } },
      ],
    });
    fixture = TestBed.createComponent(DataMessageComposerComponent);
    fixture.componentRef.setInput('recipientId', recipient_id);
    component = fixture.componentInstance;
    component.draft = text;
    fixture.detectChanges();
  });

  afterEach(() => sinon.restore());

  it('keeps the draft until the offline save completes, then reports waiting to sync', async () => {
    let saved!: (result: string) => void;
    submit.returns(new Promise(resolve => saved = resolve));
    const pending = component.submit();
    expect(component.draft).to.equal(text);
    expect(component.sending).to.equal(true);
    saved('waiting');
    await pending;
    fixture.detectChanges();
    expect(component.draft).to.equal('');
    expect(feedback('status')).to.include('messages.data.delivery.waiting');
  });

  it('keeps an online draft on failure and reuses its message ID on an unchanged retry', async () => {
    submit.onFirstCall().rejects(new Error('Connection failed'));
    submit.onSecondCall().resolves('sent');
    await component.submit();
    fixture.detectChanges();
    expect(component.draft).to.equal(text);
    expect(feedback('alert')).to.include('messages.data.delivery.submit_error');

    await component.submit();
    fixture.detectChanges();
    expect(component.draft).to.equal('');
    expect(compose.calledOnceWithExactly(recipient_id, text)).to.equal(true);
    expect(submit.args).to.deep.equal([[message], [message]]);
    expect(feedback('status')).to.include('messages.data.delivery.sent');
  });
});
