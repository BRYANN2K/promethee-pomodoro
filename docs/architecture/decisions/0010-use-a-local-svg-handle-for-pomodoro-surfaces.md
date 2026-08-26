---
id: ADR-0010
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0010: Use a local SVG handle for Pomodoro surfaces

## Context and problem

The consuming outline around Promethee's real HUD must remain fully input-transparent, but the Pomodoro menu still needs a small, discoverable, keyboard-accessible trigger. ADR-0009 proposed putting that trigger and the complete Tasks/menu ownership lifecycle inside Promethee. That proposal would make local menu invocation depend on an upstream HUD change and would apply Promethee-owned focus-return semantics to a Pomodoro-owned surface.

The project owner has instead approved a separate local handle. Promethee still owns its Tasks and transient surfaces, including reward and overtime popups with an `Accept` action. The Pomodoro process cannot safely infer those host rectangles from screenshots, timing, or window proximity, so upstream occupancy evidence remains necessary even though invocation is local.

## Scope and non-goals

This decision governs the local handle, its placement beside the real HUD, local menu invocation, collision behavior with host surfaces, focus ownership, and the bridge data needed to avoid host UI. It does not make the progress outline interactive, add a Pomodoro timer or phase label beside the HUD, duplicate Play/Pause/Stop, authorize Promethee source changes, or define the visual treatment beyond the approved Quiet Ember asset and minimum interaction geometry.

## Decision drivers

- Preserve full input transparency for every outline pixel.
- Provide a visible pointer target and an accessible keyboard path without changing Promethee's session controls.
- Keep the closed presentation materially smaller than the rejected side timer.
- Follow exact running and paused HUD bounds across displays and screen edges.
- Never overlap or intercept Promethee Tasks, a reward/overtime popup, or its `Accept` control.
- Keep local window focus and Promethee-owned focus-return semantics in separate ownership domains.
- Fail closed when geometry or host occupancy is missing, stale, discontinuous, or disconnected.

## Constraints and blockers

- The handle is a separate Pomodoro-owned interactive window. It is not part of the outline window and does not enlarge Promethee's HUD.
- Its pointer hit target is at least `24px × 24px`; the centered Quiet Ember SVG remains its original `14–16px` visual size.
- The closed handle contains no persistent text, remaining time, phase, cycle state, or session control.
- The default HUD-to-handle gap is `6px` and the work-area safe margin is `10px`. A later explicitly approved design source may revise those values, but implementation and contracts must change together.
- Exact running and paused timer-pill bounds, display work area, scale, visibility, and `HudGeometry.layoutRevision` come from the approved bridge.
- Host Tasks and transient occupancy cannot be inferred locally. Promethee-owner Nicolas approval and an authorized upstream source map remain blockers for the required exclusion snapshot/event implementation.
- No Pomodoro-owned interactive window may be placed above a Promethee-owned interactive HUD or transient window. The upstream source map must identify the window-level and hit-testing owner that proves this precedence on each platform.

## Considered options

1. Use a separate local SVG handle and authoritative host exclusion rectangles.
2. Keep ADR-0009's Promethee-owned HUD disclosure trigger and shared Tasks/menu slot.
3. Make some or all of the consuming outline clickable.
4. Use only a global keyboard shortcut or independent tray control.
5. Ship no attached Pomodoro menu.

## Decision

We will **render a separate local SVG-only Pomodoro handle adjacent to the real Promethee HUD**. The outline remains a distinct, fully input-transparent window. The handle owns only its minimum `24px × 24px` hit target and centers the original `14–16px` Quiet Ember SVG. It shows no persistent text, time, phase, badge, or duplicate Play/Pause/Stop control.

The placement solver uses exact current HUD bounds and the active display's work area in the bridge's declared coordinate unit. The initial preference is the right side at a `6px` gap. It retains its current side while the complete hit target fits within the `10px` safe margin and does not intersect a current host exclusion. Before crossing the work-area edge or an exclusion, it tries the left side. Once switched, it retains that side while it remains safe to avoid oscillation. If both right and left candidates are unsafe, the controller records one queued handle-presentation intent and keeps the handle, menu, and tooltip windows hidden; it does not try an unapproved top/bottom position, clamp across the HUD, reuse last-known bounds, or guess. A current cursor-contiguous snapshot or event at matching HUD and exclusion revisions may satisfy that queued intent and reveal the handle at the first deterministic safe side. The same rules apply with paused-expanded HUD bounds, multiple displays, scale changes, and negative virtual-desktop origins.

Activating the handle dispatches one typed local `toggle-pomodoro-menu` action through the serialized local surface controller. That controller owns the local handle/menu focus lifecycle, request identity, measurement, placement, Escape/outside dismissal, and cancellation. It does not invoke the cycle engine or Promethee bridge directly and does not send a Promethee session command.

Promethee publishes host occupancy through these exact read-only bridge capabilities:

| Contract item | Semantics |
| --- | --- |
| `hud.exclusions.read` | Read current host-owned exclusion rectangles relevant to HUD attachment. |
| `hud.exclusions.events` | Receive ordered `hud.exclusions.changed` events. |
| `hud.getExclusions` | Return a cursor-bearing exclusion snapshot. |
| `hud.exclusions.changed` | Publish an authoritative exclusion upsert, removal, or refresh marker. |

The exact v1 read model is a versioned snapshot envelope whose `value` contains an exclusion-set `revision`, the matching HUD `hudRevision`, the referenced `layoutRevision`, coordinate space, and an `exclusions[]` array. Every array entry owns its stable opaque `surfaceId` and monotonic `surfaceRevision` and repeats the exact `layoutRevision`, display identity, bounded role, and screen-coordinate rectangle. `atSequence` is the snapshot watermark. Events carry the next connection-scoped sequence plus the resulting set/HUD/layout revisions and one exact upsert, removal, or refresh-required change. Duplicate surface IDs, unknown keys or roles, non-finite or non-positive bounds, revision regression, a watermark gap, or any HUD/layout/display mismatch invalidates the complete exclusion state; partial entries are never applied. The [bridge contract](../promethee-bridge-contract.md) is the canonical field-level schema.

Promethee must commit and publish the complete exclusion upsert before the corresponding host surface can become visible or hit-testable. Because event delivery is asynchronous, the Promethee-owned interactive window must also retain z-order and input precedence over every Pomodoro-owned interactive window from its first possible interactive frame until it is no longer visible or hit-testable; only then may the bridge publish removal. A target that cannot prove that host precedence keeps `Accept` reachable during delivery latency cannot enable the local handle/menu capability. The local handle, menu, and tooltip are never above or visually covering `Accept`, even transiently.

The local surface controller measures the menu and selects only rectangles that stay inside the safe work area, avoid the real HUD and every current exclusion, and preserve the attachment gap. A reward or overtime popup below the HUD therefore forces the menu above when the upper rectangle is safe. The controller never covers or intercepts the popup or `Accept`. If neither side is safe, it queues the current local request and keeps the menu hidden until a continuous exclusion/geometry update makes a rectangle safe; Escape or deactivation cancels the request. A stale revision, cursor gap, or exclusion reconciliation hides every local interactive window and may retain only that one queued request until a complete matching snapshot is live. Disconnect or connection replacement hides those windows, clears exclusions, and cancels both handle and menu intent, so reconnect cannot reopen the menu. The outline remains a separate wholly input-transparent layer: exclusion-only unavailability never makes it interactive, and it may remain visible only while its own HUD geometry is independently current.

The handle always exposes a localized accessible name. A pointer tooltip is optional and appears only when its measured tooltip rectangle is also exclusion-safe; accessibility never depends on the tooltip. A configurable local keyboard shortcut may dispatch the same serialized local action as a fallback, but it cannot bypass geometry, occupancy, or placement checks.

Promethee's opaque focus-return token and `hud.surface.release` contract remain scoped to a Promethee-owned Tasks-slot lifecycle. The local handle and local Pomodoro menu do not request a host slot, never identify themselves as a host surface owner, do not receive or store a host focus token, and never call `hud.surface.release` or `hud.surface.request` for local invocation.

## Rationale

The local handle provides a concrete pointer target without violating the outline's hard input-transparency rule or requiring a Promethee-owned trigger. Restricting it to a small SVG and transparent hit padding distinguishes it from the rejected second timer. Authoritative exclusion rectangles retain the one fact only Promethee can supply: where its interactive Tasks and transient surfaces actually occupy the screen. Separate local focus ownership prevents a host token from becoming an accidental cross-process window handle.

## Option comparison

| Driver | Local SVG handle | Promethee-owned trigger | Clickable outline | Shortcut/tray only | No menu |
| --- | --- | --- | --- | --- | --- |
| Outline remains input-transparent | Yes | Yes | No | Yes | Yes |
| Visible local invocation | Yes | Requires upstream trigger | Visually ambiguous | No | No |
| Avoids host UI | Yes, with exclusions | Host arbitrates | Requires same exclusions | Requires same exclusions for menu | Yes |
| Focus boundary | Local and explicit | Host token/slot | Mixed window ownership | Local but less discoverable | None |
| Upstream dependency | Exclusion events only | Trigger, slot, and focus lifecycle | Exclusion events | Exclusion events | None |
| Session-control duplication | No | No | Risk of implied control | No | No |

## Consequences

### Positive

- Menu invocation no longer depends on adding a Promethee disclosure item.
- The outline stays entirely click-through.
- The trigger remains visually minimal and cannot be mistaken for a second timer.
- Local and Promethee-owned focus lifecycles have explicit, non-overlapping contracts.
- Tasks, reward, overtime, and future transient host surfaces share one exclusion model.

### Negative

- A second interactive top-level window adds platform window-level, focus, hit-testing, and accessibility work.
- The handle can disappear while geometry or exclusions are unavailable, and an activation can remain queued while no safe menu rectangle exists.
- Promethee must still expose authoritative occupancy events before the attached experience can pass real integration proof.

### Neutral

- The handle is adjacent to the HUD but is not a Promethee extension slot or reserved HUD width.
- The keyboard shortcut is a fallback and still obeys the same safe-placement gate.
- Visual refinements remain design-gated and do not change the bridge ownership model.

## Implementation and migration

1. Mark ADR-0009 Superseded and remove its Promethee-owned trigger/Pomodoro-menu slot assumptions from active contracts.
2. Map the exact Promethee owners for Tasks, reward/overtime, other HUD transients, `HudGeometry.layoutRevision`, and screen-coordinate conversion.
3. Obtain Nicolas's approval for the read-only exclusion capability/event and upstream lifecycle semantics.
4. Add cursor-bearing exclusion types and contract tests without exposing native window, DOM, or focus handles.
5. Implement pure side-retention and safe-rectangle solvers before creating platform windows.
6. Implement the handle and local surface controller only after the approved design artifacts permit product UI work.
7. Prove geometry, exclusions, focus, hit testing, tooltips, keyboard fallback, and failure behavior on supported macOS and Windows systems.

## Validation

- The outline window has no interactive region; the separate handle hit target is at least `24px × 24px` and the SVG remains `14–16px`.
- The handle contains no persistent text/time/phase and no Play/Pause/Stop control.
- Running and paused HUD fixtures prove right preference, side retention, pre-edge left switch, `6px` gap, `10px` margin, scale, multi-display, and negative-origin behavior.
- Missing, stale, gapped, invalid, or disconnected geometry/exclusions hide the handle and menu.
- When both horizontal handle candidates are unsafe, the handle stays queued and hidden with no guessed fallback, then reappears only after a current matching snapshot or event provides a safe candidate.
- Tasks and transient exclusion fixtures use stable surface/revision identity tied to exact `HudGeometry.layoutRevision`.
- Exact-key schema tests reject malformed arrays, duplicate surface IDs, unknown roles/keys, invalid bounds, revision or watermark regression, and HUD/layout/display mismatch without applying a partial snapshot.
- A reward/overtime popup below places the menu above; no-safe-rectangle keeps it hidden and queued.
- Publication-order, pointer, and z-order tests prove the exclusion exists before the popup is interactive and Promethee retains input precedence during delivery, so the handle, menu, and tooltip never cover or intercept the host popup or `Accept`.
- The accessible name is present without a tooltip; tooltip and keyboard fallback cannot bypass exclusion checks.
- Local invocation sends no `hud.surface.request`, `hud.surface.release`, session start/resume, or duplicate session-control command.
- Equivalent behavior passes with real Promethee on supported macOS and Windows environments.

## Revisit triggers

- Promethee exposes a supported first-party extension slot that provides the same local invocation and exclusion guarantees with less windowing risk.
- Real platform testing cannot maintain a stable adjacent hit target without covering host interaction.
- The approved design source changes the SVG, gap, safe margin, or minimum hit target.
- Promethee cannot expose reliable exclusion rectangles for Tasks and transient HUD surfaces.
- Accessibility testing shows the local handle cannot provide a discoverable, operable path.

## Related decisions and evidence

- Supersedes: [ADR-0009](0009-let-promethee-own-attached-surface-invocation.md).
- Superseded by: none.
- Amends: [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md), limited to the separate interactive handle and host-exclusion model.
- Depends on: [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md), [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), and [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Implemented by: the current Electron handle/menu/runtime planning source and tests.
- Evidence: project-owner approval in the current product direction, supplied HUD/Tasks/transient-popup screenshots, and the design-system values referenced by the existing design artifacts. No upstream exclusion source map or real macOS/Windows proof is available.
