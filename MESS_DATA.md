# Implement private data messaging over CHT sync

Add one-to-one text conversations to the existing Messages screen. A community researcher (CR) can message a supervisor or program officer above them in the place hierarchy. Either person can start the conversation. Use individual CHT accounts, the existing `medic` database and PouchDB replication. Keep SMS available through its existing flow.

After initial login and sync, an Android user can compose offline and read downloaded history. The sender's next successful upload makes a message available on the server. An offline recipient sees it after their next successful download. An online-only dashboard user reads and writes through the API while connected. A suspended or closed app may have to reopen to sync. Group chat, attachments, push notifications and recipient delivery/read receipts are outside v1.

## How to deliver the work

Implement the steps in order. Each step ends with a review check. Commit all changes, including tests and documentation, in small, reviewable increments. Give every commit a useful prefix and a short description of the change. Follow `AGENTS.md` and use the actual name message-above, for example `feat(#message-above): filter data messages by participant` or `test(#message-above): cover offline message retries`. Run the focused tests for the change and `npm run lint` before committing.

Create `MESS_DATA_IMPLEMENTATION.md` beside this plan in the first implementation commit. Update its corresponding step in the same commit whenever a change needs more detail. Record the contracts or design decisions a maintainer needs, affected entry points, verification commands and results, and any remaining limitation. Keep this plan as the checklist and commit subjects short.

### 1. Establish the account and configuration contract

- Add a default-off data-messaging setting with configurable CHT role IDs for CRs, supervisors and officers. Configure pilot places by root place ID. Each root includes itself and its descendants. Use existing CHT account-to-place assignments, including multiple assigned places.
- Use the existing CHT account ID (`org.couchdb.user:<username>`) for addressing and resolve the caller from the authenticated session. The deployment permanently reserves usernames by operating practice. Recreating a username would reuse its messaging identity and could expose the previous account's threads and cached data.
- Before storing private records, map the server read and write routes in the implementation file. Start with `api/src/routing.js` and `api/src/middleware/authorization.js`. Online-only requests can go straight to CouchDB. Identify how every supported dashboard and replication route will enforce participant access while retaining existing administrator access. If the shared database cannot meet that requirement, resolve the storage design with the maintainer before proceeding.

**Review check.** An existing configuration enables no data messaging. Tests verify that reassignment preserves the account ID and that account lookup is read-only. Review the route inventory before building on it.

### 2. Implement one recipient policy

- On the server, accept a pair when both accounts are active, distinct and enabled for the pilot, one has a CR role and the other has a supervisor or officer role, and a manager's assigned place is a strict ancestor of a CR's assigned place in the enabled hierarchy. Evaluate both directions. Any qualifying pair of assignments suffices. Deduplicate by account ID.
- Use this function for directory generation and for every new send, including replies and queued uploads. Read current server assignments for the send decision.

**Review check.** Table-driven tests cover both manager roles, both directions, multiple assignments, peers, same-place assignments, unrelated branches, missing assignments and an account moved out of scope.

### 3. Enforce private document reads and replication

- Reserve distinct document types and ID prefixes for messages and directories. A message is readable by its two recorded participants, a directory by its owner. Retain existing administrator access. Base history access on stored account IDs even after a role or place change.
- Apply those rules to initial and incremental replication, direct reads, listings and bulk reads. Start with `api/src/services/replication/` and the `docs_by_replication_key` index. Keep participant keys separate from place and global keys. Handle dashboard proxy routes and other ways of querying `medic`, including views, search, changes and exports, using the route inventory from step 1.
- Restrict creation of directory documents to the server. Reserve message writes for the validated paths in step 4. Enforce these restrictions even when the feature is disabled.

**Review check.** Seed records directly in test fixtures. Using both offline-role and online-only accounts, verify that participants can fetch only their permitted records and an unrelated manager cannot discover IDs or content through any route in the inventory. Verify administrator access and ordinary clinical replication.

### 4. Validate each immutable message at upload

- Generate one UUID at composition and persist the prefixed `_id` with `type`, `sender_id`, `recipient_id`, `text` and `created_at` (UTC epoch milliseconds). Validate the schema, a finite timestamp and nonblank text. Use a v1 limit of 4,000 Unicode code points in both the composer and API. Render the body as plain text.
- For a new ID, require an authenticated sender matching `sender_id` and a currently eligible recipient. Apply the same checks to direct dashboard writes and each replicated bulk write. Reject edits, participant changes, type changes and user deletions. Exclude SMS task fields from the schema.
- For a retry by the original sender, acknowledge an already accepted identical message even if the assignments have since changed. Reject a different payload under the same ID. Handle concurrent creates and replication revision semantics so one ID yields one accepted message. Return a per-document result for mixed batches.

**Review check.** Test blank, at-limit and over-limit text, a forged sender, stale recipient, duplicate upload after a lost response, conflicting reuse of an ID and a batch containing one rejected and one valid message. Verify that a data message produces no SMS gateway work.

### 5. Sync a minimal recipient directory

- Materialize one server-owned directory per account using step 2. Include only recipient account ID, display name, role label and place label for disambiguation. Rebuild affected directories on account, role, hierarchy or pilot-setting changes, including initial enablement. Replace the full list so removals and a successful empty result reach the device.
- Load the last successfully synced directory from the signed-in user's database. Distinguish initial sync pending from an empty directory. Use the same scoped data for connected dashboard users.

**Review check.** After initial sync, restart offline and select between two people with the same name. Reassign one, reconnect and verify removal. Confirm that a failed refresh preserves the last complete list and that switching accounts isolates cached entries.

### 6. Persist sends and track their outcomes

- For offline-capable users, save the message to local PouchDB before clearing the composer. Integrate with the existing push filter, permission check and per-document events in `webapp/src/ts/services/db-sync.service.ts`. Ensure pilot roles can upload messages without widening their permissions on other document types. For online-only users, submit directly and retain the draft on a failed request.
- Keep send status in sender-scoped metadata outside the immutable message. Show **Waiting to sync** after a local save and **Sent to server** only after confirmation for that ID. Reconcile uncertain outcomes by checking the accepted message on reconnect. Retry transient failures with the original ID. Persist a terminal eligibility rejection, stop automatic retries for it and let the sender copy the text or choose a currently eligible person for a new send.

**Review check.** Compose offline, restart, interrupt an upload and reconnect. Verify one accepted copy and the correct status after restart. Revoke eligibility before a second upload and verify a visible failure even when the rest of the sync succeeds.

### 7. Connect the Messages screen

- Extend `webapp/src/ts/modules/messages/` and the send-message modal with an explicit data-message option. Use the directory for new conversations and recheck eligibility for replies. Reuse the list, thread and composer components. Keep SMS phone selection and SMS queries on their existing path.
- Group data messages by the other participant's account ID, separate from SMS thread IDs. Order by `created_at` with `_id` as the tie-breaker. Determine direction from the session account. When someone leaves the directory, keep history readable with an account label or ID fallback and disable replies to them.
- Use existing per-user read metadata for incoming messages. Translate new labels and states. Refresh the open thread and list as messages arrive.

**Review check.** Verify Android-to-dashboard and dashboard-to-Android conversations, unread counts, stable ordering and historical threads after reassignment. Exercise the existing SMS composer and inbox alongside data messaging.

### 8. Verify and pilot

Run the affected API, CouchDB and webapp unit suites, API integration tests and a two-account end-to-end exchange. Include one unrelated online-only account in the privacy checks. Record exact commands, results and any device-only checks in the implementation file.

Enable one pilot hierarchy first. Verify directory contents, send and reply in each direction, and complete an offline upload/download cycle. Test disabling the pilot with a pending local send. Disabling must stop new sends, surface the pending send's rejection on reconnect and preserve participant access to accepted history. Expand only after those checks pass.
