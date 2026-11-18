import { Injectable } from '@angular/core';
import { DOC_TYPES } from '@medic/constants';
import { readMessagingCheckpoint, writeMessagingCheckpoint } from '@mm-services/data-messaging-directory.service';
import { DataMessagingService, getDataMessageRejection } from '@mm-services/data-messaging.service';
import { DataMessagingLocalStore, DataMessagingStoreService } from '@mm-services/data-messaging-store.service';
import { SessionService } from '@mm-services/session.service';

@Injectable({ providedIn: 'root' })
export class DataMessagingSyncService {
  private readonly inProgress = new Map<string, Promise<void>>();

  constructor(
    private messaging: DataMessagingService,
    private storage: DataMessagingStoreService,
    private session: SessionService,
  ) {}

  async sync(): Promise<void> {
    const accountId = this.messaging.accountId();
    if (!accountId || this.session.isOnlineOnly()) {
      return;
    }
    const running = this.inProgress.get(accountId);
    if (running) {
      return running;
    }
    const run = this.syncAccount(this.storage.open()).finally(() => this.inProgress.delete(accountId));
    this.inProgress.set(accountId, run);
    return run;
  }

  private async syncAccount(store: DataMessagingLocalStore): Promise<void> {
    const pending = await store.getPending();
    for await (const result of this.messaging.uploadOutbox(pending)) {
      if (this.messaging.accountId() !== store.accountId) {
        return;
      }
      const delivery = result.status === 'accepted' ? 'sent' : getDataMessageRejection(result.error);
      if (delivery) {
        await store.setDelivery(result.id, delivery);
      }
    }

    const { db, accountId } = store;
    let hasMore = true;
    while (hasMore && this.messaging.accountId() === accountId) {
      const previous = await readMessagingCheckpoint(db);
      if (this.messaging.accountId() !== accountId) {
        return;
      }
      const page = await this.messaging.getSyncPage(previous?.since);
      for (const { _id, sender_id, recipient_id, text, created_at } of page.messages) {
        await store.saveAccepted({ _id, type: DOC_TYPES.DATA_MESSAGE, sender_id, recipient_id, text, created_at });
      }
      try {
        await writeMessagingCheckpoint(db, previous, page.directory, page.next_since);
      } catch (err) {
        if (err.status === 409) {
          // Another tab or refresh updated this checkpoint. Resume with the saved cursor.
          continue;
        }
        throw err;
      }
      hasMore = page.has_more;
    }
  }
}
