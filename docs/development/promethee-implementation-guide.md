# Implement the first-party Promethee integration

**Status:** Target upstream implementation guide. A local adapter/coordinator exists against controlled doubles, but no Promethee source path or symbol in this page has been verified.

This guide is for Promethee engineers implementing the owner-approved bridge and Pomodoro capability in the real Electron application. It describes the required ownership boundaries, contracts, and proof sequence. It deliberately does not invent Promethee filenames, package scripts, frameworks, or build commands.

The repository's typed contracts, tests, architecture pages, and accepted ADRs define the behavior this guide maps onto the real Promethee codebase.

## Outcome

After completing this guide, the Promethee repository should contain a first-party, least-privilege integration that:

- reuses the authoritative session, task, and HUD services already owned by Promethee;
- exposes only the typed Pomodoro capabilities approved by the bridge contract;
- keeps Promethee's real timer as the only play/pause/stop control;
- supplies reliable timer geometry for a consuming, input-transparent progress outline;
- supplies authoritative Tasks and transient exclusion rectangles so a separate local SVG handle/menu never covers Promethee UI;
- fails closed when the bridge, capability, payload, or Promethee version is incompatible; and
- has a recorded vertical proof on supported macOS and Windows environments.

## Read these contracts first

- [Target architecture](../architecture/target-architecture.md)
- [Proposed bridge contract](../architecture/promethee-bridge-contract.md)
- [Compatibility and security](../architecture/compatibility-and-security.md)
- [Build order and gates](../architecture/build-order.md)
- [ADR-0001: Electron and TypeScript target](../architecture/decisions/0001-use-electron-and-typescript-for-the-cross-platform-target.md)
- [ADR-0002: typed Promethee adapter](../architecture/decisions/0002-integrate-through-a-typed-promethee-adapter.md)
- [ADR-0004: Promethee session authority](../architecture/decisions/0004-make-the-promethee-timer-the-session-control-authority.md)
- [ADR-0005: consuming HUD outline](../architecture/decisions/0005-render-progress-as-a-consuming-outline-around-the-real-hud.md)
- [ADR-0006: capability negotiation](../architecture/decisions/0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md)
- [ADR-0009: superseded Promethee-owned invocation proposal](../architecture/decisions/0009-let-promethee-own-attached-surface-invocation.md)
- [ADR-0010: accepted local SVG handle](../architecture/decisions/0010-use-a-local-svg-handle-for-pomodoro-surfaces.md)
- [ADR-0019: accepted local per-task time ledger](../architecture/decisions/0019-keep-a-local-per-task-time-ledger.md)

## Evidence boundary

A read-only analysis of Promethee 1.3.26 indicates that analogous internal session, task, HUD placement/mode, and preload capabilities exist. It also indicates that Promethee uses guarded IPC with Node integration disabled, context isolation enabled, and sandboxing enabled. It does not verify exact real-timer pill bounds. Promethee 1.3.29 has not received a reviewed source/runtime proof for this future official profile. ADR-0014 separately accepts the external companion bridge; its sanitized SQLite observer remains non-authoritative and is not permission to externalize private IPC.

Local handle invocation is accepted by ADR-0010, but safe host avoidance remains an unresolved integration P0. No inspected evidence maps authoritative Tasks, reward/overtime, other transient-popup rectangles, the `Accept` control, their stable surface/revision lifecycle, or the `HudGeometry.layoutRevision` owner. Do not claim the attached experience ready until Promethee owner Nicolas approves the read-only exclusion contract and an authorized upstream source map identifies those owners.

Before changing Promethee, inspect the exact target revision. Treat every name in angle brackets below, such as `<session-service>`, as a mapping slot. Do not create a literal module with that name merely because it appears in this guide.

### What this repository already proves

The code in `src/promethee-adapter/v1` implements the client-side v1 values, runtime validation, operation-level grants, required `hud.geometry`, subscribe-before-snapshot buffering, `atSequence` replay, sequence-gap detection, command idempotency, timeout classification, and connection revocation over an injected raw port. Its tests distinguish protocol compatibility from Promethee application compatibility, return typed `UNSUPPORTED_PROTOCOL`, reject broad or unrequested grants, require `hud.geometry`, and block unknown operations or malformed mutation payloads. The serialized coordinator in `src/session-coordinator` binds that adapter to the pure core, issues only pause mutations, waits for authoritative pause before break, uses authoritative event occurrence time during bounded replay, preserves pause correlation across non-session events, isolates replay by connection generation, and returns to idle on terminal observations. Their final frozen-source controlled-double suite passes 71/71 tests.

This is reusable client-side contract and coordination evidence, not the first-party bridge described below. It has no mapped Promethee service, real preload/IPC boundary, authenticated transport, installed dependency set, type-check result, live task/session/HUD payload, or macOS/Windows runtime proof. Promethee engineers should map the upstream bridge to the existing v1 contract rather than treating the fake/raw port as an implementation location.

ADR-0019 is deliberately companion-owned and does not require an upstream Promethee write API. The Electron main process derives local intervals only while one selected task and the current non-authoritative session observation are running. A task change or **Stop tracking** closes the previous local interval; Stop tracking clears selection and preserves history. Bounded task/project snapshots and locally derived start/end timestamps are stored in `task-time-v1.json`, while Promethee session identifiers remain process-memory-only and are never exposed to renderer history or CSV. The companion pages history 100 entries at a time, computes today/Monday-week totals from DST-aware local calendar boundaries, and preserves corrupt/future ledgers fail-closed. If Promethee later offers an official time-reporting capability, treat migration as a new reviewed decision; do not silently write or backfill companion history into Promethee.

## 1. Build the source map before coding

Record one reviewed mapping table in the Promethee change or a repository-local design addendum:

| Logical role | Evidence to find in Promethee | Record before implementation |
| --- | --- | --- |
| Application manifest | Actual package manifest, lockfile, runtime constraints, workspace layout | Package manager, Electron/Node/TypeScript versions, workspace owner |
| Main-process bootstrap | Code that creates the primary and HUD windows and registers lifecycle handlers | Path, exported owner, initialization and teardown order |
| Session authority | Service used by Promethee's real controls and active-session reads | Pause/resume owners; observed start/stop/end state sources; transaction boundary and errors. Safe v1 exposes no start/stop/end mutation. |
| Session events | Source consumed by Promethee UI after an authoritative session change | Path, event names/types, ordering, revision or timestamp semantics |
| Task authority | Service or repository used by the Tasks UI for live eligible tasks | Path, stable ID field, eligibility rules, change event source |
| HUD state owner | Owner of placement, mode, visibility, display, drag, and timer layout state | Path, state fields, coordinate convention, update lifecycle |
| HUD layout owner | Module that knows the rendered timer pill bounds, including paused width | Path, measurement method, exact `HudGeometry.layoutRevision` source, when layout is stable |
| Host occupancy owners | Controllers that open/close Promethee Tasks, reward/overtime, and other HUD transients | Paths, bounded roles, exact rectangles, stable surface/revision identity, show/hide ordering |
| Host popup actions | Owner of interactive controls such as reward/overtime `Accept` | Path, bounds relationship, input/z-order policy, lifecycle |
| Host Tasks focus manager | Owner of any Promethee-owned Tasks-slot focus-return token/release path | Path, host-only scope, invalid-target behavior, platform differences |
| Existing extra-width owner | Existing bounded equivalent of `setPillContentExtraPx`, if present | Path, accepted units/range, reset lifecycle, layout event emitted |
| IPC registration | Existing allowlisted handler registration and sender/origin validation | Path, validation helper, channel naming and cleanup convention |
| Preload boundary | Existing `contextBridge` exposure for trusted Promethee renderers | Path, namespace, request/event wrapper and unsubscribe convention |
| Renderer state | Store or controller used by the real timer and Tasks panel | Path, state ownership, renderer framework and test convention |
| Platform verification | Existing macOS and Windows integration/smoke harnesses | Jobs, supported OS versions, scale/display fixtures, evidence owner |

The map is complete only when a Promethee engineer can trace each session mutation from the real UI to the authoritative service and back to the UI event. Finding an IPC channel string alone is insufficient.

### Inspect these project facts as one unit

- Manifest and lockfile, including workspaces and package-manager pinning.
- Electron security defaults for every participating window.
- TypeScript configuration and runtime schema-validation convention.
- IPC registration, sender/frame validation, preload exposure, and listener cleanup.
- Session and task services, their storage transactions, and their post-commit events.
- HUD window creation, display selection, placement persistence, drag flow, and layout measurement.
- Existing unit, integration, renderer, and packaged-application test conventions.
- CI platform matrix and release/security ownership.

If a required owner or behavior cannot be traced, stop that capability. Do not fill the gap with direct database access, screen scraping, or guessed IPC.

The local reporting ledger is not an upstream source-map slot. A future first-party implementation may provide the same user outcome, but it must preserve Promethee's session authority, explicitly decide data ownership/retention/export, and avoid importing a Promethee session identifier merely because the companion used one ephemerally for replacement detection.

## 2. Place the integration at existing ownership boundaries

The preferred first-party shape is:

```text
Promethee session/task/HUD services
        ↑ called directly by a typed main-process facade
Pomodoro bridge facade in Promethee main process
        ↕ dedicated allowlisted request/event handlers
Promethee preload boundary
        ↕ narrow typed Pomodoro API, no raw ipcRenderer
Promethee-owned Pomodoro renderer/controller
        ↕ domain events and view state
Pure Pomodoro cycle engine
```

Map each logical box to an existing Promethee package or module after inspection. Follow the repository's current workspace and dependency direction instead of introducing a parallel architecture.

### Main-process facade

Add a small facade beside the existing owner-approved main-process service boundary. The facade should:

- call the underlying session/task/HUD service, not invoke Promethee's own IPC handler as if it were a service;
- translate internal values into the stable bridge contract and validate the result before returning it;
- preserve the service's transaction and post-commit event ordering;
- assign connection-scoped revisions only when no authoritative revision already exists;
- authorize pause and resume independently, then deduplicate each granted mutating command by `connectionId` and `commandId`;
- revoke subscriptions and pending authority when its owning window or app lifecycle ends; and
- emit typed errors without leaking database objects, stack traces, channels, credentials, or private configuration.

Do not duplicate session state in the facade. A cache may support event fan-out, but `session.getActive` and conflict reconciliation must resolve through the authoritative Promethee owner.

### Preload boundary

Expose a dedicated Pomodoro API through Promethee's existing context-isolated preload convention. The public surface contains named operations only. It must not expose `ipcRenderer`, `send`, `invoke`, arbitrary channel names, a generic method dispatcher, filesystem access, or database access.

Use one listener method per event family and return an unsubscribe function. The preload must detach the exact wrapped listener, not rely on renderer code to remove all listeners for a channel.

If Promethee already has an approved namespace for first-party renderer capabilities, extend it according to that convention. Otherwise choose a namespace during source review and record it in the implementation change. This guide does not prescribe a global name.

### Renderer and domain boundary

Keep the cycle reducer, state types, deadline calculations, and serializable effects free of Electron, DOM, storage, and Promethee imports. A controller in the Promethee-owned renderer or main process coordinates the pure engine with the bridge. UI code renders reconciled view state and never subtracts interval ticks to define elapsed time.

## 3. Implement negotiation before feature calls

The first bridge operation negotiates a connection. Map the exact names to Promethee conventions, but preserve these fields and semantics:

| Field | Rule |
| --- | --- |
| Client identity/version | Identifies this first-party Pomodoro capability and its release version. |
| Supported protocol versions | Bounded values understood by the caller; no optimistic future-major acceptance. |
| Requested capabilities | Explicit set required by the feature being enabled. |
| Requested operations | Exact mutating operations requested; a broad session-control request is invalid. |
| Connection nonce | Unique value used to bind this negotiation and prevent stale acknowledgement reuse. |
| Promethee version | Diagnostic and compatibility-matrix input, not authorization by itself. |
| Selected protocol version | Must be one the client offered. |
| Granted capabilities and versions | The only read/event features available on this connection. |
| Granted operations | Exact mutation allowlist for this connection; read/event grants imply no mutation authority. |
| Connection ID | Opaque instance identity; changes after reload, restart, or reconnect. |

Use the names defined in the [bridge contract](../architecture/promethee-bridge-contract.md): `session.read`, `session.events`, operation-level `session.pause`, optional operation-level `session.resume`, `tasks.read`, `tasks.events`, `hud.read`, required `hud.geometry`, `hud.events`, optional `hud.reserve-space`, and the read-only `hud.exclusions.read` and `hud.exclusions.events` capabilities required by the local interactive handle/menu. Do not request a host surface owner or `hud.surface.release` for local invocation. Do not create or accept a broad `session.control` or HUD-control grant.

Feature requirements are evaluated independently. Automatic focus-completion pause cannot run without compatible session read/events and an explicit `session.pause` grant. Task selection can be disabled without disabling the pure cycle engine. The outline remains hidden without compatible HUD state/events and the required `hud.geometry` capability. The interactive handle and menu remain hidden unless both exclusion read/events capabilities are live at the current `HudGeometry.layoutRevision`.

On reconnect, negotiate a new connection, discard old incremental assumptions, and reload active session, tasks, and HUD state before applying new events.

## 4. Expose the minimum command and event surface

Use the existing Promethee services to implement these semantics. Actual TypeScript names and file locations must come from the source map.

### Commands

| Semantic command | Required behavior |
| --- | --- |
| Negotiate | Select protocol and capabilities; create a connection instance. |
| Get active session | Return the current authoritative session or `null`. |
| Pause session | Pause the matching active session or acknowledge an already-paused no-op. |
| Resume session | Resume the matching active session or acknowledge an already-running no-op. |
| List tasks | Return a bounded, approved projection with stable IDs and eligibility status. |
| Get HUD state | Return current visibility, timer bounds, display, placement, mode, and layout revision. |
| Reserve HUD width | Optionally request bounded extra width through the existing HUD layout owner. |
| Get HUD exclusions | Return the exact [`HudExclusionsSnapshotV1`](../architecture/promethee-bridge-contract.md#hud-exclusion-schema-v1): bounded `exclusions[]`, per-entry stable surface/revision identity, coherent set/HUD/layout revisions, coordinate space, and snapshot watermark. |
| Get host Tasks-slot state | Only if Promethee already exposes this host-owned lifecycle; it never assigns local Pomodoro-menu ownership. |
| Release host Tasks surface | Preserve optional/null focus-token behavior only inside the authorized Promethee-owned Tasks lifecycle. The local handle/menu never requests or invokes this operation. |

Safe v1 MUST NOT expose or call start, stop, or end. It may expose pause and resume only, and each operation requires its own negotiated grant. Every mutating command carries a caller-generated `commandId`, current `connectionId`, and the expected session or surface revision required by that operation. The acknowledgement repeats the command ID and returns the resulting authoritative state and revision. A timeout means the outcome is unknown; read current state before retrying. A repeated command ID on the same connection cannot apply the mutation twice.

### Events

| Semantic event | Required behavior |
| --- | --- |
| Session changed/completed | Publish only after the authoritative service transition is committed. |
| Tasks changed | Publish a normalized change or a refresh-required marker. |
| HUD changed | Publish an atomic current geometry/state snapshot after the relevant layout settles. |
| HUD exclusions changed | Publish the exact-key authoritative upsert, removal, or refresh-required variant with resulting set/HUD/layout revisions; reject unknown keys, invalid bounds, duplicate IDs, revision conflicts, and cursor gaps as a complete-state failure. |
| Host Tasks surface changed | If exposed, publish only the Promethee-owned Tasks lifecycle; never use it as local menu invocation. |
| Bridge closing | Revoke the connection and tell clients to stop issuing commands. |

Events carry the connection ID, schema version, ordered connection-scoped sequence, entity or layout revision, and typed payload. After a sequence gap, reload the corresponding authoritative snapshot.

Do not create a second event stream by observing the database independently. Adapt the same events that keep Promethee's own renderer current.

### Close the snapshot/subscription race

Every session, task, HUD, exclusion, and negotiated host-surface snapshot must identify `atSequence`, the last event included in the snapshot. Use one of two reviewed bootstrap patterns:

1. Subscribe and buffer first, request the snapshot, discard buffered events at or below `atSequence`, then apply the remaining contiguous sequence.
2. Create the snapshot at `atSequence` and atomically attach delivery beginning at `atSequence + 1`.

Do not mark data live after “snapshot, then subscribe” without one of those guarantees; an event can be lost in the gap. After reconnect or a cursor gap, discard incremental assumptions and repeat the bootstrap.

## 5. Map session behavior without creating a second authority

Promethee remains authoritative for running, paused, and stopped state. The Pomodoro coordinator owns only focus/break/ready policy.

Implement and verify these rules:

1. A reported running Promethee session starts or resumes focus according to the coordinator state.
2. A manual Promethee pause freezes active focus at its deadline-derived remainder.
3. At focus completion, Pomodoro requests one pause and waits for acknowledgement or reconciled already-paused state before starting break.
4. Break time continues while Promethee remains paused.
5. Promethee play during break or ready starts a new focus with the full currently configured duration.
6. Promethee stop cancels the active Pomodoro cycle.
7. Pomodoro surfaces do not expose another play/pause control.

**Skip phase** does not add an upstream command. Skip focus reuses the same already-authorized Pause operation and its acknowledgement/indeterminate-outcome rules, without completed-focus credit. Skip break is local Pomodoro policy and moves to Ready without calling Promethee. **Reset timer** remains local to the current phase.

Map only granted `pause` and `resume` operations to the semantic service operation used by Promethee's real control. Observe start, stop/end, completion, and active-session replacement from authoritative state/events, but do not expose or call those terminal mutations in safe v1. A stopped, completed, missing, or replaced bound session returns Pomodoro to idle and invalidates pending commands.

The Ready prompt is not permission to control Promethee. Safe v1 tells the user to press the real Promethee Play control. A future Ready action may call start or resume only after a later reviewed contract explicitly adds and grants the exact operation for that action; no current read, event, pause, or generic capability implies that authority.

## 6. Project tasks through the accepted read-only task source

Return only fields needed for selection and later session linkage:

- stable task identifier;
- display title;
- current eligibility/status;
- optional stable project identifier and display name when approved; and
- point-in-time snapshot freshness from the local provider.

ADR-0012 permits only `tasks` and `task_projects`. The main-process provider opens one exact database path read-only, enables `query_only`, disables extension loading, and uses fixed per-version explicit-column statements. Bound the snapshot and decode values strictly. SQLite supplies no task event cursor through this path; refreshes are point-in-time and must not be labelled authoritative/live events. A future official bridge provider may add revisioned events behind the same normalized task-source port.

Pomodoro never completes, deletes, edits, or reorders a task because a focus phase changed. If a pending selected task becomes completed, deleted, or inaccessible, mark it unavailable and require another explicit selection. An active focus keeps its historical task reference for that cycle.

ADR-0013 adds one separate exception for the companion: a current-session observer may query only `id`, `started_at`, `ended_at`, `duration_seconds`, `total_pause_ms`, `pause_started_at`, `parked_at`, and `deleted` from `sessions`. It returns a non-authoritative point-in-time state with local freshness, never revisions, events, command acknowledgement, causation, or retry authority. HUD and exclusion data must not come from SQLite. The macOS companion host wires the built-in `node:sqlite` reader to its observation-driven runtime. One authorized Promethee 1.3.29 same-session focus/pause/short-break/resume/focus exercise passed, but exact supported-version and side-effect matrices plus Windows proof remain unavailable. This external exception does not change the future first-party bridge guidance below.

## 7. Publish reliable HUD geometry

The outline needs the bounds of the real timer pill, not merely the outer `BrowserWindow`. That exact geometry is a required, separately negotiated `hud.geometry` capability; `hud.read` does not imply it. The geometry must expand when paused controls appear and change atomically when the HUD moves, changes display, scale, placement, mode, or visibility.

### Choose the measurement owner from evidence

Prefer the existing module that already computes the timer layout. If main-process code owns exact pill bounds, publish them from that owner. If only the trusted HUD renderer knows the DOM bounds, add one dedicated, schema-validated measurement path from that known HUD frame to the main facade, then fan out an authoritative HUD snapshot. Validate the sender with the same or stronger frame/origin checks as the existing HUD IPC.

Do not use screenshots, Accessibility APIs, OCR, fixed timer widths, or a second window's guessed position.

### Normalize coordinates exactly once

Inspect Promethee's current coordinate convention first. Define and test one bridge convention for:

- `x`, `y`, `width`, and `height` of the actual timer pill;
- display identifier and usable work area;
- scale factor;
- visibility, placement, and mode;
- layout revision and measurement time; and
- whether bounds are Electron device-independent pixels or physical pixels.

Prefer the coordinate unit already used consistently by Promethee's `BrowserWindow` and display-placement code. If renderer DOM measurements and screen coordinates use different units, convert at one named boundary and test the conversion at every supported scale. Never let the overlay guess which unit it received.

Publish geometry only after layout is stable. Coalesce intermediate drag/resize values if needed, but always publish the final value. Mark geometry unavailable and hide the overlay when the HUD is hidden, destroyed, stale, between displays without a valid mapping, or not measurable.

### Extra HUD width

The consuming outline and separate local handle reserve **zero** Promethee HUD width. Do not use extra width to recreate the rejected side-by-side Pomodoro timer or to embed the local handle in Promethee.

If a separately approved first-party label or affordance requires layout space, map `hud.reserve-space` to Promethee's existing bounded extra-width owner rather than modifying DOM width from Pomodoro code. Define units, minimum/maximum, ownership, and conflict behavior. Reset the reservation to zero when the feature hides, the renderer reloads, the bridge disconnects, or the connection closes. Emit a new HUD layout revision only after the applied width is reflected in measured bounds.

### Publish exclusions for the local handle and menu

ADR-0010 accepts a separate Pomodoro-owned interactive handle while keeping every outline pixel input-transparent. Promethee does not own or invoke the handle. The local window uses at least a `24px × 24px` pointer target with the approved `14–16px` Quiet Ember SVG centered inside it; it contains no persistent text, time, phase, or Play/Pause/Stop affordance.

Publish the exact [`HudExclusionsSnapshotV1`](../architecture/promethee-bridge-contract.md#hud-exclusion-schema-v1) and ordered `hud.exclusions.changed` variants for Promethee Tasks, reward/overtime, and other HUD transients. The snapshot always has a bounded `exclusions[]`; each entry owns `surfaceId`/`surfaceRevision`, while the read model and events carry coherent exclusion-set `revision`, `HudReadModel.revision`, exact `HudGeometry.layoutRevision`, coordinate space, and event watermark. Validate exact keys, unique IDs, bounded identifiers/arrays/rectangles, safe rectangle edges, monotonic/equal-identical revisions, current display/layout identity, and contiguous sequence before publishing or applying anything. One invalid member rejects the full set; never salvage apparently valid entries. Do not expose `BrowserWindow`, `webContents`, DOM nodes, selectors, native handles, focus objects, or arbitrary private identifiers.

Commit and publish a complete exclusion upsert before its host surface becomes visible or hit-testable. Independently keep the Promethee-owned Tasks/reward/overtime/transient window above every Pomodoro-owned interactive window with input precedence from its first possible interactive frame until after it stops being visible and hit-testable; publish removal only then. This is the delivery-latency fail-safe for `Accept`. If the current macOS or Windows window owner cannot prove that precedence, do not grant the local interactive capabilities on that target.

The local solver initially places the handle on the right at a `6px` HUD gap, retains its current side while the complete hit target fits within the `10px` work-area margin and current exclusions, and switches to the left before an edge or exclusion collision. If both right and left candidates are unsafe, queue one handle-presentation intent and hide the handle, menu, and tooltip; do not try top/bottom, clamp across the HUD, reuse old rectangles, or guess. Reappear only after a current cursor-contiguous snapshot or event with matching set/HUD/layout revisions provides a deterministic safe horizontal candidate. It uses exact running/paused bounds, display scale, multiple-display work areas, and negative virtual-desktop origins.

Handle activation and the keyboard fallback dispatch the same typed `toggle-pomodoro-menu` local action through a serialized local surface controller. That controller measures the menu and selects a safe above/below rectangle. A reward/overtime popup below forces the menu above; if neither side is safe, the controller keeps the current request queued and the menu hidden until a continuous update provides a safe rectangle. Invalid, stale, mismatched, or gapped exclusion state hides every local interactive window and may retain only that one current request until full rebootstrap. Escape/deactivation cancels it; disconnect or connection replacement clears exclusions, cancels all handle/menu intent, and cannot reopen the menu after reconnect. The input-transparent outline is independent: exclusion-only unavailability never makes it interactive, and it may remain visible only under its own current HUD-geometry gate. Promethee host precedence and applied exclusions together ensure the handle, menu, and optional tooltip never cover or intercept `Accept`; the tooltip appears only when its own rectangle is safe, while the localized accessible name is always present.

Keep host and local focus domains separate. Any opaque focus token and `hud.surface.release` behavior remains inside a Promethee-owned Tasks-slot lifecycle. The local handle/menu never requests host ownership, receives or stores a host focus token, or calls `hud.surface.request`/`hud.surface.release` to open or close. Nicolas approval and an authorized source map remain required for exclusion lifecycle implementation, even though local invocation is already accepted.

## 8. Preserve Electron security properties

Apply these controls in addition to Promethee's existing security policy:

- Keep `nodeIntegration` disabled, context isolation enabled, and sandboxing enabled for participating renderer windows unless an existing reviewed exception already governs them.
- Register fixed, namespaced operations; never accept a channel or method name from payload data.
- Validate sender window, frame, origin, connection ID, capability grant, schema, state precondition, and bounds before dispatch.
- Validate responses and events before exposing them through preload.
- Use exhaustive schemas with bounded strings, arrays, pagination, geometry, durations, and identifiers.
- Redact task titles and internal errors from routine diagnostics unless explicitly needed for a user-visible action.
- Keep tokens, cookies, credentials, Supabase sessions, database handles, file paths, and raw Electron objects out of the contract.
- Cancel subscriptions and revoke authority on reload, navigation, window destruction, app shutdown, or capability revocation.
- Treat timeouts and disconnects as indeterminate outcomes until authoritative reconciliation.

An in-process first-party module does not need a new localhost server or long-lived authentication token. If deployment later crosses a process boundary, stop and approve a separate transport threat model covering endpoint discovery, peer authentication, replay resistance, permissions, lifecycle, and firewall/installer behavior.

## 9. Prove the bridge vertically before product UI

Complete the stages in order. Record passed, failed, skipped, and unavailable evidence separately.

| Stage | Change | Exit evidence |
| --- | --- | --- |
| 0. Source map | No runtime behavior | Reviewed mapping from every logical role in this guide to actual path, symbol, owner, and test convention. |
| 1. Negotiation/read | Handshake and active-session snapshot | Capabilities and exact operation grants succeed; broad control, incompatible version, wrong sender, malformed payload, and missing capability fail closed. |
| 2. Session control | Pause one disposable session; exercise resume only when separately granted | Each granted command is acknowledged with authoritative state; duplicate ID is a no-op; start/stop/end are unavailable; lost acknowledgement reconciles without a second mutation. |
| 3. Live session events | Change the session through Promethee's real timer | Subscribe/snapshot cursor bootstrap loses no event; stopped/completed/replaced are observation-only; a forced sequence gap triggers a full refresh. |
| 4. Tasks | Snapshot plus live update | Stable IDs match Promethee's Tasks UI; rename/completion/deletion is reconciled without direct database access. |
| 5. HUD and host exclusions | Required `hud.geometry` plus exact `hud.exclusions.*` snapshots and live events | Exact pill bounds follow running and paused widths, drag, placement, display, scale, and visibility. Exact schemas, revision/watermark coherence, pre-interactive publication, post-interactive removal, Promethee host precedence during delivery, and invalid/stale/gap/disconnect failure behavior pass. |
| 6. Cross-platform bridge | Repeat stages 1–5 | Equivalent semantics pass on one supported macOS and one supported Windows environment. |
| 7. Pomodoro coordination | Connect the pure engine | Manual pause, focus deadline, acknowledged break, early play, stop, reconnect, and sleep/wake match the repository contracts and tests. |
| 8. Attached experience | Add outline, local handle, and surfaces | Real controls and the full outline remain click-through; the `24px` local handle opens through the serialized local controller; both-unsafe handle state queues/hides without guessing; Tasks/transients/`Accept` remain unobstructed during event latency; safe placement, keyboard fallback, and local focus pass on both platforms. |

A fake adapter currently validates the dependency-free portion of stage 7, but it cannot satisfy stages 0–6 or the real UI portion of stage 8. Static source inspection cannot satisfy a runtime stage.

## 10. Verify macOS and Windows explicitly

Use the Promethee repository's real test and packaging commands after inspecting them. Do not copy commands from this companion without confirming their scope and side effects.

### Shared bridge matrix

- Running, paused, and stopped sessions initiated from Promethee's real controls.
- Valid, invalid, duplicate, stale, timed-out, and reordered commands/events, including rejection of ungranted operations.
- Observed started, stopped, completed, and replaced states without any Pomodoro start/stop/end call.
- Subscribe/snapshot bootstrap at a known cursor and a forced event gap.
- Promethee renderer reload, HUD recreation, app restart, and bridge revocation.
- Task rename, completion, deletion, project movement, and snapshot refresh.
- HUD running and paused widths, every supported placement, each screen edge, multiple displays, and movement between displays.
- Exact/invalid/stale/gapped `hud.exclusions.*`; bounded `exclusions[]`; unique stable surface IDs and monotonic entry/set revisions; current/conflicting HUD/layout revisions and watermark; pre-interactive publication; post-interactive removal; Promethee host precedence while delivery is delayed; Tasks, reward/overtime, `Accept`, and other transient rectangles; right/left/both-unsafe handle placement and recovery; below-to-above menu reversal; no-safe queue/hide; disconnect without automatic reopen; local keyboard fallback.
- Scale changes, work-area changes, reduced motion, keyboard use, and assistive technology.
- Missing or incompatible capabilities and an unknown Promethee version.

### macOS-specific evidence

- Coordinate and scale behavior on supported Retina and non-Retina arrangements.
- Menu bar, Dock, full-screen space, and multi-display work-area changes relevant to the HUD.
- Input transparency and window level do not block Promethee controls or unrelated applications.
- App signing/notarization is release evidence, not a substitute for bridge behavior verification.

### Windows-specific evidence

- Per-monitor DPI changes while moving the HUD between displays.
- Taskbar work-area changes on every supported edge and auto-hide state used by the product.
- Transparent window hit testing and always-on-top behavior preserve Promethee control input.
- Display reconnect, sleep/wake, renderer restart, and packaged-app lifecycle retain the same contract semantics.
- Authenticode is release evidence, not a substitute for bridge behavior verification.

Record exact Promethee revision, Pomodoro revision, bridge protocol/capabilities, OS build, architecture, display scale/layout, and test result for every real-platform proof.

## Do not do these things

- Do not expose all of `window.promethee`, `ipcRenderer`, arbitrary IPC channels, or a generic invoke function.
- Do not grant broad session control; authorize pause and resume as separate operations.
- Do not expose or call Promethee start, stop, or end in safe v1.
- Do not make a private IPC channel public by removing its sender/origin guard.
- Do not call a renderer IPC handler from main-process integration code; call the owning service.
- Do not write Promethee SQLite or read arbitrary tables/content. ADR-0012 permits only `tasks`/`task_projects`; ADR-0013 permits only its eight minimal session fields. Neither observation may be used as authoritative command acknowledgement or automatic-retry authority.
- Do not copy Promethee access tokens, refresh tokens, cookies, session files, Supabase state, embedded keys, or credentials.
- Do not add a localhost server, fixed port, long-lived token, or unauthenticated named pipe merely to connect a companion.
- Do not infer session truth from button labels, screenshots, timing, or optimistic local state.
- Do not infer HUD bounds from a fixed size, screenshot, Accessibility tree, or the outer window when the timer is a smaller layout element.
- Do not use reserved HUD width to add the rejected side Pomodoro timer or the accepted local SVG handle.
- Do not make any outline pixel clickable or use it as the Pomodoro menu trigger.
- Do not infer Tasks/transient occupancy or place a local window across a host exclusion rectangle.
- Do not expose raw focus handles, Electron objects, DOM nodes, selectors, or private implementation identifiers as focus-return tokens.
- Do not apply a Promethee-owned Tasks-slot focus token or release operation to the local handle/menu lifecycle.
- Do not let the handle, menu, or tooltip overlap or intercept a reward/overtime popup or its `Accept` action.
- Do not start break before Promethee pause is acknowledged or reconciled as already paused.
- Do not let a Ready action start or resume Promethee without an explicit later-granted operation; tell the user to press real Play when it is absent.
- Do not add a duplicate Pomodoro play/pause control.
- Do not complete or edit a task as a side effect of a Pomodoro transition.
- Do not claim Windows or macOS support from mocks, source inspection, screenshots, or CI configuration alone.
- Do not publish, sign, install dependencies, or migrate repositories as an incidental part of the bridge change.

## Completion checklist

- [ ] Every placeholder role is mapped to an inspected Promethee path, symbol, owner, and test.
- [ ] The chosen first-party integration location follows existing package and lifecycle conventions.
- [ ] The bridge facade calls authoritative services and exposes no raw internal transport.
- [ ] Negotiation gates every dependent capability and exact mutating operation and fails closed.
- [ ] Safe v1 exposes no start, stop, or end command; terminal states are observation-only and still return Pomodoro to idle.
- [ ] Commands are typed, idempotent, acknowledged, and reconcilable.
- [ ] Snapshots carry an event cursor and the subscribe/snapshot bootstrap cannot lose an event.
- [ ] Events are typed, ordered per connection, revisioned, and refreshable after gaps.
- [ ] Tasks use stable IDs and the same eligibility semantics as Promethee's UI.
- [ ] Required `hud.geometry` represents the real timer at running and paused widths in a documented coordinate unit.
- [ ] Nicolas approves `hud.exclusions.*`, and the upstream Tasks/transient/`Accept`/layout owners and lifecycle are mapped.
- [ ] Exclusion snapshots/events match the exact v1 schemas with bounded `exclusions[]`, unique per-entry surface/revision identity, coherent set/HUD/layout revisions, display/coordinate identity, valid rectangles, and continuous watermark.
- [ ] Promethee publishes exclusions before host interactivity, retains z-order/input precedence throughout delivery, and publishes removal only after interactivity ends; a local window never covers or intercepts `Accept`.
- [ ] The full outline is input-transparent; the separate handle is at least `24px × 24px`, keeps the original `14–16px` SVG, and has no persistent status or session control.
- [ ] Local handle/menu focus and serialized invocation use no host focus token, `hud.surface.request`, or `hud.surface.release`.
- [ ] Tasks, reward/overtime, `Accept`, safe reversal, both-unsafe handle queue/hide/recovery, stale/gap queue/hide, tooltip safety, keyboard fallback, and disconnect cleanup pass without guessed placement, overlap, or automatic menu reopen.
- [ ] Extra width is zero for the outline and any approved reservation is bounded and lifecycle-reset.
- [ ] Preload exposure is narrow; sender, origin, schema, and capability checks pass.
- [ ] No direct database, credential, private external IPC, Accessibility, or screen-scraping fallback exists.
- [ ] The vertical proof passes on supported macOS and Windows environments.
- [ ] Repository contracts and validation evidence are updated without marking unavailable checks as passed.

## Maintenance trigger

Review this guide when Promethee changes its Electron security configuration, main/preload/renderer layout, session service, task identity, HUD layout, coordinate model, IPC validation, or extension mechanism. Once the real source map is approved, replace angle-bracket placeholders with links to Promethee-owned documentation or generated contract reference; do not copy private implementation details into this repository when a stable upstream link can serve as the source of truth.
