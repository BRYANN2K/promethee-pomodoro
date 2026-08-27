import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";

import {
  captureLinuxPrometheeHud,
  linuxHudCaptureArgs,
  linuxHudCaptureReceipt,
  supportsLinuxHudCapture
} from "../../src/electron/linux-hud-capture.ts";
import type { NativeBridgeExecutionRequest } from "../../src/electron/native-promethee-bridge.ts";

const BOUNDS = Object.freeze({ height: 32, width: 159, x: 1189, y: 366 });
const PROCESS_ID = 5998;
const GENERATION = 7;

// The real helper writes the raster to the path it was given and then names the
// geometry it wrote, so a stand-in that only prints the receipt would let a
// module that never reads the file pass.
function helper(options: {
  readonly bytes?: number;
  readonly stdout?: string;
  readonly write?: boolean;
} = {}): {
  readonly calls: NativeBridgeExecutionRequest[];
  readonly executor: (request: NativeBridgeExecutionRequest) => Promise<{ readonly stdout: string }>;
} {
  const calls: NativeBridgeExecutionRequest[] = [];
  return {
    calls,
    executor: (request: NativeBridgeExecutionRequest): Promise<{ readonly stdout: string }> => {
      calls.push(request);
      const outputPath = request.args[7] ?? "";
      if (options.write !== false) {
        writeFileSync(outputPath, Buffer.alloc(options.bytes ?? BOUNDS.width * BOUNDS.height * 4, 0x20));
      }
      return Promise.resolve({ stdout: options.stdout ?? `${linuxHudCaptureReceipt(BOUNDS, GENERATION)}\n` });
    }
  };
}

function capture(
  overrides: Partial<{ bounds: typeof BOUNDS; generation: number; processId: number }> = {},
  helperOptions: Parameters<typeof helper>[0] = {}
): { readonly calls: NativeBridgeExecutionRequest[]; readonly result: Promise<unknown> } {
  const stub = helper(helperOptions);
  const result = captureLinuxPrometheeHud(
    overrides.bounds ?? BOUNDS,
    overrides.processId ?? PROCESS_ID,
    overrides.generation ?? GENERATION,
    undefined,
    { executable: "/promethee-input-bridge", executor: stub.executor, platform: "linux" }
  );
  return { calls: stub.calls, result };
}

test("Linux HUD capture is offered only on Linux", () => {
  assert.equal(supportsLinuxHudCapture("linux"), true);
  assert.equal(supportsLinuxHudCapture("darwin"), false);
  assert.equal(supportsLinuxHudCapture("win32"), false);
});

test("the capture request names the window the caller believes it is reading", () => {
  assert.deepEqual(linuxHudCaptureArgs(BOUNDS, PROCESS_ID, GENERATION, "/tmp/hud.rgba"), [
    "capture",
    "5998",
    "7",
    "1189",
    "366",
    "159",
    "32",
    "/tmp/hud.rgba"
  ]);
});

test("a request the classifier could not read is refused before the helper runs", () => {
  for (const bounds of [
    { ...BOUNDS, width: 119 },
    { ...BOUNDS, width: 221 },
    { ...BOUNDS, height: 31 },
    { ...BOUNDS, x: 1.5 }
  ]) {
    assert.equal(linuxHudCaptureArgs(bounds, PROCESS_ID, GENERATION, "/tmp/hud.rgba"), null);
  }
  assert.equal(linuxHudCaptureArgs(BOUNDS, 0, GENERATION, "/tmp/hud.rgba"), null);
  assert.equal(linuxHudCaptureArgs(BOUNDS, PROCESS_ID, -1, "/tmp/hud.rgba"), null);
  assert.equal(linuxHudCaptureArgs(BOUNDS, PROCESS_ID, GENERATION, ""), null);
});

test("a captured HUD arrives as the raster the classifier reads", async () => {
  const { calls, result } = capture();
  const snapshot = await result;
  assert.deepEqual(snapshot, {
    bounds: { height: 32, width: 159, x: 1189, y: 366 },
    generation: GENERATION,
    hudId: "promethee-compact-timer",
    processId: PROCESS_ID,
    raster: {
      data: new Uint8ClampedArray(BOUNDS.width * BOUNDS.height * 4).fill(0x20),
      height: 32,
      width: 159
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.executable, "/promethee-input-bridge");
});

test("the pixels do not outlive the call that asked for them", async () => {
  const { calls, result } = capture();
  await result;
  const outputPath = calls[0]?.args[7] ?? "";
  assert.notEqual(outputPath, "");
  assert.equal(existsSync(outputPath), false);
});

test("a helper that refused is not read as pixels", async () => {
  // `capture-format-unsupported` is the receipt a session gives when it has the
  // surface and will only hand it over without the alpha the classifier reads.
  // It is a refusal like the others here, and it reads as unavailable rather than
  // as pixels, which is the only thing this side has to get right about it.
  for (const stdout of [
    "timer-not-found\n", "capture-unsupported\n", "capture-format-unsupported\n",
    "target-mismatch\n", "\n"
  ]) {
    const { calls, result } = capture({}, { stdout, write: false });
    await assert.rejects(result, /capture is unavailable/);
    assert.equal(existsSync(calls[0]?.args[7] ?? ""), false);
  }
});

// The generation is the caller's word for which HUD this is. A receipt naming a
// different one is an answer to an older question, and the classifier has no way
// to tell that from a current one once the pixels are separated from the receipt.
test("a receipt about another HUD is not accepted for this one", async () => {
  await assert.rejects(capture({}, { stdout: `${linuxHudCaptureReceipt(BOUNDS, GENERATION - 1)}\n` }).result, /unavailable/);
  await assert.rejects(capture({}, { stdout: "captured,145,32,7\n" }).result, /unavailable/);
});

test("a raster of the wrong size is refused rather than classified", async () => {
  await assert.rejects(capture({}, { bytes: 64 }).result, /unsupported format/);
  await assert.rejects(capture({}, { write: false }).result, /unsupported format/);
});

test("capture is unavailable where the helper is not", async () => {
  await assert.rejects(
    captureLinuxPrometheeHud(BOUNDS, PROCESS_ID, GENERATION, undefined, { executable: null, platform: "linux" }),
    /unavailable/
  );
  await assert.rejects(
    captureLinuxPrometheeHud(BOUNDS, PROCESS_ID, GENERATION, undefined, {
      executable: "/promethee-input-bridge",
      platform: "darwin"
    }),
    /unavailable/
  );
});

test("a request the helper would refuse is refused here first", async () => {
  const stub = helper();
  await assert.rejects(
    captureLinuxPrometheeHud({ ...BOUNDS, height: 31 }, PROCESS_ID, GENERATION, undefined, {
      executable: "/promethee-input-bridge",
      executor: stub.executor,
      platform: "linux"
    }),
    TypeError
  );
  assert.equal(stub.calls.length, 0);
});
