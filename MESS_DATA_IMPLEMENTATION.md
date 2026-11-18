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

### Server route inventory and storage review

NGINX sends requests to the API. In `api/src/routing.js`, `api/src/middleware/authorization.js` attaches CouchDB's session to the request. `onlineUserProxy` and `onlineUserPassThrough` skip offline replication authorization for online-only accounts. `can_edit` protects some writes and conveys general editing permission. Neither role implies participation in a thread. Below, `/<db>` refers to the configured database and its `/medic` alias.

| Surface | Current path | Required control before private document storage |
| --- | --- | --- |
| Initial download and cleanup | `GET /api/v1/replication/get-ids` and `POST /api/v1/replication/get-deletes` use `services/replication/authorization.js`, `replication.js` and `docs_by_replication_key`. User-info document counts also use the replication context. | Use participant and directory-owner keys based on the CHT account ID outside the place and global key spaces. Derive keys from the authenticated account only. Apply the same rule to ID/revision pairs, deletion and purge results and any counts exposed to a non-admin. |
| Incremental download | `GET/POST /<db>/_changes` is filtered for offline roles. Online requests use `proxyForChanges`, including long polls. | Scope normal, long-poll and supported streaming feeds before returning IDs, revisions, deletions or `include_docs` bodies. Intersect client-supplied IDs, selectors and filters with authorization. |
| Direct and batch reads | `GET/HEAD /<db>/:docId`, revisions and attachments, `GET/POST _all_docs` and `POST _bulk_get`. Online reads reach CouchDB. Offline routes use `controllers/db-doc.js`, `all-docs.js` and `bulk-get.js`. | Check ownership for every private ID and requested revision. Give unrelated accounts the missing-record behavior, including for HEAD, attachments, open revisions, multiple queries and batch rows. For listings, scope ranges, pagination and counts to visible records. |
| Queries and design functions | Early proxy routes send online `_view`, `_show`, `_list`, `_find` and `_explain` directly to CouchDB. `_index`, search routes such as `_nouveau` and `_search`, and other design functions can reach proxy handlers. | Allow only reviewed query paths for non-admins. Ensure permitted indexes, search results, reducers and linked `include_docs` results exclude private records or apply participant checks. Route data-message queries through an account-scoped API. |
| Direct and replicated writes | `POST /<db>`, `PUT/DELETE /<db>/:docId`, attachment methods and `POST _bulk_docs`. Offline writes pass through replication filters. Online writes can continue to the editing proxy. `POST /api/v1/bulk-delete` uses privileged DB access with `can_edit` for online roles. | Check reserved IDs and both existing and proposed types before passthrough, including mixed bulks, tombstones, attachment changes and replication revision writes. Enforce a CouchDB validation backstop and require the API send validator for client messages. Directory creation is server-owned. |
| Replication and proxy fallback | `_local`, `_revs_diff` and `_missing_revs` have early passthroughs. App rewrites can set `req.authorized`. Other requests may reach `canEdit` or the final `app.all('*path', …)`. Database aliases and CouchDB's path matching also apply. | Use a closed set of proxied routes for non-admins. Check document IDs in revision probes. Keep supported checkpoint access scoped. Cover aliases, encoded paths, method matching, database metadata, maintenance endpoints, rewrites and server-level replication or scheduling surfaces before proxying. |
| Privileged API data access | `/api/v1/hydrate` takes document IDs and fetches through a privileged connection. Other surfaces include contact, person, place, report, form and target APIs, contacts-by-phone, records imports, SMS, `/api/v2/export/:type` and the administrator archive endpoint. | Scope hydration at the document boundary, including related docs. Verify type and ID boundaries on typed reads and mutations. Keep private types out of clinical, SMS and standard export indexes and streams. Preserve administrator-only archive and maintenance access. |
| Other ingress and persistence | HAProxy/CouchDB, per-user meta databases, audit/logging, and server-side replication or backups. | Restrict direct CouchDB access to trusted services and administrators. Review meta DB authorization and artifact/log handling so private IDs and content cannot escape participant-scoped paths. |

Shared `medic` storage requires the API to mediate every non-admin route that can reveal private records. CouchDB document validation controls writes and database membership controls reads at database scope. CHT administrators recognized by `auth.isDbAdmin` keep existing authorized access. CouchDB administrators keep direct access for operations and backups. Online-only non-admin accounts must use participant-scoped paths even if they have clinical edit or export permissions. These protections must apply while the feature is disabled as well. [CouchDB document validation](https://docs.couchdb.org/en/stable/ddocs/ddocs.html#validate-document-update-functions)

Review this inventory with the maintainer before building on shared storage. Approval depends on preserving the supported dashboard and PouchDB routes behind the API and keeping direct database access within the trusted boundary. If a deployment requires unrestricted non-admin CouchDB access, agree on the storage design before writing any private records. This step adds no messaging endpoints and stores no messages or directories.

### Verification

- With `COUCH_URL=http://medic:password@localhost:5984/medic` and `COUCH_NODE_NAME=nonode@nohost`, `UNIT_TEST_ENV=1 npm test -w @medic/user-management` passed 281 tests and `npm run unit-api` passed 1,686 tests.
- `npm run build-ddocs` passed. The compiled `_design/users` includes the existing views and has no messaging validator.
- `npm run lint` reached ShellCheck and reported the existing `SC2155` in `build-images.sh:8`. ESLint and the blank-link check passed, with an existing ESLint warning in `api/tests/mocha/services/settings.spec.js`.

## Step 2 — Recipient policy

- `dataMessaging.canMessage(senderId, recipientId)` takes two CHT account IDs. It reads both active accounts and their current assignments on each call. Any one assignment pair qualifies if one place is a strict ancestor of the other and the path is inside a configured pilot root. The rule is symmetric and uses no role categories. Intermediate accounts can initiate conversations both up and down the same branch.
- The policy loads current place documents through the CHT datasource, follows each immediate parent link and checks it against `contact_types[].parents`. Embedded ancestry can lag behind a move. Places on other branches, missing or invalid chains, and identical assigned places cannot establish eligibility.
- Use `dataMessaging.getEligibleRecipientIds(senderId, candidateIds)` for directory generation. It filters server-supplied candidates with the same rule as `canMessage` and returns each eligible account ID once, in candidate order. It reuses account and place lookups within one directory build. Each separate build and each send check starts with fresh lookups. Callers must derive the sender ID from the authenticated session. The directory and direct and replicated send entry points are introduced in steps 4 and 5.
- `COUCH_URL=http://medic:password@localhost:5984/medic COUCH_NODE_NAME=nonode@nohost npm run unit-api` passed all 1,705 tests. With the same CouchDB environment variables, `UNIT_TEST_ENV=1 npx --no-install mocha api/tests/mocha/services/data-messaging.spec.js` passed all 23 focused tests. `npm run lint` passed ESLint and the blank-link check and exited with the existing ShellCheck `SC2155` in `build-images.sh:8`.
