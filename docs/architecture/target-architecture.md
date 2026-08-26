# Target architecture

**Status:** Active architecture. ADR-0014 accepts the external bridge composition, ADR-0016 selects its native input helper, ADR-0017 selects public npm for V1, and ADR-0019 selects the bounded local per-task reporting ledger. macOS composes the read-only observers, attached UI, local reporting, and bounded action path; Windows V1 composes the passive observation/attachment/reporting subset only. New installs initially default automatic Pause on and automatic Resume off. After mandatory screen reading passes the helper Screen Recording plus bounded real-capture checks, **Not now** may skip Input Events and persists both automation settings off; later enabling either remains explicit, other persisted choices stay unchanged, and the kill switch overrides both. One bounded macOS 1.3.29 same-session flow has passed; complete platform, cycle-snapshot, and release proof remain unavailable.

Promethee Pomodoro is designed as a small cross-platform Electron capability whose domain logic does not depend on Electron. The separate companion uses ADR-0014's accepted external bridge; an official Promethee API remains a preferred future migration.

## Layers

| Layer | Owns | Must not own |
| --- | --- | --- |
| `pomodoro-core` | Cycle state machine, deadlines, cadence, commands, domain events, serializable snapshots | Electron APIs, Promethee transport, windows, notifications, persistence I/O |
| `promethee-adapter` | Compatibility negotiation, typed observations/actions, indeterminate outcomes, reconnect and error mapping; authoritative acknowledgements only in a future official profile | Pomodoro policy, direct database access, token discovery, arbitrary IPC |
| `electron-host` | Process lifecycle, secure preload boundary, overlay/menu windows, settings storage, localization, native notifications, packaging and update UI | Independent session truth, duplicated timers, unvalidated bridge payloads |
| `local-reporting` | Selected-task interval tracking, bounded task/project snapshots, deletion, aggregates, and explicit CSV projection | Promethee writes, session authority, Promethee session-ID persistence, cloud sync, invoicing |

The dependency direction is one way: the host and adapter may depend on core contracts; core never imports the adapter or Electron. UI code submits domain commands and renders state. It does not calculate phase transitions.

## Runtime components

- **Cycle engine:** reduces an event plus current state into a new state and emitted effects. Time is supplied through an injectable clock and stored as deadlines.
- **Session coordinator:** translates fresh external observations into cycle events and executes cycle effects through the adapter. It serializes competing user, timer, and reconnect inputs, holds dependent transitions after `sent-unconfirmed`, and never converts matching state into acknowledgement or retry authority.
- **External bridge:** composes typed read-only task/project and minimal session observers with native HUD geometry/layout discovery and exact rendered-glyph-gated Pause/Resume input. Every value carries compatibility/freshness and unknown states fail closed.
- **Task link service:** maps stable Promethee task identifiers to the focus session being prepared.
- **Task-time tracker and store:** derives local intervals only from the selected task plus a current `running` Promethee observation, closes the old interval on task change, Stop tracking, or non-running state, retains a bounded task/project snapshot, and atomically stores `task-time-v1.json`. It keeps Promethee session IDs process-memory-only, preserves corrupt/future ledgers fail-closed, pages history 100 entries at a time, and computes DST-aware local-day/Monday-week aggregates.
- **HUD tracker:** locates the bounded Promethee timer and validates current geometry. The external action profile may use an ephemeral raster of that already validated rectangle only for exact reviewed layout/glyph classification; it never OCRs or broad-captures the screen.
- **Overlay controller:** owns transparent, non-activating windows and hit-test regions around the real Promethee HUD. Geometry polling runs at 16 ms during change/recovery and relaxes to 100 ms after 750 ms of stability; the host reapplies a window plan only on geometry change or recovery. Runtime generation belongs to the host lifecycle and remains separate from HUD generation, so a timer move updates geometry while polling continues. Permission and missing-geometry recovery use a centered menu in the current display without requiring a HUD anchor, then restore attached placement after current safe geometry returns.
- **Settings and snapshot store:** the host serializes preference IPC mutations and wires an Electron store that atomically replaces versioned bounded settings plus one selected-task reference. New-install defaults set automatic Pause on and automatic Resume off without changing stored existing values. The separate version-1 cycle codec/recovery policy exists, but cycle-snapshot lifecycle persistence remains unwired.
- **Notification controller:** requests and observes OS permission and deduplicates phase notifications.
- **Release controller:** performs a user-requested bounded check of the exact repository's latest GitHub Release and may open only its allowlisted release page; it never downloads or installs. The V1 distribution target is one public npm tarball with three prebuilt-helper targets. The secondary local macOS installer resets only Accessibility and ScreenCapture TCC entries for the current/retired bundle identifiers after installing a changing-`cdhash` ad hoc build; it never grants access and requires user revalidation/regrant after every V1 rebuild/install. This is temporary. A later native phase uses Apple Developer ID as the stable application identity and verifies signed update metadata.
- **History/export controller:** exposes sender-validated 100-entry history pages with **Load older**, individual deletion across the retained ledger, Stop tracking through a null task selection, and user-selected CSV export. The four-tab menu renders Context, Tasks, History, and Settings without renderer filesystem authority.

## Process and trust boundaries

### Promethee boundary

Promethee owns session state, task data, and HUD geometry. Each external-bridge provider treats rows, accessibility values, and bounded HUD pixels as untrusted until schema, identity, layout, freshness, and compatibility validation succeeds. Only exact Pause/Resume actions are accepted; no observation is an authoritative command acknowledgement. The integration fails closed when source, application, permission, schema, layout, or freshness is unknown.

### Electron boundary

Renderer processes do not receive Node.js authority. A narrow preload API exposes typed product operations. The main process validates message source, schema, state preconditions, and requested operation. No generic `send(channel, payload)` function is exposed.

### Local storage boundary

Promethee Pomodoro stores its own bounded settings, one explicitly selected normalized task reference, and ADR-0019's local `task-time-v1.json` reporting ledger. The separate cycle snapshot codec exists, but its application lifecycle adapter is not wired. Under ADR-0012/ADR-0013, the main process opens one validated Promethee database read-only and queries only `tasks`, `task_projects`, and the eight minimal session fields. It never persists a bulk Promethee snapshot or session row. The reporting ledger persists only bounded selected task/project snapshots and locally derived interval timestamps; Promethee session identifiers remain ephemeral and are excluded from renderer data and CSV. Every Promethee write, arbitrary table/content read, credential reuse, and renderer database authority remains forbidden. Session observations are non-authoritative and never acknowledge actions.

The ledger retains the newest 10,000 closed entries while keeping its encoded snapshot strictly below 8 MiB. Oldest entries are evicted deterministically. Recovery closes an active interval at its last persisted observation and never extends it across process downtime. Corrupt, inaccessible, and future-version ledgers fail closed and are preserved rather than overwritten. History pages are renderer bounds, not storage bounds; **Load older** traverses the retained entries. Today/week totals use DST-aware local calendar boundaries, while CSV interchange uses UTC timestamps. Exported CSV files are explicit user-managed artifacts outside the ledger's retention and uninstall lifecycle.

### Update boundary

For V1, GitHub Release metadata is untrusted until the exact repository URL, response bound, and stable semantic version validate. The application checks only on user request, reports an available version, and may open the allowlisted release page; it does not download, run npm/the installer, replace files, or relaunch. A later native phase additionally verifies artifact signatures and update metadata. Update checks do not contain Promethee content or identifiers.

## Integration modes

### Embedded or first-party integration — preferred

The Promethee main process hosts the approved bridge and can reuse its existing internal services after applying the same authorization and validation controls as its own windows. Pomodoro UI may ship as a first-party module or a separately packaged component using that bridge.

### Companion application — capability gated

The separate Electron application composes ADR-0014/ADR-0016's accepted external bridge. SQLite supplies read-only task/project and minimal session observations. The native helper supplies process/window discovery and revalidation, while bounded in-memory HUD capture on macOS supplies the rendered Pause/Play glyph and complete layout used to derive one exact target. Each eligible macOS action reads SQLite directly for two fresh matching session observations and performs two bounded HUD captures/classifications, with the second read/capture immediately before dispatch. The helper may issue one CoreGraphics click only while application/PID identity, HUD identity/geometry/generation, full-layout classification, and rendered glyph remain equal. Permission state is passively preflighted first. After the startup refresh and visible onboarding, the host may invoke the native request automatically at most once per process if required; macOS may show Accessibility/register the app, while final toggles remain user-controlled. **Check again** and Settings review are preflight-only, **Allow** is the explicit retry, and phase transitions never request permission. The Control-timer check uses helper-reported Input Events. The Read-timer check and HUD attachment require helper-reported Screen Recording plus a bounded readiness probe through the real `/usr/sbin/screencapture`; no probe image is retained. Permission onboarding and missing-geometry recovery open a centered current-display menu without a HUD anchor, a second launch brings that single popup forward, and verified screen reading plus fresh valid geometry restore attached placement. A Screen Recording false-to-true request transition schedules one guarded relaunch: automation authority is revoked, native control is aborted, runtime pollers cannot reschedule, queued preference/task-time checkpoints receive a 750 ms maximum wait, and the host calls `app.relaunch()` before `app.exit(0)`. Ordinary quit uses the same bounded flush and exit path without relaunch. New installations initially default automatic Pause on and automatic Resume off. Screen reading is mandatory for attachment; once it passes, the first-launch **Not now** path may skip Input Events, persists both automation settings off, enters passive attached use, and prevents recovery/request from reopening solely for missing timer control. While screen reading is unavailable, **Not now** is refused. Later enabling either automation setting remains explicit. Other persisted choices remain unchanged and an environment kill switch forces automation off. The bridge provides no authoritative event cursor/acknowledgement and no Start/Stop/End. Local ad hoc rebuilds may require regrant. Windows V1 is passive and exposes no automation. Provider compatibility, user permission, host exclusion, and platform precedence remain separate open safety gates. A local 2026-08-26 helper check returned `1,1`; a separate smoke passed second-launch popup recovery and `TERM` quit followed by manual reopen. The actual Screen Recording grant/relaunch path still requires user validation after build.

## Key invariants

- Promethee is the source of truth for session running, paused, and stopped state.
- Only one Pomodoro cycle engine is active per coordinated session.
- Focus and break progress both decrease from full to empty against a deadline.
- A break never silently resumes Promethee; user play or an explicit approved policy starts a new full focus period.
- **Reset timer** restarts only the current local phase at its configured duration and never controls or resets Promethee.
- **Skip phase** uses the existing Pause effect and safety gates for a focus, but skipping a break is local and enters Ready; neither creates a new Promethee operation.
- Overlay failure never blocks or intercepts Promethee controls.
- Local task time accrues only while a selected task and a fresh running Promethee observation agree; a task change closes the previous interval before starting another.
- No durable record or CSV contains a Promethee session identifier.
- Break progress uses the neutral gray phase token; focus retains the orange progress token.
- Unsupported compatibility leaves the Pomodoro integration disabled, with a diagnostic the user can act on.

## Resolved foundation choices

- Electron `43.4.1`, TypeScript `7.0.2`, and npm with `package-lock.json` form the active local foundation.
- The first UI slice uses framework-free HTML/CSS/TypeScript and the approved compiled design system.
- V1 targets the public unscoped `promethee-pomodoro@1.0.0` npm package with `darwin-arm64`, `darwin-x64`, and passive `win32-x64` helper artifacts. Publication to stable `latest` remains gated by explicit approval and readback; project-signed native releases remain future work.

## Unresolved implementation choices

- Exact integration packaging: inside the Promethee repository or as a separately distributed companion.
- Future official API transport/authentication if adopted after the accepted external profile.
- External-bridge freshness limits, clean-platform permission lifecycle proof across first launch, denial, revocation, regrant, and application-identity changes, exact compatibility profiles, and supported fallback policy on each platform.
- Exact supported-version `tasks`/`task_projects` schemas and independent path, file-identity, WAL, side-effect, and runtime proof for ADR-0012 on each platform.
- Whether future Promethee-integrated renderer code should adopt an upstream framework after authorized repository inspection.
- Immutable public source, matching authorized V1 tag, reviewed tarball, npm Trusted Publisher/environment ownership, protected approval, workflow execution, registry/GitHub readback, and clean three-target package smoke.
- Independent Windows passive-runtime evidence and signed-native package ownership.
- Native signing identities, notarization credentials, package formats, and updater for the deferred native phase.

These choices must be recorded through an ADR or amendment before implementation depends on them.

## Current implementation boundary

The repository currently provides implementation evidence for only these architecture slices:

- `src/core` implements the pure deadline-based cycle engine and passes 33 tests;
- `src/promethee-adapter/v1` implements a typed, fail-closed client over an injected raw port, and `src/session-coordinator` implements serialized coordination against controlled doubles; their integration suite passes 71 tests;
- `src/cycle-persistence` implements an exact version-1 envelope/config/engine/recovery codec, pure recovery policy, and storage port without platform I/O or coordinator/host wiring; its suite passes 17 tests;
- `src/electron` implements sandboxed local surfaces, pure fail-closed HUD planning, native Promethee process/window discovery, bounded macOS HUD capture, the rendered-glyph control helper, a read-only `node:sqlite` reader, an observation-driven runtime controller, task/settings/history IPC, a four-tab menu, native notifications, an atomic bounded preference store, ADR-0019's bounded task-time store/tracker and CSV export, and packaged SVG/ICNS icons. `native/macos` provides the CoreGraphics helper and `native/windows` provides passive process/window discovery for V1. Active Electron uses no AppleScript, JXA, or semantic `AXPress`. The product entry point composes the passive runtime on macOS and Windows, with actions available only on macOS. Its geometry scheduler samples at 16 ms during change/recovery and relaxes to 100 ms after 750 ms of stability; it applies a window plan only when geometry changes or recovers. Preference/IPC mutations are serialized; action reconciliation requires the exact HUD generation. New installs initially default Pause automation on and Resume automation off; after verified screen reading is available, **Not now** may skip Input Events and persists both automation settings off without later control-permission recovery/request, while unavailable screen reading keeps setup open. Later enabling either remains explicit, other stored values remain unchanged, and the environment kill switch disables both. All automated Promethee database/control tests use synthetic fixtures or injected executors.

The current local Electron suite passes 132/132 tests. Typecheck and the full local build also pass against the Electron `43.4.1` lock, including the `darwin-arm64` native helper and application/resource copy. The release verifier cannot complete without the `darwin-x64` and `win32-x64` helpers, so no cross-platform package, Windows runtime, signing/notarization, installation, or publication claim follows.

No repository code is a Promethee-owned bridge. The future-official injected raw port remains a testable contract boundary rather than evidence of a secure upstream transport. The accepted external profile is composed in the product entry point: a normal launch may read only the allowlisted live task/project and minimal session fields, discover the bounded HUD, and render local surfaces. The authorized 2026-08-25 Promethee 1.3.29 macOS exercise passed one same-session focus → pause → short break → resume → focus flow and observed `159 × 32` running / `191 × 32` paused HUDs. This is not a supported-version matrix, database-side-effect, host-precedence, Windows, installation, or release proof. Automated validation uses synthetic databases, raster fixtures, and injected executors; it reads no live content and sends no live Promethee command. Cycle-snapshot persistence/lifecycle recovery remains unwired. Electron is the only retained product implementation.
