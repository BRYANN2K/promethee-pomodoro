import {
  createInitialState,
  isValidTimestamp,
  transition,
  type PomodoroState
} from "../core/index.ts";
import {
  corruptSnapshotFallback,
  validateCycleSnapshotV1
} from "./codec.ts";
import type {
  CycleRecoveryResult,
  CycleSnapshotV1,
  RecoveryDiagnostic,
  RecoveryMetadataV1,
  SnapshotWarning
} from "./types.ts";

const NO_PROMETHEE_MUTATIONS = Object.freeze([]) as readonly [];

function recoveryWarning(
  code: SnapshotWarning["code"],
  message: string
): SnapshotWarning {
  return { code, message };
}

function forceRecoveryQuarantine(
  metadata: RecoveryMetadataV1,
  state: PomodoroState
): RecoveryMetadataV1 {
  return {
    ...metadata,
    requiresReconciliation:
      metadata.requiresReconciliation || state.kind !== "idle"
  };
}

export function recoverCycleSnapshot(
  candidate: unknown,
  suppliedNow: number
): CycleRecoveryResult {
  const validation = validateCycleSnapshotV1(candidate);
  if (!validation.valid) {
    return corruptSnapshotFallback(candidate, validation.warning);
  }
  const snapshot: CycleSnapshotV1 = validation.snapshot;

  if (!isValidTimestamp(suppliedNow)) {
    return {
      kind: "recovery-rejected",
      warning: recoveryWarning(
        "INVALID_RECOVERY_TIME",
        "Recovery time must be a non-negative safe integer."
      ),
      config: snapshot.config,
      engineState: createInitialState(),
      writePolicy: "preserve-unchanged",
      prometheeMutations: NO_PROMETHEE_MUTATIONS
    };
  }

  const diagnostics: RecoveryDiagnostic[] = [];
  const effectiveNow = Math.max(snapshot.savedAt, suppliedNow);
  if (suppliedNow < snapshot.savedAt) {
    diagnostics.push({
      code: "BACKWARD_CLOCK_CLAMPED",
      message: "The supplied clock moved backward and was clamped to savedAt."
    });
  }

  let engineState = snapshot.engineState;
  let recovery = snapshot.recovery;
  if (
    engineState.kind === "focus-running" &&
    effectiveNow >= engineState.deadlineAtMs
  ) {
    const expired = transition(
      engineState,
      { type: "tick" },
      snapshot.config,
      effectiveNow
    );
    if (
      expired.rejection !== undefined ||
      expired.state.kind !== "focus-paused" ||
      expired.state.reason !== "awaiting-promethee-pause"
    ) {
      return corruptSnapshotFallback(
        candidate,
        recoveryWarning(
          "INVALID_ENGINE_STATE",
          "Expired focus could not be represented safely for coordinated pause."
        )
      );
    }
    engineState = expired.state;
    recovery = { ...recovery, pendingPause: null };
    diagnostics.push({
      code: "FOCUS_EXPIRED_AWAITING_COORDINATED_PAUSE",
      message: "Focus elapsed during absence and now awaits coordinator reconciliation."
    });
  } else if (
    engineState.kind === "break-running" &&
    effectiveNow >= engineState.deadlineAtMs
  ) {
    const expired = transition(
      engineState,
      { type: "tick" },
      snapshot.config,
      effectiveNow
    );
    if (expired.rejection !== undefined || expired.state.kind !== "ready") {
      return corruptSnapshotFallback(
        candidate,
        recoveryWarning(
          "INVALID_ENGINE_STATE",
          "Expired break could not be represented safely as Ready."
        )
      );
    }
    engineState = expired.state;
    recovery = { ...recovery, pendingPause: null };
    diagnostics.push({
      code: "BREAK_EXPIRED_READY",
      message: "Break elapsed during absence and recovered as Ready."
    });
  }

  recovery = forceRecoveryQuarantine(recovery, engineState);
  return {
    kind: "recovered",
    config: snapshot.config,
    engineState,
    recovery,
    effectiveNow,
    quarantine: recovery.requiresReconciliation
      ? "requires-authoritative-reconciliation"
      : "none",
    diagnostics,
    prometheeMutations: NO_PROMETHEE_MUTATIONS
  };
}
