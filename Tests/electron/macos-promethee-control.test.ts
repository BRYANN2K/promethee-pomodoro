import assert from "node:assert/strict";
import test from "node:test";

import {
  NativePrometheeControl,
  classifyPrometheeHudRaster,
  parsePrometheeNativeReceipt,
  planPrometheeHudAction,
  type NativeInputExecutionRequest,
  type NativeInputExecutor,
  type PrometheeControlObservation,
  type PrometheeHudCaptureSnapshot,
  type PrometheeSessionSample
} from "../../src/electron/promethee-control.ts";

function captureFixture(
  state: "paused" | "running",
  overrides: Partial<Omit<PrometheeHudCaptureSnapshot, "raster">> = {},
  widthOverride?: number
): PrometheeHudCaptureSnapshot {
  const width = widthOverride ?? (state === "running" ? 159 : 173);
  const height = 32;
  const data = new Uint8ClampedArray(width * height * 4);
  const maxX = width - 1;
  const centers = [maxX - 18, maxX - 50];
  if (state === "paused") centers.push(maxX - 82);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const inControl = centers.some((centerX) => (x - centerX) ** 2 + (y - 16) ** 2 <= 13 ** 2);
      const value = inControl ? (state === "paused" ? 54 : 87) : 43;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  if (state === "running") {
    drawPauseGlyph(data, width, maxX - 50, 16);
  } else {
    drawPlayGlyph(data, width, maxX - 82, 16);
    drawStopGlyph(data, width, maxX - 50, 16);
  }
  return {
    bounds: { x: 1400, y: 400, width, height },
    generation: 7,
    hudId: "hud-primary",
    processId: 4242,
    raster: { data, height, width },
    ...overrides
  };
}

function paintPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number
): void {
  const offset = (y * width + x) * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = 255;
}

function drawPauseGlyph(data: Uint8ClampedArray, width: number, centerX: number, centerY: number): void {
  for (const offsetX of [-4, -3, 3, 4]) {
    for (let offsetY = -5; offsetY <= 5; offsetY += 1) {
      paintPixel(data, width, centerX + offsetX, centerY + offsetY, 235, 235, 235);
    }
  }
}

function drawStopGlyph(data: Uint8ClampedArray, width: number, centerX: number, centerY: number): void {
  for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
      paintPixel(data, width, centerX + offsetX, centerY + offsetY, 235, 235, 235);
    }
  }
}

function drawPlayGlyph(data: Uint8ClampedArray, width: number, centerX: number, centerY: number): void {
  for (let offsetX = -4; offsetX <= 5; offsetX += 1) {
    const halfHeight = Math.round(((5 - offsetX) * 5) / 9);
    for (let offsetY = -halfHeight; offsetY <= halfHeight; offsetY += 1) {
      paintPixel(data, width, centerX + offsetX, centerY + offsetY, 238, 103, 58);
    }
  }
}

function authority(
  state: "paused" | "running",
  overrides: Partial<PrometheeSessionSample> = {}
): PrometheeSessionSample {
  return {
    observedAtMs: 10,
    sessionId: "session-1",
    sessionState: state,
    source: "sqlite-observation" as const,
    ...overrides
  };
}

function authoritative(
  state: "paused" | "running",
  overrides: Partial<{
    generation: number;
    hudId: string;
    processId: number;
    observedAtMs: number;
    sessionId: string;
  }> = {}
) {
  return {
    ...authority(state, { observedAtMs: 11 }),
    generation: 7,
    hudId: "hud-primary",
    processId: 4242,
    ...overrides
  };
}

function commandAuthority(
  state: "paused" | "running",
  overrides: Parameters<typeof authoritative>[1] = {}
): PrometheeControlObservation {
  return authoritative(state, { observedAtMs: 10, ...overrides });
}

test("uses one fixed native request bound to capture PID, HUD bounds, generation, and rendered glyph", async () => {
  const requests: NativeInputExecutionRequest[] = [];
  const executor: NativeInputExecutor = async (request) => {
    requests.push(request);
    return { stdout: "clicked-unconfirmed,pause,7\n" };
  };
  const control = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });

  assert.deepEqual(await control.pressPause(), {
    action: "pause",
    execution: "sent-unconfirmed",
    observation: "none",
    status: "pressed"
  });
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.match(request.executable, /dist\/native\/darwin-(?:arm64|x64)\/promethee-input-bridge$/);
  assert.deepEqual(request.args, [
    "click", "pause", "running", "4242", "1400", "400", "159", "32", "7", "1508", "416", "2"
  ]);
  assert.doesNotMatch(request.args.join(" "), /start|stop|end|démarrer|arrêter/iu);
  assert.ok(request.timeoutMs > 0 && request.timeoutMs <= 1_000);
  assert.ok(request.maxBufferBytes > 0 && request.maxBufferBytes <= 4 * 1024);
});

test("native transport emits one exact compact-HUD click request for pause and resume", async () => {
  const requests: NativeInputExecutionRequest[] = [];
  const executor: NativeInputExecutor = async (request) => {
    requests.push(request);
    return { stdout: `clicked-unconfirmed,${request.args[1]},7` };
  };
  const pause = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });
  const resume = new NativePrometheeControl({
    authority: async () => commandAuthority("paused"),
    capture: async () => captureFixture("paused"),
    executor,
    platform: "darwin"
  });

  assert.equal((await pause.pressPause()).status, "pressed");
  assert.equal((await resume.pressResume()).status, "pressed");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]!.args, [
    "click", "pause", "running", "4242", "1400", "400", "159", "32", "7", "1508", "416", "2"
  ]);
  assert.deepEqual(requests[1]!.args, [
    "click", "resume", "paused", "4242", "1400", "400", "173", "32", "7", "1490", "416", "3"
  ]);
  assert.equal(requests[0]!.executable, requests[1]!.executable);
});

test("classifies calibrated ring samples and plans the exact pause/resume centers", () => {
  const running = classifyPrometheeHudRaster(captureFixture("running").raster);
  const paused = classifyPrometheeHudRaster(captureFixture("paused").raster);
  assert.equal(running.status === "classified" && running.state, "running");
  assert.equal(paused.status === "classified" && paused.state, "paused");

  const pausePlan = planPrometheeHudAction(running, "pause");
  const resumePlan = planPrometheeHudAction(paused, "resume");
  assert.deepEqual(pausePlan, {
    action: "pause",
    expectedState: "running",
    status: "ready",
    target: { x: 94, y: 2, width: 28, height: 28 }
  });
  assert.deepEqual(resumePlan, {
    action: "resume",
    expectedState: "paused",
    status: "ready",
    target: { x: 76, y: 2, width: 28, height: 28 }
  });
  assert.deepEqual(planPrometheeHudAction(running, "resume"), {
    action: "resume",
    reason: "state-mismatch",
    status: "failed"
  });
});

test("accepts the reviewed 1.3.29 Pause and chevron background delta", () => {
  const running = captureFixture("running");
  const data = running.raster.data as Uint8ClampedArray;
  const maxX = running.raster.width - 1;
  for (const [centerX, value] of [[maxX - 18, 46], [maxX - 50, 70], [maxX - 82, 5]] as const) {
    for (let y = 0; y < running.raster.height; y += 1) {
      for (let x = 0; x < running.raster.width; x += 1) {
        if ((x - centerX) ** 2 + (y - 16) ** 2 > 13 ** 2) continue;
        paintPixel(data, running.raster.width, x, y, value, value, value);
      }
    }
  }
  drawPauseGlyph(data, running.raster.width, maxX - 50, 16);
  assert.equal(classifyPrometheeHudRaster(running.raster).status, "classified");
});

test("accepts the reviewed 1.3.29 Play background delta and paused width", () => {
  const width = 191;
  const data = new Uint8ClampedArray(width * 32 * 4);
  const maxX = width - 1;
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const control = [[maxX - 82, 71], [maxX - 50, 49], [maxX - 18, 53]] as const;
      const match = control.find(([center]) => (x - center) ** 2 + (y - 16) ** 2 <= 13 ** 2);
      const value = match?.[1] ?? 43;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  drawPlayGlyph(data, width, maxX - 82, 16);
  drawStopGlyph(data, width, maxX - 50, 16);
  const raster = { data, height: 32, width };
  assert.deepEqual(classifyPrometheeHudRaster(raster), {
    controls: [
      { x: 94, y: 2, width: 28, height: 28 },
      { x: 126, y: 2, width: 28, height: 28 },
      { x: 158, y: 2, width: 28, height: 28 }
    ],
    state: "paused",
    status: "classified"
  });
});

test("never maps an adversarial paused Stop glyph to the running Pause target", async () => {
  const adversarial = captureFixture("paused");
  const maxX = adversarial.raster.width - 1;
  const optionalCenterX = maxX - 82;
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
      paintPixel(adversarial.raster.data as Uint8ClampedArray, adversarial.raster.width,
        optionalCenterX + offsetX, 16 + offsetY, 54, 54, 54);
    }
  }
  drawStopGlyph(adversarial.raster.data as Uint8ClampedArray, adversarial.raster.width, optionalCenterX, 16);
  assert.deepEqual(classifyPrometheeHudRaster(adversarial.raster), { status: "unsupported" });

  let calls = 0;
  const control = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => adversarial,
    executor: async () => { calls += 1; return { stdout: "clicked-unconfirmed,pause,7" }; },
    platform: "darwin"
  });
  assert.equal((await control.pressPause()).reason, "layout-unsupported");
  assert.equal(calls, 0);
});

test("fails closed when the paused Play glyph is missing", () => {
  const paused = captureFixture("paused");
  const centerX = paused.raster.width - 1 - 82;
  for (let offsetY = -7; offsetY <= 7; offsetY += 1) {
    for (let offsetX = -6; offsetX <= 6; offsetX += 1) {
      paintPixel(paused.raster.data as Uint8ClampedArray, paused.raster.width, centerX + offsetX, 16 + offsetY, 54, 54, 54);
    }
  }
  assert.deepEqual(classifyPrometheeHudRaster(paused.raster), { status: "unsupported" });
});

test("rejects non-uniform or ambiguous ring samples without executing", async () => {
  const capture = captureFixture("running");
  const maxX = capture.raster.width - 1;
  const alteredOffset = (16 * capture.raster.width + (maxX - 18 + 8)) * 4;
  capture.raster.data[alteredOffset] = 240;
  capture.raster.data[alteredOffset + 1] = 240;
  capture.raster.data[alteredOffset + 2] = 240;
  assert.deepEqual(classifyPrometheeHudRaster(capture.raster), { status: "unsupported" });

  let calls = 0;
  const control = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => capture,
    executor: async () => { calls += 1; return { stdout: "clicked-unconfirmed,pause,7" }; },
    platform: "darwin"
  });
  assert.deepEqual(await control.pressPause(), {
    action: "pause",
    execution: "not-sent",
    reason: "layout-unsupported",
    status: "failed"
  });
  assert.equal(calls, 0);
});

test("locks every later mutation until matching authoritative reconciliation", async () => {
  let captureState: "paused" | "running" = "running";
  let authorityState: PrometheeControlObservation = commandAuthority("running");
  let calls = 0;
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState),
    executor: async (request) => {
      calls += 1;
      return { stdout: `clicked-unconfirmed,${request.args[1]},7` };
    },
    platform: "darwin"
  });

  await control.pressPause();
  captureState = "paused";
  assert.deepEqual(await control.pressResume(), {
    action: "resume",
    execution: "not-sent",
    reason: "reconciliation-required",
    status: "failed"
  });
  assert.deepEqual(await control.reconcile(authoritative("paused", { processId: 9999 })), {
    reason: "identity-mismatch",
    status: "failed"
  });
  assert.deepEqual(await control.reconcile(authoritative("running")), {
    reason: "state-mismatch",
    status: "failed"
  });
  authorityState = commandAuthority("paused", { observedAtMs: 11 });
  assert.deepEqual(await control.reconcile(authoritative("paused")), { status: "reconciled" });
  assert.equal((await control.pressResume()).status, "pressed");
  assert.equal(calls, 2);
});

test("rejects replacement sessions and stale observations without unlocking", async () => {
  let authorityState = commandAuthority("running");
  let captureState: "paused" | "running" = "running";
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState),
    executor: async () => ({ stdout: "clicked-unconfirmed,pause,7" }),
    platform: "darwin"
  });
  await control.pressPause();

  assert.deepEqual(await control.reconcile(authoritative("paused", { sessionId: "session-2" })), {
    reason: "session-mismatch",
    status: "failed"
  });
  assert.deepEqual(await control.reconcile(authoritative("paused", { observedAtMs: 10 })), {
    reason: "stale-observation",
    status: "failed"
  });
  assert.equal(
    (await control.pressResume()).reason,
    "reconciliation-required"
  );
  authorityState = commandAuthority("paused", { observedAtMs: 11 });
  captureState = "paused";
  assert.deepEqual(await control.reconcile(authoritative("paused")), { status: "reconciled" });
});

test("reconciles Pause across the exact 159 to 191 geometry generation transition", async () => {
  let authorityState = commandAuthority("running", { generation: 7, observedAtMs: 10 });
  let captureState: "paused" | "running" = "running";
  let captureGeneration = 7;
  let captureWidth = 159;
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState, { generation: captureGeneration }, captureWidth),
    executor: async () => ({ stdout: "clicked-unconfirmed,pause,7" }),
    platform: "darwin"
  });

  assert.equal((await control.pressPause()).status, "pressed");
  authorityState = commandAuthority("paused", { generation: 8, observedAtMs: 11 });
  captureState = "paused";
  captureGeneration = 8;
  captureWidth = 191;

  assert.deepEqual(await control.reconcile(authorityState), { status: "reconciled" });
});

test("reconciles Resume across the exact 191 to 159 geometry generation transition", async () => {
  let authorityState = commandAuthority("paused", { generation: 7, observedAtMs: 10 });
  let captureState: "paused" | "running" = "paused";
  let captureGeneration = 7;
  let captureWidth = 191;
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState, { generation: captureGeneration }, captureWidth),
    executor: async () => ({ stdout: "clicked-unconfirmed,resume,7" }),
    platform: "darwin"
  });

  assert.equal((await control.pressResume()).status, "pressed");
  authorityState = commandAuthority("running", { generation: 8, observedAtMs: 11 });
  captureState = "running";
  captureGeneration = 8;
  captureWidth = 159;

  assert.deepEqual(await control.reconcile(authorityState), { status: "reconciled" });
});

test("keeps the latch across changed-generation glyph mismatch and final-authority replacement", async () => {
  let authorityState = commandAuthority("running", { generation: 7, observedAtMs: 10 });
  let captureState: "paused" | "running" = "running";
  let captureGeneration = 7;
  let captureWidth = 159;
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState, { generation: captureGeneration }, captureWidth),
    executor: async () => ({ stdout: "clicked-unconfirmed,pause,7" }),
    platform: "darwin"
  });
  await control.pressPause();

  const expectedTransition = authoritative("paused", { generation: 8, observedAtMs: 11 });
  authorityState = commandAuthority("paused", { generation: 8, observedAtMs: 11, sessionId: "session-2" });
  captureState = "paused";
  captureGeneration = 8;
  captureWidth = 191;
  assert.deepEqual(await control.reconcile(expectedTransition), { reason: "session-mismatch", status: "failed" });

  authorityState = commandAuthority("paused", { generation: 8, observedAtMs: 11 });
  captureState = "running";
  captureWidth = 159;
  assert.deepEqual(await control.reconcile(expectedTransition), { reason: "state-mismatch", status: "failed" });
  assert.equal((await control.pressResume()).reason, "reconciliation-required");

  captureState = "paused";
  captureWidth = 191;
  assert.deepEqual(await control.reconcile(expectedTransition), { status: "reconciled" });
});

test("re-reads authority after capture and rejects replacement or HUD incoherence before native dispatch", async () => {
  let calls = 0;
  let reads = 0;
  const replacement = new NativePrometheeControl({
    authority: async () => {
      reads += 1;
      return commandAuthority("running", reads === 1 ? {} : { sessionId: "session-2" });
    },
    capture: async () => captureFixture("running"),
    executor: async () => { calls += 1; return { stdout: "clicked-unconfirmed,pause,7" }; },
    platform: "darwin"
  });
  assert.deepEqual(await replacement.pressPause(), {
    action: "pause",
    execution: "not-sent",
    reason: "authority-changed",
    status: "failed"
  });

  const incoherentHud = new NativePrometheeControl({
    authority: async () => commandAuthority("running", { generation: 8 }),
    capture: async () => captureFixture("running"),
    executor: async () => { calls += 1; return { stdout: "clicked-unconfirmed,pause,7" }; },
    platform: "darwin"
  });
  assert.equal((await incoherentHud.pressPause()).reason, "authority-changed");
  assert.equal(calls, 0);
});

test("serializes concurrent requests and never retries after an unconfirmed press", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const releases: Array<() => void> = [];
  const executor: NativeInputExecutor = (request) => new Promise((resolve) => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    releases.push(() => {
      inFlight -= 1;
      resolve({ stdout: `clicked-unconfirmed,${request.args[1]},7` });
    });
  });
  const control = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });

  const first = control.pressPause();
  const second = control.pressPause();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  releases.shift()?.();
  assert.equal((await first).status, "pressed");
  assert.deepEqual(await second, {
    action: "pause",
    execution: "not-sent",
    reason: "reconciliation-required",
    status: "failed"
  });
  assert.equal(maximumInFlight, 1);
});

test("indeterminate execution also locks until explicit reconciliation", async () => {
  let authorityState = commandAuthority("paused");
  let captureState: "paused" | "running" = "paused";
  const control = new NativePrometheeControl({
    authority: async () => authorityState,
    capture: async () => captureFixture(captureState),
    executor: async () => { throw new Error("controlled failure"); },
    platform: "darwin"
  });
  assert.deepEqual(await control.pressResume(), {
    action: "resume",
    execution: "indeterminate",
    reason: "execution-error",
    status: "failed"
  });
  assert.equal((await control.pressPause()).status, "failed");
  authorityState = commandAuthority("running", { observedAtMs: 11 });
  captureState = "running";
  assert.deepEqual(await control.reconcile(authoritative("running")), { status: "reconciled" });
});

test("fails before execution for unsupported, invalid, aborted, or unwired capture", async () => {
  let calls = 0;
  const executor: NativeInputExecutor = async () => { calls += 1; return { stdout: "clicked-unconfirmed,pause,7" }; };
  assert.equal((await new NativePrometheeControl({ executor, platform: "linux" }).pressPause()).reason, "unsupported-platform");
  assert.equal((await new NativePrometheeControl({ executor, platform: "win32" }).pressPause()).reason, "unsupported-platform");

  const macOS = new NativePrometheeControl({
    authority: async () => commandAuthority("running"),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });
  assert.deepEqual(await macOS.press("start" as never), {
    action: null,
    execution: "not-sent",
    reason: "invalid-action",
    status: "failed"
  });
  const controller = new AbortController();
  controller.abort();
  assert.equal((await macOS.pressPause(controller.signal)).reason, "aborted");
  assert.equal(
    (await new NativePrometheeControl({ capture: async () => captureFixture("running"), executor, platform: "darwin" }).pressPause()).reason,
    "authority-unavailable"
  );
  const invalidAuthority = new NativePrometheeControl({
    authority: async () => ({ ...commandAuthority("running"), sessionId: "" }),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });
  assert.equal((await invalidAuthority.pressPause()).reason, "invalid-authority");
  const wrongState = new NativePrometheeControl({
    authority: async () => commandAuthority("paused"),
    capture: async () => captureFixture("running"),
    executor,
    platform: "darwin"
  });
  assert.equal((await wrongState.pressPause()).reason, "state-mismatch");
  assert.equal(calls, 0);
});

test("strictly parses bounded native bridge receipts", () => {
  assert.deepEqual(parsePrometheeNativeReceipt("permission-denied", "pause", 7), {
    action: "pause",
    execution: "not-sent",
    reason: "permission-denied",
    status: "failed"
  });
  assert.equal(parsePrometheeNativeReceipt("x".repeat(65), "pause", 7).status, "failed");
  assert.deepEqual(parsePrometheeNativeReceipt("clicked-unconfirmed,resume,7", "resume", 7), {
    action: "resume",
    execution: "sent-unconfirmed",
    observation: "none",
    status: "pressed"
  });
  assert.deepEqual(parsePrometheeNativeReceipt("timer-not-found", "pause", 7), {
    action: "pause",
    execution: "not-sent",
    reason: "timer-not-found",
    status: "failed"
  });
  assert.equal(parsePrometheeNativeReceipt("clicked-unconfirmed,pause,8", "pause", 7).execution, "indeterminate");
});
