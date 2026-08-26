---
id: ADR-0011
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0011: Use constrained OS automation as the external Promethee action transport

> **Amended by ADR-0016 (2026-08-25):** this record preserves the accepted authority, consent, privacy, fail-closed, and no-retry boundaries. The active Electron execution mechanism no longer prefers or uses semantic `AXPress`/UIA actions and uses no AppleScript or JXA. It uses the native process/window helper and rendered Pause/Play glyph targeting, with CoreGraphics input on macOS. See [ADR-0016](0016-use-native-input-helpers-for-the-external-action-bridge.md).

> **V1 implementation amendment (2026-08-26):** new installations initially default automatic Pause enabled and automatic Resume disabled. Verified screen reading—helper Screen Recording plus the bounded real-capture probe—is mandatory for HUD attachment. After it passes, choosing **Not now** may skip Input Events and persists both automation settings off without reopening recovery solely for missing control. Later enabling either remains explicit, other stored preferences remain unchanged, and the environment kill switch overrides both. Windows V1 is passive observation/attachment only and exposes no Promethee automation. References below to both defaults being off, Windows UIA/`SendInput`, or an opt-in-only action path are historical design context, not the current product contract.

> **Permission-onboarding implementation note (2026-08-26):** the macOS first-launch UI first passively preflights screen reading and Input Events separately. After the startup refresh and onboarding presentation, the host may invoke the native permission request automatically at most once per process if required; macOS may show Accessibility/register the app, while the user controls final System Settings toggles. **Check again**, Settings review, and phase transitions are request-free; **Allow** remains the explicit retry. Input Events status comes from the native helper. The Read-timer check and attachment authority require both helper-reported Screen Recording and a bounded probe through the real `/usr/sbin/screencapture`; no probe image is retained. Permission and missing-geometry recovery use a centered current-display menu independent of the HUD, then restore attached placement after mandatory screen reading plus current safe geometry recover. A Screen Recording false-to-true transition schedules one guarded relaunch: revoke automation authority, abort native control, prevent runtime poll rescheduling, wait at most 750 ms for queued preference/task-time checkpoints, call `app.relaunch()`, then finish with `app.exit(0)`. Ordinary quit uses the same bounded flush/exit path without relaunch. A second launch brings the existing popup forward. After both checks pass, the button becomes **Continue**. Once screen reading passes, a localized **Not now** path may skip Input Events and atomically complete onboarding with automatic Pause and Resume both off for passive use without recovery or request reopening solely for missing control on later launches; **Not now** is refused while screen reading is unavailable. Permission request and automation enablement remain separate choices. Local ad hoc rebuilds may require regrant. This note supersedes the automatic launch-request wording retained below as historical design context. A 2026-08-26 native-helper check returned `1,1`; a separate smoke passed second-launch popup recovery and `TERM` quit followed by manual reopen. The real Screen Recording grant/relaunch, clean-install, prompt, denial, revocation, regrant, and application-identity lifecycle proof remain open.

> **Local ad hoc identity note (2026-08-26):** the V1 source installer produces an ad hoc signature whose designated requirement is a build-specific `cdhash`. After installation it resets only Accessibility and ScreenCapture TCC entries for the current and retired bundle identifiers so the user can revalidate and grant the new build again. It never grants permission and is not a durable update mechanism. Future Apple Developer ID signed delivery is the stable application-identity solution.

## Context and problem

ADR-0002 currently requires production access through a Promethee-owned bridge. That boundary provides the strongest state acknowledgement and ownership model, but it also blocks a companion release until Promethee implements and releases the other side of the contract.

The Electron target now contains a macOS host that reads bounded window geometry through Accessibility and fails closed when it cannot identify exactly one compact timer. The host also wires a constrained control helper with a semantic `AXPress` path and a bounded visual-input fallback for exact Pause/Resume. Pause and Resume are independently off by default, and an environment kill switch forces both off. Tests use injected executors, synthetic SQLite observations, and controlled receipts; no validation run has sent a command to a live Promethee process. Windows UI Automation has not been implemented or evaluated.

We need to decide whether a separately distributed companion may implement the existing typed adapter through a constrained operating-system Accessibility transport instead of waiting for an upstream in-process bridge.

## Scope and non-goals

This decision covers process discovery, read-only window/control observation, exact Pause/Resume actions, the semantic-first and bounded visual-input paths, permission lifecycle, acknowledgement limits, and macOS/Windows parity. Acceptance does not itself enable live integration, authorize SQLite beyond ADR-0012/ADR-0013, authorize private IPC, define packaging, or make Promethee Accessibility labels/layouts a public API. ADR-0014 composes ADR-0012 task reads and ADR-0013 minimal session observations.

## Decision drivers

- Preserve the typed adapter and Promethee as session authority.
- Avoid a mandatory upstream code change for the first external transport.
- Keep OS-level permission explicit, revocable, and disabled by default.
- Prevent broad UI traversal, guessed or unbounded coordinate input, global input capture, and content logging.
- Fail closed across application versions, localization changes, ambiguous controls, and indeterminate actions.
- Maintain one semantic contract across macOS Accessibility and a future Windows UI Automation implementation.

## Constraints

- The project owner accepted this transport in the current conversation on 2026-08-25 as part of the external bridge composed by ADR-0014.
- The typed adapter remains governing, while ADR-0014 replaces ADR-0002's upstream-owned transport requirement for the companion.
- Live read-only observation at application launch is part of the accepted product path. It does not grant session-control consent and is not platform-support evidence.
- **Historical clause, superseded by the permission-onboarding implementation note above:** macOS originally requested bounded Screen Recording and input-event permissions when the application opened, before phase automation was armed. Denial left automation unavailable and a later phase transition could not become the first or repeated permission prompt. The user could revoke either permission at any time.
- A broad OS permission does not authorize broad application behavior. The implementation must constrain itself to the validated Promethee process and accessibility subtree.
- No real session command may run during ordinary unit, build, specification, or UI validation.

## Considered options

1. Retain the official Promethee-owned in-process or authenticated local bridge from ADR-0002.
2. Implement the typed adapter through narrow macOS Accessibility/bounded native input and future Windows UI Automation providers.
3. Call private Promethee IPC, read its databases, or reuse its credentials.
4. Remain read-only with no session coordination.

## Decision

A separately distributed companion **may implement the accepted external bridge's action subset through constrained OS automation**. The macOS provider prefers Accessibility semantics and may use the bounded visual-input fallback defined below; a Windows provider will use UI Automation patterns selected only after a separate dependency and security review. An official Promethee API remains the preferred migration target when available.

**Historical decision text, superseded by the permission-onboarding implementation note above:** new macOS installations defaulted automatic Pause on and automatic Resume off; existing stored choices remained unchanged. The former launch-time permission request was only an OS capability grant and did not broaden the two settings. An environment kill switch overrode both settings. Permission denial, revocation, target ambiguity, unsupported versions, or an unexpected accessibility tree suspended automation and hid or disabled dependent interactive surfaces without changing the Promethee session.

Target selection would validate the strongest available identity. On macOS that includes the bundle identifier plus process identity and installed application identity where available; on Windows it includes the executable, process, and publisher identity where available. Process name alone would be insufficient for mutation. Each supported Promethee/OS combination would require a reviewed fixture and explicit compatibility evidence.

Inspection is limited to the validated Promethee process, timer window, and allowlisted accessibility roles, labels, identifiers, actions, and bounded geometry needed for the capability. A bounded pixel capture of that already validated timer rectangle is allowed solely to classify an exact reviewed running/paused control layout and the independent Pause/Play glyph before dispatch; it performs no OCR and is never stored or logged. Broader screenshots, clipboard access, global keylogging, unrelated desktop traversal, authentication material, private IPC, and arbitrary network access remain prohibited. Logs contain diagnostic codes, versions, freshness, and bounded counts, never pixels, task titles, session identifiers, timestamps, or arbitrary window/control text. Native handles and accessibility element references are not persisted.

Mutation prefers a unique contained semantic action such as macOS `AXPress` or the corresponding Windows UI Automation Invoke/Toggle pattern. If semantic lookup is unavailable, the macOS provider may issue one exact native click only when all stronger fallback gates pass. The action preflight reads the allowlisted SQLite session observer directly twice and captures/classifies only the bounded HUD twice; the second read and capture occur immediately before dispatch. Both pairs must retain the same session and expected state, installed-app/bundle/PID identity, exact HUD identity/rectangle/generation, complete reviewed running/paused layout, and independent Pause/Play glyph classification while rejecting Stop and every ambiguous layout. The deterministic target center comes from the second reviewed layout. No cached runtime observation, guessed position, broad coordinate input, global shortcut, second click, or automatic retry is allowed. Safe v1 allows exactly `session.pause` and `session.resume`; Play means Resume for the same paused session, never Start. Start, Stop, End, and task mutations remain unavailable.

An action-dispatch receipt is never an authoritative acknowledgement. A later SQLite or Accessibility observation may report current state, but it cannot establish writer identity, command causation, or success. The adapter reports `sent-unconfirmed` or an equivalent indeterminate outcome and never retries automatically. Reconciliation is valid only against the exact pending HUD generation; a replacement generation cannot clear or confirm the action. If the transport cannot establish current stable session identity and compatible pre-action state, automatic session coordination remains disabled.

## Rationale

A constrained Accessibility provider can preserve the existing adapter boundary and avoid coupling the first companion transport to an upstream release. It is also less trustworthy and less stable than an owner-supplied service contract: OS permission is broad, accessible labels and structure may change, and an action may be dispatched without authoritative acknowledgement. These differences must remain visible in types, product consent, compatibility claims, and test evidence.

## Option comparison

| Driver | Official bridge | Narrow AX/UIA candidate | Private IPC/database/credentials | Read-only fallback |
|---|---|---|---|---|
| Upstream change required | Yes | No | No | No |
| Trust boundary | Promethee-owned and explicit | Broad OS grant constrained by identity, observation, layout, and one-action gates | Bypasses product boundaries | No mutation authority |
| State acknowledgement | Authoritative revisioned state | None; later local/UI state is observation only | Unsupported and version-fragile | Not applicable |
| Cross-platform path | One bridge contract | Separate macOS AX and Windows UIA providers | Platform/runtime-specific | Geometry only where available |
| Compatibility burden | Coordinated protocol versions | Accessibility tree, localization, signing identity, and OS drift | Private implementation drift | Read-only drift |
| Decision | Preferred future profile | Accepted external transport | Rejected | Safe fallback |

## Consequences

### Positive

- A companion could provide a narrow integration without modifying Promethee first.
- The typed adapter, coordinator, and domain model would remain transport-independent.
- Permission and compatibility could be revoked per platform without weakening core behavior.

### Negative

- Accessibility permission is broader than the desired capability set and may be re-prompted or behave differently across locally rebuilt, ad hoc signed V1 applications.
- UI structure, labels, localization, and application-version drift require per-platform fixtures and maintenance.
- An OS-mediated action still lacks the authoritative command acknowledgement available from a first-party bridge.
- Windows UI Automation may require a reviewed native helper or dependency that has not been selected or authorized.

### Neutral

- The official API/bridge remains the preferred future transport.
- Current macOS source composition is implementation evidence only, not complete supported-version, permission, live-action, or platform proof.

## Implementation and migration

1. Apply ADR-0014's composed external-bridge contract and amendment notes to ADR-0002/ADR-0006 without changing Promethee session authority.
2. Define a transport capability descriptor that distinguishes session/task/HUD observations, exact Pause/Resume actions, permission state, target identity, Promethee version, freshness, and observation strength.
3. Validate the implemented permission UX on clean macOS installations so launch, denial, revocation, regrant, application-identity changes, the independent automation choices, and the environment kill switch all preserve fail-closed behavior without phase-time prompts.
4. Harden macOS target identity and replace process-name-only discovery before any mutating wiring.
5. Add independent post-action observation and surface indeterminate outcomes without blind retry.
6. Select and review a Windows UI Automation provider; do not infer Windows support from macOS fixtures.
7. Run a separately authorized disposable-session proof on each platform before enabling live behavior.

## Validation

- Unit and contract tests use controlled Accessibility/UIA, raster, and SQLite-observation fixtures plus injected executors; they send no live command.
- Security tests cover denied/revoked permission, wrong identity, ambiguous processes/windows/controls, unexpected roles/actions, localized label drift, stale geometry, timeouts, disappearing targets, and screen changes.
- Mutation tests prove that only exact Pause/Resume can be dispatched; semantic action is preferred; the fallback cannot run without two direct matching fresh SQLite reads, two matching bounded HUD captures/classifications with the second immediately before dispatch, exact app/PID/HUD geometry/generation, and one deterministic click target; Stop/Start/End, broad coordinate input, global shortcuts, and retry are absent.
- Reconciliation tests prove that dispatch remains `sent-unconfirmed`; later matching state is only a new observation and never acknowledgement, causation, or retry authority.
- Each platform proof uses an explicitly authorized disposable Promethee session and records the exact Promethee, Pomodoro, OS, architecture, and permission configuration.
- Release documentation states macOS and Windows support independently; one platform never satisfies the other.

## Revisit triggers

- The project owner accepts or rejects this candidate.
- Promethee publishes a supported public API, plugin contract, or official bridge.
- Stable current-session identity cannot be observed through the composed SQLite/HUD sources.
- macOS or Windows permission, signing, or automation policy prevents safe distribution.
- A supported Promethee version exposes neither a unique semantic control nor an exact independently classified bounded visual layout.

## Related decisions and evidence

- Supersedes through ADR-0014: only the upstream-owned transport requirement in [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) for the companion.
- Amends through ADR-0014: capability/handshake and acknowledgement assumptions in [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Preserves: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md), and [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md).
- Composed without expanding its action authority by: [ADR-0014](0014-compose-the-external-promethee-bridge.md), alongside accepted [ADR-0012](0012-read-only-promethee-tasks-from-local-sqlite.md) and [ADR-0013](0013-read-current-session-as-a-non-authoritative-sqlite-observation.md).
- Implemented by: the platform-gated external bridge and native helper source/tests, as amended by ADR-0016.
- Current evidence after ADR-0016: a host-wired macOS native locator/input path, rendered-layout control tests, and one separately authorized Promethee 1.3.29 same-session focus → pause → short break → resume → focus exercise with `159 × 32` running and `191 × 32` paused HUDs. Automation defaults off. This is not Windows, broad compatibility, release, signing, or installation proof.
