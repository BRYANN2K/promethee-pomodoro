import {
  MAX_PHASE_DURATION_MS,
  MIN_PHASE_DURATION_MS
} from "./config.ts";
import { isValidTimestamp } from "./time.ts";
import {
  POMODORO_STATE_SCHEMA_VERSION,
  type BreakSource,
  type PomodoroState
} from "./types.ts";

export interface StateValidationResult {
  readonly valid: boolean;
  readonly message?: string;
}

export function focusPhaseId(cycleInstance: number, phaseSequence: number): string {
  return `cycle:${cycleInstance}:focus:${phaseSequence}`;
}

export function pauseRequestIdFor(phaseId: string): string {
  return `pause:${phaseId}`;
}

export function readyOccurrenceIdFor(
  cycleInstance: number,
  phaseSequence: number,
  breakSource: BreakSource
): string {
  return `ready:cycle:${cycleInstance}:focus:${phaseSequence}:${breakSource}`;
}

function invalid(message: string): StateValidationResult {
  return { valid: false, message };
}

const BASE_KEYS = [
  "schemaVersion",
  "kind",
  "completedFocusCount",
  "cycleInstance",
  "phaseSequence"
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(state: PomodoroState, variantKeys: readonly string[]): boolean {
  const expected = new Set<string>([...BASE_KEYS, ...variantKeys]);
  const actual = Reflect.ownKeys(state);
  return (
    actual.length === expected.size &&
    actual.every((key) => typeof key === "string" && expected.has(key))
  );
}

function exactKeysOrError(
  state: PomodoroState,
  variantKeys: readonly string[]
): StateValidationResult | null {
  return hasExactKeys(state, variantKeys)
    ? null
    : invalid(`State variant ${state.kind} contains missing or extraneous fields.`);
}

function hasValidDuration(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= MIN_PHASE_DURATION_MS &&
    value <= MAX_PHASE_DURATION_MS
  );
}

function isBreakSource(value: unknown): value is BreakSource {
  return value === "completed-focus" || value === "skipped-focus";
}

function validateBreakCredit(
  completedFocusCount: number,
  breakSource: BreakSource,
  breakKind: "short" | "long"
): StateValidationResult | null {
  if (breakSource === "completed-focus" && completedFocusCount < 1) {
    return invalid("A completed-focus break requires at least one completed focus.");
  }
  if (breakSource === "skipped-focus" && breakKind !== "short") {
    return invalid("A skipped focus can lead only to a short break.");
  }
  return null;
}

function validateBase(state: PomodoroState): StateValidationResult | null {
  if (state.schemaVersion !== POMODORO_STATE_SCHEMA_VERSION) {
    return invalid("Pomodoro state schema version is unsupported.");
  }
  if (!Number.isSafeInteger(state.completedFocusCount) || state.completedFocusCount < 0) {
    return invalid("Completed focus count is invalid.");
  }
  if (!Number.isSafeInteger(state.cycleInstance) || state.cycleInstance < 1) {
    return invalid("Cycle instance is invalid.");
  }
  if (!Number.isSafeInteger(state.phaseSequence) || state.phaseSequence < 0) {
    return invalid("Phase sequence is invalid.");
  }
  if (state.completedFocusCount > state.phaseSequence) {
    return invalid("Completed focus count cannot exceed phase sequence.");
  }
  return null;
}

function validateFocusIdentity(
  state: Extract<PomodoroState, { readonly kind: "focus-running" | "focus-paused" }>
): StateValidationResult | null {
  if (state.phaseSequence < 1) {
    return invalid("A focus phase requires a positive phase sequence.");
  }
  if (state.phaseId !== focusPhaseId(state.cycleInstance, state.phaseSequence)) {
    return invalid("Focus phase identity does not match its cycle instance and sequence.");
  }
  return null;
}

function validateRunningTiming(
  state: Extract<PomodoroState, { readonly kind: "focus-running" | "break-running" }>,
  exactDuration: boolean
): StateValidationResult | null {
  if (!hasValidDuration(state.durationMs)) {
    return invalid("Running phase duration is invalid.");
  }
  if (!isValidTimestamp(state.startedAtMs) || !isValidTimestamp(state.deadlineAtMs)) {
    return invalid("Running phase timestamps are invalid.");
  }
  const segmentDurationMs = state.deadlineAtMs - state.startedAtMs;
  if (
    !Number.isSafeInteger(segmentDurationMs) ||
    segmentDurationMs <= 0 ||
    segmentDurationMs > state.durationMs ||
    (exactDuration && segmentDurationMs !== state.durationMs)
  ) {
    return invalid("Running phase deadline is inconsistent with its duration.");
  }
  return null;
}

export function validatePomodoroState(state: PomodoroState): StateValidationResult {
  if (!isPlainRecord(state)) {
    return invalid("Pomodoro state must be a plain record.");
  }

  const baseError = validateBase(state);
  if (baseError) {
    return baseError;
  }

  switch (state.kind) {
    case "idle": {
      const keysError = exactKeysOrError(state, []);
      if (keysError) {
        return keysError;
      }
      return { valid: true };
    }

    case "focus-running": {
      const keysError = exactKeysOrError(state, [
        "phaseId",
        "startedAtMs",
        "durationMs",
        "deadlineAtMs"
      ]);
      if (keysError) {
        return keysError;
      }
      const identityError = validateFocusIdentity(state);
      if (identityError) {
        return identityError;
      }
      if (state.completedFocusCount >= state.phaseSequence) {
        return invalid("Running focus count must precede its phase sequence.");
      }
      return validateRunningTiming(state, false) ?? { valid: true };
    }

    case "focus-paused": {
      const identityError = validateFocusIdentity(state);
      if (identityError) {
        return identityError;
      }
      if (!hasValidDuration(state.durationMs)) {
        return invalid("Paused focus duration is invalid.");
      }
      if (
        !Number.isSafeInteger(state.remainingMs) ||
        state.remainingMs < 0 ||
        state.remainingMs > state.durationMs
      ) {
        return invalid("Paused focus remainder is invalid.");
      }

      if (state.reason === "promethee-paused") {
        const keysError = exactKeysOrError(state, [
          "reason",
          "phaseId",
          "durationMs",
          "remainingMs"
        ]);
        if (keysError) {
          return keysError;
        }
        if (state.completedFocusCount >= state.phaseSequence) {
          return invalid("Paused focus count must precede its phase sequence.");
        }
        return state.remainingMs > 0
          ? { valid: true }
          : invalid("A manually paused focus must retain positive time.");
      }

      if (state.remainingMs !== 0) {
        return invalid("A completed focus waiting for coordination must have zero remainder.");
      }

      if (state.reason === "awaiting-promethee-pause") {
        const keysError = exactKeysOrError(state, [
          "reason",
          "phaseId",
          "pauseRequestId",
          "breakSource",
          "durationMs",
          "remainingMs",
          "completedFocusStartedAtMs",
          "completedFocusDeadlineAtMs"
        ]);
        if (keysError) {
          return keysError;
        }
        if (state.completedFocusCount >= state.phaseSequence) {
          return invalid("Awaiting-pause focus count must precede its phase sequence.");
        }
        if (state.pauseRequestId !== pauseRequestIdFor(state.phaseId)) {
          return invalid("Pause request identity does not match the focus phase.");
        }
        if (!isBreakSource(state.breakSource)) {
          return invalid("Awaiting-pause break source is invalid.");
        }
        if (
          !isValidTimestamp(state.completedFocusStartedAtMs) ||
          !isValidTimestamp(state.completedFocusDeadlineAtMs)
        ) {
          return invalid("Completed focus timestamps are invalid.");
        }
        const completedSegmentMs =
          state.completedFocusDeadlineAtMs - state.completedFocusStartedAtMs;
        if (
          !Number.isSafeInteger(completedSegmentMs) ||
          completedSegmentMs <= 0 ||
          completedSegmentMs > state.durationMs
        ) {
          return invalid("Completed focus deadline is inconsistent with its duration.");
        }
        return { valid: true };
      }

      if (state.reason !== "awaiting-break-start") {
        return invalid("Paused focus reason is invalid.");
      }

      const keysError = exactKeysOrError(state, [
        "reason",
        "phaseId",
        "durationMs",
        "remainingMs",
        "pendingBreakKind",
        "breakSource"
      ]);
      if (keysError) {
        return keysError;
      }
      if (
        (state.pendingBreakKind !== "short" && state.pendingBreakKind !== "long") ||
        !isBreakSource(state.breakSource)
      ) {
        return invalid("Pending break kind or source is invalid.");
      }
      return validateBreakCredit(
        state.completedFocusCount,
        state.breakSource,
        state.pendingBreakKind
      ) ?? { valid: true };
    }

    case "break-running": {
      const keysError = exactKeysOrError(state, [
        "breakKind",
        "breakSource",
        "startedAtMs",
        "durationMs",
        "deadlineAtMs"
      ]);
      if (keysError) {
        return keysError;
      }
      if (state.phaseSequence < 1) {
        return invalid("A break requires a completed focus phase identity.");
      }
      if (
        (state.breakKind !== "short" && state.breakKind !== "long") ||
        !isBreakSource(state.breakSource)
      ) {
        return invalid("Break kind or source is invalid.");
      }
      const creditError = validateBreakCredit(
        state.completedFocusCount,
        state.breakSource,
        state.breakKind
      );
      if (creditError) {
        return creditError;
      }
      return validateRunningTiming(state, true) ?? { valid: true };
    }

    case "ready": {
      const keysError = exactKeysOrError(state, [
        "completedBreakKind",
        "breakSource",
        "readyOccurrenceId"
      ]);
      if (keysError) {
        return keysError;
      }
      if (state.phaseSequence < 1) {
        return invalid("Ready requires a completed focus phase identity.");
      }
      if (
        (state.completedBreakKind !== "short" && state.completedBreakKind !== "long") ||
        !isBreakSource(state.breakSource)
      ) {
        return invalid("Completed break kind or source is invalid.");
      }
      const creditError = validateBreakCredit(
        state.completedFocusCount,
        state.breakSource,
        state.completedBreakKind
      );
      if (creditError) {
        return creditError;
      }
      return state.readyOccurrenceId === readyOccurrenceIdFor(
        state.cycleInstance,
        state.phaseSequence,
        state.breakSource
      )
        ? { valid: true }
        : invalid("Ready occurrence identity does not match its cycle and break source.");
    }

    default:
      return invalid("Pomodoro state kind is invalid.");
  }
}
