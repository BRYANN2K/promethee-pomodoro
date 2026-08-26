import assert from "node:assert/strict";
import test from "node:test";

import {
  GEOMETRY_FAST_POLL_MS,
  GEOMETRY_FAST_WINDOW_MS,
  GEOMETRY_IDLE_POLL_MS,
  createGeometryPollCadence,
  geometryPollDelay,
  nextHudGeneration,
  updateGeometryPollCadence
} from "../../src/electron/geometry-poll-cadence.ts";

test("polls quickly during startup and settles while geometry is stable", () => {
  const cadence = createGeometryPollCadence(1_000);
  assert.equal(geometryPollDelay(cadence, 1_000), GEOMETRY_FAST_POLL_MS);
  assert.equal(geometryPollDelay(cadence, 1_000 + GEOMETRY_FAST_WINDOW_MS), GEOMETRY_FAST_POLL_MS);
  assert.equal(geometryPollDelay(cadence, 1_001 + GEOMETRY_FAST_WINDOW_MS), GEOMETRY_IDLE_POLL_MS);
});

test("a geometry change immediately restores the fast tracking window", () => {
  const settled = createGeometryPollCadence(0);
  const changed = updateGeometryPollCadence(settled, true, 4_000);
  assert.equal(geometryPollDelay(changed, 4_000), GEOMETRY_FAST_POLL_MS);
  assert.equal(geometryPollDelay(changed, 4_000 + GEOMETRY_FAST_WINDOW_MS + 1), GEOMETRY_IDLE_POLL_MS);
});

test("an unchanged geometry does not extend the fast window", () => {
  const initial = createGeometryPollCadence(100);
  const unchanged = updateGeometryPollCadence(initial, false, 10_000);
  assert.equal(unchanged, initial);
  assert.equal(geometryPollDelay(unchanged, 10_000), GEOMETRY_IDLE_POLL_MS);
});

test("HUD identity changes do not reuse the runtime lifecycle generation", () => {
  const firstHud = nextHudGeneration(0, true);
  const unchangedHud = nextHudGeneration(firstHud, false);
  const movedHud = nextHudGeneration(unchangedHud, true);
  assert.deepEqual([firstHud, unchangedHud, movedHud], [1, 1, 2]);
});
