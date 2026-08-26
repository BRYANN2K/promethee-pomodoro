---
id: ADR-0005
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
amended_by: [ADR-0010]
---

# ADR-0005: Render progress as a consuming outline around the real HUD

> **Accepted, as amended by [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md).** The consuming-outline decision remains current. ADR-0010 supersedes this record's original single-slot/mutual-exclusion rule and every clause that made Promethee Tasks a surface measured, moved, resized, or reversed by this application. Promethee-owned surfaces remain unchanged and may coexist with the local Pomodoro menu; current host exclusions govern local interactive placement, and the handle/menu/tooltip stay queued and hidden when unsafe. Any older statement below that hides the outline solely because exclusions are unavailable is superseded: the outline remains wholly input-transparent and its visibility is governed independently by current HUD geometry.

## Context and problem

Promethee already renders a compact, movable session HUD whose width changes when paused and whose task panel may open above or below it near a screen edge. Earlier concepts added a Pomodoro pill beside the timer, which competed for scarce space and looked like a separate product. The accepted direction is a discreet layer that surrounds the real timer, consumes as focus or break time elapses, and adapts to the real HUD rather than replacing or extending it.

This behavior requires measured geometry, collision handling, and failure-safe presentation on macOS and Windows.

## Scope and non-goals

This decision covers the compact progress outline, break label, timer attachment, local-menu placement around host exclusions, and missing-geometry behavior. Promethee's Tasks, reward/overtime, and other transient surfaces remain outside local layout ownership. This decision does not define the full settings UI, Promethee's own HUD internals, or a notch-specific presentation. A standalone notch mode is explicitly outside scope.

## Decision drivers

- Preserve the real Promethee timer and its controls.
- Communicate remaining focus and break time with minimal additional visual weight.
- Follow the HUD when its size, state, placement, display, or authoritative host occupancy changes.
- Remain usable near every screen edge without moving or resizing Promethee-owned surfaces.
- Avoid intercepting interaction intended for Promethee.

## Constraints

- The overlay must never cover or impersonate Promethee controls.
- Geometry must come from an approved Promethee bridge; guessed or stale coordinates are not sufficient to display the outline.
- The outline starts complete and consumes toward empty for both focus and break.
- Paused HUD width, including the additional stop control, must be measured rather than hard-coded.
- The local menu may coexist with Promethee Tasks and transient surfaces only in a safe, non-overlapping rectangle derived from authoritative host exclusions.
- When neither vertical side is safe, the local menu request must remain queued and hidden; the application must not move, resize, reverse, or scroll a Promethee-owned surface.
- Reduced-motion and accessibility settings must be respected.

## Considered options

1. Draw a separate transparent, non-invasive consuming outline around the measured real HUD.
2. Add a separate Pomodoro pill beside the Promethee timer.
3. Replace or skin the Promethee HUD with a Pomodoro-controlled window.
4. Show Pomodoro progress only in an independent window or menu as the status quo fallback.

## Decision

We will **render Pomodoro progress as a separate, transparent outline fitted to the current bounds of the real Promethee HUD**. The outline begins fully drawn and consumes continuously toward zero for focus and break. It follows HUD movement, display changes, placement changes, and width changes. The complete outline remains input-transparent; Pomodoro-owned affordances use distinct windows outside Promethee controls.

The local Pomodoro menu uses its own measured dimensions, exact HUD geometry, the usable display, and authoritative rectangles for Promethee Tasks and transient host surfaces. It prefers the configured side, reverses above/below only for its own placement, and may coexist with host surfaces when the selected rectangle is safe. If neither side is safe, the local request remains queued and the menu stays hidden. The application never measures Promethee content to control its layout and never moves, resizes, reverses, or scrolls a host-owned surface. If exclusion state is missing, stale, discontinuous, or invalid, local interactive handle/menu/tooltip windows hide instead of guessing; the wholly input-transparent outline remains governed separately by current HUD geometry.

## Rationale

An outline adds phase information without duplicating the timer or widening Promethee's footprint. Measuring the actual HUD is necessary because running and paused layouts differ and the HUD can move. A side pill recreates the visual and collision problems rejected in review. Replacing Promethee's HUD violates the single-control authority and would require ownership of controls that remain Promethee's responsibility. An independent window is safer than guessed attachment but fails the requested quasi-native integration.

## Option comparison

| Driver | Consuming outline | Side pill | Replacement HUD | Independent window | Evidence |
|---|---|---|---|---|---|
| Preserves real controls | Yes | Yes, but competes beside them | No | Yes |
| Minimal footprint | Fits existing bounds | Adds width | Similar bounds but duplicates UI | Adds another surface | Screenshot review and accepted direction |
| Dynamic HUD width | Fits measured geometry | Must reposition and collide | Owns a duplicate layout | Unrelated | Observed paused/running screenshots |
| Edge/host-surface handling | Local placement avoids authoritative exclusions | Higher collision risk | Requires reimplementing all behavior | Independent | ADR-0010 and design analysis |
| Failure safety | Hides without geometry | Can float incorrectly | Can misrepresent Promethee | Remains independent | Accepted constraint |

## Consequences

### Positive

- Focus and break progress read as part of the existing HUD without replacing it.
- The design adapts to running/paused widths and screen-edge placement.
- Local placement explicitly avoids host-owned Tasks and transient surfaces without changing them.
- Promethee retains control ownership and hit testing.

### Negative

- Reliable HUD bounds and state events become prerequisites for the primary UI.
- Transparent always-on-top windows require platform-specific behavior and multi-display testing.
- Pixel alignment, scaling, occlusion, animation cadence, and input transparency create a meaningful QA surface.

### Neutral

- The overlay is a separate window even when it visually appears attached.
- Branding colors are presentation tokens and may be refined without changing the decision if semantics and contrast remain intact.

## Implementation and migration

1. Define a platform-neutral geometry model for HUD bounds, usable display bounds, scale, placement, local-menu bounds, and authoritative host exclusions.
2. Obtain current geometry and events through the typed adapter, including running/paused width changes.
3. Implement a deterministic local-menu placement function that reverses only the local menu and returns queued-and-hidden when neither side is safe.
4. Render a non-interactive outline whose visible path is derived from normalized remaining progress.
5. Apply Promethee-derived focus styling and break styling; the current reference tokens are focus orange `#DB8057`, break outline `#A6A5A3`, and break label/play accent `#CC794F`, subject to contrast validation.
6. Add platform windows only after geometry tests cover multi-display, scale, every edge, variable local-menu height, Tasks/transient exclusions, no-safe queue/hide, and invalid bounds.

## Validation

- Visual tests verify full, half, near-zero, and zero progress in focus and break.
- Geometry tests cover running and paused HUD widths, all screen edges, scale factors, multiple displays, variable local-menu height, coexistence with host exclusions, safe reversal, and no-safe queue/hide decisions.
- Ownership tests prove that local placement never moves, resizes, reverses, or adds scrolling to Promethee Tasks or transient surfaces.
- Interaction tests show that clicks on real Promethee controls reach Promethee unchanged.
- Disconnect, stale-event, and invalid-geometry tests hide the overlay.
- Real UI checks on macOS and Windows compare the overlay against the measured timer at running and paused widths.
- Accessibility review covers contrast, reduced motion, screen-reader labeling of owned affordances, and keyboard access to the local handle and menu.

## Revisit triggers

- Promethee provides a supported in-HUD extension slot that can render the same semantics more safely.
- Reliable HUD geometry is unavailable on either supported operating system.
- Measured overlay latency or jitter makes the outline visibly detach under normal HUD movement.
- Accessibility testing shows the visual-only outline cannot communicate required phase state without a different compact surface.
- Promethee materially redesigns its HUD shape, controls, or panel attachment model.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none.
- Amended by: [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md), which adds a separate local SVG handle, keeps the outline fully input-transparent, and supersedes this record's original single-slot/mutual-exclusion and host-surface-placement clauses with authoritative exclusions plus safe coexistence or local queue/hide.
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md), [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md), [ADR-0003](0003-keep-the-pomodoro-engine-pure-and-deterministic.md).
- Related: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Implemented by: the current Electron overlay, handle/menu, runtime planning source, and tests.
- Evidence: supplied Promethee running, paused, and task-panel screenshots; retained calibration in [`promethee-visual-calibration.md`](../../design/promethee-visual-calibration.md); current Electron source/tests; and accepted product feedback. ADR-0018 retired the obsolete preview artifacts.
