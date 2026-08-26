# Pomodoro state machine

**Status:** Implemented as a dependency-free TypeScript core; the final frozen-source run passes 33/33 core tests. Electron, persistence I/O/host wiring, and live Promethee integration are outside this proof boundary.

The cycle engine is a pure, deterministic reducer. It receives explicit events, an injected wall-clock time, and configuration. It returns the next serializable state plus effects for the coordinator. It does not call Electron, Promethee, storage, or notifications directly.

## States

| State | Meaning | Deadline |
| --- | --- | --- |
| `idle` | No coordinated cycle is active. | None |
| `focus-running` | Promethee is running and focus time is consuming. | Required |
| `focus-paused` | Promethee is paused and focus time is frozen. | None; remaining duration is stored |
| `break-running` | Focus completion was acknowledged and break time is consuming while Promethee stays paused. | Required |
| `ready` | The break ended and the product is waiting for the user to resume through Promethee. | None |

The UI may display transient pending feedback while an adapter command awaits acknowledgement, but pending transport state is coordinator state, not a second Pomodoro phase.

## Events

- `START_REQUESTED(taskId?)` — begin a full configured focus duration after Promethee reports running.
- `PROMETHEE_RUNNING(session)` — authoritative observation that the session is running.
- `PROMETHEE_PAUSED(session)` — authoritative observation that the session is paused.
- `PROMETHEE_STOPPED(session?)` — authoritative observation that no coordinated session remains.
- `DEADLINE_REACHED(at)` — current phase deadline has elapsed.
- `SKIP_FOCUS_REQUESTED` — end the current focus without credit, obtain authoritative Promethee pause, and select a short break.
- `SKIP_BREAK_REQUESTED` — leave a running break and wait in Ready.
- `RESTART_PHASE_REQUESTED` — the menu's **Reset timer** action; restart the current focus or break at its full configured duration without issuing any Promethee command.
- `READY_DISMISSED` — dismiss presentation without resuming work.
- `RESTORE(snapshot, now)` — restore a compatible snapshot and recompute elapsed time.
- `RESET` — return to safe idle state.

## Transition table

| Current state | Event or condition | Next state | Required effect |
| --- | --- | --- | --- |
| `idle` | Promethee starts through the approved path | `focus-running` | Set a full focus deadline. |
| `focus-running` | Promethee pauses manually | `focus-paused` | Freeze remaining focus time. |
| `focus-paused` | Promethee resumes | `focus-running` | Set a new deadline from frozen remaining time. |
| `focus-running` | Focus deadline elapses | pending acknowledgement | Request Promethee pause exactly once. |
| `focus-running` | Skip focus before its deadline | pending acknowledgement | Request Promethee pause exactly once without focus or cadence credit. |
| manually `focus-paused` | Skip focus | `break-running` or pending explicit break start | Start or queue a short break locally without another Promethee command or focus credit. |
| pending focus completion | Pause acknowledged/observed | `break-running` | Start the configured short or long break at full duration. |
| pending focus completion | Pause fails or times out | reconciled focus state | Query actual session state; never assume success. |
| `break-running` | Break deadline elapses | `ready` | Notify once and wait for user play. |
| `break-running` | Skip break | `ready` | Transition locally with no Promethee command and no synthetic break-completed effect. |
| `break-running` | Promethee reports running early | `focus-running` | Start a new full configured focus duration. |
| `ready` | Promethee reports running | `focus-running` | Start a new full configured focus duration. |
| `focus-running`, `focus-paused`, or `break-running` | Reset timer / restart phase | same phase, restarted locally | Restore the configured duration; never reset or control Promethee. |
| any active state | Promethee stops | `idle` | Cancel deadlines and detach the coordinated session. |
| any active state | Internal cycle reset | `idle` | Cancel deadlines and clear transient ownership; this is not the menu's **Reset timer** action. |

## Timing model

For a running phase:

```text
remaining = clamp(deadline - now, 0, configuredDuration)
progress  = remaining / configuredDuration
```

Progress starts at `1` and consumes toward `0` for focus and break. UI refresh frequency affects animation smoothness only; it must not define elapsed time. Sleep, wake, renderer suspension, and delayed callbacks are handled by comparing the stored deadline with a new wall-clock observation.

When focus is paused, the engine stores remaining duration rather than a live deadline. Resuming creates `deadline = now + remaining`. When a user presses Promethee Play during a break or Ready, the unfinished break is discarded and a new focus begins at the complete configured focus duration.

## Long-break cadence

The completed-focus count increments only after focus completion and Promethee pause acknowledgement. A long break is selected when the updated count is evenly divisible by the configured `focusesPerLongBreak`; otherwise a short break is selected. Restarting a phase does not increment the count. Stopping before completion does not increment it.

A focus skipped before its deadline retains the current focus-phase identity, records `breakSource = skipped-focus`, receives no completed-focus or long-break cadence credit, and can lead only to a short break. If Skip focus reaches the exact deadline, normal deadline completion wins and the focus is credited once.

## Stable occurrence identities

Each focus has a stable `phaseId` derived from `cycleInstance` and `phaseSequence`. Its pause request derives from that same phase identity, so a duplicate Skip focus, deadline tick, acknowledgement, or replay cannot allocate a second pause operation for the occurrence.

Ready commits `readyOccurrenceId` in state before any completion effect is emitted. The identity is derived from `cycleInstance`, `phaseSequence`, and `breakSource`; natural break completion emits that same value as its effect identity, while Skip break enters Ready with the identity committed but no synthetic break-completed effect. Replayed completion, duplicate ticks, and Dismiss Ready preserve the committed value. This gives later persistence and notification work a stable deduplication key without granting those side effects to the core.

## Invariants

- Durations are finite positive values within documented configuration bounds.
- At most one running deadline exists.
- Progress is always between `0` and `1` inclusive and never increases during an uninterrupted running phase.
- Replaying an event with the same event identifier cannot produce a second external effect.
- A skipped focus never increments completed-focus count or selects a long break.
- Restarting the current phase changes only local Pomodoro time; it emits no Promethee action and does not alter cadence credit.
- Ready identity is deterministic for its cycle, focus occurrence, and break source and cannot be replaced by dismissal or replay.
- The engine cannot claim Promethee paused or running; only an adapter observation can establish that fact.
- A dismissed Ready prompt remains Ready.
- Serialized state contains no credential, Promethee token, or arbitrary task content.

## Test model

The core suite uses explicit timestamps and deterministic event sequences. It covers configuration/state validation, focus and break deadlines, manual pause/resume, stable pause identities, acknowledgement ordering, automatic and explicit break start, Skip focus without credit, local Skip break to Ready, stable Ready occurrence identity, early play, cadence, restart, stop/reset, serialization of representative results, numeric boundaries, clamping, and corrupt-state rejection. It does not yet claim exhaustive transition-category coverage, serialization round trips for every state/effect variant, persistence restore, or property-based invariant coverage.

The separate adapter/coordinator suite covers contract validation, protocol-version rejection, exact requested grants, required `hud.geometry`, unknown/malformed mutation rejection, snapshot/event cursor handling, acknowledgement and reconnect races, authoritative-event-time rewind with bounded local-action replay, pause-correlation reuse, connection-generation isolation, terminal observation, task/HUD read-model progression, and a coordinator bridge surface that can issue pause but no start/stop/end operation. It passes 71/71 tests. Both suites use controlled doubles and provide no live Promethee or platform proof.
