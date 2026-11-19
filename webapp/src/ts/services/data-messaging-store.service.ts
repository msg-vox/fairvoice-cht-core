/* global PouchDB */
import { Injectable } from '@angular/core';
import { PREFIXES } from '@medic/constants';
import { Subject } from 'rxjs';
import { DataMessage, DataMessageRejection, DataMessagingService } from '@mm-services/data-messaging.service';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';

const OUTBOX_PREFIX = 'data-message-outbox:';

export type DataMessageDelivery = 'waiting' | 'sent' | DataMessageRejection;
type OutboxRecord = { _id: string; message: DataMessage; delivery: DataMessageDelivery };
export type StoredDataMessage = { localId: string; message: DataMessage; delivery?: DataMessageDelivery };

const matches = (first: DataMessage, second: DataMessage) => first._id === second._id &&
  first.type === second.type && first.sender_id === second.sender_id &&
  first.recipient_id === second.recipient_id && first.created_at === second.created_at && first.text === second.text;

const readOptional = async <T>(db: PouchDB.Database, id: string) => {
  try {
    return await db.get<T>(id);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
};

export class DataMessagingLocalStore {
  constructor(readonly db: PouchDB.Database, readonly accountId: string) {}

  private async readRange<T>(prefix: string) {
    const { rows } = await this.db.allDocs<T>({ startkey: prefix, endkey: prefix + '\ufff0', include_docs: true });
    return rows.flatMap(({ doc }) => doc ? [doc] : []);
  }

  async enqueue(message: DataMessage): Promise<DataMessageDelivery> {
    const id = OUTBOX_PREFIX + message._id;
    try {
      await this.db.put<OutboxRecord>({ _id: id, message, delivery: 'waiting' });
      return 'waiting';
    } catch (err) {
      if (err.status !== 409) {
        throw err;
      }
      const existing = await this.db.get<OutboxRecord>(id);
      if (!matches(existing.message, message)) {
        throw err;
      }
      return existing.delivery;
    }
  }

  async getPending(): Promise<DataMessage[]> {
    const outbox = await this.readRange<OutboxRecord>(OUTBOX_PREFIX);
    return outbox.filter(record => record.delivery === 'waiting').map(record => record.message);
  }

  async setDelivery(messageId: string, delivery: Exclude<DataMessageDelivery, 'waiting'>): Promise<void> {
    const id = OUTBOX_PREFIX + messageId;
    for (;;) {
      const record = await readOptional<OutboxRecord>(this.db, id);
      if (!record || record.delivery === 'sent' || record.delivery === delivery ||
          (record.delivery !== 'waiting' && delivery !== 'sent')) {
        return;
      }
      try {
        await this.db.put<OutboxRecord>({ ...record, delivery });
        return;
      } catch (err) {
        if (err.status !== 409) {
          throw err;
        }
      }
    }
  }

  async saveAccepted(message: DataMessage): Promise<void> {
    try {
      await this.db.put<DataMessage>({ ...message });
    } catch (err) {
      if (err.status !== 409 || !matches(await this.db.get<DataMessage>(message._id), message)) {
        throw err;
      }
    }
    if (message.sender_id === this.accountId) {
      const record = await readOptional<OutboxRecord>(this.db, OUTBOX_PREFIX + message._id);
      if (record && matches(record.message, message)) {
        await this.setDelivery(message._id, 'sent');
      }
    }
  }

  async getMessages(): Promise<StoredDataMessage[]> {
    const [history, outbox] = await Promise.all([
      this.readRange<DataMessage>(PREFIXES.DATA_MESSAGE),
      this.readRange<OutboxRecord>(OUTBOX_PREFIX),
    ]);
    const accepted = new Map(history.map(doc => [doc._id, doc]));
    return [
      ...history.map(({ _rev, _attachments, ...message }) => ({
        localId: message._id,
        message,
        ...(message.sender_id === this.accountId && { delivery: 'sent' as const }),
      })),
      ...outbox.filter(({ message }) => {
        const canonical = accepted.get(message._id);
        return !canonical || !matches(canonical, message);
      }).map(({ _id, message, delivery }) => ({ localId: _id, message, delivery })),
    ];
  }
}

@Injectable({ providedIn: 'root' })
export class DataMessagingStoreService {
  private readonly updates = new Subject<{ accountId: string; accepted?: DataMessage }>();
  private readonly outboxSaves = new Subject<string>();
  readonly changes = this.updates.asObservable();
  readonly queued = this.outboxSaves.asObservable();

  constructor(
    private session: SessionService,
    private dbService: DbService,
    private messaging: DataMessagingService,
  ) {}

  open(): DataMessagingLocalStore {
    const accountId = this.messaging.accountId();
    if (!accountId) {
      throw new Error('A signed-in account is required to open messaging storage');
    }
    return new DataMessagingLocalStore(this.dbService.getMessaging(), accountId);
  }

  notifyChange(accountId: string): void {
    this.updates.next({ accountId });
  }

  async submit(message: DataMessage): Promise<DataMessageDelivery> {
    if (message.sender_id !== this.messaging.accountId()) {
      throw new Error('The message sender does not match the signed-in account');
    }
    if (this.session.isOnlineOnly()) {
      await this.messaging.send(message);
      this.updates.next({ accountId: message.sender_id, accepted: message });
      return 'sent';
    }
    const delivery = await this.open().enqueue(message);
    this.notifyChange(message.sender_id);
    if (delivery === 'waiting') {
      this.outboxSaves.next(message.sender_id);
    }
    return delivery;
  }
}
