---
id: ADR-0001
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0001: Use Electron and TypeScript for the cross-platform target

> **Migration completed (2026-08-26):** [ADR-0018](0018-retire-the-abandoned-swift-and-preview-tracks.md) records owner-approved retirement of the Swift/prototype/design-preview track. Historical Swift comparisons below explain this decision but no longer describe retained files or a recovery path.

## Context and problem

The repository currently contains a SwiftUI and AppKit implementation that targets macOS only. Promethee is an Electron application available on macOS and Windows, and the project owner wants this integration to feel native to Promethee rather than remain a separate macOS-only utility. We need one target platform and language boundary before specifying the bridge, timer engine, renderer surfaces, packaging, and validation workflow.

This ADR chooses the target architecture. It does not claim that the existing Swift implementation has already migrated.

## Scope and non-goals

This decision covers the application host and the language used for shared product logic and integration contracts. It does not select a renderer framework, state library, package manager, test runner, bundler, installer technology, or release provider. Those choices require evidence from the Promethee repository and separate review where consequential.

## Decision drivers

- Support both macOS and Windows from one maintained product codebase.
- Align with Promethee's Electron runtime and JavaScript-facing integration surface.
- Share domain, bridge, and UI types across process boundaries.
- Keep platform-specific overlay and packaging code explicit and testable.
- Minimize duplicated behavior and divergent release cadence.

## Constraints

- The current repository contract remains Swift/SwiftPM until a separately approved migration changes it.
- The Promethee manifests, lockfile, supported Electron version, and renderer conventions have not been inspected in this repository.
- No framework, package manager, dependency, or destructive removal is authorized by this ADR.
- The migration must preserve working artifacts until their replacement is verified.

## Considered options

1. Build the target as one Electron application with TypeScript across core, adapter, host, and renderer boundaries.
2. Build the target as one Electron application using untyped JavaScript.
3. Maintain independent native Swift/AppKit and Windows implementations.
4. Keep the current macOS-only Swift application as the status quo.

## Decision

We will **target an Electron application whose shared domain and integration code is written in TypeScript**. Platform-specific behavior may use narrow native helpers only when Electron APIs cannot meet an accepted requirement. The actual Electron, Node.js, renderer, build, and package-manager versions will be selected from inspected Promethee evidence during the foundation change.

The existing Swift project is retained until an approved migration plan provides verified replacement behavior and explicitly authorizes its disposition.

## Rationale

Electron is the only considered option that both matches Promethee's host technology and supports macOS and Windows without maintaining two complete applications. TypeScript makes the Promethee bridge, Pomodoro state transitions, and cross-process payloads reviewable as explicit contracts. Untyped JavaScript offers similar portability but weakens the most failure-sensitive boundary. Two native implementations preserve platform-native toolkits but multiply integration and release work and are unnecessary for the accepted product scope.

## Option comparison

| Driver | Electron + TypeScript | Electron + JavaScript | Two native apps | Swift status quo | Evidence |
|---|---|---|---|---|---|
| macOS and Windows | One cross-platform target | One cross-platform target | Two targets | macOS only | Observed: current Swift package declares macOS 14; project direction requires Windows |
| Promethee alignment | Same runtime family and typed JS-facing contracts | Same runtime family without static contract checks | Requires separate native bridges | Requires external automation | Observed: supplied Promethee 1.3.26 analysis identifies Electron IPC/preload boundaries |
| Contract safety | Strongest of the options | Runtime validation only | Language-specific contracts | Swift contracts only | Sourced: TypeScript adds compile-time checking; runtime validation is still required |
| Maintenance | Shared core and host | Shared core and host | Duplicated application layers | Lowest short-term change, fails target scope | Assumed: validate with migration estimates after Promethee source inspection |
| Migration cost | Material, staged | Material, staged | Highest | None immediately | Observed current code; estimates not yet produced |

## Consequences

### Positive

- Core timer behavior, integration types, and most UI logic can be shared across supported operating systems.
- The target can use Promethee-compatible Electron process and preload patterns.
- TypeScript can encode discriminated timer states, commands, acknowledgements, and compatibility results.

### Negative

- The current Swift implementation cannot be reused directly and requires a controlled migration.
- Electron introduces runtime, packaging, signing, and process-isolation obligations not present in the SwiftPM contract.
- Platform-specific HUD geometry and window behavior still require separate macOS and Windows verification.

### Neutral

- This decision does not imply an in-process Promethee extension; deployment mode depends on an approved bridge.
- TypeScript types do not validate untrusted runtime payloads, so the adapter still needs runtime validation.

## Implementation and migration

1. Complete `adopt-electron-project-contract` without deleting the Swift implementation.
2. Inspect Promethee manifests, lockfiles, Electron version, build system, renderer conventions, and security settings.
3. Declare the target manifests, process boundaries, validation commands, and package-manager choice from that evidence.
4. Prove one typed request/event path on macOS and Windows before migrating product surfaces.
5. Retire or archive Swift artifacts only under a separately reviewed and explicitly authorized migration task.

## Validation

- The foundation change records evidence for every selected tool and version.
- A minimal packaged target starts on both macOS and Windows in CI or an equivalent reproducible environment.
- Type checking covers the core, adapter, main-process host, preload boundary, and renderer-facing contracts.
- No Swift artifact is removed before replacement behavior is verified and approved.

## Revisit triggers

- Promethee replaces Electron or offers a supported extension runtime incompatible with this target.
- A required HUD behavior cannot be implemented safely or accessibly with Electron plus a bounded native helper.
- Cross-platform packaging or runtime cost violates a subsequently approved measurable constraint.
- Promethee's supported integration contract requires a different language or deployment model.

## Related decisions and evidence

- Supersedes: none. The current Swift contract remains implementation history until migrated; it was not recorded as an ADR.
- Superseded by: none.
- Related: [ADR-0002](0002-integrate-through-a-typed-promethee-adapter.md), [ADR-0007](0007-deliver-signed-releases-and-updates-through-ci.md).
- Implemented by: `package.json`, `package-lock.json`, the TypeScript project graph, Electron source/tests, `PROJECT.md`, and `software-project.json`.
- Evidence: [`PROJECT.md`](../../../PROJECT.md), [`software-project.json`](../../../software-project.json), the current Electron source/tests, and the read-only Promethee 1.3.26 API analysis supplied to the project.
