# Changelog

All notable changes to Promethee Pomodoro are recorded here. A version remains **Unreleased** until its exact npm package and source revision are publicly available and verified.

## [1.0.1] - 2026-08-26 (unpublished candidate)

Initial public-release candidate, carrying the complete 1.0.0 product feature set plus release-gate corrections discovered by the first immutable workflow run.

### Fixed

- The npm macOS launcher now honors the isolated application directory used by clean-install verification.
- Cross-platform Electron readiness smoke tests now use a bounded result file instead of depending on Windows GUI-process stdout capture.
- The release dependency lock is restored to the explicitly authorized Electron `43.2.0`.
- Release validation now covers 254 tests: 33 core, 71 integration, 17 persistence, and 133 Electron.

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
