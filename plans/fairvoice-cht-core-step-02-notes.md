# Step 02 — Android push registrations

- Added authenticated register, refresh, and unregister endpoints under `/api/v1/data-messaging/push-registrations`. Core derives the account from the CHT session. The [registration API contract](fairvoice-cht-core-fcm.md#android-push-registration-api) describes the request fields, retries, and account switching for the Android client.
- `api/src/services/data-messaging-push-registrations.js` uses the existing server-only CouchDB vault. Each installation has its own record, keyed by a hash of its private installation key. A token refresh preserves the binding. A new signed-in association atomically replaces it. Unregister removes the active token and retains the generation so a delayed request cannot reactivate it. Revision checks and counters prevent concurrent or older requests from undoing a newer update.

## Verification

- Ran `npm run unit-api`. All 1,714 tests passed.
- Ran `api/tests/integration/data-messaging.spec.js` against isolated CouchDB 3.4.3 with authenticated access required. All 14 tests passed. The five registration cases cover raw vault access restrictions, multiple installations, concurrent retries, token rotation, a cookie-authenticated account switch, unauthorized revocation, and invalid requests.
- ESLint passed for every changed JavaScript file. `git diff --check` passed.
- `npm run lint` failed while scanning the nested `OTHER_PROJECTS/` checkout. Excluding that checkout yielded zero ESLint errors and one existing warning in `api/tests/mocha/services/settings.spec.js`. The blank-link check passed, and ShellCheck reported the existing `SC2155` warning in `build-images.sh`.

## Pending verification

The Android client still needs to call the endpoints and exercise token rotation and account switching on a device. Live Firebase delivery is covered by later steps.
