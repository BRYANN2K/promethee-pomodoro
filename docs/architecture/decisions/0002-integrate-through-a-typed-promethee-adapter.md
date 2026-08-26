---
id: ADR-0002
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0002: Integrate through a typed Promethee adapter

> **Repository cleanup (2026-08-26):** ADR-0018 retired the former Swift implementation and its integration page. Historical comparison below remains rationale only; current evidence is the Electron adapter/bridge source, tests, and ADR-0011 through ADR-0016.

> **Amendment note:** [ADR-0014](0014-compose-the-external-promethee-bridge.md) accepts the companion's external bridge by composing ADR-0011, ADR-0012, and ADR-0013. It replaces this ADR's upstream-owned transport and authoritative acknowledgement/event assumptions for the external profile; the typed adapter, Promethee authority, and private IPC/credential prohibitions remain. A future official profile may still provide the stronger semantics recorded below.

## Context and problem

Pomodoro behavior needs current Promethee session state, acknowledged session commands, task data, HUD placement, and change events. The supplied Promethee 1.3.26 analysis shows that these abilities exist behind an internal preload/IPC surface guarded for Promethee-owned renderer frames. It does not expose a supported external HTTP or RPC contract. The current Swift prototype works around that absence with Accessibility controls and a read-only SQLite task query, but those mechanisms are not an acceptable target for a quasi-native, cross-platform integration.

We need a boundary that can be implemented with Promethee's cooperation, reviewed independently, versioned, tested, and disabled safely.

## Scope and non-goals

This decision governs all target-application access to Promethee session, task, HUD, and compatibility data. It does not define the final transport, grant permission to modify Promethee, or make the private 1.3.26 preload API public. It does not cover general Promethee features unrelated to Pomodoro.

## Decision drivers

- Preserve Promethee's context-isolation, sandbox, and origin-validation security posture.
- Receive acknowledged, current state rather than infer state from UI appearance.
- Keep product logic independent from a particular bridge transport.
- Support macOS and Windows with one semantic contract.
- Prevent credential, session-file, and database coupling.

## Constraints

- Existing `window.promethee.*` calls are internal to trusted Promethee renderer frames and are not an external API.
- Direct writes to Promethee SQLite or remote Supabase state are prohibited.
- The target must not copy Promethee tokens, cookies, credentials, embedded keys, or authenticated session files.
- Only an allowlisted Pomodoro capability set may cross the boundary.
- A Promethee-side bridge requires explicit cooperation and review by the Promethee integration owner.

## Considered options

1. Define a typed `promethee-adapter` and back it with an official, least-privilege Promethee bridge.
2. Attempt to invoke Promethee's private IPC from a separate Electron process.
3. Continue Accessibility control plus direct read-only SQLite task discovery as the status quo.
4. Reuse Promethee credentials or Supabase session material to call remote data services directly.

## Decision

We will **place every Promethee interaction behind a typed, runtime-validated `promethee-adapter` and implement production access only through an explicitly approved Promethee bridge**. The bridge will expose an allowlisted capability/version handshake, acknowledged session commands, task queries/events, and HUD state/geometry events needed by the accepted specifications.

The target application will never write or read product data directly from Promethee SQLite, invoke private external IPC, inject code, or reuse Promethee authentication material. Until the official bridge exists and passes a vertical proof, integration-dependent product work remains blocked or runs with a clearly isolated fake adapter in tests and previews.

## Rationale

An adapter preserves a stable semantic boundary while allowing the transport to be selected with Promethee's maintainers. A small Promethee-owned bridge can reuse existing main-process handlers without weakening them into arbitrary IPC. Private IPC from another process conflicts with existing frame checks and would be brittle even if bypassed. UI automation and SQLite inspection can demonstrate a prototype but cannot provide cross-platform acknowledged state with a supported trust boundary. Credential reuse would be an unacceptable security and ownership violation.

## Option comparison

| Driver | Typed official adapter/bridge | Private external IPC | Accessibility + SQLite status quo | Credential/Supabase reuse | Evidence |
|---|---|---|---|---|---|
| Supported trust boundary | Can be explicitly reviewed and allowed | Conflicts with guarded internal surface | Unsupported UI/data coupling | Bypasses app session ownership | Observed in supplied 1.3.26 analysis |
| State fidelity | Commands plus acknowledgements and events | Potentially high but unsupported | Inferred controls; task snapshot | Partial remote data, not local HUD/session orchestration | Observed in current architecture docs and supplied analysis |
| Cross-platform | One semantic contract | Runtime-specific and brittle | macOS Accessibility implementation only | Cross-platform network, incomplete behavior | Observed current code; assumed bridge proof pending |
| Least privilege | Explicit capability allowlist | Tempts broad IPC exposure | Broad UI traversal and database path access | Requires sensitive auth material | Security constraint |
| Versionability | Explicit contract and negotiation | Bound to private channels | Bound to labels/schema | Bound to remote schema/session details | Sourced from interface-design practice; bridge details pending |

## Consequences

### Positive

- Domain and UI code depend on typed capabilities rather than Promethee implementation details.
- Promethee can audit and restrict the integration at its own main-process boundary.
- Commands can be idempotent, acknowledged, and reconciled with authoritative state.
- Database schema, accessibility labels, and authentication material do not become target contracts.

### Negative

- The production integration cannot ship until Promethee exposes and reviews the narrow bridge.
- Both repositories must coordinate contract versions and compatibility testing.
- Runtime payload validation, timeouts, reconnect behavior, and event ordering add implementation work.

### Neutral

- Test doubles remain valid for domain and UI development but are not end-to-end evidence.
- The exact transport may be in-process integration, authenticated local IPC, or another approved mechanism without changing adapter semantics.

## Implementation and migration

1. Specify the adapter operations, events, payload schemas, errors, acknowledgements, and capability identifiers.
2. Review the bridge threat boundary with Promethee before adding a transport.
3. Implement the smallest vertical slice: negotiate capabilities, read active session, pause/resume with acknowledgement, observe one state event.
4. Verify that slice on macOS and Windows before task and HUD work.
5. Add task and HUD capabilities incrementally under the same allowlist.
6. Remove target dependence on Accessibility and SQLite only after the bridge replacement is verified; do not delete legacy code without separate authorization.

## Validation

- Contract tests run the same adapter suite against a fake and the approved bridge implementation.
- Runtime validation rejects missing, malformed, unknown, or future-incompatible payloads.
- Security tests show that unallowlisted methods, untrusted callers, replayed requests where relevant, and invalid origins or identities are rejected.
- A disposable Promethee session proves acknowledged pause/resume and state reconciliation on macOS and Windows.
- Repository scans and review find no Promethee database access, copied tokens, cookies, credentials, embedded keys, or private external IPC in the target.

## Revisit triggers

- Promethee publishes a supported plugin or public API that fully covers the adapter contract.
- The approved bridge cannot meet the required acknowledgement, event, or HUD geometry semantics.
- A newly identified security property requires a different process or authentication boundary.
- Promethee removes or materially changes the internal capabilities on which its side of the bridge depends.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none; transport/read clauses are amended by ADR-0014 and its composed decisions.
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Related: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), [ADR-0006](0006-negotiate-capabilities-and-fail-closed-across-promethee-versions.md).
- Implemented by: `src/promethee-adapter`, the external bridge composition, session coordinator, and controlled tests.
- Evidence: the read-only Promethee 1.3.26 API analysis supplied to the project plus the current Electron adapter/bridge source and tests.
