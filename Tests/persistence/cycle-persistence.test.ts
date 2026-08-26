import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_POMODORO_CONFIG,
  createInitialState,
  pauseRequestIdFor,
  readyOccurrenceIdFor,
  remainingMsAt,
  transition,
  type PomodoroConfig,
  type PomodoroState
} from "../../src/core/index.ts";
import {
  CYCLE_SNAPSHOT_VERSION,
  MAX_PENDING_PAUSE_ATTEMPTS,
  MAX_QUARANTINED_SNAPSHOTS,
  MAX_SNAPSHOT_CHARACTERS,
  decodeCycleSnapshot,
  encodeCycleSnapshot,
  recoverCycleSnapshot,
  type CycleSnapshotV1,
  type RecoveryMetadataV1
} from "../../src/cycle-persistence/index.ts";

const config: PomodoroConfig = {
  focusDurationMs: 10_000,
  shortBreakDurationMs: 4_000,
  longBreakDurationMs: 8_000,
  focusesPerLongBreak: 2,
  autoStartBreak: true
};

const manualBreakConfig: PomodoroConfig = {
  ...config,
  autoStartBreak: false
};

function activeRecovery(): RecoveryMetadataV1 {
  return {
    requiresReconciliation: true,
    sessionId: "session-1",
    bridgeInstanceId: "bridge-instance-1",
    lastObservedRevision: 7,
    pendingPause: null
  };
}

function idleRecovery(): RecoveryMetadataV1 {
  return {
    requiresReconciliation: false,
    sessionId: null,
    bridgeInstanceId: null,
    lastObservedRevision: null,
    pendingPause: null
  };
}

function snapshotFor(
  engineState: PomodoroState,
  savedAt: number,
  recovery: RecoveryMetadataV1 = engineState.kind === "idle"
    ? idleRecovery()
    : activeRecovery(),
  selectedConfig: PomodoroConfig = config
): CycleSnapshotV1 {
  return {
    version: CYCLE_SNAPSHOT_VERSION,
    savedAt,
    config: selectedConfig,
    engineState,
    recovery
  };
}

function startFocus(startedAt = 0, selectedConfig: PomodoroConfig = config): PomodoroState {
  const result = transition(
    createInitialState(),
    { type: "start-focus" },
    selectedConfig,
    startedAt
  );
  assert.equal(result.rejection, undefined);
  assert.equal(result.state.kind, "focus-running");
  return result.state;
}

function awaitingPauseState(): Extract<
  PomodoroState,
  { readonly kind: "focus-paused"; readonly reason: "awaiting-promethee-pause" }
> {
  const focus = startFocus();
  const result = transition(focus, { type: "tick" }, config, 10_000);
  assert.equal(result.state.kind, "focus-paused");
  assert.equal(result.state.reason, "awaiting-promethee-pause");
  if (
    result.state.kind !== "focus-paused" ||
    result.state.reason !== "awaiting-promethee-pause"
  ) {
    throw new Error("Expected awaiting pause state.");
  }
  return result.state;
}

function breakRunningState(): Extract<PomodoroState, { readonly kind: "break-running" }> {
  const awaiting = awaitingPauseState();
  const result = transition(
    awaiting,
    { type: "promethee-pause-confirmed", pauseRequestId: awaiting.pauseRequestId },
    config,
    10_100
  );
  assert.equal(result.state.kind, "break-running");
  if (result.state.kind !== "break-running") {
    throw new Error("Expected running break state.");
  }
  return result.state;
}

function everyEngineVariant(): readonly {
  readonly state: PomodoroState;
  readonly savedAt: number;
  readonly selectedConfig?: PomodoroConfig;
}[] {
  const idle = createInitialState();
  const running = startFocus();
  const manuallyPaused = transition(
    running,
    { type: "promethee-paused" },
    config,
    4_000
  ).state;
  const awaitingPause = awaitingPauseState();
  const awaitingBreak = transition(
    awaitingPause,
    {
      type: "promethee-pause-confirmed",
      pauseRequestId: awaitingPause.pauseRequestId
    },
    manualBreakConfig,
    10_100
  ).state;
  const runningBreak = breakRunningState();
  const ready = transition(
    runningBreak,
    { type: "tick" },
    config,
    runningBreak.deadlineAtMs
  ).state;

  return [
    { state: idle, savedAt: 0 },
    { state: running, savedAt: 5_000 },
    { state: manuallyPaused, savedAt: 4_000 },
    { state: awaitingPause, savedAt: 10_000 },
    { state: awaitingBreak, savedAt: 10_100, selectedConfig: manualBreakConfig },
    { state: runningBreak, savedAt: 10_100 },
    { state: ready, savedAt: runningBreak.deadlineAtMs }
  ];
}

test("version 1 round-trips every exact engine-state variant deterministically", () => {
  for (const variant of everyEngineVariant()) {
    const snapshot = snapshotFor(
      variant.state,
      variant.savedAt,
      undefined,
      variant.selectedConfig ?? config
    );
    const first = encodeCycleSnapshot(snapshot);
    assert.equal(first.ok, true);
    if (!first.ok) {
      continue;
    }
    const decoded = decodeCycleSnapshot(first.serialized);
    assert.equal(decoded.kind, "valid");
    if (decoded.kind !== "valid") {
      continue;
    }
    assert.deepEqual(decoded.snapshot, snapshot);
    assert.deepEqual(encodeCycleSnapshot(decoded.snapshot), first);
  }
});

test("the allowlist rejects extra top-level, config, engine, and recovery fields", () => {
  const running = startFocus();
  const valid = snapshotFor(running, 5_000);
  const invalidCandidates = [
    { ...valid, tasks: [{ id: "private-task" }] },
    { ...valid, hud: { bounds: [1, 2, 3, 4] } },
    { ...valid, grants: ["session.pause"] },
    { ...valid, accessToken: "must-not-persist" },
    { ...valid, config: { ...valid.config, privateConfiguration: true } },
    { ...valid, engineState: { ...valid.engineState, acceptedLocalActions: [] } },
    { ...valid, recovery: { ...valid.recovery, connectionGeneration: 3 } },
    { ...valid, recovery: { ...valid.recovery, effectToken: "effect-1" } },
    { ...valid, recovery: { ...valid.recovery, checkpoint: {} } },
    { ...valid, recovery: { ...valid.recovery, nativeHandle: 42 } }
  ];

  for (const candidate of invalidCandidates) {
    const encoded = encodeCycleSnapshot(candidate);
    assert.equal(encoded.ok, false);
  }
});

test("pending pause persistence is correlation-only and has a bounded retry count", () => {
  const awaiting = awaitingPauseState();
  for (const attempts of [1, MAX_PENDING_PAUSE_ATTEMPTS]) {
    const snapshot = snapshotFor(awaiting, 10_000, {
      ...activeRecovery(),
      pendingPause: {
        commandId: "pause-command-1",
        pauseRequestId: awaiting.pauseRequestId,
        attempts
      }
    });
    assert.equal(encodeCycleSnapshot(snapshot).ok, true);
  }

  for (const attempts of [0, MAX_PENDING_PAUSE_ATTEMPTS + 1]) {
    const snapshot = snapshotFor(awaiting, 10_000, {
      ...activeRecovery(),
      pendingPause: {
        commandId: "pause-command-1",
        pauseRequestId: awaiting.pauseRequestId,
        attempts
      }
    });
    assert.equal(encodeCycleSnapshot(snapshot).ok, false);
  }

  const mismatch = snapshotFor(awaiting, 10_000, {
    ...activeRecovery(),
    pendingPause: {
      commandId: "pause-command-1",
      pauseRequestId: "pause:another-phase",
      attempts: 1
    }
  });
  assert.equal(encodeCycleSnapshot(mismatch).ok, false);

  const leakedEffectIdentity = snapshotFor(awaiting, 10_000, {
    ...activeRecovery(),
    pendingPause: {
      commandId: "pause-command-1",
      pauseRequestId: awaiting.pauseRequestId,
      attempts: 1,
      effectToken: "must-not-persist"
    } as never
  });
  assert.equal(encodeCycleSnapshot(leakedEffectIdentity).ok, false);

  const running = snapshotFor(startFocus(), 5_000, {
    ...activeRecovery(),
    pendingPause: {
      commandId: "pause-command-1",
      pauseRequestId: awaiting.pauseRequestId,
      attempts: 1
    }
  });
  assert.equal(encodeCycleSnapshot(running).ok, false);
});

test("active state requires complete session identity and reconciliation quarantine", () => {
  const running = startFocus();
  const missingSession = snapshotFor(running, 5_000, {
    ...idleRecovery(),
    requiresReconciliation: true
  });
  assert.equal(encodeCycleSnapshot(missingSession).ok, false);

  const notQuarantined = snapshotFor(running, 5_000, {
    ...activeRecovery(),
    requiresReconciliation: false
  });
  assert.equal(encodeCycleSnapshot(notQuarantined).ok, false);
});

test("malformed, truncated, and oversized JSON returns typed corrupt fallback", () => {
  for (const [serialized, code] of [
    ["{", "MALFORMED_JSON"],
    ['{"version":1', "MALFORMED_JSON"],
    ["x".repeat(MAX_SNAPSHOT_CHARACTERS + 1), "SNAPSHOT_TOO_LARGE"]
  ] as const) {
    const result = decodeCycleSnapshot(serialized);
    assert.equal(result.kind, "corrupt-current");
    if (result.kind === "corrupt-current") {
      assert.equal(result.warning.code, code);
      assert.equal(result.writePolicy, "quarantine-before-replace");
      assert.equal(result.maxQuarantinedSnapshots, MAX_QUARANTINED_SNAPSHOTS);
      assert.deepEqual(result.prometheeMutations, []);
    }
  }
});

test("unknown future version is preserved byte-for-byte and read-only", () => {
  const serialized = '{ "version": 2, "unknown": true, "accessToken": "opaque" }';
  const result = decodeCycleSnapshot(serialized);
  assert.equal(result.kind, "future-version");
  if (result.kind === "future-version") {
    assert.equal(result.version, 2);
    assert.equal(result.preservedSerialized, serialized);
    assert.equal(result.readOnly, true);
    assert.equal(result.writePolicy, "preserve-unchanged");
    assert.deepEqual(result.prometheeMutations, []);
  }
});

test("unsupported past and invalid versions cannot create an active cycle", () => {
  for (const serialized of [
    JSON.stringify({ version: 0, config }),
    JSON.stringify({ version: "1", config }),
    JSON.stringify({ config })
  ]) {
    const result = decodeCycleSnapshot(serialized);
    assert.equal(result.kind, "corrupt-current");
    if (result.kind === "corrupt-current") {
      assert.equal(result.engineState.kind, "idle");
      assert.deepEqual(result.prometheeMutations, []);
    }
  }
});

test("corrupt current cycle salvages only an independently exact valid config", () => {
  const corruptCycle = {
    ...snapshotFor(startFocus(), 5_000),
    engineState: { kind: "focus-running", deadlineAtMs: -1 }
  };
  const salvaged = decodeCycleSnapshot(JSON.stringify(corruptCycle));
  assert.equal(salvaged.kind, "corrupt-current");
  if (salvaged.kind === "corrupt-current") {
    assert.equal(salvaged.configSource, "snapshot");
    assert.deepEqual(salvaged.config, config);
    assert.equal(salvaged.engineState.kind, "idle");
  }

  const invalidConfig = {
    ...corruptCycle,
    config: { ...config, focusDurationMs: -1 }
  };
  const defaulted = decodeCycleSnapshot(JSON.stringify(invalidConfig));
  assert.equal(defaulted.kind, "corrupt-current");
  if (defaulted.kind === "corrupt-current") {
    assert.equal(defaulted.configSource, "defaults");
    assert.deepEqual(defaulted.config, DEFAULT_POMODORO_CONFIG);
  }

  const configWithExtra = {
    ...corruptCycle,
    config: { ...config, token: "not-allowlisted" }
  };
  const notSalvaged = decodeCycleSnapshot(JSON.stringify(configWithExtra));
  assert.equal(notSalvaged.kind, "corrupt-current");
  if (notSalvaged.kind === "corrupt-current") {
    assert.equal(notSalvaged.configSource, "defaults");
  }
});

test("restore uses max(savedAt, suppliedNow) and never extends running focus", () => {
  const running = startFocus();
  const recovered = recoverCycleSnapshot(snapshotFor(running, 6_000), 1_000);
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind !== "recovered") {
    return;
  }
  assert.equal(recovered.effectiveNow, 6_000);
  assert.equal(remainingMsAt(recovered.engineState, recovered.effectiveNow), 4_000);
  assert.equal(recovered.diagnostics[0]?.code, "BACKWARD_CLOCK_CLAMPED");
  assert.equal(recovered.quarantine, "requires-authoritative-reconciliation");
  assert.deepEqual(recovered.prometheeMutations, []);
});

test("restore before a deadline derives elapsed focus without changing its deadline", () => {
  const running = startFocus();
  const recovered = recoverCycleSnapshot(snapshotFor(running, 2_000), 7_500);
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind === "recovered") {
    assert.deepEqual(recovered.engineState, running);
    assert.equal(remainingMsAt(recovered.engineState, recovered.effectiveNow), 2_500);
    assert.deepEqual(recovered.diagnostics, []);
    assert.deepEqual(recovered.prometheeMutations, []);
  }
});

test("expired focus recovers awaiting coordinated pause without emitting a mutation", () => {
  const running = startFocus();
  const recovered = recoverCycleSnapshot(snapshotFor(running, 5_000), 11_000);
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind !== "recovered") {
    return;
  }
  assert.equal(recovered.engineState.kind, "focus-paused");
  assert.equal(recovered.engineState.reason, "awaiting-promethee-pause");
  if (
    recovered.engineState.kind === "focus-paused" &&
    recovered.engineState.reason === "awaiting-promethee-pause"
  ) {
    assert.equal(recovered.engineState.pauseRequestId, pauseRequestIdFor(recovered.engineState.phaseId));
    assert.equal(recovered.engineState.breakSource, "completed-focus");
  }
  assert.equal(recovered.recovery.pendingPause, null);
  assert.equal(
    recovered.diagnostics.at(-1)?.code,
    "FOCUS_EXPIRED_AWAITING_COORDINATED_PAUSE"
  );
  assert.deepEqual(recovered.prometheeMutations, []);
});

test("expired break recovers deterministic Ready identity without completion effect", () => {
  const runningBreak = breakRunningState();
  const snapshot = snapshotFor(runningBreak, 11_000);
  const first = recoverCycleSnapshot(snapshot, runningBreak.deadlineAtMs + 1);
  const second = recoverCycleSnapshot(snapshot, runningBreak.deadlineAtMs + 5_000);
  assert.equal(first.kind, "recovered");
  assert.equal(second.kind, "recovered");
  if (first.kind !== "recovered" || second.kind !== "recovered") {
    return;
  }
  assert.equal(first.engineState.kind, "ready");
  assert.deepEqual(first.engineState, second.engineState);
  if (first.engineState.kind === "ready") {
    assert.equal(
      first.engineState.readyOccurrenceId,
      readyOccurrenceIdFor(
        runningBreak.cycleInstance,
        runningBreak.phaseSequence,
        runningBreak.breakSource
      )
    );
  }
  assert.equal(first.diagnostics.at(-1)?.code, "BREAK_EXPIRED_READY");
  assert.deepEqual(first.prometheeMutations, []);
});

test("persisted Ready identity is preserved verbatim across recovery", () => {
  const runningBreak = breakRunningState();
  const ready = transition(
    runningBreak,
    { type: "tick" },
    config,
    runningBreak.deadlineAtMs
  ).state;
  assert.equal(ready.kind, "ready");
  const recovered = recoverCycleSnapshot(
    snapshotFor(ready, runningBreak.deadlineAtMs),
    runningBreak.deadlineAtMs + 100_000
  );
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind === "recovered" && recovered.engineState.kind === "ready") {
    assert.equal(
      recovered.engineState.readyOccurrenceId,
      ready.kind === "ready" ? ready.readyOccurrenceId : null
    );
    assert.deepEqual(recovered.diagnostics, []);
  }
});

test("manually paused focus preserves frozen remainder regardless of elapsed time", () => {
  const running = startFocus();
  const paused = transition(
    running,
    { type: "promethee-paused" },
    config,
    4_000
  ).state;
  assert.equal(paused.kind, "focus-paused");
  assert.equal(paused.reason, "promethee-paused");
  const recovered = recoverCycleSnapshot(
    snapshotFor(paused, 4_000),
    1_000_000
  );
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind === "recovered") {
    assert.deepEqual(recovered.engineState, paused);
    assert.equal(remainingMsAt(recovered.engineState, recovered.effectiveNow), 6_000);
    assert.deepEqual(recovered.prometheeMutations, []);
  }
});

test("lost-ack pause correlation and exhausted attempt count restore without retry", () => {
  const awaiting = awaitingPauseState();
  const pendingPause = {
    commandId: "stable-pause-command",
    pauseRequestId: awaiting.pauseRequestId,
    attempts: MAX_PENDING_PAUSE_ATTEMPTS
  } as const;
  const recovered = recoverCycleSnapshot(
    snapshotFor(awaiting, 10_000, {
      ...activeRecovery(),
      pendingPause
    }),
    20_000
  );
  assert.equal(recovered.kind, "recovered");
  if (recovered.kind === "recovered") {
    assert.deepEqual(recovered.recovery.pendingPause, pendingPause);
    assert.equal(recovered.quarantine, "requires-authoritative-reconciliation");
    assert.deepEqual(recovered.prometheeMutations, []);
  }
});

test("invalid recovery time preserves the valid snapshot and emits nothing", () => {
  const recovered = recoverCycleSnapshot(
    snapshotFor(startFocus(), 5_000),
    -1
  );
  assert.equal(recovered.kind, "recovery-rejected");
  if (recovered.kind === "recovery-rejected") {
    assert.equal(recovered.warning.code, "INVALID_RECOVERY_TIME");
    assert.equal(recovered.writePolicy, "preserve-unchanged");
    assert.equal(recovered.engineState.kind, "idle");
    assert.deepEqual(recovered.prometheeMutations, []);
  }
});

test("snapshot savedAt cannot precede the persisted running phase start", () => {
  const running = startFocus(5_000);
  const encoded = encodeCycleSnapshot(snapshotFor(running, 4_999));
  assert.equal(encoded.ok, false);
  if (!encoded.ok) {
    assert.equal(encoded.warning.code, "INVALID_ENGINE_STATE");
  }
});
