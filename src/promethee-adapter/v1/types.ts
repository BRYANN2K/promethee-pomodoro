export const BRIDGE_PROTOCOL_VERSION = 1 as const;
export const BRIDGE_SCHEMA_VERSION = 1 as const;

export type CapabilityId =
  | "session.read"
  | "session.events"
  | "session.pause"
  | "session.resume"
  | "tasks.read"
  | "tasks.events"
  | "hud.read"
  | "hud.events"
  | "hud.geometry";

export type BridgeOperation =
  | "session.snapshot"
  | "session.subscribe"
  | "session.pause"
  | "session.resume"
  | "tasks.snapshot"
  | "tasks.subscribe"
  | "hud.snapshot"
  | "hud.subscribe";

export interface CapabilityRequest {
  readonly id: CapabilityId;
  readonly supportedVersions: readonly number[];
  readonly operations?: readonly BridgeOperation[];
}

export interface CapabilityGrant {
  readonly id: CapabilityId;
  readonly version: typeof BRIDGE_PROTOCOL_VERSION;
  readonly operations?: readonly BridgeOperation[];
}

export interface CapabilityRequirement {
  readonly id: CapabilityId;
  readonly version: typeof BRIDGE_PROTOCOL_VERSION;
  readonly operations?: readonly BridgeOperation[];
}

export interface ClientHello {
  readonly clientId: "promethee-pomodoro";
  readonly clientVersion: string;
  readonly supportedProtocolVersions: readonly number[];
  readonly requestedCapabilities: readonly CapabilityRequest[];
  readonly nonce: string;
}

export interface BridgeHello {
  readonly protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  readonly prometheeVersion: string;
  readonly connectionId: string;
  readonly nonce: string;
  readonly grants: readonly CapabilityGrant[];
}

export interface ActiveSession {
  readonly id: string;
  readonly status: "running" | "paused";
  readonly revision: number;
  readonly taskId: string | null;
  readonly startedAtMs: number;
}

export interface TaskProjectReference {
  readonly id: string;
  readonly title: string;
}

export interface PrometheeTask {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "completed";
  readonly project: TaskProjectReference | null;
}

export interface TaskReadModel {
  readonly revision: number;
  readonly items: readonly PrometheeTask[];
}

export interface DipRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HudGeometry {
  readonly coordinateSpace: "electron-dip";
  readonly timerBounds: DipRectangle;
  readonly workArea: DipRectangle;
  readonly displayId: string;
  readonly scaleFactor: number;
  readonly layoutRevision: number;
  readonly measuredAtMs: number;
}

export interface HudReadModel {
  readonly revision: number;
  readonly visible: boolean;
  readonly mode: "idle" | "running" | "paused";
  readonly placement: string;
  readonly geometry: HudGeometry | null;
}

export interface BridgeReadModel {
  readonly session: ActiveSession | null;
  readonly tasks: TaskReadModel | null;
  readonly hud: HudReadModel | null;
}

export interface SnapshotEnvelope<T> {
  readonly connectionId: string;
  readonly atSequence: number;
  readonly value: T;
}

interface BridgeEventBase {
  readonly schemaVersion: typeof BRIDGE_SCHEMA_VERSION;
  readonly connectionId: string;
  readonly sequence: number;
  readonly occurredAtMs: number;
}

export interface SessionChangedEvent extends BridgeEventBase {
  readonly type: "session.changed";
  readonly payload: {
    readonly session: ActiveSession | null;
  };
}

export interface SessionTerminalEvent extends BridgeEventBase {
  readonly type: "session.terminal";
  readonly payload: {
    readonly sessionId: string;
    readonly reason: "stopped" | "completed" | "removed";
  };
}

export interface TasksRefreshRequiredEvent extends BridgeEventBase {
  readonly type: "tasks.refresh-required";
  readonly payload: {
    readonly reason: "changed";
  };
}

export interface HudChangedEvent extends BridgeEventBase {
  readonly type: "hud.changed";
  readonly payload: {
    readonly hud: HudReadModel;
  };
}

export interface BridgeClosingEvent extends BridgeEventBase {
  readonly type: "bridge.closing";
  readonly payload: {
    readonly reason: "shutdown" | "revoked" | "reload";
  };
}

export type BridgeEvent =
  | SessionChangedEvent
  | SessionTerminalEvent
  | TasksRefreshRequiredEvent
  | HudChangedEvent
  | BridgeClosingEvent;

export interface SessionCommand {
  readonly commandId: string;
  readonly connectionId: string;
  readonly sessionId: string;
  readonly expectedRevision: number;
}

export type SessionCommandOutcome =
  | "applied"
  | "already-satisfied"
  | "rejected";

export interface SessionCommandRejection {
  readonly code: "NO_ACTIVE_SESSION" | "CONFLICT" | "REJECTED_STATE";
  readonly message: string;
}

export interface SessionCommandAcknowledgement {
  readonly commandId: string;
  readonly connectionId: string;
  readonly outcome: SessionCommandOutcome;
  readonly authoritative: SnapshotEnvelope<ActiveSession | null>;
  readonly rejection: SessionCommandRejection | null;
}

export type BridgeExecution = "not-sent" | "indeterminate";

export type BridgeErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_PROTOCOL"
  | "UNSUPPORTED_PROMETHEE_VERSION"
  | "MISSING_CAPABILITY"
  | "OPERATION_DENIED"
  | "NOT_CONNECTED"
  | "CONNECTION_CHANGED"
  | "SEQUENCE_GAP"
  | "TRANSPORT_ERROR";

export interface BridgeError {
  readonly code: BridgeErrorCode;
  readonly message: string;
  readonly execution: BridgeExecution;
  readonly retryable: boolean;
}

export type BridgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BridgeError };

export interface CompatibilityPolicy {
  readonly allowedPrometheeVersions: readonly string[];
  readonly supportedProtocolVersions: readonly number[];
}

export interface ConnectionBootstrap {
  readonly hello: BridgeHello;
  readonly snapshot: SnapshotEnvelope<BridgeReadModel>;
  readonly replayEvents: readonly BridgeEvent[];
}

export interface ReconciliationSnapshot {
  readonly snapshot: SnapshotEnvelope<BridgeReadModel>;
  readonly replayEvents: readonly BridgeEvent[];
}

/** A task-only projection. It cannot overwrite the live session or HUD timeline. */
export type TaskRefreshSnapshot = SnapshotEnvelope<TaskReadModel | null>;

export type AdapterSignal =
  | { readonly type: "event"; readonly event: BridgeEvent }
  | {
      readonly type: "sequence-gap";
      readonly connectionId: string;
      readonly expectedSequence: number;
      readonly receivedSequence: number;
    }
  | {
      readonly type: "event-dropped";
      readonly reason: "duplicate" | "stale-connection" | "awaiting-reconciliation";
    }
  | { readonly type: "protocol-fault"; readonly error: BridgeError };

export type AdapterSignalSink = (signal: AdapterSignal) => void;

export interface RawPrometheeBridgePortV1 {
  negotiate(hello: ClientHello): Promise<unknown>;
  subscribe(connectionId: string, listener: (event: unknown) => void): () => void;
  readSnapshot(connectionId: string): Promise<unknown>;
  pause(command: SessionCommand): Promise<unknown>;
  resume(command: SessionCommand): Promise<unknown>;
}

export interface PrometheeAdapterV1Api {
  readonly connectionId: string | null;
  pause(command: SessionCommand): Promise<BridgeResult<SessionCommandAcknowledgement>>;
  resume?(command: SessionCommand): Promise<BridgeResult<SessionCommandAcknowledgement>>;
  refreshReadModel(): Promise<BridgeResult<TaskRefreshSnapshot>>;
  reconcile(): Promise<BridgeResult<ReconciliationSnapshot>>;
  disconnect(): void;
}

export interface AdapterTimeoutScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface AdapterTimeoutOptions {
  readonly negotiationTimeoutMs: number;
  readonly snapshotTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly scheduler: AdapterTimeoutScheduler;
}
