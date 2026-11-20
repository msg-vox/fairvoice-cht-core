# Step 03 — queue alerts for accepted messages

The API worker reads canonical first revisions from the dedicated messaging database in CouchDB sequence order. Delayed offline uploads qualify when Core accepts them after activation, regardless of their client timestamp. Identical submission retries keep the original document and produce no new change.

The server-only vault holds the checkpoint and one job keyed by message ID and installation ID. The worker saves all jobs in a page before advancing the checkpoint using its CouchDB revision. Replaying the page after a failure or concurrent write reuses existing jobs. Each job captures the recipient binding at enqueue time and stores account and installation IDs without copying the FCM token or message text.

## Pilot activation

At pilot activation, read `update_seq` from the dedicated messaging database's info response. Set `DATA_MESSAGE_PUSH_ACTIVATION_SEQUENCE` to that exact value in the API runtime environment. The worker is off when the variable is unset. Keep it configured on restart. The vault's persisted checkpoint takes precedence over the initial sequence after the first startup. Preserve the checkpoint and jobs across API restarts.

## Files

- `api/server.js` starts the worker after migrations.
- `api/src/services/data-messaging-push-queue.js` consumes changes and writes jobs and checkpoints.
- `api/src/services/data-messaging-push-registrations.js` looks up active installations for each recipient.
- `api/tests/mocha/services/data-messaging-push-queue.spec.js` covers delayed uploads, identical retries, and restarting after jobs are written but before the checkpoint advances.

## Verification

- All 35 focused data-messaging tests passed.
- ESLint passed for the changed JavaScript files.
- All 1,717 API unit tests passed. The command exited unsuccessfully because the global coverage thresholds were unmet.
- A smoke test against disposable CouchDB 3.4.3 confirmed that the activation sequence skips an existing message and that processing the post-activation upload twice leaves one job and an advanced checkpoint.
- `npm run lint` failed on ESLint errors in the nested `OTHER_PROJECTS/` checkout and stopped before the blank-link and ShellCheck stages.
- Deployment and pilot activation remain pending. FCM delivery is step 4.
