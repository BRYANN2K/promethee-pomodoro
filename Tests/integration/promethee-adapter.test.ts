import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETE_READ_MODEL_REQUIREMENTS,
  PrometheeAdapterV1,
  ScriptedBridgePort,
  SESSION_COORDINATION_REQUIREMENTS,
  createClientHello,
  selectUsableHudGeometry,
  type AdapterSignal,
  type CapabilityGrant,
  type SessionCommand,
  type SessionCommandAcknowledgement
} from "../../src/promethee-adapter/v1/index.ts";
import {
  CONNECTION_ID,
  NONCE,
  activeSession,
  bridgeHello,
  completeGrants,
  hudReadModel,
  readModel,
  sessionChanged,
  snapshot
} from "./fixtures.ts";

test("unknown Promethee 1.3.29 fails closed unless a compatibility fixture allowlists it", async () => {
  const deniedPort = new ScriptedBridgePort({
    hello: bridgeHello("1.3.29"),
    snapshots: [snapshot()]
  });
  const denied = await new PrometheeAdapterV1(deniedPort).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.error.code, "UNSUPPORTED_PROMETHEE_VERSION");
    assert.equal(denied.error.execution, "not-sent");
  }
  assert.equal(deniedPort.calls.snapshotConnectionIds.length, 0);
  assert.equal(deniedPort.calls.pauses.length, 0);

  const allowedPort = new ScriptedBridgePort({
    hello: bridgeHello("1.3.29"),
    snapshots: [snapshot()]
  });
  const allowed = await new PrometheeAdapterV1(allowedPort, {
    allowedPrometheeVersions: ["1.3.29"],
    supportedProtocolVersions: [1]
  }).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(allowed.ok, true);
});

test("bridge protocol compatibility is negotiated independently from the Promethee app version", async () => {
  const policy = {
    allowedPrometheeVersions: ["1.3.29"],
    supportedProtocolVersions: [1]
  };
  const supportedPort = new ScriptedBridgePort({
    hello: bridgeHello("1.3.29"),
    snapshots: [snapshot()]
  });
  const supported = await new PrometheeAdapterV1(supportedPort, policy).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(supported.ok, true);
  assert.equal(supportedPort.calls.snapshotConnectionIds.length, 1);

  const unsupportedPort = new ScriptedBridgePort({
    hello: { ...bridgeHello("1.3.29"), protocolVersion: 2 }
  });
  const unsupported = await new PrometheeAdapterV1(unsupportedPort, policy).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) {
    assert.equal(unsupported.error.code, "UNSUPPORTED_PROTOCOL");
    assert.equal(unsupported.error.execution, "not-sent");
  }
  assert.equal(unsupportedPort.calls.snapshotConnectionIds.length, 0);
  assert.equal(unsupportedPort.calls.pauses.length, 0);
  assert.equal(unsupportedPort.calls.resumes.length, 0);
});

test("negotiation rejects broad and unrequested operation grants before reading state", async () => {
  const broadGrants = completeGrants().map((grant) =>
    grant.id === "session.pause"
      ? {
          id: "session.pause",
          version: 1,
          operations: ["session.pause", "session.resume"]
        }
      : grant
  );
  const broadPort = new ScriptedBridgePort({
    hello: bridgeHello("1.3.26", broadGrants as readonly CapabilityGrant[])
  });
  const broad = await new PrometheeAdapterV1(broadPort).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(broad.ok, false);
  if (!broad.ok) {
    assert.equal(broad.error.code, "INVALID_PAYLOAD");
  }
  assert.equal(broadPort.calls.snapshotConnectionIds.length, 0);

  const request = createClientHello("0.0.0", NONCE);
  const requestWithoutResumeOperation = {
    ...request,
    requestedCapabilities: request.requestedCapabilities.map(
      (capability) => capability.id === "session.resume"
        ? { id: capability.id, supportedVersions: capability.supportedVersions }
        : capability
    )
  };
  const unrequestedPort = new ScriptedBridgePort({ hello: bridgeHello() });
  const unrequested = await new PrometheeAdapterV1(unrequestedPort).connect(
    requestWithoutResumeOperation,
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(unrequested.ok, false);
  if (!unrequested.ok) {
    assert.equal(unrequested.error.code, "INVALID_PAYLOAD");
  }
  assert.equal(unrequestedPort.calls.snapshotConnectionIds.length, 0);
  assert.equal(unrequestedPort.calls.pauses.length, 0);
  assert.equal(unrequestedPort.calls.resumes.length, 0);
});

test("complete read-model negotiation requires the distinct hud.geometry capability", async () => {
  const grants = completeGrants().filter((grant) => grant.id !== "hud.geometry");
  const port = new ScriptedBridgePort({ hello: bridgeHello("1.3.26", grants) });
  const result = await new PrometheeAdapterV1(port).connect(
    createClientHello("0.0.0", NONCE),
    COMPLETE_READ_MODEL_REQUIREMENTS
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "MISSING_CAPABILITY");
    assert.equal(result.error.execution, "not-sent");
  }
  assert.equal(port.calls.snapshotConnectionIds.length, 0);
  assert.equal(port.calls.pauses.length, 0);
  assert.equal(port.calls.resumes.length, 0);
});

test("unknown mutation operations and malformed mutation payloads are never dispatched", async () => {
  const request = createClientHello("0.0.0", NONCE);
  const unknownOperationRequest = {
    ...request,
    requestedCapabilities: request.requestedCapabilities.map((capability) =>
      capability.id === "session.pause"
        ? { ...capability, operations: ["session.stop"] }
        : capability
    )
  };
  const unknownOperationPort = new ScriptedBridgePort({ hello: bridgeHello() });
  const unknownOperation = await new PrometheeAdapterV1(unknownOperationPort).connect(
    unknownOperationRequest as never,
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(unknownOperation.ok, false);
  if (!unknownOperation.ok) {
    assert.equal(unknownOperation.error.code, "INVALID_ARGUMENT");
    assert.equal(unknownOperation.error.execution, "not-sent");
  }
  assert.equal(unknownOperationPort.calls.hellos.length, 0);
  assert.equal(unknownOperationPort.calls.pauses.length, 0);
  assert.equal(unknownOperationPort.calls.resumes.length, 0);

  const malformedPayloadPort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()]
  });
  const adapter = new PrometheeAdapterV1(malformedPayloadPort);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);

  const malformedPayload = await adapter.pause({
    commandId: "unknown-mutation-field",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1,
    operation: "session.stop"
  } as never);
  assert.equal(malformedPayload.ok, false);
  if (!malformedPayload.ok) {
    assert.equal(malformedPayload.error.code, "INVALID_ARGUMENT");
    assert.equal(malformedPayload.error.execution, "not-sent");
  }
  assert.equal(malformedPayloadPort.calls.pauses.length, 0);
  assert.equal(malformedPayloadPort.calls.resumes.length, 0);
});

test("negotiation rejects a missing operation grant before reading state", async () => {
  const grants = completeGrants().map((grant): CapabilityGrant =>
    grant.id === "session.pause"
      ? { id: "session.pause", version: 1 }
      : grant
  );
  const port = new ScriptedBridgePort({ hello: bridgeHello("1.3.26", grants) });
  const result = await new PrometheeAdapterV1(port).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "OPERATION_DENIED");
  }
  assert.equal(port.calls.snapshotConnectionIds.length, 0);
});

test("pause is an exact required grant while resume remains optional", async () => {
  const grants = completeGrants().filter((grant) => grant.id !== "session.resume");
  const port = new ScriptedBridgePort({
    hello: bridgeHello("1.3.26", grants),
    snapshots: [snapshot()]
  });
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);
  assert.equal(
    SESSION_COORDINATION_REQUIREMENTS.some((requirement) => requirement.id === "session.resume"),
    false
  );

  const denied = await adapter.resume({
    commandId: "optional-resume",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.error.code, "OPERATION_DENIED");
    assert.equal(denied.error.execution, "not-sent");
  }
  assert.equal(port.calls.resumes.length, 0);
});

test("malformed snapshots and live payloads fail closed", async () => {
  const malformedSnapshotPort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [{ connectionId: CONNECTION_ID, atSequence: 0, value: { session: {} } }]
  });
  const malformedSnapshot = await new PrometheeAdapterV1(malformedSnapshotPort).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(malformedSnapshot.ok, false);
  if (!malformedSnapshot.ok) {
    assert.equal(malformedSnapshot.error.code, "INVALID_PAYLOAD");
  }

  const signals: AdapterSignal[] = [];
  const livePort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()]
  });
  const adapter = new PrometheeAdapterV1(livePort);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS,
    (signal) => signals.push(signal)
  );
  assert.equal(connected.ok, true);

  livePort.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: 100,
    type: "session.changed",
    payload: { session: { id: "missing-required-fields" } }
  });
  assert.equal(signals.at(-1)?.type, "protocol-fault");

  const blocked = await adapter.pause({
    commandId: "blocked-command",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.error.code, "SEQUENCE_GAP");
    assert.equal(blocked.error.execution, "not-sent");
  }
  assert.equal(livePort.calls.pauses.length, 0);
});

test("subscription precedes snapshot and replays only buffered events newer than atSequence", async () => {
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(10, readModel(activeSession("running", 10)))]
  });
  port.beforeNextSnapshotRead(() => {
    port.emit(sessionChanged(10, activeSession("running", 10)));
    port.emit(sessionChanged(11, activeSession("paused", 11)));
  });

  const connected = await new PrometheeAdapterV1(port).connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);
  if (connected.ok) {
    assert.deepEqual(connected.value.replayEvents.map((event) => event.sequence), [11]);
    assert.equal(connected.value.replayEvents[0]?.type, "session.changed");
  }
});

test("a buffered sequence gap fails bootstrap and reconciliation instead of returning partial success", async () => {
  const bootstrapPort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(10)]
  });
  bootstrapPort.beforeNextSnapshotRead(() => {
    bootstrapPort.emit(sessionChanged(12, activeSession("paused", 2)));
  });
  const bootstrapAdapter = new PrometheeAdapterV1(bootstrapPort);
  const bootstrap = await bootstrapAdapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(bootstrap.ok, false);
  if (!bootstrap.ok) {
    assert.equal(bootstrap.error.code, "SEQUENCE_GAP");
  }
  assert.equal(bootstrapAdapter.connectionId, null);

  const reconcilePort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(10), snapshot(10)]
  });
  const reconcileAdapter = new PrometheeAdapterV1(reconcilePort);
  const connected = await reconcileAdapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);
  reconcilePort.emit(sessionChanged(12, activeSession("paused", 2)));
  const reconciled = await reconcileAdapter.reconcile();
  assert.equal(reconciled.ok, false);
  if (!reconciled.ok) {
    assert.equal(reconciled.error.code, "SEQUENCE_GAP");
  }
});

test("duplicate, stale-connection, and gapped events never enter the live stream", async () => {
  const signals: AdapterSignal[] = [];
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(10)]
  });
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS,
    (signal) => signals.push(signal)
  );
  assert.equal(connected.ok, true);

  port.emit(sessionChanged(11, activeSession("paused", 2)));
  port.emit(sessionChanged(11, activeSession("paused", 2)));
  port.emit(sessionChanged(12, activeSession("running", 3), "old-connection"));
  port.emit(sessionChanged(13, activeSession("running", 3)));

  assert.deepEqual(
    signals.map((signal) => signal.type),
    ["event", "event-dropped", "event-dropped", "sequence-gap"]
  );
  const gap = signals.at(-1);
  assert.equal(gap?.type, "sequence-gap");
  if (gap?.type === "sequence-gap") {
    assert.equal(gap.expectedSequence, 12);
    assert.equal(gap.receivedSequence, 13);
  }
});

test("task and HUD read models validate negative display coordinates and reject stale geometry", async () => {
  const freshHud = hudReadModel(1_000);
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0, readModel(activeSession(), freshHud))]
  });
  const connected = await new PrometheeAdapterV1(port).connect(
    createClientHello("0.0.0", NONCE),
    COMPLETE_READ_MODEL_REQUIREMENTS
  );
  assert.equal(connected.ok, true);
  if (!connected.ok) {
    return;
  }

  assert.equal(connected.value.snapshot.value.tasks?.items[0]?.id, "task-1");
  assert.equal(connected.value.snapshot.value.hud?.geometry?.coordinateSpace, "electron-dip");
  assert.equal(connected.value.snapshot.value.hud?.geometry?.timerBounds.x, -220);
  assert.notEqual(selectUsableHudGeometry(connected.value.snapshot.value.hud, 1_500, 600), null);
  assert.equal(selectUsableHudGeometry(connected.value.snapshot.value.hud, 1_700, 600), null);

  const invalidHud = {
    ...freshHud,
    geometry: {
      ...freshHud.geometry,
      timerBounds: { x: 0, y: 0, width: 0, height: 42 }
    }
  };
  const invalidPort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0, readModel(activeSession(), invalidHud as never))]
  });
  const invalid = await new PrometheeAdapterV1(invalidPort).connect(
    createClientHello("0.0.0", NONCE),
    COMPLETE_READ_MODEL_REQUIREMENTS
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error.code, "INVALID_PAYLOAD");
  }

  const outsideHud = {
    ...freshHud,
    geometry: {
      ...freshHud.geometry,
      timerBounds: { x: 10, y: 10, width: 200, height: 40 },
      workArea: { x: 0, y: 0, width: 100, height: 100 }
    }
  };
  const outsidePort = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot(0, readModel(activeSession(), outsideHud as never))]
  });
  const outside = await new PrometheeAdapterV1(outsidePort).connect(
    createClientHello("0.0.0", NONCE),
    COMPLETE_READ_MODEL_REQUIREMENTS
  );
  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.equal(outside.error.code, "INVALID_PAYLOAD");
  }
});

test("bridge closing revokes authority before an in-flight acknowledgement can resolve", async () => {
  let resolveAcknowledgement: ((value: unknown) => void) | null = null;
  const delayed = new Promise<unknown>((resolve) => {
    resolveAcknowledgement = resolve;
  });
  const signals: AdapterSignal[] = [];
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => delayed]
  });
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS,
    (signal) => signals.push(signal)
  );
  assert.equal(connected.ok, true);

  const command: SessionCommand = {
    commandId: "closing-in-flight",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1
  };
  const pending = adapter.pause(command);
  port.emit({
    schemaVersion: 1,
    connectionId: CONNECTION_ID,
    sequence: 1,
    occurredAtMs: 100,
    type: "bridge.closing",
    payload: { reason: "revoked" }
  });
  assert.equal(adapter.connectionId, null);
  assert.equal(signals.at(-1)?.type, "event");

  resolveAcknowledgement?.({
    commandId: command.commandId,
    connectionId: CONNECTION_ID,
    outcome: "applied",
    authoritative: {
      connectionId: CONNECTION_ID,
      atSequence: 1,
      value: activeSession("paused", 2)
    },
    rejection: null
  });
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "CONNECTION_CHANGED");
    assert.equal(result.error.execution, "indeterminate");
  }
});

test("command cache and late results are scoped to the negotiated connection generation", async () => {
  let helloCount = 0;
  const connectionIds = ["connection-a", "connection-b"] as const;
  const helloScript = () => ({
    ...bridgeHello(),
    connectionId: connectionIds[Math.min(helloCount++, 1)]
  });
  const firstSnapshot = { ...snapshot(), connectionId: "connection-a" };
  const secondSnapshot = { ...snapshot(), connectionId: "connection-b" };
  const acknowledgement = (candidate?: unknown) => {
    const command = candidate as SessionCommand;
    return {
      commandId: command.commandId,
      connectionId: command.connectionId,
      outcome: "applied",
      authoritative: {
        connectionId: command.connectionId,
        atSequence: 0,
        value: activeSession("paused", 2)
      },
      rejection: null
    };
  };
  const port = new ScriptedBridgePort({
    hello: helloScript,
    snapshots: [firstSnapshot, secondSnapshot],
    pauses: [acknowledgement, acknowledgement]
  });
  const adapter = new PrometheeAdapterV1(port);

  const first = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(first.ok, true);
  const firstResult = await adapter.pause({
    commandId: "same-command-id",
    connectionId: "connection-a",
    sessionId: "session-1",
    expectedRevision: 1
  });
  assert.equal(firstResult.ok, true);

  const second = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(second.ok, true);
  const secondResult = await adapter.pause({
    commandId: "same-command-id",
    connectionId: "connection-b",
    sessionId: "session-1",
    expectedRevision: 1
  });
  assert.equal(secondResult.ok, true);
  assert.equal(port.calls.pauses.length, 2);
});

test("adapter-owned command timeout resolves a never-settling bridge promise as indeterminate", async () => {
  const never = new Promise<unknown>(() => undefined);
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => never]
  });
  const adapter = new PrometheeAdapterV1(
    port,
    {
      allowedPrometheeVersions: ["1.3.26"],
      supportedProtocolVersions: [1]
    },
    {
      negotiationTimeoutMs: 100,
      snapshotTimeoutMs: 100,
      commandTimeoutMs: 10,
      scheduler: {
        schedule: (callback, delayMs) => setTimeout(callback, delayMs),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
      }
    }
  );
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);

  const result = await adapter.pause({
    commandId: "never-settles",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "TRANSPORT_ERROR");
    assert.equal(result.error.execution, "indeterminate");
  }
});

test("concurrent identical commands share one bridge invocation", async () => {
  let resolveAcknowledgement: ((value: unknown) => void) | null = null;
  const delayed = new Promise<unknown>((resolve) => {
    resolveAcknowledgement = resolve;
  });
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => delayed]
  });
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);
  const command: SessionCommand = {
    commandId: "concurrent-deduplicated",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 1
  };

  const first = adapter.pause(command);
  const second = adapter.pause(command);
  assert.equal(port.calls.pauses.length, 1);
  resolveAcknowledgement?.(pauseAck(command, activeSession("paused", 2)));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(secondResult, firstResult);
  assert.equal(firstResult.ok, true);
  assert.equal(port.calls.pauses.length, 1);
});

test("acknowledgement revision older than the command precondition fails closed", async () => {
  const command: SessionCommand = {
    commandId: "stale-authoritative-revision",
    connectionId: CONNECTION_ID,
    sessionId: "session-1",
    expectedRevision: 2
  };
  const port = new ScriptedBridgePort({
    hello: bridgeHello(),
    snapshots: [snapshot()],
    pauses: [() => pauseAck(command, activeSession("paused", 1))]
  });
  const adapter = new PrometheeAdapterV1(port);
  const connected = await adapter.connect(
    createClientHello("0.0.0", NONCE),
    SESSION_COORDINATION_REQUIREMENTS
  );
  assert.equal(connected.ok, true);

  const result = await adapter.pause(command);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "INVALID_PAYLOAD");
    assert.equal(result.error.execution, "indeterminate");
  }
});

function pauseAck(
  command: SessionCommand,
  session: ReturnType<typeof activeSession>
): SessionCommandAcknowledgement {
  return {
    commandId: command.commandId,
    connectionId: command.connectionId,
    outcome: "applied",
    authoritative: {
      connectionId: command.connectionId,
      atSequence: 0,
      value: session
    },
    rejection: null
  };
}
