const outline = requireSvgElement("calibrationOutline");
const outlinePath = requireSvgRectElement("calibrationOutlinePath");
const runtime = window.prometheePomodoroRuntime;

function renderOutline(): void {
  const style = getComputedStyle(document.documentElement);
  const strokeWidth = Number.parseFloat(style.getPropertyValue("--border-outline-progress"));
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0 || width <= strokeWidth || height <= strokeWidth) {
    outlinePath.setAttribute("visibility", "hidden");
    return;
  }

  const inset = strokeWidth / 2;
  outline.setAttribute("viewBox", `0 0 ${width} ${height}`);
  outlinePath.setAttribute("x", String(inset));
  outlinePath.setAttribute("y", String(inset));
  outlinePath.setAttribute("width", String(width - strokeWidth));
  outlinePath.setAttribute("height", String(height - strokeWidth));
  outlinePath.setAttribute("rx", String((height - strokeWidth) / 2));
  outlinePath.removeAttribute("visibility");
}

window.addEventListener("resize", renderOutline);
runtime?.onSnapshot(renderSnapshot);
void runtime?.getState().then(renderSnapshot);
renderOutline();

function renderSnapshot(payload: unknown): void {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
  const runtimeView = (payload as Record<string, unknown>).runtime;
  if (runtimeView === null || typeof runtimeView !== "object" || Array.isArray(runtimeView)) return;
  const view = runtimeView as Record<string, unknown>;
  const progress = typeof view.progress === "number" && Number.isFinite(view.progress)
    ? Math.min(1, Math.max(0, view.progress))
    : 0;
  document.documentElement.style.setProperty("--runtime-progress", String(progress));
  if (typeof view.phase === "string") document.documentElement.dataset.phase = view.phase;
}

function requireSvgElement(id: string): SVGSVGElement {
  const element = document.getElementById(id);
  if (!(element instanceof SVGSVGElement)) {
    throw new Error("Calibration outline structure is unavailable.");
  }
  return element;
}

function requireSvgRectElement(id: string): SVGRectElement {
  const element = document.getElementById(id);
  if (!(element instanceof SVGRectElement)) {
    throw new Error("Calibration outline structure is unavailable.");
  }
  return element;
}
