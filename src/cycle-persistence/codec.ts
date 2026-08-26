import {
  DEFAULT_POMODORO_CONFIG,
  createInitialState,
  isValidTimestamp,
  validatePomodoroConfig,
  validatePomodoroState,
  type PomodoroConfig,
  type PomodoroState
} from "../core/index.ts";
import {
  CYCLE_SNAPSHOT_VERSION,
  MAX_PENDING_PAUSE_ATTEMPTS,
  MAX_PERSISTED_IDENTIFIER_LENGTH,
  MAX_QUARANTINED_SNAPSHOTS,
  MAX_SNAPSHOT_CHARACTERS,
  type CorruptSnapshotFallback,
  type CycleSnapshotV1,
  type PersistedPendingPauseV1,
  type RecoveryMetadataV1,
  type SnapshotDecodeResult,
  type SnapshotEncodeResult,
  type SnapshotWarning
} from "./types.ts";

const ENVELOPE_KEYS = [
  "version",
  "savedAt",
  "config",
  "engineState",
  "recovery"
] as const;

const CONFIG_KEYS = [
  "focusDurationMs",
  "shortBreakDurationMs",
  "longBreakDurationMs",
  "focusesPerLongBreak",
  "autoStartBreak"
] as const;

const RECOVERY_KEYS = [
  "requiresReconciliation",
  "sessionId",
  "bridgeInstanceId",
  "lastObservedRevision",
  "pendingPause"
] as const;

const PENDING_PAUSE_KEYS = ["commandId", "pauseRequestId", "attempts"] as const;
const NO_PROMETHEE_MUTATIONS = Object.freeze([]) as readonly [];

type ValidationResult =
  | { readonly valid: true; readonly snapshot: CycleSnapshotV1 }
  | { readonly valid: false; readonly warning: SnapshotWarning };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const expected = new Set(expectedKeys);
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.size &&
    actual.every((key) => typeof key === "string" && expected.has(key))
  );
}

function warning(
  code: SnapshotWarning["code"],
  message: string
): SnapshotWarning {
  return { code, message };
}

function isPersistedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PERSISTED_IDENTIFIER_LENGTH &&
    value.trim() === value &&
    !value.includes("\0")
  );
}

function validateConfig(value: unknown): PomodoroConfig | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, CONFIG_KEYS)) {
    return null;
  }
  const validation = validatePomodoroConfig(value);
  return validation.valid ? validation.value : null;
}

function validatePendingPause(value: unknown): PersistedPendingPauseV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, PENDING_PAUSE_KEYS)) {
    return null;
  }
  if (
    !isPersistedIdentifier(value.commandId) ||
    !isPersistedIdentifier(value.pauseRequestId) ||
    !Number.isSafeInteger(value.attempts) ||
    (value.attempts as number) < 1 ||
    (value.attempts as number) > MAX_PENDING_PAUSE_ATTEMPTS
  ) {
    return null;
  }
  return {
    commandId: value.commandId,
    pauseRequestId: value.pauseRequestId,
    attempts: value.attempts as number
  };
}

function validateRecoveryMetadata(
  value: unknown,
  engineState: PomodoroState
): RecoveryMetadataV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, RECOVERY_KEYS)) {
    return null;
  }
  if (typeof value.requiresReconciliation !== "boolean") {
    return null;
  }

  const allSessionFieldsNull =
    value.sessionId === null &&
    value.bridgeInstanceId === null &&
    value.lastObservedRevision === null;
  const allSessionFieldsValid =
    isPersistedIdentifier(value.sessionId) &&
    isPersistedIdentifier(value.bridgeInstanceId) &&
    Number.isSafeInteger(value.lastObservedRevision) &&
    (value.lastObservedRevision as number) >= 0;
  if (!allSessionFieldsNull && !allSessionFieldsValid) {
    return null;
  }

  const pendingPause = value.pendingPause === null
    ? null
    : validatePendingPause(value.pendingPause);
  if (value.pendingPause !== null && pendingPause === null) {
    return null;
  }

  const hasSession = allSessionFieldsValid;
  const isActive = engineState.kind !== "idle";
  if ((isActive || hasSession || pendingPause !== null) && !value.requiresReconciliation) {
    return null;
  }
  if (isActive && !hasSession) {
    return null;
  }
  if (pendingPause !== null) {
    if (
      !hasSession ||
      engineState.kind !== "focus-paused" ||
      engineState.reason !== "awaiting-promethee-pause" ||
      pendingPause.pauseRequestId !== engineState.pauseRequestId
    ) {
      return null;
    }
  }

  return {
    requiresReconciliation: value.requiresReconciliation,
    sessionId: hasSession ? value.sessionId as string : null,
    bridgeInstanceId: hasSession ? value.bridgeInstanceId as string : null,
    lastObservedRevision: hasSession ? value.lastObservedRevision as number : null,
    pendingPause
  };
}

function canonicalEngineState(state: PomodoroState): PomodoroState {
  const base = {
    schemaVersion: state.schemaVersion,
    kind: state.kind,
    completedFocusCount: state.completedFocusCount,
    cycleInstance: state.cycleInstance,
    phaseSequence: state.phaseSequence
  };

  switch (state.kind) {
    case "idle":
      return {
        ...base,
        kind: "idle"
      };
    case "focus-running":
      return {
        ...base,
        kind: "focus-running",
        phaseId: state.phaseId,
        startedAtMs: state.startedAtMs,
        durationMs: state.durationMs,
        deadlineAtMs: state.deadlineAtMs
      };
    case "focus-paused":
      switch (state.reason) {
        case "promethee-paused":
          return {
            ...base,
            kind: "focus-paused",
            reason: "promethee-paused",
            phaseId: state.phaseId,
            durationMs: state.durationMs,
            remainingMs: state.remainingMs
          };
        case "awaiting-promethee-pause":
          return {
            ...base,
            kind: "focus-paused",
            reason: "awaiting-promethee-pause",
            phaseId: state.phaseId,
            pauseRequestId: state.pauseRequestId,
            breakSource: state.breakSource,
            durationMs: state.durationMs,
            remainingMs: 0,
            completedFocusStartedAtMs: state.completedFocusStartedAtMs,
            completedFocusDeadlineAtMs: state.completedFocusDeadlineAtMs
          };
        case "awaiting-break-start":
          return {
            ...base,
            kind: "focus-paused",
            reason: "awaiting-break-start",
            phaseId: state.phaseId,
            durationMs: state.durationMs,
            remainingMs: 0,
            pendingBreakKind: state.pendingBreakKind,
            breakSource: state.breakSource
          };
      }
    case "break-running":
      return {
        ...base,
        kind: "break-running",
        breakKind: state.breakKind,
        breakSource: state.breakSource,
        startedAtMs: state.startedAtMs,
        durationMs: state.durationMs,
        deadlineAtMs: state.deadlineAtMs
      };
    case "ready":
      return {
        ...base,
        kind: "ready",
        completedBreakKind: state.completedBreakKind,
        breakSource: state.breakSource,
        readyOccurrenceId: state.readyOccurrenceId
      };
  }
}

function canonicalSnapshot(snapshot: CycleSnapshotV1): CycleSnapshotV1 {
  const recovery = snapshot.recovery;
  return {
    version: CYCLE_SNAPSHOT_VERSION,
    savedAt: snapshot.savedAt,
    config: {
      focusDurationMs: snapshot.config.focusDurationMs,
      shortBreakDurationMs: snapshot.config.shortBreakDurationMs,
      longBreakDurationMs: snapshot.config.longBreakDurationMs,
      focusesPerLongBreak: snapshot.config.focusesPerLongBreak,
      autoStartBreak: snapshot.config.autoStartBreak
    },
    engineState: canonicalEngineState(snapshot.engineState),
    recovery: {
      requiresReconciliation: recovery.requiresReconciliation,
      sessionId: recovery.sessionId,
      bridgeInstanceId: recovery.bridgeInstanceId,
      lastObservedRevision: recovery.lastObservedRevision,
      pendingPause: recovery.pendingPause === null
        ? null
        : {
            commandId: recovery.pendingPause.commandId,
            pauseRequestId: recovery.pendingPause.pauseRequestId,
            attempts: recovery.pendingPause.attempts
          }
    }
  };
}

function validateSnapshot(value: unknown): ValidationResult {
  if (!isPlainRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) {
    return {
      valid: false,
      warning: warning(
        "INVALID_ENVELOPE",
        "Cycle snapshot must contain only the exact version 1 envelope fields."
      )
    };
  }
  if (
    value.version !== CYCLE_SNAPSHOT_VERSION ||
    typeof value.savedAt !== "number" ||
    !isValidTimestamp(value.savedAt)
  ) {
    return {
      valid: false,
      warning: warning(
        "INVALID_ENVELOPE",
        "Cycle snapshot version or savedAt is invalid."
      )
    };
  }
  const savedAt = value.savedAt;

  const config = validateConfig(value.config);
  if (config === null) {
    return {
      valid: false,
      warning: warning("INVALID_CONFIG", "Persisted Pomodoro configuration is invalid.")
    };
  }

  const stateValidation = validatePomodoroState(value.engineState as PomodoroState);
  if (!stateValidation.valid) {
    return {
      valid: false,
      warning: warning(
        "INVALID_ENGINE_STATE",
        stateValidation.message ?? "Persisted Pomodoro engine state is invalid."
      )
    };
  }
  const engineState = value.engineState as PomodoroState;
  if (
    ((engineState.kind === "focus-running" || engineState.kind === "break-running") &&
      savedAt < engineState.startedAtMs) ||
    (engineState.kind === "focus-paused" &&
      engineState.reason === "awaiting-promethee-pause" &&
      savedAt < engineState.completedFocusStartedAtMs)
  ) {
    return {
      valid: false,
      warning: warning(
        "INVALID_ENGINE_STATE",
        "Persisted phase begins after the snapshot write timestamp."
      )
    };
  }

  const recovery = validateRecoveryMetadata(value.recovery, engineState);
  if (recovery === null) {
    return {
      valid: false,
      warning: warning(
        "INVALID_RECOVERY_METADATA",
        "Coordinator recovery metadata is invalid or inconsistent with the engine state."
      )
    };
  }

  return {
    valid: true,
    snapshot: canonicalSnapshot({
      version: CYCLE_SNAPSHOT_VERSION,
      savedAt,
      config,
      engineState,
      recovery
    })
  };
}

function salvageConfig(value: unknown): {
  readonly config: PomodoroConfig;
  readonly configSource: "snapshot" | "defaults";
} {
  if (isPlainRecord(value)) {
    const config = validateConfig(value.config);
    if (config !== null) {
      return { config, configSource: "snapshot" };
    }
  }
  return { config: DEFAULT_POMODORO_CONFIG, configSource: "defaults" };
}

export function corruptSnapshotFallback(
  value: unknown,
  snapshotWarning: SnapshotWarning
): CorruptSnapshotFallback {
  const salvaged = salvageConfig(value);
  return {
    kind: "corrupt-current",
    warning: snapshotWarning,
    config: salvaged.config,
    configSource: salvaged.configSource,
    engineState: createInitialState(),
    writePolicy: "quarantine-before-replace",
    maxQuarantinedSnapshots: MAX_QUARANTINED_SNAPSHOTS,
    prometheeMutations: NO_PROMETHEE_MUTATIONS
  };
}

export function decodeCycleSnapshot(serialized: string): SnapshotDecodeResult {
  if (
    typeof serialized !== "string" ||
    serialized.length > MAX_SNAPSHOT_CHARACTERS
  ) {
    return corruptSnapshotFallback(
      undefined,
      warning("SNAPSHOT_TOO_LARGE", "Cycle snapshot exceeds the version 1 size limit.")
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return corruptSnapshotFallback(
      undefined,
      warning("MALFORMED_JSON", "Cycle snapshot is not valid JSON.")
    );
  }

  if (isPlainRecord(value) && Number.isSafeInteger(value.version)) {
    const version = value.version as number;
    if (version > CYCLE_SNAPSHOT_VERSION) {
      return {
        kind: "future-version",
        version,
        preservedSerialized: serialized,
        readOnly: true,
        writePolicy: "preserve-unchanged",
        prometheeMutations: NO_PROMETHEE_MUTATIONS
      };
    }
    if (version < CYCLE_SNAPSHOT_VERSION) {
      return corruptSnapshotFallback(
        value,
        warning(
          "UNSUPPORTED_PAST_VERSION",
          "No released migration exists for this older cycle snapshot version."
        )
      );
    }
  } else {
    return corruptSnapshotFallback(
      value,
      warning("INVALID_VERSION", "Cycle snapshot version must be a safe integer.")
    );
  }

  const validation = validateSnapshot(value);
  return validation.valid
    ? { kind: "valid", snapshot: validation.snapshot }
    : corruptSnapshotFallback(value, validation.warning);
}

export function encodeCycleSnapshot(value: unknown): SnapshotEncodeResult {
  const validation = validateSnapshot(value);
  if (!validation.valid) {
    return { ok: false, warning: validation.warning };
  }
  const serialized = JSON.stringify(validation.snapshot);
  if (serialized.length > MAX_SNAPSHOT_CHARACTERS) {
    return {
      ok: false,
      warning: warning("SNAPSHOT_TOO_LARGE", "Cycle snapshot exceeds the version 1 size limit.")
    };
  }
  return { ok: true, serialized };
}

export function validateCycleSnapshotV1(value: unknown): ValidationResult {
  return validateSnapshot(value);
}
