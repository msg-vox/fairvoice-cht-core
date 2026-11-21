# Fairvoice messaging CLI

Browse active Fairvoice accounts and inject a data message between two accounts
using the CouchDB administrator login. To run the CLI, install Node.js 22 and
put `fzf` on your PATH. The files in this directory can run on their own
without installing any npm packages or building CHT Core.

```sh
node fcm-messaging/fcm-cli.js
```

Enter the direct CouchDB server origin (for example, `http://localhost:5984`),
the project database name (default `medic`), and the administrator username
(default `medic`) and password. Use an HTTPS endpoint or a local tunnel when
connecting to a remote server. The password prompt hides input.

- **B** opens the searchable participant list. Search by display name,
  username, or role. Press Enter to inspect a result or Esc to return.
- **S** opens the sender and recipient pickers. Enter a single-line message
  of up to 4,000 characters, then type **y** to confirm the displayed message.
- **Q** exits.

The CLI lists accounts that have both a CouchDB login and active CHT user
settings. It writes the same message document used by Fairvoice to the
existing `<project-database>-data-messaging` database on the same server.
This administrative write bypasses the relationship checks applied to
regular in-app sends. Replies composed in Fairvoice still follow the
usual eligibility rules.

A saved message ID confirms the CouchDB write. Fairvoice sync retrieves the
message, and the backend's existing FCM worker handles notifications when
push is enabled and the recipient has a current registration. If a write
reports an error with a message ID, check that ID in the messaging database
before sending again.
