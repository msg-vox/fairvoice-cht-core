# Fairvoice Automated SMS Login Plan

## Goal and scope

When the Fairvoice app opens, an existing CHT session continues normally. If CHT shows a stable logged-out route, the app discovers a usable phone number from the active SIM subscriptions, requests an SMS challenge, receives the code with Google's SMS Retriever API, and submits it in the CHT WebView. The server creates the normal CHT session and redirects into the app.

After the initial phone-permission grant, successful login requires no routine user input. A failure shows a diagnostic screen with **Send diagnostics** and **Retry login**. Explicit logout cancels an active attempt and suppresses automatic login until the user next opens the app from its launcher; returning to the still-open app from the task switcher does not restart login.

This feature is limited to the `fairvoice` product flavor. Other flavors keep their existing OIDC Custom Tab behavior and permissions.

## Feasibility gate

Before building the Android flow, prove these assumptions with the actual Fairvoice staging service and representative single- and multi-SIM devices:

1. CHT can expose a stable same-origin logged-out route **before** redirecting to Rauthy. The app cannot inspect or fill a Chrome Custom Tab.
2. The Fairvoice/Rauthy SMS provider can send an app-hash SMS challenge, verify its code, map the verified phone number to the right CHT user, and create the same CHT session as the existing OIDC login.
3. The target carriers and devices expose enough correct SIM phone numbers for unattended login to be useful. Android may return an empty or incorrect number even with an active SIM; SMS verification, not the SIM-reported number, proves possession.
4. A build signed with the staging distribution certificate receives the SMS through SMS Retriever. Repeat this for the production signing identity before release.

Record the number-discovery success rate, supported Android versions, and failure cases. If SIM numbers are commonly absent, decide whether the diagnostic-only outcome is acceptable before investing in the rest of this plan.

## Server contract

The paths below are proposed contracts. Confirm the exact route and response formats with the CHT server team before client implementation.

### Start a challenge

`POST /medic/login/oidc/sms/start` accepts a normalized E.164 `phone_number`. A successful response supplies an opaque `challenge_id` and `expires_in`. The server sends the OTP only by SMS, binds it to the challenge and Fairvoice tenant/environment, and invalidates older challenges when replaced. Apply per-number and per-source rate limits. The client tries discovered numbers sequentially, starting with the default SMS subscription, and stops after the first accepted challenge.

For multi-SIM iteration, provide a stable response that tells the client whether it may try another number. Do not expose account details or a registered-number message to the user. Treat this response as an enumeration risk and test the rate limits against it.

### Verify and establish the session

`POST /medic/login/oidc/sms/verify` accepts form-encoded `challenge_id` and `code` through `WebView.postUrl`. On success, the server consumes the challenge, sets the normal CHT session cookie, and redirects to the usual authenticated route. Invalid, expired, replayed, and rate-limited attempts receive stable non-secret error responses that the Android flow can recognize. The OTP must never be placed in a URL.

This endpoint replaces a separate completion-token exchange. It is viable only if CHT can create the authenticated session in this WebView request. The logged-out route should issue a pre-authentication cookie; the native start request forwards that cookie only to the trusted CHT origin, and the server binds the challenge to it. The WebView verify request must present the same cookie. This prevents another site from logging a user into an attacker's account with its own valid challenge. If the server cannot support this binding, retain a separate completion step with equivalent login-CSRF protection. Confirm the existing session's cookie attributes and account mapping are preserved.

### Logged-out and logout routes

CHT exposes a stable logged-out route for the app to detect before any external OIDC navigation. Its explicit logout path supplies an unambiguous signal, such as `?explicit_logout=1`, and does not immediately redirect to the IdP. A normal session expiry reaches the logged-out route without that signal.

### Diagnostics

`POST /medic/login/oidc/sms/diagnostics` accepts a redacted structured report and returns a short reference ID. Upload occurs only after the user presses **Send diagnostics**. Include only useful non-secret fields: app/build version, Android version and device model, login stage and error code, permission/network/Play Services state, counts of subscriptions and usable numbers, and attempt timing. Exclude phone numbers, SMS bodies, OTPs, challenge IDs, cookies, authorization headers, and CHT content. Reuse an existing server reporting service if one already meets this contract.

### SMS template

The SMS must be at most 140 bytes, contain an unpredictable one-time code, and include the 11-character SMS Retriever hash for the installed package and signing certificate. Use a simple, fixed format that the client can parse. A short challenge marker is optional if tests show stale or overlapping Fairvoice messages need client-side correlation; the server always verifies the code against `challenge_id` regardless. Configure and test hashes for staging, production, and any debug build used for end-to-end testing.

## Delivery milestones

### 1. Server contract and staging proof

- Implement the logged-out/logout routes, start and verify endpoints, SMS template, and diagnostic receiver.
- Prove a staging challenge can be verified once and creates a valid CHT WebView session. Test expiry, replay, rate limits, account mapping, tenant binding, and login-CSRF protection.
- Test signed-build SMS retrieval and measure SIM-number availability on representative devices. Resolve the feasibility gate before continuing.

### 2. Fairvoice Android flow

- Add one Fairvoice build switch, the SMS Retriever dependency, and `READ_PHONE_NUMBERS` plus `READ_PHONE_STATE` only in the Fairvoice manifest. Mark telephony hardware optional and show a prominent disclosure before requesting permissions. Do not add `READ_SMS` or `RECEIVE_SMS`.
- Discover active subscriptions, prioritize the default SMS subscription, normalize numbers to E.164 using each subscription's country, and deduplicate them. Use `SubscriptionManager.getPhoneNumber` on API 33+, `SubscriptionInfo.getNumber` on API 22–32, and define API 21 as unsupported for unattended SIM discovery unless a tested fallback is added. Treat missing, malformed, and incorrect carrier numbers as expected outcomes. Keep numbers out of logs and persistent storage.
- Start SMS Retriever before requesting a challenge. Register its receiver only for the active attempt, require the Play Services sender permission on that receiver, parse the expected code, and enforce challenge expiry within the retriever's five-minute window. Clean up on success, failure, retry, activity destruction, or logout.
- Use one coordinator for one active attempt. Coalesce duplicate page callbacks and broadcasts, try candidate numbers sequentially, and keep stage/error codes concise. Submit the accepted challenge and received code once through the WebView POST. Clear transient credentials at the end of the attempt.
- Detect only the agreed same-origin logged-out and logout routes in `UrlHandler`. Preserve existing startup and recent-navigation behavior for valid sessions. Store logout suppression in app-level memory and clear it on the next deliberate launcher entry, including when Android kept the process alive. Limit automatic retries to avoid redirect loops.
- Add the failure screen with the local error code, **Send diagnostics**, returned reference ID, and **Retry login**. Retry cancels the old attempt and restarts from number discovery. Handle offline uploads and duplicate taps.

### 3. Verification and rollout

- Unit-test number discovery/normalization, SMS parsing, and the coordinator's success, duplicate, timeout, cancellation, and retry behavior. Add integration tests for logged-out detection, WebView session creation, explicit logout, and normal session expiry.
- Test merged manifests and OIDC navigation for at least one non-Fairvoice flavor. Verify that phone permissions are absent there.
- Test the staging flow on supported single- and multi-SIM devices with the real signing identities. Cover an allowed second SIM, missing number, missing/outdated Play Services, delayed or missing SMS, expired/replayed OTP, diagnostic upload, and retry after failure.
- Confirm credentials do not appear in URLs, recent-navigation storage, intents, logs, or diagnostic reports. Restrict WebView debugging to debug builds: `EmbeddedBrowserActivity.enableRemoteChromeDebugging()` currently enables it unconditionally.
- Roll out to a small device group first and monitor aggregate challenge, delivery, verification, and session failures without recording phone numbers or OTPs.

## Completion criteria

The feature is complete when a correctly signed Fairvoice build completes the supported unattended-login scenarios, a valid CHT session bypasses SMS entirely, explicit logout remains suppressed until the next launcher entry, failures produce a safe report and can be retried, and other flavors retain their existing manifests and OIDC behavior. Document any device/API/carrier combinations where unattended number discovery is unsupported.

Platform references: [SMS Retriever overview](https://developers.google.com/identity/sms-retriever/overview), [Android client guide](https://developer.android.com/identity/sms-retriever), [server requirements](https://developers.google.com/identity/sms-retriever/verify), [SubscriptionManager](https://developer.android.com/reference/android/telephony/SubscriptionManager), [WebView.postUrl](https://developer.android.com/reference/android/webkit/WebView#postUrl(java.lang.String,%20byte%5B%5D)).
