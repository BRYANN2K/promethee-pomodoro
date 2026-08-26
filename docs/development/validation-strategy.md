# Validation strategy

**Status:** Active Electron/TypeScript/npm contract with mock-backed domain/integration evidence, a composed macOS native external bridge, a passive Windows candidate, fixture-backed Electron evidence, and one separately authorized bounded live macOS 1.3.29 flow.

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
| Passed | `npm run target:test:electron` | 132/132 fixture-backed Electron tests covering HUD/window planning, adaptive geometry cadence, locator/runtime/localization, injected control, synthetic SQLite readers, observation-driven runtime, preference store, task-time tracker/store/history/CSV, platform defaults, CLI/package boundary, and reconciliation. No live command or live database content read ran. |
| Passed | `npm test` | 253/253 total: 33 core + 71 integration + 17 persistence + 132 Electron. |
| Passed | `npm run target:typecheck` | Current TypeScript projects type-check with the pinned installed dependencies. |
| Passed | `npm run target:build` | Builds the local `darwin-arm64` native helper plus application JavaScript and reviewed resources. This is not cross-platform packaging or installation. |
| Unavailable / expected local failure | `npm run target:verify-release` | The verifier cannot complete in this single-host tree because `darwin-x64` and `win32-x64` helpers are absent. This is not publication, signing, notarization, Windows execution, or cross-platform support proof. |
| Retained contract | Project UI skill | The approved design-system guidance remains compiled under `.agents/`; obsolete local preview/build-gate artifacts were intentionally retired and are not runtime proof. |
| Partial + live evidence | External bridge on macOS Promethee 1.3.29 | Architecture/source composition and fixture-backed first-launch permission onboarding exist. A separately authorized 2026-08-25 exercise passed one same-session focus → pause → short break → resume → focus flow; running HUD `159 × 32`, paused HUD `191 × 32`. It does not prove acknowledgement/causation, a clean-install denial/revocation/regrant permission lifecycle, a supported-version/database-side-effect matrix, exclusions/z-order, or Windows. |
| Partial + local lifecycle evidence | Single-instance and shutdown recovery | On 2026-08-26, a second launch reopened the existing popup and a `TERM` quit followed by manual reopen passed. The real Screen Recording grant and automatic relaunch remain pending user validation. |
| Partial + live permission-status evidence | Native macOS helper | The real helper reported Input Events and Screen Recording as granted (`1,1`). This does not exercise the Screen Recording false→true transition or prove automatic relaunch; that check remains pending after build. |
| Source-inspected, live regrant pending | Local macOS TCC reset | `install-electron.sh` resets only Accessibility and ScreenCapture for the current and retired bundle identifiers after the ad hoc-signed app is installed. It does not grant access; post-build user revalidation/regrant and the Screen Recording relaunch remain unverified. |
| Unavailable | Supported HUD/multi-window proof | The macOS host can read bounded window rectangles and create separate local surfaces, but has no authoritative exclusion stream, host-precedence proof, Windows equivalent, or support claim. |
| Partial | ADR-0012 Electron task source | A host-wired built-in `node:sqlite` reader uses fixed task/project statements, strict bounds, and synthetic fixtures, and supplies the local picker. Exact supported-version schemas, complete renderer-isolation/database-side-effect proof, live task/project compatibility, and Windows runtime proof remain unavailable. |
| Partial + research evidence | Promethee 1.3.29 session schema/state | A sanitized macOS read found WAL/session-schema/time-formula evidence. The host-wired reader implements the eight-field query and conservative derivation and supplies the external runtime controller. The bounded live flow observed state changes but did not create authoritative revision/acknowledgement or causation; exact synthetic 1.3.29 fixture and Windows proof remain unavailable. |
| Unavailable | macOS/Windows support proof | No packaged application or real integration matrix has run on both target platforms. |
| Configured, unverified | V1 package/release implementation | Public unscoped `promethee-pomodoro@1.0.0` metadata, one CLI mapping, three-target helper/file allowlist, secondary macOS source installer, pinned macOS/Windows CI and stable-tag release workflows, package verifier, and manual GitHub Releases check exist. There is no verified public Git HEAD/tag, workflow run, reviewed npm/GitHub artifact, registry readback, clean install/rollback, project signature, or notarization. |
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
