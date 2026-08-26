import type {
  ConfigField,
  ConfigValidationError,
  ConfigValidationResult,
  PomodoroConfig
} from "./types.ts";

export const MIN_PHASE_DURATION_MS = 1_000;
export const MAX_PHASE_DURATION_MS = 24 * 60 * 60 * 1_000;
export const MIN_FOCUSES_PER_LONG_BREAK = 1;
export const MAX_FOCUSES_PER_LONG_BREAK = 100;

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = Object.freeze({
  focusDurationMs: 25 * 60 * 1_000,
  shortBreakDurationMs: 5 * 60 * 1_000,
  longBreakDurationMs: 15 * 60 * 1_000,
  focusesPerLongBreak: 4,
  autoStartBreak: true
});

interface NumericConstraint {
  readonly field: Exclude<ConfigField, "autoStartBreak">;
  readonly minimum: number;
  readonly maximum: number;
}

const NUMERIC_CONSTRAINTS: readonly NumericConstraint[] = [
  {
    field: "focusDurationMs",
    minimum: MIN_PHASE_DURATION_MS,
    maximum: MAX_PHASE_DURATION_MS
  },
  {
    field: "shortBreakDurationMs",
    minimum: MIN_PHASE_DURATION_MS,
    maximum: MAX_PHASE_DURATION_MS
  },
  {
    field: "longBreakDurationMs",
    minimum: MIN_PHASE_DURATION_MS,
    maximum: MAX_PHASE_DURATION_MS
  },
  {
    field: "focusesPerLongBreak",
    minimum: MIN_FOCUSES_PER_LONG_BREAK,
    maximum: MAX_FOCUSES_PER_LONG_BREAK
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePomodoroConfig(value: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const record = isRecord(value) ? value : {};

  for (const constraint of NUMERIC_CONSTRAINTS) {
    const candidate = record[constraint.field];
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate)) {
      errors.push({
        field: constraint.field,
        code: "not-finite-integer",
        message: `${constraint.field} must be a finite integer.`
      });
      continue;
    }

    if (
      typeof candidate === "number" &&
      (candidate < constraint.minimum || candidate > constraint.maximum)
    ) {
      errors.push({
        field: constraint.field,
        code: "out-of-range",
        message: `${constraint.field} must be between ${constraint.minimum} and ${constraint.maximum}.`
      });
    }
  }

  if (typeof record.autoStartBreak !== "boolean") {
    errors.push({
      field: "autoStartBreak",
      code: "not-boolean",
      message: "autoStartBreak must be boolean."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      focusDurationMs: record.focusDurationMs as number,
      shortBreakDurationMs: record.shortBreakDurationMs as number,
      longBreakDurationMs: record.longBreakDurationMs as number,
      focusesPerLongBreak: record.focusesPerLongBreak as number,
      autoStartBreak: record.autoStartBreak as boolean
    }
  };
}
