---
id: ADR-0019
status: accepted
date: 2026-08-26
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0019: Keep a local per-task time ledger

## Context

Promethee Pomodoro already reads the selected task and the current Promethee session state through the accepted read-only bridge. Freelancers also need a durable, inspectable record of how much running time was attributed to each selected task. Promethee remains authoritative for whether a session is running, and this companion must not write reporting data back to Promethee or turn its non-authoritative session observation into command authority.

A selected Promethee task may later be renamed, completed, deleted, or omitted from a refreshed task snapshot. Reporting still needs the task and project labels that were visible when the interval was recorded. The ledger also needs bounded storage, explicit deletion, and spreadsheet interoperability without introducing telemetry, cloud synchronization, or an invoicing system.

ADR-0013 previously required observed session identifiers and timestamps to remain ephemeral. This decision narrows that rule: the Promethee session identifier remains process-memory-only, while locally derived interval start/end timestamps and selected task/project snapshots may be persisted solely for local reporting.

## Decision drivers

- Attribute time only while the real Promethee timer is observed as running.
- Preserve useful reporting labels even when a task disappears from later Promethee reads.
- Keep Promethee read-only and retain no Promethee session identifier in durable data or exports.
- Make the ledger inspectable, deletable, bounded, and usable in common spreadsheet tools.
- Recover conservatively after restart without inventing time during downtime.

## Considered options

### Option 1: Local interval ledger with explicit CSV export

Persist closed intervals and at most one active interval in a versioned local file. Store a bounded task/project snapshot with every interval, allow the user to delete individual history entries, and export an explicit RFC 4180-compatible CSV.

### Option 2: Persist aggregate totals only

Persist totals per task without interval timestamps or task snapshots.

This minimizes data, but it cannot support date-based freelance reports, inspectable corrections, or stable labels after a source task disappears.

### Option 3: Write time records to Promethee

Use Promethee storage as the reporting system.

This violates the accepted no-write bridge, couples the companion to private schema and invariants, and would require separate Promethee product authorization.

### Option 4: Keep history only in memory

Discard all reporting data when the application exits.

This is simple but does not satisfy durable reporting or recovery needs.

## Decision

Choose Option 1.

The Electron main process owns a versioned local ledger in `task-time-v1.json` under Electron's per-user application-data directory. Tracking accrues only when a task is selected and the current non-authoritative Promethee observation is `running`. Paused, stopped, missing, stale, ambiguous, or replaced observations accrue no time. **Stop tracking** selects no task, closes the active interval, and leaves closed history intact.

Changing the selected task closes and saves the old active interval before the new task can accrue time. Each interval retains a normalized snapshot of its task ID/title and optional project ID/title, so the history remains intelligible when the source task disappears. A Promethee session identifier may be held only in process memory to detect session replacement; it is absent from the stored schema, renderer history payload, and CSV.

Locally derived `startedAtMs` and `endedAtMs` timestamps are authorized reporting data. They do not become Promethee event timestamps, revisions, acknowledgements, or evidence of command causation.

The store uses atomic replacement and restrictive local permissions. Recovery closes a previously active interval at its last persisted observation rather than extending it across downtime. A corrupt, inaccessible, or unsupported future-version ledger fails closed and is preserved rather than replaced by a new empty file. Closed history retains the newest 10,000 entries subject to a snapshot size strictly below 8 MiB; when either bound would be exceeded, the oldest entries are evicted deterministically.

History is requested newest-first in pages of 100. **Load older** advances through the complete retained ledger, so bounded renderer payloads do not prevent a user from reaching and deleting an old entry. Today and week aggregates use the host's local calendar, with week starting Monday; native `Date` boundaries keep them daylight-saving-aware. CSV timestamps remain UTC for unambiguous interchange.

Users may delete individual local history entries. The application also offers an explicit, user-selected CSV export intended for freelance reporting. The export is UTF-8 with a BOM, RFC 4180/CRLF compatible, and protects spreadsheet-leading formula characters. It contains local interval IDs/status, dates, task/project snapshots, UTC start/end timestamps, and duration values. It contains no Promethee session identifier and does not generate invoices or synchronize externally.

## Consequences

### Positive

- Running time is attributed conservatively to the task the user selected.
- Reports remain understandable after Promethee task churn.
- Users can inspect, delete, and export their own local history without a service account or network dependency.
- Bounded 100-entry pages keep renderer payloads small while preserving access to the full retained ledger.
- Promethee remains read-only and session-control authority remains unchanged.
- Deterministic count and byte bounds prevent unbounded local growth.

### Negative

- `task-time-v1.json` and exported CSV files contain work metadata and local UTC timestamps; users must protect and delete them according to their own privacy and client obligations.
- A failed or delayed checkpoint can lose the most recent unpersisted portion of an interval; the nominal active checkpoint cadence is five seconds, not a transactional billing guarantee.
- Oldest-first eviction means the built-in ledger is not a permanent archive.
- CSV is a reporting interchange, not an invoicing, accounting, or tamper-evident format.

### Neutral

- Individual history deletion affects only Promethee Pomodoro data; it never edits a Promethee task or session.
- Exported files live at the user-selected path and are not managed by the application's retention or uninstall flow.
- The renderer receives bounded reporting projections through validated IPC and never receives filesystem or SQLite authority.

## Implementation and migration

- Store version-1 data in `task-time-v1.json`; reject corrupt, oversized, or unsupported snapshots without broad recovery reads.
- Preserve a corrupt, inaccessible, or future-version file and disable checkpoints instead of overwriting it.
- Checkpoint the active ledger on tracking transitions, task changes, deletion, application shutdown, and a nominal five-second cadence.
- Page history in 100-entry requests and aggregate today/Monday-based week totals using DST-aware local calendar boundaries.
- Keep the Promethee session identifier private and ephemeral in the tracker implementation.
- Keep history and export actions behind sender-validated, narrow preload/IPC operations.
- Do not migrate or rewrite Promethee data. Existing installs begin with an empty local ledger unless a valid version-1 file already exists.

## Validation

The current-source Electron suite passes 133/133 tests, covering tracker transitions, task replacement/disappearance behavior, recovery, deterministic count/byte bounds, strict store decoding and corrupt/future-file preservation, deletion/pagination, local-time/DST aggregates, CSV escaping/formula protection, renderer/main-process history operations, permission gating, adaptive HUD identity tracking, and the package command boundary. Typecheck and the local `darwin-arm64` native/application/resource build also pass against the Electron `43.2.0` lock. These checks use synthetic fixtures and temporary directories; they are not live Promethee, public-package, platform-install, Windows, signing, or publication evidence.

## Revisit triggers

- The project adopts an authorized Promethee-native time-reporting API.
- Retention, client privacy, multi-user, synchronization, or invoicing requirements change.
- A new export format, cloud destination, or telemetry path is proposed.
- The durable schema would need a Promethee session identifier or additional Promethee content.

## Related decisions and evidence

- [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md) authorizes the task/project source but not writes.
- [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md) remains authoritative for session observation; this ADR permits only locally derived reporting timestamps and keeps session identifiers ephemeral.
- [ADR-0014](0014-compose-the-external-promethee-bridge.md) keeps the bridge read-only except for its separately bounded macOS Pause/Resume action path.
- [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) governs V1 distribution and does not publish this change.
- Implementation evidence: `src/electron/task-time-tracker.ts`, `src/electron/task-time-store.ts`, `Tests/electron/task-time-tracker.test.ts`, and `Tests/electron/task-time-store.test.ts`.
- Approval evidence: project-owner decision in the 2026-08-26 project conversation.
