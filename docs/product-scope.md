# Product scope

**Status:** Released Electron product definition with a macOS read-only/native-action host, a Linux host that acts only where the session offers a mechanism, and a passive Windows attached host. The public `1.0.1` package passed the three-target package matrix and contains no Linux runtime; one authorized Promethee 1.3.29 macOS same-session Pause/Resume flow has passed. Complete live-platform, permission-lifecycle, and cycle-snapshot proof remain unavailable.

Promethee Pomodoro adds Pomodoro cycles to Promethee without replacing Promethee's session timer. Its distinctive interaction is a thin progress outline that consumes around the real Promethee timer while Promethee remains the only visible play/pause control.

## Target users and outcome

The product is for Promethee users on macOS, Linux, and Windows who want structured focus and break cycles tied to the task and session they already use. The successful outcome is that a user can start, pause, resume, and stop work through Promethee while the Pomodoro cycle stays correct, visible, and recoverable.

## In scope

- A deterministic focus, short-break, long-break, and ready cycle.
- Coordination through ADR-0014/ADR-0016's accepted external bridge: current read-only observations plus rendered-glyph-gated native exact Pause/Resume, never Start/Stop/End, acknowledgement, causation, or automatic retry.
- Promethee task selection for the next focus session through ADR-0012's strict read-only `tasks`/`task_projects` provider.
- ADR-0019 local per-task time tracking while the real Promethee session is observed as running, with task-switch/Stop-tracking closure, retained task/project snapshots, paged individual history deletion, local-calendar aggregates, and explicit freelancer-oriented CSV export.
- A minimal progress outline around Promethee's real timer.
- Focus progress uses the Promethee orange token and break progress uses a neutral gray consuming outline.
- A dynamically measured local Pomodoro menu that stays on-screen, reverses around Promethee-owned Tasks/transient exclusions, and never moves those Promethee surfaces.
- Four menu tabs: Context, Tasks, History, and Settings.
- French UI when the primary OS language is French; English for every other language.
- Local, versioned preferences and conservative local task-time recovery; the separate cycle-snapshot lifecycle remains unwired.
- Native notifications with permission-aware fallback.
- **Skip phase**: focus skip uses the existing bounded Pause authority and earns no completion credit; break skip is local and enters Ready.
- The public unscoped `promethee-pomodoro@1.0.1` npm release with macOS arm64, macOS x64, and passive Windows x64 helper targets, plus an explicit manual release-page update check.
- Linux x64 as a fourth configured target, against a locally built Promethee on a Hyprland, Sway/i3, or X11 session. It attaches and observes everywhere it can discover the HUD, and adds Pause and Resume on a session that offers a mechanism for them: a wlroots compositor or an X server. GNOME and KDE offer neither and report automation as unavailable rather than denied, and i3 is read and not pressed. The target is built and validated but unreleased: `1.0.1` carries no Linux helper.
- A secondary checked-in macOS source installer; it is not the primary V1 channel or proof of support.
- Signed native macOS/Windows packages and authenticated native update metadata only in a later separately approved phase.
- An open-source repository with a reviewed npm installation path and exact release artifact readback.

## Out of scope

- Replacing or visually duplicating Promethee's play/pause control.
- A notch, menu-bar-only, or free-floating standalone timer mode. The centered permission/geometry recovery menu is not a second timer mode.
- Direct writes to Promethee's SQLite database or remote data store, arbitrary SQL/table/content reads, and session fields outside ADR-0013's minimum allowlist.
- Persisting or exporting a Promethee session identifier; task-time records may contain only locally derived reporting timestamps plus bounded task/project snapshots.
- Copying Promethee credentials, tokens, cookies, or embedded keys.
- Calling private Electron IPC from an external process or bypassing origin checks.
- Automatically completing Promethee tasks.
- Invoicing, payroll, cloud time synchronization, permanent archival, or a tamper-evident billing ledger.
- Mobile or web clients in the first cross-platform release.
- Publishing packages, tagging releases, or mutating external services as a side effect of implementation or documentation work.

## Delivery status

The repository contract and only product implementation are Electron/TypeScript/npm. `package-lock.json` pins the approved development dependencies. The final current-source typecheck and local `darwin-arm64` native/application/resource build pass. The abandoned Swift/prototype/design-preview track was retired with owner approval on 2026-08-26.

Four target slices are implemented and pass the final frozen-source local test run:

- the pure Pomodoro core in `src/core`, with 33 passing tests;
- the typed Promethee adapter client and serialized session coordinator in `src/promethee-adapter/v1` and `src/session-coordinator`, with 71 passing controlled-double integration tests;
- the strict version-1 cycle persistence codec, pure recovery policy, and storage port in `src/cycle-persistence`, with 17 passing tests, plus a host-wired Electron store for bounded settings and one selected-task reference; cycle-snapshot storage and coordinator/host lifecycle wiring remain absent;
- the Electron presentation, geometry/planning, native Promethee process/window locator, bounded HUD capture, native input helper, allowlisted read-only SQLite reader, observation-driven runtime controller, serialized task/settings/history IPC, four-tab menu, notifications, bounded preference store, ADR-0019 task-time ledger/CSV export, application icon, and manual GitHub Releases check. The macOS product entry point composes these slices, Linux composes the same set with the action path present only on a session that answers the slot probe, and Windows composes a passive observation/attachment subset with no automation. Linux adds one thing the others do not need: Wayland lets a client ask for a size and never for a position, so the helper asks the compositor to float, pin, and place the companion's own surfaces, and only those it reports as owned by the helper's own parent process. Its geometry scheduler polls at 16 ms during change/recovery and relaxes to 100 ms after 750 ms of stability, applying window plans only after change/recovery. Automated bridge tests use controlled fixtures and injected executors. Active Electron code uses no AppleScript, JXA, or semantic `AXPress`.

The validated local suites cover deterministic domain behavior, fail-closed contract handling, cursor/revision reconciliation for the future official profile, non-authoritative observation handling for the external profile, safe pause coordination against doubles, and local planning. The retained project UI contract lives under `.agents/`. A normal launch can read only the allowlisted live Promethee data, locate the bounded HUD, and drive separate local surfaces on a supported candidate target. On new macOS installations automatic Pause initially defaults on and automatic Resume off. A first-launch panel first preflights Screen Recording and Input Events separately; **Check again** and later Settings reviews use the same passive read. After the launch refresh and onboarding presentation, the app may invoke the native permission request automatically at most once per process if required; macOS may show Accessibility/add the app, while the user controls final System Settings toggles. No phase transition requests permission, and **Allow** remains the explicit retry. Permission onboarding and missing-geometry recovery use a centered current-display menu independent of HUD geometry, then return to attached placement when verified screen reading and current safe geometry are available. The timer-control check derives from native-helper Input Events status. The screen-reading check and HUD attachment require helper-reported Screen Recording plus a bounded probe through the real `/usr/sbin/screencapture`; its image is never retained. A Screen Recording false-to-true transition during a request schedules one guarded relaunch: automation is revoked, native control is aborted, polling cannot reschedule, queued preference/task-time checkpoints receive a bounded wait, and the process finishes through `app.relaunch()` plus `app.exit(0)`. After both checks pass the button is **Continue**. Screen reading is mandatory for HUD attachment. Once it passes, **Not now** may skip Input Events, persist onboarding completion with both automation settings off, expose passive attached behavior, and prevent recovery/request from reopening solely for missing timer control; while screen reading is unavailable, **Not now** is refused. Other stored preferences stay unchanged, and the environment kill switch overrides both. Opening the single-instance app again brings the existing popup forward. Local ad hoc rebuilds may require permission regrant. Windows exposes no Promethee automation and asks for no permission grant. Linux carries Pause and Resume on a session that offers a mechanism for them, and asks for no operating-system grant either, because none of those sessions has one to give: the two settings are the whole of the permission there, so the panel says so and drops the buttons that would open a pane that does not exist. **Reset timer** restarts only the current local Pomodoro phase and never controls or resets Promethee. Ordinary automated validation reads no live Promethee content and sends no live command. A local 2026-08-26 helper check returned `1,1`, and a separate smoke passed second-launch popup recovery and `TERM` quit → manual reopen; the real Screen Recording grant/relaunch transition remains pending user validation after build.

The local reporting tracker opens time only for a selected task while the current Promethee observation is running. Switching tasks or choosing **Stop tracking** closes and checkpoints the old interval; the latter clears selection but keeps history. A retained task/project snapshot keeps history useful when a later task refresh no longer contains it. History loads newest-first in pages of 100 with **Load older**, making every retained entry individually deletable. Today and Monday-based week aggregates use DST-aware local-day boundaries. `task-time-v1.json` retains the newest 10,000 closed entries within an encoded snapshot strictly below 8 MiB, evicting oldest entries deterministically. Corrupt, inaccessible, or future-version files fail closed and are preserved. Local interval timestamps are allowed for reporting. Promethee session identifiers remain ephemeral and never enter storage, renderer history, or CSV. These Electron behaviors are part of the 175 passing controlled tests; clean platform application-data/export proof remains open.

One separately authorized macOS exercise against Promethee 1.3.29 passed focus → pause → short break → resume → focus on the same session and observed `159 × 32` running / `191 × 32` paused HUDs. It does not prove a supported-version matrix, authoritative HUD exclusions, cycle-snapshot persistence, broad platform input/z-order, notification permission/deduplication behavior, Linux or Windows live behavior, signing, or native updates. Clean-install denial/revocation/regrant permission evidence, broader freshness behavior, database side-effect evidence, host exclusion/precedence proof, and Linux and Windows Promethee runtime evidence remain missing. The live Linux evidence is a single Hyprland session, where one authorized Pause and Resume round trip passed; Sway and X11 have answered every helper command against a synthetic client and never against a real Promethee, and i3 is unexercised. The session observer remains non-authoritative.

The exact `promethee-pomodoro@1.0.1` artifact is available from npm, with `latest=1.0.1`; exact release-tarball installation plus Electron/helper smoke passed on macOS arm64, macOS x64, and Windows x64. Electron is locked at the owner-approved `43.2.0`. This package-boundary evidence does not establish a fresh public-registry lifecycle on every target or live Windows Promethee behavior. The secondary macOS installer uses an ad hoc signature whose `cdhash` changes across builds, so it resets only Accessibility and ScreenCapture TCC entries for the current and retired bundle identifiers after installation and requires the user to revalidate/regrant access after every V1 rebuild/install. This is a temporary local workaround, not a stable updater; future Apple Developer ID signed delivery is the durable identity path.

The blocking integration gate is now broader proof of the composed ADR-0014/ADR-0016 path: exact supported-version fixtures/paths, bounded freshness, renderer isolation, database side-effect freedom, clean-platform permission lifecycle behavior, HUD exclusions/precedence, and independent Linux and Windows evidence. The bounded macOS flow does not satisfy the complete bridge, the Linux gate, or the Windows gate.

## Success criteria

- No timer divergence across manual pause, focus completion, break completion, early resume, sleep/wake, restart, or bridge reconnect.
- The progress outline never covers Promethee controls and follows actual HUD size and placement.
- Unsupported Promethee versions fail closed and leave Promethee usable.
- No Promethee secret or direct database mutation is required.
- Per-task history accrues only from observed running state, survives source-task disappearance through a bounded snapshot, can be deleted/exported by the user, and never persists a Promethee session identifier.
- macOS, Linux, and Windows releases pass the same core behavior suite and platform-specific integration checks.

## Source of truth

Architectural rationale lives in the ADR register. The executable repository contract is recorded in `PROJECT.md` and `software-project.json`; source/tests distinguish completed slices from remaining live, platform, storage, and release work. Local OpenSpec planning artifacts are excluded from the public repository and npm package.
