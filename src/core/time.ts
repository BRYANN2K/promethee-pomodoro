import type { PomodoroState } from "./types.ts";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function isValidTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function checkedDeadlineAt(startedAtMs: number, durationMs: number): number | null {
  if (
    !isValidTimestamp(startedAtMs) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    startedAtMs > Number.MAX_SAFE_INTEGER - durationMs
  ) {
    return null;
  }

  return startedAtMs + durationMs;
}

function hasValidTimedState(
  state: Extract<PomodoroState, { readonly kind: "focus-running" | "break-running" }>
): boolean {
  return (
    isValidTimestamp(state.startedAtMs) &&
    isValidTimestamp(state.deadlineAtMs) &&
    Number.isSafeInteger(state.durationMs) &&
    state.durationMs > 0 &&
    state.deadlineAtMs >= state.startedAtMs &&
    state.deadlineAtMs - state.startedAtMs <= state.durationMs
  );
}

function hasValidPausedState(
  state: Extract<PomodoroState, { readonly kind: "focus-paused" }>
): boolean {
  return (
    Number.isSafeInteger(state.durationMs) &&
    state.durationMs > 0 &&
    Number.isSafeInteger(state.remainingMs) &&
    state.remainingMs >= 0 &&
    state.remainingMs <= state.durationMs
  );
}

export function remainingMsAt(state: PomodoroState, nowMs: number): number | null {
  if (!isValidTimestamp(nowMs)) {
    return null;
  }

  switch (state.kind) {
    case "focus-running":
    case "break-running":
      if (!hasValidTimedState(state)) {
        return null;
      }
      return clamp(state.deadlineAtMs - nowMs, 0, state.durationMs);
    case "focus-paused":
      if (!hasValidPausedState(state)) {
        return null;
      }
      return state.remainingMs;
    case "idle":
    case "ready":
      return null;
  }
}

export function progressAt(state: PomodoroState, nowMs: number): number | null {
  const remainingMs = remainingMsAt(state, nowMs);
  if (
    remainingMs === null ||
    state.kind === "idle" ||
    state.kind === "ready"
  ) {
    return null;
  }

  const progress = remainingMs / state.durationMs;
  return Number.isFinite(progress) ? clamp(progress, 0, 1) : null;
}
