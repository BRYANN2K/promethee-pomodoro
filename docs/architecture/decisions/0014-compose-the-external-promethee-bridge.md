---
id: ADR-0014
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0014: Compose the external Promethee bridge from local observations and bounded native controls

> **V1 implementation amendment (2026-08-26):** the active action path is macOS-only. New installations initially default automatic Pause enabled and automatic Resume disabled. Verified screen reading—helper Screen Recording plus the bounded real-capture probe—is mandatory for attachment. After it passes, choosing **Not now** may skip Input Events and persists both automation settings off without reopening recovery solely for missing control. Later enabling either remains explicit, other persisted values remain unchanged, and the kill switch overrides both. Windows V1 composes the read-only observations and attached UI but exposes no Promethee action. Historical references below to Windows `SendInput` or both settings defaulting off do not describe current V1 behavior.

> **Permission-onboarding implementation note (2026-08-26):** first launch on macOS first passively preflights two capability rows. After the startup refresh and visible onboarding, the host may invoke the native permission request automatically at most once per process if required; macOS may show Accessibility/register the app, while the user controls final System Settings toggles. **Check again**, Settings review, and phase transitions are request-free; **Allow** remains the explicit retry. Input Events status comes from the native helper. The Read-timer check and attachment authority require helper-reported Screen Recording plus a bounded probe through the real `/usr/sbin/screencapture`; no probe image is retained. Permission and missing-geometry recovery keep the menu centered in the current display without a HUD anchor and restore attached placement after mandatory screen reading plus current safe geometry recover. A Screen Recording false-to-true transition schedules one guarded relaunch: revoke automation authority, abort native control, prevent poll rescheduling, wait at most 750 ms for queued preference/task-time checkpoints, call `app.relaunch()`, then finish through `app.exit(0)`. Ordinary quit uses the same bounded flush/exit path without relaunch. A second launch brings the existing popup forward. After both checks pass the button becomes **Continue**. Once screen reading passes, a localized **Not now** path may skip Input Events and persists onboarding completion with automatic Pause and Resume both off for passive attached use without recovery or native-request reopening solely for missing control on later launches; it is refused while screen reading is unavailable. Permission request and automation enablement remain separate explicit choices. Local ad hoc rebuilds may require regrant. A 2026-08-26 native-helper check returned `1,1`; a separate smoke passed second-launch popup recovery and `TERM` quit followed by manual reopen. Clean-install, real Screen Recording grant/relaunch, prompt, denial, revocation, regrant, and application-identity lifecycle proof remain open.

> **Local ad hoc identity note (2026-08-26):** the V1 source installer applies an ad hoc signature with a build-specific `cdhash`, then resets only Accessibility and ScreenCapture TCC entries for the current and retired bundle identifiers. The reset grants nothing; the user must revalidate and regrant to the installed build after every V1 rebuild/install. This is a temporary local-install workaround, not the long-term update model. Future Apple Developer ID signed delivery supplies stable macOS identity.

## Context and problem

The project owner explicitly accepted the companion's external integration architecture as the project's bridge in the current conversation on 2026-08-25. The accepted pieces now need one boundary that makes their combined authority—and their missing authority—unambiguous.

ADR-0012 accepts read-only task/project rows. ADR-0013 accepts a minimal, non-authoritative current-session observation after a sanitized Promethee 1.3.29 macOS audit. ADR-0011 accepts constrained OS automation and HUD discovery. None alone is a complete integration.

## Decision

The companion's **external Promethee bridge** is a typed composition of:

1. read-only SQLite `tasks` and `task_projects` snapshots under ADR-0012;
2. read-only minimal `sessions` state/time observations under ADR-0013;
3. a strongly identified Promethee HUD locator and bounded timer-raster layout precondition; and
4. OS-mediated automation for exactly Pause and Resume under ADR-0011, with ADR-0016 selecting the native process/window helper and rendered-glyph one-click path.

Promethee remains session authority. The bridge may report `running`, `paused`, `none`, `stale`, `ambiguous`, `incompatible`, `unavailable`, action `not-sent`, or action `sent-unconfirmed`. It does not manufacture authoritative revisions, event cursors, writers, or command acknowledgements.

Every read includes local observation/freshness time and an exact compatibility profile. Stale, incomplete, invalid, unsupported, or ambiguous state becomes `unknown` and disables dependent behavior. Last-known state never authorizes a command.

Before Pause or Resume, the bridge requires current permission, exact app/process identity, one supported HUD window, one exact visual running/paused layout, and current state for the same observed session. Each attempt queries the allowlisted SQLite observer directly twice and captures/classifies the bounded HUD twice, with the second read/capture immediately before dispatch. Both preflights must agree on the same session and expected state, exact app/PID, unchanged HUD identity/geometry/generation, full layout, and rendered Pause/Play glyph while explicitly rejecting Stop. The native helper revalidates the exact PID/window rectangle, then issues one CoreGraphics click on macOS or, in the unverified Windows source path, one Win32 `SendInput` click. The bridge derives one deterministic target center from the second capture, serializes actions, and dispatches at most once. A timeout or uncertain receipt is indeterminate and is never retried automatically. Later SQLite observation may update current display state, but cannot prove command causation or convert the dispatch into an authoritative acknowledgement.

The bridge exposes no Start, Stop, End, task mutation, arbitrary method, guessed/unbounded coordinate input, global shortcut, database write, arbitrary table/query, private IPC, token, cookie, credential, or remote-session capability. The only coordinate input allowed is the single exact bounded fallback described above. It never ends the active Promethee session.

The bounded HUD raster may be captured only from the already validated timer rectangle, in memory, to classify an exact reviewed control layout before an action. It is never persisted, logged, OCR-processed, or expanded to unrelated screen content.

## Security and permission boundary

- Live allowlisted read-only observation is part of the product launch path. New installations initially default automatic Pause on and automatic Resume off. The macOS first-launch panel first passively preflights screen reading and Input Events. After startup refresh and onboarding presentation, the host may request natively at most once per process when required; **Allow** is the explicit retry, while Check again/Settings review and phase transitions are request-free. Native-helper state supplies Input Events and Screen Recording status; the Read-timer check additionally requires a bounded real `/usr/sbin/screencapture` probe whose image is never retained. Its centered recovery presentation remains available without HUD geometry and becomes attached after mandatory screen reading plus current geometry recover. A newly observed Screen Recording grant schedules one guarded bounded-flush `app.relaunch()`/`app.exit(0)` path; automation and poll scheduling remain unavailable throughout shutdown. After both checks pass the button becomes **Continue**. The panel may open the corresponding System Settings panes without changing their user-controlled toggles. Once screen reading passes, **Not now** may skip Input Events, persists both automation settings off, leaves passive attached features available, and prevents recovery/native-request reopening solely for missing control on later launches; it is refused while screen reading is unavailable. Permission request and automation enablement remain explicit, and the environment kill switch overrides both settings.
- SQLite opens read-only with `query_only`; only the ADR-0012/ADR-0013 table and column allowlists apply.
- Native elements, pixels, database rows, task/project text, session IDs, and timestamps do not enter diagnostics or telemetry.
- Permission revocation, process replacement, file replacement, schema drift, screen/display change, or freshness expiry cancels pending intent and disables/hides dependent local surfaces without mutating Promethee.
- Ordinary validation uses synthetic databases, raster fixtures, and injected executors. It sends no live command and reads no live content.

## Platform boundary

Current runtime evidence is macOS-only and bounded: the product entry point composes the native process/window locator, bounded HUD capture, CoreGraphics input helper, synthetic-tested `node:sqlite` reader, observation-driven runtime, local windows, task/settings IPC, notifications, bounded preference store, and fixture-backed first-launch permission onboarding. Startup first preflights capabilities, then may invoke one native request per process after onboarding presentation if required; **Allow** is the explicit retry. Automatic Pause initially defaults on and automatic Resume defaults off. After verified screen reading is available, **Not now** may skip Input Events, persists both automation settings off, and keeps passive attachment out of permission recovery/request solely for missing control; later enabling either remains explicit, and both can be killed by environment. Missing screen reading keeps attachment unavailable, while missing Input Events with both automations off disables only control. One explicitly authorized Promethee 1.3.29 exercise passed the same-session focus → pause → short break → resume → focus flow with `159 × 32` running and `191 × 32` paused HUDs. Clean-install prompt/denial/revocation/regrant permission proof, a supported-version matrix, database side-effect proof, host-exclusion/precedence proof, and Windows runtime proof do not exist. The Windows native-helper source uses `SendInput`, but source presence is not Windows or release support.

## Consequences

- The companion can be implemented without an upstream Promethee code change.
- The typed adapter remains the domain boundary, but its external profile has observation/indeterminate semantics rather than authoritative bridge acknowledgements/events.
- Private schema and accessibility drift require exact per-version/platform compatibility fixtures and fail-closed maintenance.
- An official Promethee API remains a preferred future migration because it could add authoritative revisions, events, and acknowledgements.

## Implementation order

1. Freeze exact external-profile types, freshness limits, compatibility fixtures, and privacy-safe diagnostics.
2. Complete the host-wired Electron SQLite reader's exact supported-version fixtures, freshness/lifecycle matrix, side-effect proof, and independent platform evidence.
3. Harden app/process identity, permission lifecycle, bounded HUD capture, and the native helper's two-observation/layout/glyph gates.
4. Wire reads/actions through the typed adapter and serialized coordinator without start/stop/end or automatic retry.
5. Extend the bounded macOS 1.3.29 proof and separately authorize a Windows build/runtime exercise.

## Related decisions and evidence

- Composes: [ADR-0011](0011-consider-os-accessibility-as-an-external-promethee-transport.md), as amended by [ADR-0016](0016-use-native-input-helpers-for-the-external-action-bridge.md), with [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md) and [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md).
- Amends: [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) by replacing only its upstream-owned transport requirement for the companion; the typed adapter remains.
- Amends: [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md) with exact external compatibility/freshness profiles and non-authoritative outcomes.
- Preserves: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md).
- Approval evidence: explicit project-owner statement in the current conversation on 2026-08-25.
- Implementation evidence: a composed macOS read-only host, native locator/CoreGraphics action path, injected-executor tests, synthetic-tested SQLite reader, sanitized 1.3.29 SQLite research, and the separately authorized bounded same-session live flow described above. There is no general support matrix, Windows runtime, installation, or release proof.
