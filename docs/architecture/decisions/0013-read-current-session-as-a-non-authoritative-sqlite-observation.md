---
id: ADR-0013
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0013: Read current session as a non-authoritative SQLite observation

> **Reporting amendment (ADR-0019, 2026-08-26):** observed Promethee session identifiers remain bounded process-memory data and are never persisted, rendered, logged, or exported. ADR-0019 separately permits locally derived task-time interval start/end timestamps and bounded selected task/project snapshots in `task-time-v1.json` and explicit CSV exports. Those local timestamps are reporting data, not Promethee session-row persistence, revisions, acknowledgements, or causation evidence. The historical wording below remains the original decision record.

## Context and problem

The project owner first authorized a read-only investigation, then explicitly accepted the resulting minimal session observer as part of the external bridge in the current conversation on 2026-08-25. The authorization still excludes arbitrary row content from notes, messages, profiles, or any unrelated product area.

A read-only audit of an installed Promethee 1.3.29 database on macOS found the expected legacy path, `journal_mode=wal`, `user_version=0`, and 23 application tables. The `sessions` table has the exact audited columns listed below. One sanitized active-row calculation matched the visible HUD within capture delay. No content or identifier is recorded in this repository.

The table has no `updated_at`, monotonic revision, event cursor, or command acknowledgement. Therefore a snapshot can support display and reconciliation, but cannot prove that a native input action was accepted, correlate a state change to a command, or establish an authoritative event stream.

Implementation note, 2026-08-25: the Electron `node:sqlite` reader now contains the exact eight-column query, a two-row ambiguity bound, strict integer/time validation, conservative running/paused derivation, file-identity checks, and synthetic tests. The macOS product entry point wires it to the observation-driven external runtime controller. Ordinary automated validation does not open the live database, and the implementation has no acknowledgement or retry authority. Exact synthetic 1.3.29 fixture, lifecycle/freshness matrix, side-effect, and cross-platform proof remain open.

## Scope and non-goals

This decision governs schema-only capability inspection and a bounded read of current-session timer fields. It authorizes implementation only within ADR-0014's external bridge and does not authorize session writes, authoritative action acknowledgement, automatic retry, task mutation, arbitrary table rows, content disclosure, private IPC, credentials, tokens, cookies, or remote service access.

## Audited 1.3.29 schema evidence

The installed macOS `sessions` schema reported:

| Column | Declared shape |
|---|---|
| `id` | `TEXT PRIMARY KEY` |
| `user_id` | `TEXT NOT NULL` |
| `task` | `TEXT` |
| `started_at` | `INTEGER NOT NULL` |
| `ended_at` | `INTEGER` |
| `duration_seconds` | `INTEGER` |
| `xp_earned` | `INTEGER DEFAULT 0` |
| `source` | `TEXT DEFAULT manual` |
| `app_context` | `TEXT` |
| `synced_at` | `INTEGER` |
| `end_reason` | `TEXT` |
| `total_pause_ms` | `INTEGER NOT NULL DEFAULT 0` |
| `pause_started_at` | `INTEGER` |
| `deleted` | `INTEGER NOT NULL DEFAULT 0` |
| `sync_state` | `TEXT NOT NULL DEFAULT synced` |
| `parked_at` | `INTEGER` |
| `park_reason` | `TEXT` |
| `resumed_count` | `INTEGER NOT NULL DEFAULT 0` |
| `resumed_gap_ms` | `INTEGER NOT NULL DEFAULT 0` |

This table shape is compatibility evidence for the inspected 1.3.29 installation only. It is not permission to read every listed field and is not proof for Windows or another Promethee build.

## Decision drivers

- Derive the current timer state/time without copying credentials or invoking private IPC.
- Keep Promethee session state authoritative and distinguish observation from acknowledgement.
- Minimize row fields and retain them only as long as needed in memory.
- Fail closed on multiple active rows, invalid times, path/file/schema changes, or stale reads.
- Allow capability audits without exposing unrelated application content.

## Constraints

- Runtime row reads are limited to `sessions.id`, `started_at`, `ended_at`, `duration_seconds`, `total_pause_ms`, `pause_started_at`, `parked_at`, and `deleted`.
- The provider must not select `user_id`, `task`, `xp_earned`, `source`, `app_context`, `synced_at`, `end_reason`, `sync_state`, `park_reason`, `resumed_count`, or `resumed_gap_ms` unless a later explicit decision proves one is necessary.
- Schema-only audit may inspect table/index names, column names/types/nullability/defaults, `user_version`, and `journal_mode`; it may not select arbitrary table rows, retain full schema SQL bodies unnecessarily, or print live identifiers/content.
- The database is opened read-only with `PRAGMA query_only = ON`; the side-effect prohibitions in ADR-0012 apply.
- A current-session snapshot is non-authoritative. It cannot acknowledge a command, allocate retry authority, or prove which actor caused a transition.
- Session identifiers and timestamps are held only in bounded process memory and are never logged, documented, telemetered, or included in update requests.

## Considered options

1. Wait for authoritative `session.read`/events through an official bridge.
2. Read only the minimum current-session fields from local SQLite as a non-authoritative snapshot.
3. Treat SQLite row changes as command acknowledgements or an event stream.
4. Read broader session/task/content tables to improve inference.

## Decision

We **allow a strict read-only current-session observer over the local `sessions` table**, behind a typed main-process port and separately from the session-command transport. It reads only the eight allowlisted runtime fields above and derives one current state plus worked duration.

For a running row, worked milliseconds are derived as:

```text
(pause_started_at ?? observedNow) - started_at - total_pause_ms
```

The provider uses one captured `observedNow` for the complete snapshot, validates integer units and safe bounds, and identifies a paused session only when `pause_started_at` is present. Ended, deleted, or parked rows are not active. Zero eligible rows yields `none`; more than one eligible row, a future start, a negative/overflowing result, impossible pause totals, malformed values, changed file identity, or unsupported schema yields `incompatible` or `ambiguous`, never a guessed timer.

The result carries local observation time and compatibility status, not a bridge revision or event cursor. Polling or refreshing may update display/reconciliation state, but a value transition cannot be attributed to a preceding OS action. The AX/UIA candidate in ADR-0011 must continue to report dispatch as unconfirmed/indeterminate; this SQLite observer must not turn a matching state into command acknowledgement or authorize blind retry.

Schema-only audit is a separate diagnostic capability. It can establish whether required tables/columns exist without reading unrelated rows. Any later request for a new table or content field requires a new explicit decision.

## Rationale

The sanitized 1.3.29 comparison supports the time formula and provides useful local observation without exposing session task text or user metadata. Treating it as non-authoritative respects the missing revision/acknowledgement semantics. A distinct observer port makes this limitation explicit and preserves migration to official `session.read` and events.

## Consequences

### Positive

- The companion can display/reconcile current timer state without secrets or private IPC.
- Field minimization excludes task text, user identity, application context, and sync metadata.
- The observer is transport-independent and replaceable by a future official session feed.

### Negative

- Polling has capture delay and can miss intermediate transitions.
- No column identifies the writer or correlates a row transition to an action.
- WAL consistency, path, file identity, and supported schema need independent platform proof.
- Windows path/schema evidence remains unavailable.

### Neutral

- Session mutation still requires an independently accepted transport and capability.
- Current Promethee and Pomodoro timers may differ briefly between snapshots without proving divergence.

## Implementation and migration

1. Record a synthetic 1.3.29 schema fixture containing no live content and the exact allowlisted current-session query.
2. Maintain the host-wired observer using the `node:sqlite` mechanism reviewed under ADR-0012; complete its supported-version, lifecycle, side-effect, and platform evidence.
3. Return exact typed states: `none`, `running`, `paused`, `ambiguous`, `incompatible`, and `unavailable`, with local observation/freshness time but no authoritative revision.
4. Bound refresh frequency, maximum age, execution time, rows, integers, and in-memory lifetime; coalesce overlapping reads and expose stale data as `unknown`.
5. Keep the observer physically and logically separate from any session action executor; it never authorizes automatic retry.
6. Prefer official revisioned `session.read`/events if Promethee exposes a supported API later.

## Validation

- Synthetic fixtures cover zero, one, and multiple active rows; running/paused/ended/deleted/parked combinations; unsafe integers; future timestamps; excessive pause totals; WAL snapshots; schema drift; and file replacement.
- Tests assert the prepared statement names exactly the eight allowed columns and never contains task/user/content columns or a wildcard.
- Read-only side-effect tests cover the database plus journal/WAL files.
- Clock-controlled tests verify the worked-time formula and one captured observation instant.
- Command/coordinator tests prove observation never changes an OS action from indeterminate to acknowledged and never authorizes retry.
- Ordinary validation opens synthetic fixtures only. Live content/identifiers are not printed, logged, snapshotted, or committed.
- The current live evidence is recorded only as sanitized capability facts: macOS path present, WAL, `user_version=0`, schema shape, one active-row shape, and HUD-time agreement within capture delay.

## Revisit triggers

- Promethee publishes authoritative session reads/events.
- The `sessions` schema, time units, path, WAL behavior, or active-row semantics change.
- More than one active row is valid product behavior.
- Product logic attempts to use observation as action acknowledgement or retry authority.
- Any additional session/content field is requested.

## Related decisions and evidence

- Amends through ADR-0014: SQLite-read and authoritative-observation clauses in [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) and [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Reuses the read-only database boundary from [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md).
- Preserves session authority in [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md).
- Does not acknowledge or correlate the accepted Pause/Resume actions in [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md).
- Implemented by: the Electron allowlisted session observer, external runtime controller, and synthetic tests.
- Evidence: an explicitly authorized, sanitized read-only Promethee 1.3.29 macOS schema/state investigation plus explicit architecture acceptance in the current conversation on 2026-08-25; no content or identifier retained.
