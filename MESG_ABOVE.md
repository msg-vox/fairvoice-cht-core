# Messaging people above a community researcher

## Intended outcome

Each community researcher (CR) can open Messages, choose a person above them in their reporting hierarchy by name, and compose a message without knowing or entering a telephone number. Their available recipients are loaded onto the device during initial setup, available immediately on subsequent launches, and refreshed when a connection is available.

For example, a CR selects “Jane Smith — Supervisor — North Area”. Another Jane Smith can appear with a different role or area so the CR can distinguish them. Selection refers to a specific person, rather than everyone at a facility or whoever happens to hold a role later.

This proposal retains the existing SMS delivery channel. Telephone numbers remain delivery information behind the named selection. Moving to account-to-account chat would be a separate, larger design involving inbox routing, notifications, and delivery semantics.

## Current design and the gap

The existing message composer already supports selecting contacts by name as well as entering raw telephone numbers. It searches the contacts available to the user, validates their telephone numbers, and can expand a place into “Everyone at” recipients. Outgoing messages are stored locally as pending tasks with telephone destinations and optional contact identity.

Contact availability is governed by the user's replicated data scope. Existing contact search does not establish a dedicated list of people above a CR. A hierarchy reference alone also does not guarantee that the corresponding named person and their delivery details are available offline.

The change therefore needs to address recipient availability, hierarchy rules, and refresh behaviour alongside the composer.

## Proposed design

### 1. Define who counts as above a CR

Use the CR's authenticated account, linked person, and assigned place to determine their reporting chain. Proposed default: include the designated messaging contacts at every ancestor level in that CR's own branch, ordered from nearest supervisor upwards. Exclude the CR, peers, descendants, and unrelated branches.

CHT's place hierarchy and a staff reporting hierarchy may differ. Confirm whether each ancestor place's primary contact represents the intended supervisor. Where it does not, maintain an explicit assignment of messaging contacts or reporting relationships. Do not infer a supervisor merely from their job title or from being attached to a higher-level place.

Administrators maintain names, assignments, active status, and valid SMS destinations through the existing contact/configuration processes, extending them where necessary. Multiple authorised people at one level can appear as separate named recipients. Deduplicate a person who appears at several levels using their stable identity.

### 2. Provide a small, authorised recipient directory

The server derives a directory for the signed-in CR from those assignments. Each entry contains a stable person identifier, display name, role, hierarchy context, and eligibility/delivery information. Names are display labels; they are never the unique routing key.

The directory is a limited messaging view of those people. Access to an entry must not grant access to that person's reports, patients, whole facility, or other branches. The server determines membership and validates outgoing recipient eligibility; a client-supplied identity is insufficient authorisation.

Recommended approach: synchronise a dedicated directory into local storage, separate from the general contact list, and connect it to the existing messaging flow. This makes additions and removals explicit and avoids broadening clinical data replication just to populate a recipient picker.

An alternative is to replicate the necessary ancestor contact documents and reuse ordinary contact search. This could reuse more existing behaviour, but requires careful review of replication permissions and indirect access to related records. Choose it only if it supplies the complete directory without expanding data access beyond the intended scope.

### 3. Preload once and refresh throughout use

During first authenticated setup, download and persist the CR's directory before declaring named messaging ready. A first installation with no connection and no provisioned directory cannot discover recipients; show that initial synchronisation is required. If offline first launch is an operational requirement, provision the same user-specific directory while the device is connected before handing it to the CR.

On subsequent launches, read the saved directory immediately. Attempt a background refresh when connected, retry through the app's normal synchronisation lifecycle when connectivity returns, and provide a manual refresh action. Opening the composer and searching names must work without a live server request.

A refresh must capture new people, renamed people, telephone changes, reassignment, deactivation, and removals. Replace the saved directory only after a complete successful refresh; a failed or partial download retains the last successful version. A successfully refreshed empty list must clear old recipients. Keep the directory scoped to its authenticated user and apply the app's logout/account-change data handling so another CR cannot inherit it.

Show the last successful directory refresh and a clear stale/offline state. A failed refresh should leave cached recipients usable for composition, with final eligibility checked when queued messages reach the server. Exact revocation cannot be known by a disconnected device until it reconnects.

### 4. Make the CR composer centre on named people

Present “People above me” as a searchable list showing name, role, and reporting area. Allow selection directly from the preloaded list without typing. Use recipient-oriented labels and errors, including “No people assigned” and “Recipient currently unavailable”.

For this CR flow, use named individuals as recipients and remove raw-number entry and “Everyone at” expansion. Preserve existing messaging behaviour for other roles through a configurable rollout. People without a valid delivery route should be shown as unavailable with a useful explanation, rather than disappearing silently.

Use the same directory for new messages and replies where relevant. An old conversation must not provide a route around current recipient eligibility. Keep historical messages readable even if the recipient later leaves the directory.

### 5. Keep identity separate from delivery details

Record the selected person's stable identity and a display snapshot with each queued message. The current send flow rehydrates contact documents and embeds a telephone destination, so it must accommodate directory entries that are not ordinary locally replicated contacts.

Recommended behaviour: when a queued message reaches the server, recheck that the selected person is still eligible and resolve their current valid SMS destination before releasing it into the existing delivery pipeline. A telephone change for the same person can then be handled without asking the CR to learn the new number. If the person is removed, reassigned out of scope, or lacks a valid destination, hold the message with an actionable status. Never silently redirect a message addressed to one named person to their replacement.

This requires a server-side resolution/validation step before gateway dispatch; synchronising a directory alone will not provide it. Keep retries idempotent using the queued message's identity, and retain the actual delivery destination for operational history. Once dispatched, a directory refresh must not reroute or resend a message.

Offline composition and queueing do not imply immediate delivery. Distinguish waiting for connection, awaiting recipient validation, submitted to the delivery pipeline, and confirmed delivery where supported. Conversation names and grouping should retain person identity through name/number changes and tolerate recipients whose full contact record is not on the device. Review incoming SMS association so number changes do not cause misleading conversation attribution.

## Design differences

| Area | Existing behaviour | Proposed CR behaviour |
| --- | --- | --- |
| Recipient discovery | Contact search plus raw telephone entry | Preloaded directory of named people in the CR's reporting chain |
| Availability | Depends on available contact records | Explicit directory readiness, saved locally across launches |
| Hierarchy | General contact/place selection | Defined rules for eligible people above this CR |
| Data access | Existing contact/report replication scope | Limited messaging directory with its own authorisation |
| Addressing | Telephone destination with optional contact identity | Stable person identity, resolved to a current SMS destination before dispatch |
| Updates | Follows available contact changes | Complete refresh including removals and reassignment |
| Offline use | Local message task creation | Local named selection and queueing, followed by server eligibility checks |

## Areas that will need to change

- **Webapp messaging:** recipient selection, validation, directory-backed identity handling, conversation display, and status wording. Existing starting points include `webapp/src/ts/modals/send-message/`, `send-message.service.ts`, and `hydrate-messages.service.ts` under `webapp/src/ts/services/`.
- **Webapp startup and synchronisation:** directory preload, persistent cache, background/manual refresh, readiness states, and account isolation, coordinated with the existing replication/sync services.
- **API and data access:** derive the authorised reporting chain, expose or synchronise its minimal directory, and validate/resolve queued named recipients before delivery. Review `api/src/services/replication/` if directory data travels through replication.
- **Message processing and history:** integrate recipient validation ahead of SMS dispatch, preserve existing delivery tracking and retry guarantees, and support historical identities without full local contact documents.
- **Administration and configuration:** maintain supervisor assignments and delivery details; enable the new CR flow by role or programme and add translated interface text.

These are responsibility boundaries, not a prescribed endpoint, database schema, or implementation sequence at file level.

## Delivery plan and acceptance

1. Confirm the reporting-chain mapping, included hierarchy levels, and whether multiple people can represent a level. Validate existing contact data against those rules.
2. Establish directory generation, user-specific storage, preload, and refresh behaviour. Demonstrate that messaging access does not expand report or patient access.
3. Connect the named composer and recipient identity to queueing, server validation, and existing SMS dispatch. Verify names remain meaningful in message history.
4. Pilot with a small CR group, checking offline usability, directory freshness, and delivery outcomes before enabling the flow more widely. Keep existing queued messages and historical conversations compatible during rollout.

Acceptance should cover a CR selecting any eligible person above them by name after an offline restart; duplicate names distinguished by context; failed refresh retaining usable data; a successful refresh applying additions and removals; and first setup without a directory showing a clear readiness state. Also cover CR transfers, deactivated recipients, telephone changes before dispatch, account changes on a shared device, rejection of unauthorised recipients, and reconnect/retry without duplicate delivery.

The proposal assumes SMS remains the delivery channel and that all configured ancestor levels are included. Those product choices and the exact mapping from places to reporting people should be settled before implementation.

## Basis for this plan

This plan is based on the repository's message composer, contact search, send-message service, message hydration, and replication authorisation code. The CHT Docs and OpenDeepWiki MCP servers listed in `AGENTS.md` were not available as connected tools in this session; no external documentation claims are assumed here.
