# Validation strategy

**Status:** Active Electron/TypeScript/npm contract with mock-backed domain/integration evidence, a composed macOS native external bridge, a passive Windows release, fixture-backed Electron evidence, one separately authorized bounded live macOS 1.3.29 flow, and a verified public `1.0.1` package matrix.

Validation is reported as four distinct categories: passed, failed, skipped, and unavailable. Generated files, source inspection, controlled doubles, synthetic UI, screenshots, CI configuration, installed dependencies, and published artifacts are different evidence and must not be conflated.

## Active repository validation

`software-project.json` declares these active local commands:

| ID | Command | Scope and side effects |
| --- | --- | --- |
| `typecheck` | `npm run target:typecheck` | Runs the configured TypeScript project build/type-check graph; reads installed development dependencies and may refresh generated `dist/` JavaScript, declarations, source maps, and build metadata. |
| `test-core` | `npm run target:test:core` | Runs pure domain tests through Node.js built-in test execution and experimental TypeScript stripping. |
| `test-integration` | `npm run target:test:integration` | Runs typed adapter/coordinator tests against injected controlled doubles; contacts no Promethee process. |
| `test-persistence` | `npm run target:test:persistence` | Runs exact codec and pure recovery tests; performs no platform storage I/O. |
| `test-electron-synthetic` | `npm run target:test:electron` | Exercises presentation, planning, locator/runtime, injected control, and synthetic SQLite-reader behavior without creating an Electron window or touching live Promethee content/session controls. |
| `build` | `npm run target:build` | Compiles TypeScript and copies reviewed renderer resources into generated `dist/` output. |
| `verify-release-package` | `npm run target:verify-release` | Reads the three built native targets and production allowlist, then performs a bounded `npm pack --dry-run --json --ignore-scripts`. It does not publish. |

Inspect the manifest and executable before running a declared command. `npm run target:start` first performs the build and then launches the live attached integration; it is an interactive product exercise, not a validation command. It may open the allowlisted Promethee database read-only, invoke the native process/window helper, run the bounded non-retained `/usr/sbin/screencapture` readiness probe, capture only the bounded HUD on macOS, present first-launch Input Events and Screen Recording onboarding, create local windows, and—after startup preflight plus onboarding presentation—invoke the native permission request at most once per process if required. macOS may show Accessibility/register the app; the user still controls final System Settings toggles. **Allow** is the explicit retry, while **Check again**, Settings review, and every phase transition remain request-free. Helper-reported Input Events supplies the control check; helper-reported Screen Recording plus the real capture probe supplies the reading check and attachment authority. The permission/missing-geometry recovery menu is centered in the current display without a HUD anchor and returns to attached placement after mandatory screen reading plus current safe geometry recover. Once screen reading passes, **Not now** may skip Input Events, persist both automation settings off for passive use, and suppress recovery/request solely for missing control on later launches; unavailable screen reading keeps setup open. A Screen Recording false-to-true request transition schedules one guarded relaunch: the host revokes automation, aborts native control, prevents poll rescheduling, waits at most 750 ms for queued preference/task-time checkpoints, invokes `app.relaunch()`, and exits through `app.exit(0)`. Ordinary quit uses the same bounded checkpoint-and-exit path without relaunch. A second launch brings the existing popup forward. Other existing values stay unchanged, Windows automation is unavailable, and the environment kill switch forces automation off. Dependency installation, publication, any further live-action proof, and live-content inspection remain separately authorized actions.

## Current verified evidence

Final frozen-source local evidence recorded on 2026-08-26 with the installed locked toolchain:

| Result | Command or check | Evidence boundary |
| --- | --- | --- |
| Passed | `bash -n install-electron.sh` | Shell syntax only; no installation or mutation. |
| Passed | JSON parse | `package.json` and `software-project.json` parse successfully. |
| Passed | `npm run target:test:core` | 33/33 core tests; pure deterministic domain behavior. |
| Passed | `npm run target:test:integration` | 71/71 adapter/coordinator tests against controlled doubles; no live Promethee process. |
| Passed | `npm run target:test:persistence` | 17/17 strict version-1 codec and pure recovery tests; no live platform store. |
| Passed | `npm run target:test:electron` | 171/171 fixture-backed Electron tests covering HUD/window planning, adaptive geometry cadence, locator/runtime/localization, injected control, synthetic SQLite readers, observation-driven runtime, preference store, task-time tracker/store/history/CSV, platform defaults, Linux compositor placement against an injected executor, the consent copy against the consent model rather than the platform name, the published module graph against the entry point's own imports, CLI/package boundary, and reconciliation. No live command or live database content read ran. |
| Passed | `npm test` | 292/292 total: 33 core + 71 integration + 17 persistence + 171 Electron. |
| Passed | `npm run target:typecheck` | Current TypeScript projects type-check with the pinned installed dependencies. |
| Passed | `npm run target:build` | Builds the local `darwin-arm64` native helper plus application JavaScript and reviewed resources. This is not cross-platform packaging or installation. |
| Unavailable / expected local failure | `npm run target:verify-release` | The verifier cannot complete in this single-host tree because the helpers for the targets other than the build host are absent. This is not publication, signing, notarization, Windows execution, or cross-platform support proof. |
| Retained contract | Project UI skill | The approved design-system guidance remains compiled under `.agents/`; obsolete local preview/build-gate artifacts were intentionally retired and are not runtime proof. |
| Partial + live evidence | External bridge on macOS Promethee 1.3.29 | Architecture/source composition and fixture-backed first-launch permission onboarding exist. A separately authorized 2026-08-25 exercise passed one same-session focus → pause → short break → resume → focus flow; running HUD `159 × 32`, paused HUD `191 × 32`. It does not prove acknowledgement/causation, a clean-install denial/revocation/regrant permission lifecycle, a supported-version/database-side-effect matrix, exclusions/z-order, or Windows. |
| Partial + local lifecycle evidence | Single-instance and shutdown recovery | On 2026-08-26, a second launch reopened the existing popup and a `TERM` quit followed by manual reopen passed. The real Screen Recording grant and automatic relaunch remain pending user validation. |
| Partial + live evidence | Native Linux helper | The helper built warning-free under `-Wall -Wextra -Werror` on Arch Linux x64, reported `ready,1,pause-resume`, and located a real running Promethee. On one live Hyprland session the companion attached to and followed the real HUD with no compositor configuration. X11 and Sway have both run every command against a synthetic client and never against a real Promethee, no session with a real compositing manager has exercised the X11 capture path, i3 is unexercised, and `linux-x64` is a CI target only, so no release-tarball installation or smoke run exists for it by design. |
| Partial + live evidence, one authorized round trip | Linux injection slot | On the same Hyprland session, the shipped `click` refused all nine of its preflight mismatches with the receipts macOS answers with, and `SWAYSOCK` turned it into `permission-denied` and the probe into `automation-unsupported`. A scratch build of the same source with the two `zwlr_virtual_pointer_v1` button calls suppressed computed the Pause target as 1297,382 from a live 159 × 32 HUD, re-verified the process and rectangle, and moved the seat pointer there exactly. On 2026-08-27, with the session owner authorizing each direction separately, the shipped helper then sent the press for real: `clicked-unconfirmed,pause,0` and the HUD became 191 × 32 at 1173,366, then `clicked-unconfirmed,resume,0` and it returned to 159 × 32 at 1189,366. Both targets came from the classifier and the planner reading the captured raster and were recomputed by the helper from the geometry before it acted. The receipt stays `sent-unconfirmed` in both directions: the geometry change is this project's observation, not an acknowledgement from Promethee. One session, one Promethee build, one compositor. The in-app consent gate now exists and carries copy written for a session that grants nothing: the settings buttons that would open a pane it does not have are gone, an unavailable slot reads as a protocol the session does not offer, and the pointer being left on the control it pressed is stated before the fact rather than discovered afterwards. That copy has been read in tests only, never on screen. |
| Partial + live evidence, both states | Linux capture slot | On the same Hyprland session, `ext-image-copy-capture-v1` sourced from an `ext-foreign-toplevel-list-v1` handle returned the running HUD's own surface, `captured,159,32,0` and 20352 bytes, which the unmodified classifier read as `running` with controls at x 94 and x 126, the same two the injection path computed independently. The corner pixel came back fully transparent and both control rings read a range of `0.0000` with Promethee's main window behind the HUD, so nothing of the desktop is in the buffer. Nine refusal paths were driven live and none wrote a file, a session with no Wayland display answered `capture-unsupported`, and a session with `SWAYSOCK` set still captured while still refusing automation. The Electron module was exercised end to end on the live HUD. The paused state followed on 2026-08-27, once an authorized Pause produced one: the slot captured the 191 × 32 paused surface and the same unmodified classifier read it as `paused` with its three controls. Both states are now evidence from this slot rather than from a screen region. |
| Measured absent | Automation on KWin 6.6.5 | A nested `kwin_wayland` on its own socket advertises 64 globals to a plain client and none of them are `ext_image_copy_capture_manager_v1`, `ext_foreign_toplevel_list_v1` or `zwlr_virtual_pointer_v1`; it does advertise `wp_security_context_manager_v1`, `ext_data_control_manager_v1`, `zwlr_layer_shell_v1` and `wp_pointer_warp_v1`, so the list is complete rather than stripped. The shipped helper answers `ready,1,pause-resume` for `self-test`, which is about the build, and `automation-unsupported` for `permission-status`, which is about the session and is the correct fail-closed answer when both slots are absent. `windows` answers `process-not-found` there, which also shows the live Promethee is a native Wayland client, since the X11 backend that fielded the call saw nothing. This is a nested compositor, not a Plasma login, so it says what KWin offers a client and not what a full desktop with a running portal would. KDE therefore needs capture slot 2, which ADR-0021 leaves out of scope for this change by decision rather than by a technical finding. |
| Partial + exercised on a synthetic target | Sway 1.12 | A nested Sway advertises every protocol both halves bind, and all four helper commands now answer there. `windows` returned the geometry of a window that was really there, checked against a bogus socket that answered `window-list-incomplete` instead. `permission-status` returned `permissions,1,1`. `capture` returned `captured,159,32,0`, and the raster was checked against a fill this project computes rather than against another capture, with no pixel off by more than one and every alpha byte at 255. A Pause press returned `clicked-unconfirmed,pause,0` and the target reported the left button arriving on its own surface at `108,16`, the planned point minus the window origin; Resume landed at `76,16`; a rectangle moved one pixel was refused with `timer-not-found` and sent nothing. Getting there needed a real fix: that session lists exactly one shm format for a toplevel, `BG24`, and the helper asked for ARGB8888 by name. The format turned out to come from the renderer rather than the compositor, the same Sway offering XRGB8888 under pixman, so the demand was a reach limit and not a safeguard. Capture now takes ARGB8888, XRGB8888 and BGR888. The target was a synthetic client, so nothing here says the classifier can read a Sway-rendered Promethee HUD. |
| Measured absent | Automation on Mutter 50.4 | A headless Mutter with one virtual monitor advertises none of the four protocols. It offers no window-listing protocol at all, so the ADR-0020 discovery has nothing to bind either and `windows` answers `window-list-incomplete`. GNOME therefore gets neither automation nor the attached surface, which is wider than the injection tables alone suggest. The portal slot that could answer for it is out of scope for this change by decision. |
| Partial + falsified, exercised on a synthetic target | X11 slot 3 | Against a nested Xorg 21.1.24, a client carrying the matching class was read as `0,0,159,32`, close enough to a HUD to be worth doubting, so it was restarted at 300x100 and the helper answered `0,0,300,100`. It reads the server rather than repeating a constant. Removing the client returns `process-not-found`. Both halves of slot 3 are now built and all four commands answer there. `permission-status` returned `permissions,1,1`, where it used to say `automation-unsupported`. `capture` returned `captured,159,32,0` through the window's own Composite pixmap, and the raster was checked against a fill this project computes, with no pixel off by more than one and every alpha byte at 255, on both paths: once with a stand-in that redirects every top-level window as a compositing manager does, and once on a bare server where the helper redirected the window itself. The falsification is the strong one: an opaque magenta window raised over the HUD made a root grab of that rectangle return 5088 magenta pixels and nothing else, while the helper's capture at the same moment stayed byte-identical to the uncovered one, so the two reads are demonstrably not the same read. A rectangle one pixel stale answered `timer-not-found` and wrote no file; a target past the screen edge answered `target-mismatch`. Pause and Resume presses through XTest returned `clicked-unconfirmed` and the target reported the left button arriving on its own surface at `108,16` and `76,16`, the planned points minus the window origin. Everything here is a synthetic client on a nested server with no real compositing manager, so nothing says the classifier can read an X11-rendered Promethee HUD. |
| Partial + live permission-status evidence | Native macOS helper | The real helper reported Input Events and Screen Recording as granted (`1,1`). This does not exercise the Screen Recording false→true transition or prove automatic relaunch; that check remains pending after build. |
| Source-inspected, live regrant pending | Local macOS TCC reset | `install-electron.sh` resets only Accessibility and ScreenCapture for the current and retired bundle identifiers after the ad hoc-signed app is installed. It does not grant access; post-build user revalidation/regrant and the Screen Recording relaunch remain unverified. |
| Unavailable | Supported HUD/multi-window proof | The macOS host can read bounded window rectangles and create separate local surfaces, but has no authoritative exclusion stream, host-precedence proof, Windows equivalent, or support claim. |
| Partial | ADR-0012 Electron task source | A host-wired built-in `node:sqlite` reader uses fixed task/project statements, strict bounds, and synthetic fixtures, and supplies the local picker. Exact supported-version schemas, complete renderer-isolation/database-side-effect proof, live task/project compatibility, and Windows runtime proof remain unavailable. |
| Partial + research evidence | Promethee 1.3.29 session schema/state | A sanitized macOS read found WAL/session-schema/time-formula evidence. The host-wired reader implements the eight-field query and conservative derivation and supplies the external runtime controller. The bounded live flow observed state changes but did not create authoritative revision/acknowledgement or causation; exact synthetic 1.3.29 fixture and Windows proof remain unavailable. |
| Unavailable | Complete macOS/Windows live support proof | The public package matrix proves clean installation plus Electron/helper readiness on both operating-system families, but no real Windows Promethee integration matrix or broad macOS permission/display matrix has run. |
| Passed at package boundary | V1 package/release implementation | Release run `32966038040` validated source, built all three helpers, smoke-tested the same installed tarball on macOS arm64, macOS x64, and Windows x64, verified npm integrity plus `latest=1.0.1`, and published the matching GitHub Release assets. There is no project signature, notarization, native installer, or live Windows Promethee proof. |
| Unavailable | `RTK.md` instructions | `AGENTS.md` references this file, but it is absent from the repository. |

The Node.js type-stripping test commands print an experimental-feature warning. Their passing results are local evidence, not a long-term test-runner compatibility commitment.

## Electron test boundary

The passing fixture suite's evidence remains limited to these controlled boundaries:

- the secure host disables renderer Node integration, enables context isolation and sandboxing, and denies navigation/window/webview escape paths;
- the renderer exposes no raw IPC API and performs no network request;
- English/French copy follows the primary OS language rule in renderer logic;
- fresh synthetic geometry can show the passive outline and local SVG handle;
- the pure planner derives exact running/paused outlines, safe left/right handle placement, measured above/below menu placement, display clamping, and deterministic queue/hide behavior from validated fixture input;
- disconnected or host-preempted state hides the outline, handle, and menu; and
- reconnect restores eligibility without reopening the menu.
- the macOS locator strictly parses bounded window rectangles and fails closed on no/ambiguous/invalid timer candidates;
- the macOS host can create a click-through outline plus local handle/menu windows from bounded read-only geometry; and
- the experimental control tests inject HUD raster capture, SQLite session observations, and command execution, so no live Promethee action or database content read occurs; and
- the SQLite-reader tests use disposable synthetic databases and fixed allowlisted statements, without live content or renderer database authority;
- the external runtime-controller tests consume injected session observations and control outcomes, emit Pause/Resume intent at most once per occurrence, and begin dependent phases only after later observed state; and
- the runtime/window-planning source schedules 16 ms geometry samples but reapplies bounds only after geometry change or recovery; runtime-generation lifecycle is separate from HUD generation, timer movement does not terminate polling, and reconciliation remains HUD-generation-exact; and
- the preference-store tests cover strict versioned settings/selected-task decoding and atomic replacement in a disposable directory, while the host serializes preference IPC mutations; this is not cycle-snapshot recovery or platform durability.
- the task-time suite covers selected-task plus running-only accrual, task switching/Stop tracking, session replacement without durable session IDs, disappeared-task snapshots, conservative recovery, corrupt/future-file preservation, 100-entry pagination, deletion across loaded pages, DST-aware local-day/Monday-week aggregates, CSV escaping/formula protection, and deterministic newest-10,000/`<8 MiB` retention in temporary directories; and
- the menu exposes Context, Tasks, History, and Settings tabs through narrow task/history/settings preload operations, loads history 100 entries at a time with **Load older**, and deduplicates unchanged runtime/history rendering; and
- source and fixture-backed renderer/store/native-bridge tests cover prompt-free capability preflight, one post-presentation automatic native request per process when required, an explicit request retry, no phase-time request, helper-derived Input Events status, helper Screen Recording plus bounded real-capture-probe composition with no retained image, centered HUD-independent recovery placement, second-instance activation, one guarded Screen Recording false-to-true relaunch schedule, bounded checkpoint/exit handling, shutdown abort/no-reschedule behavior, a primary button that changes from **Allow** to **Continue** after both checks pass, screen-reading-gated **Not now** persistence with Input Events optional only while automation is off, no later recovery/request solely for that optional absence, and a Settings review/recheck path; they do not operate System Settings or prove real prompts, clean installs, real grant/relaunch activation, denial, revocation, regrant, or ad hoc application-identity churn; and
- the runtime suite covers Skip focus through the existing Pause authority and local Skip break to Ready, without a new Promethee operation; and
- the geometry cadence tests cover 16 ms sampling during change/recovery and 100 ms stable sampling after 750 ms, while window plans apply only to changed/recovered geometry.
- the renderer token/source review keeps focus progress orange and break progress neutral gray.
- source inspection confirms a user-requested, bounded GitHub Releases checker and exact release-URL allowlist, but no dedicated controlled update-check test suite or live network check is part of the recorded Electron test count.

Ordinary automated validation does **not** prove live commands, authoritative session/task/HUD state, SQLite side-effect freedom, cycle-snapshot persistence or lifecycle recovery, platform application-data durability, CSV accounting correctness, exclusion feeds, host window precedence, Windows runtime behavior, notification permission/deduplication, a clean registry installation, a public release, or update-check behavior. The separately authorized macOS 1.3.29 flow provides only the bounded live evidence recorded above; it does not broaden those claims or convert later observation into acknowledgement/causation. New installations initially default automatic Pause on and automatic Resume off. Verified screen reading—helper Screen Recording plus the bounded real-capture probe—is mandatory for attachment. After it passes, **Not now** may skip Input Events, persists both automation settings off, and prevents recovery from reopening solely for missing control. Later enabling either remains explicit, other stored values remain unchanged, Windows exposes no automation, and the environment kill switch overrides both settings.

## Target validation layers

| Layer | Required evidence | Does not prove |
| --- | --- | --- |
| Core domain | Deterministic unit and property-oriented tests with fake clock | Promethee integration or UI behavior |
| Bridge contract | Schema, capability, idempotence, ordering, timeout, and unsupported-version tests | Real Promethee compatibility |
| Read-only task source | Synthetic `tasks`/`task_projects` schema and query allowlist, no-write/WAL/journal checks, renderer isolation | Live content, unknown versions, or another platform path |
| Session observer | Synthetic eight-field snapshots, freshness/unknown states, clock arithmetic, ambiguity, and no-ack/retry tests | Authoritative events or command causation |
| Coordinator | Race-sequence and reconciliation tests against a controlled bridge double | Platform transport or real session behavior |
| Persistence | Migration, corrupt snapshot, atomic write, restart, sleep/wake tests | OS keychain or filesystem policy unless exercised |
| Local task-time reporting | Running-only intervals, switch/Stop-tracking/recovery behavior, disappeared-task snapshots, corrupt/future preservation, 100-entry pagination, deletion, DST-aware local aggregates, CSV fixtures, no-session-ID schema, count/byte bounds | Billing certification, permanent archive, platform filesystem permissions, or user-managed exported files |
| UI geometry | Layout tests and screenshots across known rectangles and edges | Controls remain clickable in real Promethee |
| Platform integration | Real macOS and Windows runs against an approved disposable Promethee environment | Signed release or updater trust |
| Security | Preload/IPC review, local peer authentication test, secret scan, updater verification failures | Absence of every vulnerability |
| V1 package/install | Manifest/files/bin review, exact tarball review, and clean-prefix CLI/helper plus real GUI checks on macOS arm64, macOS x64, and Windows x64 | Registry/GitHub publication, project signing, notarization, or Windows automation |
| V1 release | Immutable Git HEAD/tag/version, exact manual approval, successful pinned workflow, npm/GitHub artifact continuity, registry readback, and provenance when emitted | Native signing, notarization, Windows automation, or user adoption |

## Required domain sequences

At minimum, automate:

- idle → focus → manual Promethee pause → resume with unchanged remaining duration;
- focus deadline → one pause command → acknowledgement → break;
- pause timeout → authoritative query → correct reconciliation;
- break → early Promethee play → full new focus;
- break completion → Ready → dismiss without resume → later play;
- stop from each active state → idle;
- duplicate, stale, missing, and reordered bridge events;
- sleep beyond a focus or break deadline;
- restart with valid, old, future, partial, and corrupt snapshots;
- short/long-break cadence across restart.

## Required real UI matrix

Exercise at least:

- macOS and Windows at supported display scales;
- each Promethee HUD placement and every screen edge;
- running and paused HUD widths, including the extra Stop control;
- Tasks panels with zero, one, typical, and maximum visible items;
- above/below reversal and horizontal clamping;
- multiple displays and movement between displays;
- reduced motion, keyboard navigation, screen reader labels, and high-contrast conditions;
- transient reward/overtime/`Accept` exclusions and delivery latency; and
- bridge disconnect while each attached surface is visible.

Acceptance requires that the outline follows the actual timer, consumes in the correct direction, never obscures controls, and disappears safely when geometry is unknown.

## Reporting template

Use this structure in handoff or release evidence:

```text
Passed: <command/check and environment>
Failed: <command/check, failure, and impact>
Skipped: <applicable check intentionally not run and why>
Unavailable: <required external dependency or permission not present>
Installed locally: yes/no
Published: yes/no
Deployed: yes/no
```
