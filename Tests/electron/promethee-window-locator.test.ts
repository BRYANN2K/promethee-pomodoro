import assert from "node:assert/strict";
import test from "node:test";

import {
  createCalibrationOutlineBounds,
  normalizePrometheeWindowSnapshot,
  parsePrometheeWindowSnapshot,
  selectPrometheeTimerWindow,
  type ScreenRect
} from "../../src/electron/promethee-window-locator.ts";

const primaryWorkArea: ScreenRect = { x: 0, y: 25, width: 1728, height: 1080 };

test("parses the native bridge integer record format", () => {
  const parsed = parsePrometheeWindowSnapshot(
    "1443,432,159,32\n118,220,312,443\n12,40,1182,940\n"
  );

  assert.deepEqual(parsed, {
    status: "valid",
    windows: [
      { x: 1443, y: 432, width: 159, height: 32 },
      { x: 118, y: 220, width: 312, height: 443 },
      { x: 12, y: 40, width: 1182, height: 940 }
    ]
  });
});

test("selects only the unique compact timer and excludes Tasks and main windows", () => {
  const parsed = parsePrometheeWindowSnapshot(
    "1443,432,159,32\n118,220,312,443\n12,40,1182,940\n"
  );
  const selected = selectPrometheeTimerWindow(parsed, [primaryWorkArea]);

  assert.deepEqual(selected, {
    status: "found",
    bounds: { x: 1443, y: 432, width: 159, height: 32 }
  });
});

for (const width of [120, 144, 159, 173, 220]) {
  test(`accepts compact timer width ${width}`, () => {
    const parsed = parsePrometheeWindowSnapshot(`400,300,${width},32\n`);
    const selected = selectPrometheeTimerWindow(parsed, [primaryWorkArea]);

    assert.equal(selected.status, "found");
  });
}

test("supports a compact timer on a negative-origin display", () => {
  const parsed = parsePrometheeWindowSnapshot("-1500,420,173,32\n");
  const selected = selectPrometheeTimerWindow(parsed, [
    { x: -1920, y: 25, width: 1920, height: 1055 },
    primaryWorkArea
  ]);

  assert.deepEqual(selected, {
    status: "found",
    bounds: { x: -1500, y: 420, width: 173, height: 32 }
  });
});

test("normalizes physical Windows rectangles to Electron DIP before timer selection", () => {
  const physical = parsePrometheeWindowSnapshot("-2880,150,240,48\n-2400,300,900,600\n");
  const normalized = normalizePrometheeWindowSnapshot(physical, (bounds) => ({
    height: bounds.height / 1.5,
    width: bounds.width / 1.5,
    x: bounds.x / 1.5,
    y: bounds.y / 1.5
  }));

  assert.deepEqual(selectPrometheeTimerWindow(normalized, [{ x: -1920, y: 0, width: 1920, height: 1080 }]), {
    status: "found",
    bounds: { x: -1920, y: 100, width: 160, height: 32 }
  });
});

test("fails closed when platform normalization throws or returns unsafe geometry", () => {
  const snapshot = parsePrometheeWindowSnapshot("100,200,159,32\n");
  assert.equal(normalizePrometheeWindowSnapshot(snapshot, () => { throw new Error("conversion unavailable"); }).status, "invalid");
  assert.equal(normalizePrometheeWindowSnapshot(snapshot, () => ({ x: 0, y: 0, width: 159.5, height: 32 })).status, "invalid");
});

test("fails closed for malformed, fractional, unsafe, or oversized output", () => {
  for (const output of [
    "400,300,159\n",
    "400.5,300,159,32\n",
    "400,300,159,Infinity\n",
    "9007199254740992,300,159,32\n",
    `${"400,300,159,32\n".repeat(129)}`
  ]) {
    assert.deepEqual(parsePrometheeWindowSnapshot(output), {
      status: "invalid",
      windows: []
    });
  }
});

test("fails closed when two compact timer candidates are present", () => {
  const parsed = parsePrometheeWindowSnapshot("400,300,144,32\n800,300,173,32\n");

  assert.deepEqual(selectPrometheeTimerWindow(parsed, [primaryWorkArea]), {
    status: "ambiguous",
    candidateCount: 2
  });
});

test("returns not-found for empty, non-timer, and off-work-area snapshots", () => {
  for (const parsed of [
    parsePrometheeWindowSnapshot(""),
    parsePrometheeWindowSnapshot("100,100,312,443\n"),
    parsePrometheeWindowSnapshot("5000,5000,159,32\n")
  ]) {
    assert.deepEqual(selectPrometheeTimerWindow(parsed, [primaryWorkArea]), {
      status: "not-found",
      candidateCount: 0
    });
  }
});

test("fails closed when work-area geometry is invalid", () => {
  const parsed = parsePrometheeWindowSnapshot("400,300,159,32\n");

  assert.deepEqual(
    selectPrometheeTimerWindow(parsed, [{ x: 0, y: 0, width: -1, height: 900 }]),
    { status: "invalid", candidateCount: 0 }
  );
});

test("creates the approved two-pixel outline outset", () => {
  assert.deepEqual(
    createCalibrationOutlineBounds({ x: 1443, y: 432, width: 159, height: 32 }),
    { x: 1441, y: 430, width: 163, height: 36 }
  );
  assert.equal(
    createCalibrationOutlineBounds({ x: 1443, y: 432, width: 221, height: 32 }),
    null
  );
});
