# Tobias Quinn — historical changelog

Changes authored by `tobias@tobiasquinn.com`, from **2026-04-10 to 2026-10-19**.
Related implementation, fixes, tests, and planning changes are grouped by outcome rather than listed commit by commit.

## Scope and dates

Reviewed the full visible history using `jj log -r 'all()'`, then inspected the messages and diffs of all 67 matching author revisions, including the empty working-copy revision. Current-branch entries below are changes in `ancestors(@)` at the time of review (parent commit `bd51595f2ce6`). Earlier work found on other heads is recorded separately so the history reaches back to Tobias's first contribution without implying it has been integrated into this branch.

Dates use the original **author timestamp and its recorded timezone**, rather than the committer timestamp: several August and September changes were recommitted on October 2. Date ranges indicate development across multiple days, not release dates. Commit IDs are representative references for inspecting the underlying work with `jj show -r <id>`. Equivalent changes on multiple heads are summarized once; empty revisions and an alternative generated changelog are not treated as features.

## Current branch

### 2026-10-18–2026-10-19 — Switch application language from the toolbar

- Added a reusable globe-menu language picker to the toolbars for Responses, contacts, messages, tasks, analytics, training, and UI-extension tabs. Choices come from the configured enabled languages; the picker appears when more than one language is available.
- Kept the selection synchronized with committed language state and the existing language service. Switching runs one request at a time, persists through the existing locale mechanism, and attempts to restore the previous language on failure, with visible error and recovery messages.
- Added accessible menu choices with selected-state announcements and isolated language names, plus support for current and legacy navigation layouts. Follow-up fixes repaired the globe artwork, removed the duplicate picker from the report detail pane, and moved the desktop control to the toolbar's trailing edge.
- Refreshed localized JSON/XML form summaries and report-list titles when the language or XML form definitions change. Relative-date displays are explicitly refreshed after translations and date formatting are ready.
- Added unit tests and shared desktop/mobile end-to-end scenarios covering persistence, offline use, RTL, keyboard interaction, error recovery, and preservation of an open form's unsaved input. Changing the application language does not recreate an open Enketo form or promise to translate that form live.
- The October 18 implementation record reports 46 focused Chrome tests passing, but also records incomplete broader runtime validation; added end-to-end scenarios should not be read as evidence that every scenario passed.

References: `bc5c91733275`, `49dc25472828`, `bf41fb3f3c73`, `fc4994de07d7`, `7ff14f4acd3c`, `34d8c4e2aad1`, `cee6c568839d`, `bd51595f2ce6`.

### 2026-10-19 — Let UI extensions respond to language changes

- Mounted UI-extension web components receive a `cht-language-changed` event with `detail: { code }`, both for the initial committed language after mounting and for subsequent distinct committed language codes.
- Preserved the mounted extension instance and its inputs during language changes. Guarded asynchronous initialization so replaced or destroyed extensions cannot mount stale content or receive later notifications.
- Added tests for initial delivery, repeated or missing codes, delayed initialization, replacement, destruction, and stale loading failures, and documented the extension event in the main changelog.

Reference: `f92505decac4`.

### 2026-10-19 — Refresh browser compatibility metadata

Updated the root dependency lockfile's browser-support data using `update-browserslist-db`.

Reference: `8bd4af0823b5`.

### 2026-10-18 — Separate response-list access from report-detail access

- Introduced explicit `can_view_report_details` grants in default, COVID-19, and test configurations, allowing deployments to grant list access without opening individual responses.
- Applied the new permission throughout the webapp's report routes, content panes, selection effects, actions, and report links from contacts. List-only users see inert rows and cannot trigger detail loading or detail-dependent actions through those UI paths.
- Preserved report creation for users with the relevant creation permissions. Saving or cancelling returns users without detail access to the list, while authorized users can return to the individual report.
- Added desktop/mobile end-to-end coverage for explicit detail grants, list-only access, direct navigation, and creation. These changes implement webapp access controls; the diffs do not introduce a new server-side data-access boundary.

References: `613e24b91c91`, `04a88f09dafb`, `ae0de357cc41`.

### 2026-10-17 — Present reports as “Responses”

Renamed the reports tab and list toolbar to **Responses**, with English, Spanish, French, Nepali, and Swahili labels and updated tab-service tests. Existing report route names and document types remain the basis of the feature.

Reference: `b582e3f28d56`.

### 2026-10-16 — Automate Fairvoice image builds and publishing

Added executable `build-images.sh` to install dependencies, build the datasource and application, expose local build tools, build service images, and tag and push the Fairvoice API image to the configured registry. The script targets `5.3.1-fairvoice.1`.

Reference: `9734aff21360`.

### 2026-09-24 — Bind OIDC sign-in to a browser transaction and require fresh authentication after logout

- Added a signed, ten-minute OIDC transaction containing random state, nonce, a PKCE verifier, creation time, and a fresh-authentication flag. Authorization uses S256 PKCE; the callback checks the corresponding state, nonce, and verifier during token exchange.
- Validated transaction signatures and structure, rejected expired or future-dated transactions, and cleared the transaction cookie when consuming a callback. Cookies are HTTP-only and scoped to the relevant login paths.
- Distinguished deliberate logout from automatic reauthentication with an `explicit_logout` marker. A deliberate logout causes the next OIDC authorization to request fresh authentication with `max_age=0`, with corresponding token checks, rather than silently relying on an existing identity-provider session.
- Added service, controller, cookie, and webapp session tests. Documented the requirement to enable S256 PKCE for the Rauthy CHT client.
- This is the CHT-side authentication implementation. It does not establish completion of the separate Android/SMS-provider rollout or prove fresh SMS verification on deployed devices.

References: `1b5edf89e83b`, `c966b73e2e74`, `26a8d477d7b7`, `c8010dbfaa22`.

### 2026-09-23 — Define the automated SMS-login integration

Added an automated SMS-login plan covering challenge creation, verification and session establishment, logout behavior, diagnostics, SMS templates, feasibility checks, and staged delivery. This revision adds documentation, not an SMS-login endpoint implementation. Also added Python 3 to the mise development tools.

References: `4a754b7369d9`, `bff50b344ac8`.

### 2026-09-01–2026-10-02 — Document reproducible Fairvoice infrastructure builds

Established build, image-tagging, and registry-publishing instructions on September 1 for `5.2.0-fairvoice.1`. Updated them on September 24 for the `.2` build containing the logout/session work, then on October 2 for `5.3.1-fairvoice.1`, including dependency installation and an explicit datasource build before the application build.

References: `a130fd867954`, `ceaf0fda5eca`, `8baf5de6140c`.

### 2026-08-26–2026-08-28 — Apply Fairvoice visual branding

- Replaced the webapp's palette with the brand's sky blue, mint, orange, pink, purple, and neutral colors, including darker variants for text-bearing status elements.
- Updated toolbar, navigation, messaging, report-status, target, and Enketo summary styling. Adjusted foreground colors on dark toolbars and bright message backgrounds to improve readability.
- Changed the main typeface to Alegreya Sans and bundled its Black font with swap loading on August 28.

References: `a927da4df756`, `d2764d4c2a27`. An earlier branding variant also exists as `9401c13dc83e` outside the current ancestry.

### 2026-08-26–2026-08-27 — Stabilize local development builds

Pinned Node.js 22 through mise and reordered `build-dev` so the shared datasource builds before build preparation. Added ignore rules for temporary development documentation. Equivalent toolchain and build-order revisions also appear on other heads and are not counted as separate features here.

References: `1f341a184dca`, `7b1622931803`, `b2572e4b281f`.

## Earlier and parallel work outside the current branch ancestry

These entries were found through `all()` but are not ancestors of the reviewed working copy. They record historical implementation or investigation, not features confirmed present in the current branch.

### 2026-10-18 — Explore immediate localization of open report details

Extended the language-switching work to recompute form titles, reformat an already-open report, and re-render date pipes when the language changes. Added report/form/date regression tests and corrected test typings. The current branch includes a separate report-list/form-summary refresh and relative-date service update, but these particular open-report and date-pipe changes are on another head.

References: `caf5ab173fa0`, `a7d39e0d5196`, `675e9cb2e3fc`, `241bc41793d9`, `b94189a2c9de`.

### 2026-09-23 — Record the Rauthy/SMS browser-session handoff

Added a CHT-specific integration plan describing ownership across CHT, Rauthy, sms-idp, and the Fairvoice Android wrapper, including the requirement to keep the redirect chain in one WebView. The document records a successful manual SMS sign-in and retained session on one Android debug build after an external sms-idp redirect-policy fix. Signed-build acceptance, deliberate logout/fresh-SMS behavior, expiry, and failure scenarios remained open in that record. Android and sms-idp changes described there belong to their own projects.

Reference: `24de378f918b`.

### 2026-08-26 — Investigate deployment and search infrastructure

Added a `cht-core.yml` Compose definition for API, Sentinel, HAProxy, and NGINX services with shared networking and SSL storage. A separate revision explicitly marked WIP removed Nouveau contact/report search and replication-key indexes, the Nouveau shared library and its tests, and its Helm service template. These are recorded as deployment/search experiments, not as a completed replacement for Nouveau.

References: `e4fc8cb7baa5`, `dc43aeb6ca74`.

### 2026-04-11–2026-04-13 — Prototype SurveyJS surveys inside CHT

- Added SurveyJS core and Angular UI dependencies, an integration plan, and standalone survey-list and survey-runner components with guarded routes.
- Loaded JSON survey definitions from local database documents under `surveyjs-form:` and rendered the selected survey. Saved completed answers as CHT `data_record` documents with survey identifiers, timestamps, submitter contact information, structured fields, and raw SurveyJS answers.
- Added loading, empty, error, and submission-success states, with navigation back to the list after saving.
- Integrated a Surveys entry into the sidebar/header navigation using report-view permission, added toolbar components and route tab metadata, and adjusted layout, colors, icons, and CSS loading to fit the existing reports UI.
- Added an example survey document for manual testing. This was a prototype on the `surveyjs_prototype` head; these commits do not demonstrate a production rollout.

References: `ded2c7a1fddb`, `3bd9c77e1928`, `d8d526c595b8`, `b424c3e5bad4`, `5e96d073da74`, `aa62c4478a92`, `ff6a0aae0406`, `d039c0001e74`, `77a7a88a025c`.

### 2026-04-10 — Establish the initial Node.js development environment

Added a mise configuration selecting Node.js 22. This is the earliest visible revision authored by `tobias@tobiasquinn.com` in the repository's `all()` history.

Reference: `c97846445e0e`.
