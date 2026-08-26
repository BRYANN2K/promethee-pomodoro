import assert from "node:assert/strict";
import test from "node:test";

import {
  PrometheeAdapterV1,
  ScriptedBridgePort,
  SESSION_COORDINATION_REQUIREMENTS,
  createClientHello,
  type AdapterSignal,
  type BridgeResult,
  type ReconciliationSnapshot,
  type SessionCommand,
  type SessionCommandAcknowledgement,
  type TaskRefreshSnapshot
} from "../../src/promethee-adapter/v1/index.ts";
import {
  SessionCoordinator,
  createSessionCoordinatorState,
  reduceSessionCoordinator
} from "../../src/session-coordinator/index.ts";
import type { PomodoroConfig } from "../../src/core/index.ts";
import {
  CONNECTION_ID,
  NONCE,
  activeSession,
  bridgeHello,
  hudReadModel,
  pauseAcknowledgement,
  readModel,
  sessionChanged,
  snapshot,
  terminalEvent
} from "./fixtures.ts";

const config: PomodoroConfig = {
  focusDurationMs: 1_000,
  shortBreakDurationMs: 1_500,
  longBreakDurationMs: 2_000,
  focusesPerLongBreak: 4,
  autoStartBreak: true
};

async function connectAdapter(
  port: ScriptedBridgePort,
  sink: (signal: AdapterSignal) => void = () => undefined
) {
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS,
    sink
  );
  assert.equal(connected.ok, true);
  if (!connected.ok) {
    throw new Error("fixture connection failed");
  }
  return { adapter, bootstrap: connected.value };
}

function skippedBreakAfterPauseAcknowledgement() {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "skip-focus" }
    },
    config
  ).state;
  const pending = state.pendingPause;
  assert.notEqual(pending, null);
  const acknowledged = reduceSessionCoordinator(
    state,
    {
      type: "pause-settled",
      nowMs: 500,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          pending?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  assert.equal(acknowledged.state.pomodoro.kind, "break-running");
  assert.equal(acknowledged.state.pomodoro.completedFocusCount, 0);
  assert.equal(acknowledged.state.pendingPause, null);
  return acknowledged.state;
}

function settleReconciliationWithReplay(event: BridgeEvent) {
  const committed = {
    ...skippedBreakAfterPauseAcknowledgement(),
    lastEventOccurredAtMs: 500
  };
  const requested = reduceSessionCoordinator(
    committed,
    { type: "sequence-gap", nowMs: 550, connectionId: CONNECTION_ID },
    config
  );
  const pending = requested.state.pendingReconciliation;
  assert.notEqual(pending, null);

  return {
    committed,
    settled: reduceSessionCoordinator(
      requested.state,
      {
        type: "reconcile-settled",
        nowMs: 600,
        connectionId: pending?.connectionId ?? CONNECTION_ID,
        connectionGeneration: pending?.connectionGeneration ?? 0,
        effectToken: pending?.effectToken ?? "missing",
        result: {
          ok: true,
          value: {
            snapshot: snapshot(1, readModel(activeSession("paused", 2))),
            replayEvents: [event]
          }
        }
      },
      config
    )
  };
}

test("focus expiry cannot start break before authoritative pause acknowledgement", async () => {
  let nowMs = 0;
  let resolveAcknowledgement:
    | ((value: SessionCommandAcknowledgement) => void)
    | null = null;
  const delayed = new Promise<SessionCommandAcknowledgement>((resolve) => {
    resolveAcknowledgement = resolve;
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => delayed]
  });
  const { adapter, bootstrap } = await connectAdapter(port);
  const coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 1_000;
  await coordinator.tick(nowMs);
  assert.equal(coordinator.state.pomodoro.kind, "focus-paused");
  assert.equal(coordinator.state.pomodoro.reason, "awaiting-promethee-pause");
  assert.equal(port.calls.pauses.length, 1);

  const issued = port.calls.pauses[0];
  assert.notEqual(issued, undefined);
  resolveAcknowledgement?.(
    pauseAcknowledgement(issued?.commandId ?? "missing", activeSession("paused", 2))
  );
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  assert.equal(coordinator.state.pomodoro.completedFocusCount, 1);
});

test("typed Skip focus ingress pauses a running Promethee session before a zero-credit short break", async () => {
  let nowMs = 0;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [
      (candidate) => pauseAcknowledgement(
        (candidate as SessionCommand).commandId,
        activeSession("paused", 2)
      )
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port);
  const coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 400;
  await coordinator.dispatchLocalAction({ type: "skip-focus" }, nowMs);
  await coordinator.settle();

  assert.equal(port.calls.pauses.length, 1);
  assert.equal(port.calls.resumes.length, 0);
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  assert.equal(coordinator.state.pomodoro.completedFocusCount, 0);
  if (coordinator.state.pomodoro.kind === "break-running") {
    assert.equal(coordinator.state.pomodoro.breakKind, "short");
    assert.equal(coordinator.state.pomodoro.breakSource, "skipped-focus");
  }
});

test("queued Skip focus serializes with authoritative pause and ignores its late duplicate acknowledgement", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  let resolveAcknowledgement: ((value: SessionCommandAcknowledgement) => void) | null = null;
  const delayedAcknowledgement = new Promise<SessionCommandAcknowledgement>((resolve) => {
    resolveAcknowledgement = resolve;
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => delayedAcknowledgement]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 400;
  await coordinator.dispatchLocalAction({ type: "skip-focus" }, nowMs);
  assert.equal(port.calls.pauses.length, 1);
  const command = port.calls.pauses[0];
  assert.notEqual(command, undefined);

  nowMs = 401;
  port.emit(sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, nowMs));
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  assert.equal(coordinator.state.pomodoro.completedFocusCount, 0);
  const breakAfterEvent = coordinator.state.pomodoro;

  resolveAcknowledgement?.(
    pauseAcknowledgement(command?.commandId ?? "missing", activeSession("paused", 2))
  );
  await coordinator.settle();
  assert.deepEqual(coordinator.state.pomodoro, breakAfterEvent);
  assert.equal(port.calls.pauses.length, 1);
  assert.equal(port.calls.resumes.length, 0);
});

test("all local actions enter through the coordinator and local-only actions preserve Promethee", () => {
  const manualConfig = { ...config, autoStartBreak: false };
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(),
        replayEvents: []
      }
    },
    manualConfig
  ).state;

  const restartedFocus = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 100,
      action: { type: "restart-phase" }
    },
    manualConfig
  );
  state = restartedFocus.state;
  assert.equal(state.pomodoro.kind, "focus-running");
  assert.deepEqual(restartedFocus.effects, []);
  if (state.pomodoro.kind === "focus-running") {
    assert.equal(state.pomodoro.deadlineAtMs, 1_100);
  }

  state = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 200,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 200)
    },
    manualConfig
  ).state;
  assert.equal(state.pomodoro.kind, "focus-paused");
  assert.equal(state.pomodoro.reason, "promethee-paused");

  const restartedPausedFocus = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 200,
      action: { type: "restart-phase" }
    },
    manualConfig
  );
  state = restartedPausedFocus.state;
  assert.equal(state.pomodoro.kind, "focus-paused");
  assert.equal(state.pomodoro.reason, "promethee-paused");
  if (
    state.pomodoro.kind === "focus-paused" &&
    state.pomodoro.reason === "promethee-paused"
  ) {
    assert.equal(state.pomodoro.remainingMs, manualConfig.focusDurationMs);
  }
  assert.deepEqual(restartedPausedFocus.effects, []);

  const skippedFocus = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 201,
      action: { type: "skip-focus" }
    },
    manualConfig
  );
  state = skippedFocus.state;
  assert.deepEqual(skippedFocus.effects, []);
  assert.equal(state.pomodoro.kind, "focus-paused");
  assert.equal(state.pomodoro.reason, "awaiting-break-start");
  assert.equal(state.pomodoro.completedFocusCount, 0);

  const skippedPendingBreak = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 202,
      action: { type: "skip-break" }
    },
    manualConfig
  );
  assert.equal(skippedPendingBreak.state.pomodoro.kind, "ready");
  assert.deepEqual(skippedPendingBreak.effects, []);
  if (skippedPendingBreak.state.pomodoro.kind === "ready") {
    assert.equal(skippedPendingBreak.state.pomodoro.completedFocusCount, 0);
    assert.equal(skippedPendingBreak.state.pomodoro.breakSource, "skipped-focus");
  }

  const startedBreak = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 202,
      action: { type: "start-break" }
    },
    manualConfig
  );
  state = startedBreak.state;
  assert.equal(state.pomodoro.kind, "break-running");
  assert.deepEqual(startedBreak.effects, []);

  const restartedBreak = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 300,
      action: { type: "restart-phase" }
    },
    manualConfig
  );
  state = restartedBreak.state;
  assert.equal(state.pomodoro.kind, "break-running");
  if (state.pomodoro.kind === "break-running") {
    assert.equal(state.pomodoro.deadlineAtMs, 1_800);
  }
  assert.deepEqual(restartedBreak.effects, []);

  const skippedBreak = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 301,
      action: { type: "skip-break" }
    },
    manualConfig
  );
  state = skippedBreak.state;
  assert.equal(state.pomodoro.kind, "ready");
  assert.deepEqual(skippedBreak.effects, []);
  if (state.pomodoro.kind !== "ready") {
    throw new Error("Expected Ready after skip break.");
  }
  const readyOccurrenceId = state.pomodoro.readyOccurrenceId;

  const dismissed = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 302,
      action: { type: "dismiss-ready" }
    },
    manualConfig
  );
  state = dismissed.state;
  assert.equal(state.pomodoro.kind, "ready");
  if (state.pomodoro.kind === "ready") {
    assert.equal(state.pomodoro.readyOccurrenceId, readyOccurrenceId);
  }
  assert.deepEqual(dismissed.effects, []);

  const duplicateDismiss = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 303,
      action: { type: "dismiss-ready" }
    },
    manualConfig
  );
  assert.equal(duplicateDismiss.state.pomodoro.kind, "ready");
  if (duplicateDismiss.state.pomodoro.kind === "ready") {
    assert.equal(
      duplicateDismiss.state.pomodoro.readyOccurrenceId,
      readyOccurrenceId
    );
  }
  assert.deepEqual(duplicateDismiss.effects, []);

  const ended = reduceSessionCoordinator(
    duplicateDismiss.state,
    {
      type: "local-action",
      nowMs: 304,
      action: { type: "end-pomodoro" }
    },
    manualConfig
  );
  assert.equal(ended.state.pomodoro.kind, "idle");
  assert.equal(ended.state.boundSession?.status, "paused");
  assert.deepEqual(ended.effects, []);
});

test("local action preconditions, deadline order, duplicate skip, and late pause acknowledgement fail closed", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(),
        replayEvents: []
      }
    },
    config
  ).state;

  for (const action of [
    { type: "start-break" },
    { type: "skip-break" },
    { type: "dismiss-ready" }
  ] as const) {
    const rejected = reduceSessionCoordinator(
      started,
      { type: "local-action", nowMs: 100, action },
      config
    );
    assert.equal(rejected.state.pomodoro, started.pomodoro);
    assert.deepEqual(rejected.effects, []);
  }

  const mismatchedAuthority = {
    ...started,
    boundSession: started.boundSession === null
      ? null
      : { ...started.boundSession, status: "paused" as const }
  };
  for (const action of [{ type: "skip-focus" }, { type: "restart-phase" }] as const) {
    const rejected = reduceSessionCoordinator(
      mismatchedAuthority,
      { type: "local-action", nowMs: 100, action },
      config
    );
    assert.equal(rejected.state.pomodoro, mismatchedAuthority.pomodoro);
    assert.deepEqual(rejected.effects, []);
  }

  const atDeadline = reduceSessionCoordinator(
    started,
    {
      type: "local-action",
      nowMs: config.focusDurationMs,
      action: { type: "skip-focus" }
    },
    config
  );
  assert.equal(atDeadline.state.pomodoro.kind, "focus-paused");
  assert.equal(atDeadline.state.pomodoro.reason, "awaiting-promethee-pause");
  if (
    atDeadline.state.pomodoro.kind !== "focus-paused" ||
    atDeadline.state.pomodoro.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected deadline pause state.");
  }
  assert.equal(atDeadline.state.pomodoro.breakSource, "completed-focus");
  assert.deepEqual(atDeadline.effects.map((effect) => effect.type), ["send-pause"]);
  const pending = atDeadline.state.pendingPause;
  assert.notEqual(pending, null);

  const duplicateSkip = reduceSessionCoordinator(
    atDeadline.state,
    {
      type: "local-action",
      nowMs: config.focusDurationMs + 1,
      action: { type: "skip-focus" }
    },
    config
  );
  assert.equal(duplicateSkip.state.pendingPause?.command.commandId, pending?.command.commandId);
  assert.deepEqual(duplicateSkip.effects, []);

  const ended = reduceSessionCoordinator(
    duplicateSkip.state,
    {
      type: "local-action",
      nowMs: config.focusDurationMs + 2,
      action: { type: "end-pomodoro" }
    },
    config
  );
  assert.equal(ended.state.pomodoro.kind, "idle");
  assert.equal(ended.state.pendingPause, null);
  assert.deepEqual(ended.effects, []);

  const lateAcknowledgement = reduceSessionCoordinator(
    ended.state,
    {
      type: "pause-settled",
      nowMs: config.focusDurationMs + 3,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          pending?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  assert.equal(lateAcknowledgement.state.pomodoro.kind, "idle");
  assert.deepEqual(lateAcknowledgement.effects, []);
});

test("an indeterminate pause outcome reconciles once and starts break from authoritative paused state", async () => {
  let nowMs = 0;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [
      snapshot(0),
      snapshot(1, readModel(activeSession("paused", 2)))
    ],
    pauses: [ScriptedBridgePort.indeterminate()]
  });
  const { adapter, bootstrap } = await connectAdapter(port);
  const coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 1_000;
  await coordinator.tick(nowMs);
  await coordinator.settle();

  assert.equal(port.calls.pauses.length, 1);
  assert.equal(port.calls.snapshotConnectionIds.length, 2);
  assert.equal(coordinator.state.status, "ready");
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  assert.equal(coordinator.state.pomodoro.completedFocusCount, 1);
});

test("acknowledgement plus duplicate paused event starts exactly one break", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [
      (candidate) => pauseAcknowledgement(
        (candidate as SessionCommand).commandId,
        activeSession("paused", 2)
      )
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 1_000;
  await coordinator.tick(nowMs);
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  const firstBreak = coordinator.state.pomodoro;

  port.emit(sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 1_000));
  port.emit(sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 1_000));
  await coordinator.settle();

  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  if (
    firstBreak.kind === "break-running" &&
    coordinator.state.pomodoro.kind === "break-running"
  ) {
    assert.equal(coordinator.state.pomodoro.startedAtMs, firstBreak.startedAtMs);
  }
  assert.equal(coordinator.state.pomodoro.completedFocusCount, 1);
  assert.equal(port.calls.pauses.length, 1);
});

test("authoritative play during break starts a complete configured focus", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [
      (candidate) => pauseAcknowledgement(
        (candidate as SessionCommand).commandId,
        activeSession("paused", 2)
      )
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);
  nowMs = 1_000;
  await coordinator.tick(nowMs);
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "break-running");

  nowMs = 1_200;
  port.emit(sessionChanged(1, activeSession("running", 3), CONNECTION_ID, nowMs));
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "focus-running");
  if (coordinator.state.pomodoro.kind === "focus-running") {
    assert.equal(coordinator.state.pomodoro.durationMs, config.focusDurationMs);
    assert.equal(coordinator.state.pomodoro.deadlineAtMs, 2_200);
  }
});

test("terminal observation cancels active Pomodoro to idle without issuing a mutation", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);
  assert.equal(coordinator.state.pomodoro.kind, "focus-running");

  nowMs = 200;
  port.emit(terminalEvent(1));
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "idle");
  assert.equal(coordinator.state.boundSession, null);
  assert.equal(port.calls.pauses.length, 0);
  assert.equal(port.calls.resumes.length, 0);
});

test("coordinator ignores stale entity revisions and reconciles sequence gaps", () => {
  const initial = createSessionCoordinatorState();
  const bootstrapped = reduceSessionCoordinator(
    initial,
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(10, readModel(activeSession("running", 2))),
        replayEvents: []
      }
    },
    config
  );
  assert.equal(bootstrapped.state.pomodoro.kind, "focus-running");

  const staleRevision = reduceSessionCoordinator(
    bootstrapped.state,
    {
      type: "bridge-event",
      nowMs: 100,
      event: sessionChanged(11, activeSession("paused", 1), CONNECTION_ID, 100)
    },
    config
  );
  assert.equal(staleRevision.state.lastSequence, 11);
  assert.equal(staleRevision.state.pomodoro.kind, "focus-running");

  const gap = reduceSessionCoordinator(
    staleRevision.state,
    {
      type: "bridge-event",
      nowMs: 200,
      event: sessionChanged(13, activeSession("paused", 3), CONNECTION_ID, 200)
    },
    config
  );
  assert.equal(gap.state.status, "reconciling");
  assert.deepEqual(gap.effects.map((effect) => effect.type), ["request-reconciliation"]);
  assert.equal(gap.state.pomodoro.kind, "focus-running");
});

test("manual pause uses authoritative occurrence time before late receipt time advances", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  const paused = reduceSessionCoordinator(
    started,
    {
      type: "bridge-event",
      nowMs: 1_200,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 900)
    },
    config
  );
  assert.equal(paused.state.nowMs, 1_200);
  assert.equal(paused.state.pomodoro.kind, "focus-paused");
  if (paused.state.pomodoro.kind === "focus-paused") {
    assert.equal(paused.state.pomodoro.reason, "promethee-paused");
    assert.equal(paused.state.pomodoro.remainingMs, 100);
  }
  assert.equal(paused.effects.some((effect) => effect.type === "send-pause"), false);
});

for (const priorTickMs of [950, 1_100]) {
  test(`delayed pause at 900 rewinds a prior local tick at ${priorTickMs}`, () => {
    let state = reduceSessionCoordinator(
      createSessionCoordinatorState(),
      {
        type: "bootstrap",
        nowMs: 0,
        bootstrap: {
          hello: bridgeHello(),
          snapshot: snapshot(0),
          replayEvents: []
        }
      },
      config
    ).state;
    state = reduceSessionCoordinator(
      state,
      { type: "tick", nowMs: priorTickMs },
      config
    ).state;

    const delayed = reduceSessionCoordinator(
      state,
      {
        type: "bridge-event",
        nowMs: 1_200,
        event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 900)
      },
      config
    );

    assert.equal(delayed.state.pomodoro.kind, "focus-paused");
    if (delayed.state.pomodoro.kind === "focus-paused") {
      assert.equal(delayed.state.pomodoro.reason, "promethee-paused");
      assert.equal(delayed.state.pomodoro.remainingMs, 100);
    }
    assert.equal(delayed.state.pendingPause, null);
    assert.equal(delayed.effects.some((effect) => effect.type === "send-pause"), false);
  });
}

test("delayed authoritative pause cannot resurrect an accepted End Pomodoro", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  const ended = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "end-pomodoro" }
    },
    config
  );
  state = ended.state;
  assert.equal(state.pomodoro.kind, "idle");
  assert.equal(state.pomodoro.cycleInstance, 2);
  assert.equal(state.acceptedLocalActions.length, 1);
  assert.deepEqual(ended.effects, []);

  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 500,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 300)
    },
    config
  );

  assert.equal(delayed.state.pomodoro.kind, "idle");
  assert.equal(delayed.state.pomodoro.cycleInstance, 2);
  assert.equal(delayed.state.boundSession?.status, "paused");
  assert.deepEqual(delayed.effects, []);
});

test("delayed authoritative pause replays accepted Skip focus without duplicate pause", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  const skipped = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "skip-focus" }
    },
    config
  );
  state = skipped.state;
  assert.deepEqual(skipped.effects.map((effect) => effect.type), ["send-pause"]);
  assert.equal(state.pendingPause !== null, true);
  assert.equal(state.acceptedLocalActions.length, 1);

  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 500,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 300)
    },
    config
  );

  assert.equal(delayed.state.pomodoro.kind, "break-running");
  assert.equal(delayed.state.pomodoro.completedFocusCount, 0);
  if (delayed.state.pomodoro.kind === "break-running") {
    assert.equal(delayed.state.pomodoro.breakKind, "short");
    assert.equal(delayed.state.pomodoro.breakSource, "skipped-focus");
  }
  assert.equal(delayed.state.pendingPause, null);
  assert.equal(delayed.effects.some((effect) => effect.type === "send-pause"), false);
});

test("delayed HUD authority reuses the accepted Skip focus pause correlation", () => {
  const initialHud = hudReadModel(0);
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession(), initialHud)),
        replayEvents: []
      }
    },
    config
  ).state;

  const skipped = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "skip-focus" }
    },
    config
  );
  state = skipped.state;
  const issuedPause = state.pendingPause;
  assert.notEqual(issuedPause, null);
  assert.deepEqual(skipped.effects.map((effect) => effect.type), ["send-pause"]);

  const nextHud = {
    ...initialHud,
    revision: initialHud.revision + 1,
    geometry: initialHud.geometry === null
      ? null
      : {
          ...initialHud.geometry,
          layoutRevision: initialHud.geometry.layoutRevision + 1,
          measuredAtMs: 300
        }
  };
  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 500,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 300,
        type: "hud.changed",
        payload: { hud: nextHud }
      }
    },
    config
  );

  assert.equal(delayed.state.pomodoro.kind, "focus-paused");
  assert.equal(delayed.state.pomodoro.reason, "awaiting-promethee-pause");
  assert.deepEqual(delayed.state.pendingPause, issuedPause);
  assert.equal(delayed.effects.some((effect) => effect.type === "send-pause"), false);
});

test("delayed HUD after Skip pause acknowledgement preserves the settled break", () => {
  const initialHud = hudReadModel(0);
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession(), initialHud)),
        replayEvents: []
      }
    },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "skip-focus" }
    },
    config
  ).state;
  const pending = state.pendingPause;
  assert.notEqual(pending, null);

  const acknowledged = reduceSessionCoordinator(
    state,
    {
      type: "pause-settled",
      nowMs: 500,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          pending?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  state = acknowledged.state;
  assert.equal(state.pomodoro.kind, "break-running");
  assert.equal(state.pomodoro.completedFocusCount, 0);
  assert.equal(state.pendingPause, null);
  const settledBreak = state.pomodoro;

  const nextHud = {
    ...initialHud,
    revision: initialHud.revision + 1,
    geometry: initialHud.geometry === null
      ? null
      : {
          ...initialHud.geometry,
          layoutRevision: initialHud.geometry.layoutRevision + 1,
          measuredAtMs: 300
        }
  };
  const delayedHud = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 600,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 300,
        type: "hud.changed",
        payload: { hud: nextHud }
      }
    },
    config
  );

  assert.deepEqual(delayedHud.state.pomodoro, settledBreak);
  assert.equal(delayedHud.state.boundSession?.revision, 2);
  assert.equal(delayedHud.state.boundSession?.status, "paused");
  assert.equal(delayedHud.state.pendingPause, null);
  assert.equal(delayedHud.effects.some((effect) => effect.type === "send-pause"), false);
  assert.equal(delayedHud.effects.some((effect) => effect.type === "request-reconciliation"), false);

  const delayedTask = reduceSessionCoordinator(
    delayedHud.state,
    {
      type: "bridge-event",
      nowMs: 650,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 2,
        occurredAtMs: 250,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );
  assert.deepEqual(delayedTask.state.pomodoro, settledBreak);
  assert.equal(delayedTask.state.boundSession?.revision, 2);
  assert.equal(delayedTask.state.pendingPause, null);
  assert.equal(delayedTask.state.lastEventOccurredAtMs, 0);
  assert.deepEqual(
    delayedTask.effects.map((effect) => effect.type),
    ["refresh-read-model"]
  );
  assert.equal(delayedTask.effects.some((effect) => effect.type === "send-pause"), false);
  assert.equal(delayedTask.effects.some((effect) => effect.type === "request-reconciliation"), false);
});

test("stale and identical session revisions after pause acknowledgement cannot resurrect Skip", () => {
  const settled = skippedBreakAfterPauseAcknowledgement();
  const settledBreak = settled.pomodoro;

  const staleRunning = reduceSessionCoordinator(
    settled,
    {
      type: "bridge-event",
      nowMs: 600,
      event: sessionChanged(1, activeSession("running", 1), CONNECTION_ID, 300)
    },
    config
  );
  assert.deepEqual(staleRunning.state.pomodoro, settledBreak);
  assert.equal(staleRunning.state.boundSession?.status, "paused");
  assert.equal(staleRunning.state.boundSession?.revision, 2);
  assert.equal(staleRunning.state.pendingPause, null);
  assert.equal(staleRunning.state.lastSequence, 1);
  assert.equal(staleRunning.state.lastEventOccurredAtMs, 300);
  assert.deepEqual(staleRunning.effects, []);

  const identicalPaused = reduceSessionCoordinator(
    staleRunning.state,
    {
      type: "bridge-event",
      nowMs: 650,
      event: sessionChanged(2, activeSession("paused", 2), CONNECTION_ID, 250)
    },
    config
  );
  assert.deepEqual(identicalPaused.state.pomodoro, settledBreak);
  assert.equal(identicalPaused.state.boundSession?.revision, 2);
  assert.equal(identicalPaused.state.pendingPause, null);
  assert.equal(identicalPaused.state.lastEventOccurredAtMs, 300);
  assert.deepEqual(identicalPaused.effects, []);
});

test("equal conflicting revision reconciles current committed break without rollback", () => {
  const settled = skippedBreakAfterPauseAcknowledgement();
  const settledBreak = settled.pomodoro;
  const conflict = reduceSessionCoordinator(
    settled,
    {
      type: "bridge-event",
      nowMs: 600,
      event: sessionChanged(1, activeSession("running", 2), CONNECTION_ID, 300)
    },
    config
  );

  assert.equal(conflict.state.status, "reconciling");
  assert.deepEqual(conflict.state.pomodoro, settledBreak);
  assert.equal(conflict.state.boundSession?.status, "paused");
  assert.equal(conflict.state.boundSession?.revision, 2);
  assert.equal(conflict.state.pendingPause, null);
  assert.deepEqual(
    conflict.effects.map((effect) => effect.type),
    ["request-reconciliation"]
  );
  assert.equal(conflict.effects.some((effect) => effect.type === "send-pause"), false);
});

test("strictly newer session revision retains authoritative play event time", () => {
  const settled = skippedBreakAfterPauseAcknowledgement();
  const played = reduceSessionCoordinator(
    settled,
    {
      type: "bridge-event",
      nowMs: 600,
      event: sessionChanged(1, activeSession("running", 3), CONNECTION_ID, 550)
    },
    config
  );

  assert.equal(played.state.pomodoro.kind, "focus-running");
  if (played.state.pomodoro.kind === "focus-running") {
    assert.equal(played.state.pomodoro.startedAtMs, 550);
    assert.equal(played.state.pomodoro.deadlineAtMs, 1_550);
    assert.equal(played.state.pomodoro.durationMs, config.focusDurationMs);
  }
  assert.equal(played.state.boundSession?.status, "running");
  assert.equal(played.state.boundSession?.revision, 3);
  assert.equal(played.state.pendingPause, null);
  assert.deepEqual(played.effects, []);
});

test("reconciliation replay consumes a stale pre-ack revision without resurrecting Skip", () => {
  const { committed, settled } = settleReconciliationWithReplay(
    sessionChanged(2, activeSession("running", 1), CONNECTION_ID, 300)
  );

  assert.equal(settled.state.status, "ready");
  assert.deepEqual(settled.state.pomodoro, committed.pomodoro);
  assert.equal(settled.state.boundSession?.status, "paused");
  assert.equal(settled.state.boundSession?.revision, 2);
  assert.equal(settled.state.pendingPause, null);
  assert.equal(settled.state.pendingReconciliation, null);
  assert.equal(settled.state.lastSequence, 2);
  assert.equal(settled.state.lastEventOccurredAtMs, 500);
  assert.equal(settled.state.connectionGeneration, committed.connectionGeneration);
  assert.deepEqual(settled.effects, []);
});

test("reconciliation replay consumes an identical equal revision without cycle rollback", () => {
  const { committed, settled } = settleReconciliationWithReplay(
    sessionChanged(2, activeSession("paused", 2), CONNECTION_ID, 300)
  );

  assert.equal(settled.state.status, "ready");
  assert.deepEqual(settled.state.pomodoro, committed.pomodoro);
  assert.equal(settled.state.boundSession?.status, "paused");
  assert.equal(settled.state.boundSession?.revision, 2);
  assert.equal(settled.state.lastSequence, 2);
  assert.equal(settled.state.lastEventOccurredAtMs, 500);
  assert.equal(settled.state.connectionGeneration, committed.connectionGeneration);
  assert.deepEqual(settled.effects, []);
});

test("reconciliation replay consumes an equal conflicting revision and reconciles current state", () => {
  const { committed, settled } = settleReconciliationWithReplay(
    sessionChanged(2, activeSession("running", 2), CONNECTION_ID, 300)
  );

  assert.equal(settled.state.status, "reconciling");
  assert.deepEqual(settled.state.pomodoro, committed.pomodoro);
  assert.equal(settled.state.boundSession?.status, "paused");
  assert.equal(settled.state.boundSession?.revision, 2);
  assert.equal(settled.state.pendingPause, null);
  assert.equal(settled.state.lastSequence, 2);
  assert.equal(settled.state.lastEventOccurredAtMs, 500);
  assert.equal(settled.state.connectionGeneration, committed.connectionGeneration);
  assert.equal(
    settled.state.pendingReconciliation?.connectionGeneration,
    committed.connectionGeneration
  );
  assert.deepEqual(
    settled.effects.map((effect) => effect.type),
    ["request-reconciliation"]
  );
  assert.equal(settled.effects.some((effect) => effect.type === "send-pause"), false);
});

test("reconciliation replay applies a newer revision at authoritative occurrence time", () => {
  const { committed, settled } = settleReconciliationWithReplay(
    sessionChanged(2, activeSession("running", 3), CONNECTION_ID, 550)
  );

  assert.equal(settled.state.status, "ready");
  assert.equal(settled.state.pomodoro.kind, "focus-running");
  if (settled.state.pomodoro.kind === "focus-running") {
    assert.equal(settled.state.pomodoro.startedAtMs, 550);
    assert.equal(settled.state.pomodoro.deadlineAtMs, 1_550);
  }
  assert.equal(settled.state.boundSession?.status, "running");
  assert.equal(settled.state.boundSession?.revision, 3);
  assert.equal(settled.state.pendingPause, null);
  assert.equal(settled.state.lastSequence, 2);
  assert.equal(settled.state.lastEventOccurredAtMs, 550);
  assert.equal(settled.state.connectionGeneration, committed.connectionGeneration);
  assert.deepEqual(settled.effects, []);
});

test("stale session revision preserves manual pause and post-ACK End Restart and Skip break", () => {
  let manuallyPaused = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  manuallyPaused = reduceSessionCoordinator(
    manuallyPaused,
    {
      type: "bridge-event",
      nowMs: 300,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 300)
    },
    config
  ).state;
  const frozenManualPause = manuallyPaused.pomodoro;
  const staleManual = reduceSessionCoordinator(
    manuallyPaused,
    {
      type: "bridge-event",
      nowMs: 400,
      event: sessionChanged(2, activeSession("running", 1), CONNECTION_ID, 200)
    },
    config
  );
  assert.deepEqual(staleManual.state.pomodoro, frozenManualPause);
  assert.equal(staleManual.state.boundSession?.revision, 2);
  assert.deepEqual(staleManual.effects, []);

  const settled = skippedBreakAfterPauseAcknowledgement();
  for (const variant of [
    { action: { type: "restart-phase" } as const, expectedKind: "break-running" },
    { action: { type: "skip-break" } as const, expectedKind: "ready" },
    { action: { type: "end-pomodoro" } as const, expectedKind: "idle" }
  ]) {
    const committed = reduceSessionCoordinator(
      settled,
      { type: "local-action", nowMs: 550, action: variant.action },
      config
    );
    assert.equal(committed.state.pomodoro.kind, variant.expectedKind);
    const committedCycle = committed.state.pomodoro;
    const stale = reduceSessionCoordinator(
      committed.state,
      {
        type: "bridge-event",
        nowMs: 600,
        event: sessionChanged(1, activeSession("running", 1), CONNECTION_ID, 300)
      },
      config
    );
    assert.deepEqual(stale.state.pomodoro, committedCycle);
    assert.equal(stale.state.boundSession?.revision, 2);
    assert.equal(stale.state.pendingPause, null);
    assert.deepEqual(stale.effects, []);
  }
});

test("delayed HUD after pause reconciliation settlement preserves the settled break", () => {
  const initialHud = hudReadModel(0);
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession(), initialHud)),
        replayEvents: []
      }
    },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "skip-focus" }
    },
    config
  ).state;
  const pending = state.pendingPause;
  assert.notEqual(pending, null);

  const indeterminate = reduceSessionCoordinator(
    state,
    {
      type: "pause-settled",
      nowMs: 500,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: false,
        error: {
          code: "TRANSPORT_ERROR",
          message: "Pause outcome is unknown.",
          execution: "indeterminate",
          retryable: true
        }
      }
    },
    config
  );
  state = indeterminate.state;
  assert.equal(state.status, "reconciling");
  const reconciliation = state.pendingReconciliation;
  assert.notEqual(reconciliation, null);

  const settled = reduceSessionCoordinator(
    state,
    {
      type: "reconcile-settled",
      nowMs: 550,
      connectionId: reconciliation?.connectionId ?? CONNECTION_ID,
      connectionGeneration: reconciliation?.connectionGeneration ?? 0,
      effectToken: reconciliation?.effectToken ?? "missing",
      result: {
        ok: true,
        value: {
          snapshot: snapshot(1, readModel(activeSession("paused", 2), initialHud)),
          replayEvents: []
        }
      }
    },
    config
  );
  state = settled.state;
  assert.equal(state.status, "ready");
  assert.equal(state.pomodoro.kind, "break-running");
  assert.equal(state.pomodoro.completedFocusCount, 0);
  assert.equal(state.pendingPause, null);
  const settledBreak = state.pomodoro;

  const nextHud = {
    ...initialHud,
    revision: initialHud.revision + 1,
    geometry: initialHud.geometry === null
      ? null
      : {
          ...initialHud.geometry,
          layoutRevision: initialHud.geometry.layoutRevision + 1,
          measuredAtMs: 300
        }
  };
  const delayedHud = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 600,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 2,
        occurredAtMs: 300,
        type: "hud.changed",
        payload: { hud: nextHud }
      }
    },
    config
  );

  assert.deepEqual(delayedHud.state.pomodoro, settledBreak);
  assert.equal(delayedHud.state.boundSession?.revision, 2);
  assert.equal(delayedHud.state.pendingPause, null);
  assert.equal(delayedHud.effects.some((effect) => effect.type === "send-pause"), false);
  assert.equal(delayedHud.effects.some((effect) => effect.type === "request-reconciliation"), false);

  const staleSession = reduceSessionCoordinator(
    delayedHud.state,
    {
      type: "bridge-event",
      nowMs: 650,
      event: sessionChanged(3, activeSession("running", 1), CONNECTION_ID, 250)
    },
    config
  );
  assert.deepEqual(staleSession.state.pomodoro, settledBreak);
  assert.equal(staleSession.state.boundSession?.status, "paused");
  assert.equal(staleSession.state.boundSession?.revision, 2);
  assert.equal(staleSession.state.pendingPause, null);
  assert.deepEqual(staleSession.effects, []);
});

test("delayed authoritative pause replays accepted Restart phase at full duration", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  const restarted = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 400,
      action: { type: "restart-phase" }
    },
    config
  );
  state = restarted.state;
  assert.equal(state.acceptedLocalActions.length, 1);
  if (state.pomodoro.kind !== "focus-running") {
    throw new Error("Expected restarted focus.");
  }
  assert.equal(state.pomodoro.deadlineAtMs, 1_400);

  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 500,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 300)
    },
    config
  );

  assert.equal(delayed.state.pomodoro.kind, "focus-paused");
  assert.equal(delayed.state.pomodoro.reason, "promethee-paused");
  if (
    delayed.state.pomodoro.kind === "focus-paused" &&
    delayed.state.pomodoro.reason === "promethee-paused"
  ) {
    assert.equal(delayed.state.pomodoro.remainingMs, config.focusDurationMs);
  }
  assert.deepEqual(delayed.effects, []);
});

test("delayed paused event replays Skip break and non-empty Ready sequence exactly once", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    { type: "tick", nowMs: config.focusDurationMs },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 1_001,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 1_001)
    },
    config
  ).state;
  assert.equal(state.pomodoro.kind, "break-running");

  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 1_400,
      action: { type: "skip-break" }
    },
    config
  ).state;
  if (state.pomodoro.kind !== "ready") {
    throw new Error("Expected Ready after Skip break.");
  }
  const readyOccurrenceId = state.pomodoro.readyOccurrenceId;
  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 1_401,
      action: { type: "dismiss-ready" }
    },
    config
  ).state;
  assert.equal(state.acceptedLocalActions.length, 2);

  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 1_500,
      event: sessionChanged(2, activeSession("paused", 3), CONNECTION_ID, 1_200)
    },
    config
  );

  assert.equal(delayed.state.pomodoro.kind, "ready");
  if (delayed.state.pomodoro.kind === "ready") {
    assert.equal(delayed.state.pomodoro.readyOccurrenceId, readyOccurrenceId);
  }
  assert.equal(delayed.state.localActionSequence, 2);
  assert.deepEqual(delayed.effects, []);
  assert.equal(JSON.parse(JSON.stringify(delayed.state)).pomodoro.readyOccurrenceId, readyOccurrenceId);
});

test("bounded local-action replay reconciles without rolling back when history is exhausted", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  for (let sequence = 1; sequence <= 65; sequence += 1) {
    state = reduceSessionCoordinator(
      state,
      {
        type: "local-action",
        nowMs: sequence,
        action: { type: "restart-phase" }
      },
      config
    ).state;
  }
  if (state.pomodoro.kind !== "focus-running") {
    throw new Error("Expected restarted focus before bounded rewind.");
  }
  const committedPomodoro = state.pomodoro;
  assert.equal(state.acceptedLocalActions.length > 0, true);
  assert.equal(state.acceptedLocalActions.length <= 64, true);
  assert.equal(state.localActionSequence, 65);

  const outsideWindow = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 100,
      event: sessionChanged(1, activeSession("paused", 2), CONNECTION_ID, 0)
    },
    config
  );

  assert.equal(outsideWindow.state.status, "reconciling");
  assert.deepEqual(outsideWindow.state.pomodoro, committedPomodoro);
  assert.equal(outsideWindow.state.localActionSequence, 65);
  assert.deepEqual(
    outsideWindow.effects.map((effect) => effect.type),
    ["request-reconciliation"]
  );
  assert.equal(outsideWindow.effects.some((effect) => effect.type === "send-pause"), false);
});

test("local-action replay is isolated by connection generation without identity reuse", () => {
  const connectionA = "connection-a";
  const connectionB = "connection-b";
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionA },
        snapshot: { ...snapshot(0), connectionId: connectionA },
        replayEvents: []
      }
    },
    config
  ).state;
  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 100,
      action: { type: "restart-phase" }
    },
    config
  ).state;
  assert.equal(state.localActionSequence, 1);
  assert.equal(state.acceptedLocalActions.length, 1);

  state = reduceSessionCoordinator(
    state,
    {
      type: "bootstrap",
      nowMs: 200,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionB },
        snapshot: { ...snapshot(0), connectionId: connectionB },
        replayEvents: []
      }
    },
    config
  ).state;
  assert.equal(state.connectionGeneration, 2);
  assert.equal(state.localActionSequence, 1);
  assert.deepEqual(state.acceptedLocalActions, []);
  assert.equal(state.pomodoro.cycleInstance, 1);

  state = reduceSessionCoordinator(
    state,
    {
      type: "local-action",
      nowMs: 300,
      action: { type: "restart-phase" }
    },
    config
  ).state;
  assert.equal(state.localActionSequence, 2);
  assert.equal(state.acceptedLocalActions[0]?.connectionGeneration, 2);

  const delayed = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 400,
      event: sessionChanged(1, activeSession("paused", 2), connectionB, 250)
    },
    config
  );
  assert.equal(delayed.state.pomodoro.kind, "focus-paused");
  assert.equal(delayed.state.pomodoro.reason, "promethee-paused");
  if (
    delayed.state.pomodoro.kind === "focus-paused" &&
    delayed.state.pomodoro.reason === "promethee-paused"
  ) {
    assert.equal(delayed.state.pomodoro.remainingMs, config.focusDurationMs);
  }
  assert.equal(delayed.state.pomodoro.cycleInstance, 1);
  assert.equal(delayed.state.localActionSequence, 2);
  assert.deepEqual(delayed.effects, []);
});

test("a new connection instance rebinds revision and event-time baselines", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: "connection-a" },
        snapshot: {
          ...snapshot(10, readModel(activeSession("running", 10))),
          connectionId: "connection-a"
        },
        replayEvents: []
      }
    },
    config
  ).state;
  state = { ...state, lastEventOccurredAtMs: 700 };

  const rebound = reduceSessionCoordinator(
    state,
    {
      type: "bootstrap",
      nowMs: 800,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: "connection-b" },
        snapshot: {
          ...snapshot(1, readModel(activeSession("paused", 1))),
          connectionId: "connection-b"
        },
        replayEvents: []
      }
    },
    config
  );

  assert.equal(rebound.state.connectionId, "connection-b");
  assert.equal(rebound.state.boundSession?.connectionId, "connection-b");
  assert.equal(rebound.state.boundSession?.revision, 1);
  assert.equal(rebound.state.boundSession?.status, "paused");
  assert.equal(rebound.state.lastEventOccurredAtMs, 0);
  assert.equal(rebound.state.pomodoro.kind, "focus-paused");
});

test("rebinding a different session advances the cycle instance monotonically", () => {
  const first = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: "connection-a" },
        snapshot: {
          ...snapshot(0),
          connectionId: "connection-a"
        },
        replayEvents: []
      }
    },
    config
  ).state;
  const next = reduceSessionCoordinator(
    first,
    {
      type: "bootstrap",
      nowMs: 100,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: "connection-b" },
        snapshot: {
          ...snapshot(0, readModel(activeSession("running", 1, "session-2"))),
          connectionId: "connection-b"
        },
        replayEvents: []
      }
    },
    config
  );
  assert.ok(next.state.pomodoro.cycleInstance > first.pomodoro.cycleInstance);
});

test("same-connection session replacement binds read state but leaves Pomodoro safely idle", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  const priorCycleInstance = started.pomodoro.cycleInstance;
  const replaced = reduceSessionCoordinator(
    started,
    {
      type: "bridge-event",
      nowMs: 100,
      event: sessionChanged(
        1,
        activeSession("running", 1, "session-2"),
        CONNECTION_ID,
        100
      )
    },
    config
  );

  assert.equal(replaced.state.boundSession?.id, "session-2");
  assert.equal(replaced.state.boundSession?.status, "running");
  assert.equal(replaced.state.pomodoro.kind, "idle");
  assert.ok(replaced.state.pomodoro.cycleInstance > priorCycleInstance);
  assert.deepEqual(replaced.effects, []);

  const stillRunning = reduceSessionCoordinator(
    replaced.state,
    {
      type: "bridge-event",
      nowMs: 200,
      event: sessionChanged(
        2,
        activeSession("running", 2, "session-2"),
        CONNECTION_ID,
        200
      )
    },
    config
  );
  assert.equal(stillRunning.state.pomodoro.kind, "idle");
});

test("session replacement rejects exhausted cycle identity without reuse", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  const exhausted = {
    ...started,
    pomodoro: {
      ...started.pomodoro,
      cycleInstance: Number.MAX_SAFE_INTEGER
    }
  };
  const replaced = reduceSessionCoordinator(
    exhausted,
    {
      type: "bridge-event",
      nowMs: 100,
      event: sessionChanged(
        1,
        activeSession("running", 1, "session-2"),
        CONNECTION_ID,
        100
      )
    },
    config
  );

  assert.equal(replaced.state.status, "unavailable");
  assert.equal(replaced.state.boundSession, null);
  assert.equal(replaced.state.pomodoro.cycleInstance, Number.MAX_SAFE_INTEGER);
  assert.equal(replaced.state.lastError?.code, "INVALID_ARGUMENT");
  assert.match(replaced.state.lastError?.message ?? "", /cycle identity is exhausted/);
  assert.deepEqual(replaced.effects, []);
});

test("a reused connection id still resets read-model revision baselines", () => {
  const connectionId = "reused-connection-id";
  const highRevisionModel = {
    ...readModel(),
    tasks: { revision: 10, items: readModel().tasks?.items ?? [] }
  };
  const lowRevisionModel = {
    ...readModel(activeSession("paused", 1)),
    tasks: { revision: 1, items: readModel().tasks?.items ?? [] }
  };
  const first = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId },
        snapshot: { ...snapshot(10, highRevisionModel), connectionId },
        replayEvents: []
      }
    },
    config
  ).state;
  const rebound = reduceSessionCoordinator(
    first,
    {
      type: "bootstrap",
      nowMs: 100,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId },
        snapshot: { ...snapshot(1, lowRevisionModel), connectionId },
        replayEvents: []
      }
    },
    config
  );
  assert.equal(rebound.state.status, "ready");
  assert.equal(rebound.state.tasks?.revision, 1);
  assert.ok(rebound.state.connectionGeneration > first.connectionGeneration);
});

test("acknowledgements cannot advance a phase while sequence reconciliation is active", () => {
  const bootstrapped = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  const expired = reduceSessionCoordinator(
    bootstrapped,
    { type: "tick", nowMs: 1_000 },
    config
  );
  const pending = expired.state.pendingPause;
  assert.notEqual(pending, null);
  const reconciling = reduceSessionCoordinator(
    expired.state,
    { type: "sequence-gap", nowMs: 1_000, connectionId: CONNECTION_ID },
    config
  );
  assert.equal(reconciling.state.status, "reconciling");

  const ignoredAck = reduceSessionCoordinator(
    reconciling.state,
    {
      type: "pause-settled",
      nowMs: 1_500,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          pending?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  assert.equal(ignoredAck.state.status, "reconciling");
  assert.equal(ignoredAck.state.pomodoro.kind, "focus-paused");
  assert.equal(ignoredAck.state.pendingPause?.command.commandId, pending?.command.commandId);

  const authoritative = reduceSessionCoordinator(
    ignoredAck.state,
    {
      type: "reconcile-settled",
      nowMs: 1_600,
      connectionId: reconciling.state.pendingReconciliation?.connectionId ?? CONNECTION_ID,
      connectionGeneration:
        reconciling.state.pendingReconciliation?.connectionGeneration ?? 0,
      effectToken: reconciling.state.pendingReconciliation?.effectToken ?? "missing",
      result: {
        ok: true,
        value: {
          snapshot: snapshot(0, readModel(activeSession("paused", 2))),
          replayEvents: []
        }
      }
    },
    config
  );
  assert.equal(authoritative.state.status, "ready");
  assert.equal(authoritative.state.pomodoro.kind, "break-running");
});

test("same-connection running reconciliation retries the identical pause command once", async () => {
  let nowMs = 0;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0), snapshot(0)],
    pauses: [
      ScriptedBridgePort.indeterminate(),
      (candidate) => pauseAcknowledgement(
        (candidate as SessionCommand).commandId,
        activeSession("paused", 2)
      )
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port);
  const coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);
  nowMs = 1_000;
  await coordinator.tick(nowMs);
  await coordinator.settle();

  assert.equal(port.calls.pauses.length, 2);
  assert.equal(port.calls.pauses[0]?.commandId, port.calls.pauses[1]?.commandId);
  assert.equal(coordinator.state.status, "ready");
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
});

test("bounded unresolved pause reconciliation degrades safely to idle without ending Promethee", async () => {
  let nowMs = 0;
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0), snapshot(0), snapshot(0)],
    pauses: [
      ScriptedBridgePort.indeterminate(),
      ScriptedBridgePort.indeterminate()
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port);
  const coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);
  nowMs = 1_000;
  await coordinator.tick(nowMs);
  await coordinator.settle();

  assert.equal(port.calls.pauses.length, 2);
  assert.equal(coordinator.state.status, "unavailable");
  assert.equal(coordinator.state.pomodoro.kind, "idle");
  assert.equal(port.calls.resumes.length, 0);
});

test("equal session revision with different values fails closed", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession("running", 1))),
        replayEvents: []
      }
    },
    config
  ).state;

  const conflict = reduceSessionCoordinator(
    started,
    {
      type: "bridge-event",
      nowMs: 100,
      event: sessionChanged(1, activeSession("paused", 1), CONNECTION_ID, 100)
    },
    config
  );
  assert.equal(conflict.state.status, "reconciling");
  assert.deepEqual(conflict.effects.map((effect) => effect.type), ["request-reconciliation"]);
  assert.equal(conflict.state.pomodoro.kind, "focus-running");
});

test("cycle-qualified acknowledgement rejects the prior focus command during a later focus", () => {
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;

  let reduction = reduceSessionCoordinator(state, { type: "tick", nowMs: 1_000 }, config);
  const first = reduction.state.pendingPause;
  assert.notEqual(first, null);
  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "pause-settled",
      nowMs: 1_000,
      commandId: first?.command.commandId ?? "missing",
      connectionId: first?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: first?.connectionGeneration ?? 0,
      effectToken: first?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          first?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  assert.equal(reduction.state.pomodoro.kind, "break-running");

  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "bridge-event",
      nowMs: 1_100,
      event: sessionChanged(1, activeSession("running", 3), CONNECTION_ID, 1_100)
    },
    config
  );
  reduction = reduceSessionCoordinator(
    reduction.state,
    { type: "tick", nowMs: 2_100 },
    config
  );
  const second = reduction.state.pendingPause;
  assert.notEqual(second, null);
  assert.notEqual(second?.pauseRequestId, first?.pauseRequestId);

  const stale = reduceSessionCoordinator(
    reduction.state,
    {
      type: "pause-settled",
      nowMs: 2_100,
      commandId: first?.command.commandId ?? "missing",
      connectionId: first?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: first?.connectionGeneration ?? 0,
      effectToken: first?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          first?.command.commandId ?? "missing",
          activeSession("paused", 2)
        )
      }
    },
    config
  );
  assert.equal(stale.state.pomodoro.kind, "focus-paused");
  assert.equal(stale.state.pendingPause?.pauseRequestId, second?.pauseRequestId);
  assert.equal(stale.state.pomodoro.completedFocusCount, 1);
});

test("task refresh marker triggers one bounded authoritative read-model refresh", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  const updated = readModel();
  const updatedTasks = {
    ...updated,
    tasks: {
      revision: 4,
      items: [
        ...(updated.tasks?.items ?? []),
        {
          id: "task-2",
          title: "Review the coordinator",
          status: "open" as const,
          project: null
        }
      ]
    }
  };
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0), snapshot(1, updatedTasks)]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);
  nowMs = 100;
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: nowMs,
    type: "tasks.refresh-required",
    payload: { reason: "changed" }
  });
  await coordinator.settle();

  assert.equal(port.calls.snapshotConnectionIds.length, 2);
  assert.equal(coordinator.state.taskRefreshRequired, false);
  assert.equal(coordinator.state.taskRefreshInFlight, false);
  assert.equal(coordinator.state.tasks?.revision, 4);
  assert.equal(coordinator.state.tasks?.items.length, 2);
});

test("an in-flight task refresh cannot block the deadline pause or restart focus", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  let resolveRefresh: ((value: unknown) => void) | null = null;
  const delayedRefresh = new Promise<unknown>((resolve) => {
    resolveRefresh = resolve;
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0), () => delayedRefresh],
    pauses: [
      (candidate) => pauseAcknowledgement(
        (candidate as SessionCommand).commandId,
        activeSession("paused", 2)
      )
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 900;
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: nowMs,
    type: "tasks.refresh-required",
    payload: { reason: "changed" }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.state.taskRefreshInFlight, true);

  nowMs = 1_000;
  await coordinator.tick(nowMs);
  assert.equal(port.calls.pauses.length, 1);

  const updated = readModel(activeSession("paused", 2));
  resolveRefresh?.(snapshot(1, {
    ...updated,
    tasks: {
      revision: 4,
      items: updated.tasks?.items ?? []
    }
  }));
  await coordinator.settle();
  assert.equal(coordinator.state.pomodoro.kind, "break-running");
  assert.equal(coordinator.state.tasks?.revision, 4);
});

test("a newer task marker coalesces a second refresh instead of accepting cursor 1 for sequence 2", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  let resolveFirstRefresh: ((value: unknown) => void) | null = null;
  const delayedFirstRefresh = new Promise<unknown>((resolve) => {
    resolveFirstRefresh = resolve;
  });
  const tasksAtRevision = (revision: number) => ({
    ...readModel(),
    tasks: {
      revision,
      items: readModel().tasks?.items ?? []
    }
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [
      snapshot(0),
      () => delayedFirstRefresh,
      snapshot(2, tasksAtRevision(5))
    ]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 100;
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: nowMs,
    type: "tasks.refresh-required",
    payload: { reason: "changed" }
  });
  await Promise.resolve();
  await Promise.resolve();
  nowMs = 110;
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 2,
    occurredAtMs: nowMs,
    type: "tasks.refresh-required",
    payload: { reason: "changed" }
  });
  resolveFirstRefresh?.(snapshot(1, tasksAtRevision(4)));
  await coordinator.settle();

  assert.equal(port.calls.snapshotConnectionIds.length, 3);
  assert.equal(coordinator.state.tasks?.revision, 5);
  assert.equal(coordinator.state.taskRefreshRequired, false);
  assert.equal(coordinator.state.taskRefreshInFlight, false);
});

test("a buffered closing event during reconciliation clears coordinator authority", async () => {
  let nowMs = 0;
  let coordinator: SessionCoordinator | null = null;
  let resolveReconcile: ((value: unknown) => void) | null = null;
  const delayedReconcile = new Promise<unknown>((resolve) => {
    resolveReconcile = resolve;
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0), () => delayedReconcile]
  });
  const { adapter, bootstrap } = await connectAdapter(port, (signal) => {
    void coordinator?.acceptAdapterSignal(signal, nowMs);
  });
  coordinator = new SessionCoordinator({ bridge: adapter, config, clock: () => nowMs });
  await coordinator.start(bootstrap, nowMs);

  nowMs = 100;
  port.emit(sessionChanged(2, activeSession("paused", 2), CONNECTION_ID, nowMs));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.state.status, "reconciling");
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: nowMs,
    type: "bridge.closing",
    payload: { reason: "revoked" }
  });
  resolveReconcile?.(snapshot(0));
  await coordinator.settle();

  assert.equal(adapter.connectionId, null);
  assert.equal(coordinator.state.status, "disconnected");
  assert.equal(coordinator.state.boundSession, null);
  assert.equal(coordinator.state.pomodoro.kind, "idle");
});

test("a pause acknowledgement older than its expected revision reconciles", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession("running", 2))),
        replayEvents: []
      }
    },
    config
  ).state;
  const expired = reduceSessionCoordinator(started, { type: "tick", nowMs: 1_000 }, config);
  const pending = expired.state.pendingPause;
  assert.equal(pending?.command.expectedRevision, 2);

  const stale = reduceSessionCoordinator(
    expired.state,
    {
      type: "pause-settled",
      nowMs: 1_000,
      commandId: pending?.command.commandId ?? "missing",
      connectionId: pending?.command.connectionId ?? CONNECTION_ID,
      connectionGeneration: pending?.connectionGeneration ?? 0,
      effectToken: pending?.effectToken ?? "missing",
      result: {
        ok: true,
        value: pauseAcknowledgement(
          pending?.command.commandId ?? "missing",
          activeSession("paused", 1)
        )
      }
    },
    config
  );
  assert.equal(stale.state.status, "reconciling");
  assert.deepEqual(stale.effects.map((effect) => effect.type), ["request-reconciliation"]);
  assert.equal(stale.state.pomodoro.kind, "focus-paused");
});

test("an old connection pause failure cannot overwrite the current connection success", () => {
  const connectionA = "reused-connection-id";
  const connectionB = "reused-connection-id";
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionA },
        snapshot: { ...snapshot(0), connectionId: connectionA },
        replayEvents: []
      }
    },
    config
  ).state;
  let reduction = reduceSessionCoordinator(state, { type: "tick", nowMs: 1_000 }, config);
  const pendingA = reduction.state.pendingPause;
  assert.notEqual(pendingA, null);

  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "bootstrap",
      nowMs: 1_000,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionB },
        snapshot: { ...snapshot(0), connectionId: connectionB },
        replayEvents: []
      }
    },
    config
  );
  const pendingB = reduction.state.pendingPause;
  assert.notEqual(pendingB, null);
  assert.notEqual(pendingA?.command.commandId, pendingB?.command.commandId);

  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "pause-settled",
      nowMs: 1_000,
      commandId: pendingB?.command.commandId ?? "missing",
      connectionId: connectionB,
      connectionGeneration: pendingB?.connectionGeneration ?? 0,
      effectToken: pendingB?.effectToken ?? "missing",
      result: {
        ok: true,
        value: {
          commandId: pendingB?.command.commandId ?? "missing",
          connectionId: connectionB,
          outcome: "applied",
          authoritative: {
            connectionId: connectionB,
            atSequence: 0,
            value: activeSession("paused", 2)
          },
          rejection: null
        }
      }
    },
    config
  );
  assert.equal(reduction.state.pomodoro.kind, "break-running");

  const afterOldFailure = reduceSessionCoordinator(
    reduction.state,
    {
      type: "pause-settled",
      nowMs: 4_000,
      commandId: pendingA?.command.commandId ?? "missing",
      connectionId: connectionA,
      connectionGeneration: pendingA?.connectionGeneration ?? 0,
      effectToken: pendingA?.effectToken ?? "missing",
      result: {
        ok: false,
        error: {
          code: "TRANSPORT_ERROR",
          message: "late A failure",
          execution: "indeterminate",
          retryable: true
        }
      }
    },
    config
  );
  assert.equal(afterOldFailure.state.connectionId, connectionB);
  assert.equal(afterOldFailure.state.status, "ready");
  assert.equal(afterOldFailure.state.pomodoro.kind, "break-running");
  assert.equal(afterOldFailure.state.lastError, null);
});

test("an old connection task-refresh failure cannot overwrite the current connection success", () => {
  const connectionA = "reused-connection-id";
  const connectionB = "reused-connection-id";
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionA },
        snapshot: { ...snapshot(0), connectionId: connectionA },
        replayEvents: []
      }
    },
    config
  ).state;
  let reduction = reduceSessionCoordinator(
    state,
    {
      type: "bridge-event",
      nowMs: 100,
      event: {
        schemaVersion: 1,
        connectionId: connectionA,
        sequence: 1,
        occurredAtMs: 100,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );
  const refreshA = reduction.state.pendingTaskRefresh;
  assert.notEqual(refreshA, null);

  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "bootstrap",
      nowMs: 100,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionB },
        snapshot: { ...snapshot(0), connectionId: connectionB },
        replayEvents: []
      }
    },
    config
  );
  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "bridge-event",
      nowMs: 200,
      event: {
        schemaVersion: 1,
        connectionId: connectionB,
        sequence: 1,
        occurredAtMs: 200,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );
  const refreshB = reduction.state.pendingTaskRefresh;
  assert.notEqual(refreshB, null);
  const tasksB = {
    revision: 9,
    items: readModel().tasks?.items ?? []
  };
  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "task-refresh-settled",
      nowMs: 200,
      connectionId: connectionB,
      connectionGeneration: refreshB?.connectionGeneration ?? 0,
      effectToken: refreshB?.effectToken ?? "missing",
      result: {
        ok: true,
        value: { connectionId: connectionB, atSequence: 1, value: tasksB }
      }
    },
    config
  );
  const afterOldFailure = reduceSessionCoordinator(
    reduction.state,
    {
      type: "task-refresh-settled",
      nowMs: 2_000,
      connectionId: connectionA,
      connectionGeneration: refreshA?.connectionGeneration ?? 0,
      effectToken: refreshA?.effectToken ?? "missing",
      result: {
        ok: false,
        error: {
          code: "TRANSPORT_ERROR",
          message: "late A failure",
          execution: "not-sent",
          retryable: true
        }
      }
    },
    config
  );
  assert.equal(afterOldFailure.state.connectionId, connectionB);
  assert.equal(afterOldFailure.state.tasks?.revision, 9);
  assert.equal(afterOldFailure.state.pomodoro.kind, "focus-running");
  assert.equal(afterOldFailure.state.pendingPause, null);
  assert.deepEqual(afterOldFailure.effects, []);
  assert.equal(afterOldFailure.state.lastError, null);
});

test("an old connection reconciliation failure cannot overwrite the current connection success", () => {
  const connectionA = "reused-connection-id";
  const connectionB = "reused-connection-id";
  let state = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionA },
        snapshot: { ...snapshot(0), connectionId: connectionA },
        replayEvents: []
      }
    },
    config
  ).state;
  let reduction = reduceSessionCoordinator(
    state,
    { type: "sequence-gap", nowMs: 100, connectionId: connectionA },
    config
  );
  const reconcileA = reduction.state.pendingReconciliation;
  assert.notEqual(reconcileA, null);
  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "bootstrap",
      nowMs: 100,
      bootstrap: {
        hello: { ...bridgeHello(), connectionId: connectionB },
        snapshot: { ...snapshot(0), connectionId: connectionB },
        replayEvents: []
      }
    },
    config
  );
  reduction = reduceSessionCoordinator(
    reduction.state,
    { type: "sequence-gap", nowMs: 200, connectionId: connectionB },
    config
  );
  const reconcileB = reduction.state.pendingReconciliation;
  assert.notEqual(reconcileB, null);
  reduction = reduceSessionCoordinator(
    reduction.state,
    {
      type: "reconcile-settled",
      nowMs: 200,
      connectionId: connectionB,
      connectionGeneration: reconcileB?.connectionGeneration ?? 0,
      effectToken: reconcileB?.effectToken ?? "missing",
      result: {
        ok: true,
        value: {
          snapshot: { ...snapshot(0), connectionId: connectionB },
          replayEvents: []
        }
      }
    },
    config
  );
  assert.equal(reduction.state.status, "ready");
  const afterOldFailure = reduceSessionCoordinator(
    reduction.state,
    {
      type: "reconcile-settled",
      nowMs: 2_000,
      connectionId: connectionA,
      connectionGeneration: reconcileA?.connectionGeneration ?? 0,
      effectToken: reconcileA?.effectToken ?? "missing",
      result: {
        ok: false,
        error: {
          code: "TRANSPORT_ERROR",
          message: "late A failure",
          execution: "not-sent",
          retryable: true
        }
      }
    },
    config
  );
  assert.equal(afterOldFailure.state.connectionId, connectionB);
  assert.equal(afterOldFailure.state.status, "ready");
  assert.equal(afterOldFailure.state.lastError, null);
});

test("task equality is stable by task id rather than payload order", () => {
  const tasks = {
    revision: 5,
    items: [
      { id: "é", title: "Precomposed", status: "open" as const, project: null },
      { id: "é", title: "Decomposed", status: "completed" as const, project: null }
    ]
  };
  const initialModel = { ...readModel(), tasks };
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, initialModel),
        replayEvents: []
      }
    },
    config
  ).state;
  const requested = reduceSessionCoordinator(
    started,
    { type: "sequence-gap", nowMs: 100, connectionId: CONNECTION_ID },
    config
  );
  const reconciliation = requested.state.pendingReconciliation;
  const reordered = reduceSessionCoordinator(
    requested.state,
    {
      type: "reconcile-settled",
      nowMs: 100,
      connectionId: reconciliation?.connectionId ?? CONNECTION_ID,
      connectionGeneration: reconciliation?.connectionGeneration ?? 0,
      effectToken: reconciliation?.effectToken ?? "missing",
      result: {
        ok: true,
        value: {
          snapshot: snapshot(0, {
            ...initialModel,
            tasks: { ...tasks, items: [...tasks.items].reverse() }
          }),
          replayEvents: []
        }
      }
    },
    config
  );
  assert.equal(reordered.state.status, "ready");
  assert.equal(reordered.state.lastError, null);
});

test("failed task refresh remains diagnostic and does not auto-loop", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  const marked = reduceSessionCoordinator(
    started,
    {
      type: "bridge-event",
      nowMs: 100,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 100,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );
  assert.deepEqual(marked.effects.map((effect) => effect.type), ["refresh-read-model"]);
  const refresh = marked.state.pendingTaskRefresh;

  const failed = reduceSessionCoordinator(
    marked.state,
    {
      type: "task-refresh-settled",
      nowMs: 110,
      connectionId: refresh?.connectionId ?? CONNECTION_ID,
      connectionGeneration: refresh?.connectionGeneration ?? 0,
      effectToken: refresh?.effectToken ?? "missing",
      result: {
        ok: false,
        error: {
          code: "TRANSPORT_ERROR",
          message: "fixture read failure",
          execution: "not-sent",
          retryable: true
        }
      }
    },
    config
  );
  assert.equal(failed.state.taskRefreshRequired, true);
  assert.equal(failed.state.taskRefreshInFlight, false);
  assert.equal(failed.state.taskRefreshAttempts, 2);
  assert.deepEqual(failed.effects, []);
});

test("task refresh fails visibly when the effect sequence is exhausted", () => {
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: []
      }
    },
    config
  ).state;
  const exhausted = { ...started, effectSequence: Number.MAX_SAFE_INTEGER };
  const marked = reduceSessionCoordinator(
    exhausted,
    {
      type: "bridge-event",
      nowMs: 100,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 100,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );

  assert.equal(marked.state.status, "unavailable");
  assert.equal(marked.state.lastError?.code, "INVALID_ARGUMENT");
  assert.match(marked.state.lastError?.message ?? "", /effect sequence is exhausted/);
  assert.equal(marked.state.taskRefreshInFlight, false);
  assert.equal(marked.state.pendingTaskRefresh, null);
  assert.deepEqual(marked.effects, []);
});

test("HUD layout revision regression triggers reconciliation", () => {
  const hud = hudReadModel(0);
  const started = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0, readModel(activeSession(), hud)),
        replayEvents: []
      }
    },
    config
  ).state;
  const regressed = {
    ...hud,
    revision: hud.revision + 1,
    geometry: hud.geometry === null
      ? null
      : { ...hud.geometry, layoutRevision: hud.geometry.layoutRevision - 1 }
  };
  const result = reduceSessionCoordinator(
    started,
    {
      type: "bridge-event",
      nowMs: 100,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 100,
        type: "hud.changed",
        payload: { hud: regressed }
      }
    },
    config
  );
  assert.equal(result.state.status, "reconciling");
  assert.deepEqual(result.effects.map((effect) => effect.type), ["request-reconciliation"]);
});

test("task refresh and HUD events update read models without changing the active cycle", () => {
  const initial = reduceSessionCoordinator(
    createSessionCoordinatorState(),
    {
      type: "bootstrap",
      nowMs: 0,
      bootstrap: {
        hello: bridgeHello(),
        snapshot: snapshot(0),
        replayEvents: [],
      }
    },
    config
  ).state;

  const refreshed = reduceSessionCoordinator(
    initial,
    {
      type: "bridge-event",
      nowMs: 100,
      event: {
        schemaVersion: 1,
        connectionId: CONNECTION_ID,
        sequence: 1,
        occurredAtMs: 100,
        type: "tasks.refresh-required",
        payload: { reason: "changed" }
      }
    },
    config
  );
  assert.equal(refreshed.state.taskRefreshRequired, true);
  assert.equal(refreshed.state.pomodoro.kind, "focus-running");
});

test("coordinator bridge surface exposes only pause and reconciliation effects", () => {
  const bridge = {
    pause: async (): Promise<BridgeResult<SessionCommandAcknowledgement>> => ({
      ok: false,
      error: {
        code: "NOT_CONNECTED",
        message: "fixture",
        execution: "not-sent",
        retryable: false
      }
    }),
    reconcile: async (): Promise<BridgeResult<ReconciliationSnapshot>> => ({
      ok: false,
      error: {
        code: "NOT_CONNECTED",
        message: "fixture",
        execution: "not-sent",
        retryable: false
      }
    }),
    refreshReadModel: async (): Promise<BridgeResult<TaskRefreshSnapshot>> => ({
      ok: false,
      error: {
        code: "NOT_CONNECTED",
        message: "fixture",
        execution: "not-sent",
        retryable: false
      }
    })
  };
  assert.deepEqual(Object.keys(bridge).sort(), ["pause", "reconcile", "refreshReadModel"]);
});
