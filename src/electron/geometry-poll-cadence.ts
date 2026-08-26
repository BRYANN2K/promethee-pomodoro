export const GEOMETRY_FAST_POLL_MS = 16;
export const GEOMETRY_IDLE_POLL_MS = 100;
export const GEOMETRY_FAST_WINDOW_MS = 750;

export interface GeometryPollCadence {
  readonly fastUntilMs: number;
}

export function createGeometryPollCadence(nowMs: number): GeometryPollCadence {
  return Object.freeze({ fastUntilMs: safeNow(nowMs) + GEOMETRY_FAST_WINDOW_MS });
}

export function updateGeometryPollCadence(
  cadence: GeometryPollCadence,
  geometryChanged: boolean,
  nowMs: number
): GeometryPollCadence {
  const now = safeNow(nowMs);
  if (!geometryChanged) return cadence;
  return Object.freeze({ fastUntilMs: now + GEOMETRY_FAST_WINDOW_MS });
}

export function geometryPollDelay(cadence: GeometryPollCadence, nowMs: number): number {
  return safeNow(nowMs) <= cadence.fastUntilMs ? GEOMETRY_FAST_POLL_MS : GEOMETRY_IDLE_POLL_MS;
}

export function nextHudGeneration(currentGeneration: number, identityChanged: boolean): number {
  const current = Number.isSafeInteger(currentGeneration) && currentGeneration >= 0 ? currentGeneration : 0;
  if (!identityChanged) return current;
  return current < Number.MAX_SAFE_INTEGER ? current + 1 : 1;
}

function safeNow(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
