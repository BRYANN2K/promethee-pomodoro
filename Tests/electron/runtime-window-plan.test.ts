import assert from "node:assert/strict";
import test from "node:test";

import {
  planRuntimeWindows,
  planStandaloneMenuBounds,
  type RuntimeWindowPlanInput
} from "../../src/electron/runtime-window-plan.ts";

function input(overrides: Partial<RuntimeWindowPlanInput> = {}): RuntimeWindowPlanInput {
  return {
    exclusions: [],
    menuOpen: true,
    menuSize: { width: 288, height: 320 },
    retainedHandleSide: null,
    timer: { x: 600, y: 400, width: 159, height: 32 },
    workArea: { x: 0, y: 25, width: 1440, height: 1000 },
    ...overrides
  };
}

test("places the exact outline, right handle, and below menu around live-width geometry", () => {
  const plan = planRuntimeWindows(input());
  assert.deepEqual(plan.outline, { x: 598, y: 398, width: 163, height: 36 });
  assert.deepEqual(plan.handle, { bounds: { x: 765, y: 404, width: 24, height: 24 }, side: "right" });
  assert.deepEqual(plan.menu, { bounds: { x: 536, y: 438, width: 288, height: 320 }, side: "below" });
});

test("retains the safe side, switches at an edge, and reverses around a host exclusion", () => {
  const plan = planRuntimeWindows(input({
    retainedHandleSide: "right",
    timer: { x: 1260, y: 600, width: 159, height: 32 },
    exclusions: [{ x: 1195, y: 638, width: 245, height: 360 }]
  }));
  assert.equal(plan.handle.side, "left");
  assert.deepEqual(plan.handle.bounds, { x: 1230, y: 604, width: 24, height: 24 });
  assert.equal(plan.menu.side, "above");
  assert.equal(plan.menu.bounds?.y, 274);
});

test("hides interactive placements when both handle sides are excluded", () => {
  const plan = planRuntimeWindows(input({
    exclusions: [
      { x: 570, y: 404, width: 24, height: 24 },
      { x: 765, y: 404, width: 24, height: 24 }
    ]
  }));
  assert.equal(plan.handle.bounds, null);
  assert.equal(plan.menu.bounds, null);
  assert.notEqual(plan.outline, null);
});

test("fails closed for invalid timer or work-area geometry", () => {
  for (const invalid of [
    input({ timer: { x: 600, y: 400, width: 0, height: 32 } }),
    input({ workArea: { x: 0, y: 0, width: -1, height: 1000 } }),
    input({ timer: { x: 2000, y: 400, width: 159, height: 32 } })
  ]) {
    assert.deepEqual(planRuntimeWindows(invalid), {
      handle: { bounds: null, side: "right" },
      menu: { bounds: null, side: null },
      outline: null
    });
  }
});

test("centers the standalone recovery menu inside positive and negative-origin work areas", () => {
  assert.deepEqual(
    planStandaloneMenuBounds({ x: 0, y: 25, width: 1440, height: 900 }, { width: 348, height: 318 }),
    { x: 546, y: 316, width: 348, height: 318 }
  );
  assert.deepEqual(
    planStandaloneMenuBounds({ x: -1280, y: -40, width: 1280, height: 800 }, { width: 348, height: 318 }),
    { x: -814, y: 201, width: 348, height: 318 }
  );
});

test("clamps the standalone recovery menu and rejects invalid work areas", () => {
  assert.deepEqual(
    planStandaloneMenuBounds({ x: 20, y: 30, width: 300, height: 240 }, { width: 348, height: 318 }),
    { x: 30, y: 40, width: 280, height: 220 }
  );
  assert.equal(planStandaloneMenuBounds({ x: 0, y: 0, width: 0, height: 800 }, { width: 348, height: 318 }), null);
});
