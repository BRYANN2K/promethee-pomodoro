---
id: ADR-0009
status: superseded
date: 2026-08-25
deciders: [project-owner, promethee-owner]
consulted: []
informed: []
---

# ADR-0009: Let Promethee own attached-surface invocation

> **Superseded by [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md).** This proposal was never accepted. ADR-0010 instead accepts a separate local handle and retains Promethee cooperation only for authoritative host exclusion rectangles.

## Context and problem

The accepted outline is a separate transparent window fitted around Promethee's real timer. It must be input-transparent across its complete bounds so pointer, keyboard, and accessibility interaction reaches Promethee unchanged. The Pomodoro menu still needs a discoverable trigger, mutual exclusion with Promethee's Tasks surface, and deterministic focus return.

The current contracts describe an “approved attached-surface invocation” but do not identify who owns it. Making the outline clickable would contradict its hit-testing contract. Adding another permanent button beside the timer would recreate the rejected side extension and could be mistaken for a second session control. A host-level ownership decision is therefore required before the menu or attached-surface coordinator can be implemented.

## Scope and non-goals

This proposal governs how the Pomodoro menu is requested, how Promethee Tasks and the Pomodoro menu share one timer-attached slot, how geometry and ownership revisions relate, how focus returns, and how disconnects revoke ownership. It does not authorize a Promethee code change, select private filenames or IPC channels, make the outline interactive, add a session Play/Pause/Stop control, or define the future Ready-surface owner.

## Decision drivers

- Keep the entire outline input-transparent.
- Put the primary trigger where users already interact with Promethee's real HUD.
- Let the owner of Promethee Tasks arbitrate attached-surface exclusivity.
- Avoid exposing raw Electron windows, DOM nodes, focus objects, or private channels.
- Preserve deterministic behavior across process boundaries, reconnects, macOS, and Windows.
- Provide a complete keyboard and focus-return path without a second primary trigger.

## Constraints and blockers

- Promethee owns the real HUD disclosure, Tasks surface, focus behavior, and session controls.
- The Pomodoro process cannot infer whether Promethee Tasks is open from geometry or screenshots.
- An ownership event must reference the exact `HudGeometry.layoutRevision` used for placement.
- A bridge read/event capability grants no operation authority.
- Acceptance and implementation are blocked until the project owner and Promethee owner Nicolas approve the trigger location and ownership semantics.
- Implementation is also blocked until an authorized Promethee source review maps the real HUD disclosure/menu, Tasks-surface controller, focus manager, `HudGeometry.layoutRevision`, and lifecycle owner to concrete upstream paths and symbols.

## Considered options

1. Add a Promethee-owned Pomodoro item to the real HUD disclosure/menu and let Promethee arbitrate the attached slot.
2. Use another explicit Promethee-owned host trigger that emits the same typed ownership event when the HUD disclosure cannot host the item.
3. Let a Pomodoro global keyboard shortcut request the slot from Promethee.
4. Put a clickable affordance in the transparent outline.
5. Add an independent tray, side pill, or permanent companion trigger.
6. Leave the menu without an invocation contract.

## Proposed decision

We propose to **make Promethee the authority for primary attached-surface invocation and ownership**. The preferred trigger is a Pomodoro item in Promethee's real HUD disclosure/menu. If the Promethee owner rejects that placement after source review, another Promethee-owned control may emit the same explicit host event. In either case, the outline remains fully input-transparent and contains no trigger.

Promethee owns a single timer-attached slot for the v1 owners `none`, `promethee.tasks`, and `promethee-pomodoro.menu`. Activating the real Promethee trigger atomically closes or revokes Tasks when necessary, assigns the slot to the Pomodoro menu, increments the surface revision, and publishes the authoritative state. Opening Tasks performs the inverse transition. The Pomodoro window host renders only while it owns the slot; it does not independently decide to open over Tasks.

The proposed bridge extension is:

| Contract item | Semantics |
| --- | --- |
| `hud.surface.read` | Read the authoritative attached-slot snapshot. |
| `hud.surface.events` | Receive ordered `hud.surface.changed` events. |
| `hud.surface.release` | Mandatory exact operation grant for an interactive Pomodoro menu, allowing the current owner to release its slot and optionally request focus return. |
| `hud.surface.request` | Optional exact operation grant for an accessibility keyboard fallback; it is not required for the primary host trigger. |

The snapshot and `hud.surface.changed` payload contain the connection ID, event cursor, monotonic `surfaceRevision`, referenced `HudGeometry.layoutRevision`, owner, request ID, cause, and an optional opaque connection-scoped `focusReturnToken`. The token identifies a Promethee-owned return target without exposing an OS handle, Electron object, DOM node, selector, or private implementation identifier. Interactive menu readiness requires `hud.surface.read`, `hud.surface.events`, and the exact `hud.surface.release` grant; the menu must not open when any one is absent.

On Escape, explicit dismissal, or presentation failure, the menu releases the current `surfaceRevision`. The release input carries `focusReturnToken` as optional or `null`. When the exact operation is authorized for the current connection and slot revision, Promethee must release ownership even when the token is absent, invalid, expired, or no longer resolves; only focus restoration is skipped. A valid opaque token restores focus only when the original trigger still exists and host policy permits it. If Tasks replaces the menu, Tasks owns the next focus target. A disconnect, connection replacement, mismatched `HudGeometry.layoutRevision`, or ownership revision gap closes the menu, clears the token, and prevents automatic reopening; a fresh explicit host invocation is required after reconciliation.

A configurable keyboard shortcut may call `hud.surface.request` only when that exact operation is negotiated and accessibility review approves its conflicts and discoverability. It remains a fallback, not the primary or only route.

## Rationale

Promethee is the only component that can authoritatively know when its disclosure trigger and Tasks surface exist, which surface owns focus, and whether a transition is valid. Reusing that ownership boundary makes exclusivity atomic instead of attempting to coordinate two windows through timing. A typed state event keeps companion and in-process deployments semantically equivalent. A clickable outline fails a hard input-transparency constraint. A companion-only trigger weakens the quasi-native experience and cannot safely arbitrate Promethee Tasks without the same host contract.

## Option comparison

| Driver | HUD disclosure item | Other host trigger/event | Keyboard fallback | Clickable outline | Independent trigger | No contract |
| --- | --- | --- | --- | --- | --- | --- |
| Input-transparent outline | Preserved | Preserved | Preserved | Violated | Preserved | Preserved |
| Tasks arbitration | Host-authoritative | Host-authoritative | Requires host request | Race-prone | Requires host request | Undefined |
| Discoverability | Highest in existing HUD | Depends on approved location | Low | Visually subtle | Separate product surface | None |
| Focus return | Host-owned token | Host-owned token | Host-owned token | Cross-window ambiguity | Cross-window ambiguity | Undefined |
| Cross-platform semantics | One typed contract | Same typed contract | Same optional operation | Platform hit-test differences | Platform-specific shell UX | Not implementable |
| Ownership evidence | Requires upstream mapping and approval | Requires upstream mapping and approval | Also needs shortcut review | Contradicts accepted contract | Adds new product surface | Blocks menu |

## Consequences

### Positive

- The outline remains minimal and click-through without losing menu discoverability.
- Promethee Tasks and the Pomodoro menu have one authoritative owner and revision stream.
- Focus restoration stays inside the application that owns the real trigger.
- The same contract supports an in-process module and an authenticated companion.

### Negative

- The menu cannot ship independently of a Promethee-owned trigger and upstream implementation.
- The bridge gains new HUD state, event, and non-session operation semantics that require protocol review and tests.
- Promethee must maintain an integration item or equivalent host event in its HUD lifecycle.

### Neutral

- The local attached-surface coordinator still measures, flips, clamps, and renders the owned Pomodoro window; it is no longer the authority that chooses between Tasks and menu.
- The keyboard shortcut remains optional and may be omitted without removing the primary path.
- Ready ownership remains a separate later contract amendment.

## Implementation and migration

1. Map the authorized Promethee revision's HUD disclosure/menu, Tasks controller, focus manager, attached-window lifecycle, and `HudGeometry.layoutRevision` owner to upstream paths and symbols.
2. Obtain explicit approval from the project owner and Nicolas in the Promethee-owner role; keep this ADR Proposed until both approve.
3. Review whether the bridge protocol version must change for `hud.surface.*` capabilities, operations, snapshot, and event payloads.
4. Implement Promethee-side atomic ownership and the real trigger without weakening existing renderer/origin checks.
5. Implement client-side ownership mirroring, `HudGeometry.layoutRevision` reconciliation, mandatory release readiness, optional/null focus-return input, and disconnect cleanup.
6. Exercise the same trigger, Tasks replacement, dismissal, focus, and disconnect matrix on supported macOS and Windows environments.

## Validation

- Source-map evidence identifies the actual upstream owners and lifecycle order; screenshots or private channel strings are insufficient.
- Pointer tests prove the whole outline remains input-transparent, including its perimeter.
- One activation of the real Promethee trigger produces one ordered ownership transition tied to current geometry.
- Opening Tasks while the menu is open revokes the menu before Tasks accepts interaction; the reverse transition is also atomic.
- The menu never opens without exact `hud.surface.release` authority.
- Escape and explicit dismissal always release current authorized ownership; a valid opaque token may return focus, while an absent, `null`, invalid, expired, or unresolved token skips only focus restoration.
- `HudGeometry.layoutRevision` mismatch, event gap, disconnect, HUD destruction, and connection replacement close the menu without automatic reopen.
- The keyboard path, if shipped, is tested as a fallback and cannot bypass the exact `hud.surface.request` grant.
- Equivalent behavior passes on supported macOS and Windows environments.

## Revisit triggers

- Promethee adds a supported first-party HUD extension slot with its own trigger and ownership API.
- Source review shows the real HUD disclosure and Tasks surface do not share an ownership boundary.
- Nicolas or the project owner rejects the proposed trigger location or event semantics.
- Platform focus policies cannot safely restore focus through a host-owned token.
- Ready becomes an interactive attached surface that must join the same owner union.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: [ADR-0010](0010-use-a-local-svg-handle-for-pomodoro-surfaces.md).
- Proposes an amendment to: [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md), limited to invocation and surface ownership.
- Depends on: [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md) and [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Related: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md).
- Specified by: the historical host-owned invocation proposal; superseded by ADR-0010.
- Evidence: supplied Promethee HUD screenshots, retained calibration/current Electron source, and the unresolved trigger boundary. ADR-0018 retired the obsolete preview artifacts. No upstream source map or runtime proof is available.
