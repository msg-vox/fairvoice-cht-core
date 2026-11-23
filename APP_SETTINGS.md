# CHT app settings

In your app configuration, define `roles` and `permissions` for user access, `contact_types` for the place and person hierarchy, and `languages` and `locale` for available languages and the default language. Configure `transitions` and SMS settings as needed. If your project compiles settings with `cht-conf`, edit `app_settings/base_settings.json` and run `cht compile-app-settings`. [CHT settings reference](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/)

## Fairvoice data messaging

Data messaging is off by default. Use the top-level `data_messaging` setting in your app configuration. Keep `enabled` false at initial deployment and use `pilot_root_place_ids` for the CHT place document IDs you intend to enable. Existing deployments can keep their current settings keys and root IDs.

```json
{
  "data_messaging": {
    "enabled": false,
    "pilot_root_place_ids": ["your-pilot-place-id"]
  }
}
```

When enabled, accounts assigned within the configured roots can send up or down the same branch of the place hierarchy. Participants can still read accepted messages after sending is disabled. History is tied to the CHT account ID derived from the username. Keep each username assigned to the same person and create a new account for a replacement.

To group recipients by their display place, set `data_messaging.directory_parent_place_types` to a list of place type IDs. For example, `["researcher_area"]` displays the parent cooperative for a researcher area when the cooperative is within the pilot. Messaging eligibility uses the assigned places.

### Core and Android release setup

Pin the Fairvoice Core image by digest and the signed Android artifact by version and SHA-256. Record the Core digest and the Android version name, version code, and artifact checksum for each environment. Use separate Firebase projects for staging and production. Build each Android variant with the matching Firebase project configuration and configure the corresponding API runtime with `DATA_MESSAGE_PUSH_FIREBASE_PROJECT_ID` and Application Default Credentials for that project. Keep Firebase credentials in the server runtime. [Firebase setup](plans/firebase-setup.md)

On first push activation in each environment, use administrator access to read `update_seq` from the CouchDB database info for `<db>-data-messaging`. Set `DATA_MESSAGE_PUSH_ACTIVATION_SEQUENCE` in the API runtime to that exact value so messages accepted before activation do not generate alerts. Subsequent starts use the checkpoint saved in `<db>-vault`. Keep the activation setting configured and preserve the saved checkpoint across restarts and rollbacks.

### Backup and staging verification

Include the main CouchDB database, `<db>-data-messaging`, `<db>-vault`, `_users`, and deployment configuration in the same backup set. Restore the set in isolated staging with production push disabled and production Firebase credentials excluded from the staging runtime. Check the restored database access controls. Confirm that ordinary accounts cannot access the messaging database or vault directly. From clean browser profiles, sign in as each participant and confirm that both can read a known restored message. Sign in as an unrelated account and confirm the message is absent. [CHT backup and restore guide](https://docs.communityhealthtoolkit.org/hosting/cht/docker/backups/)

On the signed staging Android build, exchange real data messages. Confirm that a foreground alert preserves the current screen and draft, that tapping a background notification opens the correct thread during a warm and a cold start, and that alerts for the previous account are suppressed after switching accounts. Verify ordinary sync still delivers messages with notifications denied and during Firebase unavailability. Record the results with the tested Core and Android versions. [Android push verification plan](plans/cht-android-fcm.md)

### Production rollout and rollback

1. Start Core with `data_messaging.enabled=false` and `DATA_MESSAGE_PUSH_SEND_ENABLED=false`. Verify startup and confirm that CouchDB provisioned the messaging database and vault with restricted access.
2. Set `data_messaging.enabled=true` with only the first intended place root in `pilot_root_place_ids`. Check the recipient directory and complete a two-way exchange between eligible accounts.
3. Configure the first-activation sequence if needed, set `DATA_MESSAGE_PUSH_SEND_ENABLED=true`, and redeploy the API with the updated environment. Verify a real notification on the signed production Android build before onboarding the remaining launch users.

For the first week, review API logs and user reports daily for directory rebuild, sync, and push failures. To pause push, set `DATA_MESSAGE_PUSH_SEND_ENABLED=false` and redeploy the API with the updated environment. Verify that ordinary messaging sync continues. To pause sending, set `data_messaging.enabled=false` and confirm that new sends are rejected and participants can still read accepted messages.
