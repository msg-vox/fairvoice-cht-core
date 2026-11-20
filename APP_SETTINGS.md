# CHT app settings

In your app configuration, define `roles` and `permissions` for user access, `contact_types` for the place and person hierarchy, and `languages` and `locale` for available languages and the default language. Configure `transitions` and SMS settings as needed. If your project compiles settings with `cht-conf`, edit `app_settings/base_settings.json` and run `cht compile-app-settings`. [CHT settings reference](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/)

## Fairvoice data messaging

Add this top-level setting to enable the pilot. Replace `your-pilot-place-id` with the CHT document ID of the place whose hierarchy should participate. You can list multiple pilot roots.

```json
{
  "data_messaging": {
    "enabled": true,
    "pilot_root_place_ids": ["your-pilot-place-id"]
  }
}
```

Android push is configured separately in the Core server environment and Android build. [Firebase setup](plans/firebase-setup.md)
