import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nativeImage } from "electron";

import type { PrometheeHudCaptureSnapshot } from "./promethee-control.ts";
import type { ScreenRect } from "./promethee-window-locator.ts";

export { readNativePrometheeProcessId as readPrometheeProcessId } from "./native-promethee-bridge.ts";

const SCREEN_CAPTURE = "/usr/sbin/screencapture";
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 700;

export async function probeScreenCaptureTransport(point: Readonly<{ x: number; y: number }>): Promise<boolean> {
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return false;
  const captureDirectory = await mkdtemp(path.join(os.tmpdir(), "promethee-pomodoro-permission-"));
  const capturePath = path.join(captureDirectory, "probe.png");
  try {
    await executeText(
      SCREEN_CAPTURE,
      ["-x", `-R${point.x},${point.y},1,1`, "-t", "png", capturePath],
      CAPTURE_TIMEOUT_MS
    );
    const png = await readFile(capturePath);
    return png.length > 0 && png.length <= MAX_CAPTURE_BYTES && !nativeImage.createFromBuffer(png).isEmpty();
  } catch {
    return false;
  } finally {
    await rm(captureDirectory, { force: true, recursive: true }).catch(() => undefined);
  }
}

export async function capturePrometheeHud(
  bounds: ScreenRect,
  processId: number,
  generation: number,
  signal?: AbortSignal
): Promise<PrometheeHudCaptureSnapshot> {
  if (!validBounds(bounds) || !Number.isSafeInteger(processId) || processId <= 0 || !Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("Invalid Promethee HUD capture request.");
  }
  const captureDirectory = await mkdtemp(path.join(os.tmpdir(), "promethee-pomodoro-hud-"));
  const capturePath = path.join(captureDirectory, "hud.png");
  let png: Buffer;
  try {
    await executeText(
      SCREEN_CAPTURE,
      ["-x", `-R${bounds.x},${bounds.y},${bounds.width},${bounds.height}`, "-t", "png", capturePath],
      CAPTURE_TIMEOUT_MS,
      signal
    );
    png = await readFile(capturePath);
  } finally {
    await rm(captureDirectory, { force: true, recursive: true }).catch(() => undefined);
  }
  if (png.length === 0 || png.length > MAX_CAPTURE_BYTES) throw new Error("Promethee HUD capture is unavailable.");
  const decoded = nativeImage.createFromBuffer(png);
  if (decoded.isEmpty()) throw new Error("Promethee HUD capture could not be decoded.");
  const normalized = decoded.resize({ width: bounds.width, height: bounds.height, quality: "best" });
  const bitmap = normalized.toBitmap({ scaleFactor: 1 });
  if (bitmap.length !== bounds.width * bounds.height * 4) throw new Error("Promethee HUD raster has an unsupported format.");

  // Electron documents the bitmap as platform-specific. Chromium on macOS exposes
  // BGRA bytes, so normalize them to the renderer-independent RGBA classifier port.
  const rgba = new Uint8ClampedArray(bitmap.length);
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    rgba[offset] = bitmap[offset + 2] ?? 0;
    rgba[offset + 1] = bitmap[offset + 1] ?? 0;
    rgba[offset + 2] = bitmap[offset] ?? 0;
    rgba[offset + 3] = bitmap[offset + 3] ?? 0;
  }
  return Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    generation,
    hudId: "promethee-compact-timer",
    processId,
    raster: Object.freeze({ data: rgba, height: bounds.height, width: bounds.width })
  });
}

function executeText(executable: string, args: readonly string[], timeout: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], { encoding: "utf8", maxBuffer: 4 * 1024, signal, timeout }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    });
  });
}

function validBounds(bounds: ScreenRect): boolean {
  return Number.isSafeInteger(bounds.x) && Number.isSafeInteger(bounds.y) && Number.isSafeInteger(bounds.width) &&
    Number.isSafeInteger(bounds.height) && bounds.width >= 120 && bounds.width <= 220 && bounds.height === 32;
}
