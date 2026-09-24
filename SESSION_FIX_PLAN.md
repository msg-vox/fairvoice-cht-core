# Session Fix Plan — fresh authentication after explicit logout

## Problem

In the Fairvoice Android app (and in browsers), choosing **Log out** from the CHT
menu and then starting a new **Login with SSO** lets the user straight back in
without any credential prompt.

Root cause, verified in code:

1. **CHT logout is purely local.** The menu's "Log out" runs
   `SessionService.logout()` (`fairvoice-cht-core/webapp/src/ts/services/session.service.ts:42-53`),
   which only issues `DELETE /_session` (proxied to CouchDB, invalidating the
   `AuthSession` cookie) and deletes the JS-readable `userCtx` cookie. There is no
   OIDC-aware logout anywhere in cht-core — no `end_session_endpoint` call, no
   `post_logout_redirect_uri`. The browser never visits Rauthy during logout, so
   the Rauthy session survives.
2. **cht-android never clears anything.** No `CookieManager.removeAllCookies`, no
   cache/storage clearing, no logout interception exists in the app. On the
   fairvoice flavor the whole OIDC flow runs top-level inside the WebView
   (`UrlHandler.shouldOverrideUrlLoading`, lines 73-78), so Rauthy's session
   cookie on `auth.fairvoice.net` is a first-party cookie in the WebView's shared
   cookie jar and survives CHT logout indefinitely.
3. **The SSO authorize request carries no re-authentication signal.**
   `getAuthorizationUrl` (`fairvoice-cht-core/api/src/services/sso-login.js:90-98`)
   sends only `redirect_uri` and `scope` — no `prompt=login`, no `max_age`. With a
   valid session and no such parameter, Rauthy 0.36.2 takes the
   `FrontendAction::Refresh` path in its authorize handler and immediately
   redirects back with an authorization code. That is standard SSO behavior.
4. **Amplifier on Android:** the fairvoice build's `FairvoiceLoginCoordinator`
   auto-clicks the SSO button the moment the CHT login page renders, so after
   logout the entire round trip can happen by itself.

This plan implements `LOGIN_PLAN_1.md` changes #1-#3: an explicit-logout marker,
a browser-bound OIDC transaction (state/nonce/PKCE), and a fresh-authentication
opt-in via `max_age=0` with `auth_time` validation.

## Verified facts the design relies on

- **Rauthy 0.36.2** honors `max_age=0` / `prompt=login` (`force_new_session` in
  `src/api/src/oidc.rs`), emits `auth_time` in every ID token
  (`src/service/src/token_set.rs:347`), and echoes `nonce`. A forced new session
  produces a fresh `auth_time`.
- **sms-idp** (the embedded provider in this repository) holds only a
  per-transaction cookie — no SSO session of its own — so a forced Rauthy
  re-authentication necessarily produces a fresh SMS challenge. **No sms-idp
  changes are needed.**
- **openid-client 6.5.0** (installed in fairvoice-cht-core) supports
  `randomState` / `randomNonce` / `randomPKCECodeVerifier` /
  `calculatePKCECodeChallenge`, and `authorizationCodeGrant` checks
  `{ expectedState, expectedNonce, pkceCodeVerifier, maxAge }`. Its `maxAge`
  check is `auth_time + maxAge < now - tolerance` with a **30 s default
  tolerance**, so `maxAge: 0` safely tolerates normal clock skew.
- **CHT's CouchDB session lifetime is 1 year**
  (`fairvoice-cht-core/couchdb/10-docker-default.ini:26-29`,
  `timeout = 31536000`, `allow_persistent_cookies = true`). Offline data
  collection is local PouchDB and never involves OIDC. The only
  re-authentication users hit in practice is after explicit logout; natural
  session expiry is unaffected by this plan.

## Design overview

```text
logout() ──► /medic/login?...&explicit_logout=1
                │  login.get sets HttpOnly cookie `oidc_fresh=1` (30d)
                │  Android coordinator sees marker → suppresses auto-SSO-click
                ▼
next SSO authorize (auto after launcher re-entry, or manual tap)
                │  oidcAuthorize consumes `oidc_fresh` → adds max_age=0
                │  + creates signed tx cookie (state, nonce, PKCE verifier,
                │    fresh flag, created)
                ▼
Rauthy (force_new_session) → sms-idp fresh SMS → callback
                │  oidcLogin reads+clears tx cookie, validates state/nonce/PKCE
                │  (+ maxAge:0 → auth_time must be fresh) via openid-client
                ▼
        CHT session created (unchanged path)
```

Ordinary SSO (no explicit logout): no `oidc_fresh` cookie → no `max_age` →
byte-identical behavior to today.

## Part 1 — fairvoice-cht-core (webapp): explicit-logout marker

1. **`webapp/src/ts/services/session.service.ts`** — in `logout()`'s
   `navigateToLogin()` path only, add `explicit_logout=1` to the login URL
   params. The `init()` / no-userCtx path (automatic re-authentication) and the
   bootstrapper `redirectToLogin()` stay marker-free.
2. **Karma tests** `webapp/tests/karma/ts/services/session.service.spec.ts` —
   update the `'logs out'` expected URL to include the marker; add an assertion
   that the no-userCtx path does **not** include it.

## Part 2 — fairvoice-cht-core (api): transaction binding + fresh-auth opt-in

3. **`api/src/services/openid-client.js`** — re-export `randomState`,
   `randomNonce`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge` (the
   wrapper exists so tests can stub them).
4. **`api/src/services/sso-login.js`**:
   - `buildTransaction(requireFreshAuth)` → generates state/nonce/PKCE
     verifier+challenge; returns `{ cookieValue, authParams }`. `cookieValue` =
     `base64url(json).base64url(hmac-sha256)` where json =
     `{s, n, v, f, t}` (state, nonce, verifier, fresh flag, created epoch) and
     the HMAC key is the existing `couch_httpd_auth/secret` from
     `secureSettings.getCouchConfig` (already used in `getCookie`). Signing
     blocks sibling-domain cookie fixation across the shared `fairvoice.net`
     eTLD+1 and makes the fresh flag tamper-proof.
   - `parseTransaction(cookieValue)` → verifies HMAC + expiry (10 min), returns
     the transaction or throws.
   - `getAuthorizationUrl(redirectUrl, tx)` → params become
     `{ redirect_uri, scope, state, nonce, code_challenge,
     code_challenge_method: 'S256' }` plus `max_age: '0'` when `tx.f`.
   - `getIdToken(currentUrl, tx)` → grant checks
     `{ expectedState: tx.s, expectedNonce: tx.n, pkceCodeVerifier: tx.v,
     idTokenExpected: true }` plus `maxAge: 0` when `tx.f`.
5. **`api/src/services/cookie.js`** — add `setOidcTransaction` (HttpOnly,
   SameSite=Lax, Secure in production, Max-Age 600, Path `/<db>/login/oidc`),
   `clearOidcTransaction`, and `setOidcFreshLogin` (HttpOnly, Lax, 30 days).
   Clear `oidc_fresh` in the existing `redirectToApp` login cleanup as hygiene.
6. **`api/src/controllers/login.js`**:
   - `get` (login page render): if `req.query.explicit_logout === '1'` →
     `cookie.setOidcFreshLogin(res)`. Nothing else changes; the page never
     auto-redirects to the IdP, satisfying "the marker must not trigger an
     immediate IdP redirect".
   - `oidcAuthorize`: read `oidc_fresh` (presence = opt-in, then clear it);
     `buildTransaction(fresh)`; set the tx cookie; respond `302` with the URL in
     the body (**contract preserved** for the WebView XHR flow).
   - `oidcLogin`: read + **always clear** the tx cookie first (one-time;
     replay/missing → `sso_error=loginerror`); pass the transaction to
     `getIdToken`; the rest of the session-creation path is untouched.
7. **Config**: none. Uses the existing `oidc_provider` settings; no Rauthy
   client changes (redirect URI unchanged; `max_age` needs no registration).

## Part 3 — cht-android: suppress auto-login on the marker page

8. **`FairvoiceLoginCoordinator.java`** — in `accept()`'s `CHT_LOGIN` branch: if
   `Uri.parse(currentUrl).getQueryParameter("explicit_logout")` is present,
   enter a new `State.EXPLICIT_LOGOUT` and **skip the `CLICK_SSO` action**
   (a manual tap still works — the fresh-auth cookie is server-driven). Any
   later navigation to a marker-free `/medic/login` starts a normal new attempt
   (auto-click resumes); a task-switcher resume fires no navigation, so
   suppression persists until deliberate re-entry. No persistence and no
   `EmbeddedBrowserActivity` / `UrlHandler` changes are needed — deliberate
   launcher re-entry always navigates away from the marker page (`onNewIntent` →
   app root, or cold start → last valid URL, both redirecting to plain
   `/medic/login`).
9. **Robolectric tests** — marker page → zero JS actions; marker → plain
   navigation re-arms auto-click; manual flow unaffected.

## Part 4 — Test updates (fairvoice-cht-core)

10. **`tests/utils/mock-oidc-provider.js`** — authorize endpoint: echo `state`
    in the redirect, record `nonce` / `max_age`, expose `lastAuthorizeParams`;
    token endpoint: include the recorded `nonce` and `auth_time` (now; plus a
    test knob for stale `auth_time`). Keep accepting fabricated codes for
    error-path tests.
11. **Unit** — `api/tests/mocha/services/sso-login.spec.js`: update the pinned
    `buildAuthorizationUrl` / `authorizationCodeGrant` params; new tests for
    transaction build/parse (bad HMAC, expired), fresh flag →
    `max_age` / `maxAge`, missing `auth_time` failure.
    `api/tests/mocha/controllers/login.spec.js`: tx cookie set/cleared,
    missing-cookie → `loginerror`, `explicit_logout` → fresh cookie.
    `cookie.spec.js` for the new helpers.
12. **Integration** — `tests/integration/api/controllers/login.spec.js`: replace
    the exact-URL pin (lines 414-423) with parsed-param assertions; rework the
    SSO tests to drive authorize-first (cookie jar) then callback; add:
    missing/mismatched state, fresh flow after `explicit_logout=1` (assert
    `max_age=0` reaches the mock), stale `auth_time` → `loginerror`, ordinary
    SSO unchanged.
13. **e2e** — `tests/e2e/default/login/sso-login.wdio-spec.js` keeps working via
    the updated mock; optionally add an explicit-logout → fresh-auth scenario.

## Part 5 — Verification & docs

14. Run `npm run lint` + the focused unit suites + `npm run integration-api` in
    `fairvoice-cht-core`; run the fairvoice-flavor unit tests in `cht-android`.
    `jj commit` per repo at logical points, following each repo's message style.
15. **Staging proof** (per `LOGIN_PLAN_1.md` step 7): explicit logout → next
    launcher entry demands a fresh SMS despite a live Rauthy session; natural
    session expiry → ordinary silent SSO; stale Rauthy session; mismatched
    state; replayed callback — none may create a session. Confirm empirically
    that the deployed Rauthy returns a fresh `auth_time` through the upstream
    sms-idp path.
16. Update `LOGIN_PLAN_1.md`'s staging-handoff section to record what is now
    implemented vs. still open.

## Non-goals

- RP-initiated logout (destroying the Rauthy session at CHT logout) — not
  included; this plan forces fresh authentication at next login instead.
- No Rauthy, sms-idp, or user-manager changes.
- No change to ordinary SSO or to offline behavior.

## Key risks

- **Clock skew** > 30 s between the CHT api and Rauthy would break fresh logins
  (the `auth_time` tolerance). Both are NTP-synced hosts; verify on staging.
- **Launcher variance:** launchers that bring the existing task forward with no
  callback leave the suppressed login page showing; the user taps SSO manually
  and is still fresh-authenticated (acceptable degradation).
- The webapp URL change is fairvoice-internal; no migration is needed.
