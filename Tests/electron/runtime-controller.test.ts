import assert from "node:assert/strict";
import test from "node:test";

import {
  ExternalPomodoroRuntime,
  type RuntimeControlAction,
  type RuntimeControlPort,
  type RuntimeSettings
} from "../../src/electron/runtime-controller.ts";
import type { PrometheeSessionObservation } from "../../src/electron/promethee-sqlite.ts";

const START = 1_800_000_000_000;
const SETTINGS: RuntimeSettings = Object.freeze({
  autoPausePromethee: true,
  autoResumePromethee: false,
  autoStartBreak: true,
  focusDurationMs: 25 * 60_000,
  focusesPerLongBreak: 4,
  longBreakDurationMs: 15 * 60_000,
  shortBreakDurationMs: 5 * 60_000
});

class RecordingControl implements RuntimeControlPort {
  readonly calls: RuntimeControlAction[] = [];
  result: "indeterminate" | "not-sent" | "sent-unconfirmed" = "sent-unconfirmed";

  async dispatch(action: RuntimeControlAction): Promise<{ readonly execution: "indeterminate" | "not-sent" | "sent-unconfirmed" }> {
    this.calls.push(action);
    return { execution: this.result };
  }
}

test("starts a full focus from a running Promethee session", async () => {
  const runtime = new ExternalPomodoroRuntime({ control: new RecordingControl(), settings: SETTINGS });
  await runtime.ingest(running(START), START);

  assert.deepEqual(runtime.view(START), {
    availability: "live",
    completedFocusCount: 0,
    durationMs: SETTINGS.focusDurationMs,
    lastAutomation: null,
    phase: "focus",
    progress: 1,
    remainingMs: SETTINGS.focusDurationMs,
    sessionId: "session-1",
    sessionState: "running"
  });
});

test("restarts the current Pomodoro phase without controlling Promethee", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  await runtime.ingest(running(START), START);

  const restarted = await runtime.restartPhase(START + 5 * 60_000);

  assert.equal(restarted?.phase, "focus");
  assert.equal(restarted?.remainingMs, SETTINGS.focusDurationMs);
  assert.deepEqual(control.calls, []);
});

test("skips the current focus through the existing Pause authority and skips a break locally", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  await runtime.ingest(running(START), START);

  const awaitingPause = await runtime.skipPhase(START + 60_000);
  assert.equal(awaitingPause?.phase, "awaiting-pause");
  assert.deepEqual(control.calls, ["pause"]);

  const breakStart = START + 61_000;
  await runtime.ingest(paused(breakStart), breakStart);
  assert.equal(runtime.view(breakStart).phase, "short-break");
  const ready = await runtime.skipPhase(breakStart + 1_000);
  assert.equal(ready?.phase, "ready");
  assert.deepEqual(control.calls, ["pause"]);
});

test("keeps focus active when Skip cannot dispatch Pause instead of hanging in Pausing", async () => {
  const control = new RecordingControl();
  control.result = "not-sent";
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  await runtime.ingest(running(START), START);

  assert.equal(await runtime.skipPhase(START + 60_000), null);
  assert.equal(runtime.view(START + 60_000).phase, "focus");
  assert.equal(runtime.state.kind, "focus-running");
  assert.equal(runtime.view(START + 60_000).lastAutomation?.execution, "not-sent");

  assert.equal(await runtime.skipPhase(START + 61_000), null);
  assert.deepEqual(control.calls, ["pause", "pause"]);
});

test("keeps focus active when Skip Pause automation is disabled", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({
    control,
    settings: { ...SETTINGS, autoPausePromethee: false }
  });
  await runtime.ingest(running(START), START);

  assert.equal(await runtime.skipPhase(START + 60_000), null);
  assert.equal(runtime.view(START + 60_000).phase, "focus");
  assert.equal(runtime.view(START + 60_000).lastAutomation?.execution, "disabled");
  assert.deepEqual(control.calls, []);
});

test("skips an explicitly pending break to Ready when automatic break start is disabled", async () => {
  const runtime = new ExternalPomodoroRuntime({
    control: new RecordingControl(),
    settings: { ...SETTINGS, autoStartBreak: false }
  });
  await runtime.ingest(running(START), START);
  await runtime.ingest(paused(START + 1_000), START + 1_000);

  const pendingBreak = await runtime.skipPhase(START + 2_000);
  assert.equal(pendingBreak?.phase, "focus-paused");
  assert.equal(runtime.state.kind, "focus-paused");
  if (runtime.state.kind !== "focus-paused") throw new Error("Expected pending break state.");
  assert.equal(runtime.state.reason, "awaiting-break-start");

  const ready = await runtime.skipPhase(START + 3_000);
  assert.equal(ready?.phase, "ready");
});

test("freezes a focus on manual pause and resumes the remaining focus", async () => {
  const runtime = new ExternalPomodoroRuntime({ control: new RecordingControl(), settings: SETTINGS });
  await runtime.ingest(running(START), START);
  await runtime.ingest(paused(START + 5 * 60_000), START + 5 * 60_000);

  assert.equal(runtime.view(START + 20 * 60_000).phase, "focus-paused");
  assert.equal(runtime.view(START + 20 * 60_000).remainingMs, 20 * 60_000);

  await runtime.ingest(running(START + 20 * 60_000), START + 20 * 60_000);
  assert.equal(runtime.view(START + 20 * 60_000).phase, "focus");
  assert.equal(runtime.view(START + 20 * 60_000).remainingMs, 20 * 60_000);
});

test("requests Pause once at the focus deadline and starts break from a later paused observation without retry", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  await runtime.ingest(running(START), START);
  await runtime.tick(START + SETTINGS.focusDurationMs);
  await runtime.tick(START + SETTINGS.focusDurationMs + 1_000);

  assert.deepEqual(control.calls, ["pause"]);
  assert.equal(runtime.view(START + SETTINGS.focusDurationMs).phase, "awaiting-pause");

  await runtime.ingest(paused(START + SETTINGS.focusDurationMs + 2_000), START + SETTINGS.focusDurationMs + 2_000);
  const view = runtime.view(START + SETTINGS.focusDurationMs + 2_000);
  assert.equal(view.phase, "short-break");
  assert.equal(view.remainingMs, SETTINGS.shortBreakDurationMs);
  assert.equal(view.completedFocusCount, 1);
});

test("ends a break in Ready without resuming when auto-resume is disabled", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  const breakStart = await enterBreak(runtime);
  await runtime.tick(breakStart + SETTINGS.shortBreakDurationMs);

  assert.equal(runtime.view(breakStart + SETTINGS.shortBreakDurationMs).phase, "ready");
  assert.deepEqual(control.calls, ["pause"]);
});

test("requests Resume once at break completion and begins a fresh focus when running is observed", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({
    control,
    settings: { ...SETTINGS, autoResumePromethee: true }
  });
  const breakStart = await enterBreak(runtime);
  const breakEnd = breakStart + SETTINGS.shortBreakDurationMs;
  await runtime.tick(breakEnd);
  await runtime.tick(breakEnd + 1_000);

  assert.deepEqual(control.calls, ["pause", "resume"]);
  assert.equal(runtime.view(breakEnd).phase, "awaiting-resume");

  await runtime.ingest(running(breakEnd + 2_000), breakEnd + 2_000);
  assert.equal(runtime.view(breakEnd + 2_000).phase, "focus");
  assert.equal(runtime.view(breakEnd + 2_000).remainingMs, SETTINGS.focusDurationMs);
});

test("real Play before break completion cancels the break and starts a fresh configured focus", async () => {
  const runtime = new ExternalPomodoroRuntime({ control: new RecordingControl(), settings: SETTINGS });
  const breakStart = await enterBreak(runtime);
  const earlyPlay = breakStart + 60_000;
  await runtime.ingest(running(earlyPlay), earlyPlay);

  assert.equal(runtime.view(earlyPlay).phase, "focus");
  assert.equal(runtime.view(earlyPlay).remainingMs, SETTINGS.focusDurationMs);
});

test("unknown observations disable automation without resetting or dispatching", async () => {
  const control = new RecordingControl();
  const runtime = new ExternalPomodoroRuntime({ control, settings: SETTINGS });
  await runtime.ingest(running(START), START);
  await runtime.ingest({ status: "unknown", observedAtMs: START + 1_000, reason: "read-error" }, START + 1_000);
  await runtime.tick(START + SETTINGS.focusDurationMs + 1_000);

  assert.equal(runtime.view(START + SETTINGS.focusDurationMs + 1_000).availability, "unavailable");
  assert.deepEqual(control.calls, []);
});

test("a replacement Promethee session starts an isolated fresh focus", async () => {
  const runtime = new ExternalPomodoroRuntime({ control: new RecordingControl(), settings: SETTINGS });
  await runtime.ingest(running(START), START);
  await runtime.ingest({ ...running(START + 4_000), sessionId: "session-2" }, START + 4_000);

  assert.equal(runtime.view(START + 4_000).sessionId, "session-2");
  assert.equal(runtime.view(START + 4_000).remainingMs, SETTINGS.focusDurationMs);
});

async function enterBreak(runtime: ExternalPomodoroRuntime): Promise<number> {
  await runtime.ingest(running(START), START);
  const focusEnd = START + SETTINGS.focusDurationMs;
  await runtime.tick(focusEnd);
  const breakStart = focusEnd + 2_000;
  await runtime.ingest(paused(breakStart), breakStart);
  return breakStart;
}

function running(observedAtMs: number): PrometheeSessionObservation {
  return {
    status: "observed",
    observedAtMs,
    sessionId: "session-1",
    state: "running",
    startedAtMs: START - 60_000,
    elapsedWorkMs: observedAtMs - START + 60_000,
    totalPauseMs: 0,
    pauseStartedAtMs: null
  };
}

function paused(observedAtMs: number): PrometheeSessionObservation {
  return {
    ...running(observedAtMs),
    state: "paused",
    pauseStartedAtMs: observedAtMs
  };
}
