# Data messaging implementation

## Step 1 — Account and configuration contract

### Configuration

`data_messaging` is an application setting. Existing deployments without this key and the default application configuration both have messaging disabled. Enabling it requires the boolean `enabled: true` and at least one root place ID. `pilot_root_place_ids` accepts an array of nonblank strings. An invalid list is treated as empty.

```json
{
  "data_messaging": {
    "enabled": false,
    "pilot_root_place_ids": ["example-pilot-place-id"]
  }
}
```

The pilot is the union of the specified places and their descendants. `getMessagingAccount` reads roles and all assigned IDs from the live `_users` document and normalizes a legacy scalar `facility_id` to a list. Keep `_users` assignment fields writable only by trusted account-management paths. [CHT multi-facility users](https://docs.communityhealthtoolkit.org/building/tutorials/multi-facility-users/)

### Account lifecycle

- Use the existing `_users` document ID `org.couchdb.user:<username>` for message participants and directory owners. `dataMessaging.getAccount(req)` takes the username from CouchDB `/_session`. The lookup reads the login and its user settings without writing either document. A missing login, missing settings or inactive settings yields no messaging account. Reassignment preserves the ID.
- CHT deletion tombstones the login and marks its user settings inactive. The retained settings prevent reuse through the normal CHT creation API. The deployment permanently reserves usernames by operating practice, including for direct CouchDB administration. Recreating a username reuses its account ID and can grant access to the previous account's threads. [CouchDB authentication database](https://docs.couchdb.org/en/stable/intro/security.html#authentication-database)
- Browser bootstrap selects its PouchDB and metadata databases by username in `webapp/src/js/bootstrapper/index.js`. The same no-reuse assumption applies to cached history, directories, drafts and metadata. A replacement account must be given a fresh username to avoid picking up the old cache. There are no private messaging records to migrate.

### Storage decision

Online-only CHT requests can reach CouchDB views, changes, and other queries through the existing API proxy. CouchDB database membership grants read access to the whole database. Storing messages and directories in `medic` would require participant checks across those routes and privileged clinical APIs. The dedicated database uses CouchDB membership to protect raw access and keeps participant-level access in the messaging API. See step 3 for the API contract. [CouchDB database security](https://docs.couchdb.org/en/stable/api/database/security.html)

### Verification

- With `COUCH_URL=http://medic:password@localhost:5984/medic` and `COUCH_NODE_NAME=nonode@nohost`, `UNIT_TEST_ENV=1 npm test -w @medic/user-management` passed 281 tests and `npm run unit-api` passed 1,686 tests.
- `npm run build-ddocs` passed. The compiled `_design/users` includes the existing views and has no messaging validator.
- `npm run lint` reached ShellCheck and reported the existing `SC2155` in `build-images.sh:8`. ESLint and the blank-link check passed, with an existing ESLint warning in `api/tests/mocha/services/settings.spec.js`.

## Step 2 — Recipient policy

- `dataMessaging.canMessage(senderId, recipientId)` takes two CHT account IDs. It reads both active accounts and their current assignments on each call. Any one assignment pair qualifies if one place is a strict ancestor of the other and the path is inside a configured pilot root. The rule is symmetric and uses no role categories. Intermediate accounts can initiate conversations both up and down the same branch.
- The policy loads current place documents through the CHT datasource, follows each immediate parent link and checks it against `contact_types[].parents`. Embedded ancestry can lag behind a move. Places on other branches, missing or invalid chains, and identical assigned places cannot establish eligibility.
- Use `dataMessaging.getEligibleRecipientIds(senderId, candidateIds)` for directory generation. It filters server-supplied candidates with the same rule as `canMessage` and returns each eligible account ID once, in candidate order. It reuses account and place lookups within one directory build. Each separate build and each send check starts with fresh lookups. Callers must derive the sender ID from the authenticated session. Step 4 uses this policy for dashboard submissions and outbox uploads. Step 5 uses it to build directories.
- `COUCH_URL=http://medic:password@localhost:5984/medic COUCH_NODE_NAME=nonode@nohost npm run unit-api` passed all 1,705 tests. With the same CouchDB environment variables, `UNIT_TEST_ENV=1 npx --no-install mocha api/tests/mocha/services/data-messaging.spec.js` passed all 23 focused tests. `npm run lint` passed ESLint and the blank-link check and exited with the existing ShellCheck `SC2155` in `build-images.sh:8`.

## Step 3 — Dedicated database and scoped download

- The `create-data-messaging-db` migration provisions `<db>-data-messaging` and sets CouchDB membership for the CHT `admin` and CouchDB `_admin` roles. The API uses its configured CouchDB service credentials. The migration can reapply the ACL to an existing database. Provisioning and read access are independent of the pilot setting. Include this database and its access policy in operational backups and restores.
- Store messages under `data-message:<uuid>` with type `data_message` and directories under `data-message-directory:<account ID>` with type `data_message_directory`. Use full CHT account IDs in `sender_id`, `recipient_id` and `owner_id`. Keep one canonical message for both participants. The two namespaces are used only in the messaging database and the device’s messaging cache.
- `GET /api/v1/data-messaging/sync` authenticates online and offline users through their CHT session. It returns `messages` with `_id`, `sender_id`, `recipient_id`, `text` and `created_at`. It also returns the caller’s `directory` with `account_id`, `display_name`, `role_label` and `place_label` per entry, or `null` if a directory has yet to be published. An empty array is a published, empty directory. Responses use `Cache-Control: no-store`.
- Omit `since` for the initial request. Pass back the opaque `next_since` from the last successfully applied page and continue while `has_more` is true. A full page is up to 100 matching changes and may be followed by an empty page. Store the cursor per account after saving the page and deduplicate messages by `_id` when replaying a page. CouchDB changes order tracks server acceptance, so a delayed upload with an older `created_at` will still arrive. Use `created_at` and `_id` to order the UI. A full resync starts without a cursor.
- Step 4 adds the validated send path. Step 5 adds the directory writer through the API service. Step 6 adds account-scoped local PouchDB storage and calls the messaging API from the existing WebApp sync lifecycle. Plan any reset or database switch to clear the matching local cursor. Keep accepted history readable when the pilot is disabled.

### Verification

- `npm run integration-api` passed 16 CouchDB-backed tests. The messaging tests cover participant and directory-owner access, raw read and write restrictions, administrator access, directory replacement, history after reassignment, invalid requests, and pagination across late uploads.
- With `COUCH_URL=http://medic:password@localhost:5984/medic` and `COUCH_NODE_NAME=nonode@nohost`, `npm run unit-api` passed 1,705 tests and met coverage thresholds.
- `npm run lint` passed ESLint and the blank-link check. ShellCheck reported the existing `SC2155` warning in `build-images.sh:8`. ESLint reported the existing unused directive in `api/tests/mocha/services/settings.spec.js`.

## Step 4 — Immutable message uploads

- `POST /api/v1/data-messaging/messages` accepts one JSON message from either an online or offline account. Supply exactly `_id`, `type`, `sender_id`, `recipient_id`, `text` and `created_at`. Use `data-message:<lowercase UUID>`, type `data_message`, full CHT account IDs and a finite numeric UTC epoch timestamp in milliseconds. Text must contain a non-whitespace character and may contain up to 4,000 Unicode code points, counting leading and trailing whitespace. The API preserves the submitted text verbatim.
- The API checks the sender against the authenticated session and uses the live recipient policy before creating an ID in the messaging database. Both a new create (`201`) and an identical retry (`200`) return `{ "id": "data-message:<uuid>" }`. Identical retries use the canonical message even after reassignment or pilot disablement. A CouchDB create conflict is resolved by re-reading and comparing the six message fields.
- Invalid schemas return `400`, including attempts to submit revision, deletion or SMS task fields. A mismatched sender or ineligible recipient returns `403`. Reuse of an ID with changed contents returns `409`. The API offers only creation and acknowledgement of existing messages.
- `DataMessagingService.compose` builds the message from the signed-in session, the selected account and the original text. It generates a UUID v7 and applies the same text limit as the API. Pass this same message to `send` on every retry. `send` requires the acknowledgement to match the submitted ID. `uploadOutbox` submits one message at a time and yields an acceptance or error for each ID so sync can persist each result independently.
- The thread template renders typed data message bodies as plain text and preserves line breaks. Step 6 persists the composed record and keeps the local revision and send status outside the upload body. Downloads can add the known `data_message` type when saved locally. Step 7 connects the composer and data conversations to the Messages screen.

### Verification

- `COUCH_URL=http://medic:password@localhost:5984/medic COUCH_NODE_NAME=nonode@nohost npm run unit-api` passed all 1,710 tests and met coverage thresholds. The send tests include deterministic conflict handling and storage failure propagation.
- `npm run integration-api` passed all 19 tests. The send cases cover online and offline accounts, schema and Unicode limits, a forged sender, reassignment and pilot disablement, concurrent retries, and the unchanged SMS gateway queue.
- With `CHROME_BIN` set to Chrome for Testing, `npm --prefix webapp run unit -- --watch=false --browsers=ChromeHeadlessCI --code-coverage=false --include=../tests/karma/ts/services/data-messaging.service.spec.ts --include=../tests/karma/ts/modules/messages/messages-content.component.spec.ts` passed all 17 focused tests, including a rejected item followed by a successful upload and literal rendering of HTML-like text.
- The full WebApp Karma run with `npm --prefix webapp run unit -- --watch=false --browsers=ChromeHeadlessCI` met coverage thresholds and passed 3,255 tests. Its 19 failures also reproduced before Step 4 on `vvzyzrky`, which passed 3,249 tests.
- `npm run lint` passed ESLint and the blank-link check. ShellCheck reported the existing `SC2155` warning in `build-images.sh:8`. ESLint reported the existing unused directive in `api/tests/mocha/services/settings.spec.js`.
