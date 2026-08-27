import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  executeNativeBridge,
  nativeBridgeExecutable,
  type NativeBridgeExecutor
} from "./native-promethee-bridge.ts";
import type { PrometheeHudCaptureSnapshot } from "./promethee-control.ts";
import type { ScreenRect } from "./promethee-window-locator.ts";

// macOS reads the HUD by photographing the screen where the HUD is. Wayland has
// no such call, and the substitute is better rather than worse: the helper asks
// the compositor for the HUD's own surface, so what comes back is the window and
// nothing behind it. That matters here more than it would elsewhere, because the
// HUD is translucent and a screen rectangle would carry the user's wallpaper into
// the classifier's flatness gates.
// This module only ever runs on Linux, so this bound is Linux's alone and macOS
// keeps the 700 ms it had. It is above what the helper can spend on a read: the
// helper waits in loops that turn on an event arriving rather than on a count of
// round trips, and it bounds those with a deadline of its own. Waiting less than
// that deadline here would kill a read that was still inside its own budget and
// report a capture failure the session never had.
export const LINUX_CAPTURE_TIMEOUT_MS = 1_500;
const CAPTURE_TIMEOUT_MS = LINUX_CAPTURE_TIMEOUT_MS;
const RECEIPT_MAX_BUFFER_BYTES = 1024;
const HUD_ID = "promethee-compact-timer";

export interface LinuxHudCaptureOptions {
  readonly executable?: string | null;
  readonly executor?: NativeBridgeExecutor;
  readonly platform?: NodeJS.Platform;
}

export function supportsLinuxHudCapture(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
}

// The helper re-reads the live session before it hands over a pixel, so it is
// told which window the caller believes it is asking about rather than left to
// pick one. Everything in this list is part of that claim, and a claim the
// compositor no longer agrees with is refused instead of answered.
export function linuxHudCaptureArgs(
  bounds: ScreenRect,
  processId: number,
  generation: number,
  outputPath: string
): readonly string[] | null {
  if (
    !validBounds(bounds) || !Number.isSafeInteger(processId) || processId <= 0 ||
    !Number.isSafeInteger(generation) || generation < 0 || outputPath.length === 0
  ) {
    return null;
  }
  return Object.freeze([
    "capture",
    String(processId),
    String(generation),
    String(bounds.x),
    String(bounds.y),
    String(bounds.width),
    String(bounds.height),
    outputPath
  ]);
}

export function linuxHudCaptureReceipt(bounds: ScreenRect, generation: number): string {
  return `captured,${bounds.width},${bounds.height},${generation}`;
}

export async function captureLinuxPrometheeHud(
  bounds: ScreenRect,
  processId: number,
  generation: number,
  signal?: AbortSignal,
  options: LinuxHudCaptureOptions = {}
): Promise<PrometheeHudCaptureSnapshot> {
  const platform = options.platform ?? process.platform;
  if (!supportsLinuxHudCapture(platform)) throw new Error("Promethee HUD capture is unavailable.");
  const executable = options.executable === undefined ? nativeBridgeExecutable(platform) : options.executable;
  if (executable === null) throw new Error("Promethee HUD capture is unavailable.");

  // The pixels travel through a file because every other answer on this contract
  // is one line of text, and a command that replies with a raster on the same
  // channel would be the one case a caller has to read differently.
  const captureDirectory = await mkdtemp(path.join(os.tmpdir(), "promethee-pomodoro-hud-"));
  const capturePath = path.join(captureDirectory, "hud.rgba");
  const args = linuxHudCaptureArgs(bounds, processId, generation, capturePath);
  if (args === null) {
    await rm(captureDirectory, { force: true, recursive: true }).catch(() => undefined);
    throw new TypeError("Invalid Promethee HUD capture request.");
  }

  let receipt: string;
  let raster: Buffer;
  try {
    const execution = await (options.executor ?? executeNativeBridge)({
      args,
      executable,
      maxBufferBytes: RECEIPT_MAX_BUFFER_BYTES,
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: CAPTURE_TIMEOUT_MS
    });
    receipt = execution.stdout.trim();
    raster = await readFile(capturePath).catch(() => Buffer.alloc(0));
  } finally {
    await rm(captureDirectory, { force: true, recursive: true }).catch(() => undefined);
  }

  // A helper that refused prints why it refused and exits non-zero, and the
  // executor hands a complete refusal back as output rather than as a throw. So
  // the success receipt is checked by equality, naming the geometry and the
  // generation that were asked for: anything else, refusal or surprise, fails
  // here rather than reaching the classifier as pixels of unknown provenance.
  if (receipt !== linuxHudCaptureReceipt(bounds, generation)) {
    throw new Error("Promethee HUD capture is unavailable.");
  }
  if (raster.length !== bounds.width * bounds.height * 4) {
    throw new Error("Promethee HUD raster has an unsupported format.");
  }

  // The helper writes RGBA already composited over opaque black, which is the
  // one thing the classifier can read, so there is no channel order to fix and
  // no alpha to flatten on this side.
  return Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    generation,
    hudId: HUD_ID,
    processId,
    raster: Object.freeze({ data: new Uint8ClampedArray(raster), height: bounds.height, width: bounds.width })
  });
}

function validBounds(bounds: ScreenRect): boolean {
  return Number.isSafeInteger(bounds.x) && Number.isSafeInteger(bounds.y) && Number.isSafeInteger(bounds.width) &&
    Number.isSafeInteger(bounds.height) && bounds.width >= 120 && bounds.width <= 220 && bounds.height === 32;
}
