import electron = require("electron");

const runtimeApi = Object.freeze({
  checkUpdate: () => electron.ipcRenderer.invoke("runtime:check-update") as Promise<unknown>,
  closeMenu: () => electron.ipcRenderer.send("runtime:close-menu"),
  getState: () => electron.ipcRenderer.invoke("runtime:get-state") as Promise<unknown>,
  getTimeHistory: (offset = 0) => electron.ipcRenderer.invoke("runtime:get-time-history", offset) as Promise<unknown>,
  completeOnboarding: () => electron.ipcRenderer.invoke("runtime:complete-onboarding") as Promise<unknown>,
  measureMenu: (measurement: { readonly height: number; readonly width: number }) => electron.ipcRenderer.send("runtime:measure-menu", measurement),
  onMenuState: (listener: (open: boolean) => void) => {
    const handler = (_event: electron.IpcRendererEvent, open: unknown) => {
      if (typeof open === "boolean") {
        listener(open);
      }
    };
    electron.ipcRenderer.on("runtime:menu-state", handler);
    return () => electron.ipcRenderer.removeListener("runtime:menu-state", handler);
  },
  onPreferences: (listener: (preferences: unknown) => void) => subscribe("runtime:preferences", listener),
  onSnapshot: (listener: (snapshot: unknown) => void) => subscribe("runtime:snapshot", listener),
  onTasks: (listener: (tasks: unknown) => void) => subscribe("runtime:tasks", listener),
  onTimeHistory: (listener: (history: unknown) => void) => subscribe("runtime:time-history", listener),
  openRelease: (url: string) => electron.ipcRenderer.invoke("runtime:open-release", url) as Promise<unknown>,
  openPermissionSettings: (permission: "input-events" | "screen-capture") => electron.ipcRenderer.invoke("runtime:open-permission-settings", permission) as Promise<unknown>,
  refreshPermissions: () => electron.ipcRenderer.invoke("runtime:refresh-permissions") as Promise<unknown>,
  requestPermissions: () => electron.ipcRenderer.invoke("runtime:request-permissions") as Promise<unknown>,
  refreshTasks: () => electron.ipcRenderer.invoke("runtime:refresh-tasks") as Promise<unknown>,
  restartPhase: () => electron.ipcRenderer.invoke("runtime:restart-phase") as Promise<unknown>,
  skipPhase: () => electron.ipcRenderer.invoke("runtime:skip-phase") as Promise<unknown>,
  deleteTimeEntry: (entryId: string) => electron.ipcRenderer.invoke("runtime:delete-time-entry", entryId) as Promise<unknown>,
  dismissOnboarding: () => electron.ipcRenderer.invoke("runtime:dismiss-onboarding") as Promise<unknown>,
  exportTimeCsv: () => electron.ipcRenderer.invoke("runtime:export-time-csv") as Promise<unknown>,
  saveSettings: (settings: unknown) => electron.ipcRenderer.invoke("runtime:save-settings", settings) as Promise<unknown>,
  selectTask: (taskId: string | null) => electron.ipcRenderer.invoke("runtime:select-task", taskId) as Promise<unknown>,
  toggleMenu: () => electron.ipcRenderer.send("runtime:toggle-menu")
});

// On the sessions that wait for a compositor, every page starts blank, because a
// page that draws before its window has been placed draws in the wrong place.
// Clearing that is the same work in all three pages and none of their business,
// so the bridge does it rather than handing each renderer a placement to think
// about. Nothing here runs anywhere else: the flag is only handed to the windows
// of a session that needs it, so the pages ship unchanged for every platform
// where a window places itself and none of them ever starts blank.
// The spelling is `PLACEMENT_PENDING_ARGUMENT` in `linux-surface-attachment.ts`.
if (process.argv.includes("--promethee-placement-pending")) {
  let placed = false;
  const applyPlacement = (): void => {
    const root = document.documentElement;
    // A preload runs before the parser has built the document root, so the first
    // call has nothing to mark and the `readystatechange` below is what marks it.
    if (root === null) return;
    if (placed) root.removeAttribute("data-placement");
    else root.setAttribute("data-placement", "pending");
  };
  applyPlacement();
  // The parser fires this without giving the frame back, so the page is marked
  // before it can be painted. Waiting for `DOMContentLoaded` would not be: the
  // observers of the document root are only delivered once that has been raised.
  document.addEventListener("readystatechange", applyPlacement);
  electron.ipcRenderer.on("runtime:placement", (_event: electron.IpcRendererEvent, settled: unknown) => {
    // Remembered rather than applied, because a placement can be confirmed while
    // the root is still missing and the page would then be blanked again by the
    // next call rather than shown.
    placed = settled === true;
    applyPlacement();
  });
}

function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: electron.IpcRendererEvent, payload: unknown) => listener(payload);
  electron.ipcRenderer.on(channel, handler);
  return () => electron.ipcRenderer.removeListener(channel, handler);
}

electron.contextBridge.exposeInMainWorld("prometheePomodoroRuntime", runtimeApi);
export {};
