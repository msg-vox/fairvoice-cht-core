# Top toolbar language switcher plan

## Goal and scope

Add a button for each available language to the main Angular webapp's top toolbar. Selecting a button changes the app language immediately and remembers the choice across reloads. This plan targets the webapp, including its current and legacy navigation layouts; the separate AngularJS App Management interface is outside scope.

## Existing implementation to reuse

- `webapp/src/ts/components/header/header.component.ts` and `.html` implement the top toolbar.
- `webapp/src/ts/services/languages.service.ts`: `LanguagesService.get()` returns `{ code, name }` entries from translation documents, filtered using `settings.languages` and `enabled !== false`. When the enabled locale list is empty, it currently returns all translation documents. Preserve this existing fallback rather than defining a different list in the toolbar.
- `webapp/src/ts/services/language.service.ts`: `LanguageService.get()` resolves the cookie or configured default; `SetLanguageService.set(code)` applies translations, Moment and datepicker locales, persists the locale cookie, initializes date formatting, dispatches the language and RTL state, and records telemetry.
- `Selectors.getLanguage` exposes the current language state; `Selectors.getDirection` derives layout direction.
- The user settings modal already uses these services. Its save path also writes user settings; toolbar switching can call `SetLanguageService` directly because language initialization reads the locale cookie and configured default.

The CHT Docs MCP was queried for configured language behavior. Its results matched the local language service and the existing [enabled-language end-to-end test](https://github.com/medic/cht-core/blob/master/tests/e2e/default/translations/enabled-languages.wdio-spec.js). Local source is the implementation reference for this plan.

## Implementation steps

### 1. Define the toolbar behavior

- Place the language button group beside the existing toolbar controls, outside the options dropdown, so languages are directly selectable.
- Use language names supplied by `LanguagesService`, with the code as a fallback for missing names. Avoid flags because languages do not map reliably to countries.
- Show the group when at least two languages are available. Hide it for zero or one language and while the list loads.
- Mark the active language visually and with `aria-pressed`. Clicking the active language is a no-op.
- Keep the current route and avoid a full page reload. Verify existing form behavior before claiming that an already open form changes its own language or preserves its contents during a switch.
- Load language choices when the header initializes. Rely on the app's existing settings refresh/reload behavior for later configuration changes; confirm that behavior during implementation.

### 2. Load choices and track the active language

Update `header.component.ts`:

- Inject `LanguagesService`, `LanguageService`, and `SetLanguageService`.
- Add typed state for available languages, active language code, pending switch, and load/switch errors.
- Resolve the initial language with `LanguageService.get()` and load the list with `LanguagesService.get()`. Handle rejected promises without preventing the rest of the toolbar from rendering.
- Subscribe to `Selectors.getLanguage` so switches made from the existing user settings modal also update the toolbar. Register this subscription in the existing subscription collection for cleanup.
- Ensure a late initial-language lookup cannot overwrite a newer store update, and avoid updating a destroyed component after asynchronous work completes.
- Preserve the current language if it is absent from the available list. Display only returned choices and let the user explicitly choose a replacement.

### 3. Implement switching through the existing service

Add an asynchronous handler such as `switchLanguage(code)`:

1. Ignore requests while another switch is pending, requests for the current code, and codes outside the loaded available list.
2. Clear the previous error and disable the group while processing.
3. Await `SetLanguageService.set(code)` with its default cookie persistence enabled.
4. Derive the selected state from the committed store language rather than marking a button selected optimistically.
5. On failure, show a localized retryable error and log useful diagnostic context; restore interaction in `finally`.

Inspect failure behavior carefully: `SetLanguageService` changes Moment and datepicker settings before loading translations, and writes the cookie before date formatting initialization completes. A rejection can therefore leave partial changes. Test the failure stages and, if needed, restore the previous language through the same service, handling restoration failures explicitly. Do not report a successful switch on rejection.

Use existing cookie persistence and telemetry. No new API endpoint, user-document write, or duplicate telemetry event is needed.

### 4. Render accessible language buttons

Update `header.component.html`:

- Render native `button type="button"` elements with `*ngFor` and track entries by language code.
- Put the buttons in an accessibly named group using a translated label.
- Bind the active style, `aria-pressed`, pending disabled state, and click handler.
- Apply the language code as a `lang` attribute on each language name; isolate mixed-direction names where necessary.
- Keep visible keyboard focus and normal Tab/Enter/Space operation. Announce errors with an appropriate live region.
- Reuse existing translation keys where suitable. Add any missing group/error keys through the repository's translation workflow.

### 5. Make the layout work across screen sizes and directions

Review and update `webapp/src/css/inbox.less`, `old-nav.less`, and `rtl.less` where the header is styled:

- Match existing toolbar colors, spacing, button sizing, hover, active, disabled, and focus states.
- Keep the logo, navigation tabs, and options menu usable on desktop and mobile.
- Support long language names and many configured languages with a bounded, horizontally scrollable button group on narrow screens. Ensure focused buttons scroll into view and touch targets remain usable.
- Test RTL layout and mixed-direction language names using existing direction state and CSS conventions.
- Inspect computed visibility and space in both navigation modes before finalizing placement.

### 6. Add focused unit tests

Extend `webapp/tests/karma/ts/components/header/header.component.spec.ts` with service stubs and a mocked language selector. Cover:

- The returned available languages render with names and code fallbacks; zero/one-language lists hide the group.
- Initial selection, external store changes, and a current code missing from the available choices.
- Clicking another language calls the setter once; current, unknown, and repeated pending selections do not.
- Pending state disables buttons, success selects the committed language, and failures permit retry and announce an error.
- Language list loading failure leaves existing toolbar controls usable.
- Keyboard-accessible button markup, active accessibility state, and subscription cleanup.

Reuse existing `languages.service.spec.ts` and `language.service.spec.ts` coverage for filtering, cookie persistence, date locale, and RTL behavior. Add service tests only if implementation changes those contracts or introduces failure recovery there.

### 7. Verify the complete user flow

Extend the translation end-to-end coverage under `tests/e2e/default/translations/` and the relevant common/header page object:

- Configure multiple languages and verify that available buttons match the configured translation choices; disable one and confirm it disappears after the normal settings refresh.
- Switch language and assert a known translated toolbar label changes, the correct button is active, and the route remains unchanged.
- Reload and verify that the selected language persists.
- Change language through user settings and confirm the toolbar selection follows.
- Verify offline switching with locally available translations and persistence after reload.
- Exercise mobile and legacy navigation, long names/many choices, and an available RTL locale. Check open-form behavior and unsaved data explicitly.
- Restore modified configuration and cookies after tests so later tests are independent.

### 8. Run checks and review against acceptance criteria

- Run `npm run unit-webapp` for the affected Angular tests and existing language-service regressions.
- Run `npm run lint`; run `npm run lint-translations` if translation resources change.
- With a running CHT instance and Chrome, run the relevant translation scenarios through the repository's WebdriverIO configuration, including the mobile configuration where applicable.
- Manually check keyboard focus, screen-reader announcements, narrow layouts, RTL, and offline behavior.

## Acceptance criteria

- With at least two available languages, the top toolbar exposes one directly selectable button per language returned by the existing language service.
- Selecting a language updates translated UI, date formatting, and direction through the existing service, without navigating away or reloading the page.
- The current language is clearly indicated and stays synchronized with changes made elsewhere in the app.
- The choice survives reload through the existing locale cookie.
- Loading and switching failures keep the toolbar usable, expose an understandable error where appropriate, and allow retry.
- Desktop, mobile, legacy navigation, keyboard use, RTL, and locally available offline translations are verified.

The original implementation plan is followed by an implementation record and verification results below.

## Implementation record

### Step 1 — behavior and integration decisions

- The current navigation renders `mm-header` as a desktop sidebar/mobile bottom bar and hides `.extras`. Render the language controls outside that hidden container, with a bounded top-toolbar position in current navigation and beside the options menu in legacy navigation. Reserve toolbar space rather than covering existing controls.
- Use the existing translated `Language` group label and `Error saving settings` retry message. Language names use native buttons and isolated text.
- `AppComponent.watchDDocChanges()` prompts for an application update when settings change; `SettingsService` invalidates its cache. Reloading through that existing flow recreates the header and language list.
- `EnketoService` supplies form language when constructing a form. Toolbar switching must not navigate, reload, or reconstruct the form; live translation of an existing form is not promised.
- Restore the previously resolved/committed language with `SetLanguageService` if switching rejects, because its date locale and cookie updates can precede failure. Keep errors visible and allow retry, including when restoration fails.
- CHT Docs MCP was queried for settings configuration; local source remains the reference for refresh and form behavior.

### Steps 2–7 — implementation

- Added a typed language-list contract without changing the existing filtering/fallback behavior. The header resolves its initial locale, follows committed store updates, handles loading errors, and guards asynchronous language state after destruction.
- Added serialized switching, committed selection, and recovery through the existing setter. Failed recovery has its own visible reload message; normal failures permit retry.
- Added native buttons with translated group/error text, active and disabled states, isolated language names, and an alert region. Existing translation keys suffice; translation files are unchanged.
- Final placement is beside the top controls in current navigation and in the controls toolbar beneath the navigation row in legacy navigation. The layout reserves bounded space using logical CSS properties, permits horizontal scrolling, and keeps a visible keyboard focus indicator. Search/navigation flex items can shrink into the remaining space.
- Added header unit coverage and setter failure-stage recovery tests. Added shared desktop/mobile end-to-end scenarios for configured choices, normal settings refresh, immediate translation, route stability, cookie persistence, user settings synchronization, offline reload, RTL, long names, and unsaved forms. The form and configuration fixtures are restored/removed during cleanup.

### Step 8 — verification results and remaining runtime checks

- Focused Chrome run: **46 tests passed**, covering the header and both language services, including translation-loading, cookie-writing, and date-formatting failure stages.
- `npm run unit-webapp`: timezone tests passed (**476 tests in each of three timezones**); the Angular suite reported **3,277 passing and seven failing**. All seven failures also reproduce on the original revision `09274ad7` in an isolated workspace: six report/contacts RouterLink tests have incomplete router event stubs, and one report edit-permission test expects `false` but receives `undefined`. The isolated subset additionally exhibits an existing select-mode redirect assertion failure. No unrelated tests were changed.
- The full command stops on those Angular failures, so the CHT form suite was run separately: **32 tests passed**.
- `npm run lint` was run before every implementation commit. ESLint and the blank-link check pass for the change; the full command fails on existing ShellCheck findings **SC2155, SC2086, SC2046 in `build-images.sh:7`**. An existing unused-disable ESLint warning remains in `api/tests/mocha/services/settings.spec.js`. No translation-resource changes required translation lint.
- Both changed LESS entry points compile. A standalone Chrome fixture using the compiled application CSS passed **12 layout checks**: 360/450/1200px × current/legacy navigation × LTR/RTL. Checks cover computed visibility, bounded horizontal overflow, keyboard focus, and scrolling the focused button into view. Narrow screenshots were inspected. This fixture is not a full app runtime test.
- Desktop and mobile WebdriverIO runs were attempted. The default run first exposed the absence of an image tag in this jj workspace; retrying with an explicit tag reached Docker startup and failed because the CHT images are not built locally or available from the registry. No application scenario executed. A running instance built from these changes is still needed to verify actual offline switching/reload, unsaved forms, toolbar-control spacing on real routes, and settings-modal synchronization.
- Screen-reader announcement checks and full application keyboard/visual checks remain manual. The existing form-construction code supports retaining the same form instance, but runtime preservation and form-language behavior are deliberately not claimed as verified.
- To finish runtime verification, build the local CHT images, set `VERSION` to their tag, and run `npm run ci-webdriver-default -- --spec=tests/e2e/default/translations/toolbar-languages.wdio-spec.js`, then the equivalent `ci-webdriver-default-mobile` command. The shared spec is also included in the normal mobile suite.
