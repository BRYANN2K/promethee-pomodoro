import {
  DEFAULT_COMPATIBILITY_POLICY,
  grantAllows
} from "./capabilities.ts";
import {
  validateBridgeEvent,
  validateBridgeHello,
  validateBridgeSnapshot,
  validateClientHello,
  validateRequiredGrants,
  validateSessionAcknowledgement,
  validateSessionCommand
} from "./validation.ts";
import type {
  AdapterSignalSink,
  AdapterTimeoutOptions,
  AdapterTimeoutScheduler,
  BridgeError,
  BridgeEvent,
  BridgeHello,
  BridgeOperation,
  BridgeReadModel,
  BridgeResult,
  CapabilityId,
  CapabilityRequirement,
  ClientHello,
  CompatibilityPolicy,
  ConnectionBootstrap,
  PrometheeAdapterV1Api,
  RawPrometheeBridgePortV1,
  ReconciliationSnapshot,
  SessionCommand,
  SessionCommandAcknowledgement,
  SnapshotEnvelope,
  TaskRefreshSnapshot
} from "./types.ts";

interface CachedCommand {
  readonly operation: "pause" | "resume";
  readonly acknowledgement: SessionCommandAcknowledgement;
}

interface CommandIntent {
  readonly operation: "pause" | "resume";
  readonly command: SessionCommand;
}

interface InFlightCommand extends CommandIntent {
  readonly result: Promise<BridgeResult<SessionCommandAcknowledgement>>;
}

const NOOP_SINK: AdapterSignalSink = () => undefined;

function runtimeScheduler(): AdapterTimeoutScheduler {
  const runtime = globalThis as unknown as {
    setTimeout?: (callback: () => void, delayMs: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  return {
    schedule(callback, delayMs) {
      if (typeof runtime.setTimeout !== "function") {
        throw new Error("No runtime timeout scheduler is available.");
      }
      return runtime.setTimeout(callback, delayMs);
    },
    cancel(handle) {
      if (typeof runtime.clearTimeout === "function") {
        runtime.clearTimeout(handle);
      }
    }
  };
}

export const DEFAULT_ADAPTER_TIMEOUTS: AdapterTimeoutOptions = Object.freeze({
  negotiationTimeoutMs: 5_000,
  snapshotTimeoutMs: 5_000,
  commandTimeoutMs: 5_000,
  scheduler: runtimeScheduler()
});

export class BridgePortFailure extends Error {
  readonly execution: BridgeError["execution"];

  constructor(message: string, execution: BridgeError["execution"]) {
    super(message);
    this.name = "BridgePortFailure";
    this.execution = execution;
  }
}

function bridgeError(
  code: BridgeError["code"],
  message: string,
  execution: BridgeError["execution"] = "not-sent",
  retryable = false
): BridgeError {
  return { code, message, execution, retryable };
}

function failure<T>(error: BridgeError): BridgeResult<T> {
  return { ok: false, error };
}

function success<T>(value: T): BridgeResult<T> {
  return { ok: true, value };
}

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 60_000;
}

function sameCommand(left: SessionCommand, right: SessionCommand): boolean {
  return left.commandId === right.commandId &&
    left.connectionId === right.connectionId &&
    left.sessionId === right.sessionId &&
    left.expectedRevision === right.expectedRevision;
}

function eventAuthorization(event: BridgeEvent): {
  readonly capability: CapabilityId;
  readonly operation: BridgeOperation | null;
} {
  switch (event.type) {
    case "session.changed":
    case "session.terminal":
      return { capability: "session.events", operation: "session.subscribe" };
    case "tasks.refresh-required":
      return { capability: "tasks.events", operation: "tasks.subscribe" };
    case "hud.changed":
      return { capability: "hud.events", operation: "hud.subscribe" };
    case "bridge.closing":
      return { capability: "session.events", operation: null };
  }
}

export class PrometheeAdapterV1 implements PrometheeAdapterV1Api {
  private readonly port: RawPrometheeBridgePortV1;
  private readonly policy: CompatibilityPolicy;
  private readonly timeouts: AdapterTimeoutOptions;
  private hello: BridgeHello | null = null;
  private sink: AdapterSignalSink = NOOP_SINK;
  private unsubscribe: (() => void) | null = null;
  private bufferedEvents: unknown[] = [];
  private bootstrapping = false;
  private reconciliationRequired = false;
  private lastSequence = 0;
  private generation = 0;
  private readonly commandCache = new Map<string, CachedCommand>();
  private readonly commandIntents = new Map<string, CommandIntent>();
  private readonly inFlightCommands = new Map<string, InFlightCommand>();

  constructor(
    port: RawPrometheeBridgePortV1,
    policy: CompatibilityPolicy = DEFAULT_COMPATIBILITY_POLICY,
    timeouts: AdapterTimeoutOptions = DEFAULT_ADAPTER_TIMEOUTS
  ) {
    this.port = port;
    this.policy = policy;
    this.timeouts = validTimeout(timeouts.negotiationTimeoutMs) &&
      validTimeout(timeouts.snapshotTimeoutMs) &&
      validTimeout(timeouts.commandTimeoutMs)
      ? timeouts
      : DEFAULT_ADAPTER_TIMEOUTS;
  }

  get connectionId(): string | null {
    return this.hello?.connectionId ?? null;
  }

  get grants(): BridgeHello["grants"] {
    return this.hello?.grants ?? [];
  }

  async connect(
    candidateHello: ClientHello,
    requirements: readonly CapabilityRequirement[],
    sink: AdapterSignalSink = NOOP_SINK
  ): Promise<BridgeResult<ConnectionBootstrap>> {
    this.disconnect();
    const generation = this.generation;
    const request = validateClientHello(candidateHello);
    if (!request.ok) {
      return request;
    }

    let rawHello: unknown;
    try {
      rawHello = await this.withTimeout(
        this.port.negotiate(request.value),
        this.timeouts.negotiationTimeoutMs,
        "not-sent",
        "Bridge negotiation timed out."
      );
    } catch {
      if (generation !== this.generation) {
        return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during negotiation."));
      }
      return failure(
        bridgeError("TRANSPORT_ERROR", "Bridge negotiation failed before connection.", "not-sent", true)
      );
    }
    if (generation !== this.generation) {
      return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during negotiation."));
    }

    const parsedHello = validateBridgeHello(rawHello);
    if (!parsedHello.ok) {
      return parsedHello;
    }
    const compatible = this.validateCompatibility(request.value, parsedHello.value);
    if (!compatible.ok) {
      return compatible;
    }
    const required = validateRequiredGrants(parsedHello.value, requirements);
    if (!required.ok) {
      return required;
    }

    this.hello = parsedHello.value;
    this.sink = sink;
    this.bootstrapping = true;
    this.reconciliationRequired = false;
    this.lastSequence = 0;
    this.bufferedEvents = [];

    try {
      this.unsubscribe = this.port.subscribe(parsedHello.value.connectionId, (event) => {
        this.acceptRawEvent(event);
      });
    } catch {
      this.disconnect();
      return failure(
        bridgeError("TRANSPORT_ERROR", "Bridge subscription could not be established.", "not-sent", true)
      );
    }

    let rawSnapshot: unknown;
    try {
      rawSnapshot = await this.withTimeout(
        this.port.readSnapshot(parsedHello.value.connectionId),
        this.timeouts.snapshotTimeoutMs,
        "not-sent",
        "Initial bridge snapshot timed out."
      );
    } catch {
      if (generation !== this.generation) {
        return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during bootstrap."));
      }
      this.disconnect();
      return failure(
        bridgeError("TRANSPORT_ERROR", "Initial bridge snapshot could not be read.", "not-sent", true)
      );
    }
    if (generation !== this.generation) {
      return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during bootstrap."));
    }

    const snapshot = this.validateAuthorizedSnapshot(rawSnapshot);
    if (!snapshot.ok) {
      this.disconnect();
      return snapshot;
    }
    if (snapshot.value.connectionId !== parsedHello.value.connectionId) {
      this.disconnect();
      return failure(
        bridgeError("CONNECTION_CHANGED", "Initial snapshot belongs to another connection.")
      );
    }

    const replay = this.consumeBufferedEvents(snapshot.value.atSequence);
    if (!replay.ok) {
      this.disconnect();
      return replay;
    }
    this.lastSequence = replay.value.atSequence;
    this.bootstrapping = false;
    return success({
      hello: parsedHello.value,
      snapshot: snapshot.value,
      replayEvents: replay.value.events
    });
  }

  async pause(
    command: SessionCommand
  ): Promise<BridgeResult<SessionCommandAcknowledgement>> {
    return this.executeCommand("pause", "session.pause", "session.pause", command);
  }

  async resume(
    command: SessionCommand
  ): Promise<BridgeResult<SessionCommandAcknowledgement>> {
    return this.executeCommand("resume", "session.resume", "session.resume", command);
  }

  async refreshReadModel(): Promise<BridgeResult<TaskRefreshSnapshot>> {
    const hello = this.hello;
    const generation = this.generation;
    const sequenceAtStart = this.lastSequence;
    if (hello === null) {
      return failure(bridgeError("NOT_CONNECTED", "Bridge is not connected."));
    }

    let rawSnapshot: unknown;
    try {
      rawSnapshot = await this.withTimeout(
        this.port.readSnapshot(hello.connectionId),
        this.timeouts.snapshotTimeoutMs,
        "not-sent",
        "Read-model snapshot timed out."
      );
    } catch {
      if (generation !== this.generation) {
        return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during refresh."));
      }
      return failure(
        bridgeError("TRANSPORT_ERROR", "Read-model snapshot could not be read.", "not-sent", true)
      );
    }
    if (generation !== this.generation || this.hello?.connectionId !== hello.connectionId) {
      return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during refresh."));
    }

    const snapshot = this.validateAuthorizedSnapshot(rawSnapshot);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (snapshot.value.connectionId !== hello.connectionId) {
      return failure(
        bridgeError("CONNECTION_CHANGED", "Read-model snapshot belongs to another connection.")
      );
    }
    if (snapshot.value.atSequence < sequenceAtStart) {
      return failure(
        bridgeError("SEQUENCE_GAP", "Read-model snapshot cursor moved backwards.", "not-sent", true)
      );
    }
    return success({
      connectionId: snapshot.value.connectionId,
      atSequence: snapshot.value.atSequence,
      value: snapshot.value.value.tasks
    });
  }

  async reconcile(): Promise<BridgeResult<ReconciliationSnapshot>> {
    const hello = this.hello;
    const generation = this.generation;
    if (hello === null) {
      return failure(bridgeError("NOT_CONNECTED", "Bridge is not connected."));
    }

    this.bootstrapping = true;
    let rawSnapshot: unknown;
    try {
      rawSnapshot = await this.withTimeout(
        this.port.readSnapshot(hello.connectionId),
        this.timeouts.snapshotTimeoutMs,
        "not-sent",
        "Authoritative snapshot timed out."
      );
    } catch {
      if (generation !== this.generation) {
        return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during reconciliation."));
      }
      this.bootstrapping = false;
      this.reconciliationRequired = true;
      return failure(
        bridgeError("TRANSPORT_ERROR", "Authoritative snapshot could not be read.", "not-sent", true)
      );
    }
    if (generation !== this.generation || this.hello?.connectionId !== hello.connectionId) {
      return failure(bridgeError("CONNECTION_CHANGED", "Connection changed during reconciliation."));
    }

    const snapshot = this.validateAuthorizedSnapshot(rawSnapshot);
    if (!snapshot.ok) {
      this.bootstrapping = false;
      this.reconciliationRequired = true;
      return snapshot;
    }
    if (snapshot.value.connectionId !== hello.connectionId) {
      this.bootstrapping = false;
      this.reconciliationRequired = true;
      return failure(
        bridgeError("CONNECTION_CHANGED", "Reconciliation snapshot belongs to another connection.")
      );
    }
    if (snapshot.value.atSequence < this.lastSequence) {
      this.bootstrapping = false;
      this.reconciliationRequired = true;
      return failure(
        bridgeError("SEQUENCE_GAP", "Reconciliation snapshot cursor moved backwards.", "not-sent", true)
      );
    }

    const replay = this.consumeBufferedEvents(snapshot.value.atSequence);
    if (!replay.ok) {
      this.bootstrapping = false;
      this.reconciliationRequired = true;
      return replay;
    }
    this.lastSequence = replay.value.atSequence;
    this.reconciliationRequired = false;
    this.bootstrapping = false;
    return success({ snapshot: snapshot.value, replayEvents: replay.value.events });
  }

  disconnect(): void {
    this.clearAuthority();
  }

  private clearAuthority(): AdapterSignalSink {
    const previousSink = this.sink;
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.hello = null;
    this.bufferedEvents = [];
    this.bootstrapping = false;
    this.reconciliationRequired = false;
    this.lastSequence = 0;
    this.commandCache.clear();
    this.commandIntents.clear();
    this.inFlightCommands.clear();
    this.sink = NOOP_SINK;
    return previousSink;
  }

  private validateCompatibility(
    request: ClientHello,
    hello: BridgeHello
  ): BridgeResult<BridgeHello> {
    if (
      !request.supportedProtocolVersions.includes(hello.protocolVersion) ||
      !this.policy.supportedProtocolVersions.includes(hello.protocolVersion)
    ) {
      return failure(
        bridgeError("UNSUPPORTED_PROTOCOL", "Bridge selected an unsupported protocol version.")
      );
    }
    if (!this.policy.allowedPrometheeVersions.includes(hello.prometheeVersion)) {
      return failure(
        bridgeError(
          "UNSUPPORTED_PROMETHEE_VERSION",
          "Promethee version has not been allowlisted by a compatibility fixture."
        )
      );
    }
    if (hello.nonce !== request.nonce) {
      return failure(
        bridgeError("INVALID_PAYLOAD", "Bridge hello did not echo the connection nonce.")
      );
    }

    for (const grant of hello.grants) {
      const requested = request.requestedCapabilities.find((item) => item.id === grant.id);
      if (
        requested === undefined ||
        !requested.supportedVersions.includes(grant.version) ||
        (grant.operations ?? []).some(
          (operation) => requested.operations?.includes(operation) !== true
        )
      ) {
        return failure(
          bridgeError("INVALID_PAYLOAD", "Bridge granted an unrequested capability or operation.")
        );
      }
    }
    return success(hello);
  }

  private validateAuthorizedSnapshot(
    rawSnapshot: unknown
  ): BridgeResult<SnapshotEnvelope<BridgeReadModel>> {
    const snapshot = validateBridgeSnapshot(rawSnapshot);
    if (!snapshot.ok) {
      return snapshot;
    }
    if (!grantAllows(this.grants, "session.read", "session.snapshot")) {
      return failure(bridgeError("OPERATION_DENIED", "Session snapshot was not granted."));
    }
    if (
      snapshot.value.value.tasks !== null &&
      !grantAllows(this.grants, "tasks.read", "tasks.snapshot")
    ) {
      return failure(bridgeError("OPERATION_DENIED", "Task snapshot was not granted."));
    }
    if (
      snapshot.value.value.hud !== null &&
      !grantAllows(this.grants, "hud.read", "hud.snapshot")
    ) {
      return failure(bridgeError("OPERATION_DENIED", "HUD snapshot was not granted."));
    }
    if (
      snapshot.value.value.hud?.geometry !== null &&
      snapshot.value.value.hud?.geometry !== undefined &&
      this.grants.some((grant) => grant.id === "hud.geometry") === false
    ) {
      return failure(bridgeError("OPERATION_DENIED", "HUD geometry was not granted."));
    }
    return snapshot;
  }

  private acceptRawEvent(rawEvent: unknown): void {
    if (this.bootstrapping || this.reconciliationRequired) {
      const closing = this.validateAuthorizedEvent(rawEvent);
      if (closing.ok && closing.value.type === "bridge.closing") {
        if (closing.value.connectionId !== this.connectionId) {
          this.sink({ type: "event-dropped", reason: "stale-connection" });
          return;
        }
        const sink = this.clearAuthority();
        sink({ type: "event", event: closing.value });
        return;
      }
      this.bufferedEvents.push(rawEvent);
      if (this.reconciliationRequired) {
        this.sink({ type: "event-dropped", reason: "awaiting-reconciliation" });
      }
      return;
    }
    const event = this.validateAuthorizedEvent(rawEvent);
    if (!event.ok) {
      this.reconciliationRequired = true;
      this.sink({ type: "protocol-fault", error: event.error });
      return;
    }
    this.applyLiveEvent(event.value);
  }

  private validateAuthorizedEvent(rawEvent: unknown): BridgeResult<BridgeEvent> {
    const event = validateBridgeEvent(rawEvent);
    if (!event.ok) {
      return event;
    }
    const authorization = eventAuthorization(event.value);
    const grant = this.grants.find((candidate) => candidate.id === authorization.capability);
    if (
      grant === undefined ||
      (authorization.operation !== null &&
        grant.operations?.includes(authorization.operation) !== true)
    ) {
      return failure(
        bridgeError("OPERATION_DENIED", "Event arrived for an ungranted subscription.")
      );
    }
    if (
      event.value.type === "hud.changed" &&
      event.value.payload.hud.geometry !== null &&
      this.grants.some((candidate) => candidate.id === "hud.geometry") === false
    ) {
      return failure(bridgeError("OPERATION_DENIED", "HUD geometry event was not granted."));
    }
    return event;
  }

  private applyLiveEvent(event: BridgeEvent): void {
    if (event.connectionId !== this.connectionId) {
      this.sink({ type: "event-dropped", reason: "stale-connection" });
      return;
    }
    if (event.sequence <= this.lastSequence) {
      this.sink({ type: "event-dropped", reason: "duplicate" });
      return;
    }
    const expectedSequence = this.lastSequence + 1;
    if (event.sequence !== expectedSequence) {
      this.reconciliationRequired = true;
      this.bufferedEvents.push(event);
      this.sink({
        type: "sequence-gap",
        connectionId: event.connectionId,
        expectedSequence,
        receivedSequence: event.sequence
      });
      return;
    }

    this.lastSequence = event.sequence;
    if (event.type === "bridge.closing") {
      const sink = this.clearAuthority();
      sink({ type: "event", event });
      return;
    }
    this.sink({ type: "event", event });
  }

  private consumeBufferedEvents(
    atSequence: number
  ): BridgeResult<{ readonly atSequence: number; readonly events: readonly BridgeEvent[] }> {
    const rawEvents = this.bufferedEvents;
    this.bufferedEvents = [];
    const parsed: BridgeEvent[] = [];

    for (const rawEvent of rawEvents) {
      const event = this.validateAuthorizedEvent(rawEvent);
      if (!event.ok) {
        this.reconciliationRequired = true;
        this.sink({ type: "protocol-fault", error: event.error });
        return failure(event.error);
      }
      if (event.value.connectionId !== this.connectionId) {
        this.sink({ type: "event-dropped", reason: "stale-connection" });
        continue;
      }
      if (event.value.type === "bridge.closing") {
        const sink = this.clearAuthority();
        sink({ type: "event", event: event.value });
        return failure(
          bridgeError("CONNECTION_CHANGED", "Bridge closed while state was being synchronized.")
        );
      }
      if (event.value.sequence <= atSequence) {
        this.sink({ type: "event-dropped", reason: "duplicate" });
        continue;
      }
      parsed.push(event.value);
    }

    parsed.sort((left, right) => left.sequence - right.sequence);
    const replay: BridgeEvent[] = [];
    let cursor = atSequence;
    for (const event of parsed) {
      if (event.sequence <= cursor) {
        this.sink({ type: "event-dropped", reason: "duplicate" });
        continue;
      }
      if (event.sequence !== cursor + 1) {
        this.reconciliationRequired = true;
        this.bufferedEvents.push(event);
        this.sink({
          type: "sequence-gap",
          connectionId: event.connectionId,
          expectedSequence: cursor + 1,
          receivedSequence: event.sequence
        });
        return failure(
          bridgeError("SEQUENCE_GAP", "Buffered bridge events contain a sequence gap.", "not-sent", true)
        );
      }
      cursor = event.sequence;
      replay.push(event);
    }
    return success({ atSequence: cursor, events: replay });
  }

  private async executeCommand(
    operation: "pause" | "resume",
    requiredCapability: Extract<CapabilityId, "session.pause" | "session.resume">,
    requiredOperation: Extract<BridgeOperation, "session.pause" | "session.resume">,
    commandCandidate: SessionCommand
  ): Promise<BridgeResult<SessionCommandAcknowledgement>> {
    const command = validateSessionCommand(commandCandidate);
    if (!command.ok) {
      return command;
    }
    const hello = this.hello;
    const generation = this.generation;
    if (hello === null) {
      return failure(bridgeError("NOT_CONNECTED", "Bridge is not connected."));
    }
    if (command.value.connectionId !== hello.connectionId) {
      return failure(bridgeError("CONNECTION_CHANGED", "Command belongs to another connection."));
    }
    if (this.reconciliationRequired || this.bootstrapping) {
      return failure(
        bridgeError("SEQUENCE_GAP", "Mutations are suspended until reconciliation.", "not-sent", true)
      );
    }
    if (!grantAllows(hello.grants, requiredCapability, requiredOperation)) {
      return failure(bridgeError("OPERATION_DENIED", "Session operation was not granted."));
    }

    const cacheKey = `${hello.connectionId}\u0000${command.value.commandId}`;
    const cached = this.commandCache.get(cacheKey);
    if (cached !== undefined) {
      return cached.operation === operation
        ? success(cached.acknowledgement)
        : failure(
            bridgeError("INVALID_ARGUMENT", "Command identifier was reused for another operation.")
          );
    }
    const existingIntent = this.commandIntents.get(cacheKey);
    if (
      existingIntent !== undefined &&
      (existingIntent.operation !== operation || !sameCommand(existingIntent.command, command.value))
    ) {
      return failure(
        bridgeError("INVALID_ARGUMENT", "Command identifier was reused with another payload.")
      );
    }
    const existingInFlight = this.inFlightCommands.get(cacheKey);
    if (existingInFlight !== undefined) {
      return existingInFlight.result;
    }
    this.commandIntents.set(cacheKey, { operation, command: command.value });

    const result = this.performCommand(
      operation,
      command.value,
      hello,
      generation,
      cacheKey
    );
    this.inFlightCommands.set(cacheKey, {
      operation,
      command: command.value,
      result
    });
    try {
      return await result;
    } finally {
      if (this.inFlightCommands.get(cacheKey)?.result === result) {
        this.inFlightCommands.delete(cacheKey);
      }
    }
  }

  private async performCommand(
    operation: "pause" | "resume",
    command: SessionCommand,
    hello: BridgeHello,
    generation: number,
    cacheKey: string
  ): Promise<BridgeResult<SessionCommandAcknowledgement>> {
    let rawAcknowledgement: unknown;
    try {
      const operationPromise = operation === "pause"
        ? this.port.pause(command)
        : this.port.resume(command);
      rawAcknowledgement = await this.withTimeout(
        operationPromise,
        this.timeouts.commandTimeoutMs,
        "indeterminate",
        "Session command acknowledgement timed out."
      );
    } catch (caught) {
      if (generation !== this.generation || this.hello?.connectionId !== hello.connectionId) {
        return failure(
          bridgeError(
            "CONNECTION_CHANGED",
            "Connection changed while the session command was in flight.",
            "indeterminate",
            true
          )
        );
      }
      const execution = caught instanceof BridgePortFailure
        ? caught.execution
        : "indeterminate";
      if (execution === "indeterminate") {
        this.reconciliationRequired = true;
      }
      return failure(
        bridgeError("TRANSPORT_ERROR", "Session command outcome is unavailable.", execution, true)
      );
    }
    if (generation !== this.generation || this.hello?.connectionId !== hello.connectionId) {
      return failure(
        bridgeError(
          "CONNECTION_CHANGED",
          "Connection changed while the session command was in flight.",
          "indeterminate",
          true
        )
      );
    }

    const acknowledgement = validateSessionAcknowledgement(rawAcknowledgement);
    if (!acknowledgement.ok) {
      this.reconciliationRequired = true;
      return failure({ ...acknowledgement.error, execution: "indeterminate", retryable: true });
    }
    if (
      acknowledgement.value.commandId !== command.commandId ||
      acknowledgement.value.connectionId !== hello.connectionId ||
      acknowledgement.value.authoritative.connectionId !== hello.connectionId
    ) {
      this.reconciliationRequired = true;
      return failure(
        bridgeError(
          "CONNECTION_CHANGED",
          "Session acknowledgement correlation failed.",
          "indeterminate",
          true
        )
      );
    }

    const authoritative = acknowledgement.value.authoritative.value;
    if (
      authoritative !== null &&
      authoritative.revision < command.expectedRevision
    ) {
      this.reconciliationRequired = true;
      return failure(
        bridgeError(
          "INVALID_PAYLOAD",
          "Session acknowledgement revision predates the command precondition.",
          "indeterminate",
          true
        )
      );
    }

    this.commandCache.set(cacheKey, { operation, acknowledgement: acknowledgement.value });
    return acknowledgement;
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    execution: BridgeError["execution"],
    message: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let handle: unknown;
      try {
        handle = this.timeouts.scheduler.schedule(() => {
          if (settled) {
            return;
          }
          settled = true;
          reject(new BridgePortFailure(message, execution));
        }, timeoutMs);
      } catch {
        reject(new BridgePortFailure("Timeout scheduler is unavailable.", execution));
        return;
      }

      void promise.then(
        (value) => {
          if (settled) {
            return;
          }
          settled = true;
          this.timeouts.scheduler.cancel(handle);
          resolve(value);
        },
        (reason) => {
          if (settled) {
            return;
          }
          settled = true;
          this.timeouts.scheduler.cancel(handle);
          reject(reason);
        }
      );
    });
  }
}
