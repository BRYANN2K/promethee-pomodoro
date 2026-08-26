import { executeNativeBridge, nativeBridgeExecutable } from "./native-promethee-bridge.ts";

const MAX_WINDOW_RECORDS = 128;
const LOOKUP_TIMEOUT_MS = 900;
const LOOKUP_MAX_BUFFER_BYTES = 64 * 1024;
const TIMER_HEIGHT = 32;
const TIMER_MIN_WIDTH = 120;
const TIMER_MAX_WIDTH = 220;
const OUTLINE_OUTSET = 2;

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ParsedWindowSnapshot =
  | { readonly status: "invalid"; readonly windows: readonly [] }
  | { readonly status: "valid"; readonly windows: readonly ScreenRect[] };

export type TimerWindowSelection =
  | { readonly status: "ambiguous"; readonly candidateCount: number }
  | { readonly status: "found"; readonly bounds: ScreenRect }
  | { readonly status: "invalid"; readonly candidateCount: 0 }
  | { readonly status: "not-found"; readonly candidateCount: 0 };

export type TimerWindowLookupResult =
  | TimerWindowSelection
  | { readonly status: "lookup-error"; readonly candidateCount: 0 };

export type TimerWindowContextLookupResult =
  | { readonly status: "found"; readonly bounds: ScreenRect; readonly exclusions: readonly ScreenRect[] }
  | Exclude<TimerWindowLookupResult, { readonly status: "found" }>;

export type WindowBoundsNormalizer = (bounds: ScreenRect) => ScreenRect | null;

export function parsePrometheeWindowSnapshot(output: unknown): ParsedWindowSnapshot {
  if (typeof output !== "string") {
    return invalidSnapshot();
  }

  const normalized = output.trim();
  if (normalized.length === 0) {
    return Object.freeze({ status: "valid", windows: Object.freeze([]) });
  }

  const records = normalized.split(/\r?\n/);
  if (records.length > MAX_WINDOW_RECORDS) {
    return invalidSnapshot();
  }

  const windows: ScreenRect[] = [];
  for (const record of records) {
    const fields = record.split(",");
    if (fields.length !== 4 || fields.some((field) => !/^-?\d+$/.test(field))) {
      return invalidSnapshot();
    }

    const values = fields.map((field) => Number(field));
    const [x, y, width, height] = values;
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      !values.every(Number.isSafeInteger)
    ) {
      return invalidSnapshot();
    }

    const bounds = { x, y, width, height };
    if (!isValidRect(bounds)) {
      return invalidSnapshot();
    }
    windows.push(Object.freeze(bounds));
  }

  return Object.freeze({ status: "valid", windows: Object.freeze(windows) });
}

export function selectPrometheeTimerWindow(
  snapshot: ParsedWindowSnapshot,
  workAreas: readonly ScreenRect[]
): TimerWindowSelection {
  if (
    snapshot.status !== "valid" ||
    workAreas.length === 0 ||
    workAreas.length > 32 ||
    workAreas.some((workArea) => !isValidRect(workArea))
  ) {
    return Object.freeze({ status: "invalid", candidateCount: 0 });
  }

  const candidates = snapshot.windows.filter(
    (windowBounds) => isTimerShape(windowBounds) && isContainedByAnyWorkArea(windowBounds, workAreas)
  );

  if (candidates.length === 0) {
    return Object.freeze({ status: "not-found", candidateCount: 0 });
  }
  if (candidates.length !== 1) {
    return Object.freeze({ status: "ambiguous", candidateCount: candidates.length });
  }

  return Object.freeze({ status: "found", bounds: candidates[0]! });
}

export function normalizePrometheeWindowSnapshot(
  snapshot: ParsedWindowSnapshot,
  normalizeBounds: WindowBoundsNormalizer
): ParsedWindowSnapshot {
  if (snapshot.status !== "valid") return invalidSnapshot();
  const windows: ScreenRect[] = [];
  try {
    for (const bounds of snapshot.windows) {
      const normalized = normalizeBounds(bounds);
      if (normalized === null || !isValidRect(normalized)) return invalidSnapshot();
      windows.push(Object.freeze({ ...normalized }));
    }
  } catch {
    return invalidSnapshot();
  }
  return Object.freeze({ status: "valid", windows: Object.freeze(windows) });
}

export function createCalibrationOutlineBounds(timerBounds: ScreenRect): ScreenRect | null {
  if (!isTimerShape(timerBounds)) {
    return null;
  }

  return Object.freeze({
    x: timerBounds.x - OUTLINE_OUTSET,
    y: timerBounds.y - OUTLINE_OUTSET,
    width: timerBounds.width + OUTLINE_OUTSET * 2,
    height: timerBounds.height + OUTLINE_OUTSET * 2
  });
}

export function locatePrometheeTimerWindow(
  workAreas: readonly ScreenRect[],
  signal?: AbortSignal,
  normalizeBounds?: WindowBoundsNormalizer
): Promise<TimerWindowLookupResult> {
  return readNativeWindowSnapshot(signal).then(
    (snapshot) => selectPrometheeTimerWindow(
      normalizeBounds === undefined ? snapshot : normalizePrometheeWindowSnapshot(snapshot, normalizeBounds),
      workAreas
    ),
    () => Object.freeze({ status: "lookup-error" as const, candidateCount: 0 as const })
  );
}

export function locatePrometheeTimerContext(
  workAreas: readonly ScreenRect[],
  signal?: AbortSignal,
  normalizeBounds?: WindowBoundsNormalizer
): Promise<TimerWindowContextLookupResult> {
  return readNativeWindowSnapshot(signal).then(
    (rawSnapshot) => {
      const snapshot = normalizeBounds === undefined
        ? rawSnapshot
        : normalizePrometheeWindowSnapshot(rawSnapshot, normalizeBounds);
      const selection = selectPrometheeTimerWindow(snapshot, workAreas);
      if (selection.status !== "found") {
        return selection;
      }
      if (snapshot.status !== "valid") {
        return Object.freeze({ status: "invalid" as const, candidateCount: 0 as const });
      }

      const exclusions = snapshot.windows.filter(
        (bounds) =>
          !sameRect(bounds, selection.bounds) &&
          bounds.width <= 500 &&
          bounds.height <= 600
      );
      return Object.freeze({
        status: "found" as const,
        bounds: selection.bounds,
        exclusions: Object.freeze(exclusions)
      });
    },
    () => Object.freeze({ status: "lookup-error" as const, candidateCount: 0 as const })
  );
}

async function readNativeWindowSnapshot(signal?: AbortSignal): Promise<ParsedWindowSnapshot> {
  const executable = nativeBridgeExecutable();
  if (executable === null) throw new Error("Native Promethee bridge is unavailable.");
  const execution = await executeNativeBridge({
    args: Object.freeze(["windows"]),
    executable,
    maxBufferBytes: LOOKUP_MAX_BUFFER_BYTES,
    ...(signal === undefined ? {} : { signal }),
    timeoutMs: LOOKUP_TIMEOUT_MS
  });
  return parsePrometheeWindowSnapshot(execution.stdout);
}

function invalidSnapshot(): ParsedWindowSnapshot {
  return Object.freeze({ status: "invalid", windows: Object.freeze([] as const) });
}

function isTimerShape(bounds: ScreenRect): boolean {
  return (
    isValidRect(bounds) &&
    bounds.height === TIMER_HEIGHT &&
    bounds.width >= TIMER_MIN_WIDTH &&
    bounds.width <= TIMER_MAX_WIDTH
  );
}

function isValidRect(bounds: ScreenRect): boolean {
  return (
    Number.isSafeInteger(bounds.x) &&
    Number.isSafeInteger(bounds.y) &&
    Number.isSafeInteger(bounds.width) &&
    Number.isSafeInteger(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    Number.isSafeInteger(bounds.x + bounds.width) &&
    Number.isSafeInteger(bounds.y + bounds.height)
  );
}

function isContainedByAnyWorkArea(bounds: ScreenRect, workAreas: readonly ScreenRect[]): boolean {
  return workAreas.some(
    (workArea) =>
      bounds.x >= workArea.x &&
      bounds.y >= workArea.y &&
      bounds.x + bounds.width <= workArea.x + workArea.width &&
      bounds.y + bounds.height <= workArea.y + workArea.height
  );
}

function sameRect(first: ScreenRect, second: ScreenRect): boolean {
  return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}
