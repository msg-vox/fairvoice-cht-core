/* global PouchDB */
import { Injectable } from '@angular/core';
import { DataMessagingDirectory, DataMessagingService } from '@mm-services/data-messaging.service';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';

type DirectorySnapshot = { entries?: DataMessagingDirectory; since?: string };
const DIRECTORY_ID = '_local/data-message-directory';

export const readMessagingCheckpoint = async (db: PouchDB.Database) => {
  try {
    return await db.get<DirectorySnapshot>(DIRECTORY_ID);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
};

export const writeMessagingCheckpoint = (
  db: PouchDB.Database,
  previous: Awaited<ReturnType<typeof readMessagingCheckpoint>>,
  entries: DataMessagingDirectory | null,
  since = previous?.since,
) => db.put<DirectorySnapshot>({
  ...previous,
  _id: DIRECTORY_ID,
  ...(entries !== null && { entries }),
  ...(since && { since }),
});

@Injectable({ providedIn: 'root' })
export class DataMessagingDirectoryService {
  constructor(
    private messaging: DataMessagingService,
    private session: SessionService,
    private dbService: DbService,
  ) {}

  async getDirectory(): Promise<DataMessagingDirectory | null> {
    if (this.session.isOnlineOnly()) {
      return this.refreshDirectory();
    }
    const username = this.session.userCtx()?.name;
    const snapshot = await readMessagingCheckpoint(this.dbService.getMessaging());
    if (this.session.userCtx()?.name !== username) {
      throw new Error('The signed-in account changed while reading the messaging directory');
    }
    return snapshot?.entries ?? null;
  }

  async refreshDirectory(): Promise<DataMessagingDirectory | null> {
    if (!this.messaging.accountId()) {
      throw new Error('A signed-in account is required to refresh the messaging directory');
    }
    const db: PouchDB.Database | undefined = this.session.isOnlineOnly() ? undefined : this.dbService.getMessaging();
    const [page, previous] = await Promise.all([this.messaging.getSyncPage(), db && readMessagingCheckpoint(db)]);
    const { directory } = page;
    if (!db || directory === null) {
      return directory ?? previous?.entries ?? null;
    }

    try {
      await writeMessagingCheckpoint(db, previous, directory);
      return directory;
    } catch (err) {
      if (err.status !== 409) {
        throw err;
      }
      // Another refresh saved a snapshot while this request was in flight.
      return (await readMessagingCheckpoint(db))?.entries ?? null;
    }
  }
}
