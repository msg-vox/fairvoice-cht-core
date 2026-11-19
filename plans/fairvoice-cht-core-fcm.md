# fairvoice-cht-core — incoming Android data message notifications

Use the accepted CHT data message as the source for push delivery. The WebApp already combines incoming unread data messages with the SMS count and opens data threads at `/messages/data:<account ID>`. Reuse its read markers and account-scoped sync. See [the existing messaging implementation](../MESS_DATA_IMPLEMENTATION.md), [the Android plan](cht-android-fcm.md), and [Firebase setup](firebase-setup.md).

## Implementation notes

Implement in small logical steps. During **each implementation step**, create a new file at `plans/fairvoice-cht-core-step-NN-notes.md`. Record the behavior changed, relevant files, tests run and their results, and anything still unverified. Give smaller substeps their own notes, for example `03a` and `03b`. Run the focused tests and `npm run lint`, review `jj diff`, and commit each step together with its notes using `jj commit -m '<prefix>(#<issue>): <message>'`. Replace the placeholder in each suggested message with the actual issue number.

Agree on the contract with Android first. Deploy Core with sending disabled, release the compatible Android build, then enable delivery for the pilot. Existing clients continue to receive messages through ordinary sync.

## Steps

1. **Define the contract.** Specify a versioned data-only FCM event with canonical message ID, sender account ID, sender display name, and an opaque recipient-registration binding. Resolve the name from trusted sender settings with the existing username fallback. Omit message text. Define separate bridge events for receipt and explicit tap. Receipt triggers refresh. A tap requests conversation navigation. Document duplicate and acknowledgement behavior with examples for both teams.  
   Commit `docs(#<issue>): define the Android data message push contract`.

2. **Manage installation registrations.** Add authenticated register, refresh, and unregister operations under `/api/v1/data-messaging`. Derive the account from the session and keep tokens in server-private storage. Support several devices per account and replace the binding when an installation switches users. Test token rotation, account switching, and an attempt to revoke another installation.  
   Commit `feat(#<issue>): register Android installations for data message alerts`.

3. **Queue alerts for accepted messages.** Consume canonical `data_message` creates in the dedicated messaging database. Persist a checkpoint and a uniquely keyed job per message and recipient installation before advancing the checkpoint. Start from the pilot activation checkpoint to avoid alerting on historical messages. Test a delayed offline upload, identical send retries, and a worker restart between enqueue and checkpoint.  
   Commit `feat(#<issue>): queue push alerts for accepted data messages`.

4. **Dispatch through FCM HTTP v1.** Gate sending by deployment and pilot. Use the server runtime identity to send high-priority, user-visible data events to the recipient’s current installations. Recheck bindings at dispatch, use bounded alert lifetimes, retry transient errors with backoff, and retire invalid tokens. Verify that Firebase outages do not block message acceptance and that a post-send crash can safely replay the same message ID.  
   Commit `feat(#<issue>): deliver queued data message alerts through FCM`.

5. **Refresh the Messages badge on receipt.** Handle foreground receipts across the signed-in WebApp. Coalesce bursts, run account-scoped messaging sync, then refresh the existing unread calculation. Retry a failed refresh on resume or reconnect. Derive the count from stored messages and read markers. Test duplicate receipts, preservation of the SMS count, an unsaved form, the inbox, and the already-open sender thread. Receipt alone must preserve the current screen and selection.  
   Commit `feat(#<issue>): refresh message counts on foreground push`.

6. **Navigate on explicit tap.** Wait for the session and router, check the binding, and construct the existing data-thread route using Angular route segments and the sender’s full account ID, including embedded colons. Respect navigation guards. Refresh history, use cached history offline, and show a retryable state if the thread is unavailable. Test a cold-start tap, two different senders, and an account mismatch. Verify only the opened conversation’s applicable unread messages clear.  
   Commit `feat(#<issue>): open the sender conversation from an Android notification`.
