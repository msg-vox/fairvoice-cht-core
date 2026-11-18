import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { expect } from 'chai';
import sinon from 'sinon';
import { validate as isUuid } from 'uuid';
import { DataMessagingService } from '@mm-services/data-messaging.service';
import { SessionService } from '@mm-services/session.service';

describe('Data messaging service', () => {
  const recipientId = 'org.couchdb.user:recipient';
  const sendPath = '/api/v1/data-messaging/messages';
  let service: DataMessagingService;
  let httpMock: HttpTestingController;
  let userCtx: sinon.SinonStub;

  beforeEach(() => {
    userCtx = sinon.stub().returns({ name: 'sender' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { userCtx } },
      ],
    });
    service = TestBed.inject(DataMessagingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    sinon.restore();
  });

  it('composes a message with one prefixed UUID, the session sender and the original text', () => {
    const createdAt = 1741000000000;
    sinon.stub(Date, 'now').returns(createdAt);
    const text = '  <b>Hello</b> 😀\n';
    const message = service.compose(recipientId, text);
    expect(message._id).to.match(/^data-message:/);
    expect(isUuid(message._id.slice('data-message:'.length))).to.equal(true);
    expect(message).to.deep.equal({
      _id: message._id,
      type: 'data_message',
      sender_id: 'org.couchdb.user:sender',
      recipient_id: recipientId,
      text,
      created_at: createdAt,
    });
    expect(service.compose(recipientId, text)._id).to.not.equal(message._id);
  });

  it('rejects blanks and enforces the limit in Unicode code points', () => {
    expect(() => service.compose(recipientId, ' \t\n')).to.throw('Invalid data message text');
    expect(() => service.compose(recipientId, '😀'.repeat(4000) + ' ')).to.throw('Invalid data message text');
    expect(() => service.compose(recipientId, '😀'.repeat(3999) + 'ab')).to.throw('Invalid data message text');
    const atLimit = '😀'.repeat(4000);
    expect(service.compose(recipientId, atLimit).text).to.equal(atLimit);
  });

  it('requires a signed-in account to compose', () => {
    userCtx.returns(null);
    expect(() => service.compose(recipientId, 'Hello')).to.throw('A signed-in account is required');
  });

  it('submits the same composed body on each attempt and checks the acknowledged ID', async () => {
    const message = service.compose(recipientId, 'Hello');
    const first = service.send(message);
    const request = httpMock.expectOne({ method: 'POST', url: sendPath });
    expect(request.request.body).to.deep.equal(message);
    request.flush({ id: 'wrong-id' });
    await expect(first).to.be.rejectedWith('did not confirm the data message ID');

    const retry = service.send(message);
    const retryRequest = httpMock.expectOne({ method: 'POST', url: sendPath });
    expect(retryRequest.request.body).to.deep.equal(message);
    retryRequest.flush({ id: message._id });
    expect(await retry).to.deep.equal({ id: message._id });
  });

  it('reports a rejected outbox message and still uploads the next message', async () => {
    const stale = service.compose('org.couchdb.user:stale', 'Stale recipient');
    const current = service.compose(recipientId, 'Current recipient');
    const uploads = service.uploadOutbox([stale, current]);

    const first = uploads.next();
    const staleRequest = httpMock.expectOne(sendPath);
    expect(staleRequest.request.body).to.deep.equal(stale);
    staleRequest.flush({ code: 403 }, { status: 403, statusText: 'Forbidden' });
    const failed = await first;
    expect(failed.value).to.include({ id: stale._id, status: 'failed' });
    expect(failed.value).to.have.nested.property('error.status', 403);

    const second = uploads.next();
    const currentRequest = httpMock.expectOne(sendPath);
    expect(currentRequest.request.body).to.deep.equal(current);
    currentRequest.flush({ id: current._id }, { status: 201, statusText: 'Created' });
    expect((await second).value).to.deep.equal({ id: current._id, status: 'accepted' });
    expect((await uploads.next()).done).to.equal(true);
  });

  it('rejects a page that cannot advance the cursor', async () => {
    const next_since = '10-test';
    const result = service.getSyncPage(next_since);
    const request = httpMock.expectOne({ method: 'GET', url: '/api/v1/data-messaging/sync?since=10-test' });
    request.flush({
      account_id: 'org.couchdb.user:sender', directory: [], messages: [], has_more: true, next_since,
    });
    await expect(result).to.be.rejectedWith('Invalid messaging sync page');
  });

  it('rejects a downloaded message belonging to two other accounts', async () => {
    const result = service.getSyncPage();
    const request = httpMock.expectOne('/api/v1/data-messaging/sync');
    request.flush({
      account_id: 'org.couchdb.user:sender',
      directory: null,
      messages: [{
        _id: 'data-message:other', sender_id: 'org.couchdb.user:other', recipient_id: recipientId,
      }],
      has_more: false,
      next_since: '10-test',
    });
    await expect(result).to.be.rejectedWith('does not belong to the signed-in account');
  });
});
