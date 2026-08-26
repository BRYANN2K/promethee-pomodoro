# Promethee Pomodoro documentation

This index separates the active Electron/TypeScript/npm contract, verified synthetic/mock-backed slices, and still-unverified platform/release claims. A document marked **Target** is a contract or design input, not evidence that the complete behavior exists.

## Learn

- [Product scope](product-scope.md) — user problem, product boundaries, and delivery status.
- [Repository README](../README.md) — current build and project entry point.

## Understand

- [Target architecture](architecture/target-architecture.md) — Electron, adapter, and pure timer boundaries.
- [Build order](architecture/build-order.md) — dependency order and evidence gates for the product capabilities.
- [Pomodoro state machine](architecture/pomodoro-state-machine.md) — states, events, invariants, and timing rules.
- [Compatibility and security](architecture/compatibility-and-security.md) — Promethee trust boundaries and forbidden shortcuts.
- [Architecture decision record index](architecture/decisions/README.md) — durable decisions and their status.

## Reference

- [Future official Promethee bridge profile](architecture/promethee-bridge-contract.md) — stronger authoritative capabilities, commands, events, and failures; not the selected external profile.
- [Accepted constrained OS automation decision](architecture/decisions/0011-consider-os-accessibility-as-an-external-promethee-transport.md) — Pause/Resume authority, permission, identity, observation, and no-retry boundary.
- [Accepted read-only task-source decision](architecture/decisions/0012-read-only-promethee-tasks-from-local-sqlite.md) — strict `tasks`/`task_projects` SQLite exception; the macOS host wires the bounded reader, while supported-version/platform proof remains open.
- [Accepted session-observation decision](architecture/decisions/0013-read-current-session-as-a-non-authoritative-sqlite-observation.md) — minimal non-authoritative session state/time, no command acknowledgement authority.
- [Accepted external-bridge composition](architecture/decisions/0014-compose-the-external-promethee-bridge.md) — combines read-only observations, HUD preconditions, exact Pause/Resume, freshness, and fail-closed semantics.
- [Accepted native input-helper decision](architecture/decisions/0016-use-native-input-helpers-for-the-external-action-bridge.md) — active Electron process/window discovery, rendered-glyph target, CoreGraphics input, Win32 source, and evidence boundary.
- [Accepted public npm V1 channel](architecture/decisions/0017-use-public-npm-as-the-v1-release-channel.md) — exact public package, three candidate targets, protected stable publication, unsigned boundary, and evidence gates.
- [Accepted local per-task time ledger](architecture/decisions/0019-keep-a-local-per-task-time-ledger.md) — running-only attribution, retained task snapshots, bounded history/deletion, CSV export, and no durable Promethee session ID.
- [Promethee visual calibration](design/promethee-visual-calibration.md) — measured HUD geometry, palette, density, and prototype scale corrections.
- [Glossary](glossary.md) — project-specific terms.

## Operate and change

- [Promethee implementation guide](development/promethee-implementation-guide.md) — how Promethee engineers map and implement the first-party bridge without inventing source paths.
- [Validation strategy](development/validation-strategy.md) — evidence required at each boundary.
- [V1 npm distribution and updates](releases/distribution-and-updates.md) — install/run/uninstall, local macOS Electron application, task-history data, permissions, unsigned package model, update/rollback behavior, CI gates, and troubleshooting.
- [V1.0.1 release notes](releases/v1.0.1.md) — current candidate, release recovery, platform evidence, and known limitations.
- [Changelog](../CHANGELOG.md) — release-visible changes and unpublished status.

## Documentation status labels

- **Current** means the repository contains the implementation described at the stated boundary; it does not imply end-to-end or platform proof.
- **Target** means the behavior is specified or approved as a direction but is not completely implemented and verified.
- **Synthetic** means executable presentation behavior that uses local fixtures and proves no live Promethee or platform integration.
- **Proposed** means a decision or provider still needs explicit approval.

Update this index whenever a document is added, renamed, superseded, or archived.
