import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SCHEMA_VERSION,
  type ActiveSession,
  type BridgeError,
  type BridgeEvent,
  type BridgeHello,
  type BridgeOperation,
  type BridgeReadModel,
  type BridgeResult,
  type CapabilityGrant,
  type CapabilityId,
  type CapabilityRequest,
  type CapabilityRequirement,
  type ClientHello,
  type DipRectangle,
  type HudGeometry,
  type HudReadModel,
  type PrometheeTask,
  type SessionCommand,
  type SessionCommandAcknowledgement,
  type SessionCommandRejection,
  type SnapshotEnvelope,
  type TaskProjectReference,
  type TaskReadModel
} from "./types.ts";
import { findGrant, operationsForCapability } from "./capabilities.ts";

const IDENTIFIER_MAX_LENGTH = 160;
const TITLE_MAX_LENGTH = 512;
const MAX_TASKS = 10_000;
const MAX_COORDINATE_MAGNITUDE = 1_000_000;

const CAPABILITY_IDS: readonly CapabilityId[] = [
  "session.read",
  "session.events",
  "session.pause",
  "session.resume",
  "tasks.read",
  "tasks.events",
  "hud.read",
  "hud.events",
  "hud.geometry"
];

const OPERATIONS: readonly BridgeOperation[] = [
  "session.snapshot",
  "session.subscribe",
  "session.pause",
  "session.resume",
  "tasks.snapshot",
  "tasks.subscribe",
  "hud.snapshot",
  "hud.subscribe"
];

function error(
  code: BridgeError["code"],
  message: string,
  execution: BridgeError["execution"] = "not-sent",
  retryable = false
): BridgeError {
  return { code, message, execution, retryable };
}

function fail<T>(bridgeError: BridgeError): BridgeResult<T> {
  return { ok: false, error: bridgeError };
}

function pass<T>(value: T): BridgeResult<T> {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, maximum = IDENTIFIER_MAX_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE_MAGNITUDE;
}

function isPositiveDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 &&
    value <= MAX_COORDINATE_MAGNITUDE;
}

function isSemanticVersion(value: unknown): value is string {
  return typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      value
    );
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && CAPABILITY_IDS.includes(value as CapabilityId);
}

function isOperation(value: unknown): value is BridgeOperation {
  return typeof value === "string" && OPERATIONS.includes(value as BridgeOperation);
}

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function validateOperationList(
  value: unknown,
  capabilityId: CapabilityId
): value is readonly BridgeOperation[] {
  if (!Array.isArray(value) || value.length > OPERATIONS.length) {
    return false;
  }
  if (!value.every(isOperation) || !unique(value)) {
    return false;
  }
  const allowed = operationsForCapability(capabilityId);
  return value.every((operation) => allowed.includes(operation));
}

export function validateClientHello(value: unknown): BridgeResult<ClientHello> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "clientId",
      "clientVersion",
      "supportedProtocolVersions",
      "requestedCapabilities",
      "nonce"
    ]) ||
    value.clientId !== "promethee-pomodoro" ||
    !isSemanticVersion(value.clientVersion) ||
    !isBoundedString(value.nonce) ||
    !Array.isArray(value.supportedProtocolVersions) ||
    value.supportedProtocolVersions.length === 0 ||
    !value.supportedProtocolVersions.every(isPositiveInteger) ||
    !unique(value.supportedProtocolVersions) ||
    !Array.isArray(value.requestedCapabilities) ||
    value.requestedCapabilities.length === 0 ||
    value.requestedCapabilities.length > CAPABILITY_IDS.length
  ) {
    return fail(error("INVALID_ARGUMENT", "Client hello does not match bridge v1."));
  }

  const requests: CapabilityRequest[] = [];
  for (const raw of value.requestedCapabilities) {
    const operations = isRecord(raw) && Object.hasOwn(raw, "operations")
      ? raw.operations
      : null;
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, ["id", "supportedVersions"], ["operations"]) ||
      !isCapabilityId(raw.id) ||
      !Array.isArray(raw.supportedVersions) ||
      raw.supportedVersions.length === 0 ||
      !raw.supportedVersions.every(isPositiveInteger) ||
      !unique(raw.supportedVersions) ||
      (operations !== null && !validateOperationList(operations, raw.id))
    ) {
      return fail(error("INVALID_ARGUMENT", "A capability request is invalid."));
    }

    requests.push(
      operations !== null && validateOperationList(operations, raw.id)
        ? { id: raw.id, supportedVersions: raw.supportedVersions, operations }
        : { id: raw.id, supportedVersions: raw.supportedVersions }
    );
  }

  if (!unique(requests.map((request) => request.id))) {
    return fail(error("INVALID_ARGUMENT", "Capability requests must be unique."));
  }

  return pass({
    clientId: "promethee-pomodoro",
    clientVersion: value.clientVersion,
    supportedProtocolVersions: value.supportedProtocolVersions,
    requestedCapabilities: requests,
    nonce: value.nonce
  });
}

function validateGrant(value: unknown): CapabilityGrant | null {
  const operations = isRecord(value) && Object.hasOwn(value, "operations")
    ? value.operations
    : null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "version"], ["operations"]) ||
    !isCapabilityId(value.id) ||
    value.version !== BRIDGE_PROTOCOL_VERSION ||
    (operations !== null && !validateOperationList(operations, value.id))
  ) {
    return null;
  }

  return operations !== null && validateOperationList(operations, value.id)
    ? { id: value.id, version: BRIDGE_PROTOCOL_VERSION, operations }
    : { id: value.id, version: BRIDGE_PROTOCOL_VERSION };
}

export function validateBridgeHello(value: unknown): BridgeResult<BridgeHello> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "prometheeVersion",
      "connectionId",
      "nonce",
      "grants"
    ]) ||
    !isPositiveInteger(value.protocolVersion) ||
    !isSemanticVersion(value.prometheeVersion) ||
    !isBoundedString(value.connectionId) ||
    !isBoundedString(value.nonce) ||
    !Array.isArray(value.grants) ||
    value.grants.length > CAPABILITY_IDS.length
  ) {
    return fail(error("INVALID_PAYLOAD", "Bridge hello does not match bridge v1."));
  }

  if (value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return fail(
      error("UNSUPPORTED_PROTOCOL", "Bridge selected an unsupported protocol version.")
    );
  }

  const grants: CapabilityGrant[] = [];
  for (const rawGrant of value.grants) {
    const grant = validateGrant(rawGrant);
    if (grant === null) {
      return fail(error("INVALID_PAYLOAD", "A capability grant is invalid."));
    }
    grants.push(grant);
  }

  if (!unique(grants.map((grant) => grant.id))) {
    return fail(error("INVALID_PAYLOAD", "Capability grants must be unique."));
  }

  return pass({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    prometheeVersion: value.prometheeVersion,
    connectionId: value.connectionId,
    nonce: value.nonce,
    grants
  });
}

export function validateRequiredGrants(
  hello: BridgeHello,
  requirements: readonly CapabilityRequirement[]
): BridgeResult<BridgeHello> {
  for (const requirement of requirements) {
    const grant = findGrant(hello.grants, requirement.id);
    if (grant === null || grant.version !== requirement.version) {
      return fail(
        error("MISSING_CAPABILITY", `Required capability ${requirement.id} is unavailable.`)
      );
    }
    for (const operation of requirement.operations ?? []) {
      if (grant.operations?.includes(operation) !== true) {
        return fail(
          error("OPERATION_DENIED", `Required operation ${operation} was not granted.`)
        );
      }
    }
  }
  return pass(hello);
}

function parseActiveSession(value: unknown): ActiveSession | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "status", "revision", "taskId", "startedAtMs"]) ||
    !isBoundedString(value.id) ||
    (value.status !== "running" && value.status !== "paused") ||
    !isNonNegativeInteger(value.revision) ||
    !(value.taskId === null || isBoundedString(value.taskId)) ||
    !isNonNegativeInteger(value.startedAtMs)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    status: value.status,
    revision: value.revision,
    taskId: value.taskId,
    startedAtMs: value.startedAtMs
  };
}

function parseTask(value: unknown): PrometheeTask | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "title", "status", "project"]) ||
    !isBoundedString(value.id) ||
    !isBoundedString(value.title, TITLE_MAX_LENGTH) ||
    (value.status !== "open" && value.status !== "completed")
  ) {
    return null;
  }

  let project: TaskProjectReference | null = null;
  if (value.project !== null) {
    if (
      !isRecord(value.project) ||
      !hasExactKeys(value.project, ["id", "title"]) ||
      !isBoundedString(value.project.id) ||
      !isBoundedString(value.project.title, TITLE_MAX_LENGTH)
    ) {
      return null;
    }
    project = { id: value.project.id, title: value.project.title };
  }

  return { id: value.id, title: value.title, status: value.status, project };
}

function parseTaskReadModel(value: unknown): TaskReadModel | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["revision", "items"]) ||
    !isNonNegativeInteger(value.revision) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_TASKS
  ) {
    return undefined;
  }
  const items: PrometheeTask[] = [];
  for (const item of value.items) {
    const task = parseTask(item);
    if (task === null) {
      return undefined;
    }
    items.push(task);
  }
  if (!unique(items.map((task) => task.id))) {
    return undefined;
  }
  return { revision: value.revision, items };
}

function parseRectangle(value: unknown): DipRectangle | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["x", "y", "width", "height"]) ||
    !isFiniteCoordinate(value.x) ||
    !isFiniteCoordinate(value.y) ||
    !isPositiveDimension(value.width) ||
    !isPositiveDimension(value.height)
  ) {
    return null;
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function containsRectangle(container: DipRectangle, child: DipRectangle): boolean {
  const epsilon = 0.5;
  return child.x >= container.x - epsilon &&
    child.y >= container.y - epsilon &&
    child.x + child.width <= container.x + container.width + epsilon &&
    child.y + child.height <= container.y + container.height + epsilon;
}

function parseHudGeometry(value: unknown): HudGeometry | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "coordinateSpace",
      "timerBounds",
      "workArea",
      "displayId",
      "scaleFactor",
      "layoutRevision",
      "measuredAtMs"
    ]) ||
    value.coordinateSpace !== "electron-dip" ||
    !isBoundedString(value.displayId) ||
    typeof value.scaleFactor !== "number" ||
    !Number.isFinite(value.scaleFactor) ||
    value.scaleFactor < 0.25 ||
    value.scaleFactor > 16 ||
    !isNonNegativeInteger(value.layoutRevision) ||
    !isNonNegativeInteger(value.measuredAtMs)
  ) {
    return undefined;
  }
  const timerBounds = parseRectangle(value.timerBounds);
  const workArea = parseRectangle(value.workArea);
  if (
    timerBounds === null ||
    workArea === null ||
    !containsRectangle(workArea, timerBounds)
  ) {
    return undefined;
  }
  return {
    coordinateSpace: "electron-dip",
    timerBounds,
    workArea,
    displayId: value.displayId,
    scaleFactor: value.scaleFactor,
    layoutRevision: value.layoutRevision,
    measuredAtMs: value.measuredAtMs
  };
}

function parseHudReadModel(value: unknown): HudReadModel | null | undefined {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["revision", "visible", "mode", "placement", "geometry"]) ||
    !isNonNegativeInteger(value.revision) ||
    typeof value.visible !== "boolean" ||
    (value.mode !== "idle" && value.mode !== "running" && value.mode !== "paused") ||
    !isBoundedString(value.placement)
  ) {
    return undefined;
  }
  const geometry = parseHudGeometry(value.geometry);
  if (geometry === undefined) {
    return undefined;
  }
  return {
    revision: value.revision,
    visible: value.visible,
    mode: value.mode,
    placement: value.placement,
    geometry
  };
}

function validateSnapshotEnvelope<T>(
  value: unknown,
  parseValue: (candidate: unknown) => T | undefined
): BridgeResult<SnapshotEnvelope<T>> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["connectionId", "atSequence", "value"]) ||
    !isBoundedString(value.connectionId) ||
    !isNonNegativeInteger(value.atSequence)
  ) {
    return fail(error("INVALID_PAYLOAD", "Snapshot envelope is invalid."));
  }
  const parsed = parseValue(value.value);
  if (parsed === undefined) {
    return fail(error("INVALID_PAYLOAD", "Snapshot value is invalid."));
  }
  return pass({ connectionId: value.connectionId, atSequence: value.atSequence, value: parsed });
}

export function validateBridgeSnapshot(
  value: unknown
): BridgeResult<SnapshotEnvelope<BridgeReadModel>> {
  return validateSnapshotEnvelope(value, (candidate) => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["session", "tasks", "hud"])) {
      return undefined;
    }
    const session = parseActiveSession(candidate.session);
    const tasks = parseTaskReadModel(candidate.tasks);
    const hud = parseHudReadModel(candidate.hud);
    if (session === undefined || tasks === undefined || hud === undefined) {
      return undefined;
    }
    return { session, tasks, hud };
  });
}

export function validateSessionSnapshot(
  value: unknown
): BridgeResult<SnapshotEnvelope<ActiveSession | null>> {
  return validateSnapshotEnvelope(value, parseActiveSession);
}

export function validateBridgeEvent(value: unknown): BridgeResult<BridgeEvent> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "connectionId",
      "sequence",
      "occurredAtMs",
      "type",
      "payload"
    ]) ||
    value.schemaVersion !== BRIDGE_SCHEMA_VERSION ||
    !isBoundedString(value.connectionId) ||
    !isPositiveInteger(value.sequence) ||
    !isNonNegativeInteger(value.occurredAtMs) ||
    !isRecord(value.payload)
  ) {
    return fail(error("INVALID_PAYLOAD", "Bridge event envelope is invalid."));
  }

  const base = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    connectionId: value.connectionId,
    sequence: value.sequence,
    occurredAtMs: value.occurredAtMs
  };

  switch (value.type) {
    case "session.changed": {
      if (!hasExactKeys(value.payload, ["session"])) {
        break;
      }
      const session = parseActiveSession(value.payload.session);
      if (session !== undefined) {
        return pass({ ...base, type: "session.changed", payload: { session } });
      }
      break;
    }
    case "session.terminal":
      if (
        hasExactKeys(value.payload, ["sessionId", "reason"]) &&
        isBoundedString(value.payload.sessionId) &&
        (value.payload.reason === "stopped" ||
          value.payload.reason === "completed" ||
          value.payload.reason === "removed")
      ) {
        return pass({
          ...base,
          type: "session.terminal",
          payload: { sessionId: value.payload.sessionId, reason: value.payload.reason }
        });
      }
      break;
    case "tasks.refresh-required":
      if (hasExactKeys(value.payload, ["reason"]) && value.payload.reason === "changed") {
        return pass({
          ...base,
          type: "tasks.refresh-required",
          payload: { reason: "changed" }
        });
      }
      break;
    case "hud.changed": {
      if (!hasExactKeys(value.payload, ["hud"])) {
        break;
      }
      const hud = parseHudReadModel(value.payload.hud);
      if (hud !== null && hud !== undefined) {
        return pass({ ...base, type: "hud.changed", payload: { hud } });
      }
      break;
    }
    case "bridge.closing":
      if (
        hasExactKeys(value.payload, ["reason"]) &&
        (value.payload.reason === "shutdown" ||
          value.payload.reason === "revoked" ||
          value.payload.reason === "reload")
      ) {
        return pass({
          ...base,
          type: "bridge.closing",
          payload: { reason: value.payload.reason }
        });
      }
      break;
  }

  return fail(error("INVALID_PAYLOAD", "Bridge event payload is invalid."));
}

export function validateSessionCommand(value: unknown): BridgeResult<SessionCommand> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["commandId", "connectionId", "sessionId", "expectedRevision"]) ||
    !isBoundedString(value.commandId) ||
    !isBoundedString(value.connectionId) ||
    !isBoundedString(value.sessionId) ||
    !isNonNegativeInteger(value.expectedRevision)
  ) {
    return fail(error("INVALID_ARGUMENT", "Session command is invalid."));
  }
  return pass({
    commandId: value.commandId,
    connectionId: value.connectionId,
    sessionId: value.sessionId,
    expectedRevision: value.expectedRevision
  });
}

export function validateSessionAcknowledgement(
  value: unknown
): BridgeResult<SessionCommandAcknowledgement> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "commandId",
      "connectionId",
      "outcome",
      "authoritative",
      "rejection"
    ]) ||
    !isBoundedString(value.commandId) ||
    !isBoundedString(value.connectionId) ||
    (value.outcome !== "applied" &&
      value.outcome !== "already-satisfied" &&
      value.outcome !== "rejected")
  ) {
    return fail(error("INVALID_PAYLOAD", "Session acknowledgement is invalid."));
  }

  const authoritative = validateSessionSnapshot(value.authoritative);
  if (!authoritative.ok) {
    return authoritative;
  }

  let rejection: SessionCommandRejection | null = null;
  if (value.rejection !== null) {
    if (
      !isRecord(value.rejection) ||
      !hasExactKeys(value.rejection, ["code", "message"]) ||
      (value.rejection.code !== "NO_ACTIVE_SESSION" &&
        value.rejection.code !== "CONFLICT" &&
        value.rejection.code !== "REJECTED_STATE") ||
      !isBoundedString(value.rejection.message, TITLE_MAX_LENGTH)
    ) {
      return fail(error("INVALID_PAYLOAD", "Session rejection payload is invalid."));
    }
    rejection = { code: value.rejection.code, message: value.rejection.message };
  }

  if ((value.outcome === "rejected") !== (rejection !== null)) {
    return fail(error("INVALID_PAYLOAD", "Acknowledgement outcome and rejection disagree."));
  }

  return pass({
    commandId: value.commandId,
    connectionId: value.connectionId,
    outcome: value.outcome,
    authoritative: authoritative.value,
    rejection
  });
}

export function selectUsableHudGeometry(
  hud: HudReadModel | null,
  nowMs: number,
  maximumAgeMs: number
): HudGeometry | null {
  if (
    hud === null ||
    !hud.visible ||
    hud.geometry === null ||
    !isNonNegativeInteger(nowMs) ||
    !isNonNegativeInteger(maximumAgeMs)
  ) {
    return null;
  }
  const age = nowMs - hud.geometry.measuredAtMs;
  if (age < 0 || age > maximumAgeMs) {
    return null;
  }
  return hud.geometry;
}
