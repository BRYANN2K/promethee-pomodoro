---
id: ADR-0018
status: accepted
date: 2026-08-26
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0018: Retire the abandoned Swift and preview tracks

## Context and problem

Electron/TypeScript/npm is the implemented product and release-candidate contract. The earlier Swift package, Swift resources/tests/installer, HTML prototype, design-preview worktree, and local agent scratch directory no longer contribute to build, package, validation, or recovery. Keeping them makes user instructions and architecture evidence ambiguous.

The project owner explicitly authorized their removal on 2026-08-26. Local OpenSpec planning material is also ignored and excluded from the public npm artifact; it is not a public runtime or installation dependency.

## Decision

The repository SHALL retain one product implementation: Electron/TypeScript/npm.

The abandoned Swift package/source/resources/tests/installer, obsolete HTML/design previews, local scratch material, and legacy-only documentation are removed. Active documentation SHALL NOT describe them as a fallback, validation track, installation path, or current evidence.

The compiled project UI skill under `.agents/` remains the retained design-system contract. Future material UI changes still require that skill, the applicable design workflow, explicit human review, and real-surface validation.

Historical ADR rationale may mention the former Swift/prototype state, but it SHALL carry a dated retirement amendment where needed and SHALL NOT link to deleted files. Public docs rely on current source, tests, accepted ADRs, and retained evidence summaries.

## Consequences

- Build, validation, packaging, and onboarding have one implementation path.
- Recovery must use immutable source/package history rather than a stale second application.
- Historical comparisons remain prose-only where they explain a decision.
- Removing preview artifacts does not remove prior human approval encoded in the retained UI skill and current production design.
- Ignored local OpenSpec content cannot be treated as a public link or packaged contract.

## Validation

- Active docs and machine contracts list no Swift source/test/validation roots.
- Markdown links resolve without deleted legacy/preview paths.
- npm packaging continues to exclude local planning, preview, test, and scratch material.
- Electron build and tests remain the only product validation path.

## Related decisions and evidence

- Completes the migration boundary introduced by [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Preserves the active UI/bridge/release decisions in ADR-0010 through ADR-0017.
- Approval evidence: explicit project-owner cleanup authorization in the current conversation on 2026-08-26.
