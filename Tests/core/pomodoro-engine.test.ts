import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POMODORO_CONFIG,
  MAX_PHASE_DURATION_MS,
  checkedDeadlineAt,
  createInitialState,
  progressAt,
  remainingMsAt,
  transition,
  validatePomodoroConfig,
  type PomodoroConfig,
  type PomodoroState,
  type TransitionResult
} from "../../src/core/index.ts";

const config: PomodoroConfig = {
  focusDurationMs: 10_000,
  shortBreakDurationMs: 4_000,
  longBreakDurationMs: 8_000,
  focusesPerLongBreak: 2,
  autoStartBreak: true
};

function startFocus(
  state: PomodoroState = createInitialState(),
  nowMs = 0,
  value: PomodoroConfig = config
): TransitionResult {
  return transition(state, { type: "promethee-played" }, value, nowMs);
}

function finishFocus(
  state: PomodoroState,
  deadlineAtMs: number,
  value: PomodoroConfig = config
): TransitionResult {
  const elapsed = transition(state, { type: "tick" }, value, deadlineAtMs);
  assert.equal(elapsed.state.kind, "focus-paused");
  assert.equal(elapsed.state.reason, "awaiting-promethee-pause");
  assert.equal(elapsed.effects.length, 1);
  assert.equal(elapsed.effects[0]?.type, "pause-promethee-requested");
  if (
    elapsed.state.kind !== "focus-paused" ||
    elapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected focus to await Promethee pause.");
  }
  return transition(
    elapsed.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: elapsed.state.pauseRequestId
    },
    value,
    deadlineAtMs + 50
  );
}

test("default configuration enables automatic break start", () => {
  assert.equal(DEFAULT_POMODORO_CONFIG.autoStartBreak, true);
  assert.equal(validatePomodoroConfig(DEFAULT_POMODORO_CONFIG).valid, true);
});

test("configuration rejects unsafe durations, cadence, and booleans", () => {
  const invalid = {
    ...config,
    focusDurationMs: 0,
    shortBreakDurationMs: Number.NaN,
    longBreakDurationMs: MAX_PHASE_DURATION_MS + 1,
    focusesPerLongBreak: 1.5,
    autoStartBreak: "yes"
  } as unknown as PomodoroConfig;

  const validation = validatePomodoroConfig(invalid);
  assert.equal(validation.valid, false);
  if (!validation.valid) {
    assert.deepEqual(
      new Set(validation.errors.map((error) => error.field)),
      new Set([
        "focusDurationMs",
        "shortBreakDurationMs",
        "longBreakDurationMs",
        "focusesPerLongBreak",
        "autoStartBreak"
      ])
    );
  }

  const result = transition(createInitialState(), { type: "start-focus" }, invalid, 0);
  assert.equal(result.state.kind, "idle");
  assert.equal(result.rejection?.code, "invalid-configuration");
});

test("configuration validation is safe for null and non-record inputs", () => {
  for (const candidate of [null, undefined, 42, "invalid", true, [], () => undefined]) {
    const validation = validatePomodoroConfig(candidate);
    assert.equal(validation.valid, false);
    if (!validation.valid) {
      assert.ok(validation.errors.length >= 1);
    }
  }

  const state = createInitialState();
  const result = transition(
    state,
    { type: "start-focus" },
    null as unknown as PomodoroConfig,
    0
  );
  assert.equal(result.state, state);
  assert.equal(result.rejection?.code, "invalid-configuration");
  assert.deepEqual(result.effects, []);
});

test("initial-state construction normalizes invalid count and sequence relations", () => {
  const normalized = createInitialState(2, 0, 1);
  assert.deepEqual(normalized, createInitialState());

  const tick = transition(normalized, { type: "tick" }, config, 100_000);
  assert.equal(tick.state, normalized);
  assert.deepEqual(tick.effects, []);

  const forged = {
    ...createInitialState(),
    completedFocusCount: 2,
    phaseSequence: 0
  } as PomodoroState;
  const rejected = transition(forged, { type: "tick" }, config, 100_000);
  assert.equal(rejected.state, forged);
  assert.equal(rejected.rejection?.code, "invalid-state");
  assert.deepEqual(rejected.effects, []);
});

test("state variants reject missing and extraneous runtime fields", () => {
  const idleWithDeadline = {
    ...createInitialState(),
    deadlineAtMs: 10_000
  } as PomodoroState;
  const idleResult = transition(idleWithDeadline, { type: "tick" }, config, 10_000);
  assert.equal(idleResult.state, idleWithDeadline);
  assert.equal(idleResult.rejection?.code, "invalid-state");
  assert.deepEqual(idleResult.effects, []);

  const started = startFocus();
  assert.equal(started.state.kind, "focus-running");
  const runningWithPendingBreak = {
    ...started.state,
    pendingBreakKind: "short"
  } as PomodoroState;
  const runningResult = transition(
    runningWithPendingBreak,
    { type: "tick" },
    config,
    10_000
  );
  assert.equal(runningResult.state, runningWithPendingBreak);
  assert.equal(runningResult.rejection?.code, "invalid-state");
  assert.deepEqual(runningResult.effects, []);

  const missingCycleInstance = { ...createInitialState() } as Record<string, unknown>;
  delete missingCycleInstance.cycleInstance;
  const missingResult = transition(
    missingCycleInstance as unknown as PomodoroState,
    { type: "tick" },
    config,
    10_000
  );
  assert.equal(missingResult.rejection?.code, "invalid-state");
  assert.deepEqual(missingResult.effects, []);
});

test("state relationships follow completed-count and phase-sequence invariants", () => {
  const started = startFocus();
  assert.equal(started.state.kind, "focus-running");
  if (started.state.kind !== "focus-running") {
    throw new Error("Expected running focus.");
  }
  const completedRunning = {
    ...started.state,
    completedFocusCount: started.state.phaseSequence
  } as PomodoroState;
  const runningResult = transition(
    completedRunning,
    { type: "tick" },
    config,
    started.state.deadlineAtMs
  );
  assert.equal(runningResult.rejection?.code, "invalid-state");
  assert.deepEqual(runningResult.effects, []);

  const manualBreakConfig = { ...config, autoStartBreak: false };
  const pendingBreak = finishFocus(started.state, 10_000, manualBreakConfig);
  assert.equal(pendingBreak.state.kind, "focus-paused");
  assert.equal(pendingBreak.state.reason, "awaiting-break-start");
  const zeroCompletedPending = {
    ...pendingBreak.state,
    completedFocusCount: 0
  } as PomodoroState;
  const pendingResult = transition(
    zeroCompletedPending,
    { type: "start-break" },
    manualBreakConfig,
    10_100
  );
  assert.equal(pendingResult.rejection?.code, "invalid-state");
  assert.deepEqual(pendingResult.effects, []);
});

test("focus countdown is deadline-based and consumes from full to empty", () => {
  const started = startFocus();
  assert.equal(started.state.kind, "focus-running");
  assert.equal(progressAt(started.state, 0), 1);
  assert.equal(remainingMsAt(started.state, 2_500), 7_500);
  assert.equal(progressAt(started.state, 2_500), 0.75);
  assert.equal(remainingMsAt(started.state, 50_000), 0);
  assert.equal(progressAt(started.state, 50_000), 0);
});

test("manual Promethee pause and resume preserve frozen remaining progress", () => {
  const started = startFocus();
  const paused = transition(started.state, { type: "promethee-paused" }, config, 4_000);

  assert.equal(paused.state.kind, "focus-paused");
  assert.equal(paused.state.reason, "promethee-paused");
  assert.equal(remainingMsAt(paused.state, 40_000), 6_000);
  assert.equal(progressAt(paused.state, 40_000), 0.6);

  const resumed = transition(paused.state, { type: "promethee-played" }, config, 20_000);
  assert.equal(resumed.state.kind, "focus-running");
  if (resumed.state.kind === "focus-running") {
    assert.equal(resumed.state.durationMs, 10_000);
    assert.equal(resumed.state.deadlineAtMs, 26_000);
  }
  assert.equal(remainingMsAt(resumed.state, 20_000), 6_000);
  assert.equal(progressAt(resumed.state, 20_000), 0.6);
});

test("focus completion emits one pause request and waits for confirmation", () => {
  const started = startFocus();
  const elapsed = transition(started.state, { type: "tick" }, config, 10_000);

  assert.equal(elapsed.state.kind, "focus-paused");
  assert.equal(elapsed.state.reason, "awaiting-promethee-pause");
  assert.equal(elapsed.state.completedFocusCount, 0);
  assert.equal(elapsed.effects.length, 1);
  const pauseEffect = elapsed.effects[0];
  assert.equal(pauseEffect?.type, "pause-promethee-requested");
  if (
    elapsed.state.kind !== "focus-paused" ||
    elapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected focus to await Promethee pause.");
  }
  if (!pauseEffect || pauseEffect.type !== "pause-promethee-requested") {
    throw new Error("Expected pause effect.");
  }
  assert.equal(pauseEffect.pauseRequestId, elapsed.state.pauseRequestId);
  assert.equal(pauseEffect.phaseId, elapsed.state.phaseId);

  const duplicateTick = transition(elapsed.state, { type: "tick" }, config, 10_500);
  assert.equal(duplicateTick.state, elapsed.state);
  assert.deepEqual(duplicateTick.effects, []);

  const confirmed = transition(
    elapsed.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: elapsed.state.pauseRequestId
    },
    config,
    10_100
  );
  assert.equal(confirmed.state.kind, "break-running");
  assert.equal(confirmed.state.completedFocusCount, 1);
  if (confirmed.state.kind === "break-running") {
    assert.equal(confirmed.state.breakKind, "short");
    assert.equal(confirmed.state.startedAtMs, 10_100);
  }
});

test("pause confirmation requires the exact stable request identity", () => {
  const started = startFocus();
  const elapsed = transition(started.state, { type: "tick" }, config, 10_000);
  assert.equal(elapsed.state.kind, "focus-paused");
  assert.equal(elapsed.state.reason, "awaiting-promethee-pause");
  if (
    elapsed.state.kind !== "focus-paused" ||
    elapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected an awaiting pause request.");
  }

  const mismatch = transition(
    elapsed.state,
    { type: "promethee-pause-confirmed", pauseRequestId: "pause:stale" },
    config,
    10_100
  );
  assert.equal(mismatch.state, elapsed.state);
  assert.equal(mismatch.rejection?.code, "mismatched-pause-request");
  assert.deepEqual(mismatch.effects, []);

  const confirmed = transition(
    mismatch.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: elapsed.state.pauseRequestId
    },
    config,
    10_101
  );
  assert.equal(confirmed.state.kind, "break-running");

  const duplicate = transition(
    confirmed.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: elapsed.state.pauseRequestId
    },
    config,
    10_102
  );
  assert.equal(duplicate.state, confirmed.state);
  assert.deepEqual(duplicate.effects, []);
});

test("a stale first-focus confirmation cannot confirm the second focus", () => {
  const firstFocus = startFocus();
  const firstElapsed = transition(firstFocus.state, { type: "tick" }, config, 10_000);
  assert.equal(firstElapsed.state.kind, "focus-paused");
  assert.equal(firstElapsed.state.reason, "awaiting-promethee-pause");
  if (
    firstElapsed.state.kind !== "focus-paused" ||
    firstElapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected first pause request.");
  }
  const firstRequestId = firstElapsed.state.pauseRequestId;
  const firstConfirmed = transition(
    firstElapsed.state,
    { type: "promethee-pause-confirmed", pauseRequestId: firstRequestId },
    config,
    10_050
  );

  const secondFocus = transition(
    firstConfirmed.state,
    { type: "promethee-played" },
    config,
    11_000
  );
  assert.equal(secondFocus.state.kind, "focus-running");
  const secondElapsed = transition(secondFocus.state, { type: "tick" }, config, 21_000);
  assert.equal(secondElapsed.state.kind, "focus-paused");
  assert.equal(secondElapsed.state.reason, "awaiting-promethee-pause");
  if (
    secondElapsed.state.kind !== "focus-paused" ||
    secondElapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected second pause request.");
  }

  assert.notEqual(secondElapsed.state.pauseRequestId, firstRequestId);
  assert.notEqual(secondElapsed.state.phaseId, firstElapsed.state.phaseId);

  const stale = transition(
    secondElapsed.state,
    { type: "promethee-pause-confirmed", pauseRequestId: firstRequestId },
    config,
    21_050
  );
  assert.equal(stale.state, secondElapsed.state);
  assert.equal(stale.rejection?.code, "mismatched-pause-request");

  const secondConfirmed = transition(
    stale.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: secondElapsed.state.pauseRequestId
    },
    config,
    21_051
  );
  assert.equal(secondConfirmed.state.kind, "break-running");
  assert.equal(secondConfirmed.state.completedFocusCount, 2);
});

test("reset advances serialized cycle identity and rejects a pre-reset acknowledgement", () => {
  const firstFocus = startFocus();
  const firstElapsed = transition(firstFocus.state, { type: "tick" }, config, 10_000);
  assert.equal(firstElapsed.state.kind, "focus-paused");
  assert.equal(firstElapsed.state.reason, "awaiting-promethee-pause");
  if (
    firstElapsed.state.kind !== "focus-paused" ||
    firstElapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected pre-reset pause request.");
  }
  const oldRequestId = firstElapsed.state.pauseRequestId;
  const oldCycleInstance = firstElapsed.state.cycleInstance;

  const reset = transition(firstElapsed.state, { type: "reset-cycle" }, config, 10_001);
  assert.equal(reset.state.kind, "idle");
  assert.equal(reset.state.cycleInstance, oldCycleInstance + 1);
  assert.equal(
    JSON.parse(JSON.stringify(reset.state)).cycleInstance,
    oldCycleInstance + 1
  );

  const staleImmediatelyAfterReset = transition(
    reset.state,
    { type: "promethee-pause-confirmed", pauseRequestId: oldRequestId },
    config,
    10_002
  );
  assert.equal(staleImmediatelyAfterReset.state, reset.state);
  assert.equal(
    staleImmediatelyAfterReset.rejection?.code,
    "invalid-event-for-state"
  );
  assert.deepEqual(staleImmediatelyAfterReset.effects, []);

  const secondFocus = transition(
    reset.state,
    { type: "promethee-played" },
    config,
    10_003
  );
  assert.equal(secondFocus.state.kind, "focus-running");
  const secondElapsed = transition(secondFocus.state, { type: "tick" }, config, 20_003);
  assert.equal(secondElapsed.state.kind, "focus-paused");
  assert.equal(secondElapsed.state.reason, "awaiting-promethee-pause");
  if (
    secondElapsed.state.kind !== "focus-paused" ||
    secondElapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected post-reset pause request.");
  }
  assert.notEqual(secondElapsed.state.pauseRequestId, oldRequestId);

  const stale = transition(
    secondElapsed.state,
    { type: "promethee-pause-confirmed", pauseRequestId: oldRequestId },
    config,
    20_004
  );
  assert.equal(stale.state, secondElapsed.state);
  assert.equal(stale.rejection?.code, "mismatched-pause-request");
  assert.deepEqual(stale.effects, []);
});

test("authoritative play cannot escape a pending automatic pause", () => {
  const focus = startFocus();
  const awaitingPause = transition(focus.state, { type: "tick" }, config, 10_000);
  assert.equal(awaitingPause.state.kind, "focus-paused");
  assert.equal(awaitingPause.state.reason, "awaiting-promethee-pause");

  const played = transition(
    awaitingPause.state,
    { type: "promethee-played" },
    config,
    10_001
  );
  assert.equal(played.state, awaitingPause.state);
  assert.equal(played.rejection?.code, "invalid-event-for-state");
  assert.deepEqual(played.effects, []);
});

test("authoritative pause at the exact focus deadline confirms completion without another request", () => {
  const started = startFocus();
  const result = transition(started.state, { type: "promethee-paused" }, config, 10_000);

  assert.equal(result.state.kind, "break-running");
  assert.equal(result.state.completedFocusCount, 1);
  assert.deepEqual(result.effects, []);
});

test("skipping a running focus waits for pause, earns no credit, and always selects short break", () => {
  const started = startFocus();
  const skipped = transition(started.state, { type: "skip-focus" }, config, 4_000);
  assert.equal(skipped.state.kind, "focus-paused");
  assert.equal(skipped.state.reason, "awaiting-promethee-pause");
  assert.equal(skipped.state.completedFocusCount, 0);
  assert.equal(skipped.effects[0]?.type, "pause-promethee-requested");
  if (
    skipped.state.kind !== "focus-paused" ||
    skipped.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected skipped focus to await pause.");
  }
  assert.equal(skipped.state.breakSource, "skipped-focus");

  const confirmed = transition(
    skipped.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: skipped.state.pauseRequestId
    },
    config,
    4_100
  );
  assert.equal(confirmed.state.kind, "break-running");
  assert.equal(confirmed.state.completedFocusCount, 0);
  if (confirmed.state.kind !== "break-running") {
    throw new Error("Expected skipped focus to start break.");
  }
  assert.equal(confirmed.state.breakKind, "short");
  assert.equal(confirmed.state.breakSource, "skipped-focus");

  const nextFocus = transition(
    confirmed.state,
    { type: "promethee-played" },
    config,
    4_200
  );
  const nextBreak = finishFocus(nextFocus.state, 14_200);
  assert.equal(nextBreak.state.completedFocusCount, 1);
  assert.equal(nextBreak.state.kind, "break-running");
  if (nextBreak.state.kind === "break-running") {
    assert.equal(nextBreak.state.breakKind, "short");
    assert.equal(nextBreak.state.breakSource, "completed-focus");
  }
});

test("skipping an authoritatively paused focus is local for both break-start policies", () => {
  const running = startFocus();
  const paused = transition(running.state, { type: "promethee-paused" }, config, 2_000);
  const automatic = transition(paused.state, { type: "skip-focus" }, config, 2_100);
  assert.equal(automatic.state.kind, "break-running");
  assert.equal(automatic.state.completedFocusCount, 0);
  assert.deepEqual(automatic.effects, []);
  if (automatic.state.kind === "break-running") {
    assert.equal(automatic.state.breakKind, "short");
    assert.equal(automatic.state.breakSource, "skipped-focus");
  }

  const manualConfig = { ...config, autoStartBreak: false };
  const manualRunning = startFocus(createInitialState(), 0, manualConfig);
  const manualPaused = transition(
    manualRunning.state,
    { type: "promethee-paused" },
    manualConfig,
    2_000
  );
  const pending = transition(
    manualPaused.state,
    { type: "skip-focus" },
    manualConfig,
    2_100
  );
  assert.equal(pending.state.kind, "focus-paused");
  assert.equal(pending.state.reason, "awaiting-break-start");
  assert.equal(pending.state.completedFocusCount, 0);
  assert.deepEqual(pending.effects, []);
  if (
    pending.state.kind !== "focus-paused" ||
    pending.state.reason !== "awaiting-break-start"
  ) {
    throw new Error("Expected skipped focus to await explicit break start.");
  }
  assert.equal(pending.state.pendingBreakKind, "short");
  assert.equal(pending.state.breakSource, "skipped-focus");

  const startedBreak = transition(
    pending.state,
    { type: "start-break" },
    manualConfig,
    2_200
  );
  assert.equal(startedBreak.state.kind, "break-running");
  assert.equal(startedBreak.state.completedFocusCount, 0);
  assert.deepEqual(startedBreak.effects, []);
});

test("skip-focus is rejected outside an active running or manually paused focus", () => {
  const running = startFocus();
  const awaitingPause = transition(running.state, { type: "tick" }, config, 10_000);
  const breakRunning = finishFocus(running.state, 10_000);
  const ready = transition(breakRunning.state, { type: "skip-break" }, config, 10_100);
  const manualConfig = { ...config, autoStartBreak: false };
  const awaitingBreak = finishFocus(running.state, 10_000, manualConfig);

  for (const state of [
    createInitialState(),
    awaitingPause.state,
    awaitingBreak.state,
    breakRunning.state,
    ready.state
  ]) {
    const result = transition(state, { type: "skip-focus" }, config, 10_200);
    assert.equal(result.state, state);
    assert.equal(result.rejection?.code, "invalid-event-for-state");
    assert.deepEqual(result.effects, []);
  }
});

test("skip-focus at the deadline is natural completion rather than skipped credit", () => {
  const running = startFocus();
  const elapsed = transition(running.state, { type: "skip-focus" }, config, 10_000);
  assert.equal(elapsed.state.kind, "focus-paused");
  assert.equal(elapsed.state.reason, "awaiting-promethee-pause");
  if (
    elapsed.state.kind !== "focus-paused" ||
    elapsed.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected natural deadline pause.");
  }
  assert.equal(elapsed.state.breakSource, "completed-focus");
  const confirmed = transition(
    elapsed.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: elapsed.state.pauseRequestId
    },
    config,
    10_001
  );
  assert.equal(confirmed.state.completedFocusCount, 1);
});

test("automatic break start can wait for an explicit Start break action", () => {
  const manualBreakConfig = { ...config, autoStartBreak: false };
  const started = startFocus(createInitialState(), 0, manualBreakConfig);
  const pending = finishFocus(started.state, 10_000, manualBreakConfig);

  assert.equal(pending.state.kind, "focus-paused");
  assert.equal(pending.state.reason, "awaiting-break-start");
  assert.equal(progressAt(pending.state, 99_000), 0);

  const breakStarted = transition(
    pending.state,
    { type: "start-break" },
    manualBreakConfig,
    12_000
  );
  assert.equal(breakStarted.state.kind, "break-running");
  assert.equal(progressAt(breakStarted.state, 12_000), 1);
});

test("break consumes to Ready and emits completion only once", () => {
  const focus = startFocus();
  const breakStarted = finishFocus(focus.state, 10_000);
  assert.equal(breakStarted.state.kind, "break-running");
  if (breakStarted.state.kind !== "break-running") {
    return;
  }

  const midpoint = breakStarted.state.startedAtMs + 2_000;
  assert.equal(progressAt(breakStarted.state, midpoint), 0.5);

  const completed = transition(
    breakStarted.state,
    { type: "tick" },
    config,
    breakStarted.state.deadlineAtMs
  );
  assert.equal(completed.state.kind, "ready");
  assert.equal(completed.effects[0]?.type, "break-completed");
  if (completed.state.kind !== "ready") {
    throw new Error("Expected Ready state.");
  }
  assert.equal(completed.state.breakSource, "completed-focus");
  assert.equal(
    completed.effects[0]?.type === "break-completed"
      ? completed.effects[0].readyOccurrenceId
      : null,
    completed.state.readyOccurrenceId
  );

  const replayedCompletion = transition(
    breakStarted.state,
    { type: "tick" },
    config,
    breakStarted.state.deadlineAtMs + 500
  );
  assert.equal(replayedCompletion.state.kind, "ready");
  if (replayedCompletion.state.kind === "ready") {
    assert.equal(
      replayedCompletion.state.readyOccurrenceId,
      completed.state.readyOccurrenceId
    );
  }

  const duplicateTick = transition(completed.state, { type: "tick" }, config, 99_000);
  assert.deepEqual(duplicateTick.effects, []);
  assert.equal(duplicateTick.state.kind, "ready");
  if (duplicateTick.state.kind === "ready") {
    assert.equal(duplicateTick.state.readyOccurrenceId, completed.state.readyOccurrenceId);
  }
  const dismissed = transition(
    duplicateTick.state,
    { type: "ready-dismissed" },
    config,
    99_001
  );
  assert.equal(dismissed.state.kind, "ready");
  if (dismissed.state.kind === "ready") {
    assert.equal(dismissed.state.readyOccurrenceId, completed.state.readyOccurrenceId);
    assert.deepEqual(JSON.parse(JSON.stringify(dismissed.state)), dismissed.state);
  }
});

test("skipped break commits stable Ready identity without a completion effect", () => {
  const running = startFocus();
  const skippedFocus = transition(running.state, { type: "skip-focus" }, config, 2_000);
  assert.equal(skippedFocus.state.kind, "focus-paused");
  assert.equal(skippedFocus.state.reason, "awaiting-promethee-pause");
  if (
    skippedFocus.state.kind !== "focus-paused" ||
    skippedFocus.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected skipped focus pause.");
  }
  const breakRunning = transition(
    skippedFocus.state,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: skippedFocus.state.pauseRequestId
    },
    config,
    2_100
  );
  const ready = transition(breakRunning.state, { type: "skip-break" }, config, 2_200);
  assert.equal(ready.state.kind, "ready");
  assert.deepEqual(ready.effects, []);
  if (ready.state.kind === "ready") {
    assert.equal(ready.state.completedFocusCount, 0);
    assert.equal(ready.state.completedBreakKind, "short");
    assert.equal(ready.state.breakSource, "skipped-focus");
    assert.match(ready.state.readyOccurrenceId, /^ready:cycle:/);

    const forged = {
      ...ready.state,
      readyOccurrenceId: "ready:forged"
    } as PomodoroState;
    const rejected = transition(forged, { type: "tick" }, config, 2_300);
    assert.equal(rejected.rejection?.code, "invalid-state");
    assert.deepEqual(rejected.effects, []);
  }
});

test("only authoritative Promethee play can start focus from Ready", () => {
  const focus = startFocus();
  const breakStarted = finishFocus(focus.state, 10_000);
  assert.equal(breakStarted.state.kind, "break-running");
  if (breakStarted.state.kind !== "break-running") {
    throw new Error("Expected running break.");
  }
  const ready = transition(
    breakStarted.state,
    { type: "tick" },
    config,
    breakStarted.state.deadlineAtMs
  );
  assert.equal(ready.state.kind, "ready");

  const localStart = transition(ready.state, { type: "start-focus" }, config, 20_000);
  assert.equal(localStart.state, ready.state);
  assert.equal(localStart.rejection?.code, "invalid-event-for-state");
  assert.deepEqual(localStart.effects, []);

  const authoritativePlay = transition(
    ready.state,
    { type: "promethee-played" },
    config,
    20_001
  );
  assert.equal(authoritativePlay.state.kind, "focus-running");
  assert.equal(remainingMsAt(authoritativePlay.state, 20_001), config.focusDurationMs);
});

test("Promethee play during break starts a full new focus", () => {
  const focus = startFocus();
  const breakStarted = finishFocus(focus.state, 10_000);
  assert.equal(breakStarted.state.kind, "break-running");

  const played = transition(
    breakStarted.state,
    { type: "promethee-played" },
    config,
    11_000
  );
  assert.equal(played.state.kind, "focus-running");
  if (played.state.kind === "focus-running") {
    assert.equal(played.state.durationMs, config.focusDurationMs);
    assert.equal(played.state.deadlineAtMs, 21_000);
  }
  assert.equal(progressAt(played.state, 11_000), 1);
});

test("Promethee play while break is pending or Ready starts a full focus", () => {
  const manualBreakConfig = { ...config, autoStartBreak: false };
  const firstFocus = startFocus(createInitialState(), 0, manualBreakConfig);
  const pending = finishFocus(firstFocus.state, 10_000, manualBreakConfig);
  const playedFromPending = transition(
    pending.state,
    { type: "promethee-played" },
    manualBreakConfig,
    11_000
  );
  assert.equal(playedFromPending.state.kind, "focus-running");
  assert.equal(remainingMsAt(playedFromPending.state, 11_000), config.focusDurationMs);

  const secondPending = finishFocus(playedFromPending.state, 21_000, manualBreakConfig);
  const skipped = transition(
    secondPending.state,
    { type: "skip-break" },
    manualBreakConfig,
    21_100
  );
  assert.equal(skipped.state.kind, "ready");

  const playedFromReady = transition(
    skipped.state,
    { type: "promethee-played" },
    manualBreakConfig,
    22_000
  );
  assert.equal(playedFromReady.state.kind, "focus-running");
  assert.equal(remainingMsAt(playedFromReady.state, 22_000), config.focusDurationMs);
});

test("long break cadence uses acknowledged completed focuses only", () => {
  const firstFocus = startFocus();
  const firstBreak = finishFocus(firstFocus.state, 10_000);
  assert.equal(firstBreak.state.kind, "break-running");
  if (firstBreak.state.kind === "break-running") {
    assert.equal(firstBreak.state.breakKind, "short");
  }

  const secondFocus = transition(
    firstBreak.state,
    { type: "promethee-played" },
    config,
    11_000
  );
  const secondBreak = finishFocus(secondFocus.state, 21_000);
  assert.equal(secondBreak.state.kind, "break-running");
  assert.equal(secondBreak.state.completedFocusCount, 2);
  if (secondBreak.state.kind === "break-running") {
    assert.equal(secondBreak.state.breakKind, "long");
    assert.equal(secondBreak.state.durationMs, config.longBreakDurationMs);
  }
});

test("restart applies the new configured duration without incrementing cadence", () => {
  const started = startFocus();
  const changedConfig = { ...config, focusDurationMs: 20_000 };
  const restarted = transition(
    started.state,
    { type: "restart-phase" },
    changedConfig,
    3_000
  );

  assert.equal(restarted.state.kind, "focus-running");
  assert.equal(restarted.state.completedFocusCount, 0);
  if (restarted.state.kind === "focus-running") {
    assert.equal(restarted.state.durationMs, 20_000);
    assert.equal(restarted.state.deadlineAtMs, 23_000);
  }
});

test("restart behavior is explicit for every paused focus reason", () => {
  const changedConfig = { ...config, focusDurationMs: 20_000 };

  const running = startFocus();
  const manuallyPaused = transition(
    running.state,
    { type: "promethee-paused" },
    config,
    4_000
  );
  assert.equal(manuallyPaused.state.kind, "focus-paused");
  assert.equal(manuallyPaused.state.reason, "promethee-paused");
  const restartedPaused = transition(
    manuallyPaused.state,
    { type: "restart-phase" },
    changedConfig,
    5_000
  );
  assert.equal(restartedPaused.state.kind, "focus-paused");
  assert.equal(restartedPaused.state.reason, "promethee-paused");
  if (
    restartedPaused.state.kind === "focus-paused" &&
    restartedPaused.state.reason === "promethee-paused"
  ) {
    assert.equal(restartedPaused.state.durationMs, 20_000);
    assert.equal(restartedPaused.state.remainingMs, 20_000);
  }

  const awaitingPause = transition(running.state, { type: "tick" }, config, 10_000);
  assert.equal(awaitingPause.state.kind, "focus-paused");
  assert.equal(awaitingPause.state.reason, "awaiting-promethee-pause");
  const rejectedAwaitingPause = transition(
    awaitingPause.state,
    { type: "restart-phase" },
    changedConfig,
    10_001
  );
  assert.equal(rejectedAwaitingPause.state, awaitingPause.state);
  assert.equal(rejectedAwaitingPause.rejection?.code, "invalid-event-for-state");

  const manualBreakConfig = { ...config, autoStartBreak: false };
  const pendingBreak = finishFocus(running.state, 10_000, manualBreakConfig);
  assert.equal(pendingBreak.state.kind, "focus-paused");
  assert.equal(pendingBreak.state.reason, "awaiting-break-start");
  const rejectedPendingBreak = transition(
    pendingBreak.state,
    { type: "restart-phase" },
    changedConfig,
    10_100
  );
  assert.equal(rejectedPendingBreak.state, pendingBreak.state);
  assert.equal(rejectedPendingBreak.rejection?.code, "invalid-event-for-state");
});

test("only authoritative Promethee play can leave awaiting-break-start for focus", () => {
  const manualBreakConfig = { ...config, autoStartBreak: false };
  const running = startFocus(createInitialState(), 0, manualBreakConfig);
  const pendingBreak = finishFocus(running.state, 10_000, manualBreakConfig);
  assert.equal(pendingBreak.state.kind, "focus-paused");
  assert.equal(pendingBreak.state.reason, "awaiting-break-start");

  const localStart = transition(
    pendingBreak.state,
    { type: "start-focus" },
    manualBreakConfig,
    10_100
  );
  assert.equal(localStart.state, pendingBreak.state);
  assert.equal(localStart.rejection?.code, "invalid-event-for-state");

  const authoritativePlay = transition(
    pendingBreak.state,
    { type: "promethee-played" },
    manualBreakConfig,
    10_101
  );
  assert.equal(authoritativePlay.state.kind, "focus-running");
  assert.equal(remainingMsAt(authoritativePlay.state, 10_101), config.focusDurationMs);
});

test("Promethee stop returns to idle and reset clears cycle cadence", () => {
  const focus = startFocus();
  const firstBreak = finishFocus(focus.state, 10_000);
  const nextFocus = transition(
    firstBreak.state,
    { type: "promethee-played" },
    config,
    11_000
  );

  const stopped = transition(
    nextFocus.state,
    { type: "promethee-stopped" },
    config,
    12_000
  );
  assert.equal(stopped.state.kind, "idle");
  assert.equal(stopped.state.completedFocusCount, 1);
  assert.deepEqual(stopped.effects, []);

  const reset = transition(stopped.state, { type: "reset-cycle" }, config, 12_001);
  assert.equal(reset.state.kind, "idle");
  assert.equal(reset.state.completedFocusCount, 0);
  assert.equal(reset.state.phaseSequence, 0);
  assert.equal(reset.state.cycleInstance, stopped.state.cycleInstance + 1);
});

test("transitions are deterministic and state is JSON serializable", () => {
  const started = startFocus();
  const first = transition(started.state, { type: "tick" }, config, 10_000);
  const second = transition(started.state, { type: "tick" }, config, 10_000);

  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first.state)), first.state);
  assert.deepEqual(JSON.parse(JSON.stringify(first.effects)), first.effects);
});

test("timestamps and deadline addition fail safely at numeric boundaries", () => {
  const state = createInitialState();
  for (const invalidTime of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const result = transition(state, { type: "start-focus" }, config, invalidTime);
    assert.equal(result.state, state);
    assert.equal(result.rejection?.code, "invalid-time");
    assert.deepEqual(result.effects, []);
  }

  const overflow = transition(
    state,
    { type: "start-focus" },
    config,
    Number.MAX_SAFE_INTEGER
  );
  assert.equal(overflow.state, state);
  assert.equal(overflow.rejection?.code, "invalid-time");

  assert.equal(checkedDeadlineAt(0, 1_000), 1_000);
  assert.equal(checkedDeadlineAt(-1, 1_000), null);
  assert.equal(checkedDeadlineAt(Number.MAX_SAFE_INTEGER, 1_000), null);
});

test("remaining and progress selectors never return NaN for invalid or backward time", () => {
  const started = startFocus(createInitialState(), 10_000);
  assert.equal(started.state.kind, "focus-running");

  assert.equal(remainingMsAt(started.state, 0), config.focusDurationMs);
  assert.equal(progressAt(started.state, 0), 1);
  assert.equal(remainingMsAt(started.state, Number.MAX_SAFE_INTEGER), 0);
  assert.equal(progressAt(started.state, Number.MAX_SAFE_INTEGER), 0);
  assert.equal(remainingMsAt(started.state, -1), null);
  assert.equal(progressAt(started.state, Number.MAX_SAFE_INTEGER + 1), null);

  const invalidDeadline = {
    ...started.state,
    deadlineAtMs: Number.POSITIVE_INFINITY
  } as PomodoroState;
  const invalidDuration = { ...started.state, durationMs: 0 } as PomodoroState;

  for (const invalidState of [invalidDeadline, invalidDuration]) {
    const remaining = remainingMsAt(invalidState, 10_000);
    const progress = progressAt(invalidState, 10_000);
    assert.equal(remaining, null);
    assert.equal(progress, null);
    assert.equal(Number.isNaN(remaining), false);
    assert.equal(Number.isNaN(progress), false);
  }
});

test("runtime state validation blocks every transition effect from corrupt state", () => {
  const started = startFocus();
  assert.equal(started.state.kind, "focus-running");
  if (started.state.kind !== "focus-running") {
    throw new Error("Expected running focus.");
  }

  const corruptRunningStates = [
    { ...started.state, deadlineAtMs: -1 },
    { ...started.state, deadlineAtMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...started.state, phaseId: "cycle:wrong:focus:wrong" },
    { ...started.state, cycleInstance: 0 },
    { ...started.state, phaseSequence: -1 }
  ] as unknown as PomodoroState[];

  for (const corruptState of corruptRunningStates) {
    const result = transition(
      corruptState,
      { type: "tick" },
      config,
      Number.MAX_SAFE_INTEGER
    );
    assert.equal(result.state, corruptState);
    assert.equal(result.rejection?.code, "invalid-state");
    assert.deepEqual(result.effects, []);

    const resetAttempt = transition(
      corruptState,
      { type: "reset-cycle" },
      config,
      0
    );
    assert.equal(resetAttempt.state, corruptState);
    assert.equal(resetAttempt.rejection?.code, "invalid-state");
    assert.deepEqual(resetAttempt.effects, []);
  }

  const awaitingPause = transition(started.state, { type: "tick" }, config, 10_000);
  assert.equal(awaitingPause.state.kind, "focus-paused");
  assert.equal(awaitingPause.state.reason, "awaiting-promethee-pause");
  if (
    awaitingPause.state.kind !== "focus-paused" ||
    awaitingPause.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected awaiting pause state.");
  }
  const corruptAwaiting = {
    ...awaitingPause.state,
    pauseRequestId: "pause:corrupt"
  } as PomodoroState;
  const falseConfirmation = transition(
    corruptAwaiting,
    { type: "promethee-pause-confirmed", pauseRequestId: "pause:corrupt" },
    config,
    10_001
  );
  assert.equal(falseConfirmation.state, corruptAwaiting);
  assert.equal(falseConfirmation.rejection?.code, "invalid-state");
  assert.deepEqual(falseConfirmation.effects, []);

  const validBreak = finishFocus(started.state, 10_000);
  assert.equal(validBreak.state.kind, "break-running");
  if (validBreak.state.kind !== "break-running") {
    throw new Error("Expected break state.");
  }
  const corruptBreak = {
    ...validBreak.state,
    completedFocusCount: -1
  } as PomodoroState;
  const falseBreakCompletion = transition(
    corruptBreak,
    { type: "tick" },
    config,
    validBreak.state.deadlineAtMs
  );
  assert.equal(falseBreakCompletion.state, corruptBreak);
  assert.equal(falseBreakCompletion.rejection?.code, "invalid-state");
  assert.deepEqual(falseBreakCompletion.effects, []);
});
