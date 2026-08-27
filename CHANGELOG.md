# Changelog

All notable changes to Promethee Pomodoro are recorded here. A version remains **Unreleased** until its exact npm package and source revision are publicly available and verified.

## [Unreleased]

### Added

- Linux x64 attached runtime for HUD location, allowlisted task/session observation, and manual Pomodoro transitions.
- Pause and Resume on Linux, on a session that offers a mechanism for them. Capture and injection are each a three-slot probe: a sanctioned or wlroots Wayland protocol, then the XDG portal, then X11, with no fall-through, and the slot follows whichever window server already answered the window query. Slots 1 and 3 are built; the portal slot is declared and not built, so GNOME and KDE answer `automation-unsupported`, a third receipt that the app reads as unavailable rather than denied, since those sessions have nothing to turn on. i3 is read and never pressed. The press repeats the macOS preflight, returns `sent-unconfirmed`, and never retries.
- Bounded HUD capture on Linux that asks for Promethee's own window rather than for a rectangle of the screen, because the HUD is translucent and a screen rectangle carries whatever is behind it. On Wayland that is one toplevel's own surface; on X11 it is that window's own off-screen pixmap, never the root. A capture that cannot be trusted writes no file.
- A consent gate for the sessions where the system prompts for nothing. The two settings are the whole of the permission there, so the panel says so, drops the buttons that would open an operating-system pane that does not exist, reports an absent slot as a protocol the session does not offer, and states before the fact that the pointer is left on the control it pressed.
- A native Linux helper that resolves Promethee's windows through the session's own window server, because a Wayland client cannot enumerate another client's windows. It tries Hyprland, then Sway/i3, then X11, and refuses to fall through to a backend answering for another display.
- Compositor-assisted placement of the companion's own surfaces on Wayland, where a client can ask for a size and never for a position. The helper floats, pins, and places the outline, the handle, and the menu, keeps the outline out of the running for the pointer where the compositor supports it, and names a window only when the compositor reports the helper's own parent process as its owner. Promethee's windows stay read-only. No compositor configuration is required.
- A page on those sessions stays blank until its window has been placed, because one that draws straight away draws where the compositor dropped it and then jumps. Only the windows of a session that waits are marked, so the pages themselves carry nothing about placement and every platform where a window places itself is untouched.
- An outline that cannot be taken out of the running for the pointer is not placed at all. On Sway and i3 it would sit on the real pill and take Promethee's own drag and Play/Pause with it, which is worse than no outline, so the helper places nothing there and the app takes the outline down for the session.
- `linux-x64` added to the CI matrix, which builds the helper and runs its `self-test` on every push. The release build, tarball, and smoke matrices deliberately stay macOS and Windows only, so no published package carries a Linux helper and Linux runs from a source checkout.

### Fixed

- The Pause glyph test no longer refuses a control that sits on a half pixel. The offset counted back from the HUD's right edge is a pixel short at a width of 145, which the ring test tolerates and the gap bucket does not, so one bar fell into the gap and a running HUD read as unsupported. A glyph the existing test refuses is now asked for a second time against the bars' own midpoint, which only widens what counts as a Pause. The control does not move with it: the target stays the offset, which is the value the native helpers recompute and the only one they accept.
- The Play glyph test no longer refuses a triangle narrower than the one it was written for. Its buckets are pinned two columns from the disc centre, which separates the flat edge from the point on a ten column wide triangle and cuts straight through a six column wide one, so a correct triangle scored 6 against 6 where the test wants 1.4 to 1 and a paused HUD read as unsupported. A glyph the existing test refuses is now asked for a second time against its own bounding box, which only widens what counts as a Play.

### Not yet released

- No published package contains a Linux runtime, and none is planned for this change: `linux-x64` is a CI target only, so there is no release-tarball installation or smoke run for it.
- Live evidence covers one Hyprland session, where the companion attached to and followed a real running Promethee HUD and one authorized Pause and Resume round trip passed. Sway and X11 have answered every helper command against a synthetic client and never against a real Promethee, i3 is unexercised, and every session except that one Hyprland login was nested, which measures what a compositor offers a client rather than what a full desktop does.
- GNOME and KDE have no capture or injection slot, because the portal slot both would need is out of scope for this change rather than pending.
- Promethee publishes no Linux build, so the Promethee every Linux measurement was taken against is its own Windows release, `app.asar` extracted from the release channel's package and run on a Linux Electron 43.2.0 with no compatibility layer anywhere and no Windows binary left in it. The HUD read by the classifier is upstream's renderer unmodified, but an official Promethee Linux build is not what any of this was measured on.
- The outline's pointer passthrough on Hyprland is proven for a click and not for a drag. The drag was attempted and moved the HUD neither through the outline nor with the outline gone, which does not distinguish an outline that blocks the gesture from a HUD that does not answer it.

## [1.0.1] - 2026-08-26

Initial public release, carrying the complete 1.0.0 product feature set plus release-gate corrections discovered by the first immutable workflow run.

### Fixed

- The npm macOS launcher now honors the isolated application directory used by clean-install verification.
- Cross-platform Electron readiness smoke tests now use a bounded result file instead of depending on Windows GUI-process stdout capture.
- The release dependency lock is restored to the explicitly authorized Electron `43.2.0`.
- Release validation now covers 254 tests: 33 core, 71 integration, 17 persistence, and 133 Electron.

### Release evidence

- Published as `promethee-pomodoro@1.0.1` with npm `latest` pointing to `1.0.1`.
- GitHub Release `v1.0.1` contains the exact workflow tarball and `SHA256SUMS`.
- Clean installed-package Electron/helper smoke passed on macOS arm64, macOS x64, and Windows x64.

## [1.0.0] - 2026-08-26 (unpublished candidate)

### Added

- Electron and TypeScript Pomodoro companion attached to Promethee's real compact timer.
- Consuming focus and break outline, local side handle, and measured menu placement that reverses or hides around unsafe screen regions.
- Promethee-orange focus progress and a neutral gray consuming break outline.
- Configurable focus, short-break, long-break, and cadence settings with French/English interface selection from the operating-system language.
- Strict read-only Promethee task/project and minimal current-session observations from the local SQLite database.
- Bounded macOS automatic Pause and Resume using the native input bridge. New installations initially default Pause on and Resume off; after verified screen reading is available, choosing **Not now** may skip Input Events and persists both off without reopening recovery solely for missing control. Later enabling either remains explicit, other existing preferences stay unchanged, the kill switch overrides both, and actions never retry automatically.
- Passive Windows x64 attached runtime for HUD location, allowlisted task/session observation, and manual Pomodoro transitions; Promethee automation is unavailable and fails closed.
- **Reset timer** restarts only the current local Pomodoro phase and never controls or resets Promethee.
- **Skip phase** reuses the existing bounded Pause authority for focus; break skip is local and enters Ready.
- Four-tab attached menu with Context, Tasks, History, and Settings views.
- First-launch macOS permission onboarding with prompt-free initial refresh and **Check again**, followed—only after onboarding is visible—by at most one automatic native permission request per process when required. That request may surface the Accessibility prompt/register the app, while final System Settings toggles remain user-controlled; no phase transition requests permission. **Allow** remains the explicit retry action and **Continue** appears after both checks pass. Screen reading is required for HUD attachment, so **Not now** is refused until the helper reports Screen Recording and a bounded `/usr/sbin/screencapture` probe succeeds; Input Events may then remain absent while both automation settings are persisted off without reopening or re-requesting control permission on later launches. The probe image is never retained. Settings can later reopen and passively recheck permissions; enabling automation remains explicit.
- Native-helper Input Events status supplies the timer-control check. The screen-reading check and attachment authority additionally require the bounded real-capture probe. A newly observed Screen Recording grant schedules one application relaunch so macOS can activate capture for the running app actor.
- HUD-independent centered permission/geometry recovery presentation. A second application launch brings the existing popup forward; safe geometry recovery returns it to the attached placement.
- A bounded quit/relaunch path that revokes native automation authority, aborts in-flight control, prevents poll rescheduling during shutdown, waits at most 750 ms for preference and local-history checkpoints, and finishes through `app.exit(0)`.
- Local per-task running-time ledger in `task-time-v1.json`: switching tasks or **Stop tracking** closes the prior interval, Stop tracking clears selection while preserving history, retained task/project snapshots survive source-task disappearance, and recovery never invents downtime.
- Newest-first 100-entry History pages with **Load older**, individual deletion across the retained ledger, and DST-aware local-day/Monday-week aggregates.
- Corrupt, inaccessible, and future-version task-time files fail closed and remain preserved instead of being overwritten.
- Freelancer-oriented CSV export with UTF-8 BOM, RFC 4180/CRLF escaping, spreadsheet formula protection, UTC interval timestamps, and no Promethee session identifier.
- Deterministic local retention of the newest 10,000 closed entries within a snapshot strictly below 8 MiB.
- Adaptive HUD geometry polling: 16 ms while geometry is changing or recovering, then 100 ms after 750 ms of stability, with window plans applied only on change/recovery.
- Local task selection, native phase notifications, bounded preference storage, packaged SVG/ICNS application icons, a secondary local macOS Electron application installer, and a manual non-installing update check.
- The secondary macOS installer applies an ad hoc signature, then resets only Accessibility and ScreenCapture TCC entries for the current and retired bundle identifiers so the user can revalidate and regrant them after every V1 rebuild/install. It does not grant access. This changing-`cdhash` workaround is temporary; stable updates require a future Apple Developer ID identity.
- Public npm V1 candidate contract for the unscoped `promethee-pomodoro` package.

### Security and privacy

- Promethee database access is fixed-query and read-only; no credentials, tokens, cookies, private IPC, arbitrary table reads, or database writes are permitted.
- The reporting ledger contains only selected task/project snapshots and locally derived interval timestamps. Observed Promethee session identifiers remain process-memory-only and are neither persisted nor exported.
- Native input is limited to exact Pause and Resume after two fresh session observations and two matching bounded HUD captures.
- Renderer processes remain sandboxed and receive only narrow typed preload operations.
- No telemetry is included.

### Known limitations

- The project has no Apple Developer ID/notarization or Windows Authenticode certificate and provides no native installer.
- The bounded Promethee 1.3.29 macOS focus/pause/break/resume flow has live evidence; Windows package installation and runtime remain unverified until the clean candidate matrix passes.
- Promethee schema/layout compatibility outside the recorded evidence is fail-closed rather than guaranteed.
- Cycle-snapshot lifecycle persistence and authoritative Promethee command acknowledgement are not available.
- Local task-time history is bounded rather than archival, and exported CSV files are user-managed reporting artifacts rather than invoices or tamper-evident records.
- This unpublished candidate pinned Electron `43.4.1`; `1.0.1` restores the authorized `43.2.0` lock.
- The current-app Screen Recording grant and automatic relaunch still require a user-run macOS validation.

### Verification evidence

- `bash -n install-electron.sh`: passed.
- `package.json` and `software-project.json`: parsed successfully.
- `npm run target:typecheck`: passed.
- `npm test`: 253/253 passed (33 core + 71 integration + 17 persistence + 132 Electron).
- `npm run target:build`: passed for the local `darwin-arm64` native helper plus application/resource build.
- `npm run target:verify-release`: unavailable/failing locally because the `darwin-x64` and `win32-x64` helpers are absent. No publication, signing/notarization, clean install, or Windows runtime is proven.
- Local lifecycle smoke: a second launch reopened the existing popup, and `TERM` quit followed by manual reopen passed. This is not Screen Recording grant/relaunch proof.
