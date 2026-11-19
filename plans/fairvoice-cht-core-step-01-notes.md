# Step 01 — Android data message push contract

- Defined the version 1 FCM payload in the [Core plan](fairvoice-cht-core-fcm.md#android-data-message-push-contract). It carries the canonical message ID, full sender account ID, trusted display name with a username fallback, and opaque recipient binding. It omits message text.
- Defined separate WebView receipt and tap events, readiness, acknowledgement statuses, and replay rules. The examples cover a duplicate foreground receipt, a cold-start tap to an account ID containing a colon, and a stale event after an account switch. The [Android plan](cht-android-fcm.md) links to the contract. This step changes documentation only.

## Verification

- Ran the Core data messaging service and directory watcher Mocha suites. All 32 tests passed.
- Ran the user-management Mocha tests for individual messaging account lookup and directory display names. All five passed. Both Mocha runs used `UNIT_TEST_ENV=1` with local CouchDB configuration values.
- Parsed the sample FCM JSON and checked its six string fields, canonical ID prefixes and UUID, full sender thread route, and local documentation links. `git diff --check` passed.
- Ran `npm run lint`. ESLint failed on files in the nested `OTHER_PROJECTS/` checkout. Reran ESLint with that directory excluded and got zero errors and one existing warning in `api/tests/mocha/services/settings.spec.js`. The blank-link check passed. ShellCheck reported the existing `SC2155` warning in `build-images.sh`.

## Pending verification

Android team agreement on the wire and bridge contract is pending. Live FCM delivery, the WebView handshake, and warm and cold taps need the implementations from later steps and staging verification.
