---
id: ADR-0016
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0016: Use native input helpers for the external action bridge

> **V1 implementation amendment (2026-08-26):** the frozen Windows helper is observation-only and Promethee automation is unavailable/fail-closed on Windows. Native action dispatch remains macOS-only. New installations default automatic Pause enabled and automatic Resume disabled; existing stored preferences stay unchanged and the environment kill switch overrides both. The Windows `SendInput` and both-default-off clauses below record the earlier accepted design and are superseded for V1 by this owner-approved implementation boundary.

## Context and problem

ADR-0011 accepted a constrained operating-system action transport and originally preferred semantic macOS Accessibility or Windows UI Automation actions before a bounded visual-input fallback. The active Electron implementation now has a narrower and more uniform path: a repository-owned native helper discovers the Promethee process and windows, while the Electron controller classifies the rendered HUD and derives the exact Pause or Play target. Active Electron code does not invoke AppleScript, JXA, `osascript`, or semantic `AXPress`.

The project owner accepted this native helper as the active external bridge implementation and separately authorized one bounded live macOS Promethee 1.3.29 exercise on 2026-08-25.

## Decision

The active Electron external action bridge SHALL use the repository-owned native helper behind the typed adapter:

- macOS identifies the exact `app.promethee` process, enumerates its on-screen windows through CoreGraphics, revalidates the expected PID and exact HUD rectangle, and posts one left-click pair through CoreGraphics;
- Windows source identifies `Promethee.exe`, enumerates and revalidates the expected PID and exact visible window rectangle, and uses Win32 `SendInput` for one left-click pair; and
- the Electron controller, not the native helper, derives the action target from the second bounded raster classification of the rendered Pause or Play glyph and complete reviewed control layout.

The native helper is an execution mechanism, not an authority source. Before each eligible action, the Electron controller performs two direct, fresh, same-session SQLite observations and two bounded HUD captures/classifications. The second SQLite read and HUD capture occur immediately before dispatch. Both pairs must agree on the expected current state, exact application/PID, HUD identity, rectangle, generation, complete layout, and rendered glyph. The native helper independently revalidates process and exact rectangle before sending one click. It returns only `clicked-unconfirmed` or a typed failure; it never acknowledges Promethee state or retries.

Pause and Resume remain separate opt-in settings and default to off. `PROMETHEE_POMODORO_DISABLE_AUTOMATION=1` overrides both. Start, Stop, End, database writes, private IPC, tokens, credentials, broad screenshots, OCR, arbitrary coordinates, global shortcuts, and automatic retries remain prohibited.

## Platform and evidence boundary

An explicitly authorized macOS exercise against Promethee 1.3.29 passed one complete same-session focus → pause → short break → resume → focus flow. The live HUD measured `159 × 32` while running and `191 × 32` while paused. No session identifier, task text, timestamp, screenshot, or other live content is retained in the documentation.

This evidence proves only that exact macOS/version/scenario observation. It does not turn a click receipt or later SQLite state into command acknowledgement or causation. It does not prove all compatibility, permission, freshness, exclusion, z-order, database-side-effect, installation, packaging, release, signing, or notarization behavior.

The Windows helper exists as source and expresses the corresponding PID/window revalidation plus `SendInput` path. It has not been built or exercised on Windows in the recorded evidence, so Windows and cross-platform support remain unavailable.

Ordinary repository validation continues to use synthetic databases, raster fixtures, and injected executors. It sends no action to a live Promethee process. Live platform exercises require separate exact authorization.

## Rationale

A small native helper removes script interpretation from the active action path, keeps process/window revalidation close to dispatch, and gives macOS and Windows an equivalent one-click contract. Rendered glyph classification is still required because the current external bridge has no supported semantic control identifier or authoritative Promethee command API. The resulting path is intentionally conservative: independent observations may establish current state, but cannot prove which writer caused a later transition.

## Consequences

### Positive

- Active Electron automation has no AppleScript/JXA command construction or semantic accessibility-action dependency.
- Native process/window revalidation occurs immediately around the OS input operation.
- The platform helpers share one bounded request/receipt shape behind the TypeScript controller.

### Negative

- Coordinate input remains sensitive to unreviewed Promethee HUD changes and platform input policy.
- macOS input-event permission and an independently supported Windows runtime still require product/platform evidence.
- The action remains `sent-unconfirmed`; later state is observation, never acknowledgement or causation.

### Neutral

- Historical ADR rationale may mention the retired Accessibility/`AXPress` implementation, but active documentation must not recreate it or imply that Electron uses that path.
- An official Promethee bridge remains a preferred future migration target.

## Validation

- Source and contract checks verify that the active Electron/native path contains no AppleScript, JXA, `osascript`, semantic `AXPress`, Start, Stop, End, generic input, or retry surface.
- Fixture tests cover exact action names, two-read/two-capture preflight, rendered Pause/Play classification, Stop rejection, exact PID/geometry/generation binding, one dispatch, indeterminate receipts, and exact-generation reconciliation.
- The authorized macOS 1.3.29 exercise is recorded separately from ordinary validation and is bounded to the one same-session flow and the two measured HUD sizes above.
- Windows support requires a separate build, permission, identity, input, and end-to-end runtime proof; source presence is insufficient.

## Revisit triggers

- Promethee publishes an official session-control bridge or stable semantic control contract.
- A reviewed Promethee or OS version changes the process identity, HUD geometry/layout, glyphs, or input permission model.
- The native helper cannot reliably restore pointer position or prove that exactly one expected window remains current.
- Windows runtime evidence invalidates the current `SendInput` design.

## Related decisions and evidence

- Amends the active execution mechanism of [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md); ADR-0011's authority, consent, privacy, fail-closed, and no-retry constraints remain in force.
- Refines the action component composed by [ADR-0014](0014-compose-the-external-promethee-bridge.md).
- Preserves [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md), [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md), and [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md).
- Implemented by: the macOS action helper, Windows observation-only helper, platform-gated runtime, and synthetic tests.
