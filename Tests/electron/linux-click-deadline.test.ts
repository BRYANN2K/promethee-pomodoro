import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { LINUX_CAPTURE_TIMEOUT_MS } from "../../src/electron/linux-hud-capture.ts";
import { executeNativeBridge, nativeClickTimeoutMs } from "../../src/electron/native-promethee-bridge.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function nativeSource(): Promise<string> {
  return readFile(path.join(repositoryRoot, "native", "linux", "promethee-input-bridge.cpp"), "utf8");
}

function constantFrom(source: string, name: string): number {
  const match = source.match(new RegExp(`${name} = ([0-9L*\\s]+?);`));
  assert.ok(match !== null, `${name} is not declared in the helper`);
  const value = Function(`"use strict"; return (${match[1]!.replaceAll("L", "")});`)() as number;
  assert.ok(Number.isFinite(value) && value > 0);
  return value;
}

test("only Linux waits longer for a press, and macOS and Windows keep the bound they had", () => {
  assert.equal(nativeClickTimeoutMs("darwin"), 800);
  assert.equal(nativeClickTimeoutMs("win32"), 800);
  assert.ok(nativeClickTimeoutMs("linux") > nativeClickTimeoutMs("darwin"));
});

test("the Linux wait is longer than every millisecond the helper can spend on a press", async () => {
  const source = await nativeSource();

  // The helper bounds the conversation it holds with the compositor, and then
  // owes itself a grace for the release and another for letting go of the
  // display, because a button put down has to come back up whatever the clock
  // says. Adding the two together is the whole of what a press can cost, and
  // the caller has to be willing to wait at least that long: a kill inside the
  // helper's own bound is what would leave the button held down. The two
  // numbers live in different languages, so they are checked against each other
  // rather than each against a figure someone remembered.
  const worstCaseMs = constantFrom(source, "kClickDeadlineMs") +
    constantFrom(source, "kReleaseGraceMs") * 2 +
    constantFrom(source, "kPressHoldNanoseconds") / 1e6 +
    constantFrom(source, "kReleaseSettleNanoseconds") / 1e6;

  assert.ok(
    nativeClickTimeoutMs("linux") > worstCaseMs,
    `Linux waits ${nativeClickTimeoutMs("linux")}ms for a press the helper can spend ${worstCaseMs}ms on`
  );
});

test("the Linux wait for a read is longer than the helper's own bound on it", async () => {
  const source = await nativeSource();

  assert.ok(
    LINUX_CAPTURE_TIMEOUT_MS > constantFrom(source, "kCaptureDeadlineMs"),
    "a read would be killed inside the budget the helper gave it"
  );
});

test("no wait in the capture path turns on an event alone", async () => {
  const source = await nativeSource();

  // Each of these three loops ends when the compositor sends one particular
  // event. A compositor that keeps answering something else would hold any of
  // them open for as long as it liked, so each one is asserted to consult the
  // deadline as well.
  const unbounded = [...source.matchAll(/while \([^)]*(?:constraints\.done|FrameOutcome::pending)[^)]*\)/g)]
    .map(([clause]) => clause);
  assert.equal(unbounded.length, 3);
  for (const clause of unbounded) {
    const body = source.slice(source.indexOf(clause) + clause.length, source.indexOf(clause) + clause.length + 220);
    assert.ok(
      clause.includes("remainingMs") || body.includes("remainingMs"),
      `a capture wait ends on an event alone: ${clause}`
    );
  }
});

test("the helper spends one deadline across the whole press instead of one per wait", async () => {
  const source = await nativeSource();

  // Every wait the press makes is drawn from the same deadline. A wait that
  // still carried its own bound would let a compositor answer each one slowly
  // enough to run the helper past its caller without ever timing anything out.
  assert.doesNotMatch(source, /if \(delivered\) \{\n    zwlr_virtual_pointer_v1_button/);
  assert.match(source, /bool delivered = roundtripWithin\(session\.display, deadline\);/);
  assert.match(source, /if \(pressed\) \{/);
  assert.match(source, /handler\.sa_flags = 0;/);

  const control = await readFile(path.join(repositoryRoot, "src", "electron", "promethee-control.ts"), "utf8");
  assert.match(control, /timeoutMs: nativeClickTimeoutMs\(this\.platform\)/);
});

test("a press whose request was written is released even when the roundtrip did not answer", async () => {
  const source = await nativeSource();

  // What owes the release is the press having been sent, not the press having
  // been acknowledged, on both slots. A `delivered` guard on the release is the
  // shape that leaves a button down, so it is asserted absent rather than
  // trusted to stay absent.
  assert.match(source, /pressed = true;\n    delivered = roundtripWithin\(session\.display, deadline\);/);
  assert.match(source, /pressed = true;\n    delivered = !takeX11Error\(display\);/);
  assert.equal(source.includes("if (delivered) {\n    sleepFor(kPressHoldNanoseconds);"), false);
});

test("a transport that never answers is a rejection rather than a wait without an end", async () => {
  const started = Date.now();
  await assert.rejects(
    executeNativeBridge({
      args: Object.freeze(["-c", "sleep 30"]),
      executable: "/bin/sh",
      maxBufferBytes: 4 * 1024,
      timeoutMs: 250
    }),
    (error: NodeJS.ErrnoException & { killed?: boolean }) => error.killed === true
  );
  assert.ok(Date.now() - started < 5_000);
});
