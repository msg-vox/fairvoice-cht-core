import { expect } from 'chai';
import sinon from 'sinon';

import { AddReadStatusService } from '@mm-services/add-read-status.service';
import { DataMessagingConversationsService } from '@mm-services/data-messaging-conversations.service';
import { StoredDataMessage } from '@mm-services/data-messaging-store.service';

describe('DataMessagingConversationsService', () => {
  const accountId = 'org.couchdb.user:worker';
  const peer = 'org.couchdb.user:supervisor';
  const departed = 'org.couchdb.user:departed';
  const directory = [{ account_id: peer, display_name: 'Supervisor', role_label: 'Nurse', place_label: 'Clinic' }];
  const entry = (suffix: string, created_at: number, sender_id: string, recipient_id: string): StoredDataMessage => ({
    localId: 'local-' + suffix,
    message: { _id: 'data-message:' + suffix, type: 'data_message', created_at, sender_id, recipient_id, text: suffix },
  });
  let service: DataMessagingConversationsService;
  let history;
  let allDocs;

  beforeEach(() => {
    allDocs = sinon.stub().callsFake(({ keys }) => Promise.resolve({
      rows: keys.map(id => id === 'read:data_message:data-message:b' ? { value: {} } : { error: 'not_found' }),
    }));
    const readStatus = new AddReadStatusService({ get: () => ({ allDocs }) } as any);
    history = { read: sinon.stub().resolves({ accountId, directory, messages: [
      entry('b', 20, peer, accountId),
      { ...entry('a', 20, accountId, peer), delivery: 'waiting' },
      entry('z', 10, peer, accountId),
      entry('departed', 30, departed, accountId),
      entry('unrelated', 40, departed, peer),
    ] }) };
    service = new DataMessagingConversationsService(history, readStatus);
  });

  afterEach(() => sinon.restore());

  it('groups both directions by peer, sorts by time and ID, and reads markers for incoming messages', async () => {
    const [thread] = await service.getConversations();
    expect(thread).to.include({ id: peer, name: 'Supervisor', type: 'data', recipient: directory[0] });
    expect(thread.messages.map(({ id, outgoing, read }) => [id, outgoing, read])).to.deep.equal([
      ['local-z', false, false],
      ['local-a', true, true],
      ['local-b', false, true],
    ]);
    expect(allDocs.firstCall.args[0].keys).to.deep.equal([
      'read:data_message:data-message:b', 'read:data_message:data-message:z', 'read:data_message:data-message:departed',
    ]);
    expect(await service.getUnreadCount()).to.equal(2);
    expect(history.read.lastCall.args).to.deep.equal([{ loadOnline: false }]);
  });

  it('keeps history for a departed recipient and excludes unrelated messages', async () => {
    const threads = await service.getConversations();
    expect(threads.map(({ id }) => id)).to.deep.equal([peer, departed]);
    expect(threads[1]).to.include({ name: departed, recipient: undefined });
    expect(threads[1].messages[0].doc.text).to.equal('departed');
  });
});
