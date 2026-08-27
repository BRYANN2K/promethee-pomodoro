// Wayland has no way for a client to say where its own window belongs, so the
// three attached surfaces arrive wherever the compositor decides and the plan
// that puts them on the real HUD is lost. The native helper asks the compositor
// for that placement over the same socket the HUD geometry is read from, and
// only for windows the compositor reports as owned by this process.
//
// Nothing here runs on macOS or Windows, where a window places itself.

import {
  executeNativeBridge,
  nativeBridgeExecutable,
  type NativeBridgeExecutor
} from "./native-promethee-bridge.ts";

const DEBUG_ATTACHMENT = process.env.PROMETHEE_POMODORO_DEBUG === "1";
// A placement the compositor could not carry out in full is asked for again on
// the next plan, because the usual reason is that a window has not been mapped
// yet. The count is bounded so a session that will never answer completely
// settles instead of asking once per poll forever.
const ATTACH_ATTEMPT_LIMIT = 10;
const ATTACH_RETRY_MS = 150;
// The helper reads the compositor over three bounded exchanges, so it is given
// longer than their sum to answer. A shorter budget would kill it mid-question
// and turn its own fail-closed answer into a signal that never arrives.
const ATTACH_TIMEOUT_MS = 1_500;
const ATTACH_MAX_BUFFER_BYTES = 4 * 1024;
const MAX_SURFACES = 8;
const MAX_TITLE_LENGTH = 128;
const MAX_COORDINATE = 1_000_000;
const HIDDEN = "hidden";

export type SurfaceInput = "interactive" | "transparent";

// What the app needs to know before it puts a surface on screen. Under Wayland
// a window is visible where the compositor dropped it long before it is visible
// where the plan wanted it, so showing one that is not yet `settled` shows it in
// the wrong place. `opaque` is a property of the session rather than of one
// request: it says this compositor has no way to take a box out of the running
// for the pointer, so a surface that needs that can never be shown here.
// `detached` says the asking is over and the placement never happened, so these
// surfaces sit wherever the compositor dropped them rather than beside the HUD.
// A surface whose whole meaning is its position is wrong there, not merely late.
export interface SurfacePlacement {
  readonly detached: boolean;
  readonly opaque: boolean;
  readonly settled: boolean;
}

export interface SurfacePosition {
  readonly x: number;
  readonly y: number;
}

export interface AttachedSurface {
  readonly input: SurfaceInput;
  readonly position: SurfacePosition | null;
  readonly title: string;
}

export interface SurfaceAttachment {
  readonly forget: () => void;
  readonly place: (surfaces: readonly (AttachedSurface | null)[]) => void;
}

interface AttachRequest {
  readonly args: readonly string[];
  readonly signature: string;
}

export interface SurfaceAttachmentOptions {
  readonly executable?: string | null;
  readonly executor?: NativeBridgeExecutor;
  readonly onPlacement?: (placement: SurfacePlacement) => void;
  readonly platform?: NodeJS.Platform;
  readonly retryDelayMs?: number;
}

export function supportsSurfaceAttachment(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
}

// Handed to the renderers of the sessions that wait for a placement, and to no
// others: a page that starts blank on a platform where a window places itself
// would be waiting for a message that platform never sends. A sandboxed preload
// reads it off `process.argv`, which is the only channel open to it before the
// document exists. `runtime-preload.cts` spells the same string, because a
// preload is loaded by the runtime rather than imported and cannot share this
// one; `Tests/electron/linux-surface-attachment.test.ts` holds the two together.
export const PLACEMENT_PENDING_ARGUMENT = "--promethee-placement-pending";

// A hidden surface is named in the signature and left out of the request: the
// helper places what the compositor still shows, and a surface that hides and
// comes back is placed again rather than mistaken for one that never moved.
export function surfaceAttachmentSignature(surfaces: readonly (AttachedSurface | null)[]): string | null {
  const request = normalizeSurfaces(surfaces);
  if (request === null) return null;
  return request
    .map((surface) =>
      surface.position === null
        ? `${surface.title}\u0000${HIDDEN}`
        : `${surface.title}\u0000${surface.position.x}\u0000${surface.position.y}\u0000${surface.input}`
    )
    .join("\u0001");
}

export function surfaceAttachmentArgs(
  surfaces: readonly (AttachedSurface | null)[]
): readonly string[] | null {
  const request = normalizeSurfaces(surfaces);
  if (request === null) return null;
  const args: string[] = ["attach"];
  for (const surface of request) {
    if (surface.position === null) continue;
    args.push(surface.title, String(surface.position.x), String(surface.position.y), surface.input);
  }
  return args.length === 1 ? null : Object.freeze(args);
}

export function createSurfaceAttachment(options: SurfaceAttachmentOptions = {}): SurfaceAttachment {
  const platform = options.platform ?? process.platform;
  if (!supportsSurfaceAttachment(platform)) return inertAttachment();
  const executable = options.executable === undefined
    ? nativeBridgeExecutable(platform)
    : options.executable;
  if (executable === null) return inertAttachment();
  const executor = options.executor ?? executeNativeBridge;
  const retryDelayMs = typeof options.retryDelayMs === "number" &&
    Number.isSafeInteger(options.retryDelayMs) &&
    options.retryDelayMs >= 0
    ? options.retryDelayMs
    : ATTACH_RETRY_MS;

  // `placed` is the last placement the helper reported carrying out in full,
  // and `asked` the last one it was given, which are the same thing only once
  // the compositor has agreed.
  let placed: string | null = null;
  let asked: string | null = null;
  let attempts = 0;
  let pending: AttachRequest | null = null;
  let retry: NodeJS.Timeout | null = null;
  let running = false;
  let unsupported = false;
  // Latched for the session: a compositor does not grow input transparency
  // between two placements, so once it has refused there is nothing to re-ask.
  let opaque = false;
  // A compositor that has been asked as often as it is going to be will not
  // place these surfaces at all. Holding every one of them back would take the
  // menu with them and leave the app with no control at all, so the asking ends
  // and the app is told the surfaces are detached rather than on their way.
  let exhausted = false;
  // Latched until the surfaces come down. The pages stay blank until the first
  // placement the compositor carries out, and no longer: every later one moves
  // windows that are already on screen, and blanking them again would take the
  // app off screen for the length of a drag over a placement it has already
  // proved it can do. A frame at the last agreed position beats no frame.
  let everSettled = false;
  let announced: SurfacePlacement | null = null;
  // Taking the surfaces down while the helper is still answering makes its
  // answer describe windows that no longer exist. The era it was asked in is
  // recorded so a late reply cannot record a placement that has been revoked.
  let era = 0;

  const cancelRetry = (): void => {
    if (retry === null) return;
    clearTimeout(retry);
    retry = null;
  };

  // A session with no compositor to ask has nothing to wait for. Everything
  // else starts unsettled and stays that way until the compositor has answered
  // for the plan currently on the table, so a surface is never shown on the
  // strength of a placement that was revoked or has not happened yet.
  const announce = (): void => {
    if (unsupported || exhausted || (asked !== null && placed === asked)) everSettled = true;
    const placement: SurfacePlacement = Object.freeze({
      detached: exhausted,
      opaque,
      settled: everSettled
    });
    if (
      announced !== null && announced.detached === placement.detached &&
      announced.opaque === placement.opaque && announced.settled === placement.settled
    ) {
      return;
    }
    announced = placement;
    options.onPlacement?.(placement);
  };

  // The plan is applied when it changes rather than on every poll, so a
  // placement that did not take has to ask for itself again.
  const scheduleRetry = (request: AttachRequest): void => {
    if (unsupported || request.signature !== asked) return;
    if (attempts >= ATTACH_ATTEMPT_LIMIT) { exhausted = true; announce(); return; }
    cancelRetry();
    retry = setTimeout(() => {
      retry = null;
      if (running || placed === request.signature || request.signature !== asked) return;
      attempts += 1;
      run(request);
    }, retryDelayMs);
    retry.unref();
  };

  const finish = (again: AttachRequest | null): void => {
    running = false;
    const queued = pending;
    pending = null;
    if (queued !== null) { run(queued); return; }
    if (again !== null) scheduleRetry(again);
  };

  const run = (request: AttachRequest): void => {
    const asOf = era;
    running = true;
    executor({
      args: request.args,
      executable,
      maxBufferBytes: ATTACH_MAX_BUFFER_BYTES,
      timeoutMs: ATTACH_TIMEOUT_MS
    }).then(
      (result) => {
        if (asOf !== era) { finish(null); return; }
        const receipt = result.stdout.trim();
        if (DEBUG_ATTACHMENT) {
          console.info(`[promethee-pomodoro] attach ${request.args.slice(1).join(" ")} -> ${receipt}`);
        }
        // An X11 session, or one with no compositor socket to ask, will never
        // answer differently, so it is asked once.
        if (receipt === "attach-unsupported") { unsupported = true; announce(); finish(null); return; }
        // A compositor with no per-window input transparency refused the
        // surfaces that asked for it and will refuse them again. This request is
        // as far as it will ever get, so it is recorded as answered and the app
        // is told to take those surfaces down rather than the ask being retried.
        if (receipt === refusedReceipt(request.args)) {
          opaque = true;
          placed = request.signature;
          announce();
          finish(null);
          return;
        }
        if (receipt === completeReceipt(request.args)) {
          placed = request.signature;
          announce();
          finish(null);
          return;
        }
        // A window the compositor has not mapped yet is named in the request and
        // absent from the answer, which is the ordinary case while the app is
        // still opening its surfaces.
        finish(request);
      },
      (error: unknown) => {
        if (asOf !== era) { finish(null); return; }
        if (DEBUG_ATTACHMENT) console.info(`[promethee-pomodoro] attach refused: ${String(error)}`);
        // A refused or interrupted call leaves the surfaces where they were, so
        // the same placement stays eligible for the next attempt.
        finish(request);
      }
    );
  };

  return Object.freeze({
    forget: (): void => {
      cancelRetry();
      era += 1;
      pending = null;
      placed = null;
      asked = null;
      attempts = 0;
      exhausted = false;
      // The surfaces are down, so the placement they come back to is one the
      // compositor has not carried out yet and the pages wait for it again.
      everSettled = false;
      announce();
    },
    place: (surfaces: readonly (AttachedSurface | null)[]): void => {
      if (unsupported) return;
      const signature = surfaceAttachmentSignature(surfaces);
      if (signature === null || signature === placed) return;
      if (signature === asked && attempts >= ATTACH_ATTEMPT_LIMIT) return;
      const args = surfaceAttachmentArgs(surfaces);
      // Nothing left to place is a placement that is already true.
      if (args === null) { cancelRetry(); asked = signature; placed = signature; announce(); return; }
      if (signature === asked) attempts += 1;
      else { cancelRetry(); asked = signature; attempts = 1; exhausted = false; }
      const request: AttachRequest = { args, signature };
      // The plan on the table is not the one the compositor last answered for,
      // so whatever the app was allowed to show it is not allowed to show now.
      announce();
      if (running) { pending = request; return; }
      run(request);
    }
  });
}

// The helper names how many of the surfaces it was given it actually placed, so
// a partial answer is told apart from a complete one without parsing it.
function completeReceipt(args: readonly string[]): string {
  const count = (args.length - 1) / 4;
  return `attached,${count},${count}`;
}

// A refusal carries the same counts under its own name, and the count it leaves
// out is exactly the surfaces that asked to be invisible to the pointer. Naming
// the whole receipt keeps a refusal from being read as a partial placement. A
// request that asked for no such surface has nothing that could be refused, so
// there is no receipt that would mean one and the answer is read as a placement.
function refusedReceipt(args: readonly string[]): string | null {
  const count = (args.length - 1) / 4;
  let transparent = 0;
  for (let index = 4; index < args.length; index += 4) {
    if (args[index] === "transparent") transparent += 1;
  }
  return transparent === 0 ? null : `attach-opaque,${count - transparent},${count}`;
}

function inertAttachment(): SurfaceAttachment {
  return Object.freeze({ forget: (): void => {}, place: (): void => {} });
}

function normalizeSurfaces(
  surfaces: readonly (AttachedSurface | null)[]
): readonly AttachedSurface[] | null {
  const request: AttachedSurface[] = [];
  for (const surface of surfaces) {
    if (surface === null) continue;
    if (!isPlaceableTitle(surface.title)) return null;
    if (request.some((existing) => existing.title === surface.title)) return null;
    if (surface.position !== null && !isPlaceablePosition(surface.position)) return null;
    request.push(surface);
  }
  return request.length === 0 || request.length > MAX_SURFACES ? null : Object.freeze(request);
}

function isPlaceableTitle(title: string): boolean {
  return typeof title === "string" &&
    title.length > 0 &&
    title.length <= MAX_TITLE_LENGTH &&
    !/[\u0000-\u001f"\\]/.test(title);
}

function isPlaceablePosition(position: SurfacePosition): boolean {
  return Number.isSafeInteger(position.x) &&
    Number.isSafeInteger(position.y) &&
    Math.abs(position.x) <= MAX_COORDINATE &&
    Math.abs(position.y) <= MAX_COORDINATE;
}
