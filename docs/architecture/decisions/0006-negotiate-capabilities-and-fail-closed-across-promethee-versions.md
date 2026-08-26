---
id: ADR-0006
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0006: Negotiate capabilities and fail closed across Promethee versions

> **Amendment note:** [ADR-0014](0014-compose-the-external-promethee-bridge.md) accepts an external profile with exact path/schema/UI compatibility, freshness/unknown states, and non-authoritative action outcomes. It does not weaken fail-closed behavior or create command acknowledgement/retry authority.

## Context and problem

The integration is initially informed by a static analysis of Promethee 1.3.26, while the installed product and future releases can differ. Private handler names or payloads are not a compatibility promise. Pomodoro features depend on different subsets of session, task, HUD geometry, and event behavior, so one application-version check is too coarse and optimistic calls are unsafe.

We need a compatibility rule that prevents unsupported automation while allowing independent features to degrade visibly and safely.

## Scope and non-goals

This decision covers bridge handshake data, capability identifiers and versions, compatibility policy, degraded behavior, and version-matrix evidence. It does not promise support for a particular future Promethee version and does not define the transport authentication mechanism selected under ADR-0002.

## Decision drivers

- Never issue a state-changing command against an unknown semantic contract.
- Detect compatibility before showing an integration-dependent feature as available.
- Evolve session, tasks, and HUD capabilities independently.
- Produce actionable diagnostics without exposing sensitive data.
- Keep upgrades and rollback testable on macOS and Windows.

## Constraints

- The bridge contract is distinct from Promethee's product version.
- Unknown, missing, malformed, or incompatible capabilities must not be guessed.
- Runtime payload validation remains mandatory after a successful handshake.
- A capability may be enabled only within a tested version range recorded by the target release.
- No compatibility fallback may access SQLite, credentials, session files, private external IPC, or broad UI automation.

## Considered options

1. Negotiate bridge and per-capability versions, validate payloads, and fail closed per feature.
2. Gate all integration on a Promethee application semantic-version range.
3. Call expected methods optimistically and catch failures as a best-effort strategy.
4. Pin one Promethee version and require users never to upgrade as the status quo compatibility rule.

## Decision

We will **perform an explicit bridge handshake and negotiate named, versioned capabilities before using them**. The result includes bridge protocol version, Promethee application version for diagnostics, available capability identifiers and versions, and any transport/session identity needed by the approved security design.

Each Pomodoro feature declares required capabilities and accepted version ranges. Missing or incompatible requirements disable that feature before use. State-changing session coordination fails closed and reconciles authoritative state; it never falls back to an unsupported control path. Read-only features may degrade independently when their own requirements are absent. Every payload is runtime-validated, and a violation invalidates the affected capability until a successful fresh negotiation.

## Rationale

Per-capability negotiation matches the actual coupling: task listing can remain compatible while HUD geometry changes, and neither should imply session commands are safe. An application-version range assumes all internal behavior moves together and encourages broad exceptions. Best-effort calls discover incompatibility only after a potentially state-changing attempt. Permanent pinning prevents supported product upgrades and still does not protect against corrupted or unexpected payloads.

## Option comparison

| Driver | Capability negotiation | App-version gate | Optimistic calls | Permanent pin |
|---|---|---|---|---|
| Prevent unsafe command | Before use, per capability | Before use but coarse | Only after attempted call | Only for known build |
| Independent evolution | Yes | No | Accidental | No |
| Payload integrity | Explicit runtime schemas | Separate work still needed | Exception-driven | Separate work still needed |
| User upgrade path | Tested compatibility matrix | Broad version ranges | Unpredictable | Blocked |
| Diagnostic precision | Missing/incompatible capability | Unsupported app version | Runtime error | Wrong installed version |
| Evidence | Contract design; vertical proof pending | Static 1.3.26 analysis only | Rejected reliability risk | Static version only |

## Consequences

### Positive

- Unsupported automation is blocked before commands are issued.
- Compatibility failures identify the exact missing or incompatible capability.
- Promethee and Pomodoro can evolve capabilities independently and test explicit ranges.
- Read-only UI can degrade without implying state-changing integration is safe.

### Negative

- Both sides must maintain protocol and capability version metadata.
- Compatibility fixtures and release-matrix testing become recurring work.
- Users may temporarily lose an integration feature after a Promethee update until compatibility is verified.

### Neutral

- Promethee application version remains useful diagnostic evidence but is not the authorization mechanism.
- Capability negotiation complements caller authentication and origin validation; it does not replace them.

## Implementation and migration

1. Define canonical capability identifiers for active-session read, acknowledged session commands, session events, task list/events, and HUD state/geometry events.
2. Version each capability independently and define validated request, response, event, and error schemas.
3. Add a handshake result and feature-to-capability requirement table to the adapter.
4. Store only non-sensitive compatibility diagnostics and expose clear degraded status.
5. Build compatibility fixtures for each supported bridge/capability combination.
6. Require a fresh handshake after reconnect, Promethee restart, protocol violation, or product update detection.

## Validation

- Contract tests cover supported, missing, older, newer, malformed, and unknown capability versions.
- State-changing methods cannot be invoked before a compatible handshake.
- A malformed event disables the affected capability and triggers safe reconciliation without trying an alternative private path.
- The release matrix records tested Promethee, bridge, Pomodoro, OS, and architecture combinations.
- A Promethee upgrade/downgrade integration test proves fresh negotiation and correct feature degradation.

## Revisit triggers

- Promethee publishes a stable public API with its own equivalent negotiation mechanism.
- Capability versioning creates incompatible combinations that require dependency constraints between capabilities.
- Compatibility incidents show the current handshake cannot detect a material semantic change.
- A signed schema registry or extension manifest becomes the authoritative Promethee compatibility source.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none.
- Depends on: [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md).
- Related: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md), [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md).
- Implemented by: the typed adapter, external bridge composition, runtime compatibility gates, release verifier, and tests.
- Evidence: read-only Promethee 1.3.26 API analysis supplied to the project; versioned interface and runtime-validation constraints in [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md).
