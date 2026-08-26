import type {
  IdleState,
  PomodoroConfig,
  PomodoroState
} from "../core/index.ts";

export const CYCLE_SNAPSHOT_VERSION = 1 as const;
export const MAX_SNAPSHOT_CHARACTERS = 64 * 1024;
export const MAX_PERSISTED_IDENTIFIER_LENGTH = 256;
export const MAX_PENDING_PAUSE_ATTEMPTS = 2;
export const MAX_QUARANTINED_SNAPSHOTS = 1 as const;

export interface PersistedPendingPauseV1 {
  readonly commandId: string;
  readonly pauseRequestId: string;
  readonly attempts: number;
}

export interface RecoveryMetadataV1 {
  readonly requiresReconciliation: boolean;
  readonly sessionId: string | null;
  readonly bridgeInstanceId: string | null;
  readonly lastObservedRevision: number | null;
  readonly pendingPause: PersistedPendingPauseV1 | null;
}

export interface CycleSnapshotV1 {
  readonly version: typeof CYCLE_SNAPSHOT_VERSION;
  readonly savedAt: number;
  readonly config: PomodoroConfig;
  readonly engineState: PomodoroState;
  readonly recovery: RecoveryMetadataV1;
}

export type SnapshotWarningCode =
  | "SNAPSHOT_TOO_LARGE"
  | "MALFORMED_JSON"
  | "INVALID_VERSION"
  | "UNSUPPORTED_PAST_VERSION"
  | "INVALID_ENVELOPE"
  | "INVALID_CONFIG"
  | "INVALID_ENGINE_STATE"
  | "INVALID_RECOVERY_METADATA"
  | "INVALID_RECOVERY_TIME";

export interface SnapshotWarning {
  readonly code: SnapshotWarningCode;
  readonly message: string;
}

export interface CorruptSnapshotFallback {
  readonly kind: "corrupt-current";
  readonly warning: SnapshotWarning;
  readonly config: PomodoroConfig;
  readonly configSource: "snapshot" | "defaults";
  readonly engineState: IdleState;
  readonly writePolicy: "quarantine-before-replace";
  readonly maxQuarantinedSnapshots: typeof MAX_QUARANTINED_SNAPSHOTS;
  readonly prometheeMutations: readonly [];
}

export interface FutureVersionSnapshot {
  readonly kind: "future-version";
  readonly version: number;
  readonly preservedSerialized: string;
  readonly readOnly: true;
  readonly writePolicy: "preserve-unchanged";
  readonly prometheeMutations: readonly [];
}

export interface ValidSnapshot {
  readonly kind: "valid";
  readonly snapshot: CycleSnapshotV1;
}

export type SnapshotDecodeResult =
  | ValidSnapshot
  | FutureVersionSnapshot
  | CorruptSnapshotFallback;

export type SnapshotEncodeResult =
  | { readonly ok: true; readonly serialized: string }
  | { readonly ok: false; readonly warning: SnapshotWarning };

export type RecoveryDiagnosticCode =
  | "BACKWARD_CLOCK_CLAMPED"
  | "FOCUS_EXPIRED_AWAITING_COORDINATED_PAUSE"
  | "BREAK_EXPIRED_READY";

export interface RecoveryDiagnostic {
  readonly code: RecoveryDiagnosticCode;
  readonly message: string;
}

export interface RecoveredCycle {
  readonly kind: "recovered";
  readonly config: PomodoroConfig;
  readonly engineState: PomodoroState;
  readonly recovery: RecoveryMetadataV1;
  readonly effectiveNow: number;
  readonly quarantine: "none" | "requires-authoritative-reconciliation";
  readonly diagnostics: readonly RecoveryDiagnostic[];
  readonly prometheeMutations: readonly [];
}

export interface RecoveryRejected {
  readonly kind: "recovery-rejected";
  readonly warning: SnapshotWarning;
  readonly config: PomodoroConfig;
  readonly engineState: IdleState;
  readonly writePolicy: "preserve-unchanged";
  readonly prometheeMutations: readonly [];
}

export type CycleRecoveryResult =
  | RecoveredCycle
  | RecoveryRejected
  | CorruptSnapshotFallback;
