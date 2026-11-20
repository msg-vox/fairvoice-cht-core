# Step 06 — open the sender conversation from an Android notification

The WebApp waits for the router and the active Android registration before handling a tap. It validates the binding, queues distinct taps while a navigation is in progress, and suppresses duplicate work by delivery ID. It passes the full sender account ID as part of a single Angular route segment. Navigation guards retain control. A declined navigation or stale binding is acknowledged as discarded. A tap is acknowledged as handled once the requested thread is active. Replaying a terminal delivery ID repeats its acknowledgement, and a new tap for an already-open thread refreshes history without reinitializing the route.

The opened thread shares the account-scoped refresh used by foreground receipts. Cached history can render offline, and an empty or unavailable data thread offers a Retry button. Online-only accounts defer remote read-marker operations while offline and retry when connectivity returns. The thread continues to mark its own unread messages through the existing read-marker path.

## Files

- `webapp/src/ts/services/data-messaging-push.service.ts` handles tap readiness, matching, navigation, replay, and acknowledgement.
- `webapp/src/ts/services/data-messaging-history.service.ts` shares the account-scoped refresh between push events and the thread retry.
- `webapp/src/ts/services/data-messaging-conversations.service.ts` supports cached-only history and defers remote read-marker queries for offline dashboard users.
- `webapp/src/ts/modules/messages/messages-content.component.ts` and its template show cached history and a retryable empty state.
- The corresponding Karma specs cover cold-start taps, separate senders with embedded colons, binding mismatch, guard decline, duplicate delivery, the already-open route, offline cache and retry, and read markers restricted to the opened thread.

## Verification

- All 84 focused Chrome Headless Karma tests passed.
- TypeScript spec compilation and changed-file ESLint passed.
- `npm run lint` reported ESLint errors in the nested `OTHER_PROJECTS/` checkout and stopped before the blank-link and ShellCheck stages.
- Android wrapper integration and live-device notification taps remain unverified. The wrapper still needs the bridge contract documented in step 5.
