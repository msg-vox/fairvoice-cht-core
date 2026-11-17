# Data messaging using existing CHT sync

## Summary

Reuse the existing Messages screen and PouchDB ↔ CouchDB sync to support **private, one-to-one text conversations**:

- CRs can message supervisors and program officers assigned above them in the place hierarchy.
- Supervisors and officers can message CRs within their assigned hierarchy.
- Android users can compose and read downloaded messages offline.
- Dashboard users can send and receive messages through the web.

**Delivery happens in two steps:** the sender uploads on their next successful sync; the recipient downloads on theirs. Receiving new messages requires connectivity and a successful sync.

## Key changes

### 1. Add a distinct data-message record

Store each message as one document in the existing `medic` database, containing a unique ID, sender, recipient, text, and timestamp.

- Use application account IDs for addressing; phone numbers are unnecessary.
- Keep message content immutable and save each reply as a new document. This avoids two offline devices editing the same conversation document.
- Give data messages a distinct document type so they never enter SMS queues or trigger SMS sending.
- Reuse existing SMS functionality unchanged.

### 2. Add hierarchy-based recipient selection

Use account roles and assigned places to determine eligible recipients.

- Cache a minimal recipient directory through existing sync so Android users can select recipients offline.
- Include names, account IDs, and roles; avoid downloading extra contact trees or other users’ account settings.
- Refresh this directory when account or hierarchy assignments change.
- Validate recipients again on the server when queued messages upload. If an assignment has changed, show an actionable failure instead of silently losing the message.

### 3. Extend replication and access rules

CHT normally shares records according to place and hierarchy. Private conversations need an additional participant-specific rule. [CHT replication documentation](https://docs.communityhealthtoolkit.org/building/guides/performance/replication/)

- Include data messages in existing sync discovery and download paths for their sender and recipient.
- Enforce participant access on server reads, including web dashboard access; filtering the screen alone is insufficient.
- Validate sender identity and permitted recipients on writes, including replication uploads.
- Preserve existing administrator access.
- Keep historical conversations accessible to their original participants after reassignment; apply current hierarchy rules to new messages.

This is the main backend change. No new messaging server, transport, or delivery queue is needed.

### 4. Adapt the Messages screen

Reuse the conversation list, text composer, and read/unread behaviour.

- Replace phone-number selection with eligible staff selection for data messages.
- Determine incoming versus outgoing messages from the signed-in account.
- Save immediately to local PouchDB and show the message offline.
- Show “Waiting to sync”, “Sent to server”, or a failure state. Do not label server upload as delivery to the recipient.
- Use existing sync retries and preserve message IDs to prevent duplicates.

## Test plan and rollout

Verify:

- CR-to-supervisor/officer messaging and replies in both directions.
- Offline composition, app restart, later upload, and recipient download.
- Interrupted sync and retries without duplicate messages.
- Unrelated CRs and managers cannot retrieve private conversations.
- Forged senders, invalid recipients, and reassignment failures are rejected clearly.
- Android users and web dashboard users can communicate.
- Existing SMS workflows remain unaffected.

Enable through configuration and pilot with a small hierarchy before wider rollout.

## Assumptions and limits

- Each participant has an individual CHT account linked to the hierarchy.
- Android users retain offline-capable roles; dashboard users can remain online-only.
- Offline use requires an initial successful login and sync.
- Version one supports text only. Group messaging, attachments, push notifications, and delivery/read receipts are excluded.
- Delivery follows existing sync opportunities; background delivery while Android has closed or suspended the app is not guaranteed.
