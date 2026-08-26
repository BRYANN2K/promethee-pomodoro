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

function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: electron.IpcRendererEvent, payload: unknown) => listener(payload);
  electron.ipcRenderer.on(channel, handler);
  return () => electron.ipcRenderer.removeListener(channel, handler);
}

electron.contextBridge.exposeInMainWorld("prometheePomodoroRuntime", runtimeApi);
export {};
