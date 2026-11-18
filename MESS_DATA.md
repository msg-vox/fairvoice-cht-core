# Implement private offline data messaging

Add one-to-one text conversations to the existing Messages screen. Within the enabled pilot, any active account can message an account assigned above or below it on the same branch of the configured CHT place hierarchy. Either person can start the conversation. Use individual CHT accounts, a dedicated CouchDB database, and an account-scoped PouchDB cache on offline devices. Run messaging sync alongside clinical sync. Keep SMS available through its existing flow.

After initial login and sync, an Android user can compose offline and read downloaded history. The sender's next successful upload makes a message available on the server. An offline recipient sees it after their next successful download. An online-only dashboard user reads and writes through the API while connected. A suspended or closed app may have to reopen to sync. Group chat, attachments, push notifications and recipient delivery/read receipts are outside v1.

## How to deliver the work

Implement the steps in order. Each step ends with a review check. Commit all changes, including tests and documentation, in small, reviewable increments. Give every commit a useful prefix and a short description of the change. The dedicated database work uses the `new-db:` prefix. Follow `AGENTS.md` for later feature commits using `#message-above`. Run the focused tests for the change and `npm run lint` before committing.

Create `MESS_DATA_IMPLEMENTATION.md` beside this plan in the first implementation commit. Update its corresponding step in the same commit whenever a change needs more detail. Record the contracts or design decisions a maintainer needs, affected entry points, verification commands and results, and any remaining limitation. Keep this plan as the checklist and commit subjects short.

### 1. Establish the account and configuration contract

- Add a default-off data-messaging setting and configure pilot places by root place ID. Each root includes itself and its descendants. Use the existing CHT hierarchy configuration and account-to-place assignments, including multiple assigned places.
- Use the existing CHT account ID (`org.couchdb.user:<username>`) for addressing and resolve the caller from the authenticated session. The deployment permanently reserves usernames by operating practice. Recreating a username would reuse its messaging identity and could expose the previous account's threads and cached data.
- Keep canonical messaging records in a dedicated database. Use database membership to protect raw access and authenticate messaging API requests through the existing CHT session. See the implementation notes for the storage decision.

**Review check.** An existing configuration enables no data messaging. Tests verify that reassignment preserves the account ID and that account lookup is read-only. Review the dedicated database access boundary before storing private records.

### 2. Implement one recipient policy

- On the server, accept a pair of distinct, active accounts when an assigned place of either is a strict ancestor of an assigned place of the other within a pilot root. Follow the current place documents and validate their parent relationships using `contact_types`. Any qualifying pair of assignments suffices, regardless of role or number of levels between the places. Deduplicate recipients by account ID.
- Use this function for directory generation and for every new send, including replies and outbox uploads. Read current server assignments for the send decision.

**Review check.** Table-driven tests cover custom place types and depths, both directions, multiple assignments, same-place assignments, unrelated branches, missing assignments and changes to assignments or the place hierarchy.

### 3. Set up the messaging database and scoped download

- Provision `<db>-data-messaging` with CouchDB access limited to the API service and database administrators. Reserve distinct document types and ID prefixes within that database for messages and directories.
- Serve history and the caller’s directory through an authenticated API. Derive the account from the session. Return a message to its two recorded participants and a directory to its recorded owner. Keep history accessible after role or place changes and when the pilot is disabled. Keep clinical replication and clinical query routes on the clinical database.
- Page messages using a server-issued CouchDB changes cursor. The directory is a full snapshot. The API returns `null` until the first directory is available and an empty list for a completed, empty directory. Directory writes are server-owned. Step 4 adds the validated send path.

**Review check.** Seed records directly in CouchDB. Verify that online and offline accounts can download their permitted records, unrelated accounts receive no private IDs or content, and regular accounts cannot query or write the messaging database directly. Verify administrator access, initial and incremental downloads, and that no canonical messages are stored in `medic`.

### 4. Validate each immutable message at upload

- Generate one UUID at composition and persist the prefixed `_id` with `type`, `sender_id`, `recipient_id`, `text` and `created_at` (UTC epoch milliseconds). Validate the schema, a finite timestamp and nonblank text. Use a v1 limit of 4,000 Unicode code points in both the composer and API. Render the body as plain text.
- Add a messaging send API used by the online dashboard and the offline outbox. For a new ID, require an authenticated sender matching `sender_id` and a currently eligible recipient. Create the document in the dedicated database through the API service account. Reject edits, participant changes, type changes and user deletions. Exclude SMS task fields from the schema.
- For a retry by the original sender, acknowledge an already accepted identical message even if the assignments or pilot setting have since changed. Reject a different payload under the same ID. Resolve concurrent creates by re-reading the canonical document on conflict. Each queued message gets its own result so that a rejected message leaves the rest of the queue eligible to send.

**Review check.** Test blank, at-limit and over-limit text, a forged sender, stale recipient, duplicate upload after a lost response, conflicting reuse of an ID and an outbox containing one rejected and one valid message. Verify that a data message produces no SMS gateway work.

### 5. Serve a minimal recipient directory

- Materialize one server-owned directory per account in the messaging database using step 2. Include only recipient account ID, display name, role label and place label for disambiguation. Rebuild affected directories on account, role, hierarchy or pilot-setting changes, including initial enablement. Replace the full list so removals and a successful empty result reach the device.
- Cache the last successfully downloaded directory in the signed-in user’s messaging PouchDB database. Distinguish initial sync pending from an empty directory. Use the scoped sync API for connected dashboard users.

**Review check.** After initial sync, restart offline and select between two people with the same name. Reassign one, reconnect and verify removal. Confirm that a failed refresh preserves the last complete list and that switching accounts isolates cached entries.

### 6. Sync the offline outbox and downloaded history

- For offline-capable users, save each pending message to the account-scoped messaging PouchDB database before clearing the composer. Run messaging sync at startup, on reconnect, periodically while connected and on manual sync using the WebApp sync lifecycle. Use the messaging API to send pending messages and download accepted history. Save each complete page before advancing its cursor. Keep messaging results independent of clinical replication results. For online-only users, submit directly and retain the draft on a failed request.
- Keep send status in sender-scoped metadata outside the immutable message. Show **Waiting to sync** after a local save and **Sent to server** only after confirmation for that ID. Reconcile uncertain outcomes by retrying with the original ID or by matching the accepted message on download. Persist a terminal eligibility rejection, stop automatic retries for it and let the sender copy the text or choose a currently eligible person for a new send.

**Review check.** Compose offline, restart, interrupt an upload and reconnect. Verify one accepted copy and the correct status after restart. Revoke eligibility before a second upload and verify a visible failure even when clinical sync succeeds.

### 7. Connect the Messages screen

- Extend `webapp/src/ts/modules/messages/` and the send-message modal with an explicit data-message option. Use the directory for new conversations and recheck eligibility for replies. Reuse the list, thread and composer components. Keep SMS phone selection and SMS queries on their existing path.
- Group data messages by the other participant's account ID, separate from SMS thread IDs. Order by `created_at` with `_id` as the tie-breaker. Determine direction from the session account. When someone leaves the directory, keep history readable with an account label or ID fallback and disable replies to them.
- Use existing per-user read metadata for incoming messages. Translate new labels and states. Refresh the open thread and list as messages arrive.

**Review check.** Verify Android-to-dashboard and dashboard-to-Android conversations, unread counts, stable ordering and historical threads after reassignment. Exercise the existing SMS composer and inbox alongside data messaging.

### 8. Verify and pilot

Run the affected API and WebApp unit suites, CouchDB-backed API integration tests and a two-account end-to-end exchange. Include one unrelated online-only account in the privacy checks. Record exact commands, results and any device-only checks in the implementation file.

Include the messaging database in backup and restore procedures. Enable one pilot hierarchy first. Verify directory contents, send and reply in each direction, and complete an offline upload/download cycle. Test disabling the pilot with a pending local send. Disabling must stop new sends, surface the pending send's rejection on reconnect and preserve participant access to accepted history. Expand only after those checks pass.
