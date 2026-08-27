import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  createSurfaceAttachment,
  supportsSurfaceAttachment,
  surfaceAttachmentArgs,
  surfaceAttachmentSignature,
  PLACEMENT_PENDING_ARGUMENT,
  type AttachedSurface
} from "../../src/electron/linux-surface-attachment.ts";
import type { NativeBridgeExecutionRequest } from "../../src/electron/native-promethee-bridge.ts";

const OUTLINE = "Promethee Pomodoro progress";
const HANDLE = "Promethee Pomodoro menu handle";
const MENU = "Promethee Pomodoro";

function surface(title: string, x: number | null, y = 0, input: AttachedSurface["input"] = "interactive"): AttachedSurface {
  return { input, position: x === null ? null : { x, y }, title };
}

// The real helper names how many of the surfaces it was given it placed, so an
// unset `stdout` answers for all of them and a set one stands in for a
// compositor that placed fewer, or none.
function placedEverything(request: NativeBridgeExecutionRequest): string {
  const count = ((request.args?.length ?? 1) - 1) / 4;
  return `attached,${count},${count}\n`;
}

function recorder(): {
  readonly calls: NativeBridgeExecutionRequest[];
  readonly executor: (request: NativeBridgeExecutionRequest) => Promise<{ readonly stdout: string }>;
  stdout: string | null;
} {
  const calls: NativeBridgeExecutionRequest[] = [];
  const state = {
    calls,
    stdout: null as string | null,
    executor: (request: NativeBridgeExecutionRequest): Promise<{ readonly stdout: string }> => {
      calls.push(request);
      return Promise.resolve({ stdout: state.stdout ?? placedEverything(request) });
    }
  };
  return state;
}

// A retry the test does not want is put out of reach rather than turned off, so
// the same code path is exercised either way.
const NEVER = 10_000;
const SOON = 20;

function attachment(
  executor: (request: NativeBridgeExecutionRequest) => Promise<{ readonly stdout: string }>,
  retryDelayMs = NEVER
) {
  return createSurfaceAttachment({ executable: "/helper", executor, platform: "linux", retryDelayMs });
}

function afterRetries(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, SOON * 3); });
}

test("places only the surfaces the compositor still shows", () => {
  assert.deepEqual(
    surfaceAttachmentArgs([
      surface(OUTLINE, 10, 20, "transparent"),
      surface(HANDLE, 30, 40),
      surface(MENU, null)
    ]),
    ["attach", OUTLINE, "10", "20", "transparent", HANDLE, "30", "40", "interactive"]
  );
});

test("names a hidden surface in the signature so its return is placed again", () => {
  const shown = surfaceAttachmentSignature([surface(OUTLINE, 10), surface(MENU, 30)]);
  const hidden = surfaceAttachmentSignature([surface(OUTLINE, 10), surface(MENU, null)]);
  assert.notEqual(shown, hidden);
  assert.equal(shown, surfaceAttachmentSignature([surface(OUTLINE, 10), surface(MENU, 30)]));
  assert.deepEqual(
    surfaceAttachmentArgs([surface(OUTLINE, 10), surface(MENU, null)]),
    ["attach", OUTLINE, "10", "0", "interactive"]
  );
});

test("refuses a request it cannot state exactly", () => {
  assert.equal(surfaceAttachmentArgs([]), null);
  assert.equal(surfaceAttachmentArgs([null, null]), null);
  assert.equal(surfaceAttachmentArgs([surface("", 1)]), null);
  assert.equal(surfaceAttachmentArgs([surface(`say "${OUTLINE}"`, 1)]), null);
  assert.equal(surfaceAttachmentArgs([surface(`${OUTLINE}\n`, 1)]), null);
  assert.equal(surfaceAttachmentArgs([surface(OUTLINE, 1), surface(OUTLINE, 2)]), null);
  assert.equal(surfaceAttachmentArgs([surface(OUTLINE, 1.5)]), null);
  assert.equal(surfaceAttachmentArgs([surface(OUTLINE, Number.NaN)]), null);
  assert.equal(surfaceAttachmentArgs([surface(OUTLINE, 1_000_001)]), null);
  assert.equal(surfaceAttachmentArgs([surface(OUTLINE, 0, -1_000_001)]), null);
});

test("asks for placement on Linux alone, where a window cannot place itself", () => {
  assert.equal(supportsSurfaceAttachment("linux"), true);
  assert.equal(supportsSurfaceAttachment("darwin"), false);
  assert.equal(supportsSurfaceAttachment("win32"), false);

  const recorded = recorder();
  for (const platform of ["darwin", "win32"] as const) {
    createSurfaceAttachment({ executable: "/helper", executor: recorded.executor, platform })
      .place([surface(OUTLINE, 10)]);
  }
  createSurfaceAttachment({ executable: null, executor: recorded.executor, platform: "linux" })
    .place([surface(OUTLINE, 10)]);
  assert.equal(recorded.calls.length, 0);
});

// The pages themselves say nothing about placement, so a platform that does not
// wait for a compositor ships them exactly as they were: no attribute in their
// markup, and nothing in the runtime that would add one. The flag is what turns
// the waiting on, and it is only handed to the windows of a session that waits.
test("marks a page as waiting for a placement on Linux alone", () => {
  const source = (name: string) => readFileSync(new URL(`../../src/electron/${name}`, import.meta.url), "utf8");

  for (const page of ["handle.html", "overlay.html", "menu.html"]) {
    assert.equal(source(page).includes("data-placement"), false, `${page} carries no placement of its own`);
  }

  // The one rule that reads the attribute is inert until something sets it.
  assert.match(source("styles/tokens.css"), /:root\[data-placement="pending"\] body \{\s*visibility: hidden;/);

  // A preload is loaded by the runtime rather than imported, so it spells the
  // flag rather than sharing it. The two have to stay the same string.
  const preload = source("runtime-preload.cts");
  assert.ok(preload.includes(`process.argv.includes("${PLACEMENT_PENDING_ARGUMENT}")`),
    "the preload gates on the same flag the main process hands out");
  assert.match(preload, /document\.addEventListener\("readystatechange", applyPlacement\)/);

  // And the main process hands it out on the sessions that wait, and nowhere else.
  assert.match(readFileSync(new URL("../../src/electron/main.ts", import.meta.url), "utf8"),
    /additionalArguments: supportsSurfaceAttachment\(\) \? \[PLACEMENT_PENDING_ARGUMENT\] : \[\]/);
});

test("asks the helper once for a placement that has not changed", async () => {
  const recorded = recorder();
  const placer = attachment(recorded.executor);
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, 1);

  placer.place([surface(OUTLINE, 11)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, 2);
  assert.deepEqual(recorded.calls[1]?.args, ["attach", OUTLINE, "11", "0", "interactive"]);

  // A revoked attachment starts over, because the surfaces were taken down.
  placer.forget();
  placer.place([surface(OUTLINE, 11)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, 3);
});

test("asks again on its own for a placement the compositor did not carry out", async () => {
  const recorded = recorder();
  // A window the compositor has not mapped yet is named in the request and
  // absent from the answer, which is the ordinary case while the app opens. The
  // plan does not change on its own, so nothing else would ask again.
  recorded.stdout = "attached,0,1\n";
  const placer = attachment(recorded.executor, SOON);
  placer.place([surface(OUTLINE, 10)]);
  await afterRetries();
  assert.ok(recorded.calls.length > 1, `expected a retry, saw ${recorded.calls.length} call(s)`);

  recorded.stdout = null;
  await afterRetries();
  const settled = recorded.calls.length;

  // Once the placement is carried out, it stops asking.
  await afterRetries();
  assert.equal(recorded.calls.length, settled);
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, settled);
});

test("settles instead of asking forever for a placement that never completes", async () => {
  const recorded = recorder();
  recorded.stdout = "attached,0,1\n";
  const placer = attachment(recorded.executor);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    placer.place([surface(OUTLINE, 10)]);
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(recorded.calls.length, 10);

  // A different plan is a different question, and is asked.
  placer.place([surface(OUTLINE, 11)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, 11);
});

test("stops asking a session that has no compositor to ask", async () => {
  const recorded = recorder();
  recorded.stdout = "attach-unsupported\n";
  const placer = attachment(recorded.executor);
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  placer.place([surface(OUTLINE, 20)]);
  await Promise.resolve();
  assert.equal(recorded.calls.length, 1);
});

test("keeps a refused placement eligible for the next attempt", async () => {
  const calls: NativeBridgeExecutionRequest[] = [];
  let fail = true;
  const placer = attachment((request) => {
    calls.push(request);
    return fail ? Promise.reject(new Error("no socket")) : Promise.resolve({ stdout: "attached,1,1\n" });
  });
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  await Promise.resolve();
  fail = false;
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  assert.equal(calls.length, 2);
});

test("a placement revoked while the helper answers is asked for again", async () => {
  const calls: NativeBridgeExecutionRequest[] = [];
  let release: (() => void) | null = null;
  const placer = attachment((request) => {
    calls.push(request);
    return new Promise((resolve) => {
      release = (): void => resolve({ stdout: placedEverything(request) });
    });
  });

  placer.place([surface(OUTLINE, 10)]);
  assert.equal(calls.length, 1);

  // The surfaces come down while the compositor is still being asked, so the
  // answer that arrives next describes windows that no longer exist and must
  // not be recorded as a placement that holds.
  placer.forget();
  release?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);

  // Coming back at the same geometry is a new question, because the surfaces
  // were remade and the compositor knows nothing about them.
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  assert.equal(calls.length, 2);
});

test("coalesces placements asked for while the helper is still answering", async () => {
  const calls: NativeBridgeExecutionRequest[] = [];
  let release: (() => void) | null = null;
  const placer = attachment((request) => {
    calls.push(request);
    return new Promise((resolve) => {
      release = (): void => resolve({ stdout: "attached,1,1\n" });
    });
  });

  placer.place([surface(OUTLINE, 10)]);
  placer.place([surface(OUTLINE, 20)]);
  placer.place([surface(OUTLINE, 30)]);
  assert.equal(calls.length, 1);

  release?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.args, ["attach", OUTLINE, "30", "0", "interactive"]);
});

// A surface shown before the compositor has placed it is shown where the
// compositor dropped it, so the app is told when it may show one and when it
// may not. The settled flag is the whole of that permission, and the detached
// flag says whether the permission is worth anything: a surface let out because
// the asking is over is not a surface the compositor put anywhere in particular.
function placements(
  executor: (request: NativeBridgeExecutionRequest) => Promise<{ readonly stdout: string }>,
  retryDelayMs = NEVER
) {
  const seen: { detached: boolean; opaque: boolean; settled: boolean }[] = [];
  const placer = createSurfaceAttachment({
    executable: "/helper",
    executor,
    onPlacement: (placement) => { seen.push({ ...placement }); },
    platform: "linux",
    retryDelayMs
  });
  return { placer, seen };
}

test("withholds permission to show a surface until the compositor has placed it", async () => {
  const recorded = recorder();
  const { placer, seen } = placements(recorded.executor);

  placer.place([surface(OUTLINE, 10, 20, "transparent")]);
  assert.deepEqual(seen, [{ detached: false, opaque: false, settled: false }]);

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(seen, [{ detached: false, opaque: false, settled: false }, { detached: false, opaque: false, settled: true }]);

  // A later plan does not take the permission back. The surface is already on
  // screen at a position the compositor agreed to, and blanking its page for
  // every step of a drag would take the app off screen for the whole drag.
  placer.place([surface(OUTLINE, 90, 20, "transparent")]);
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: true });
  assert.equal(seen.length, 2, "an unchanged placement is not announced again");
});

test("takes the permission away when the surfaces come down", async () => {
  const recorded = recorder();
  const { placer, seen } = placements(recorded.executor);
  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(seen.at(-1)?.settled, true);

  placer.forget();
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: false });
});

test("a session with no compositor to ask has nothing to wait for", async () => {
  const recorded = recorder();
  recorded.stdout = "attach-unsupported\n";
  const { placer, seen } = placements(recorded.executor);

  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: true });

  // X11 places its own windows, so the permission stands for the whole session.
  placer.place([surface(OUTLINE, 40)]);
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: true });
  assert.equal(recorded.calls.length, 1);
});

test("a compositor that cannot honour input transparency is not asked again", async () => {
  const recorded = recorder();
  recorded.stdout = "attach-opaque,1,2\n";
  const { placer, seen } = placements(recorded.executor, SOON);

  placer.place([surface(OUTLINE, 10, 20, "transparent"), surface(HANDLE, 40, 20)]);
  await Promise.resolve();
  await Promise.resolve();
  // The refusal is an answer, not a partial placement, so it settles rather
  // than being retried, and it says the outline can never be shown here.
  assert.deepEqual(seen.at(-1), { detached: false, opaque: true, settled: true });

  await afterRetries();
  assert.equal(recorded.calls.length, 1);

  // Taking the outline down leaves a request the compositor can carry out, and
  // the refusal stands for the session rather than for that one request.
  recorded.stdout = null;
  placer.place([surface(OUTLINE, null), surface(HANDLE, 40, 20)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(recorded.calls[1]?.args, ["attach", HANDLE, "40", "20", "interactive"]);
  assert.deepEqual(seen.at(-1), { detached: false, opaque: true, settled: true });
});

test("an opaque receipt that does not match the request is a partial placement", async () => {
  const recorded = recorder();
  // Nothing asked to be invisible to the pointer, so nothing could be refused.
  recorded.stdout = "attach-opaque,1,1\n";
  const { placer, seen } = placements(recorded.executor);

  placer.place([surface(OUTLINE, 10)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: false });
});

test("a compositor that will not answer stops the app waiting for it", async () => {
  const recorded = recorder();
  recorded.stdout = "attached,0,1\n";
  const { placer, seen } = placements(recorded.executor, SOON);

  placer.place([surface(OUTLINE, 10)]);
  await afterRetries();
  await afterRetries();
  await afterRetries();
  await afterRetries();

  // Hiding every surface for good would take the menu with them and leave the
  // app with no control at all, so the asking ends. What it does not do is
  // pretend the placement happened: these surfaces are wherever they landed, and
  // the app is told so, so it can keep down the ones that are only a position.
  assert.deepEqual(seen.at(-1), { detached: true, opaque: false, settled: true });
  assert.equal(recorded.calls.length, 10);

  // A different plan is a fresh question, so the giving up does not stand for
  // the session the way a refusal of input transparency does.
  recorded.stdout = null;
  placer.place([surface(OUTLINE, 90)]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: true });
});

// BRYANN2K asked for surfaces that never appear detached, and this is the half
// of it a receipt can carry: an outline placed nowhere in particular circles
// nothing, so the app is told to leave it down rather than draw a ring around
// some other part of the screen.
test("tells the app a placement it gave up on is not a placement", async () => {
  const recorded = recorder();
  recorded.stdout = "attached,1,2\n";
  const { placer, seen } = placements(recorded.executor, SOON);

  placer.place([surface(OUTLINE, 10, 20, "transparent"), surface(HANDLE, 40, 20)]);
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: false });

  await afterRetries();
  await afterRetries();
  await afterRetries();
  await afterRetries();
  assert.deepEqual(seen.at(-1), { detached: true, opaque: false, settled: true });

  // Taking the surfaces down and starting over clears it, because the next plan
  // has not been given up on.
  placer.forget();
  assert.deepEqual(seen.at(-1), { detached: false, opaque: false, settled: false });
});
