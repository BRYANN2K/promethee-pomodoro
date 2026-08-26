# Architecture decision register

This register records durable architecture decisions for Promethee Pomodoro. An accepted decision governs new work even when only part of the Electron target is verified. Implementation status is established by source/tests and explicit platform/release evidence, not by ADR status alone.

## Status vocabulary

- **Proposed** — under review and not yet binding.
- **Accepted** — approved by the project owner and governing new work.
- **Deprecated** — retained as history but no longer recommended.
- **Superseded** — replaced by a named later decision.

## Decisions

| ID | Decision | Status | Governs |
|---|---|---|---|
| [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md) | Use Electron and TypeScript for the cross-platform target | Accepted | Application platform and language boundary |
| [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) | Integrate through a typed Promethee adapter | Accepted | Promethee trust and data boundary |
| [ADR-0003](0003-keep-the-pomodoro-engine-pure-and-deterministic.md) | Keep the Pomodoro engine pure and deterministic | Accepted | Timer domain model |
| [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md) | Make the Promethee timer the session-control authority | Accepted | Play, pause, resume, and stop semantics |
| [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md) | Render progress as a consuming outline around the real HUD | Accepted; amended by ADR-0010 | HUD outline; local collision clauses are governed by ADR-0010 |
| [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md) | Negotiate capabilities and fail closed across Promethee versions | Accepted | Compatibility contract |
| [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md) | Deliver native signed releases and updates through CI | Proposed | Deferred native packaging, signing, update metadata, and rollback |
| [ADR-0008](0008-use-npm-for-the-first-public-beta.md) | Use npm for the first public beta | Accepted; narrowed by ADR-0017 | Registry publication, identity, provenance, and manual updates |
| [ADR-0009](0009-let-promethee-own-attached-surface-invocation.md) | Let Promethee own attached-surface invocation | Superseded | Historical proposal for host-owned invocation and slot ownership |
| [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md) | Use a local SVG handle for Pomodoro surfaces | Accepted | Local invocation, adjacent placement, host exclusions, and focus boundaries |
| [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md) | Use constrained OS automation as the external Promethee action transport | Accepted; action mechanism amended by ADR-0016 | Pause/Resume permission, identity, observation, and fail-closed boundaries |
| [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md) | Read Promethee tasks from local SQLite under a strict allowlist | Accepted | Read-only `tasks`/`task_projects` exception and task-source privacy boundary |
| [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md) | Read current session as a non-authoritative SQLite observation | Accepted | Minimal current timer state/time; no acknowledgement authority |
| [ADR-0014](0014-compose-the-external-promethee-bridge.md) | Compose the external Promethee bridge | Accepted | Typed composition, freshness, exact Pause/Resume, and fail-closed authority |
| [ADR-0015](0015-use-github-releases-and-a-source-installer-for-v1.md) | Use GitHub Releases and a source installer for V1 | Accepted; primary V1 channel superseded by ADR-0017 | Secondary macOS source installation and manual GitHub Release update check |
| [ADR-0016](0016-use-native-input-helpers-for-the-external-action-bridge.md) | Use native input helpers for the external action bridge | Accepted; Windows action scope narrowed | Native process/window discovery, macOS rendered-glyph/CoreGraphics input, and platform evidence boundary |
| [ADR-0017](0017-use-public-npm-as-the-v1-release-channel.md) | Use the public npm package as the V1 release channel | Accepted | Exact public package, three candidate targets, stable approval, unsigned artifact model, and update/rollback boundary |
| [ADR-0018](0018-retire-the-abandoned-swift-and-preview-tracks.md) | Retire the abandoned Swift and preview tracks | Accepted | Electron-only repository, removal boundary, retained UI skill, and historical-document policy |
| [ADR-0019](0019-keep-a-local-per-task-time-ledger.md) | Keep a local per-task time ledger | Accepted | Running-only local intervals, task snapshots, bounded history/deletion, CSV export, and no durable Promethee session ID |

## Decision relationships

- ADR-0001 establishes the host platform for ADR-0002 through ADR-0007.
- ADR-0002 defines the adapter used by ADR-0004 and the compatibility boundary strengthened by ADR-0006.
- ADR-0003 owns Pomodoro time and phase state; ADR-0004 coordinates that state with Promethee session state.
- ADR-0005 consumes HUD geometry and state exposed under ADR-0002 and guarded by ADR-0006.
- ADR-0017 supersedes ADR-0015's primary-channel selection and activates/narrows ADR-0008: V1 is the public unscoped `promethee-pomodoro` npm package, with `1.0.1` as the first published version after the preserved failed `v1.0.0` candidate, while the macOS source installer and manual GitHub Release check remain secondary. Stable publication used exact manual approval plus verified workflow/registry readback. All three decisions defer, but do not supersede, the native signed distribution proposed by ADR-0007.
- ADR-0010 supersedes the unaccepted ADR-0009 proposal and amends ADR-0005: the outline remains fully input-transparent; Promethee-owned Tasks and transient surfaces stay immobile and retain z-order/input precedence; local handle/menu/tooltip windows may appear only from a complete revision-coherent exclusion set in a safe rectangle, otherwise they remain queued and hidden. Host exclusion schemas, pre-interactive publication, and platform precedence still require Promethee-owner approval and upstream source mapping.
- ADR-0014 composes ADR-0011, ADR-0012, and ADR-0013 as the accepted external bridge. It replaces only ADR-0002's upstream-owned transport requirement for this companion, preserves the typed adapter/session authority, and amends ADR-0006 with explicit compatibility, freshness, and non-authoritative outcomes.
- ADR-0016 amends ADR-0011's active execution mechanism: Electron uses the native helper and rendered Pause/Play evidence with CoreGraphics on macOS rather than AppleScript/JXA or semantic AX actions. The current Windows V1 helper is observation-only and exposes no input action. New installs default automatic Pause on and automatic Resume off; stored preferences remain unchanged and the kill switch overrides both. The one authorized macOS 1.3.29 same-session flow is narrow live evidence; Windows runtime remains unproven.
- ADR-0012 amends only ADR-0002/ADR-0006's task-read and blanket SQLite prohibitions: the main-process provider may read only `tasks` and `task_projects` under a strict read-only, fixed-query contract. The macOS product entry point wires that provider to its local picker; this grants no session, mutation, credential, private IPC, or arbitrary database authority.
- ADR-0013 accepts the minimal session observer after sanitized 1.3.29 research. It remains non-authoritative and cannot acknowledge/correlate a command or authorize retry.
- ADR-0007 must preserve the platform, compatibility, and security boundaries established by ADR-0001, ADR-0002, and ADR-0006 when native packaging resumes.
- ADR-0018 completes ADR-0001's migration boundary: Electron/TypeScript/npm is the only retained implementation; Swift/prototype/design-preview artifacts are no longer a recovery path. Historical ADR rationale remains, without links to deleted files.
- ADR-0019 uses ADR-0012 task/project observations and ADR-0013 running state to build a separate local reporting ledger. It narrows ADR-0013 only by allowing locally derived interval timestamps and selected task/project snapshots; Promethee session identifiers remain ephemeral, and no write, acknowledgement, causation, or retry authority is added.

## Maintenance

Do not rewrite an accepted ADR to make history match a later choice. Add a new ADR that supersedes or amends it, update this index, and link both records. Revisit an ADR when one of its explicit triggers occurs.
