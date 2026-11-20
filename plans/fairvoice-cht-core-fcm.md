# fairvoice-cht-core — incoming Android data message notifications

Use the accepted CHT data message as the source for push delivery. The WebApp already combines incoming unread data messages with the SMS count and opens data threads at `/messages/data:<account ID>`. Reuse its read markers and account-scoped sync. See [the existing messaging implementation](../MESS_DATA_IMPLEMENTATION.md), [the Android plan](cht-android-fcm.md), and [Firebase setup](firebase-setup.md).

## Implementation notes

Implement in small logical steps. During **each implementation step**, create a new file at `plans/fairvoice-cht-core-step-NN-notes.md`. Record the behavior changed, relevant files, tests run and their results, and anything still unverified. Give smaller substeps their own notes, for example `03a` and `03b`. Run the focused tests and `npm run lint`, review `jj diff`, and commit each step together with its notes using `jj commit -m '<prefix>(#<issue>): <message>'`. Replace the placeholder in each suggested message with the actual issue number.

Agree on the contract with Android first. Deploy Core with sending disabled, release the compatible Android build, then enable delivery for the pilot. Existing clients continue to receive messages through ordinary sync.

## Steps

1. **Define the contract.** See the [Android data message push contract](#android-data-message-push-contract) for the FCM payload, bridge events, and acknowledgement rules.

   Commit `docs(#fcm): define the Android data message push contract`.

2. **Manage installation registrations.** See the [Android push registration API](#android-push-registration-api) for the authenticated operations, token rotation, and account switching rules.

   Commit `feat(#fcm): register Android installations for data message alerts`.

3. **Queue alerts for accepted messages.** Consume canonical `data_message` creates in the dedicated messaging database. Persist a checkpoint and a uniquely keyed job per message and recipient installation before advancing the checkpoint. Start from the pilot activation checkpoint to avoid alerting on historical messages. Test a delayed offline upload, identical send retries, and a worker restart between enqueue and checkpoint.  
   Commit `feat(#<issue>): queue push alerts for accepted data messages`.

4. **Dispatch through FCM HTTP v1.** Gate sending by deployment and pilot. Use the server runtime identity to send high-priority, user-visible data events to the recipient’s current installations. Recheck bindings at dispatch, use bounded alert lifetimes, retry transient errors with backoff, and retire invalid tokens. Verify that Firebase outages do not block message acceptance and that a post-send crash can safely replay the same message ID.  
   Commit `feat(#<issue>): deliver queued data message alerts through FCM`.

5. **Refresh the Messages badge on receipt.** Handle foreground receipts across the signed-in WebApp. Coalesce bursts, run account-scoped messaging sync, then refresh the existing unread calculation. Retry a failed refresh on resume or reconnect. Derive the count from stored messages and read markers. Test duplicate receipts, preservation of the SMS count, an unsaved form, the inbox, and the already-open sender thread. Receipt alone must preserve the current screen and selection.  
   Commit `feat(#<issue>): refresh message counts on foreground push`.

6. **Navigate on explicit tap.** Wait for the session and router, check the binding, and construct the existing data-thread route using Angular route segments and the sender’s full account ID, including embedded colons. Respect navigation guards. Refresh history, use cached history offline, and show a retryable state if the thread is unavailable. Test a cold-start tap, two different senders, and an account mismatch. Verify only the opened conversation’s applicable unread messages clear.  
   Commit `feat(#<issue>): open the sender conversation from an Android notification`.

## Android data message push contract

### Core to Android via FCM

Core creates the event from an accepted `data_message` in the messaging database and addresses it to one current recipient installation. All fields in `message.data` are required UTF-8 strings. Send a data-only FCM HTTP v1 message to the installation token and leave both `message.notification` and `message.android.notification` absent so Android can validate the event before displaying anything. [FCM message resource](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages) · [Android receive behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)

| Field | Version 1 value |
| --- | --- |
| `version` | Exactly `"1"`. |
| `event` | Exactly `"data_message"`. |
| `message_id` | The accepted document’s exact `_id`, `data-message:` followed by a lowercase UUID. Keep this ID on every send and retry. |
| `sender_account_id` | The accepted document’s exact `sender_id`, `org.couchdb.user:<username>`. Preserve the prefix and any colons in the username. |
| `sender_display_name` | The nonempty display label Core resolves for the sender. Android renders it as plain text. |
| `recipient_binding` | The opaque, case-sensitive value Core issued for the recipient installation’s current account and deployment. Compare the entire value. |

Resolve `sender_display_name` using the messaging directory rule. Read the trusted settings for the account identified by the accepted `sender_id`. Use the trimmed `fullname` when it is a nonblank string, otherwise use the sender’s username. Use the username associated with the accepted sender ID if settings are missing. Read the name on Core and exclude message text, links, and route instructions from the payload. [Existing directory name resolution](../shared-libs/user-management/src/users.js)

Example HTTP v1 request body. The token and binding are illustrative.

```json
{
  "message": {
    "token": "example-installation-fcm-token",
    "data": {
      "version": "1",
      "event": "data_message",
      "message_id": "data-message:550e8400-e29b-41d4-a716-446655440000",
      "sender_account_id": "org.couchdb.user:clinic:alice",
      "sender_display_name": "Alice Doe",
      "recipient_binding": "example-opaque-binding"
    }
  }
}
```

The binding identifies the registered installation and account association. Authenticated account-scoped sync still controls access to message history. Android ignores unknown versions or event types, malformed required values, and expired events. It also ignores events whose binding differs from the persisted current registration for the configured deployment. Check before alerting or retaining a bridge event. Ignore unrecognized extra data fields for a supported version. On logout or account or deployment switch, clear affected pending events and notifications even when offline. A background notification uses a generic label on the public lock screen.

### Android to WebApp via the bridge

Android dispatches a `CustomEvent` on the trusted top-level WebView’s `window`. The event’s `detail` is a JSON object containing the six fields from `message.data` and a nonempty `delivery_id` string generated by Android. Keep that ID stable when retrying the same event. Receipt and tap use distinct delivery IDs even when the message is the same. Serialize the object as data when dispatching it.

| Bridge event name | When Android emits it | What the WebApp does |
| --- | --- | --- |
| `cht:data-message:received` | A valid push arrives while the activity is visible and resumed. | Coalesce foreground receipts and run account-scoped messaging sync. Then refresh the unread count from stored messages and existing read markers, preserving the SMS count. Retry failed refreshes on resume or reconnect. Preserve the current route, selection, focus, and drafts. An already-open data thread follows its normal refresh and read behavior. |
| `cht:data-message:tapped` | The user explicitly taps the matching Android notification. | Request navigation to the sender’s existing data thread, respecting navigation guards. Use Angular route segments `['/messages', 'data:' + sender_account_id]`. Refresh history and use cached history offline. If the thread opens without available history, offer a retry in the thread. Apply the existing read markers for the conversation that opened. |

The trusted page reads its active association through `window.medicmobile_android.getDataMessagePushRegistration()`. Android returns a JSON string containing `account_id` and `recipient_binding` for the current signed-in association and configured deployment, or an empty string if there is no active association. Android dispatches `cht:data-message:registration-changed` on the trusted page’s `window` when that association becomes available, changes, or clears. The WebApp compares the returned account ID to its signed-in account before accepting the binding.

After installing both handlers, establishing the signed-in account’s current binding, and initializing the router, the WebApp calls `window.medicmobile_android.dataMessagePushReady('1')` if the method is available. Android retains pending receipts and explicit taps while the bridge is starting. Readiness applies to the current trusted page and session. Reset it when the page reloads or the session changes. Android checks freshness and binding again at dispatch. The WebApp validates the payload and checks the binding against its current session before acting. An ordinary app launch or resume emits no tap.

### Duplicates and acknowledgements

- **Core delivery.** A retry of the original message submission preserves the accepted document and produces no additional alert job. FCM retries may deliver the same canonical event more than once. Key jobs by `message_id` and recipient installation. A successful FCM response acknowledges acceptance by FCM. CHT message acceptance and read state follow their existing paths.
- **Android alerts.** Within the alert lifetime, deduplicate by current deployment, binding, and `message_id`, including across process recreation. A replay produces no second banner, notification, or receipt event. Keep one notification identity per conversation so different senders have independent tap targets. An explicit tap remains eligible after receipt of the same message. Repeated delivery of the same tap intent reuses its delivery ID.
- **Bridge delivery.** The WebApp calls `window.medicmobile_android.ackDataMessagePush(delivery_id, status)` after processing an event. Android applies the acknowledgement only to that pending ID for the active binding and trusted page. The WebApp suppresses concurrent work for an in-flight ID. It remembers terminal outcomes for the current page and session and replays the same acknowledgement if Android offers that ID again. A replay after page recreation should be safe, including a tap whose thread is already open. Such a tap can refresh history without reinitializing the thread.

| `status` | Meaning | Android action |
| --- | --- | --- |
| `handled` | For receipt, the WebApp scheduled or joined its account-scoped refresh and owns any sync retry. For tap, the requested thread is open, including when it shows a retryable history state. | Clear the pending event. |
| `discarded` | The event is invalid, stale, unsupported, or mismatched, or a navigation guard declined the tap. | Clear the pending event. A declined tap ends the navigation request. |
| `retry` | The current page or session is temporarily unready and the WebApp has taken no action. | Keep the pending event and retry on readiness with the same ID. |

A missing acknowledgement leaves the event pending. Retry with the same ID when the trusted page can receive it and it is still current. Expire pending events within the bounded alert lifetime and clear them when their binding is invalidated. Bridge acknowledgements stay local and convey no delivery or read receipt to the sender.

### Examples for Core and Android

1. **Foreground receipt and FCM replay.** Android receives the example payload while a worker is editing a form. It shows “New message from Alice Doe” and dispatches `cht:data-message:received` with `delivery_id: "receipt-1"`. The WebApp schedules scoped sync and calls `ackDataMessagePush('receipt-1', 'handled')`. The unread count is recalculated after sync and the form stays open. Replaying the same FCM payload with a different FCM-assigned ID causes no second alert.
2. **Cold-start notification tap.** On another installation for the same recipient, Android displays a background notification for Alice using that installation’s binding. The tap launches the app. When the matching WebApp calls `dataMessagePushReady('1')`, Android dispatches `cht:data-message:tapped` with `delivery_id: "tap-1"` and that installation’s original payload fields. Angular navigates using `['/messages', 'data:org.couchdb.user:clinic:alice']`. The WebApp acknowledges `handled` once the thread opens. If Android missed the acknowledgement, it can replay `tap-1` without causing a second navigation in the same page.
3. **Account switch.** If the user switches accounts before a queued tap reaches the WebApp, Android clears the tap with its old binding. A delayed push carrying that binding produces no alert. If a stale event reaches a ready WebApp, the handler returns `discarded` and neither syncs nor navigates for that event.

## Android push registration API

Send these JSON requests through the signed-in CHT session. Core gets the account ID from that session. Each request body accepts exactly the fields listed, and responses use `Cache-Control: no-store`.

| Method and path | Request body | Success |
| --- | --- | --- |
| `POST /api/v1/data-messaging/push-registrations` | `installation_key`, `generation`, `fcm_token` | `200` with `{ "recipient_binding": "…" }` |
| `POST /api/v1/data-messaging/push-registrations/refresh` | `installation_key`, `recipient_binding`, `previous_fcm_token`, `fcm_token` | `200` with the current `{ "recipient_binding": "…" }` |
| `POST /api/v1/data-messaging/push-registrations/unregister` | `installation_key`, `recipient_binding` | `204` with an empty body |

- Generate `installation_key` from 32 random bytes encoded as 64 lowercase hex characters. Store it with the installation’s generation in device-local storage that survives sign-out. Keep it out of backups, URLs, logs, and FCM payloads. Every device generates its own key. Core stores a hash of the key and keeps the FCM token in the server-only vault.
- Start `generation` at `1` and use positive JSON integers within JavaScript’s safe integer range. Persist a higher generation before registering a new signed-in association, including after signing back in to the same account. Retries of a registration use the same generation. The same generation and account return the current binding while the registration is active and leave the token as stored. A higher generation replaces the account, token, and binding atomically. A delayed register with an older generation, or a register at a revoked generation, returns `409`. Discard responses for associations that have since changed.
- Both token fields accept up to 4096 printable ASCII characters without spaces. Send the last token Core acknowledged as `previous_fcm_token` and the latest Firebase token as `fcm_token`. Core replaces the token if the previous token matches. If the latest token is already stored, Core acknowledges the request as a retry. Otherwise, a mismatch returns `409`.
- Process refreshes one at a time per binding. Retry the same token pair if the response is lost, and record the acknowledged token before starting the next refresh. If Firebase rotates the token during registration, refresh after the registration succeeds. If the acknowledged token is unavailable or a `409` leaves it uncertain, register the still-current session with a higher generation and the latest Firebase token.
- Unregister with the current session, key, and binding. Core removes the active token and retains the generation to prevent a delayed register from reactivating it. Repeating the same unregister succeeds while that generation is current. An unknown installation, wrong account, or wrong binding returns `403` for refresh or unregister. Refresh of a revoked registration also returns `403`.
- Malformed request fields return `400`. Attempt unregister using the existing session when signing out online. Clear the local binding and pending events immediately on logout or account or deployment switch, including offline. The next successful registration can replace the old association even if unregister was unavailable.
