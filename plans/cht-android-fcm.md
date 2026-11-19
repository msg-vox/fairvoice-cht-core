# cht-android — incoming data message notifications

The Fairvoice Android wrapper owns foreground alerts, system notifications, and notification taps. Core owns the message history, unread count, and conversation route. Agree on the [Android data message push contract](fairvoice-cht-core-fcm.md#android-data-message-push-contract) first. Use [the Firebase setup guide](firebase-setup.md) for staging.

## Implementation notes

Implement one small logical change at a time in `OTHER_PROJECTS/cht-android/`. For **each implementation step**, create a new file in the Core workspace at `plans/cht-android-step-NN-notes.md`. Record the behavior changed, relevant files, tests run and their results, and anything still unverified. If a step is split, use suffixes such as `03a` and `03b`.

Review `jj diff`, run the focused tests and required repository checks, then commit each step with `jj commit -m '<prefix>(#<issue>): <message>'` in the Android repository. Use the suggested messages below with the actual issue number. Since the notes live in the Core repository, record the Android change ID there and commit the notes in Core with a matching `docs(#<issue>): record Android step NN results` message before starting the next step.

## Steps

1. **Configure Firebase for the Fairvoice variant.** In `build.gradle`, add compatible Firebase Messaging and Google Services dependencies. Register a non-exported `FirebaseMessagingService`, create an incoming-messages channel on Android 8+, and request notification permission on Android 13+. Build the variant and verify foreground messaging still works when system notifications are denied.  
   Commit `feat(#<issue>): configure Firebase Messaging for Fairvoice Android`.

2. **Bind the installation to the signed-in account.** Obtain the FCM token at sign-in, handle `onNewToken` before or after login, and register through the trusted WebView bridge and authenticated Core session. Persist the deployment and opaque binding. On logout, account switch, or server switch, immediately clear the binding, notifications, and pending taps, including offline. Test rotation, registration retry, and a late push for the previous account.  
   Commit `feat(#<issue>): bind push registration to the active CHT session`.

3. **Alert a foreground user in place.** Validate the payload and binding and deduplicate by canonical message ID. When the activity is visible and resumed, show one accessible, non-modal “New message from Alice” banner and signal a messaging refresh. Retain a pending refresh if the WebView bridge is starting. Preserve the route, focus, scroll position, and drafts. Test on an unfinished form and in the sender’s already-open conversation.  
   Commit `feat(#<issue>): alert foreground users without changing screens`.

4. **Show a sender-named background notification.** Handle data-only events in the Firebase service, including when Android recreates the process. Check the persisted binding before displaying the sender’s account display name. Use a generic public lock-screen version and an explicit immutable PendingIntent with a distinct identity for each conversation. Test two senders and a duplicate delivery.  
   Commit `feat(#<issue>): show sender-named background message notifications`.

5. **Handle warm and cold taps.** In `EmbeddedBrowserActivity`, handle explicit notification taps on startup and in `onNewIntent`. Keep the structured tap until the trusted origin, matching login, and WebApp router are ready. Deliver it once, clear it on acknowledgement, and discard stale or mismatched taps. Test a cold launch, a warm launch, process recreation, repeated taps, and login in progress.  
   Commit `feat(#<issue>): route notification taps to data conversations`.

6. **Verify an end-to-end exchange in staging.** Send real messages from two distinct accounts. On an unfinished form, verify one banner, the correct badge increase, and unchanged input and focus. In the sender’s visible thread, verify the message appears and is marked read. In the background and after ordinary process exit, verify the sender name and tap destination for both senders. Repeat with offline upload and reconnect, denied permission, and account switching. Record badge values, routes, and results in the step notes.  
   Commit `test(#<issue>): cover Android data message notification delivery`.
