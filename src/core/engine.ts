import { validatePomodoroConfig } from "./config.ts";
import {
  focusPhaseId,
  pauseRequestIdFor,
  readyOccurrenceIdFor,
  validatePomodoroState
} from "./state-validation.ts";
import { checkedDeadlineAt, isValidTimestamp, remainingMsAt } from "./time.ts";
import {
  POMODORO_STATE_SCHEMA_VERSION,
  type AwaitingPrometheePauseState,
  type BreakKind,
  type BreakRunningState,
  type BreakSource,
  type FocusRunningState,
  type IdleState,
  type PomodoroConfig,
  type PomodoroEvent,
  type PomodoroState,
  type ReadyState,
  type TransitionRejectionCode,
  type TransitionResult
} from "./types.ts";

const NO_EFFECTS = Object.freeze([]);

export function createInitialState(
  completedFocusCount = 0,
  phaseSequence = 0,
  cycleInstance = 1
): IdleState {
  let safeCompletedFocusCount =
    Number.isSafeInteger(completedFocusCount) && completedFocusCount >= 0
      ? completedFocusCount
      : 0;
  let safePhaseSequence =
    Number.isSafeInteger(phaseSequence) && phaseSequence >= 0 ? phaseSequence : 0;
  const safeCycleInstance =
    Number.isSafeInteger(cycleInstance) && cycleInstance >= 1 ? cycleInstance : 1;

  if (safeCompletedFocusCount > safePhaseSequence) {
    safeCompletedFocusCount = 0;
    safePhaseSequence = 0;
  }

  return {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "idle",
    completedFocusCount: safeCompletedFocusCount,
    cycleInstance: safeCycleInstance,
    phaseSequence: safePhaseSequence
  };
}

function unchanged(state: PomodoroState): TransitionResult {
  return { state, effects: NO_EFFECTS };
}

function rejected(
  state: PomodoroState,
  code: TransitionRejectionCode,
  message: string
): TransitionResult {
  return {
    state,
    effects: NO_EFFECTS,
    rejection: { code, message }
  };
}

function startFocus(
  previousState: PomodoroState,
  durationMs: number,
  nowMs: number
): TransitionResult {
  if (
    !Number.isSafeInteger(previousState.phaseSequence) ||
    previousState.phaseSequence < 0 ||
    previousState.phaseSequence === Number.MAX_SAFE_INTEGER
  ) {
    return rejected(previousState, "invalid-state", "Focus phase sequence is invalid.");
  }

  const deadlineAtMs = checkedDeadlineAt(nowMs, durationMs);
  if (deadlineAtMs === null) {
    return rejected(previousState, "invalid-time", "Focus deadline exceeds safe time bounds.");
  }

  const phaseSequence = previousState.phaseSequence + 1;
  const state: FocusRunningState = {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "focus-running",
    completedFocusCount: previousState.completedFocusCount,
    cycleInstance: previousState.cycleInstance,
    phaseSequence,
    phaseId: focusPhaseId(previousState.cycleInstance, phaseSequence),
    startedAtMs: nowMs,
    durationMs,
    deadlineAtMs
  };

  return { state, effects: NO_EFFECTS };
}

function resumeFocus(
  state: Extract<PomodoroState, { readonly kind: "focus-paused"; readonly reason: "promethee-paused" }>,
  nowMs: number
): TransitionResult {
  const deadlineAtMs = checkedDeadlineAt(nowMs, state.remainingMs);
  if (deadlineAtMs === null) {
    return rejected(state, "invalid-time", "Resumed focus deadline exceeds safe time bounds.");
  }

  const runningState: FocusRunningState = {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "focus-running",
    completedFocusCount: state.completedFocusCount,
    cycleInstance: state.cycleInstance,
    phaseSequence: state.phaseSequence,
    phaseId: state.phaseId,
    startedAtMs: nowMs,
    durationMs: state.durationMs,
    deadlineAtMs
  };

  return { state: runningState, effects: NO_EFFECTS };
}

function breakDuration(config: PomodoroConfig, breakKind: BreakKind): number {
  return breakKind === "long"
    ? config.longBreakDurationMs
    : config.shortBreakDurationMs;
}

function startBreak(
  previousState: PomodoroState,
  completedFocusCount: number,
  breakKind: BreakKind,
  breakSource: BreakSource,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  const durationMs = breakDuration(config, breakKind);
  const deadlineAtMs = checkedDeadlineAt(nowMs, durationMs);
  if (deadlineAtMs === null) {
    return rejected(previousState, "invalid-time", "Break deadline exceeds safe time bounds.");
  }

  const state: BreakRunningState = {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "break-running",
    completedFocusCount,
    cycleInstance: previousState.cycleInstance,
    phaseSequence: previousState.phaseSequence,
    breakKind,
    breakSource,
    startedAtMs: nowMs,
    durationMs,
    deadlineAtMs
  };

  return { state, effects: NO_EFFECTS };
}

function awaitBreakStart(
  state: PomodoroState,
  completedFocusCount: number,
  pendingBreakKind: BreakKind,
  breakSource: BreakSource
): TransitionResult {
  if (state.kind !== "focus-paused") {
    return rejected(state, "invalid-state", "A break requires a paused focus phase.");
  }
  return {
    state: {
      schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
      kind: "focus-paused",
      reason: "awaiting-break-start",
      completedFocusCount,
      cycleInstance: state.cycleInstance,
      phaseSequence: state.phaseSequence,
      phaseId: state.phaseId,
      durationMs: state.durationMs,
      remainingMs: 0,
      pendingBreakKind,
      breakSource
    },
    effects: NO_EFFECTS
  };
}

function confirmFocusPause(
  state: AwaitingPrometheePauseState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  if (
    state.breakSource === "completed-focus" &&
    state.completedFocusCount === Number.MAX_SAFE_INTEGER
  ) {
    return rejected(state, "invalid-state", "Completed focus count exceeds safe bounds.");
  }

  const completedFocusCount = state.breakSource === "completed-focus"
    ? state.completedFocusCount + 1
    : state.completedFocusCount;
  const pendingBreakKind: BreakKind = state.breakSource === "skipped-focus"
    ? "short"
    : completedFocusCount % config.focusesPerLongBreak === 0 ? "long" : "short";

  if (config.autoStartBreak) {
    return startBreak(
      state,
      completedFocusCount,
      pendingBreakKind,
      state.breakSource,
      config,
      nowMs
    );
  }

  return awaitBreakStart(
    state,
    completedFocusCount,
    pendingBreakKind,
    state.breakSource
  );
}

function completeAlreadyPausedFocus(
  state: FocusRunningState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  const pauseRequestId = pauseRequestIdFor(state.phaseId);
  const awaitingState: AwaitingPrometheePauseState = {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "focus-paused",
    reason: "awaiting-promethee-pause",
    completedFocusCount: state.completedFocusCount,
    cycleInstance: state.cycleInstance,
    phaseSequence: state.phaseSequence,
    phaseId: state.phaseId,
    pauseRequestId,
    breakSource: "completed-focus",
    durationMs: state.durationMs,
    remainingMs: 0,
    completedFocusStartedAtMs: state.startedAtMs,
    completedFocusDeadlineAtMs: state.deadlineAtMs
  };

  return confirmFocusPause(awaitingState, config, nowMs);
}

function readyFromBreak(
  state: PomodoroState,
  completedBreakKind: BreakKind,
  breakSource: BreakSource
): ReadyState {
  return {
    schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
    kind: "ready",
    completedFocusCount: state.completedFocusCount,
    cycleInstance: state.cycleInstance,
    phaseSequence: state.phaseSequence,
    completedBreakKind,
    breakSource,
    readyOccurrenceId: readyOccurrenceIdFor(
      state.cycleInstance,
      state.phaseSequence,
      breakSource
    )
  };
}

function onTick(
  state: PomodoroState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  if (state.kind === "focus-running" && nowMs >= state.deadlineAtMs) {
    const pauseRequestId = pauseRequestIdFor(state.phaseId);
    const awaitingState: AwaitingPrometheePauseState = {
      schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
      kind: "focus-paused",
      reason: "awaiting-promethee-pause",
      completedFocusCount: state.completedFocusCount,
      cycleInstance: state.cycleInstance,
      phaseSequence: state.phaseSequence,
      phaseId: state.phaseId,
      pauseRequestId,
      breakSource: "completed-focus",
      durationMs: state.durationMs,
      remainingMs: 0,
      completedFocusStartedAtMs: state.startedAtMs,
      completedFocusDeadlineAtMs: state.deadlineAtMs
    };

    return {
      state: awaitingState,
      effects: [
        {
          type: "pause-promethee-requested",
          effectId: pauseRequestId,
          phaseId: state.phaseId,
          pauseRequestId,
          requestedAtMs: nowMs
        }
      ]
    };
  }

  if (state.kind === "break-running" && nowMs >= state.deadlineAtMs) {
    const readyState = readyFromBreak(state, state.breakKind, state.breakSource);

    return {
      state: readyState,
      effects: [
        {
          type: "break-completed",
          effectId: readyState.readyOccurrenceId,
          breakKind: state.breakKind,
          readyOccurrenceId: readyState.readyOccurrenceId,
          completedAtMs: nowMs
        }
      ]
    };
  }

  return unchanged(state);
}

function onPrometheePaused(
  state: PomodoroState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  if (state.kind === "focus-running") {
    const remainingMs = remainingMsAt(state, nowMs);
    if (remainingMs === null) {
      return unchanged(state);
    }

    if (remainingMs === 0) {
      return completeAlreadyPausedFocus(state, config, nowMs);
    }

    return {
      state: {
        schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
        kind: "focus-paused",
        reason: "promethee-paused",
        completedFocusCount: state.completedFocusCount,
        cycleInstance: state.cycleInstance,
        phaseSequence: state.phaseSequence,
        phaseId: state.phaseId,
        durationMs: state.durationMs,
        remainingMs
      },
      effects: NO_EFFECTS
    };
  }

  if (
    state.kind === "idle" ||
    state.kind === "ready" ||
    state.kind === "break-running" ||
    state.kind === "focus-paused"
  ) {
    return unchanged(state);
  }

  return unchanged(state);
}

function onPrometheePlayed(
  state: PomodoroState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  if (state.kind === "focus-running") {
    return unchanged(state);
  }

  if (state.kind === "focus-paused" && state.reason === "promethee-paused") {
    if (state.remainingMs === 0) {
      return startFocus(state, config.focusDurationMs, nowMs);
    }

    return resumeFocus(state, nowMs);
  }

  if (state.kind === "focus-paused" && state.reason === "awaiting-promethee-pause") {
    return rejected(
      state,
      "invalid-event-for-state",
      "Promethee play requires reconciliation while a pause request is pending."
    );
  }

  return startFocus(state, config.focusDurationMs, nowMs);
}

function onSkipFocus(
  state: PomodoroState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  if (state.kind === "focus-running") {
    if (nowMs >= state.deadlineAtMs) {
      return onTick(state, config, nowMs);
    }
    const pauseRequestId = pauseRequestIdFor(state.phaseId);
    const awaitingState: AwaitingPrometheePauseState = {
      schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
      kind: "focus-paused",
      reason: "awaiting-promethee-pause",
      completedFocusCount: state.completedFocusCount,
      cycleInstance: state.cycleInstance,
      phaseSequence: state.phaseSequence,
      phaseId: state.phaseId,
      pauseRequestId,
      breakSource: "skipped-focus",
      durationMs: state.durationMs,
      remainingMs: 0,
      completedFocusStartedAtMs: state.startedAtMs,
      completedFocusDeadlineAtMs: state.deadlineAtMs
    };
    return {
      state: awaitingState,
      effects: [{
        type: "pause-promethee-requested",
        effectId: pauseRequestId,
        phaseId: state.phaseId,
        pauseRequestId,
        requestedAtMs: nowMs
      }]
    };
  }

  if (
    state.kind === "focus-paused" &&
    state.reason === "promethee-paused"
  ) {
    return config.autoStartBreak
      ? startBreak(
          state,
          state.completedFocusCount,
          "short",
          "skipped-focus",
          config,
          nowMs
        )
      : awaitBreakStart(
          state,
          state.completedFocusCount,
          "short",
          "skipped-focus"
        );
  }

  return rejected(
    state,
    "invalid-event-for-state",
    `Cannot skip focus while state is ${state.kind}.`
  );
}

function restartManuallyPausedFocus(
  state: Extract<PomodoroState, { readonly kind: "focus-paused"; readonly reason: "promethee-paused" }>,
  config: PomodoroConfig
): TransitionResult {
  if (
    !Number.isSafeInteger(state.phaseSequence) ||
    state.phaseSequence < 0 ||
    state.phaseSequence === Number.MAX_SAFE_INTEGER
  ) {
    return rejected(state, "invalid-state", "Focus phase sequence is invalid.");
  }

  const phaseSequence = state.phaseSequence + 1;
  return {
    state: {
      schemaVersion: POMODORO_STATE_SCHEMA_VERSION,
      kind: "focus-paused",
      reason: "promethee-paused",
      completedFocusCount: state.completedFocusCount,
      cycleInstance: state.cycleInstance,
      phaseSequence,
      phaseId: focusPhaseId(state.cycleInstance, phaseSequence),
      durationMs: config.focusDurationMs,
      remainingMs: config.focusDurationMs
    },
    effects: NO_EFFECTS
  };
}

function onRestartPhase(
  state: PomodoroState,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  switch (state.kind) {
    case "focus-running":
      return startFocus(state, config.focusDurationMs, nowMs);
    case "focus-paused":
      if (state.reason === "promethee-paused") {
        return restartManuallyPausedFocus(state, config);
      }
      return rejected(
        state,
        "invalid-event-for-state",
        `Cannot restart focus while waiting in ${state.reason}.`
      );
    case "break-running":
      return startBreak(
        state,
        state.completedFocusCount,
        state.breakKind,
        state.breakSource,
        config,
        nowMs
      );
    case "idle":
    case "ready":
      return rejected(
        state,
        "invalid-event-for-state",
        `Cannot restart phase while state is ${state.kind}.`
      );
  }
}

export function transition(
  state: PomodoroState,
  event: PomodoroEvent,
  config: PomodoroConfig,
  nowMs: number
): TransitionResult {
  const stateValidation = validatePomodoroState(state);
  if (!stateValidation.valid) {
    return rejected(
      state,
      "invalid-state",
      stateValidation.message ?? "Pomodoro state is invalid."
    );
  }

  if (!isValidTimestamp(nowMs)) {
    return rejected(
      state,
      "invalid-time",
      "Transition time must be a non-negative safe integer."
    );
  }

  if (event.type === "reset-cycle") {
    if (state.cycleInstance === Number.MAX_SAFE_INTEGER) {
      return rejected(state, "invalid-state", "Cycle instance cannot advance safely.");
    }
    return {
      state: createInitialState(0, 0, state.cycleInstance + 1),
      effects: NO_EFFECTS
    };
  }

  if (event.type === "promethee-stopped") {
    return {
      state: createInitialState(
        state.completedFocusCount,
        state.phaseSequence,
        state.cycleInstance
      ),
      effects: NO_EFFECTS
    };
  }

  const configValidation = validatePomodoroConfig(config);
  if (!configValidation.valid) {
    return rejected(
      state,
      "invalid-configuration",
      configValidation.errors.map((error) => error.message).join(" ")
    );
  }

  switch (event.type) {
    case "tick":
      return onTick(state, configValidation.value, nowMs);

    case "start-focus":
      if (state.kind === "idle") {
        return startFocus(
          state,
          configValidation.value.focusDurationMs,
          nowMs
        );
      }
      return rejected(
        state,
        "invalid-event-for-state",
        `Cannot start focus while state is ${state.kind}.`
      );

    case "promethee-paused":
      return onPrometheePaused(state, configValidation.value, nowMs);

    case "promethee-pause-observed":
      if (state.kind === "focus-paused" && state.reason === "awaiting-promethee-pause") {
        // Advance from current observed state without acknowledging, attributing,
        // or authorizing retry of a preceding external control request.
        return confirmFocusPause(state, configValidation.value, nowMs);
      }
      return onPrometheePaused(state, configValidation.value, nowMs);

    case "promethee-played":
      return onPrometheePlayed(state, configValidation.value, nowMs);

    case "promethee-pause-confirmed":
      if (
        state.kind === "focus-paused" &&
        state.reason === "awaiting-promethee-pause"
      ) {
        if (event.pauseRequestId !== state.pauseRequestId) {
          return rejected(
            state,
            "mismatched-pause-request",
            "Pause confirmation does not match the active pause request."
          );
        }
        return confirmFocusPause(state, configValidation.value, nowMs);
      }
      return rejected(
        state,
        "invalid-event-for-state",
        "No Promethee pause request is awaiting confirmation."
      );

    case "start-break":
      if (state.kind === "focus-paused" && state.reason === "awaiting-break-start") {
        return startBreak(
          state,
          state.completedFocusCount,
          state.pendingBreakKind,
          state.breakSource,
          configValidation.value,
          nowMs
        );
      }
      return rejected(
        state,
        "invalid-event-for-state",
        `Cannot start break while state is ${state.kind}.`
      );

    case "skip-focus":
      return onSkipFocus(state, configValidation.value, nowMs);

    case "skip-break":
      if (state.kind === "break-running") {
        return {
          state: readyFromBreak(state, state.breakKind, state.breakSource),
          effects: NO_EFFECTS
        };
      }
      if (state.kind === "focus-paused" && state.reason === "awaiting-break-start") {
        return {
          state: readyFromBreak(
            state,
            state.pendingBreakKind,
            state.breakSource
          ),
          effects: NO_EFFECTS
        };
      }
      return rejected(
        state,
        "invalid-event-for-state",
        `Cannot skip break while state is ${state.kind}.`
      );

    case "restart-phase":
      return onRestartPhase(state, configValidation.value, nowMs);

    case "ready-dismissed":
      return state.kind === "ready"
        ? unchanged(state)
        : rejected(
            state,
            "invalid-event-for-state",
            `Cannot dismiss Ready while state is ${state.kind}.`
          );

  }
}
