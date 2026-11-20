import { Injectable } from '@angular/core';
import { DOC_TYPES } from '@medic/constants';
import { Subject } from 'rxjs';

import { DataMessagingDirectoryService } from '@mm-services/data-messaging-directory.service';
import { DataMessage, DataMessagingDirectory, DataMessagingService } from '@mm-services/data-messaging.service';
import { DataMessagingStoreService, StoredDataMessage } from '@mm-services/data-messaging-store.service';
import { DataMessagingSyncService } from '@mm-services/data-messaging-sync.service';
import { SessionService } from '@mm-services/session.service';

type OnlineHistory = {
  accountId: string;
  directory: DataMessagingDirectory | null;
  messages: Map<string, DataMessage>;
  since?: string;
  refresh?: Promise<void>;
  followUp?: Promise<void>;
};

export type DataMessagingHistory = {
  accountId?: string;
  directory: DataMessagingDirectory | null;
  messages: StoredDataMessage[];
};

@Injectable({ providedIn: 'root' })
export class DataMessagingHistoryService {
  private readonly updates = new Subject<void>();
  readonly changes = this.updates.asObservable();
  private onlineHistory?: OnlineHistory;

  constructor(
    private messaging: DataMessagingService,
    private storage: DataMessagingStoreService,
    private directory: DataMessagingDirectoryService,
    private session: SessionService,
    private sync: DataMessagingSyncService,
  ) {
    this.storage.changes.subscribe(({ accountId, accepted }) => {
      if (accountId !== this.messaging.accountId()) {
        return;
      }
      if (accepted) {
        this.getOnlineHistory(accountId).messages.set(accepted._id, accepted);
      }
      this.updates.next();
    });
  }

  private getOnlineHistory(accountId: string): OnlineHistory {
    if (this.onlineHistory?.accountId !== accountId) {
      this.onlineHistory = { accountId, directory: null, messages: new Map() };
    }
    return this.onlineHistory;
  }

  async read({ loadOnline = true } = {}): Promise<DataMessagingHistory> {
    const accountId = this.messaging.accountId();
    if (!accountId) {
      this.onlineHistory = undefined;
      return { directory: null, messages: [] };
    }
    if (!this.session.isOnlineOnly()) {
      this.onlineHistory = undefined;
      const [directory, messages] = await Promise.all([
        this.directory.getDirectory(),
        this.storage.open().getMessages(),
      ]);
      this.checkAccount(accountId);
      return { accountId, directory, messages };
    }

    const history = this.getOnlineHistory(accountId);
    if (loadOnline && !history.since) {
      await this.refreshOnline();
    }
    this.checkAccount(accountId);
    const messages = Array.from(history.messages.values(), message => ({
      localId: message._id,
      message,
      ...(message.sender_id === accountId && { delivery: 'sent' as const }),
    }));
    return { accountId, directory: history.directory, messages };
  }

  async refreshFromServer(accountId = this.messaging.accountId()): Promise<void> {
    if (!accountId || accountId !== this.messaging.accountId() || !navigator.onLine) {
      return;
    }
    if (this.session.isOnlineOnly()) {
      await this.refreshOnline({ afterCurrent: true });
    } else {
      await this.sync.requestSync(() => navigator.onLine, accountId);
    }
  }

  async refreshOnline({ afterCurrent = false } = {}): Promise<void> {
    const accountId = this.messaging.accountId();
    if (!accountId || !this.session.isOnlineOnly()) {
      return;
    }
    const history = this.getOnlineHistory(accountId);
    if (afterCurrent && history.refresh) {
      const refresh = () => {
        history.followUp = undefined;
        if (this.messaging.accountId() === accountId) {
          return this.refreshOnline();
        }
      };
      history.followUp ??= history.refresh.then(refresh, refresh);
      await history.followUp;
      return;
    }
    history.refresh ??= this.download(history).finally(() => history.refresh = undefined);
    await history.refresh;
  }

  async getDirectory({ refreshOnline = false } = {}): Promise<DataMessagingDirectory | null> {
    const accountId = this.messaging.accountId();
    if (!accountId) {
      return null;
    }
    if (!this.session.isOnlineOnly()) {
      return this.directory.getDirectory();
    }
    const history = this.getOnlineHistory(accountId);
    if (refreshOnline || !history.since) {
      await this.refreshOnline();
    }
    this.checkAccount(accountId);
    return history.directory;
  }

  private async download(history: OnlineHistory): Promise<void> {
    let changed = false;
    try {
      let hasMore;
      do {
        const page = await this.messaging.getSyncPage(history.since);
        this.checkAccount(history.accountId);
        for (const message of page.messages) {
          history.messages.set(message._id, { ...message, type: DOC_TYPES.DATA_MESSAGE });
        }
        const directory = page.directory ?? history.directory;
        changed ||= !history.since || page.messages.length > 0 ||
          JSON.stringify(history.directory) !== JSON.stringify(directory);
        history.directory = directory;
        history.since = page.next_since;
        hasMore = page.has_more;
      } while (hasMore);
    } finally {
      if (changed && this.messaging.accountId() === history.accountId) {
        this.updates.next();
      }
    }
  }

  private checkAccount(accountId: string): void {
    if (this.messaging.accountId() !== accountId) {
      throw new Error('The signed-in account changed while reading messaging history');
    }
  }
}
