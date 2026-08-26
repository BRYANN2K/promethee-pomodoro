export const WINDOW_LAYOUT_CONSTANTS = Object.freeze({
  handleGap: 6,
  handleSize: 24,
  hudHeight: 32,
  hudPausedWidth: 173,
  hudRunningWidth: 144,
  outlineOutset: 2,
  safeMargin: 10
});

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type HudMode = "paused" | "running";
export type HandleSide = "left" | "right";
export type MenuSide = "above" | "below";
export type MenuIntent = "closed" | "open-requested";
export type StackingState = "disconnected" | "preempted" | "proven" | "unproven";
export type HostExclusionRole = "overtime" | "reward" | "tasks" | "transient";

export interface HudGeometry {
  readonly connectionId: string;
  readonly coordinateSpace: "screen-dip";
  readonly displayId: string;
  readonly exclusionRevision: number;
  readonly expiresAtMs: number;
  readonly hudRevision: number;
  readonly layoutRevision: number;
  readonly mode: HudMode;
  readonly observedAtMs: number;
  readonly scaleFactor: number;
  readonly visible: boolean;
  readonly bounds: Rect;
}

export interface DisplayWorkArea {
  readonly coordinateSpace: "screen-dip";
  readonly displayId: string;
  readonly scaleFactor: number;
  readonly bounds: Rect;
}

export interface HostExclusion {
  readonly bounds: Rect;
  readonly displayId: string;
  readonly layoutRevision: number;
  readonly role: HostExclusionRole;
  readonly surfaceId: string;
  readonly surfaceRevision: number;
}

export interface ExclusionSnapshot {
  readonly atSequence: number;
  readonly connectionId: string;
  readonly continuous: boolean;
  readonly coordinateSpace: "screen-dip";
  readonly displayId: string;
  readonly exclusions: readonly HostExclusion[];
  readonly hudRevision: number;
  readonly layoutRevision: number;
  readonly revision: number;
}

export interface StackingSafety {
  readonly connectionId: string | null;
  readonly exclusionRevision: number | null;
  readonly layoutRevision: number | null;
  readonly state: StackingState;
}

export interface WindowControllerState {
  readonly appliedExclusionRevision: number | null;
  readonly appliedHudRevision: number | null;
  readonly appliedLayoutRevision: number | null;
  readonly appliedSequence: number | null;
  readonly connectionId: string | null;
  readonly menuIntent: MenuIntent;
  readonly retainedHandleSide: HandleSide | null;
  readonly surfaceRevisions: Readonly<Record<string, number>>;
}

export interface WindowPlanInput {
  readonly controller: WindowControllerState;
  readonly display: DisplayWorkArea;
  readonly exclusions: ExclusionSnapshot;
  readonly geometry: HudGeometry;
  readonly menuPreference: MenuSide;
  readonly measuredMenu: Size;
  readonly nowMs: number;
  readonly stacking: StackingSafety;
}

export type WindowPlanReason =
  | "disconnected"
  | "geometry-hidden"
  | "host-preempted"
  | "invalid-controller"
  | "invalid-exclusions"
  | "invalid-geometry"
  | "invalid-input"
  | "invalid-menu-preference"
  | "invalid-menu-size"
  | "invalid-stacking"
  | "invalid-work-area"
  | "ready"
  | "revision-mismatch"
  | "stacking-unproven"
  | "stale-geometry";

export interface OutlineWindowPlan {
  readonly bounds: Rect | null;
  readonly inputMode: "click-through";
  readonly interactive: false;
  readonly visible: boolean;
}

export interface HandleWindowPlan {
  readonly bounds: Rect | null;
  readonly interactive: boolean;
  readonly side: HandleSide | null;
  readonly state: "hidden" | "queued" | "visible";
  readonly visible: boolean;
}

export interface MenuWindowPlan {
  readonly bounds: Rect | null;
  readonly interactive: boolean;
  readonly side: MenuSide | null;
  readonly state: "closed" | "hidden" | "queued" | "visible";
  readonly visible: boolean;
}

export interface WindowPlan {
  readonly controller: WindowControllerState;
  readonly eligibility: "hidden" | "interactive" | "passive";
  readonly handle: HandleWindowPlan;
  readonly menu: MenuWindowPlan;
  readonly outline: OutlineWindowPlan;
  readonly reason: WindowPlanReason;
}

export function createWindowControllerState(): WindowControllerState {
  return Object.freeze({
    appliedExclusionRevision: null,
    appliedHudRevision: null,
    appliedLayoutRevision: null,
    appliedSequence: null,
    connectionId: null,
    menuIntent: "closed",
    retainedHandleSide: null,
    surfaceRevisions: Object.freeze({})
  });
}

export function planHudWindows(input: WindowPlanInput): WindowPlan {
  if (!hasExactKeys(input, ["controller", "display", "exclusions", "geometry", "menuPreference", "measuredMenu", "nowMs", "stacking"])) {
    return hiddenPlan("invalid-input", createWindowControllerState(), false);
  }
  if (!isControllerValid(input.controller)) {
    return hiddenPlan("invalid-controller", createWindowControllerState(), false);
  }
  if (!isStackingValid(input.stacking)) {
    return hiddenPlan("invalid-stacking", createWindowControllerState(), false);
  }
  if (input.stacking.state === "disconnected") {
    return hiddenPlan("disconnected", createWindowControllerState(), false);
  }
  if (input.stacking.state === "preempted") {
    return hiddenPlan("host-preempted", createWindowControllerState(), false);
  }
  if (input.stacking.state === "unproven") {
    return hiddenPlan("stacking-unproven", createWindowControllerState(), false);
  }

  const geometryFailure = validateGeometry(input.geometry, input.nowMs);
  if (geometryFailure !== null) {
    return hiddenPlan(geometryFailure, createWindowControllerState(), false);
  }

  if (!input.geometry.visible) {
    return hiddenPlan("geometry-hidden", createWindowControllerState(), false);
  }

  if (!isDisplayValid(input.display) || !rectContains(input.display.bounds, input.geometry.bounds)) {
    return hiddenPlan("invalid-work-area", createWindowControllerState(), false);
  }

  if (!isSizeValid(input.measuredMenu)) {
    return hiddenPlan("invalid-menu-size", createWindowControllerState(), false);
  }
  if (input.menuPreference !== "above" && input.menuPreference !== "below") {
    return hiddenPlan("invalid-menu-preference", createWindowControllerState(), false);
  }

  const sameConnection = input.controller.connectionId === input.geometry.connectionId;
  const effectiveController = sameConnection ? input.controller : createWindowControllerState();
  const exclusionFailure = validateExclusions(input, effectiveController, sameConnection);
  if (exclusionFailure !== null) {
    const controller = sameConnection ? effectiveController : createWindowControllerState();
    const preserveIntent = exclusionFailure === "revision-mismatch";
    return hiddenPlan(exclusionFailure, controller, preserveIntent);
  }

  const preferredHandleSide = effectiveController.retainedHandleSide ?? "right";
  const oppositeHandleSide: HandleSide = preferredHandleSide === "right" ? "left" : "right";
  const preferredHandle = handleCandidate(input.geometry.bounds, preferredHandleSide);
  const oppositeHandle = handleCandidate(input.geometry.bounds, oppositeHandleSide);
  const exclusions = input.exclusions.exclusions.map((entry) => entry.bounds);

  let handleBounds: Rect | null = null;
  let handleSide: HandleSide | null = null;
  if (isPlacementSafe(preferredHandle, input.display.bounds, input.geometry.bounds, exclusions)) {
    handleBounds = preferredHandle;
    handleSide = preferredHandleSide;
  } else if (isPlacementSafe(oppositeHandle, input.display.bounds, input.geometry.bounds, exclusions)) {
    handleBounds = oppositeHandle;
    handleSide = oppositeHandleSide;
  }

  const retainedHandleSide = handleSide ?? preferredHandleSide;
  const menuIntent = sameConnection ? input.controller.menuIntent : "closed";
  const controller = nextController(input, retainedHandleSide, menuIntent);
  const outlineBounds = outsetRect(input.geometry.bounds, WINDOW_LAYOUT_CONSTANTS.outlineOutset);

  if (handleBounds === null || handleSide === null) {
    return Object.freeze({
      controller,
      eligibility: "passive",
      handle: hiddenHandle("queued"),
      menu: menuIntent === "open-requested" ? hiddenMenu("queued") : hiddenMenu("closed"),
      outline: visibleOutline(outlineBounds),
      reason: "ready"
    });
  }

  const handle = Object.freeze({
    bounds: freezeRect(handleBounds),
    interactive: true,
    side: handleSide,
    state: "visible" as const,
    visible: true
  });

  if (menuIntent === "closed") {
    return Object.freeze({
      controller,
      eligibility: "interactive",
      handle,
      menu: hiddenMenu("closed"),
      outline: visibleOutline(outlineBounds),
      reason: "ready"
    });
  }

  const preferredMenu = menuCandidate(input, input.menuPreference);
  const oppositeMenuSide: MenuSide = input.menuPreference === "below" ? "above" : "below";
  const oppositeMenu = menuCandidate(input, oppositeMenuSide);
  let menuBounds: Rect | null = null;
  let menuSide: MenuSide | null = null;

  if (preferredMenu !== null && isPlacementSafe(preferredMenu, input.display.bounds, input.geometry.bounds, exclusions)) {
    menuBounds = preferredMenu;
    menuSide = input.menuPreference;
  } else if (oppositeMenu !== null && isPlacementSafe(oppositeMenu, input.display.bounds, input.geometry.bounds, exclusions)) {
    menuBounds = oppositeMenu;
    menuSide = oppositeMenuSide;
  }

  if (menuBounds === null || menuSide === null) {
    return Object.freeze({
      controller,
      eligibility: "interactive",
      handle,
      menu: hiddenMenu("queued"),
      outline: visibleOutline(outlineBounds),
      reason: "ready"
    });
  }

  return Object.freeze({
    controller,
    eligibility: "interactive",
    handle,
    menu: Object.freeze({
      bounds: freezeRect(menuBounds),
      interactive: true,
      side: menuSide,
      state: "visible" as const,
      visible: true
    }),
    outline: visibleOutline(outlineBounds),
    reason: "ready"
  });
}

export function rectanglesIntersect(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function validateGeometry(geometry: HudGeometry, nowMs: number): WindowPlanReason | null {
  const expectedWidth =
    geometry.mode === "running"
      ? WINDOW_LAYOUT_CONSTANTS.hudRunningWidth
      : WINDOW_LAYOUT_CONSTANTS.hudPausedWidth;

  if (
    !hasExactKeys(geometry, [
      "bounds",
      "connectionId",
      "coordinateSpace",
      "displayId",
      "exclusionRevision",
      "expiresAtMs",
      "hudRevision",
      "layoutRevision",
      "mode",
      "observedAtMs",
      "scaleFactor",
      "visible"
    ]) ||
    !hasIdentity(geometry.connectionId) ||
    !hasIdentity(geometry.displayId) ||
    geometry.coordinateSpace !== "screen-dip" ||
    !isRevision(geometry.exclusionRevision) ||
    !isRevision(geometry.hudRevision) ||
    !isRevision(geometry.layoutRevision) ||
    (geometry.mode !== "running" && geometry.mode !== "paused") ||
    typeof geometry.visible !== "boolean" ||
    !isFiniteNumber(geometry.scaleFactor) ||
    geometry.scaleFactor <= 0 ||
    !isRectValid(geometry.bounds) ||
    geometry.bounds.height !== WINDOW_LAYOUT_CONSTANTS.hudHeight ||
    geometry.bounds.width !== expectedWidth ||
    !isFiniteNumber(geometry.observedAtMs) ||
    !isFiniteNumber(geometry.expiresAtMs) ||
    geometry.expiresAtMs < geometry.observedAtMs ||
    !isFiniteNumber(nowMs) ||
    nowMs < geometry.observedAtMs
  ) {
    return "invalid-geometry";
  }

  return nowMs > geometry.expiresAtMs ? "stale-geometry" : null;
}

function isDisplayValid(display: DisplayWorkArea): boolean {
  return (
    hasExactKeys(display, ["bounds", "coordinateSpace", "displayId", "scaleFactor"]) &&
    hasIdentity(display.displayId) &&
    display.coordinateSpace === "screen-dip" &&
    isFiniteNumber(display.scaleFactor) &&
    display.scaleFactor > 0 &&
    isRectValid(display.bounds)
  );
}

function validateExclusions(
  input: WindowPlanInput,
  controller: WindowControllerState,
  sameConnection: boolean
): "invalid-exclusions" | "revision-mismatch" | null {
  const snapshot = input.exclusions;
  const geometry = input.geometry;
  const stacking = input.stacking;
  const roles = new Set<HostExclusionRole>(["overtime", "reward", "tasks", "transient"]);

  if (
    !hasExactKeys(snapshot, [
      "atSequence",
      "connectionId",
      "continuous",
      "coordinateSpace",
      "displayId",
      "exclusions",
      "hudRevision",
      "layoutRevision",
      "revision"
    ]) ||
    !hasIdentity(snapshot.connectionId) ||
    !hasIdentity(snapshot.displayId) ||
    snapshot.coordinateSpace !== "screen-dip" ||
    !isRevision(snapshot.atSequence) ||
    !isRevision(snapshot.hudRevision) ||
    !isRevision(snapshot.layoutRevision) ||
    !isRevision(snapshot.revision) ||
    snapshot.continuous !== true ||
    !Array.isArray(snapshot.exclusions) ||
    input.display.displayId !== geometry.displayId ||
    input.display.scaleFactor !== geometry.scaleFactor
  ) {
    return "invalid-exclusions";
  }

  if (
    snapshot.connectionId !== geometry.connectionId ||
    snapshot.displayId !== geometry.displayId ||
    snapshot.hudRevision !== geometry.hudRevision ||
    snapshot.layoutRevision !== geometry.layoutRevision ||
    snapshot.revision !== geometry.exclusionRevision ||
    stacking.connectionId !== geometry.connectionId ||
    stacking.layoutRevision !== geometry.layoutRevision ||
    stacking.exclusionRevision !== geometry.exclusionRevision
  ) {
    return "revision-mismatch";
  }

  const ids = new Set<string>();
  for (const exclusion of snapshot.exclusions) {
    if (
      !hasExactKeys(exclusion, [
        "bounds",
        "displayId",
        "layoutRevision",
        "role",
        "surfaceId",
        "surfaceRevision"
      ]) ||
      !hasIdentity(exclusion.surfaceId) ||
      ids.has(exclusion.surfaceId) ||
      !roles.has(exclusion.role) ||
      exclusion.displayId !== geometry.displayId ||
      exclusion.layoutRevision !== geometry.layoutRevision ||
      !isRevision(exclusion.surfaceRevision) ||
      !isRectValid(exclusion.bounds)
    ) {
      return "invalid-exclusions";
    }
    ids.add(exclusion.surfaceId);
  }

  if (!sameConnection) {
    return null;
  }

  if (
    isRegression(snapshot.revision, controller.appliedExclusionRevision) ||
    isRegression(snapshot.hudRevision, controller.appliedHudRevision) ||
    isRegression(snapshot.layoutRevision, controller.appliedLayoutRevision) ||
    isRegression(snapshot.atSequence, controller.appliedSequence)
  ) {
    return "revision-mismatch";
  }

  for (const exclusion of snapshot.exclusions) {
    const previousRevision = controller.surfaceRevisions[exclusion.surfaceId];
    if (previousRevision !== undefined && exclusion.surfaceRevision < previousRevision) {
      return "revision-mismatch";
    }
  }

  if (
    controller.appliedExclusionRevision === snapshot.revision &&
    (controller.appliedSequence !== snapshot.atSequence ||
      !sameSurfaceRevisions(controller.surfaceRevisions, snapshot.exclusions))
  ) {
    return "revision-mismatch";
  }

  return null;
}

function nextController(
  input: WindowPlanInput,
  retainedHandleSide: HandleSide,
  menuIntent: MenuIntent
): WindowControllerState {
  const surfaceRevisions: Record<string, number> = {};
  for (const exclusion of input.exclusions.exclusions) {
    surfaceRevisions[exclusion.surfaceId] = exclusion.surfaceRevision;
  }

  return Object.freeze({
    appliedExclusionRevision: input.exclusions.revision,
    appliedHudRevision: input.exclusions.hudRevision,
    appliedLayoutRevision: input.exclusions.layoutRevision,
    appliedSequence: input.exclusions.atSequence,
    connectionId: input.geometry.connectionId,
    menuIntent,
    retainedHandleSide,
    surfaceRevisions: Object.freeze(surfaceRevisions)
  });
}

function hiddenPlan(
  reason: WindowPlanReason,
  controller: WindowControllerState,
  preserveIntent: boolean
): WindowPlan {
  const menuIntent: MenuIntent = preserveIntent ? controller.menuIntent : "closed";
  const next = Object.freeze({ ...controller, menuIntent });
  return Object.freeze({
    controller: next,
    eligibility: "hidden",
    handle: hiddenHandle("hidden"),
    menu: menuIntent === "open-requested" ? hiddenMenu("queued") : hiddenMenu("hidden"),
    outline: hiddenOutline(),
    reason
  });
}

function visibleOutline(bounds: Rect): OutlineWindowPlan {
  return Object.freeze({
    bounds: freezeRect(bounds),
    inputMode: "click-through",
    interactive: false,
    visible: true
  });
}

function hiddenOutline(): OutlineWindowPlan {
  return Object.freeze({ bounds: null, inputMode: "click-through", interactive: false, visible: false });
}

function hiddenHandle(state: "hidden" | "queued"): HandleWindowPlan {
  return Object.freeze({ bounds: null, interactive: false, side: null, state, visible: false });
}

function hiddenMenu(state: "closed" | "hidden" | "queued"): MenuWindowPlan {
  return Object.freeze({ bounds: null, interactive: false, side: null, state, visible: false });
}

function handleCandidate(hud: Rect, side: HandleSide): Rect {
  const x =
    side === "right"
      ? hud.x + hud.width + WINDOW_LAYOUT_CONSTANTS.handleGap
      : hud.x - WINDOW_LAYOUT_CONSTANTS.handleGap - WINDOW_LAYOUT_CONSTANTS.handleSize;
  const y = hud.y + (hud.height - WINDOW_LAYOUT_CONSTANTS.handleSize) / 2;
  return freezeRect({
    x,
    y,
    width: WINDOW_LAYOUT_CONSTANTS.handleSize,
    height: WINDOW_LAYOUT_CONSTANTS.handleSize
  });
}

function menuCandidate(input: WindowPlanInput, side: MenuSide): Rect | null {
  const safeLeft = input.display.bounds.x + WINDOW_LAYOUT_CONSTANTS.safeMargin;
  const safeRight = input.display.bounds.x + input.display.bounds.width - WINDOW_LAYOUT_CONSTANTS.safeMargin;
  if (input.measuredMenu.width > safeRight - safeLeft) {
    return null;
  }

  const centeredX =
    input.geometry.bounds.x + (input.geometry.bounds.width - input.measuredMenu.width) / 2;
  const x = clamp(centeredX, safeLeft, safeRight - input.measuredMenu.width);
  const y =
    side === "below"
      ? input.geometry.bounds.y + input.geometry.bounds.height + WINDOW_LAYOUT_CONSTANTS.handleGap
      : input.geometry.bounds.y - WINDOW_LAYOUT_CONSTANTS.handleGap - input.measuredMenu.height;
  return freezeRect({ x, y, width: input.measuredMenu.width, height: input.measuredMenu.height });
}

function isPlacementSafe(
  candidate: Rect,
  workArea: Rect,
  hud: Rect,
  exclusions: readonly Rect[]
): boolean {
  const safeArea = insetRect(workArea, WINDOW_LAYOUT_CONSTANTS.safeMargin);
  return (
    rectContains(safeArea, candidate) &&
    !rectanglesIntersect(candidate, hud) &&
    exclusions.every((exclusion) => !rectanglesIntersect(candidate, exclusion))
  );
}

function insetRect(rect: Rect, amount: number): Rect {
  return freezeRect({
    x: rect.x + amount,
    y: rect.y + amount,
    width: rect.width - amount * 2,
    height: rect.height - amount * 2
  });
}

function outsetRect(rect: Rect, amount: number): Rect {
  return freezeRect({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  });
}

function rectContains(container: Rect, child: Rect): boolean {
  return (
    child.x >= container.x &&
    child.y >= container.y &&
    child.x + child.width <= container.x + container.width &&
    child.y + child.height <= container.y + container.height
  );
}

function sameSurfaceRevisions(
  previous: Readonly<Record<string, number>>,
  current: readonly HostExclusion[]
): boolean {
  const previousIds = Object.keys(previous);
  return (
    previousIds.length === current.length &&
    current.every((entry) => previous[entry.surfaceId] === entry.surfaceRevision)
  );
}

function isRegression(current: number, previous: number | null): boolean {
  return previous !== null && current < previous;
}

function isSizeValid(size: Size): boolean {
  return (
    hasExactKeys(size, ["height", "width"]) &&
    isFiniteNumber(size.width) &&
    size.width > 0 &&
    isFiniteNumber(size.height) &&
    size.height > 0
  );
}

function isRectValid(rect: Rect): boolean {
  return (
    hasExactKeys(rect, ["height", "width", "x", "y"]) &&
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    rect.width > 0 &&
    isFiniteNumber(rect.height) &&
    rect.height > 0
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasIdentity(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStackingValid(stacking: StackingSafety): boolean {
  return (
    hasExactKeys(stacking, ["connectionId", "exclusionRevision", "layoutRevision", "state"]) &&
    (stacking.state === "disconnected" ||
      stacking.state === "preempted" ||
      stacking.state === "proven" ||
      stacking.state === "unproven")
  );
}

function isControllerValid(controller: WindowControllerState): boolean {
  if (
    !hasExactKeys(controller, [
      "appliedExclusionRevision",
      "appliedHudRevision",
      "appliedLayoutRevision",
      "appliedSequence",
      "connectionId",
      "menuIntent",
      "retainedHandleSide",
      "surfaceRevisions"
    ]) ||
    (controller.menuIntent !== "closed" && controller.menuIntent !== "open-requested") ||
    (controller.retainedHandleSide !== null &&
      controller.retainedHandleSide !== "left" &&
      controller.retainedHandleSide !== "right") ||
    !isRevisionRecord(controller.surfaceRevisions)
  ) {
    return false;
  }

  const applied = [
    controller.appliedExclusionRevision,
    controller.appliedHudRevision,
    controller.appliedLayoutRevision,
    controller.appliedSequence
  ];
  if (controller.connectionId === null) {
    return (
      applied.every((value) => value === null) &&
      controller.menuIntent === "closed" &&
      controller.retainedHandleSide === null &&
      Object.keys(controller.surfaceRevisions).length === 0
    );
  }

  return (
    hasIdentity(controller.connectionId) &&
    applied.every((value) => value !== null && isRevision(value)) &&
    controller.retainedHandleSide !== null
  );
}

function isRevisionRecord(value: unknown): value is Readonly<Record<string, number>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([surfaceId, revision]) => hasIdentity(surfaceId) && isRevision(revision))
  );
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => actualKeys.includes(key));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}
