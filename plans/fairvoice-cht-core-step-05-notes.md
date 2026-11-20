# Step 05 — refresh message counts on foreground push

The signed-in WebApp validates Android receipts against its active account and binding. It acknowledges accepted receipts once their refresh has been scheduled and replays that acknowledgement for duplicate delivery IDs. It coalesces bursts for 75 ms and runs account-scoped messaging sync, including the existing online history path for dashboard users. A failed refresh stays pending until the foreground resumes or the browser reconnects. A binding or account change clears pending work and acknowledgements.

The existing history change subscriptions update the badge from stored messages and read markers and keep the SMS count in the total. The same update refreshes the inbox without opening a conversation. An already-open data thread refreshes and applies its usual read markers without replacing the composer or clearing its draft.

## Android bridge

Core now documents `getDataMessagePushRegistration()` and the `cht:data-message:registration-changed` event to establish the binding independently of receipt data. The Android wrapper must expose the active association through that contract. Android continues to check receipt freshness before dispatch. Valid explicit taps remain pending on Android until WebApp tap handling in step 6. [Bridge contract](fairvoice-cht-core-fcm.md#android-to-webapp-via-the-bridge)

## Files

- `webapp/src/ts/app.component.ts` initializes push handling for the signed-in shell.
- `webapp/src/ts/services/data-messaging-push.service.ts` validates and acknowledges bridge events and schedules refreshes.
- `webapp/src/ts/services/data-messaging-history.service.ts` lets receipts share a follow-up download after an active dashboard refresh.
- `webapp/src/ts/modules/messages/messages.component.ts` limits automatic desktop conversation selection to initial inbox loading.
- The corresponding Karma specs cover receipt duplication, account switching, retry, form focus, inbox navigation, and open-thread drafts. The existing unread-records specs cover combining SMS with unread data messages.

## Verification

- All 79 focused Chrome Headless Karma tests passed.
- A wider Karma run surfaced an existing AppComponent translation test failure because its translation stub lacks `use()`.
- TypeScript spec compilation and changed-file ESLint passed. Blank-link checking passed.
- `npm run lint` failed on the nested `OTHER_PROJECTS/` checkout. Core ESLint passed with that checkout excluded, and standalone ShellCheck reported the existing `SC2155` warning in `build-images.sh`.
- Android-side bridge wiring, real-device resume, and live Firebase delivery remain unverified.
