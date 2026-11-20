# Step 02a — simplify Android token refresh

The refresh endpoint takes `previous_fcm_token` in place of `token_version`. Core updates the vault record when the previous token matches and acknowledges a retry when the requested token is already stored. The registration generation, binding checks, and CouchDB revision checks still protect account switches and revocation. The [registration API](fairvoice-cht-core-fcm.md#android-push-registration-api) describes refresh retries and recovery after a conflict.

## Verification

- All 1,714 API unit tests and 14 data-messaging integration tests passed. The updated CouchDB integration test covers competing refreshes, a successful retry, and a stale request after a later rotation.
- ESLint passed for the changed JavaScript files. The full `npm run lint` check still fails on the nested `OTHER_PROJECTS/` checkout. With that directory excluded, Core ESLint and the blank-link check passed, and ShellCheck reported the existing `SC2155` warning in `build-images.sh`.
- `git diff --check` passed.

## Pending verification

Android device integration is pending. A token that rotates away and later returns to the same value can make a delayed refresh look current again. The account and binding checks still apply in that case.
