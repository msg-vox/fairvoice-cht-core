# Step 04 — dispatch queued alerts through FCM

The API runs dispatch independently of message acceptance. Before sending, it checks the configured data-messaging pilot and the current relationship between the sender and recipient. After getting its OAuth credential, it reads the installation again and verifies the queued account and binding. A token refresh for the same binding uses the latest token. The sender label uses the same trusted settings and name fallback as the messaging directory.

The worker sends the six-field data contract over FCM HTTP v1 with Android high priority. Jobs expire five minutes after enqueue, and FCM receives only the remaining lifetime. Jobs created before the queue recorded an enqueue timestamp expire immediately because their age is unknown. [FCM message resource](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)

A revision-checked, 60-second lease coordinates API instances. A successful response records FCM acceptance. If recording it fails, another attempt can replay the same canonical message ID after the lease expires. Transient failures persist a jittered backoff and honor Firebase's Retry-After header. Token-specific rejections clear the token using its original CouchDB revision, preserving the installation generation and any concurrent token rotation. Completed jobs retain their IDs for queue replay deduplication. [FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes)

## Deployment

Keep `DATA_MESSAGE_PUSH_SEND_ENABLED` unset until a compatible Android build is ready for the pilot. Enable dispatch by setting it to `true` and setting `DATA_MESSAGE_PUSH_FIREBASE_PROJECT_ID` to the deployment's Firebase project ID in the API runtime environment. Provide the runtime identity through Application Default Credentials, configure the existing data-messaging pilot, and keep the step 3 queue active. [Firebase setup](firebase-setup.md) · [Pilot checkpoint](fairvoice-cht-core-step-03-notes.md#pilot-activation)

## Files

- `api/server.js` starts the dispatch worker.
- `api/src/services/data-messaging-push-dispatch.js` scans vault jobs, claims leases, checks the pilot, and records delivery results.
- `api/src/services/data-messaging-fcm.js` handles ADC, the bounded HTTP request, and Firebase response classification.
- `api/src/services/data-messaging-push-queue.js` records when each job was queued.
- `api/src/services/data-messaging-push-registrations.js` checks bindings and retires invalid tokens.
- `api/src/services/data-messaging.js` and `shared-libs/user-management/src/users.js` expose the directory's sender display-name rule.
- `package.json` and `package-lock.json` promote Google Auth to a production dependency.

## Verification

- All 47 focused data-messaging tests passed, including outage isolation, post-send replay, worker contention, and token rotation.
- A disposable CouchDB 3.4.3 smoke test with stubbed Firebase verified a persisted retry after HTTP 503 and a successful send on the next attempt.
- ESLint passed for all changed JavaScript files. The production dependency install dry run passed.
- All 1,729 API unit tests passed. The command exited unsuccessfully because the global coverage thresholds were unmet.
- `npm run lint` failed on ESLint errors in the nested `OTHER_PROJECTS/` checkout and stopped before the blank-link and ShellCheck stages.
- Live Firebase credentials, Android display, and the pilot deployment remain unverified.

## Trace push jobs on staging

Set `DATA_MESSAGE_PUSH_DEBUG=true` in the CHT API environment and recreate the API service. Filter its logs for `[Fairvoice push]`. This reports the registration HTTP status, queue and dispatch activation, recipient installation count, why a job was skipped or retried, and the Firebase HTTP status or known rejection code. It traces token acquisition separately from the Firebase HTTP call. Tokens, credentials, keys, bindings, document IDs, and message content are excluded.

Send a new CHT message after the recipient registers. A queue count of zero means Core found no active installation for that recipient. A dispatch result of `sent` means Firebase accepted the request. Check the Android app to confirm receipt and display. `SENDER_ID_MISMATCH` points to a difference between the Firebase sender project and the project that issued the device token. For a Firebase `401` or `403`, check the staging API credentials and role on that project. Unset the debug variable and recreate the API service when finished.
