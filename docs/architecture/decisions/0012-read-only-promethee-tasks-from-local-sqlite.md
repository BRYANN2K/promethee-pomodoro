---
id: ADR-0012
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0012: Read Promethee tasks from local SQLite under a strict allowlist

> **Reporting amendment (ADR-0019, 2026-08-26):** this provider still never persists a bulk Promethee task snapshot. After explicit selection, ADR-0019 additionally permits the companion to retain bounded task/project labels with each local reporting interval so history survives source-task disappearance. It adds no Promethee write, arbitrary query, or session-ID persistence authority. The historical wording below remains the original decision record.

> **Repository cleanup (2026-08-26):** ADR-0018 retired the former Swift source and tests. Historical Swift evidence below explains how the exception was discovered; current implementation evidence is the Electron `node:sqlite` reader and synthetic tests.

## Context and problem

ADR-0002 originally prohibited all direct Promethee SQLite access in the Electron target and required task data to arrive through a Promethee-owned bridge. On 2026-08-25, the project owner explicitly authorized a narrower external companion boundary: read-only access to Promethee's local SQLite database solely for `tasks` and `task_projects`.

The retained Swift prototype demonstrates one macOS path, opens SQLite with `SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX`, enables `PRAGMA query_only`, and selects bounded fields from `tasks`. Its unit test uses a disposable fixture. That evidence does not prove the installed Promethee schema, a Windows path, `task_projects` columns, WAL/locking behavior, Electron dependency choice, or live compatibility with a specific Promethee release.

Implementation note, 2026-08-25: the Electron tree now contains a main-process reader using Node's built-in `node:sqlite`. It resolves fixed macOS/Windows path shapes, opens a canonical regular `promethee.db` read-only, enables `query_only`, disables extension loading, uses fixed bounded `tasks`/`task_projects` statements, validates decoded rows, and has synthetic fixture tests. The macOS product entry point wires it to the local task picker and selected-reference store without granting renderer database authority. This does not establish exact supported-version task/project schema, database/WAL side-effect freedom, Windows runtime compatibility, or release support, and does not change the decision boundary below.

## Scope and non-goals

This decision authorizes only the minimum local rows needed to list eligible tasks, resolve their projects, and persist an explicit selected task reference in Promethee Pomodoro's own versioned storage. It does not authorize writes, session-state reads, timer coordination, task completion, arbitrary table/schema inspection, private IPC, credentials, tokens, cookies, remote APIs, or live database validation in ordinary repository checks.

## Decision drivers

- Make task selection useful without waiting for an upstream task bridge.
- Preserve Promethee database integrity and ownership.
- Limit data exposure to the two explicitly authorized tables and minimum columns.
- Fail closed across path, schema, version, lock, corruption, and permission changes.
- Keep the typed task-source boundary replaceable by a future official API or bridge.
- Avoid putting task content in diagnostics, telemetry, updates, or documentation.

## Constraints

- Only `tasks` and `task_projects` may be queried. `sqlite_schema`, session tables, user/account tables, configuration, caches, attached databases, and every other table are outside authority.
- The database is opened with SQLite's read-only flag and `PRAGMA query_only = ON` before preparing application queries.
- SQL statements are fixed, reviewed, parameterized where values are needed, and contain explicit table/column names. No `SELECT *`, dynamic identifier, arbitrary SQL console, `ATTACH`, extension loading, writable pragma, migration, trigger, temporary write, or user-supplied SQL is allowed.
- The process must never create, replace, copy, chmod, repair, vacuum, checkpoint, migrate, or otherwise mutate the Promethee database or its journal/WAL files.
- Task and project text is application content. It must not be logged, emitted in telemetry/update checks, placed in documentation/fixtures, or retained as a raw database snapshot.
- No SQLite task read grants any session, Accessibility, IPC, credential, network, or task-write capability.

## Considered options

1. Continue to require `tasks.read` and `tasks.events` from an official bridge.
2. Add a narrow read-only SQLite task-source provider limited to `tasks` and `task_projects`.
3. Read arbitrary local tables or infer session state from the database.
4. Copy credentials or call Promethee's remote data service.

## Decision

We will **allow an external companion to implement the typed task-source port with a strict read-only SQLite provider limited to `tasks` and `task_projects`**. ADR-0014 composes this provider with the separate accepted session/HUD/action providers. This decision alone grants no session command, HUD, exclusion, or additional table authority.

The provider opens one explicitly resolved database file in read-only mode, enables `query_only`, disables extension loading, and executes only reviewed per-version prepared statements. It reads a bounded task page and the minimum project fields needed to label those tasks. It maps values into the existing normalized task/project model and closes statements and the connection promptly.

The provider validates an exact path, supported Promethee schema/version fixture, required columns and value bounds before returning data. It never scans the filesystem for candidate databases and never falls back to another table or guessed column. A missing database, unsupported platform/version/schema, denied permission, busy/locked/corrupt file, malformed row, excessive result, or changed file identity produces a typed unavailable/incompatible result and an empty non-live task source.

On macOS, the legacy source path `~/Library/Application Support/Promethee/promethee.db` is repository and sanitized installed-path evidence only; it does not prove the task/project schema. The current reader derives the corresponding fixed Windows path shape, but no Windows installation or schema has been inspected. Node's built-in `node:sqlite` is the current implementation mechanism and added no npm dependency. Independent supported-version, side-effect, platform, and runtime proof remain release gates.

The provider may retain normalized task/project values in memory for the active picker. It does not persist a bulk database snapshot. After an explicit user selection, Promethee Pomodoro may persist only the bounded normalized selected reference required by the cycle-persistence contract. The selection remains non-authoritative and never causes a Promethee task write.

## Rationale

The user-authorized two-table exception delivers the requested task picker without weakening session authority or accessing Promethee secrets. Fixed queries, a read-only connection, a second `query_only` guard, narrow schema/version compatibility, and data-minimized output substantially reduce the risk compared with arbitrary database integration. Keeping the provider behind the typed task-source port makes a later official bridge migration possible without changing cycle/UI semantics.

## Option comparison

| Driver | Official task bridge | Allowlisted read-only SQLite | Arbitrary SQLite/session reads | Credential/remote reuse |
|---|---|---|---|---|
| Upstream change required | Yes | No | No | No |
| Authorized scope | Owner-defined service | `tasks` + `task_projects` only | Unbounded | Crosses auth boundary |
| Mutation risk | Service-controlled | Guarded read-only connection | High if scope drifts | Remote write/exposure risk |
| Change notification | Authoritative events possible | Bounded refresh only | Schema-dependent | Service-dependent |
| Cross-platform evidence | Pending | macOS path hinted; Windows unknown | Unknown | Not authorized |
| Decision | Preferred future source | Accepted narrow exception | Rejected | Rejected |

## Consequences

### Positive

- Task selection can proceed independently of an upstream task bridge.
- The companion never needs Promethee credentials or private IPC.
- A narrow normalized task-source port preserves migration to an official API.

### Negative

- Local schema and file paths are private compatibility surfaces that require per-version, per-platform fixtures.
- SQLite read consistency, journal/WAL layout, installation sandboxing, and locking require real platform proof.
- There is no authoritative task event stream; refresh results are snapshots and can become stale.
- The built-in `node:sqlite` implementation still needs host-lifecycle, side-effect, compatibility, and renderer-isolation review before product enablement.

### Neutral

- Promethee remains authoritative for task state, and Pomodoro never completes or edits tasks.
- The official bridge contract still governs every non-task integration capability.

## Implementation and migration

1. Capture authorized schema fixtures containing synthetic data only for the exact supported Promethee versions; do not inspect or record live task content.
2. Record exact macOS and Windows database paths and file-identity expectations independently.
3. Review the selected built-in `node:sqlite` mechanism and its Electron runtime behavior; any replacement dependency still requires exact authorization.
4. Complete and wire the dedicated main-process task-source provider with no renderer filesystem or SQL authority.
5. Enforce fixed query text, read-only open flags, `query_only`, bounded row/text/value decoding, cancellation, timeout, and connection close.
6. Normalize eligible task/project rows and expose only typed picker operations through the preload boundary.
7. Label refresh data as snapshot/non-live when compatibility or freshness cannot be established.
8. Prefer an official Promethee task API/bridge later when it meets the same normalized contract.

## Validation

- Unit tests create disposable synthetic databases containing `tasks`, `task_projects`, forbidden decoy tables, malformed values, and schema variations.
- Tests prove the provider rejects write statements, dynamic identifiers, `ATTACH`, unknown columns/tables, excess rows/text, wrong file identity, and unsupported schemas.
- Filesystem tests prove the database, journal, and WAL metadata/content are unchanged across success and failure paths.
- Renderer/security tests prove no database path, SQL string, native handle, or arbitrary query API crosses preload.
- Platform proofs use explicitly authorized disposable Promethee data and record no task title/content in logs or evidence.
- Ordinary repository validation uses synthetic fixtures only and reads no live Promethee database.

## Revisit triggers

- Promethee publishes a supported task API or official bridge.
- A supported release changes either table, the required columns, database path, journal mode, or file permissions.
- The chosen SQLite runtime cannot guarantee read-only behavior without side effects.
- Windows installation or sandboxing prevents a narrow read-only provider.
- Product scope requests any additional table, field, write, or event capability.

## Related decisions and evidence

- Amends: task-read and SQLite clauses only in [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) and [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Preserves: session authority in [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md).
- Composed without expanding its scope by: [ADR-0014](0014-compose-the-external-promethee-bridge.md), alongside accepted [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md) and [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md).
- Implemented by: the Electron read-only SQLite provider, task picker, and synthetic tests.
- Current evidence: a host-wired Electron `node:sqlite` reader with fixed task/project projections, a local picker/selection path, and synthetic fixtures. No supported-version task/project schema proof, database/WAL side-effect proof, Windows runtime proof, or release support exists.
