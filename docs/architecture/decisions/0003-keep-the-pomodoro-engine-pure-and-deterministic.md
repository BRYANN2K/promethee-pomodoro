---
id: ADR-0003
status: accepted
date: 2026-08-25
deciders: [project-owner]
consulted: []
informed: []
---

# ADR-0003: Keep the Pomodoro engine pure and deterministic

## Context and problem

The timer must remain correct through pause/resume, sleep/wake, process restart, late ticks, early focus restart during a break, and asynchronous Promethee acknowledgements. If timing, persistence, Electron APIs, and UI rendering are combined, state transitions become difficult to reproduce and cross-platform behavior can drift.

The product needs one testable model for focus, break, and ready behavior before session coordination or presentation is implemented.

## Scope and non-goals

This decision covers Pomodoro states, events, transition outputs, duration policy, and clock inputs. It does not control Promethee, persist state, display windows, send notifications, or select a state-management library. Those effects consume engine outputs through separate boundaries.

## Decision drivers

- Reproduce every phase transition without Electron, a renderer, or wall-clock waiting.
- Avoid interval drift across delayed callbacks and system sleep.
- Serialize enough state to reconcile after restart.
- Keep focus and break progress semantics identical and inspectable.
- Make race handling in the session coordinator explicit rather than implicit in UI callbacks.

## Constraints

- The engine must have no Electron, DOM, filesystem, network, notification, or Promethee dependency.
- Time must be injected and represented by absolute deadlines for running phases.
- State and events must be serializable data, not timers, closures, or platform objects.
- Duration and cadence settings are validated before entering the engine.
- Effects are descriptions returned from transitions; the engine does not execute them.

## Considered options

1. Implement a pure TypeScript state machine with injected time and explicit transition outputs.
2. Keep timer state in renderer components and interval callbacks.
3. Keep timer state in a mutable Electron main-process service with platform effects.
4. Port the current Swift timer structure directly and expose it through a native helper as the status quo derivative.

## Decision

We will **implement `pomodoro-core` as a pure, deterministic TypeScript state machine**. Its minimum states are `idle`, `focus-running`, `focus-paused`, `break-running`, and `ready`. A transition receives the current state, a validated event, configuration, and injected current time, then returns the next state plus declarative effects.

Running phases store absolute deadlines. Remaining time and a normalized remaining-progress ratio are derived from the deadline and duration. Both focus and break start at full progress and consume toward zero. If Promethee play occurs during a break or ready state, the engine starts a new focus phase with the full currently configured focus duration.

## Rationale

Pure transitions turn timing edge cases into data-driven tests and keep the same semantics in main-process orchestration, renderer previews, and restart reconciliation. Absolute deadlines make late interval callbacks a display-refresh issue instead of a source of accumulated time drift. A renderer-owned timer couples correctness to window lifecycle; a side-effecting main service hides ordering and makes tests dependent on clocks and platform mocks. A native helper would preserve a language boundary the Electron target is intended to remove.

## Option comparison

| Driver | Pure TypeScript machine | Renderer intervals | Side-effecting main service | Native helper | Evidence |
|---|---|---|---|---|---|
| Deterministic tests | Direct state/event assertions | Requires UI/fake timers | Requires broad effect mocks | Cross-language harness | Engineering property of each option |
| Sleep/wake correctness | Deadline-derived | Easy to drift unless rebuilt similarly | Possible but coupled | Current Swift uses deadlines | Observed current architecture; target implementation unverified |
| Serialization | Plain versionable data | Component state varies | Service internals must be extracted | Requires bridge schema | Design analysis |
| Cross-platform reuse | Direct | Renderer-bound | Host-bound | Native binaries per platform | Constraint from ADR-0001 |
| Effect isolation | Explicit outputs | UI callbacks execute effects | Service executes effects | Native boundary executes some effects | Design analysis |

## Consequences

### Positive

- Exhaustive transition tables can cover normal, delayed, duplicate, and invalid events.
- UI refresh frequency does not define timer accuracy.
- Persistence and Promethee coordination receive explicit state and effects.
- Progress consumption has one calculation for focus and break.

### Negative

- The coordinator must interpret effects and feed acknowledgements back as events.
- State/schema evolution needs versioning and migration discipline.
- Developers must avoid convenient platform calls inside the core package.

### Neutral

- A periodic tick is still useful for rendering, but it cannot mutate elapsed time by subtraction.
- The state machine does not decide whether a Promethee bridge command succeeded.

## Implementation and migration

1. Define versioned state, event, configuration, derived-view, and effect types.
2. Write the transition table and invariants before an Electron host calls the engine.
3. Inject a controllable clock in tests and use wall-clock time only at the host boundary.
4. Add property or table-driven tests for duplicate events, boundary timestamps, sleep/wake jumps, configuration changes, and serialization round trips.
5. Integrate through the session coordinator; do not call the adapter from the engine.

## Validation

- Core tests run in a plain TypeScript environment without Electron or DOM globals.
- Given identical state, event, configuration, and time, transitions are structurally identical.
- Advancing directly across a deadline produces the same final phase outcome as any number of intermediate display ticks.
- Focus and break progress equal `1` at phase start, approach `0`, and never render outside the accepted normalized range.
- Early play during break or ready produces a full configured focus duration.

## Revisit triggers

- A required behavior cannot be expressed as state, event, configuration, and declarative effect without embedding a platform dependency.
- Timer requirements introduce concurrent independent clocks rather than one Pomodoro cycle.
- Measured transition volume makes immutable state copies a material performance constraint.
- The selected implementation cannot preserve deterministic replay across supported runtime versions.

## Related decisions and evidence

- Supersedes: none.
- Superseded by: none.
- Depends on: [ADR-0001](0001-use-electron-and-typescript-for-the-cross-platform-target.md).
- Related: [ADR-0004](0004-make-the-promethee-timer-the-session-control-authority.md), [ADR-0005](0005-render-progress-as-a-consuming-outline-around-the-real-hud.md).
- Implemented by: `src/core` plus the independent `src/cycle-persistence` codec/recovery slice.
- Evidence: current TypeScript core/persistence source and tests, [`pomodoro-state-machine.md`](../pomodoro-state-machine.md), and accepted product behavior.
