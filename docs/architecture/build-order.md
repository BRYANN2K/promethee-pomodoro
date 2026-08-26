# Build order and dependency gates

**Status:** Target delivery plan with current independent-slice evidence.

The changes below are intentionally serial at their contract boundaries. Work inside a validated stage may run in parallel, but a downstream stage must not assume an unproven upstream capability.

| Order | Capability contract | Depends on | Exit gate |
| --- | --- | --- | --- |
| 1 | `adopt-electron-project-contract` | None | Electron/TypeScript project contract, package-manager decision, and validation commands are reviewed. |
| 2 | ADR-0014/ADR-0016 external bridge (`adopt-os-accessibility-transport` + `add-read-only-promethee-session-observation`) | 1 | Exact path/schema/identity/freshness profile, current HUD geometry/layout, and non-authoritative session observation pass on macOS and Windows; rendered-glyph-gated native Pause/Resume passes on macOS without writes, Start/Stop/End, private IPC, acknowledgements, or automatic retry. Windows V1 remains passive. |
| 3 | `add-pomodoro-engine` | 1 | Pure state-machine tests cover time, transitions, early resume, and long-break cadence without Electron. |
| 4 | `add-session-coordination` | 2, 3 | Race and reconciliation tests prove Promethee remains the sole session-control authority. |
| 5 | `add-cycle-persistence` | 3, 4 | Restart, corrupt-state, sleep/wake, and schema-migration tests recover safely. |
| 6 | `add-promethee-task-linking` plus ADR-0019 local task-time reporting | 1, 3, 5; ADR-0012, ADR-0019 | Fixed read-only `tasks`/`task_projects` provider, bounded snapshot refresh, stable/null selection, running-only local intervals, disappeared-task snapshots, paged deletion/CSV, DST-aware aggregates, corrupt/future preservation, deterministic retention, no-write side-effect tests, and separate macOS/Windows path/schema proof pass. |
| 7 | `add-hud-progress-overlay` | 2, 3, 4 | Real HUD verification covers running/paused widths, all edges, multiple displays, immutable Tasks/transient exclusions, `Accept` delivery-latency safety, both-unsafe handle queue/hide/recovery, safe local-menu reversal, and no-safe queue/hide. |
| 8 | `add-pomodoro-menu-settings` | 2, 3, 5, 6, 7 | The ADR-0010 local SVG handle, serialized local surface controller, four Context/Tasks/History/Settings tabs, exclusion-safe Tasks/transient avoidance, settings, localization, reporting actions, and quick actions pass on macOS and Windows. |
| 9 | `add-ready-and-notifications` | 3, 4, 7, 8 | Permission, deduplication, Ready, dismiss, and early-play behaviors pass real platform checks. |
| 10 | `add-cross-platform-release` | 1–9 | The reviewed public npm tarball, immutable Git tag/source, protected stable workflow, registry/GitHub readback, and clean candidate installation pass on macOS arm64, macOS x64, and Windows x64. Project-signed native delivery remains a later independent gate. |

## Current evidence against the gates

| Stage | Evidence present | Gate result |
| --- | --- | --- |
| 1. Electron contract | Electron/TypeScript/npm is the only product implementation. Current local evidence passes typecheck, build, and 254/254 tests: 33 core + 71 integration + 17 persistence + 133 Electron. The local build uses the Electron `43.2.0` lock and includes the `darwin-arm64` helper plus app/resources. | Local foundation accepted. The immutable `v1.0.0` run built all three helpers but failed clean-package smoke; corrected `v1.0.1` matrix proof remains open. |
| 2. External bridge | ADR-0014 accepts the architecture and ADR-0016 selects native helpers. The macOS entry point composes the allowlisted SQLite reader, observation-driven runtime, native HUD locator/CoreGraphics input, local surfaces, task/settings IPC, notifications, preferences, and a first-launch permission panel. Launch performs a passive refresh, presents onboarding, then may invoke the native request at most once per process if required; **Allow** remains an explicit retry, while Check again/Settings review and every phase transition stay request-free. Permission or missing-geometry recovery opens a current-display-centered menu independent of the HUD and returns to attached placement after verified screen reading plus safe geometry recover; a second launch brings the existing popup forward. Timer control uses helper-reported Input Events. The Read-timer check and attachment require helper-reported Screen Recording plus a bounded real `/usr/sbin/screencapture` probe whose image is never retained. Once screen reading passes and both automation settings are off, Input Events may be skipped through **Not now** without reopening or re-requesting control permission. A newly observed Screen Recording grant schedules one guarded relaunch. Shutdown/relaunch revokes authority, aborts native control and poll rescheduling, gives queued local checkpoints at most 750 ms, and finishes through `app.exit(0)`. Initial defaults are automatic Pause on and Resume off; OS privacy toggles remain user-controlled and the kill switch overrides both. One authorized Promethee 1.3.29 same-session focus → pause → short break → resume → focus flow passed with `159 × 32` running and `191 × 32` paused HUDs. A 2026-08-26 helper check returned `1,1`; a separate local smoke passed second-launch popup recovery and `TERM` quit → manual reopen. Windows V1 is passive and has no automation. | Open. No post-build live Screen-Recording-grant-and-automatic-relaunch/denial/revocation/regrant permission proof, supported-version/database-side-effect matrix, Windows passive-runtime proof, or release support exists. Local ad hoc rebuilds may require regrant. Host exclusion/precedence proof remains unavailable. |
| 3. Pomodoro engine | Pure implementation in `src/core`; 33/33 tests pass. | Independent slice accepted and locally verified; broader property/exhaustive coverage remains open. |
| 4. Session coordination | Serialized coordinator over the future official-profile typed adapter; 71/71 controlled-double integration tests pass. | Stronger-profile slice locally verified. ADR-0014's observation/`sent-unconfirmed`/no-retry coordinator amendment and real bridge gate remain open. |
| 5. Persistence | Strict version-1 cycle codecs/recovery/storage port and the separate Electron preference store exist; 17/17 pure persistence tests pass. | Pure cycle contract plus host-wired preference I/O exist. No cycle-snapshot adapter, durability/application-data-path proof, cycle coordinator/host lifecycle wiring, real recovery reconciliation, released-version migration, or macOS/Windows proof exists. |
| 6. Task linking/reporting | ADR-0012 accepts strict read-only access to `tasks` and `task_projects`; the host wires bounded mappings to its local task picker. ADR-0019 adds running-only local intervals in `task-time-v1.json`, task-switch closure, disappeared-task snapshots, individual deletion, freelancer CSV, no durable/exported session ID, and deterministic newest-10,000/`<8 MiB` retention. Controlled Electron tests cover the local tracker/store/UI boundary. | Open. No exact supported-version task/project schemas, complete database side-effect proof, clean platform application-data/export proof, or independent Windows runtime proof exists. CSV is not accounting certification. |
| 7–9. HUD/menu/Ready UI | Approved design artifacts, pure planning, a host-wired native locator/capture/local-window composition, adaptive 16 ms→100 ms geometry polling, a four-tab menu, and the bounded live 1.3.29 flow exist; the Electron fixture suite exercises planning and local runtime helpers. | Open. The one live flow is not authoritative exclusion, host-precedence, Windows, complete Ready-flow, or notification permission/deduplication proof. Local handle/menu safety still depends on validated current exclusions and deterministic hide/recovery. |
| 10. Release | ADR-0017 selects the public unscoped npm package for V1. Local `promethee-pomodoro@1.0.1` metadata, CLI/files allowlist, three helper targets, secondary macOS source installer with packaged icon, pinned three-platform CI/release workflows, release verifier, and manual bounded GitHub Releases check exist. The local installer works around changing ad hoc `cdhash` identities by resetting only current/retired bundle Accessibility and ScreenCapture TCC entries after install; users must revalidate and regrant after every V1 rebuild/install. | Open. The npm name returned `E404`, so a separately authorized one-time bootstrap precedes exact Trusted Publisher setup. The immutable `v1.0.0` run built all helpers but failed clean-package smoke before publication; `v1.0.1` carries the corrections. Electron is locked at the authorized `43.2.0`; clean registry and complete platform evidence remain unavailable until the corrected matrix passes. Future Developer ID signing is required for durable macOS identity. |

## Critical path

ADR-0014's external bridge is the highest-risk proof dependency. ADR-0013 observations cannot acknowledge commands or authorize retry; Pause/Resume remains indeterminate without fresh compatible state. ADR-0012 creates a separate provider/schema/path/no-write task gate. Attached-surface safety still depends on exact current Tasks/reward/overtime exclusions and proven Promethee input precedence. If unavailable, local interactive windows stay disabled; the outline never becomes an unsafe fallback.

The dependency flow is:

```text
Electron contract ─┬─> External bridge ──> session coordination ─┬─> HUD ─> menu/settings
                   ├─> ADR-0012 task source ─> task linking ───────┤
                   │                              └─> ADR-0019 local reporting
                   └─> Pomodoro engine ─> persistence ─────────────┴─> Ready/notifications
All validated capabilities ─────────────────────────────────────────────> release
```

## Gate rules

1. A proposal and its delta specification are reviewed before implementation.
2. A bridge mock can unblock core tests but cannot satisfy the integration gate.
3. Visual screenshots are review evidence, not proof of session synchronization.
4. Source inspection is not proof of macOS or Windows runtime behavior.
5. Creating CI or release files does not authorize publishing.
6. The retired Swift/prototype/design-preview track is not recreated as a fallback; current product evidence comes from Electron source/tests and the retained project UI skill.
7. A V1 tag, GitHub Release, npm publication, or `latest` mutation cannot occur without an actual public Git HEAD and exact authorization for its tag, version, commit, workflow, artifact digest, registry, and release targets.

## Contract map

Each row maps one change to one primary capability:

- `adopt-electron-project-contract` → `project-foundation`
- `add-promethee-bridge-v1` → future official `promethee-bridge` profile
- `add-pomodoro-engine` → `pomodoro-cycle`
- `add-session-coordination` → `session-coordination`
- `add-cycle-persistence` → `cycle-persistence`
- `add-promethee-task-linking` → `promethee-task-linking`
- ADR-0019 → local per-task time ledger, history deletion, and CSV reporting
- `add-hud-progress-overlay` → `hud-progress-overlay`
- `add-pomodoro-menu-settings` → `pomodoro-menu-settings`
- `add-ready-and-notifications` → `ready-notifications`
- `add-cross-platform-release` → `cross-platform-release`
- `adopt-os-accessibility-transport` → historical identifier for the accepted ADR-0011/ADR-0016 native action/geometry path
- `add-read-only-promethee-session-observation` → accepted non-authoritative `promethee-session-observation` path
