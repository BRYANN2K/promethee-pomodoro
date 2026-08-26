import type {
  PomodoroConfig,
  PomodoroState
} from "../core/index.ts";
import type {
  ActiveSession,
  AdapterSignal,
  BridgeError,
  BridgeEvent,
  BridgeReadModel,
  BridgeResult,
  ConnectionBootstrap,
  HudReadModel,
  PrometheeAdapterV1Api,
  ReconciliationSnapshot,
  SessionCommand,
  SessionCommandAcknowledgement,
  SnapshotEnvelope,
  TaskRefreshSnapshot,
  TaskReadModel
} from "../promethee-adapter/v1/index.ts";

export type CoordinatorStatus =
  | "disconnected"
  | "ready"
  | "reconciling"
  | "unavailable";

export interface BoundSession {
  readonly connectionId: string;
  readonly id: string;
  readonly status: ActiveSession["status"];
  readonly revision: number;
  readonly taskId: string | null;
  readonly startedAtMs: number;
}

export interface PendingPause {
  readonly command: SessionCommand;
  readonly effectId: string;
  readonly pauseRequestId: string;
  readonly attempts: number;
  readonly connectionGeneration: number;
  readonly effectToken: string;
}

export interface PendingCoordinatorEffect {
  readonly connectionId: string;
  readonly connectionGeneration: number;
  readonly effectToken: string;
}

export interface PendingTaskRefresh extends PendingCoordinatorEffect {
  readonly startedAtSequence: number;
}

export interface CoordinatorCycleCheckpoint {
  readonly atMs: number;
  readonly connectionId: string | null;
  readonly connectionGeneration: number;
  readonly localActionSequence: number;
  readonly pomodoro: PomodoroState;
  readonly boundSession: BoundSession | null;
  readonly pendingPause: PendingPause | null;
}

export interface AcceptedCoordinatorLocalAction {
  readonly sequence: number;
  readonly acceptedAtMs: number;
  readonly connectionId: string | null;
  readonly connectionGeneration: number;
  readonly action: CoordinatorLocalAction;
  readonly pendingPauseAfter: PendingPause | null;
}

export interface SessionCoordinatorState {
  readonly status: CoordinatorStatus;
  readonly nowMs: number;
  readonly connectionId: string | null;
  readonly connectionGeneration: number;
  readonly effectSequence: number;
  readonly lastSequence: number;
  readonly lastEventOccurredAtMs: number;
  readonly pomodoro: PomodoroState;
  readonly boundSession: BoundSession | null;
  readonly pendingPause: PendingPause | null;
  readonly localActionSequence: number;
  readonly acceptedLocalActions: readonly AcceptedCoordinatorLocalAction[];
  readonly cycleCheckpoints: readonly CoordinatorCycleCheckpoint[];
  readonly tasks: TaskReadModel | null;
  readonly taskRefreshRequired: boolean;
  readonly taskRefreshInFlight: boolean;
  readonly taskRefreshAttempts: number;
  readonly taskRefreshMarkerSequence: number;
  readonly pendingTaskRefresh: PendingTaskRefresh | null;
  readonly pendingReconciliation: PendingCoordinatorEffect | null;
  readonly hud: HudReadModel | null;
  readonly lastError: BridgeError | null;
}

export type CoordinatorLocalAction =
  | { readonly type: "start-break" }
  | { readonly type: "skip-focus" }
  | { readonly type: "skip-break" }
  | { readonly type: "restart-phase" }
  | { readonly type: "end-pomodoro" }
  | { readonly type: "dismiss-ready" };

export type CoordinatorIngress =
  | {
      readonly type: "bootstrap";
      readonly nowMs: number;
      readonly bootstrap: ConnectionBootstrap;
    }
  | { readonly type: "tick"; readonly nowMs: number }
  | {
      readonly type: "local-action";
      readonly nowMs: number;
      readonly action: CoordinatorLocalAction;
    }
  | { readonly type: "bridge-event"; readonly nowMs: number; readonly event: BridgeEvent }
  | {
      readonly type: "sequence-gap";
      readonly nowMs: number;
      readonly connectionId: string;
    }
  | {
      readonly type: "protocol-fault";
      readonly nowMs: number;
      readonly error: BridgeError;
    }
  | {
      readonly type: "pause-settled";
      readonly nowMs: number;
      readonly commandId: string;
      readonly connectionId: string;
      readonly connectionGeneration: number;
      readonly effectToken: string;
      readonly result: BridgeResult<SessionCommandAcknowledgement>;
    }
  | {
      readonly type: "reconcile-settled";
      readonly nowMs: number;
      readonly connectionId: string;
      readonly connectionGeneration: number;
      readonly effectToken: string;
      readonly result: BridgeResult<ReconciliationSnapshot>;
    }
  | {
      readonly type: "task-refresh-settled";
      readonly nowMs: number;
      readonly connectionId: string;
      readonly connectionGeneration: number;
      readonly effectToken: string;
      readonly result: BridgeResult<TaskRefreshSnapshot>;
    }
  | { readonly type: "disconnect"; readonly nowMs: number };

export type CoordinatorEffect =
  | {
      readonly type: "send-pause";
      readonly command: SessionCommand;
      readonly connectionGeneration: number;
      readonly effectToken: string;
    }
  | {
      readonly type: "request-reconciliation";
      readonly connectionId: string;
      readonly connectionGeneration: number;
      readonly effectToken: string;
    }
  | {
      readonly type: "refresh-read-model";
      readonly connectionId: string;
      readonly connectionGeneration: number;
      readonly effectToken: string;
      readonly startedAtSequence: number;
    };

export interface CoordinatorReduction {
  readonly state: SessionCoordinatorState;
  readonly effects: readonly CoordinatorEffect[];
}

export type CoordinatorBridge = Pick<
  PrometheeAdapterV1Api,
  "pause" | "reconcile" | "refreshReadModel"
>;

export type CoordinatorClock = () => number;

export interface SessionCoordinatorOptions {
  readonly bridge: CoordinatorBridge;
  readonly config: PomodoroConfig;
  readonly clock: CoordinatorClock;
}

export interface SessionCoordinatorApi {
  readonly state: SessionCoordinatorState;
  start(bootstrap: ConnectionBootstrap, nowMs?: number): Promise<void>;
  tick(nowMs?: number): Promise<void>;
  dispatchLocalAction(action: CoordinatorLocalAction, nowMs?: number): Promise<void>;
  acceptAdapterSignal(signal: AdapterSignal, nowMs?: number): Promise<void>;
  disconnect(nowMs?: number): Promise<void>;
  settle(): Promise<void>;
}

export type AuthoritativeSnapshot = SnapshotEnvelope<BridgeReadModel>;
