import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { expect } from 'chai';
import sinon from 'sinon';
import { v7 as uuid } from 'uuid';
import { DataMessagingDirectoryService } from '@mm-services/data-messaging-directory.service';
import { DbService } from '@mm-services/db.service';
import { LocationService } from '@mm-services/location.service';
import { SessionService } from '@mm-services/session.service';

describe('Data messaging directory service', () => {
  const path = '/api/v1/data-messaging/sync';
  const accountId = name => 'org.couchdb.user:' + name;
  const entries = [
    { account_id: accountId('north'), display_name: 'Alex', role_label: 'CHW', place_label: 'North' },
    { account_id: accountId('south'), display_name: 'Alex', role_label: 'Coordinator', place_label: 'South' },
  ];
  let name: string;
  let onlineOnly: boolean;
  let dbName: string;
  let originalPouchDB;
  let service: DataMessagingDirectoryService;
  let http: HttpTestingController;

  const restart = () => {
    const session = TestBed.inject(SessionService);
    // Construct without clinical view cleanup. The live session determines local messaging access.
    onlineOnly = true;
    const db = new DbService(session, TestBed.inject(LocationService), TestBed.inject(NgZone));
    onlineOnly = false;
    return new DataMessagingDirectoryService(TestBed.inject(HttpClient), session, db);
  };

  beforeEach(() => {
    name = 'sender';
    dbName = 'directory-test-' + uuid();
    originalPouchDB = window.PouchDB;
    window.PouchDB = require('pouchdb-browser').default;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SessionService, useValue: { userCtx: () => ({ name }), isOnlineOnly: () => onlineOnly } },
        { provide: LocationService, useValue: { dbName } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = restart();
  });

  afterEach(async () => {
    http.verify();
    await Promise.all(['sender', 'other'].map(name => window.PouchDB(`${dbName}-data-messaging-${name}`).destroy()));
    window.PouchDB = originalPouchDB;
    sinon.restore();
  });

  const refresh = (directory, owner = name) => {
    const result = service.refreshDirectory();
    http.expectOne({ method: 'GET', url: path }).flush({ account_id: accountId(owner), directory });
    return result;
  };

  it('reads the directory offline after restart and replaces it with complete snapshots', async () => {
    expect(await service.getDirectory()).to.equal(null);
    expect(await refresh(entries)).to.deep.equal(entries);
    service = restart();
    expect(await service.getDirectory()).to.deep.equal(entries);
    expect(await refresh([entries[1]])).to.deep.equal([entries[1]]);
    expect(await service.getDirectory()).to.deep.equal([entries[1]]);
    expect(await refresh([])).to.deep.equal([]);
    expect(await service.getDirectory()).to.deep.equal([]);
  });

  it('preserves the last complete snapshot when the download fails or the server has no snapshot', async () => {
    await refresh(entries);
    const failed = service.refreshDirectory();
    http.expectOne(path).error(new ProgressEvent('network error'));
    await expect(failed).to.be.rejected;
    expect(await refresh(null)).to.deep.equal(entries);
    expect(await service.getDirectory()).to.deep.equal(entries);
  });

  it('isolates both cached and in-flight responses when the account changes', async () => {
    await refresh(entries);
    const oldRequest = service.refreshDirectory();
    const request = http.expectOne(path);
    name = 'other';
    request.flush({ account_id: accountId('sender'), directory: [] });
    await expect(oldRequest).to.be.rejectedWith('does not match the signed-in account');
    await expect(refresh(entries, 'sender')).to.be.rejectedWith('does not match the signed-in account');
    expect(await service.getDirectory()).to.equal(null);
    expect(await refresh([])).to.deep.equal([]);
    name = 'sender';
    expect(await service.getDirectory()).to.deep.equal(entries);
  });

  it('fetches the scoped snapshot online without opening a local messaging database', async () => {
    onlineOnly = true;
    const open = sinon.spy(DbService.prototype, 'getMessaging');
    const result = service.getDirectory();
    http.expectOne(path).flush({ account_id: accountId(name), directory: entries });
    expect(await result).to.deep.equal(entries);
    expect(open.callCount).to.equal(0);
  });
});
