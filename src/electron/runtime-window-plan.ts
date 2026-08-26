import { rectanglesIntersect, type HandleSide, type MenuSide, type Rect, type Size } from "./window-plan.ts";

const ATTACH_GAP = 6;
const HANDLE_SIZE = 24;
const OUTLINE_OUTSET = 2;
const SAFE_MARGIN = 10;

export interface RuntimeWindowPlanInput {
  readonly exclusions: readonly Rect[];
  readonly menuOpen: boolean;
  readonly menuSize: Size;
  readonly retainedHandleSide: HandleSide | null;
  readonly timer: Rect;
  readonly workArea: Rect;
}

export interface RuntimeWindowPlan {
  readonly handle: { readonly bounds: Rect | null; readonly side: HandleSide };
  readonly menu: { readonly bounds: Rect | null; readonly side: MenuSide | null };
  readonly outline: Rect | null;
}

export function planStandaloneMenuBounds(workArea: Rect, menuSize: Size): Rect | null {
  if (!isRect(workArea) || !isSize(menuSize)) return null;
  const availableWidth = workArea.width - SAFE_MARGIN * 2;
  const availableHeight = workArea.height - SAFE_MARGIN * 2;
  if (availableWidth <= 0 || availableHeight <= 0) return null;
  const width = Math.min(menuSize.width, availableWidth);
  const height = Math.min(menuSize.height, availableHeight);
  return Object.freeze({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  });
}

export function planRuntimeWindows(input: RuntimeWindowPlanInput): RuntimeWindowPlan {
  const retainedSide = input.retainedHandleSide ?? "right";
  if (
    !isRect(input.timer) ||
    !isRect(input.workArea) ||
    !contains(input.workArea, input.timer) ||
    !isSize(input.menuSize) ||
    input.exclusions.some((rect) => !isRect(rect))
  ) {
    return hiddenPlan(retainedSide);
  }

  const exclusions = input.exclusions.filter((rect) => !sameRect(rect, input.timer));
  const oppositeSide: HandleSide = retainedSide === "right" ? "left" : "right";
  const retainedCandidate = handleCandidate(input.timer, retainedSide);
  const oppositeCandidate = handleCandidate(input.timer, oppositeSide);

  let handleBounds: Rect | null = null;
  let handleSide = retainedSide;
  if (isSafe(retainedCandidate, input.workArea, input.timer, exclusions)) {
    handleBounds = retainedCandidate;
  } else if (isSafe(oppositeCandidate, input.workArea, input.timer, exclusions)) {
    handleBounds = oppositeCandidate;
    handleSide = oppositeSide;
  }

  let menuBounds: Rect | null = null;
  let menuSide: MenuSide | null = null;
  if (input.menuOpen && handleBounds !== null) {
    const below = menuCandidate(input.timer, input.menuSize, input.workArea, "below");
    const above = menuCandidate(input.timer, input.menuSize, input.workArea, "above");
    if (isSafe(below, input.workArea, input.timer, exclusions)) {
      menuBounds = below;
      menuSide = "below";
    } else if (isSafe(above, input.workArea, input.timer, exclusions)) {
      menuBounds = above;
      menuSide = "above";
    }
  }

  return Object.freeze({
    handle: Object.freeze({ bounds: freezeRectOrNull(handleBounds), side: handleSide }),
    menu: Object.freeze({ bounds: freezeRectOrNull(menuBounds), side: menuSide }),
    outline: freezeRectOrNull({
      x: input.timer.x - OUTLINE_OUTSET,
      y: input.timer.y - OUTLINE_OUTSET,
      width: input.timer.width + OUTLINE_OUTSET * 2,
      height: input.timer.height + OUTLINE_OUTSET * 2
    })
  });
}

function handleCandidate(timer: Rect, side: HandleSide): Rect {
  return {
    x: side === "right" ? timer.x + timer.width + ATTACH_GAP : timer.x - ATTACH_GAP - HANDLE_SIZE,
    y: timer.y + Math.round((timer.height - HANDLE_SIZE) / 2),
    width: HANDLE_SIZE,
    height: HANDLE_SIZE
  };
}

function menuCandidate(timer: Rect, size: Size, workArea: Rect, side: MenuSide): Rect {
  const minX = workArea.x + SAFE_MARGIN;
  const maxX = workArea.x + workArea.width - SAFE_MARGIN - size.width;
  const centeredX = timer.x + Math.round((timer.width - size.width) / 2);
  return {
    x: Math.min(Math.max(centeredX, minX), maxX),
    y: side === "below" ? timer.y + timer.height + ATTACH_GAP : timer.y - size.height - ATTACH_GAP,
    width: size.width,
    height: size.height
  };
}

function isSafe(candidate: Rect, workArea: Rect, timer: Rect, exclusions: readonly Rect[]): boolean {
  const safeArea = {
    x: workArea.x + SAFE_MARGIN,
    y: workArea.y + SAFE_MARGIN,
    width: workArea.width - SAFE_MARGIN * 2,
    height: workArea.height - SAFE_MARGIN * 2
  };
  return (
    isRect(safeArea) &&
    contains(safeArea, candidate) &&
    !rectanglesIntersect(candidate, timer) &&
    exclusions.every((rect) => !rectanglesIntersect(candidate, rect))
  );
}

function hiddenPlan(retainedSide: HandleSide): RuntimeWindowPlan {
  return Object.freeze({
    handle: Object.freeze({ bounds: null, side: retainedSide }),
    menu: Object.freeze({ bounds: null, side: null }),
    outline: null
  });
}

function contains(container: Rect, contained: Rect): boolean {
  return (
    contained.x >= container.x &&
    contained.y >= container.y &&
    contained.x + contained.width <= container.x + container.width &&
    contained.y + contained.height <= container.y + container.height
  );
}

function sameRect(first: Rect, second: Rect): boolean {
  return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

function isRect(rect: Rect): boolean {
  return (
    Number.isSafeInteger(rect.x) &&
    Number.isSafeInteger(rect.y) &&
    Number.isSafeInteger(rect.width) &&
    Number.isSafeInteger(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isSize(size: Size): boolean {
  return Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height) && size.width > 0 && size.height > 0;
}

function freezeRectOrNull(rect: Rect | null): Rect | null {
  return rect === null ? null : Object.freeze({ ...rect });
}
