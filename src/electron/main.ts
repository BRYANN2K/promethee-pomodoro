import { app, BrowserWindow, dialog, ipcMain, Notification, screen, shell, type Rectangle } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { capturePrometheeHud, probeScreenCaptureTransport } from "./macos-hud-capture.ts";
import {
  createGeometryPollCadence,
  geometryPollDelay,
  nextHudGeneration,
  updateGeometryPollCadence,
  type GeometryPollCadence
} from "./geometry-poll-cadence.ts";
import {
  canArmNativeAutomation,
  effectiveNativeAutomationPermissionStatus,
  nativeAutomationPermissionStatus,
  readNativePrometheeProcessId,
  readNativeAutomationPermissions,
  requestNativeAutomationPermissions,
  requiresNativePermissionRecovery,
  shouldRequestNativePermissionsAtStartup,
  shouldRelaunchAfterScreenPermissionRequest,
  supportsAttachedRuntime,
  supportsNativeAutomation,
  type NativeAutomationPermissionStatus
} from "./native-promethee-bridge.ts";
import { NativePrometheeControl, type PrometheeControlObservation } from "./promethee-control.ts";
import {
  openPrometheeSqlite,
  type PrometheeSessionObservation,
  type PrometheeSqliteReader,
  type PrometheeTaskSnapshotResult
} from "./promethee-sqlite.ts";
import { locatePrometheeTimerContext, type ScreenRect } from "./promethee-window-locator.ts";
import { ExternalPomodoroRuntime, type RuntimeControlAction, type RuntimeView } from "./runtime-controller.ts";
import {
  RuntimePreferenceStore,
  type RuntimePreferences,
  type SelectedTaskReference
} from "./runtime-store.ts";
import { planRuntimeWindows, planStandaloneMenuBounds } from "./runtime-window-plan.ts";
import { checkForReleaseUpdate, openReleasePage } from "./release-update.ts";
import { TaskTimeStore } from "./task-time-store.ts";
import {
  TaskTimeTracker,
  type TaskTimeObservation,
  type TrackedTaskSnapshot
} from "./task-time-tracker.ts";
import type { HandleSide } from "./window-plan.ts";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const SESSION_POLL_INTERVAL_MS = 100;
const PROCESS_POLL_INTERVAL_MS = 2_000;
const TASK_REFRESH_INTERVAL_MS = 5_000;
const TASK_TIME_CHECKPOINT_INTERVAL_MS = 5_000;
const TASK_TIME_RENDER_INTERVAL_MS = 1_000;
const TASK_TIME_RENDER_ENTRY_LIMIT = 100;
const RUNTIME_STALE_AFTER_MS = 3_000;
const CONTROL_OBSERVATION_MAX_AGE_MS = 500;
const DEFAULT_MENU_WIDTH = 348;
const QUIT_CHECKPOINT_TIMEOUT_MS = 750;
const RESTART_PRESENTATION_MS = 500;
const SMOKE_TEST_TIMEOUT_MS = 8_000;
const SMOKE_TEST = process.env.PROMETHEE_POMODORO_SMOKE_TEST === "1";
const SMOKE_TEST_MARKER = "promethee-pomodoro-smoke-ready";
const AUTOMATION_DISABLED = process.env.PROMETHEE_POMODORO_DISABLE_AUTOMATION === "1";
const AUTOMATION_AVAILABLE = !AUTOMATION_DISABLED && supportsNativeAutomation(process.platform);
const DEBUG_RUNTIME = process.env.PROMETHEE_POMODORO_DEBUG === "1";

interface RuntimeContext {
  readonly exclusions: readonly ScreenRect[];
  readonly generation: number;
  readonly processId: number;
  readonly timer: ScreenRect;
  readonly workArea: ScreenRect;
}

let overlayWindow: BrowserWindow | null = null;
let handleWindow: BrowserWindow | null = null;
let menuWindow: BrowserWindow | null = null;
let overlayReady = false;
let handleReady = false;
let menuReady = false;
let pendingOverlayBounds: Rectangle | null = null;
let latestRuntimeContext: RuntimeContext | null = null;
let lastGoodRuntimeAt = 0;
let retainedHandleSide: HandleSide | null = null;
let menuOpen = false;
let runtimeInteractionSuspended = false;
let menuMeasuredHeight = 318;
let menuMeasuredWidth = DEFAULT_MENU_WIDTH;
let geometryPollTimer: NodeJS.Timeout | null = null;
let geometryPollCadence: GeometryPollCadence = createGeometryPollCadence(Date.now());
let processPollTimer: NodeJS.Timeout | null = null;
let sessionPollTimer: NodeJS.Timeout | null = null;
let geometryLookupAbort: AbortController | null = null;
let runtimeGeneration = 0;
let hudGeneration = 0;
let latestProcessId: number | null = null;
let sessionPollBusy = false;
let sessionReader: PrometheeSqliteReader | null = null;
let latestSessionObservation: PrometheeSessionObservation = Object.freeze({ status: "idle", observedAtMs: 0 });
let latestTaskSnapshot: PrometheeTaskSnapshotResult | null = null;
let lastTaskRefreshAt = 0;
let lastTaskTimeCheckpointAt = 0;
let lastTaskTimeRenderAt = 0;
let runtime: ExternalPomodoroRuntime | null = null;
let control: NativePrometheeControl | null = null;
let preferenceStore: RuntimePreferenceStore | null = null;
let preferences: RuntimePreferences | null = null;
let taskTimeStore: TaskTimeStore | null = null;
let taskTimeTracker: TaskTimeTracker | null = null;
let taskTimeStorageStatus: "ready" | "storage-error" = "ready";
let lastRuntimeView: RuntimeView | null = null;
let locale: "en" | "fr" = "en";
let preferenceMutationQueue: Promise<void> = Promise.resolve();
let applicationExitStarted = false;
let applicationRestarting = false;
let nativeAutomationAuthorityGranted = false;
let nativeControlAbortController: AbortController | null = null;
let nativeAutomationPermissions: NativeAutomationPermissionStatus = Object.freeze({
  inputEvents: false,
  screenCapture: false,
  status: AUTOMATION_AVAILABLE ? "denied" : "unavailable",
  supported: AUTOMATION_AVAILABLE
});
let permissionRefreshPromise: Promise<void> | null = null;
let startupPermissionRequestAttempted = false;
let permissionRelaunchScheduled = false;
let runtimeStartPromise: Promise<void> | null = null;
let standaloneMenuReason: "geometry" | "permission" | null = null;

function createOutlineWindow(): BrowserWindow {
  const window = createAttachedWindow({ focusable: false, height: 1, width: 1 }, "runtime-preload.cjs");
  window.setFocusable(false);
  window.setIgnoreMouseEvents(true);
  hardenLocalWindow(window, "overlay.html");
  window.webContents.once("did-finish-load", () => {
    if (overlayWindow !== window || window.isDestroyed()) return;
    overlayReady = true;
    if (pendingOverlayBounds !== null) showOutline(pendingOverlayBounds);
    sendRuntimeSnapshot();
  });
  window.once("closed", () => {
    if (overlayWindow === window) { overlayWindow = null; overlayReady = false; pendingOverlayBounds = null; }
  });
  return window;
}

function createHandleWindow(): BrowserWindow {
  const window = createAttachedWindow({ focusable: true, height: 24, width: 24 }, "runtime-preload.cjs");
  hardenLocalWindow(window, "handle.html");
  window.webContents.once("did-finish-load", () => {
    if (handleWindow !== window || window.isDestroyed()) return;
    handleReady = true;
    sendMenuState();
    sendRuntimeSnapshot();
    applyRuntimePlan(false);
  });
  window.once("closed", () => {
    if (handleWindow === window) { handleWindow = null; handleReady = false; }
  });
  return window;
}

function createMenuWindow(): BrowserWindow {
  const window = createAttachedWindow({ focusable: true, height: menuMeasuredHeight, width: DEFAULT_MENU_WIDTH }, "runtime-preload.cjs");
  hardenLocalWindow(window, "menu.html");
  window.webContents.once("did-finish-load", () => {
    if (menuWindow !== window || window.isDestroyed()) return;
    menuReady = true;
    sendMenuState();
    sendRuntimeSnapshot();
    sendPreferences();
    sendTaskTime();
    refreshTasks(true);
    applyRuntimePlan(false);
  });
  window.once("closed", () => {
    if (menuWindow === window) { menuWindow = null; menuReady = false; menuOpen = false; }
  });
  return window;
}

function createAttachedWindow(size: { focusable: boolean; height: number; width: number }, preloadName: string): BrowserWindow {
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: 0,
    y: 0,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    closable: false,
    focusable: size.focusable,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, preloadName),
      sandbox: true,
      webSecurity: true
    }
  });
  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return window;
}

function hardenLocalWindow(window: BrowserWindow, filename: string): void {
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  const localPath = path.join(currentDirectory, filename);
  const localUrl = pathToFileURL(localPath).toString();
  window.webContents.on("will-navigate", (event, targetUrl) => { if (targetUrl !== localUrl) event.preventDefault(); });
  void window.loadFile(localPath);
}

function installRuntimeIpc(): void {
  ipcMain.on("runtime:toggle-menu", (event) => {
    if (event.sender !== handleWindow?.webContents || !handleWindow.isVisible()) return;
    standaloneMenuReason = null;
    menuOpen = !menuOpen;
    if (!menuOpen) hideRuntimeMenu();
    else if (menuWindow === null) menuWindow = createMenuWindow();
    else refreshTasks(true);
    sendMenuState();
    applyRuntimePlan(menuOpen);
  });
  ipcMain.on("runtime:close-menu", (event) => {
    if (event.sender === menuWindow?.webContents) closeRuntimeMenu();
  });
  ipcMain.on("runtime:measure-menu", (event, measurement: unknown) => {
    if (event.sender !== menuWindow?.webContents || !isMenuMeasurement(measurement)) return;
    menuMeasuredHeight = measurement.height;
    menuMeasuredWidth = measurement.width;
    applyRuntimePlan(false);
  });
  ipcMain.handle("runtime:get-state", (event) => {
    if (event.sender !== menuWindow?.webContents) return null;
    return bootstrapPayload();
  });
  ipcMain.handle("runtime:save-settings", async (event, candidate: unknown) => {
    if (event.sender !== menuWindow?.webContents || runtime === null || preferenceStore === null || preferences === null) return null;
    return enqueuePreferenceMutation(async () => {
      if (runtime === null || preferenceStore === null || preferences === null || !runtime.updateSettings(candidate)) return null;
      const previousSettings = preferences.settings;
      const saved = await preferenceStore.save({ onboardingCompleted: preferences.onboardingCompleted, selectedTask: preferences.selectedTask, settings: runtime.currentSettings });
      if (saved === null) { runtime.updateSettings(previousSettings); return null; }
      preferences = saved;
      reconcilePermissionRecoveryPresentation();
      updateNativeAutomationAuthority();
      sendPreferences();
      sendRuntimeSnapshot();
      applyRuntimePlan(false);
      return preferences;
    });
  });
  ipcMain.handle("runtime:select-task", async (event, taskId: unknown) => {
    if (event.sender !== menuWindow?.webContents || preferenceStore === null || preferences === null) return null;
    let selectedTask: SelectedTaskReference | null = null;
    let trackedTask: TrackedTaskSnapshot | null = null;
    if (taskId !== null) {
      if (typeof taskId !== "string" || latestTaskSnapshot?.status !== "ready") return null;
      const task = latestTaskSnapshot.tasks.find((candidate) => candidate.id === taskId && candidate.status === "open");
      if (task === undefined) return null;
      selectedTask = Object.freeze({ id: task.id, projectId: task.projectId, title: task.title });
      const project = task.projectId === null
        ? null
        : latestTaskSnapshot.projects.find((candidate) => candidate.id === task.projectId) ?? null;
      trackedTask = Object.freeze({
        id: task.id,
        projectId: task.projectId,
        projectTitle: project?.title ?? null,
        title: task.title
      });
    }
    return enqueuePreferenceMutation(async () => {
      if (preferenceStore === null || preferences === null) return null;
      const saved = await preferenceStore.save({ onboardingCompleted: preferences.onboardingCompleted, selectedTask, settings: preferences.settings });
      if (saved === null) return null;
      preferences = saved;
      if (taskTimeTracker !== null) {
        taskTimeTracker.selectTask(trackedTask, currentTaskTimeObservation());
        await checkpointTaskTime(true);
      }
      sendPreferences();
      sendTaskTime();
      return preferences;
    });
  });
  ipcMain.handle("runtime:refresh-tasks", (event) => {
    if (event.sender !== menuWindow?.webContents) return null;
    refreshTasks(true);
    return taskPayload();
  });
  ipcMain.handle("runtime:get-time-history", (event, offset: unknown = 0) => {
    if (event.sender !== menuWindow?.webContents) return null;
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 10_000) return null;
    return taskTimePayload(Date.now(), offset as number);
  });
  ipcMain.handle("runtime:delete-time-entry", async (event, entryId: unknown) => {
    if (event.sender !== menuWindow?.webContents || taskTimeTracker === null || typeof entryId !== "string") return null;
    const deletedEntry = taskTimeTracker.closedEntry(entryId);
    if (deletedEntry === null) return null;
    if (!taskTimeTracker.deleteEntry(entryId)) return null;
    if (!await checkpointTaskTime(true)) {
      taskTimeTracker.restoreEntry(deletedEntry);
      sendTaskTime();
      return null;
    }
    const payload = taskTimePayload();
    sendTaskTime(payload);
    return payload;
  });
  ipcMain.handle("runtime:export-time-csv", async (event) => {
    if (event.sender !== menuWindow?.webContents || menuWindow === null || menuWindow.isDestroyed() || taskTimeTracker === null) {
      return Object.freeze({ status: "error" as const });
    }
    const active = taskTimeTracker.activeSegment;
    if (taskTimeTracker.entryCount === 0 && (active === null || active.durationMs === 0)) {
      return Object.freeze({ status: "empty" as const });
    }
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(menuWindow, {
      defaultPath: path.join(app.getPath("documents"), `promethee-time-${date}.csv`),
      filters: [{ name: "CSV", extensions: ["csv"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"]
    });
    if (result.canceled || result.filePath === undefined) return Object.freeze({ status: "cancelled" as const });
    try {
      await writeFile(result.filePath, taskTimeTracker.exportCsv(), { encoding: "utf8", mode: 0o600 });
      return Object.freeze({ fileName: path.basename(result.filePath), status: "exported" as const });
    } catch {
      return Object.freeze({ status: "error" as const });
    }
  });
  ipcMain.handle("runtime:restart-phase", async (event) => {
    if (event.sender !== menuWindow?.webContents || runtime === null) return false;
    const restarted = await runtime.restartPhase(Date.now());
    if (restarted === null) return false;
    lastRuntimeView = restarted;
    sendRuntimeSnapshot();
    return true;
  });
  ipcMain.handle("runtime:skip-phase", async (event) => {
    if (event.sender !== menuWindow?.webContents || runtime === null) return false;
    const skipped = await runtime.skipPhase(Date.now());
    if (skipped === null) return false;
    lastRuntimeView = skipped;
    sendRuntimeSnapshot();
    return true;
  });
  ipcMain.handle("runtime:check-update", (event) => {
    if (event.sender !== menuWindow?.webContents) return null;
    return checkForReleaseUpdate(app.getVersion());
  });
  ipcMain.handle("runtime:open-release", (event, url: unknown) => {
    if (event.sender !== menuWindow?.webContents) return false;
    return openReleasePage(url).catch(() => false);
  });
  ipcMain.handle("runtime:refresh-permissions", async (event) => {
    if (event.sender !== menuWindow?.webContents) return null;
    await refreshNativeAutomationPermission();
    return permissionPayload();
  });
  ipcMain.handle("runtime:request-permissions", async (event) => {
    if (event.sender !== menuWindow?.webContents) return null;
    await requestNativeAutomationPermission();
    return permissionPayload();
  });
  ipcMain.handle("runtime:open-permission-settings", (event, permission: unknown) => {
    if (event.sender !== menuWindow?.webContents || process.platform !== "darwin") return false;
    const url = permission === "input-events"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      : permission === "screen-capture"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        : null;
    return url === null ? false : shell.openExternal(url).then(() => true, () => false);
  });
  ipcMain.handle("runtime:complete-onboarding", async (event) => {
    if (event.sender !== menuWindow?.webContents || preferenceStore === null || preferences === null) return null;
    return enqueuePreferenceMutation(async () => {
      if (preferenceStore === null || preferences === null) return null;
      await refreshNativeAutomationPermission();
      if (nativeAutomationPermissions.status !== "granted") {
        return Object.freeze({ permissions: permissionPayload(), status: "permission-required" as const });
      }
      const saved = await preferenceStore.save({ ...preferences, onboardingCompleted: true });
      if (saved === null) return Object.freeze({ permissions: permissionPayload(), status: "error" as const });
      preferences = saved;
      standaloneMenuReason = latestRuntimeContext === null ? "geometry" : null;
      updateNativeAutomationAuthority();
      sendPreferences();
      sendRuntimeSnapshot();
      applyRuntimePlan(true);
      return Object.freeze({ permissions: permissionPayload(), preferences, status: "completed" as const });
    });
  });
  ipcMain.handle("runtime:dismiss-onboarding", async (event) => {
    if (event.sender !== menuWindow?.webContents || preferenceStore === null || preferences === null || runtime === null) return null;
    return enqueuePreferenceMutation(async () => {
      if (preferenceStore === null || preferences === null || runtime === null) return null;
      await refreshNativeAutomationPermission();
      if (!nativeAutomationPermissions.screenCapture) {
        return Object.freeze({ permissions: permissionPayload(), status: "permission-required" as const });
      }
      const previousSettings = preferences.settings;
      const passiveSettings = Object.freeze({ ...previousSettings, autoPausePromethee: false, autoResumePromethee: false });
      if (!runtime.updateSettings(passiveSettings)) return null;
      const saved = await preferenceStore.save({ ...preferences, onboardingCompleted: true, settings: runtime.currentSettings });
      if (saved === null) {
        runtime.updateSettings(previousSettings);
        return Object.freeze({ permissions: permissionPayload(), status: "error" as const });
      }
      preferences = saved;
      standaloneMenuReason = latestRuntimeContext === null ? "geometry" : null;
      updateNativeAutomationAuthority();
      sendPreferences();
      sendRuntimeSnapshot();
      applyRuntimePlan(false);
      return Object.freeze({ permissions: permissionPayload(), preferences, status: "completed" as const });
    });
  });
}

function startRuntime(): Promise<void> {
  if (applicationExitStarted || applicationRestarting) return Promise.resolve();
  if (!supportsAttachedRuntime(process.platform) || overlayWindow !== null) return Promise.resolve();
  if (runtimeStartPromise !== null) return runtimeStartPromise;
  const pending = initializeRuntime();
  runtimeStartPromise = pending;
  void pending.then(() => {
    if (runtimeStartPromise === pending) runtimeStartPromise = null;
  }, () => {
    if (runtimeStartPromise === pending) runtimeStartPromise = null;
  });
  return pending;
}

async function initializeRuntime(): Promise<void> {
  const initializationGeneration = runtimeGeneration;
  const initializationCancelled = () =>
    applicationExitStarted || applicationRestarting || runtimeGeneration !== initializationGeneration;
  const abandonInitialization = () => {
    sessionReader?.close();
    sessionReader = null;
  };
  preferenceStore = new RuntimePreferenceStore(path.join(app.getPath("userData"), "preferences-v1.json"));
  preferences = await preferenceStore.load();
  if (initializationCancelled()) { abandonInitialization(); return; }
  locale = app.getLocale().toLowerCase().startsWith("fr") ? "fr" : "en";
  const opened = openPrometheeSqlite(process.platform, app.getPath("appData"));
  sessionReader = opened.status === "ready" ? opened.reader : null;
  latestProcessId = await readNativePrometheeProcessId();
  if (initializationCancelled()) { abandonInitialization(); return; }
  taskTimeStore = new TaskTimeStore(path.join(app.getPath("userData"), "task-time-v1.json"));
  taskTimeTracker = new TaskTimeTracker(await taskTimeStore.load());
  if (initializationCancelled()) { abandonInitialization(); return; }
  taskTimeStorageStatus = taskTimeStore.status === "ready" || taskTimeStore.status === "missing"
    ? "ready"
    : "storage-error";
  refreshTasks(true);
  taskTimeTracker.selectTask(trackedTaskFor(preferences.selectedTask));
  if (taskTimeStorageStatus === "ready") await checkpointTaskTime(true);
  if (initializationCancelled()) { abandonInitialization(); return; }

  runtime = new ExternalPomodoroRuntime({
    control: {
      dispatch: async (action: RuntimeControlAction) => {
        const activeControl = control;
        const signal = nativeControlAbortController?.signal;
        if (
          applicationExitStarted || applicationRestarting ||
          !nativeAutomationAuthorityGranted || activeControl === null || signal === undefined || signal.aborted
        ) {
          return { execution: "not-sent" as const };
        }
        const result = action === "pause" ? await activeControl.pressPause(signal) : await activeControl.pressResume(signal);
        if (DEBUG_RUNTIME) {
          console.info(
            `[promethee-pomodoro] ${action}: ${result.status}/${result.execution}` +
            (result.status === "failed" ? `/${result.reason}` : "")
          );
        }
        if (result.status === "failed") {
          console.warn(`[promethee-pomodoro] ${action} not sent: ${result.reason}`);
        }
        return {
          execution: result.status === "pressed"
            ? "sent-unconfirmed" as const
            : result.execution === "indeterminate" ? "indeterminate" as const : "not-sent" as const
        };
      }
    },
    settings: preferences.settings
  });

  overlayWindow = createOutlineWindow();
  handleWindow = createHandleWindow();
  geometryPollCadence = createGeometryPollCadence(Date.now());
  scheduleGeometryPoll(0);
  scheduleProcessPoll();
  scheduleSessionPoll(0);
}

function refreshNativeAutomationPermission(): Promise<void> {
  if (applicationExitStarted || applicationRestarting) return Promise.resolve();
  if (permissionRefreshPromise !== null) return permissionRefreshPromise;
  const pending = performPermissionRefresh(false);
  permissionRefreshPromise = pending;
  void pending.then(() => {
    if (permissionRefreshPromise === pending) permissionRefreshPromise = null;
  }, () => {
    if (permissionRefreshPromise === pending) permissionRefreshPromise = null;
  });
  return pending;
}

function requestNativeAutomationPermission(): Promise<void> {
  if (applicationExitStarted || applicationRestarting) return Promise.resolve();
  const predecessor = permissionRefreshPromise ?? Promise.resolve();
  const pending = predecessor.catch(() => undefined).then(() => performPermissionRefresh(true));
  permissionRefreshPromise = pending;
  void pending.then(() => {
    if (permissionRefreshPromise === pending) permissionRefreshPromise = null;
  }, () => {
    if (permissionRefreshPromise === pending) permissionRefreshPromise = null;
  });
  return pending;
}

async function performPermissionRefresh(request: boolean): Promise<void> {
  let screenCaptureWasGranted = false;
  let helperScreenCaptureIsGranted = false;
  if (!AUTOMATION_AVAILABLE) {
    nativeAutomationPermissions = nativeAutomationPermissionStatus(false, false, false);
  } else {
    if (request) {
      const beforeRequest = await readNativeAutomationPermissions();
      if (applicationExitStarted || applicationRestarting) return;
      screenCaptureWasGranted = beforeRequest.screenCapture;
    }
    const helperPermissions = await (request ? requestNativeAutomationPermissions() : readNativeAutomationPermissions());
    if (applicationExitStarted || applicationRestarting) return;
    helperScreenCaptureIsGranted = helperPermissions.screenCapture;
    const capturePoint = screen.getPrimaryDisplay().bounds;
    const captureTransportAvailable = helperPermissions.screenCapture &&
      await probeScreenCaptureTransport({ x: capturePoint.x, y: capturePoint.y });
    if (applicationExitStarted || applicationRestarting) return;
    nativeAutomationPermissions = effectiveNativeAutomationPermissionStatus(helperPermissions, captureTransportAvailable);
  }
  updateNativeAutomationAuthority();
  reconcilePermissionRecoveryPresentation();
  sendRuntimeSnapshot();
  if (!applicationRestarting) applyRuntimePlan(false);
  if (shouldRelaunchAfterScreenPermissionRequest(request, screenCaptureWasGranted, helperScreenCaptureIsGranted)) {
    schedulePermissionRelaunch();
  }
}

function permissionRecoveryRequired(): boolean {
  const settings = preferences?.settings;
  return requiresNativePermissionRecovery(
    AUTOMATION_AVAILABLE,
    preferences?.onboardingCompleted === true,
    nativeAutomationPermissions,
    settings?.autoPausePromethee === true || settings?.autoResumePromethee === true
  );
}

function reconcilePermissionRecoveryPresentation(): void {
  if (permissionRecoveryRequired()) {
    standaloneMenuReason = "permission";
  } else if (standaloneMenuReason === "permission") {
    standaloneMenuReason = latestRuntimeContext === null ? "geometry" : null;
  }
}

function schedulePermissionRelaunch(): void {
  if (permissionRelaunchScheduled) return;
  permissionRelaunchScheduled = true;
  applicationRestarting = true;
  nativeAutomationAuthorityGranted = false;
  nativeControlAbortController?.abort();
  nativeControlAbortController = null;
  control = null;
  sendRuntimeSnapshot();
  setTimeout(() => {
    void exitApplication(true);
  }, RESTART_PRESENTATION_MS);
}

async function exitApplication(relaunch: boolean): Promise<void> {
  if (applicationExitStarted) return;
  applicationExitStarted = true;
  stopRuntime();
  await Promise.race([
    Promise.allSettled([preferenceMutationQueue, checkpointTaskTime(true)]),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), QUIT_CHECKPOINT_TIMEOUT_MS))
  ]);
  if (relaunch) app.relaunch();
  app.exit(0);
}

function updateNativeAutomationAuthority(): void {
  nativeControlAbortController?.abort();
  nativeControlAbortController = null;
  if (applicationExitStarted || applicationRestarting) {
    nativeAutomationAuthorityGranted = false;
    control = null;
    return;
  }
  nativeAutomationAuthorityGranted = canArmNativeAutomation(
    AUTOMATION_AVAILABLE,
    preferences?.onboardingCompleted === true,
    nativeAutomationPermissions
  );
  if (nativeAutomationAuthorityGranted) {
    nativeControlAbortController = new AbortController();
    control = createNativeControl();
  } else {
    control = null;
  }
}

function createNativeControl(): NativePrometheeControl {
  return new NativePrometheeControl({
    authority: readControlObservation,
    capture: async (signal) => {
      const context = latestRuntimeContext;
      if (context === null) throw new Error("Promethee HUD is unavailable.");
      return capturePrometheeHud(context.timer, context.processId, context.generation, signal);
    },
    platform: process.platform
  });
}

function scheduleGeometryPoll(delayMs: number): void {
  if (applicationExitStarted || applicationRestarting) return;
  const generation = runtimeGeneration;
  geometryPollTimer = setTimeout(() => {
    geometryPollTimer = null;
    void pollGeometry(generation);
  }, delayMs);
}

async function pollGeometry(generation: number): Promise<void> {
  if (generation !== runtimeGeneration || overlayWindow === null) return;
  const abortController = new AbortController();
  geometryLookupAbort = abortController;
  try {
    const processId = latestProcessId;
    if (processId === null) { handleTransientLookupFailure(); return; }
    const workAreas: ScreenRect[] = screen.getAllDisplays().map(({ workArea }) => ({ ...workArea }));
    const lookup = await locatePrometheeTimerContext(
      workAreas,
      abortController.signal,
      process.platform === "win32" ? windowsPhysicalBoundsToDip : undefined
    );
    if (generation !== runtimeGeneration || overlayWindow === null) return;
    if (lookup.status === "lookup-error" || lookup.status === "not-found") { handleTransientLookupFailure(); return; }
    if (lookup.status !== "found") { revokeRuntimeSurfaces(); return; }
    const display = screen.getDisplayMatching(lookup.bounds);
    const previous = latestRuntimeContext;
    const identityChanged = previous === null || previous.processId !== processId || !sameRect(previous.timer, lookup.bounds);
    hudGeneration = nextHudGeneration(hudGeneration, identityChanged);
    const nextContext: RuntimeContext = {
      exclusions: lookup.exclusions,
      generation: hudGeneration,
      processId,
      timer: lookup.bounds,
      workArea: { ...display.workArea }
    };
    const geometryChanged = previous === null || !sameRuntimeGeometry(previous, nextContext);
    latestRuntimeContext = nextContext;
    lastGoodRuntimeAt = Date.now();
    geometryPollCadence = updateGeometryPollCadence(geometryPollCadence, geometryChanged, Date.now());
    if (
      standaloneMenuReason === "geometry" ||
      (standaloneMenuReason === "permission" && !permissionRecoveryRequired())
    ) {
      standaloneMenuReason = null;
    }
    if (geometryChanged || runtimeInteractionSuspended) applyRuntimePlan(false);
  } catch {
    handleTransientLookupFailure();
  } finally {
    if (geometryLookupAbort === abortController) geometryLookupAbort = null;
    if (!applicationExitStarted && !applicationRestarting && generation === runtimeGeneration) {
      scheduleGeometryPoll(geometryPollDelay(geometryPollCadence, Date.now()));
    }
  }
}

function scheduleProcessPoll(): void {
  if (applicationExitStarted || applicationRestarting) return;
  processPollTimer = setTimeout(async () => {
    processPollTimer = null;
    if (applicationExitStarted || applicationRestarting) return;
    latestProcessId = await readNativePrometheeProcessId();
    scheduleProcessPoll();
  }, PROCESS_POLL_INTERVAL_MS);
}

function scheduleSessionPoll(delayMs: number): void {
  if (applicationExitStarted || applicationRestarting) return;
  sessionPollTimer = setTimeout(() => {
    sessionPollTimer = null;
    if (applicationExitStarted || applicationRestarting) return;
    void pollSession();
  }, delayMs);
}

async function pollSession(): Promise<void> {
  if (sessionPollBusy) { scheduleSessionPoll(SESSION_POLL_INTERVAL_MS); return; }
  sessionPollBusy = true;
  try {
    const nowMs = Date.now();
    const previousTrackingState = trackingObservationKey(latestSessionObservation);
    latestSessionObservation = sessionReader?.readSession(nowMs) ?? Object.freeze({
      status: "unknown",
      observedAtMs: nowMs,
      reason: "closed"
    });
    taskTimeTracker?.observe(currentTaskTimeObservation());
    const controlObservation = controlObservationFromCurrentState();
    const activeControl = control;
    const controlSignal = nativeControlAbortController?.signal;
    if (controlObservation !== null && activeControl !== null && controlSignal !== undefined && !controlSignal.aborted) {
      await activeControl.reconcile(controlObservation, controlSignal).catch(() => undefined);
    }
    const previousPhase = lastRuntimeView?.phase ?? null;
    lastRuntimeView = runtime === null ? null : await runtime.ingest(latestSessionObservation, nowMs);
    if (lastRuntimeView !== null && previousPhase !== lastRuntimeView.phase) {
      if (DEBUG_RUNTIME) console.info(`[promethee-pomodoro] phase: ${previousPhase ?? "none"} -> ${lastRuntimeView.phase}`);
      notifyPhase(lastRuntimeView);
    }
    if (menuOpen && nowMs - lastTaskRefreshAt >= TASK_REFRESH_INTERVAL_MS) refreshTasks(false);
    const trackingTransitioned = previousTrackingState !== trackingObservationKey(latestSessionObservation);
    void checkpointTaskTime(trackingTransitioned);
    if (menuOpen && (trackingTransitioned || nowMs - lastTaskTimeRenderAt >= TASK_TIME_RENDER_INTERVAL_MS)) {
      lastTaskTimeRenderAt = nowMs;
      sendTaskTime();
    }
    sendRuntimeSnapshot();
  } finally {
    sessionPollBusy = false;
    if (!applicationExitStarted && !applicationRestarting) scheduleSessionPoll(SESSION_POLL_INTERVAL_MS);
  }
}

function readControlObservation(): Promise<PrometheeControlObservation> {
  const nowMs = Date.now();
  const session = sessionReader?.readSession(nowMs) ?? Object.freeze({
    status: "unknown" as const,
    observedAtMs: nowMs,
    reason: "closed" as const
  });
  const observation = controlObservation(session, latestRuntimeContext, nowMs);
  return observation === null
    ? Promise.reject(new Error("Fresh Promethee observation unavailable."))
    : Promise.resolve(observation);
}

function controlObservationFromCurrentState(): PrometheeControlObservation | null {
  return controlObservation(latestSessionObservation, latestRuntimeContext, Date.now());
}

function controlObservation(
  session: PrometheeSessionObservation,
  context: RuntimeContext | null,
  nowMs: number
): PrometheeControlObservation | null {
  if (session.status !== "observed" || context === null || nowMs - session.observedAtMs > CONTROL_OBSERVATION_MAX_AGE_MS) return null;
  return Object.freeze({
    generation: context.generation,
    hudId: "promethee-compact-timer",
    observedAtMs: session.observedAtMs,
    processId: context.processId,
    sessionId: session.sessionId,
    sessionState: session.state,
    source: "sqlite-observation"
  });
}

function refreshTasks(force: boolean): void {
  if (!force && Date.now() - lastTaskRefreshAt < TASK_REFRESH_INTERVAL_MS) return;
  lastTaskRefreshAt = Date.now();
  const next = sessionReader?.readTasks(lastTaskRefreshAt) ?? Object.freeze({ status: "closed" as const });
  if (next.status === "ready") latestTaskSnapshot = next;
  else if (latestTaskSnapshot?.status !== "ready") latestTaskSnapshot = next;
  sendTasks();
}

function handleTransientLookupFailure(): void {
  if (standaloneMenuReason !== null) {
    latestRuntimeContext = null;
    lastGoodRuntimeAt = 0;
    runtimeInteractionSuspended = false;
    hideAttachedRuntimeSurfaces();
    if (menuOpen) showStandaloneRuntimeMenu(false);
    return;
  }
  suspendRuntimeInteraction();
  if (latestRuntimeContext !== null && Date.now() - lastGoodRuntimeAt <= RUNTIME_STALE_AFTER_MS) return;
  revokeRuntimeSurfaces();
}

function suspendRuntimeInteraction(): void {
  runtimeInteractionSuspended = true;
  for (const window of [handleWindow, menuWindow]) {
    if (window !== null && !window.isDestroyed()) { window.setIgnoreMouseEvents(true); window.setFocusable(false); }
  }
}

function applyRuntimePlan(focusMenu: boolean): void {
  if (standaloneMenuReason !== null) {
    hideAttachedRuntimeSurfaces();
    if (menuOpen) showStandaloneRuntimeMenu(focusMenu);
    else hideRuntimeMenu();
    return;
  }
  const context = latestRuntimeContext;
  if (context === null) { revokeRuntimeSurfaces(); return; }
  const safeTop = context.workArea.y + 10;
  const safeBottom = context.workArea.y + context.workArea.height - 10;
  const availableAbove = context.timer.y - 6 - safeTop;
  const availableBelow = safeBottom - (context.timer.y + context.timer.height + 6);
  const maximumAvailableHeight = Math.max(availableAbove, availableBelow);
  const menuViewportHeight = maximumAvailableHeight >= 120 ? Math.min(menuMeasuredHeight, maximumAvailableHeight) : menuMeasuredHeight;
  const plan = planRuntimeWindows({
    exclusions: context.exclusions,
    menuOpen,
    menuSize: { width: menuMeasuredWidth, height: Math.floor(menuViewportHeight) },
    retainedHandleSide,
    timer: context.timer,
    workArea: context.workArea
  });
  retainedHandleSide = plan.handle.side;
  if (plan.outline === null || plan.handle.bounds === null) { revokeRuntimeSurfaces(); return; }
  runtimeInteractionSuspended = false;
  showOutline(plan.outline);
  showHandle(plan.handle.bounds);
  if (menuOpen && plan.menu.bounds !== null) showRuntimeMenu(plan.menu.bounds, focusMenu);
  else hideRuntimeMenu();
}

function hideAttachedRuntimeSurfaces(): void {
  pendingOverlayBounds = null;
  for (const window of [overlayWindow, handleWindow]) {
    if (window !== null && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(true);
      window.setFocusable(false);
      window.hide();
    }
  }
}

function showStandaloneRuntimeMenu(focusMenu: boolean): void {
  const window = menuWindow;
  if (window === null || window.isDestroyed() || !menuReady) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = planStandaloneMenuBounds(
    { ...display.workArea },
    { height: menuMeasuredHeight, width: menuMeasuredWidth }
  );
  if (bounds === null) { hideRuntimeMenu(); return; }
  const wasVisible = window.isVisible();
  window.setBounds(bounds, false);
  window.setIgnoreMouseEvents(false);
  window.setFocusable(true);
  window.webContents.send("runtime:snapshot", runtimePayload());
  if (!wasVisible) window.show();
  if (focusMenu || !wasVisible) {
    window.focus();
    window.webContents.send("runtime:menu-state", true);
  }
}

function showOutline(bounds: Rectangle): void {
  pendingOverlayBounds = bounds;
  const window = overlayWindow;
  if (window === null || window.isDestroyed() || !overlayReady) return;
  window.setBounds(bounds, false);
  window.setIgnoreMouseEvents(true);
  if (!window.isVisible()) window.showInactive();
}

function showHandle(bounds: Rectangle): void {
  const window = handleWindow;
  if (window === null || window.isDestroyed() || !handleReady) return;
  window.setBounds(bounds, false);
  window.setIgnoreMouseEvents(false);
  window.setFocusable(true);
  if (!window.isVisible()) window.showInactive();
}

function showRuntimeMenu(bounds: Rectangle, focusMenu: boolean): void {
  const window = menuWindow;
  if (window === null || window.isDestroyed() || !menuReady) return;
  const wasVisible = window.isVisible();
  window.setBounds(bounds, false);
  window.setIgnoreMouseEvents(false);
  window.setFocusable(true);
  window.webContents.send("runtime:snapshot", runtimePayload());
  if (!wasVisible) window.show();
  if (focusMenu) { window.focus(); window.webContents.send("runtime:menu-state", true); }
}

function closeRuntimeMenu(): void {
  menuOpen = false;
  standaloneMenuReason = null;
  hideRuntimeMenu();
  sendMenuState();
  const window = handleWindow;
  if (window !== null && !window.isDestroyed() && window.isVisible()) window.focus();
}

function openRuntimeMenu(): BrowserWindow | null {
  menuOpen = true;
  if (menuWindow === null || menuWindow.isDestroyed()) menuWindow = createMenuWindow();
  else refreshTasks(true);
  sendMenuState();
  applyRuntimePlan(true);
  return menuWindow;
}

function hideRuntimeMenu(): void {
  const window = menuWindow;
  if (window !== null && !window.isDestroyed()) { window.setIgnoreMouseEvents(true); window.setFocusable(false); window.hide(); }
}

function sendMenuState(): void {
  for (const window of [handleWindow, menuWindow]) {
    if (window !== null && !window.isDestroyed()) window.webContents.send("runtime:menu-state", menuOpen);
  }
}

function sendRuntimeSnapshot(): void {
  const payload = runtimePayload();
  const targets = menuOpen ? [overlayWindow, menuWindow] : [overlayWindow];
  for (const window of targets) {
    if (window !== null && !window.isDestroyed()) window.webContents.send("runtime:snapshot", payload);
  }
}

function runtimePayload(): object {
  return Object.freeze({
    automationEnabled: nativeAutomationAuthorityGranted,
    permissions: permissionPayload(),
    presentation: standaloneMenuReason === "permission" ? "permission-recovery" : standaloneMenuReason === "geometry" ? "standalone" : "attached",
    restarting: applicationRestarting,
    runtime: lastRuntimeView
  });
}

function sendPreferences(): void {
  if (menuWindow !== null && !menuWindow.isDestroyed()) menuWindow.webContents.send("runtime:preferences", preferences);
}

function sendTasks(): void {
  if (menuWindow !== null && !menuWindow.isDestroyed()) menuWindow.webContents.send("runtime:tasks", taskPayload());
}

function sendTaskTime(payload: object = taskTimePayload()): void {
  if (menuWindow !== null && !menuWindow.isDestroyed()) menuWindow.webContents.send("runtime:time-history", payload);
}

function bootstrapPayload(): object {
  return Object.freeze({
    automationEnabled: nativeAutomationAuthorityGranted,
    locale,
    permissions: permissionPayload(),
    presentation: standaloneMenuReason === "permission" ? "permission-recovery" : standaloneMenuReason === "geometry" ? "standalone" : "attached",
    preferences,
    restarting: applicationRestarting,
    runtime: lastRuntimeView,
    tasks: taskPayload(),
    timeHistory: taskTimePayload(),
    version: app.getVersion()
  });
}

function permissionPayload(): NativeAutomationPermissionStatus {
  return nativeAutomationPermissions;
}

function taskPayload(): object {
  const snapshot = latestTaskSnapshot;
  if (snapshot?.status === "ready") {
    return Object.freeze({
      observedAtMs: snapshot.observedAtMs,
      projects: snapshot.projects,
      status: Date.now() - snapshot.observedAtMs > TASK_REFRESH_INTERVAL_MS * 2 ? "stale" : "ready",
      tasks: snapshot.tasks
    });
  }
  return Object.freeze({ status: snapshot?.status === "incompatible" ? "incompatible" : "unavailable" });
}

function taskTimePayload(nowMs = Date.now(), entryOffset = 0): object {
  const tracker = taskTimeTracker;
  if (tracker === null) return Object.freeze({ status: "storage-error" as const });
  const totals = tracker.aggregate(nowMs);
  const entries = tracker.recentEntries(TASK_TIME_RENDER_ENTRY_LIMIT, entryOffset);
  return Object.freeze({
    active: tracker.activeSegment,
    entries,
    entryOffset,
    hasMore: entryOffset + entries.length < tracker.entryCount,
    nextOffset: entryOffset + entries.length,
    selectedTask: tracker.currentSelection,
    status: taskTimeStorageStatus,
    totalEntryCount: tracker.entryCount,
    totals: totals === null
      ? Object.freeze({ allMs: 0, todayMs: 0, weekMs: 0 })
      : Object.freeze({ allMs: totals.allMs, todayMs: totals.todayMs, weekMs: totals.weekMs })
  });
}

function trackedTaskFor(reference: SelectedTaskReference | null): TrackedTaskSnapshot | null {
  if (reference === null) return null;
  const snapshot = latestTaskSnapshot;
  if (snapshot?.status === "ready") {
    const task = snapshot.tasks.find((candidate) => candidate.id === reference.id);
    if (task !== undefined) {
      const project = task.projectId === null
        ? null
        : snapshot.projects.find((candidate) => candidate.id === task.projectId) ?? null;
      return Object.freeze({
        id: task.id,
        projectId: task.projectId,
        projectTitle: project?.title ?? null,
        title: task.title
      });
    }
  }
  const retained = taskTimeTracker?.currentSelection ?? null;
  if (retained?.id === reference.id) return retained;
  return Object.freeze({ id: reference.id, projectId: reference.projectId, projectTitle: null, title: reference.title });
}

function currentTaskTimeObservation(): TaskTimeObservation {
  const observation = latestSessionObservation;
  if (observation.status === "observed" && observation.state === "running") {
    return Object.freeze({
      observedAtMs: observation.observedAtMs,
      sessionId: observation.sessionId,
      status: "running" as const
    });
  }
  return Object.freeze({ observedAtMs: observation.observedAtMs, status: "not-running" as const });
}

function trackingObservationKey(observation: PrometheeSessionObservation): string {
  return observation.status === "observed" && observation.state === "running"
    ? `running:${observation.sessionId}`
    : "not-running";
}

async function checkpointTaskTime(force: boolean): Promise<boolean> {
  const store = taskTimeStore;
  const tracker = taskTimeTracker;
  const nowMs = Date.now();
  if (store === null || tracker === null) return false;
  if (!force && nowMs - lastTaskTimeCheckpointAt < TASK_TIME_CHECKPOINT_INTERVAL_MS) return true;
  lastTaskTimeCheckpointAt = nowMs;
  const saved = await store.save(tracker.value);
  const previousStatus = taskTimeStorageStatus;
  taskTimeStorageStatus = saved === null ? "storage-error" : "ready";
  if (menuOpen && previousStatus !== taskTimeStorageStatus) sendTaskTime();
  return saved !== null;
}

function notifyPhase(view: RuntimeView): void {
  if (!Notification.isSupported()) return;
  let title: string | null = null;
  let body = "";
  if (view.phase === "short-break" || view.phase === "long-break") {
    title = locale === "fr" ? "Pause démarrée" : "Break started";
    body = view.phase === "long-break"
      ? (locale === "fr" ? "Profite de ta pause longue." : "Take your long break.")
      : (locale === "fr" ? "Respire quelques minutes." : "Take a few minutes to reset.");
  } else if (view.phase === "ready" || view.phase === "awaiting-resume") {
    title = locale === "fr" ? "Prêt ?" : "Ready?";
    body = locale === "fr" ? "Reprends sur le vrai timer Promethee." : "Resume from the real Promethee timer.";
  }
  if (title !== null) new Notification({ title, body, silent: false }).show();
}

function revokeRuntimeSurfaces(): void {
  latestRuntimeContext = null;
  lastGoodRuntimeAt = 0;
  pendingOverlayBounds = null;
  runtimeInteractionSuspended = false;
  hideAttachedRuntimeSurfaces();
  if (!applicationExitStarted && menuOpen && standaloneMenuReason !== null) {
    showStandaloneRuntimeMenu(false);
  } else {
    menuOpen = false;
    hideRuntimeMenu();
  }
  sendMenuState();
}

function stopRuntime(): void {
  runtimeGeneration += 1;
  nativeAutomationAuthorityGranted = false;
  nativeControlAbortController?.abort();
  nativeControlAbortController = null;
  control = null;
  if (geometryPollTimer !== null) clearTimeout(geometryPollTimer);
  if (processPollTimer !== null) clearTimeout(processPollTimer);
  if (sessionPollTimer !== null) clearTimeout(sessionPollTimer);
  geometryPollTimer = null;
  processPollTimer = null;
  sessionPollTimer = null;
  geometryLookupAbort?.abort();
  geometryLookupAbort = null;
  sessionReader?.close();
  sessionReader = null;
  revokeRuntimeSurfaces();
}

function isMenuMeasurement(value: unknown): value is { readonly height: number; readonly width: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && typeof candidate.height === "number" && typeof candidate.width === "number" &&
    Number.isSafeInteger(candidate.height) && candidate.height >= 120 && candidate.height <= 620 &&
    candidate.width === DEFAULT_MENU_WIDTH;
}

function sameRect(left: ScreenRect, right: ScreenRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function windowsPhysicalBoundsToDip(bounds: ScreenRect): ScreenRect | null {
  if (process.platform !== "win32") return null;
  const normalized = screen.screenToDipRect(null, bounds);
  return Object.freeze({
    height: normalized.height,
    width: normalized.width,
    x: normalized.x,
    y: normalized.y
  });
}

function sameRuntimeGeometry(left: RuntimeContext, right: RuntimeContext): boolean {
  return left.processId === right.processId &&
    sameRect(left.timer, right.timer) &&
    sameRect(left.workArea, right.workArea) &&
    left.exclusions.length === right.exclusions.length &&
    left.exclusions.every((rect, index) => {
      const other = right.exclusions[index];
      return other !== undefined && sameRect(rect, other);
    });
}

function enqueuePreferenceMutation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = preferenceMutationQueue.then(operation, operation);
  preferenceMutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

function activateRuntime(): void {
  if (applicationExitStarted || applicationRestarting) return;
  void startRuntime().then(() => {
    if (applicationExitStarted || applicationRestarting) return;
    standaloneMenuReason = permissionRecoveryRequired()
      ? "permission"
      : latestRuntimeContext === null ? "geometry" : null;
    const window = openRuntimeMenu();
    if (window === null || !AUTOMATION_AVAILABLE) return;
    const requestAfterPresentation = () => {
      setTimeout(() => {
        if (!applicationExitStarted && !applicationRestarting && !window.isDestroyed()) {
          void refreshNativeAutomationPermission().then(() => {
            if (
              applicationExitStarted || applicationRestarting || startupPermissionRequestAttempted ||
              !shouldRequestNativePermissionsAtStartup(
                AUTOMATION_AVAILABLE,
                preferences?.onboardingCompleted === true,
                nativeAutomationPermissions,
                preferences?.settings.autoPausePromethee === true || preferences?.settings.autoResumePromethee === true
              )
            ) return;
            startupPermissionRequestAttempted = true;
            void requestNativeAutomationPermission();
          });
        }
      }, 120);
    };
    if (window.isVisible()) requestAfterPresentation();
    else window.once("show", requestAfterPresentation);
  }).catch(() => undefined);
}

function runElectronSmokeTest(): void {
  let completionStarted = false;
  const resultFile = process.env.PROMETHEE_POMODORO_SMOKE_RESULT_FILE?.trim();
  const finish = (exitCode: 0 | 1, message: string, stream: NodeJS.WriteStream): void => {
    if (completionStarted) return;
    completionStarted = true;
    if (resultFile !== undefined && resultFile.length > 0) {
      void writeFile(resultFile, `${message}\n`, { encoding: "utf8", mode: 0o600 }).then(
        () => {
          clearTimeout(timeout);
          app.exit(exitCode);
        },
        () => {
          clearTimeout(timeout);
          process.stderr.write("promethee-pomodoro-smoke-error,result-write-failed\n");
          app.exit(1);
        }
      );
      return;
    }
    stream.write(`${message}\n`, () => {
      clearTimeout(timeout);
      app.exit(exitCode);
    });
  };
  const timeout = setTimeout(() => {
    process.stderr.write("promethee-pomodoro-smoke-error,ready-timeout\n");
    app.exit(1);
  }, SMOKE_TEST_TIMEOUT_MS);

  void app.whenReady().then(
    () => finish(
      0,
      `${SMOKE_TEST_MARKER},${app.getVersion()},${process.platform}-${process.arch}`,
      process.stdout
    ),
    () => finish(1, "promethee-pomodoro-smoke-error,ready-rejected", process.stderr)
  );
}

app.setName("Promethee Pomodoro");
if (SMOKE_TEST) {
  runElectronSmokeTest();
} else {
  const ownsInstanceLock = app.requestSingleInstanceLock();
  if (!ownsInstanceLock) {
    app.exit(0);
  } else {
    const hostReady = app.whenReady().then(() => {
      installRuntimeIpc();
      if (process.platform === "darwin") app.dock?.hide();
    });
    app.on("second-instance", () => { void hostReady.then(activateRuntime); });
    void hostReady.then(() => {
      activateRuntime();
      app.on("activate", () => { void hostReady.then(activateRuntime); });
    });
    app.on("before-quit", (event) => {
      if (applicationExitStarted) return;
      event.preventDefault();
      void exitApplication(false);
    });
    app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  }
}
