/* global PouchDB */
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PREFIXES } from '@medic/constants';
import { DbService } from '@mm-services/db.service';
import { SessionService } from '@mm-services/session.service';

export type DataMessagingRecipient = Readonly<{
  account_id: string;
  display_name: string;
  role_label: string;
  place_label: string;
}>;

type Directory = readonly DataMessagingRecipient[];
type DirectorySnapshot = { entries: Directory };
const DIRECTORY_ID = '_local/data-message-directory';

const readSnapshot = async (db: PouchDB.Database<DirectorySnapshot>) => {
  try {
    return await db.get(DIRECTORY_ID);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
};

@Injectable({ providedIn: 'root' })
export class DataMessagingDirectoryService {
  constructor(private http: HttpClient, private session: SessionService, private dbService: DbService) {}

  async getDirectory(): Promise<Directory | null> {
    if (this.session.isOnlineOnly()) {
      return this.refreshDirectory();
    }
    const username = this.session.userCtx()?.name;
    const snapshot = await readSnapshot(this.dbService.getMessaging());
    if (this.session.userCtx()?.name !== username) {
      throw new Error('The signed-in account changed while reading the messaging directory');
    }
    return snapshot?.entries ?? null;
  }

  async refreshDirectory(): Promise<Directory | null> {
    const username = this.session.userCtx()?.name;
    if (!username) {
      throw new Error('A signed-in account is required to refresh the messaging directory');
    }
    const db: PouchDB.Database<DirectorySnapshot> | undefined = this.session.isOnlineOnly()
      ? undefined
      : this.dbService.getMessaging();
    const request = firstValueFrom(this.http.get<{ account_id: string; directory: Directory | null }>(
      '/api/v1/data-messaging/sync',
      { headers: { Accept: 'application/json' } },
    ));
    const [page, previous] = await Promise.all([request, db && readSnapshot(db)]);
    if (page?.account_id !== PREFIXES.COUCH_USER + username || this.session.userCtx()?.name !== username) {
      throw new Error('The messaging directory does not match the signed-in account');
    }
    const { directory } = page;
    if (directory !== null && !Array.isArray(directory)) {
      throw new Error('Invalid messaging directory snapshot');
    }
    if (!db || directory === null) {
      return directory ?? previous?.entries ?? null;
    }

    try {
      await db.put({ ...previous, _id: DIRECTORY_ID, entries: directory });
      return directory;
    } catch (err) {
      if (err.status !== 409) {
        throw err;
      }
      // Another refresh saved a snapshot while this request was in flight.
      return (await readSnapshot(db))?.entries ?? null;
    }
  }
}
