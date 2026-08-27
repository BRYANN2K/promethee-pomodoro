import {
  executeNativeBridge,
  nativeBridgeExecutable,
  nativeClickTimeoutMs,
  supportsNativeAutomation,
  type NativeBridgeExecutionRequest,
  type NativeBridgeExecutor
} from "./native-promethee-bridge.ts";

const COMMAND_MAX_BUFFER_BYTES = 4 * 1024;
const MAX_RECEIPT_BYTES = 64;
const MAX_CONTROL_RING_MEAN_DELTA = 0.12;
// How far the bars of a Pause glyph may sit from the offset that went looking for
// them and still be that control rather than the next one along. The controls are
// 32 pixels apart, so anything past this is a different glyph.
const MAX_PAUSE_GLYPH_DRIFT = 2;
const SAMPLE_OFFSETS = Object.freeze([
  [-8, 0], [8, 0], [0, -8], [0, 8],
  [-6, -6], [6, -6], [-6, 6], [6, 6]
] as const);

export type PrometheeControlAction = "pause" | "resume";
export type PrometheeObservedState = "paused" | "running";

export type PrometheeControlFailureReason =
  | "aborted"
  | "authority-changed"
  | "authority-error"
  | "authority-unavailable"
  | "capture-error"
  | "capture-unavailable"
  | "click-failed"
  | "execution-error"
  | "invalid-action"
  | "invalid-authority"
  | "invalid-receipt"
  | "layout-unsupported"
  | "permission-denied"
  | "process-ambiguous"
  | "process-changed"
  | "process-not-found"
  | "reconciliation-required"
  | "state-mismatch"
  | "timer-ambiguous"
  | "timer-not-found"
  | "target-mismatch"
  | "unsupported-platform"
  // Linux only. The window server the helper reads geometry from failed to
  // answer, so the helper could not re-verify the target and never pressed
  // anything. It is a different thing from finding no window, and treating it
  // as an unreadable receipt would leave a reconciliation pending over a click
  // that provably did not happen.
  | "window-list-incomplete";

export type PrometheeControlResult =
  | {
      readonly action: PrometheeControlAction;
      readonly execution: "sent-unconfirmed";
      readonly observation: "none";
      readonly status: "pressed";
    }
  | {
      readonly action: PrometheeControlAction | null;
      readonly execution: "indeterminate" | "not-sent";
      readonly reason: PrometheeControlFailureReason;
      readonly status: "failed";
    };

export type NativeInputExecutionRequest = NativeBridgeExecutionRequest;
export type NativeInputExecutor = NativeBridgeExecutor;

export interface HudPixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PrometheeHudRaster {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly height: number;
  readonly width: number;
}

export interface PrometheeHudCaptureSnapshot {
  readonly bounds: HudPixelRect;
  readonly generation: number;
  readonly hudId: string;
  readonly processId: number;
  readonly raster: PrometheeHudRaster;
}

export type PrometheeHudCapture = (
  signal?: AbortSignal
) => Promise<PrometheeHudCaptureSnapshot>;

export interface PrometheeSessionSample {
  readonly observedAtMs: number;
  readonly sessionId: string;
  readonly sessionState: PrometheeObservedState;
  readonly source: "sqlite-observation";
}

export interface PrometheeControlObservation extends PrometheeSessionSample {
  readonly generation: number;
  readonly hudId: string;
  readonly processId: number;
}

export type PrometheeControlAuthorityReader = (
  signal?: AbortSignal
) => Promise<PrometheeControlObservation>;

export type PrometheeControlReconciliationResult =
  | { readonly status: "reconciled" }
  | {
      readonly reason:
        | "aborted"
        | "authority-error"
        | "authority-unavailable"
        | "capture-error"
        | "capture-unavailable"
        | "identity-mismatch"
        | "invalid-authority"
        | "invalid-observation"
        | "layout-unsupported"
        | "not-pending"
        | "session-mismatch"
        | "stale-observation"
        | "state-mismatch";
      readonly status: "failed";
    };

export interface NativePrometheeControlOptions {
  readonly authority?: PrometheeControlAuthorityReader;
  readonly capture?: PrometheeHudCapture;
  readonly executor?: NativeInputExecutor;
  readonly platform?: NodeJS.Platform;
}

export type PrometheeHudClassification =
  | {
      readonly controls: readonly HudPixelRect[];
      readonly state: PrometheeObservedState;
      readonly status: "classified";
    }
  | { readonly status: "unsupported" };

export type PrometheeHudActionPlan =
  | {
      readonly action: PrometheeControlAction;
      readonly expectedState: PrometheeObservedState;
      readonly status: "ready";
      readonly target: HudPixelRect;
    }
  | {
      readonly action: PrometheeControlAction;
      readonly reason: "layout-unsupported" | "state-mismatch";
      readonly status: "failed";
    };

interface PendingReconciliation {
  readonly action: PrometheeControlAction;
  readonly expectedState: PrometheeObservedState;
  readonly generation: number;
  readonly hudId: string;
  readonly priorObservedAtMs: number;
  readonly processId: number;
  readonly sessionId: string;
}

export class NativePrometheeControl {
  private readonly authority: PrometheeControlAuthorityReader | null;
  private readonly capture: PrometheeHudCapture | null;
  private readonly executor: NativeInputExecutor;
  private readonly platform: NodeJS.Platform;
  private pending: PendingReconciliation | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: NativePrometheeControlOptions = {}) {
    this.authority = options.authority ?? null;
    this.capture = options.capture ?? null;
    this.executor = options.executor ?? executeNativeBridge;
    this.platform = options.platform ?? process.platform;
  }

  press(action: PrometheeControlAction, signal?: AbortSignal): Promise<PrometheeControlResult> {
    return this.enqueue(() => this.execute(action, signal));
  }

  pressPause(signal?: AbortSignal): Promise<PrometheeControlResult> {
    return this.press("pause", signal);
  }

  pressResume(signal?: AbortSignal): Promise<PrometheeControlResult> {
    return this.press("resume", signal);
  }

  reconcile(observation: PrometheeControlObservation, signal?: AbortSignal): Promise<PrometheeControlReconciliationResult> {
    return this.enqueue(() => this.applyReconciliation(observation, signal));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.queue.then(operation);
    this.queue = current.then(() => undefined, () => undefined);
    return current;
  }

  private async execute(
    candidateAction: PrometheeControlAction,
    signal?: AbortSignal
  ): Promise<PrometheeControlResult> {
    const action = validAction(candidateAction) ? candidateAction : null;
    if (action === null) return failed(null, "invalid-action", "not-sent");
    if (this.pending !== null) return failed(action, "reconciliation-required", "not-sent");
    if (!supportsNativeAutomation(this.platform)) return failed(action, "unsupported-platform", "not-sent");
    const executable = nativeBridgeExecutable(this.platform);
    if (executable === null) return failed(action, "unsupported-platform", "not-sent");
    if (isSignalAborted(signal)) return failed(action, "aborted", "not-sent");
    if (this.authority === null) return failed(action, "authority-unavailable", "not-sent");
    if (this.capture === null) return failed(action, "capture-unavailable", "not-sent");

    const expectedBeforeState = action === "pause" ? "running" : "paused";
    const authorityBefore = await this.readAuthority(action, signal);
    if ("status" in authorityBefore) return authorityBefore;
    if (authorityBefore.sessionState !== expectedBeforeState) return failed(action, "state-mismatch", "not-sent");

    let firstCapture: PrometheeHudCaptureSnapshot;
    try {
      firstCapture = await this.capture(signal);
    } catch {
      return failed(action, isSignalAborted(signal) ? "aborted" : "capture-error", "not-sent");
    }
    if (isSignalAborted(signal)) return failed(action, "aborted", "not-sent");
    if (!isCaptureSnapshot(firstCapture)) return failed(action, "layout-unsupported", "not-sent");
    if (!sameHudIdentity(firstCapture, authorityBefore)) return failed(action, "authority-changed", "not-sent");
    const firstPlan = planPrometheeHudAction(classifyPrometheeHudRaster(firstCapture.raster), action);
    if (firstPlan.status === "failed") return failed(action, firstPlan.reason, "not-sent");

    const finalAuthority = await this.readAuthority(action, signal);
    if ("status" in finalAuthority) return finalAuthority;
    if (
      finalAuthority.sessionState !== expectedBeforeState ||
      !sameAuthoritySnapshot(authorityBefore, finalAuthority) ||
      !sameHudIdentity(firstCapture, finalAuthority)
    ) {
      return failed(action, "authority-changed", "not-sent");
    }
    if (isSignalAborted(signal)) return failed(action, "aborted", "not-sent");

    let finalCapture: PrometheeHudCaptureSnapshot;
    try {
      finalCapture = await this.capture(signal);
    } catch {
      return failed(action, isSignalAborted(signal) ? "aborted" : "capture-error", "not-sent");
    }
    if (
      isSignalAborted(signal) ||
      !isCaptureSnapshot(finalCapture) ||
      !sameCaptureGeometry(firstCapture, finalCapture) ||
      !sameHudIdentity(finalCapture, finalAuthority)
    ) {
      return failed(action, isSignalAborted(signal) ? "aborted" : "authority-changed", "not-sent");
    }
    const finalClassification = classifyPrometheeHudRaster(finalCapture.raster);
    const finalPlan = planPrometheeHudAction(finalClassification, action);
    if (finalPlan.status === "failed") return failed(action, finalPlan.reason, "not-sent");

    const targetX = finalCapture.bounds.x + finalPlan.target.x + finalPlan.target.width / 2;
    const targetY = finalCapture.bounds.y + finalPlan.target.y + finalPlan.target.height / 2;
    let result: PrometheeControlResult;
    try {
      const execution = await this.executor({
        args: Object.freeze([
          "click",
          action,
          finalPlan.expectedState,
          String(finalCapture.processId),
          String(finalCapture.bounds.x),
          String(finalCapture.bounds.y),
          String(finalCapture.bounds.width),
          String(finalCapture.bounds.height),
          String(finalCapture.generation),
          String(targetX),
          String(targetY),
          String(finalClassification.status === "classified" ? finalClassification.controls.length : 0)
        ]),
        executable,
        maxBufferBytes: COMMAND_MAX_BUFFER_BYTES,
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: nativeClickTimeoutMs(this.platform)
      });
      result = parsePrometheeNativeReceipt(execution.stdout, action, finalCapture.generation);
    } catch {
      result = failed(action, isSignalAborted(signal) ? "aborted" : "execution-error", "indeterminate");
    }

    if (result.status === "pressed" || result.execution === "indeterminate") {
      this.pending = Object.freeze({
        action,
        expectedState: action === "pause" ? "paused" : "running",
        generation: finalCapture.generation,
        hudId: finalCapture.hudId,
        priorObservedAtMs: finalAuthority.observedAtMs,
        processId: finalCapture.processId,
        sessionId: finalAuthority.sessionId
      });
    }
    return result;
  }

  private async readAuthority(
    action: PrometheeControlAction,
    signal?: AbortSignal
  ): Promise<PrometheeControlObservation | PrometheeControlResult> {
    if (this.authority === null) return failed(action, "authority-unavailable", "not-sent");
    try {
      const authority = await this.authority(signal);
      if (isSignalAborted(signal)) return failed(action, "aborted", "not-sent");
      if (!isControlObservation(authority)) return failed(action, "invalid-authority", "not-sent");
      return authority;
    } catch {
      return failed(action, isSignalAborted(signal) ? "aborted" : "authority-error", "not-sent");
    }
  }

  private async applyReconciliation(
    observation: PrometheeControlObservation,
    signal?: AbortSignal
  ): Promise<PrometheeControlReconciliationResult> {
    const pending = this.pending;
    if (pending === null) return reconciliationFailed("not-pending");
    if (!isControlObservation(observation)) return reconciliationFailed("invalid-observation");
    if (isSignalAborted(signal)) return reconciliationFailed("aborted");
    if (
      observation.processId !== pending.processId ||
      observation.hudId !== pending.hudId ||
      observation.generation < pending.generation
    ) {
      return reconciliationFailed("identity-mismatch");
    }
    if (observation.sessionId !== pending.sessionId) return reconciliationFailed("session-mismatch");
    if (observation.observedAtMs <= pending.priorObservedAtMs) return reconciliationFailed("stale-observation");
    if (observation.sessionState !== pending.expectedState) return reconciliationFailed("state-mismatch");
    if (this.capture === null) return reconciliationFailed("capture-unavailable");

    let capture: PrometheeHudCaptureSnapshot;
    try {
      capture = await this.capture(signal);
    } catch {
      return reconciliationFailed(isSignalAborted(signal) ? "aborted" : "capture-error");
    }
    if (isSignalAborted(signal)) return reconciliationFailed("aborted");
    if (!isCaptureSnapshot(capture)) return reconciliationFailed("layout-unsupported");
    if (
      capture.processId !== observation.processId ||
      capture.hudId !== observation.hudId ||
      capture.generation !== observation.generation
    ) {
      return reconciliationFailed("identity-mismatch");
    }
    const classification = classifyPrometheeHudRaster(capture.raster);
    if (classification.status !== "classified") return reconciliationFailed("layout-unsupported");
    if (classification.state !== pending.expectedState) return reconciliationFailed("state-mismatch");

    const authorityAfter = await this.readReconciliationAuthority(signal);
    if ("status" in authorityAfter) return authorityAfter;
    if (
      authorityAfter.processId !== observation.processId ||
      authorityAfter.hudId !== observation.hudId ||
      authorityAfter.generation !== observation.generation
    ) {
      return reconciliationFailed("identity-mismatch");
    }
    if (authorityAfter.sessionId !== pending.sessionId) return reconciliationFailed("session-mismatch");
    if (
      authorityAfter.observedAtMs < observation.observedAtMs ||
      authorityAfter.observedAtMs <= pending.priorObservedAtMs
    ) {
      return reconciliationFailed("stale-observation");
    }
    if (authorityAfter.sessionState !== pending.expectedState) return reconciliationFailed("state-mismatch");
    this.pending = null;
    return Object.freeze({ status: "reconciled" });
  }

  private async readReconciliationAuthority(
    signal?: AbortSignal
  ): Promise<PrometheeControlObservation | PrometheeControlReconciliationResult> {
    if (this.authority === null) return reconciliationFailed("authority-unavailable");
    try {
      const authority = await this.authority(signal);
      if (isSignalAborted(signal)) return reconciliationFailed("aborted");
      if (!isControlObservation(authority)) return reconciliationFailed("invalid-authority");
      return authority;
    } catch {
      return reconciliationFailed(isSignalAborted(signal) ? "aborted" : "authority-error");
    }
  }
}

function reconciliationFailed(
  reason: Exclude<PrometheeControlReconciliationResult, { readonly status: "reconciled" }>["reason"]
): PrometheeControlReconciliationResult {
  return Object.freeze({ reason, status: "failed" });
}

export function parsePrometheeNativeReceipt(
  stdout: unknown,
  expectedAction: PrometheeControlAction,
  expectedGeneration: number
): PrometheeControlResult {
  if (
    typeof stdout !== "string" ||
    Buffer.byteLength(stdout, "utf8") > MAX_RECEIPT_BYTES ||
    !validAction(expectedAction) ||
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 0
  ) {
    return failed(validAction(expectedAction) ? expectedAction : null, "invalid-receipt", "indeterminate");
  }
  const receipt = stdout.trim();
  if (receipt === `clicked-unconfirmed,${expectedAction},${expectedGeneration}`) {
    return Object.freeze({ action: expectedAction, execution: "sent-unconfirmed", observation: "none", status: "pressed" });
  }
  const knownNotSentFailures = new Set<PrometheeControlFailureReason>([
    "invalid-action", "permission-denied", "process-ambiguous", "process-changed",
    "process-not-found", "state-mismatch", "target-mismatch", "timer-ambiguous", "timer-not-found",
    "window-list-incomplete"
  ]);
  if (knownNotSentFailures.has(receipt as PrometheeControlFailureReason)) {
    return failed(expectedAction, receipt as PrometheeControlFailureReason, "not-sent");
  }
  if (receipt === "click-failed") return failed(expectedAction, "click-failed", "indeterminate");
  return failed(expectedAction, "invalid-receipt", "indeterminate");
}

export function classifyPrometheeHudRaster(raster: PrometheeHudRaster): PrometheeHudClassification {
  if (!isRaster(raster)) return Object.freeze({ status: "unsupported" });
  const maxX = raster.width - 1;
  const right = sampleRing(raster, maxX - 18, 16);
  const middle = sampleRing(raster, maxX - 50, 16);
  const optional = sampleRing(raster, maxX - 82, 16);
  if (
    right === null || middle === null || optional === null ||
    right.range > 0.05 || middle.range > 0.05 ||
    Math.abs(right.mean - middle.mean) > MAX_CONTROL_RING_MEAN_DELTA
  ) return Object.freeze({ status: "unsupported" });
  const baseMean = (right.mean + middle.mean) / 2;
  if (
    optional.range <= 0.05 &&
    (isPlayGlyph(raster, maxX - 82, 16, optional.mean) ||
      isNarrowPlayGlyph(raster, maxX - 82, 16, optional.mean))
  ) {
    return classified("paused", [controlRect(maxX - 82), controlRect(maxX - 50), controlRect(maxX - 18)]);
  }
  if (baseMean - optional.mean >= 0.10) {
    if (
      !isPauseGlyph(raster, maxX - 50, 16, middle.mean) &&
      !isPauseGlyphOffCenter(raster, maxX - 50, 16, middle.mean)
    ) return Object.freeze({ status: "unsupported" });
    return classified("running", [controlRect(maxX - 50), controlRect(maxX - 18)]);
  }
  return Object.freeze({ status: "unsupported" });
}

export function planPrometheeHudAction(
  classification: PrometheeHudClassification,
  action: PrometheeControlAction
): PrometheeHudActionPlan {
  if (classification.status !== "classified") return Object.freeze({ action, reason: "layout-unsupported", status: "failed" });
  const expectedState = action === "pause" ? "running" : "paused";
  if (classification.state !== expectedState) return Object.freeze({ action, reason: "state-mismatch", status: "failed" });
  return Object.freeze({ action, expectedState, status: "ready", target: classification.controls[0]! });
}

function classified(state: PrometheeObservedState, controls: readonly HudPixelRect[]): PrometheeHudClassification {
  return Object.freeze({ controls: Object.freeze(controls.map((rect) => Object.freeze(rect))), state, status: "classified" });
}

function controlRect(centerX: number): HudPixelRect {
  return { x: centerX - 14, y: 2, width: 28, height: 28 };
}

function isPauseGlyph(raster: PrometheeHudRaster, centerX: number, centerY: number, backgroundMean: number): boolean {
  const brightNeutral: Array<{ readonly x: number; readonly y: number }> = [];
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
      const pixel = readPixel(raster, centerX + offsetX, centerY + offsetY);
      if (
        pixel !== null && pixel.luminance >= backgroundMean + 0.25 &&
        Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue) <= 0.15
      ) brightNeutral.push({ x: offsetX, y: offsetY });
    }
  }
  const left = brightNeutral.filter((pixel) => pixel.x <= -2);
  const gap = brightNeutral.filter((pixel) => pixel.x >= -1 && pixel.x <= 0);
  const right = brightNeutral.filter((pixel) => pixel.x >= 1);
  return isVerticalBar(left) && isVerticalBar(right) && gap.length <= 1 &&
    Math.abs(minimumCoordinate(left, "y") - minimumCoordinate(right, "y")) <= 2 &&
    Math.abs(maximumCoordinate(left, "y") - maximumCoordinate(right, "y")) <= 2;
}

// Reached only once the test above has said no, so it can widen what counts as a
// Pause and never narrow it. The centre it is given is counted back from the HUD's
// right edge, and a HUD whose width puts the control on a half pixel leaves that
// count a pixel short: the ring test tolerates it, the gap bucket does not, and a
// bar falls into the gap. So the same shape is asked of the bars' own midpoint,
// bounded so it cannot wander onto the control next door. Measured on Hyprland at
// a HUD width of 145: bars at 92, 93, 96 and 97, midpoint 94.5, offset 94.
//
// The control does not move with it. The target stays the offset, which is what
// the native helpers recompute from the window they are pressing and the only
// value they accept.
function isPauseGlyphOffCenter(
  raster: PrometheeHudRaster,
  centerX: number,
  centerY: number,
  backgroundMean: number
): boolean {
  const brightNeutral: Array<{ readonly x: number; readonly y: number }> = [];
  // One column wider each way than the bars can reach, so a glyph sitting a pixel
  // off the offset is measured whole rather than clipped at the edge.
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -7; offsetX <= 7; offsetX += 1) {
      const pixel = readPixel(raster, centerX + offsetX, centerY + offsetY);
      if (
        pixel !== null && pixel.luminance >= backgroundMean + 0.25 &&
        Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue) <= 0.15
      ) brightNeutral.push({ x: offsetX, y: offsetY });
    }
  }
  if (brightNeutral.length === 0) return false;
  // A half pixel whenever the glyph spans an even number of columns, which is the
  // whole of the case this exists for.
  const middle = (minimumCoordinate(brightNeutral, "x") + maximumCoordinate(brightNeutral, "x")) / 2;
  if (Math.abs(middle) > MAX_PAUSE_GLYPH_DRIFT) return false;
  const left = brightNeutral.filter((pixel) => pixel.x < middle - 1);
  const gap = brightNeutral.filter((pixel) => Math.abs(pixel.x - middle) <= 1);
  const right = brightNeutral.filter((pixel) => pixel.x > middle + 1);
  return isVerticalBar(left) && isVerticalBar(right) && gap.length <= 1 &&
    Math.abs(minimumCoordinate(left, "y") - minimumCoordinate(right, "y")) <= 2 &&
    Math.abs(maximumCoordinate(left, "y") - maximumCoordinate(right, "y")) <= 2;
}

function isVerticalBar(pixels: ReadonlyArray<{ readonly x: number; readonly y: number }>): boolean {
  if (pixels.length < 8 || pixels.length > 36) return false;
  const width = maximumCoordinate(pixels, "x") - minimumCoordinate(pixels, "x") + 1;
  const height = maximumCoordinate(pixels, "y") - minimumCoordinate(pixels, "y") + 1;
  return width >= 1 && width <= 3 && height >= 7 && height <= 13;
}

function isPlayGlyph(raster: PrometheeHudRaster, centerX: number, centerY: number, backgroundMean: number): boolean {
  const orange: Array<{ readonly x: number; readonly y: number }> = [];
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
      const pixel = readPixel(raster, centerX + offsetX, centerY + offsetY);
      if (
        pixel !== null && pixel.luminance >= backgroundMean + 0.12 && pixel.red >= 0.65 &&
        pixel.red - pixel.green >= 0.18 && pixel.green - pixel.blue >= 0.08
      ) orange.push({ x: offsetX, y: offsetY });
    }
  }
  if (orange.length < 8 || orange.length > 60) return false;
  const width = maximumCoordinate(orange, "x") - minimumCoordinate(orange, "x") + 1;
  const height = maximumCoordinate(orange, "y") - minimumCoordinate(orange, "y") + 1;
  const leftCount = orange.filter((pixel) => pixel.x <= -2).length;
  const middleCount = orange.filter((pixel) => Math.abs(pixel.x) <= 1).length;
  const rightCount = orange.filter((pixel) => pixel.x >= 2).length;
  const meanY = orange.reduce((sum, pixel) => sum + pixel.y, 0) / orange.length;
  return width >= 5 && width <= 11 && height >= 7 && height <= 13 &&
    leftCount >= 4 && middleCount >= 3 && rightCount >= 1 && leftCount >= rightCount * 1.4 && Math.abs(meanY) <= 1.25;
}

// Reached only once the test above has said no, so it can widen what counts as a
// Play and never narrow it. That test counts pixels in buckets pinned two columns
// either side of the control centre, which separates the flat edge from the point
// on a triangle ten columns wide and cuts straight through one that is six. The
// same balance is asked here of the glyph's own bounding box, so a narrow triangle
// is weighed against itself rather than against a width it does not have.
//
// Measured on Hyprland at a HUD width of 191: 31 pixels, 6 columns by 7 rows, mass
// a little above centre, and 6 against 6 in the pinned buckets where the balance
// wants 1.4 to 1. Against its own box the same 31 pixels read 19 against 12.
function isNarrowPlayGlyph(
  raster: PrometheeHudRaster,
  centerX: number,
  centerY: number,
  backgroundMean: number
): boolean {
  const orange: Array<{ readonly x: number; readonly y: number }> = [];
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
      const pixel = readPixel(raster, centerX + offsetX, centerY + offsetY);
      if (
        pixel !== null && pixel.luminance >= backgroundMean + 0.12 && pixel.red >= 0.65 &&
        pixel.red - pixel.green >= 0.18 && pixel.green - pixel.blue >= 0.08
      ) orange.push({ x: offsetX, y: offsetY });
    }
  }
  if (orange.length < 8 || orange.length > 60) return false;
  const firstX = minimumCoordinate(orange, "x");
  const lastX = maximumCoordinate(orange, "x");
  const width = lastX - firstX + 1;
  const height = maximumCoordinate(orange, "y") - minimumCoordinate(orange, "y") + 1;
  if (width < 5 || width > 11 || height < 7 || height > 13) return false;
  // A triangle is solid between its flat edge and its point, so a column with
  // nothing in it means these pixels are two shapes rather than one glyph. The
  // pinned buckets never had to ask, because a gap that wide could not pass them.
  for (let column = firstX; column <= lastX; column += 1) {
    if (!orange.some((pixel) => pixel.x === column)) return false;
  }
  // The middle column of an odd width belongs to neither half.
  const middle = (firstX + lastX) / 2;
  const nearEdge = orange.filter((pixel) => pixel.x < middle).length;
  const nearPoint = orange.filter((pixel) => pixel.x > middle).length;
  const meanY = orange.reduce((sum, pixel) => sum + pixel.y, 0) / orange.length;
  return nearEdge >= 4 && nearPoint >= 1 && nearEdge >= nearPoint * 1.4 && Math.abs(meanY) <= 1.25;
}

function readPixel(
  raster: PrometheeHudRaster,
  x: number,
  y: number
): { readonly blue: number; readonly green: number; readonly luminance: number; readonly red: number } | null {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
  const offset = (y * raster.width + x) * 4;
  const red = raster.data[offset];
  const green = raster.data[offset + 1];
  const blue = raster.data[offset + 2];
  const alpha = raster.data[offset + 3];
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined || alpha < 230) return null;
  return Object.freeze({ blue: blue / 255, green: green / 255, luminance: (red + green + blue) / (3 * 255), red: red / 255 });
}

function minimumCoordinate(
  pixels: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  coordinate: "x" | "y"
): number {
  return Math.min(...pixels.map((pixel) => pixel[coordinate]));
}

function maximumCoordinate(
  pixels: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  coordinate: "x" | "y"
): number {
  return Math.max(...pixels.map((pixel) => pixel[coordinate]));
}

function sampleRing(
  raster: PrometheeHudRaster,
  centerX: number,
  centerY: number
): { readonly mean: number; readonly range: number } | null {
  const samples: number[] = [];
  for (const [offsetX, offsetY] of SAMPLE_OFFSETS) {
    const x = centerX + offsetX;
    const y = centerY + offsetY;
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
    const offset = (y * raster.width + x) * 4;
    const red = raster.data[offset];
    const green = raster.data[offset + 1];
    const blue = raster.data[offset + 2];
    const alpha = raster.data[offset + 3];
    if (red === undefined || green === undefined || blue === undefined || alpha === undefined || alpha < 230) return null;
    samples.push((red + green + blue) / (3 * 255));
  }
  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  return Object.freeze({ mean: samples.reduce((sum, value) => sum + value, 0) / samples.length, range: maximum - minimum });
}

function isRaster(raster: unknown): raster is PrometheeHudRaster {
  if (!hasExactKeys(raster, ["data", "height", "width"])) return false;
  return Number.isSafeInteger(raster.width) && (raster.width as number) >= 120 && (raster.width as number) <= 220 &&
    raster.height === 32 && (raster.data instanceof Uint8Array || raster.data instanceof Uint8ClampedArray) &&
    raster.data.length === (raster.width as number) * (raster.height as number) * 4;
}

function isCaptureSnapshot(snapshot: unknown): snapshot is PrometheeHudCaptureSnapshot {
  if (!hasExactKeys(snapshot, ["bounds", "generation", "hudId", "processId", "raster"])) return false;
  return Number.isSafeInteger(snapshot.processId) && (snapshot.processId as number) > 0 &&
    Number.isSafeInteger(snapshot.generation) && (snapshot.generation as number) >= 0 &&
    typeof snapshot.hudId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(snapshot.hudId) &&
    isPixelRect(snapshot.bounds) && isRaster(snapshot.raster) &&
    snapshot.bounds.width === snapshot.raster.width && snapshot.bounds.height === snapshot.raster.height;
}

function isControlObservation(observation: unknown): observation is PrometheeControlObservation {
  return hasExactKeys(observation, [
    "generation", "hudId", "observedAtMs", "processId", "sessionId", "sessionState", "source"
  ]) && isSessionAuthorityFields(observation) &&
    Number.isSafeInteger(observation.processId) && (observation.processId as number) > 0 &&
    Number.isSafeInteger(observation.generation) && (observation.generation as number) >= 0 && isBoundedIdentifier(observation.hudId);
}

function sameAuthoritySnapshot(left: PrometheeControlObservation, right: PrometheeControlObservation): boolean {
  return left.sessionId === right.sessionId && right.observedAtMs >= left.observedAtMs &&
    left.sessionState === right.sessionState && left.processId === right.processId &&
    left.hudId === right.hudId && left.generation === right.generation;
}

function sameCaptureGeometry(left: PrometheeHudCaptureSnapshot, right: PrometheeHudCaptureSnapshot): boolean {
  return left.processId === right.processId && left.hudId === right.hudId && left.generation === right.generation &&
    left.bounds.x === right.bounds.x && left.bounds.y === right.bounds.y &&
    left.bounds.width === right.bounds.width && left.bounds.height === right.bounds.height;
}

function sameHudIdentity(capture: PrometheeHudCaptureSnapshot, authority: PrometheeControlObservation): boolean {
  return capture.processId === authority.processId && capture.hudId === authority.hudId && capture.generation === authority.generation;
}

function isSessionAuthorityFields(authority: Record<string, unknown>): boolean {
  return authority.source === "sqlite-observation" && isBoundedIdentifier(authority.sessionId) &&
    Number.isSafeInteger(authority.observedAtMs) && (authority.observedAtMs as number) >= 0 &&
    (authority.sessionState === "paused" || authority.sessionState === "running");
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function isPixelRect(rect: unknown): rect is HudPixelRect {
  if (!hasExactKeys(rect, ["height", "width", "x", "y"])) return false;
  return Number.isSafeInteger(rect.x) && Number.isSafeInteger(rect.y) &&
    Number.isSafeInteger(rect.width) && (rect.width as number) > 0 &&
    Number.isSafeInteger(rect.height) && (rect.height as number) > 0 &&
    Number.isSafeInteger((rect.x as number) + (rect.width as number)) &&
    Number.isSafeInteger((rect.y as number) + (rect.height as number));
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function validAction(action: unknown): action is PrometheeControlAction {
  return action === "pause" || action === "resume";
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function failed(
  action: PrometheeControlAction | null,
  reason: PrometheeControlFailureReason,
  execution: "indeterminate" | "not-sent"
): PrometheeControlResult {
  return Object.freeze({ action, execution, reason, status: "failed" });
}
