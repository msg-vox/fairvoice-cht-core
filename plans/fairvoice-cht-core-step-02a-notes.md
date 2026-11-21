# Step 02a — simplify Android token refresh

The refresh endpoint takes `previous_fcm_token` in place of `token_version`. Core updates the vault record when the previous token matches and acknowledges a retry when the requested token is already stored. The registration generation, binding checks, and CouchDB revision checks still protect account switches and revocation. The [registration API](fairvoice-cht-core-fcm.md#android-push-registration-api) describes refresh retries and recovery after a conflict.

## Verification

- All 1,714 API unit tests and 14 data-messaging integration tests passed. The updated CouchDB integration test covers competing refreshes, a successful retry, and a stale request after a later rotation.
- ESLint passed for the changed JavaScript files. The full `npm run lint` check still fails on the nested `OTHER_PROJECTS/` checkout. With that directory excluded, Core ESLint and the blank-link check passed, and ShellCheck reported the existing `SC2155` warning in `build-images.sh`.
- `git diff --check` passed.

## Pending verification

Android device integration is pending. A token that rotates away and later returns to the same value can make a delayed refresh look current again. The account and binding checks still apply in that case.

## Debug the Android WebView

In the staging WebView's DevTools console, enable push diagnostics and reload:

```js
localStorage.setItem('fairvoice.push.debug', '1');
location.reload();
```

Filter the console for `[Fairvoice push]`. The trace reports bridge availability, session and router readiness, registration operations and HTTP statuses, logout, receipts, taps, and history refresh. It records whether a binding was present. Token values, keys, account IDs, bindings, and message content are excluded.

A healthy first sign-in shows `Android bridge connected`, an outgoing `session`, a `register` result with HTTP `200`, an accepted registration, and an outgoing `ready`. If the installation already has a current binding, Android can publish it directly and skip the registration POST. An HTTP status of `0` means the browser did not receive a usable HTTP response. A `412` indicates the local or server session did not match the request.

Disable tracing with `localStorage.removeItem('fairvoice.push.debug')`.
