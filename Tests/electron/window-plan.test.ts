import assert from "node:assert/strict";
import test from "node:test";

import {
  createWindowControllerState,
  planHudWindows,
  rectanglesIntersect,
  type HostExclusion,
  type Rect,
  type WindowControllerState,
  type WindowPlanInput
} from "../../src/electron/window-plan.ts";

function validInput(): WindowPlanInput {
  return {
    controller: createWindowControllerState(),
    display: {
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      coordinateSpace: "screen-dip",
      displayId: "display-1",
      scaleFactor: 2
    },
    exclusions: {
      atSequence: 42,
      connectionId: "connection-1",
      continuous: true,
      coordinateSpace: "screen-dip",
      displayId: "display-1",
      exclusions: [],
      hudRevision: 5,
      layoutRevision: 11,
      revision: 7
    },
    geometry: {
      bounds: { x: 400, y: 300, width: 144, height: 32 },
      connectionId: "connection-1",
      coordinateSpace: "screen-dip",
      displayId: "display-1",
      exclusionRevision: 7,
      expiresAtMs: 200,
      hudRevision: 5,
      layoutRevision: 11,
      mode: "running",
      observedAtMs: 100,
      scaleFactor: 2,
      visible: true
    },
    measuredMenu: { width: 288, height: 180 },
    menuPreference: "below",
    nowMs: 150,
    stacking: {
      connectionId: "connection-1",
      exclusionRevision: 7,
      layoutRevision: 11,
      state: "proven"
    }
  };
}

function withMenuIntent(controller: WindowControllerState): WindowControllerState {
  return { ...controller, menuIntent: "open-requested" };
}

function nextRevision(
  input: WindowPlanInput,
  exclusions: readonly HostExclusion[],
  bounds: Rect = input.geometry.bounds
): WindowPlanInput {
  const exclusionRevision = input.exclusions.revision + 1;
  const hudRevision = input.geometry.hudRevision + 1;
  const layoutRevision = input.geometry.layoutRevision + 1;
  return {
    ...input,
    exclusions: {
      ...input.exclusions,
      atSequence: input.exclusions.atSequence + 1,
      exclusions: exclusions.map((entry) => ({ ...entry, layoutRevision })),
      hudRevision,
      layoutRevision,
      revision: exclusionRevision
    },
    geometry: {
      ...input.geometry,
      bounds,
      exclusionRevision,
      hudRevision,
      layoutRevision
    },
    stacking: {
      ...input.stacking,
      exclusionRevision,
      layoutRevision
    }
  };
}

test("running geometry produces an exact click-through outline and right-side handle", () => {
  const plan = planHudWindows(validInput());

  assert.deepEqual(plan.outline, {
    bounds: { x: 398, y: 298, width: 148, height: 36 },
    inputMode: "click-through",
    interactive: false,
    visible: true
  });
  assert.deepEqual(plan.handle, {
    bounds: { x: 550, y: 304, width: 24, height: 24 },
    interactive: true,
    side: "right",
    state: "visible",
    visible: true
  });
  assert.equal(plan.menu.state, "closed");
});

test("paused geometry uses the authoritative 173px HUD width", () => {
  const input = validInput();
  const paused: WindowPlanInput = {
    ...input,
    exclusions: { ...input.exclusions, hudRevision: 6 },
    geometry: {
      ...input.geometry,
      bounds: { ...input.geometry.bounds, width: 173 },
      hudRevision: 6,
      mode: "paused"
    }
  };
  const plan = planHudWindows(paused);

  assert.deepEqual(plan.outline.bounds, { x: 398, y: 298, width: 177, height: 36 });
  assert.deepEqual(plan.handle.bounds, { x: 579, y: 304, width: 24, height: 24 });
});

test("negative-origin display switches to the safe left side before the right edge", () => {
  const input = validInput();
  const negative: WindowPlanInput = {
    ...input,
    display: { ...input.display, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    geometry: { ...input.geometry, bounds: { x: -160, y: 300, width: 144, height: 32 } }
  };
  const plan = planHudWindows(negative);

  assert.equal(plan.handle.side, "left");
  assert.deepEqual(plan.handle.bounds, { x: -190, y: 304, width: 24, height: 24 });
});

test("a current cross-display revision uses the target scale and negative-origin work area", () => {
  const input = validInput();
  const initial = planHudWindows(input);
  const moved: WindowPlanInput = {
    ...nextRevision(
      { ...input, controller: initial.controller },
      [],
      { x: -1400, y: 500, width: 144, height: 32 }
    ),
    display: {
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      coordinateSpace: "screen-dip",
      displayId: "display-2",
      scaleFactor: 1.5
    }
  };
  const aligned: WindowPlanInput = {
    ...moved,
    exclusions: { ...moved.exclusions, displayId: "display-2" },
    geometry: { ...moved.geometry, displayId: "display-2", scaleFactor: 1.5 }
  };
  const plan = planHudWindows(aligned);

  assert.equal(plan.reason, "ready");
  assert.deepEqual(plan.outline.bounds, { x: -1402, y: 498, width: 148, height: 36 });
  assert.deepEqual(plan.handle.bounds, { x: -1250, y: 504, width: 24, height: 24 });
});

test("handle side remains retained until that side becomes unsafe, then switches symmetrically", () => {
  const input = validInput();
  const edge: WindowPlanInput = {
    ...input,
    display: { ...input.display, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
    geometry: { ...input.geometry, bounds: { x: -160, y: 300, width: 144, height: 32 } }
  };
  const leftPlan = planHudWindows(edge);
  const centered = nextRevision(
    { ...edge, controller: leftPlan.controller },
    [],
    { x: -1000, y: 300, width: 144, height: 32 }
  );
  const retainedPlan = planHudWindows(centered);
  assert.equal(retainedPlan.handle.side, "left");

  const leftUnsafe = nextRevision(
    { ...centered, controller: retainedPlan.controller },
    [],
    { x: -1890, y: 300, width: 144, height: 32 }
  );
  const switchedPlan = planHudWindows(leftUnsafe);
  assert.equal(switchedPlan.handle.side, "right");
});

test("a host exclusion on the retained side moves the handle to the opposite safe side", () => {
  const input = validInput();
  const rightExclusion: HostExclusion = {
    bounds: { x: 550, y: 304, width: 24, height: 24 },
    displayId: "display-1",
    layoutRevision: 12,
    role: "transient",
    surfaceId: "right-blocker",
    surfaceRevision: 1
  };
  const blocked = nextRevision(input, [rightExclusion]);
  const plan = planHudWindows(blocked);

  assert.equal(plan.handle.side, "left");
  assert.deepEqual(plan.handle.bounds, { x: 370, y: 304, width: 24, height: 24 });
});

test("both unsafe handle sides keep exactly one request queued without guessed bounds", () => {
  const initial = validInput();
  const established = planHudWindows(initial);
  const blockers: readonly HostExclusion[] = [
    {
      bounds: { x: 550, y: 304, width: 24, height: 24 },
      displayId: "display-1",
      layoutRevision: 12,
      role: "transient",
      surfaceId: "right-blocker",
      surfaceRevision: 1
    },
    {
      bounds: { x: 370, y: 304, width: 24, height: 24 },
      displayId: "display-1",
      layoutRevision: 12,
      role: "tasks",
      surfaceId: "left-blocker",
      surfaceRevision: 1
    }
  ];
  const blocked = nextRevision(
    { ...initial, controller: withMenuIntent(established.controller) },
    blockers
  );
  const plan = planHudWindows(blocked);
  const repeated = planHudWindows({ ...blocked, controller: plan.controller });

  assert.equal(plan.handle.state, "queued");
  assert.equal(plan.handle.bounds, null);
  assert.equal(plan.menu.state, "queued");
  assert.equal(plan.menu.bounds, null);
  assert.equal(plan.controller.menuIntent, "open-requested");
  assert.deepEqual(repeated, plan);
});

test("a measured menu opens below and clamps horizontally inside the safe work area", () => {
  const input = validInput();
  const edgeInput: WindowPlanInput = {
    ...input,
    geometry: { ...input.geometry, bounds: { x: 20, y: 300, width: 144, height: 32 } }
  };
  const established = planHudWindows(edgeInput);
  const plan = planHudWindows({
    ...edgeInput,
    controller: withMenuIntent(established.controller)
  });

  assert.equal(plan.menu.state, "visible");
  assert.equal(plan.menu.side, "below");
  assert.deepEqual(plan.menu.bounds, { x: 10, y: 338, width: 288, height: 180 });
});

test("a reward Accept exclusion below reverses only the local menu above", () => {
  const input = validInput();
  const established = planHudWindows(input);
  const reward: HostExclusion = {
    bounds: { x: 328, y: 338, width: 288, height: 180 },
    displayId: "display-1",
    layoutRevision: 12,
    role: "reward",
    surfaceId: "reward-with-accept",
    surfaceRevision: 1
  };
  const withPopup = nextRevision(
    { ...input, controller: withMenuIntent(established.controller) },
    [reward]
  );
  const plan = planHudWindows(withPopup);

  assert.equal(plan.menu.side, "above");
  assert.deepEqual(plan.menu.bounds, { x: 328, y: 114, width: 288, height: 180 });
  assert.equal(rectanglesIntersect(plan.menu.bounds!, reward.bounds), false);
  assert.equal(rectanglesIntersect(plan.handle.bounds!, reward.bounds), false);
});

test("no safe vertical rectangle keeps the existing menu request queued and hidden", () => {
  const input = validInput();
  const compact: WindowPlanInput = {
    ...input,
    display: { ...input.display, bounds: { x: 0, y: 0, width: 800, height: 300 } },
    geometry: { ...input.geometry, bounds: { x: 320, y: 134, width: 144, height: 32 } },
    measuredMenu: { width: 288, height: 120 }
  };
  const established = planHudWindows(compact);
  const plan = planHudWindows({
    ...compact,
    controller: withMenuIntent(established.controller)
  });

  assert.equal(plan.handle.state, "visible");
  assert.equal(plan.menu.state, "queued");
  assert.equal(plan.menu.bounds, null);
  assert.equal(plan.controller.menuIntent, "open-requested");
});

test("queued intent resolves only after a matching current exclusion revision becomes safe", () => {
  const input = validInput();
  const established = planHudWindows(input);
  const blockers: readonly HostExclusion[] = [
    {
      bounds: { x: 550, y: 304, width: 24, height: 24 },
      displayId: "display-1",
      layoutRevision: 12,
      role: "transient",
      surfaceId: "right-blocker",
      surfaceRevision: 1
    },
    {
      bounds: { x: 370, y: 304, width: 24, height: 24 },
      displayId: "display-1",
      layoutRevision: 12,
      role: "transient",
      surfaceId: "left-blocker",
      surfaceRevision: 1
    }
  ];
  const blockedInput = nextRevision(
    { ...input, controller: withMenuIntent(established.controller) },
    blockers
  );
  const queued = planHudWindows(blockedInput);
  const restoredInput = nextRevision({ ...blockedInput, controller: queued.controller }, []);
  const restored = planHudWindows(restoredInput);

  assert.equal(queued.menu.state, "queued");
  assert.equal(restored.handle.state, "visible");
  assert.equal(restored.menu.state, "visible");
});

test("preempted and unproven stacking hide and inert every local role and cancel intent", () => {
  const input = validInput();
  const established = planHudWindows(input);

  for (const state of ["preempted", "unproven"] as const) {
    const plan = planHudWindows({
      ...input,
      controller: withMenuIntent(established.controller),
      stacking: { connectionId: null, exclusionRevision: null, layoutRevision: null, state }
    });

    assert.equal(plan.outline.visible, false);
    assert.equal(plan.outline.interactive, false);
    assert.equal(plan.handle.visible, false);
    assert.equal(plan.handle.interactive, false);
    assert.equal(plan.menu.visible, false);
    assert.equal(plan.menu.interactive, false);
    assert.equal(plan.controller.menuIntent, "closed");
  }
});

test("disconnect cancels intent and reconnect with fresh geometry restores passive presentation only", () => {
  const input = validInput();
  const established = planHudWindows(input);
  const disconnected = planHudWindows({
    ...input,
    controller: withMenuIntent(established.controller),
    stacking: { connectionId: null, exclusionRevision: null, layoutRevision: null, state: "disconnected" }
  });
  const reconnected = planHudWindows({ ...input, controller: disconnected.controller });

  assert.equal(disconnected.controller.connectionId, null);
  assert.equal(disconnected.controller.menuIntent, "closed");
  assert.equal(reconnected.outline.visible, true);
  assert.equal(reconnected.handle.visible, true);
  assert.equal(reconnected.menu.state, "closed");
  assert.equal(reconnected.controller.retainedHandleSide, "right");
});

test("stale, hidden, and mode-width-invalid geometry fail closed", () => {
  const input = validInput();
  const cases: readonly [WindowPlanInput, string][] = [
    [{ ...input, nowMs: 201 }, "stale-geometry"],
    [{ ...input, geometry: { ...input.geometry, visible: false } }, "geometry-hidden"],
    [
      { ...input, geometry: { ...input.geometry, bounds: { ...input.geometry.bounds, width: 173 } } },
      "invalid-geometry"
    ]
  ];

  for (const [candidate, reason] of cases) {
    const plan = planHudWindows(candidate);
    assert.equal(plan.reason, reason);
    assert.equal(plan.outline.visible, false);
    assert.equal(plan.handle.visible, false);
    assert.equal(plan.menu.visible, false);
  }
});

test("layout, display, stacking, and exclusion revisions must match exactly", () => {
  const input = validInput();
  const mismatches: readonly WindowPlanInput[] = [
    { ...input, exclusions: { ...input.exclusions, layoutRevision: 12 } },
    { ...input, exclusions: { ...input.exclusions, displayId: "display-2" } },
    { ...input, stacking: { ...input.stacking, exclusionRevision: 8 } },
    { ...input, exclusions: { ...input.exclusions, hudRevision: 6 } }
  ];

  for (const mismatch of mismatches) {
    const plan = planHudWindows(mismatch);
    assert.equal(plan.reason, "revision-mismatch");
    assert.equal(plan.handle.visible, false);
    assert.equal(plan.menu.visible, false);
  }
});

test("duplicate, discontinuous, or invalid exclusions reject the complete set", () => {
  const input = validInput();
  const exclusion: HostExclusion = {
    bounds: { x: 0, y: 0, width: 20, height: 20 },
    displayId: "display-1",
    layoutRevision: 11,
    role: "transient",
    surfaceId: "duplicate",
    surfaceRevision: 1
  };
  const cases: readonly WindowPlanInput[] = [
    { ...input, exclusions: { ...input.exclusions, continuous: false } },
    { ...input, exclusions: { ...input.exclusions, exclusions: [exclusion, exclusion] } },
    {
      ...input,
      exclusions: {
        ...input.exclusions,
        exclusions: [{ ...exclusion, bounds: { ...exclusion.bounds, width: Number.NaN } }]
      }
    }
  ];

  for (const candidate of cases) {
    const plan = planHudWindows(candidate);
    assert.equal(plan.reason, "invalid-exclusions");
    assert.equal(plan.outline.visible, false);
    assert.equal(plan.handle.visible, false);
  }
});

test("revision and per-surface regression hide local roles without applying stale rectangles", () => {
  const input = validInput();
  const exclusion: HostExclusion = {
    bounds: { x: 900, y: 600, width: 20, height: 20 },
    displayId: "display-1",
    layoutRevision: 12,
    role: "transient",
    surfaceId: "surface-1",
    surfaceRevision: 3
  };
  const currentInput = nextRevision(input, [exclusion]);
  const current = planHudWindows(currentInput);
  const regressed = nextRevision(
    { ...currentInput, controller: withMenuIntent(current.controller) },
    [{ ...exclusion, surfaceRevision: 2 }]
  );
  const plan = planHudWindows(regressed);

  assert.equal(plan.reason, "revision-mismatch");
  assert.equal(plan.outline.visible, false);
  assert.equal(plan.handle.visible, false);
  assert.equal(plan.menu.state, "queued");
  assert.equal(plan.menu.bounds, null);
});

test("an invalid measured surface never produces a guessed menu or interactive window", () => {
  const input = validInput();
  const plan = planHudWindows({ ...input, measuredMenu: { width: Number.POSITIVE_INFINITY, height: 180 } });

  assert.equal(plan.reason, "invalid-menu-size");
  assert.equal(plan.outline.visible, false);
  assert.equal(plan.handle.visible, false);
  assert.equal(plan.menu.visible, false);
});

test("unknown fields, controller values, and stacking states fail closed", () => {
  const input = validInput();
  const geometryWithUnknownKey = {
    ...input.geometry,
    unexpected: "not-part-of-hud-geometry"
  } as unknown as WindowPlanInput["geometry"];
  const invalidController = {
    ...input.controller,
    menuIntent: "unexpected"
  } as unknown as WindowPlanInput["controller"];
  const invalidStacking = {
    ...input.stacking,
    state: "unexpected"
  } as unknown as WindowPlanInput["stacking"];

  const geometryPlan = planHudWindows({ ...input, geometry: geometryWithUnknownKey });
  const controllerPlan = planHudWindows({ ...input, controller: invalidController });
  const stackingPlan = planHudWindows({ ...input, stacking: invalidStacking });

  assert.equal(geometryPlan.reason, "invalid-geometry");
  assert.equal(controllerPlan.reason, "invalid-controller");
  assert.equal(stackingPlan.reason, "invalid-stacking");
  for (const plan of [geometryPlan, controllerPlan, stackingPlan]) {
    assert.equal(plan.outline.visible, false);
    assert.equal(plan.handle.interactive, false);
    assert.equal(plan.menu.interactive, false);
  }
});
