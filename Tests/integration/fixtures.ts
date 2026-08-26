import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SCHEMA_VERSION,
  SAFE_V1_CAPABILITY_REQUESTS,
  type ActiveSession,
  type BridgeEvent,
  type BridgeHello,
  type BridgeReadModel,
  type CapabilityGrant,
  type HudReadModel,
  type SessionCommandAcknowledgement,
  type SnapshotEnvelope
} from "../../src/promethee-adapter/v1/index.ts";

export const CONNECTION_ID = "fixture-connection";
export const NONCE = "fixture-nonce";

export function completeGrants(): readonly CapabilityGrant[] {
  return SAFE_V1_CAPABILITY_REQUESTS.map((request) =>
    request.operations === undefined
      ? { id: request.id, version: BRIDGE_PROTOCOL_VERSION }
      : {
          id: request.id,
          version: BRIDGE_PROTOCOL_VERSION,
          operations: request.operations
        }
  );
}

export function bridgeHello(
  prometheeVersion = "1.3.26",
  grants: readonly CapabilityGrant[] = completeGrants()
): BridgeHello {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    prometheeVersion,
    connectionId: CONNECTION_ID,
    nonce: NONCE,
    grants
  };
}

export function activeSession(
  status: ActiveSession["status"] = "running",
  revision = 1,
  id = "session-1"
): ActiveSession {
  return {
    id,
    status,
    revision,
    taskId: "task-1",
    startedAtMs: 0
  };
}

export function hudReadModel(measuredAtMs = 1_000): HudReadModel {
  return {
    revision: 4,
    visible: true,
    mode: "running",
    placement: "floating",
    geometry: {
      coordinateSpace: "electron-dip",
      timerBounds: { x: -220, y: -60, width: 174, height: 42 },
      workArea: { x: -1_440, y: -900, width: 1_440, height: 900 },
      displayId: "display-left",
      scaleFactor: 2,
      layoutRevision: 8,
      measuredAtMs
    }
  };
}

export function readModel(
  session: ActiveSession | null = activeSession(),
  hud: HudReadModel | null = null
): BridgeReadModel {
  return {
    session,
    tasks: {
      revision: 3,
      items: [
        {
          id: "task-1",
          title: "Inspect the bridge contract",
          status: "open",
          project: { id: "project-1", title: "Promethee" }
        }
      ]
    },
    hud
  };
}

export function snapshot(
  atSequence = 0,
  value: BridgeReadModel = readModel()
): SnapshotEnvelope<BridgeReadModel> {
  return { connectionId: CONNECTION_ID, atSequence, value };
}

export function sessionChanged(
  sequence: number,
  session: ActiveSession | null,
  connectionId = CONNECTION_ID,
  occurredAtMs = sequence * 100
): BridgeEvent {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    connectionId,
    sequence,
    occurredAtMs,
    type: "session.changed",
    payload: { session }
  };
}

export function terminalEvent(
  sequence: number,
  sessionId = "session-1"
): BridgeEvent {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    connectionId: CONNECTION_ID,
    sequence,
    occurredAtMs: sequence * 100,
    type: "session.terminal",
    payload: { sessionId, reason: "completed" }
  };
}

export function pauseAcknowledgement(
  commandId: string,
  authoritativeSession: ActiveSession | null,
  atSequence = 0
): SessionCommandAcknowledgement {
  return {
    commandId,
    connectionId: CONNECTION_ID,
    outcome: "applied",
    authoritative: {
      connectionId: CONNECTION_ID,
      atSequence,
      value: authoritativeSession
    },
    rejection: null
  };
}
