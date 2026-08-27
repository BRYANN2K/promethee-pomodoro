type Language = "en" | "fr";
type Panel = "context" | "tasks" | "history" | "settings";

interface RuntimeSettings {
  readonly autoPausePromethee: boolean;
  readonly autoResumePromethee: boolean;
  readonly autoStartBreak: boolean;
  readonly focusDurationMs: number;
  readonly focusesPerLongBreak: number;
  readonly longBreakDurationMs: number;
  readonly shortBreakDurationMs: number;
}

interface SelectedTask {
  readonly id: string;
  readonly projectId: string | null;
  readonly title: string;
}

interface Preferences {
  readonly onboardingCompleted: boolean;
  readonly selectedTask: SelectedTask | null;
  readonly settings: RuntimeSettings;
}

interface PermissionSnapshot {
  readonly inputEvents: boolean;
  readonly screenCapture: boolean;
  readonly status: "denied" | "granted" | "unavailable";
  readonly supported: boolean;
}

type OnboardingMutationResult =
  | { readonly permissions: PermissionSnapshot; readonly status: "error" }
  | { readonly permissions: PermissionSnapshot; readonly status: "permission-required" }
  | { readonly permissions: PermissionSnapshot; readonly preferences: Preferences; readonly status: "completed" };

interface RuntimeView {
  readonly availability: "idle" | "live" | "unavailable";
  readonly completedFocusCount: number;
  readonly phase: "idle" | "focus" | "focus-paused" | "awaiting-pause" | "short-break" | "long-break" | "ready" | "awaiting-resume";
  readonly remainingMs: number | null;
  readonly sessionState: "paused" | "running" | null;
}

interface Task {
  readonly id: string;
  readonly projectId: string | null;
  readonly status: "open" | "completed";
  readonly title: string;
}

interface Project {
  readonly id: string;
  readonly title: string;
}

type TasksSnapshot =
  | { readonly status: "incompatible" | "unavailable" }
  | { readonly projects: readonly Project[]; readonly status: "ready" | "stale"; readonly tasks: readonly Task[] };

type TrackingSnapshot =
  | { readonly status: "idle" | "loading" | "unavailable" | "error" }
  | {
      readonly durationMs: number;
      readonly projectTitle: string | null;
      readonly status: "tracking";
      readonly taskId: string;
      readonly taskTitle: string;
    };

interface HistoryEntry {
  readonly durationMs: number;
  readonly id: string;
  readonly projectTitle: string | null;
  readonly startedAtMs: number;
  readonly taskTitle: string;
}

interface TimeHistoryPayload {
  readonly entryOffset: number;
  readonly history: HistorySnapshot;
  readonly tracking: TrackingSnapshot;
}

type HistorySnapshot =
  | { readonly status: "loading" | "empty" | "error" | "unavailable" }
  | {
      readonly entries: readonly HistoryEntry[];
      readonly hasMore: boolean;
      readonly nextOffset: number | null;
      readonly status: "ready";
      readonly summary: { readonly sessionCount: number; readonly todayMs: number; readonly weekMs: number };
    };

const runtimeApi = window.prometheePomodoroRuntime;
let language: Language = (navigator.languages[0] ?? navigator.language).toLowerCase().startsWith("fr") ? "fr" : "en";
let activePanel: Panel = "context";
let currentPreferences: Preferences | null = null;
let currentRuntime: RuntimeView | null = null;
let currentTasks: TasksSnapshot = { status: "unavailable" };
let currentTracking: TrackingSnapshot = runtimeApi === undefined ? { status: "unavailable" } : { status: "loading" };
let currentHistory: HistorySnapshot = runtimeApi === undefined ? { status: "unavailable" } : { status: "loading" };
let currentPermissions: PermissionSnapshot = { inputEvents: false, screenCapture: false, status: "unavailable", supported: false };
let automationEnabled = false;
// Which consent the two switches actually stand on, which only the main process
// can know. `system` is the macOS case, where the OS asked, recorded an answer,
// and keeps a pane to take it back through. `session` is the case where nothing
// asked and nothing outside this app can revoke, so the copy stops sending the
// user to a settings pane they do not have and says what the switches really do.
let consentModel: "session" | "system" = "system";
let permissionReviewOpen = false;
let hostPermissionRecovery = false;
let applicationRestarting = false;
let refreshingPermissions = false;
let availableReleaseUrl: string | null = null;
let taskPayloadKey = "";
let trackingPayloadKey = "";
let historyPayloadKey = "";
let selectedTaskIdRendered: string | null | undefined;
let historyLoaded = false;
let pendingTaskId: string | null | undefined;
let pendingDeleteId: string | null = null;
let deletingEntryId: string | null = null;
let loadingOlderHistory = false;
let lastReportedHeight = -1;
let sizeReportFrame: number | null = null;

const strings = {
  en: {
    allowPermissions: "Allow",
    restarting: "Restarting Promethee Pomodoro…",
    screenRequired: "Reading the timer is required to keep the Pomodoro attached. Timer control can be skipped.",
    automation: "Automation", autoPause: "Auto-pause Promethee", autoPauseHelp: "Once when focus reaches zero", autoResume: "Auto-resume Promethee", autoResumeHelp: "Once when the break ends", back: "Back", cadence: "Long break every", cadenceHelp: "Completed focuses", cancel: "Cancel", checkAgain: "Check again", checkingPermissions: "Checking…", checkUpdate: "Check", checkingUpdate: "Checking…", chooseTask: "Choose a task", close: "Close Pomodoro menu", connected: "Promethee connected", context: "Context", continue: "Continue", currentVersion: "You have the latest version", cycle: "Cycle", delete: "Delete", deleteConfirm: "Delete this entry?", deleted: "Entry deleted", deleteEntry: "Delete tracked entry for {task}", deleting: "Deleting…", downloadUpdate: "Open release", exportCancelled: "Export cancelled", exportCsv: "Export CSV", exportDone: "CSV exported", exportError: "Could not export history", exporting: "Exporting…", focus: "Focus", focuses: "focuses", focusHelp: "Deep work duration", history: "History", historyEmpty: "No tracked time yet", historyEntries: "Tracked time entries", historyError: "Could not load history", historyUnavailable: "History is not available yet", incompatible: "This Promethee task schema is not supported.", inputEvents: "Control the timer", loadOlder: "Load older", loadingHistory: "Loading history…", loadingOlder: "Loading older…", loadingTasks: "Loading tasks…", longBreak: "Long break", longBreakHelp: "After the configured cadence", menuSections: "Pomodoro menu sections", noActiveSession: "No active Promethee session", noTask: "No task selected", noTasks: "No available tasks", notNow: "Not now", onboardingIntro: "Enable timer reading to stay attached. Timer control is only needed for automatic Pause and Resume.", onboardingTitle: "One last setup", openCaptureSettingsLabel: "Open Screen Recording settings", openInputSettingsLabel: "Open timer control settings", openSettings: "Open", pauseOff: "Pause off", pauseOn: "Pause on", permissionGranted: "Ready", permissionHelp: "Turn on Promethee Pomodoro in System Settings, then check again.", permissionNotRequired: "Automation unavailable", permissionPending: "Turn on in System Settings", permissionReady: "Everything is ready. You can continue.", permissionSaveError: "Could not save this choice. Try again.", permissions: "Permissions", permissionsProgress: "{count} / 2 ready", permissionsReady: "2 / 2 ready", permissionUnavailable: "Permission detection is unavailable.", pointerNotice: "Pause and Resume move the pointer onto the Promethee button. This session gives no way to put it back where it was.", prometheeContext: "PROMETHEE CONTEXT", readyToTrack: "Ready to track", refresh: "Refresh tasks", requiredPermissions: "Required permissions", resetDone: "Timer reset", resetTimer: "Reset timer", resumeOff: "Resume off", resumeOn: "Resume on", retry: "Retry", review: "Review", saved: "Saved locally", saveError: "Could not save these settings", screenRecording: "Read the timer", selectTaskToTrack: "Select a task to track", sessionIntro: "Nothing on this session asks you for these. The switches below are the whole of the permission, and no setting outside this app takes it back.", sessionPermissionHelp: "These are protocols, not permissions. This session does not offer one, and there is nothing to turn on that would add it.", sessionPermissionPending: "Not offered by this session", sessions: "Sessions", settings: "Settings", settingsNote: "Saved locally. New durations apply to the next compatible phase.", setup: "SETUP", shortBreak: "Short break", shortBreakHelp: "Between focus periods", skipDone: "Phase skipped", skipPhase: "Skip phase", staleTasks: "Point-in-time tasks · refresh recommended", stopTracking: "Stop tracking", stopTrackingHelp: "No task · keep saved history", switchTask: "Switch tracking", taskList: "Promethee tasks", taskTracked: "Tracking this task", tasks: "Tasks", tasksCurrent: "Point-in-time tasks from Promethee", tasksUnavailable: "Promethee tasks unavailable", thisWeek: "This week", timeLedger: "TIME LEDGER", timeSummary: "Time summary", today: "Today", trackTask: "Track task", tracking: "Tracking", trackingNow: "Tracking now", trackingUnavailable: "Time tracking is not connected yet", trackingUpdating: "Updating tracking…", unavailable: "Promethee observation unavailable", updateAvailable: "Version {version} is available", updateManual: "Checked only when requested", updateUnavailable: "Could not reach the release feed", updates: "Updates"
  },
  fr: {
    allowPermissions: "Autoriser",
    restarting: "Redémarrage de Promethee Pomodoro…",
    screenRequired: "La lecture du timer est nécessaire pour garder le Pomodoro attaché. Le contrôle du timer peut être ignoré.",
    automation: "Automatisation", autoPause: "Pause automatique Promethee", autoPauseHelp: "Une fois lorsque le focus arrive à zéro", autoResume: "Reprise automatique Promethee", autoResumeHelp: "Une fois lorsque la pause se termine", back: "Retour", cadence: "Pause longue tous les", cadenceHelp: "Focus terminés", cancel: "Annuler", checkAgain: "Vérifier à nouveau", checkingPermissions: "Vérification…", checkUpdate: "Vérifier", checkingUpdate: "Vérification…", chooseTask: "Choisir une tâche", close: "Fermer le menu Pomodoro", connected: "Promethee connecté", context: "Contexte", continue: "Continuer", currentVersion: "Tu as la dernière version", cycle: "Cycle", delete: "Supprimer", deleteConfirm: "Supprimer cette entrée ?", deleted: "Entrée supprimée", deleteEntry: "Supprimer le suivi pour {task}", deleting: "Suppression…", downloadUpdate: "Ouvrir la release", exportCancelled: "Export annulé", exportCsv: "Exporter CSV", exportDone: "CSV exporté", exportError: "Impossible d’exporter l’historique", exporting: "Export…", focus: "Focus", focuses: "focus", focusHelp: "Durée de travail profond", history: "Historique", historyEmpty: "Aucun temps suivi", historyEntries: "Entrées de temps suivi", historyError: "Impossible de charger l’historique", historyUnavailable: "L’historique n’est pas encore disponible", incompatible: "Ce schéma de tâches Promethee n’est pas compatible.", inputEvents: "Contrôler le timer", loadOlder: "Charger plus", loadingHistory: "Chargement de l’historique…", loadingOlder: "Chargement…", loadingTasks: "Chargement des tâches…", longBreak: "Pause longue", longBreakHelp: "Après la cadence configurée", menuSections: "Sections du menu Pomodoro", noActiveSession: "Aucune session Promethee active", noTask: "Aucune tâche sélectionnée", noTasks: "Aucune tâche disponible", notNow: "Plus tard", onboardingIntro: "Active la lecture du timer pour rester attaché. Son contrôle est uniquement nécessaire pour Pause et Reprise automatiques.", onboardingTitle: "Dernière étape", openCaptureSettingsLabel: "Ouvrir les réglages d’enregistrement de l’écran", openInputSettingsLabel: "Ouvrir les réglages de contrôle du timer", openSettings: "Ouvrir", pauseOff: "Pause off", pauseOn: "Pause on", permissionGranted: "Prêt", permissionHelp: "Coche Promethee Pomodoro dans Réglages Système, puis vérifie à nouveau.", permissionNotRequired: "Automatisation indisponible", permissionPending: "À activer dans Réglages Système", permissionReady: "Tout est prêt. Tu peux continuer.", permissionSaveError: "Impossible d’enregistrer ce choix. Réessaie.", permissions: "Autorisations", permissionsProgress: "{count} / 2 prêtes", permissionsReady: "2 / 2 prêtes", permissionUnavailable: "La détection des autorisations est indisponible.", pointerNotice: "Pause et Reprise déplacent le pointeur sur le bouton Promethee. Cette session ne permet pas de le remettre où il était.", prometheeContext: "CONTEXTE PROMETHEE", readyToTrack: "Prêt pour le suivi", refresh: "Actualiser les tâches", requiredPermissions: "Autorisations requises", resetDone: "Timer réinitialisé", resetTimer: "Réinitialiser le timer", resumeOff: "Reprise off", resumeOn: "Reprise on", retry: "Réessayer", review: "Vérifier", saved: "Enregistré localement", saveError: "Impossible d’enregistrer ces réglages", screenRecording: "Lire le timer", selectTaskToTrack: "Choisis une tâche à suivre", sessionIntro: "Rien ne te demande ces autorisations sur cette session. Les réglages ci-dessous sont la totalité de la permission, et aucun réglage hors de cette app ne la retire.", sessionPermissionHelp: "Ce sont des protocoles, pas des autorisations. Cette session n’en propose pas un, et rien ne peut être activé pour l’ajouter.", sessionPermissionPending: "Non proposé par cette session", sessions: "Sessions", settings: "Réglages", settingsNote: "Enregistré localement. Les nouvelles durées s’appliquent à la prochaine phase compatible.", setup: "CONFIGURATION", shortBreak: "Pause courte", shortBreakHelp: "Entre les périodes de focus", skipDone: "Phase passée", skipPhase: "Passer la phase", staleTasks: "Tâches ponctuelles · actualisation recommandée", stopTracking: "Arrêter le suivi", stopTrackingHelp: "Aucune tâche · garder l’historique", switchTask: "Changer le suivi", taskList: "Tâches Promethee", taskTracked: "Cette tâche est suivie", tasks: "Tâches", tasksCurrent: "Tâches ponctuelles depuis Promethee", tasksUnavailable: "Tâches Promethee indisponibles", thisWeek: "Cette semaine", timeLedger: "JOURNAL DU TEMPS", timeSummary: "Résumé du temps", today: "Aujourd’hui", trackTask: "Suivre la tâche", tracking: "Suivi en cours", trackingNow: "Suivi en cours", trackingUnavailable: "Le suivi du temps n’est pas encore connecté", trackingUpdating: "Mise à jour du suivi…", unavailable: "Observation Promethee indisponible", updateAvailable: "La version {version} est disponible", updateManual: "Vérification uniquement sur demande", updateUnavailable: "Le flux de release est inaccessible", updates: "Mises à jour"
  }
} as const;

type CopyKey = keyof (typeof strings)["en"];
const contextTab = requireButton("contextTab");
const tasksTab = requireButton("tasksTab");
const historyTab = requireButton("historyTab");
const settingsTab = requireButton("settingsTab");
const tabs: ReadonlyArray<readonly [Panel, HTMLButtonElement, HTMLElement]> = [
  ["context", contextTab, requireElement("contextPanel")],
  ["tasks", tasksTab, requireElement("tasksPanel")],
  ["history", historyTab, requireElement("historyPanel")],
  ["settings", settingsTab, requireElement("settingsPanel")]
];
const menuTitle = requireElement("menuTitle");
const localStatus = requireElement("localStatus");
const onboardingPanel = requireElement("onboardingPanel");
const onboardingTitle = requireElement("onboardingTitle");
const menuTabs = requireElement("menuTabs");

applyCopy();
wireInteractions();
runtimeApi?.onMenuState((open) => {
  if (!open) return;
  renderOnboarding();
  if (isOnboardingVisible()) onboardingTitle.focus({ preventScroll: true });
  else {
    showPanel("context");
    menuTitle.focus({ preventScroll: true });
  }
});
runtimeApi?.onSnapshot(renderBootstrap);
runtimeApi?.onPreferences((value) => commitPreferences(parsePreferences(value)));
runtimeApi?.onTasks((value) => commitTasks(parseTasks(value)));
runtimeApi?.onTimeHistory((value) => commitTimeHistory(parseTimeHistory(value)));
new ResizeObserver(scheduleSizeReport).observe(requireElementBySelector(".runtime-menu"));
void runtimeApi?.getState().then(renderBootstrap);
scheduleSizeReport();

function wireInteractions(): void {
  for (const [panel, tab] of tabs) {
    tab.addEventListener("click", () => showPanel(panel));
    tab.addEventListener("keydown", (event) => moveTabFocus(event, panel));
  }
  requireButton("showTasks").addEventListener("click", () => { showPanel("tasks"); tasksTab.focus(); });
  requireButton("refreshTasks").addEventListener("click", async () => commitTasks(parseTasks(await runtimeApi?.refreshTasks())));
  requireButton("retryHistory").addEventListener("click", () => { void loadHistory(true); });
  requireButton("loadOlderHistory").addEventListener("click", () => { void loadOlderHistory(); });
  requireButton("exportHistory").addEventListener("click", () => { void exportHistory(); });
  requireButton("trackingAction").addEventListener("click", () => { void updateTrackingSelection(); });
  requireButton("skipPhase").addEventListener("click", () => { void skipPhase(); });
  requireButton("resetTimer").addEventListener("click", () => { void resetTimer(); });
  requireButton("closeMenu").addEventListener("click", () => runtimeApi?.closeMenu());
  requireButton("checkUpdate").addEventListener("click", () => {
    if (availableReleaseUrl !== null) void runtimeApi?.openRelease(availableReleaseUrl);
    else void checkUpdate();
  });
  requireButton("openInputSettings").addEventListener("click", () => { void runtimeApi?.openPermissionSettings("input-events"); });
  requireButton("openCaptureSettings").addEventListener("click", () => { void runtimeApi?.openPermissionSettings("screen-capture"); });
  requireButton("refreshPermissions").addEventListener("click", () => { void refreshPermissions(); });
  requireButton("completeOnboarding").addEventListener("click", () => { void completeOnboarding(); });
  requireButton("dismissOnboarding").addEventListener("click", () => { void dismissOnboarding(); });
  requireButton("reviewPermissions").addEventListener("click", () => {
    permissionReviewOpen = true;
    renderOnboarding();
    onboardingTitle.focus({ preventScroll: true });
  });
  for (const input of document.querySelectorAll<HTMLInputElement>(".setting-row input")) {
    input.addEventListener("change", () => { void saveSettings(); });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    runtimeApi?.closeMenu();
  });
}

function moveTabFocus(event: KeyboardEvent, panel: Panel): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = tabs.findIndex(([candidate]) => candidate === panel);
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else nextIndex = (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  if (next === undefined) return;
  showPanel(next[0]);
  next[1].focus();
}

function applyCopy(): void {
  const copy = strings[language];
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll<HTMLElement>("[data-copy]")) {
    const key = element.dataset.copy;
    if (isCopyKey(key)) element.textContent = copy[key];
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-copy-aria]")) {
    const key = element.dataset.copyAria;
    if (isCopyKey(key)) element.setAttribute("aria-label", copy[key]);
  }
  renderRuntime();
  renderPreferencesFields();
  renderTasks(true);
  renderTracking(true);
  renderHistory(true);
  renderOnboarding();
}

function showPanel(panel: Panel): void {
  if (isOnboardingVisible()) return;
  activePanel = panel;
  for (const [candidate, button, target] of tabs) {
    const selected = candidate === panel;
    target.hidden = !selected;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  if (panel === "tasks") void runtimeApi?.refreshTasks();
  if (panel === "history" && !historyLoaded) void loadHistory(false);
  scheduleSizeReport();
}

function renderBootstrap(value: unknown): void {
  if (!isRecord(value)) return;
  if ((value.locale === "fr" || value.locale === "en") && value.locale !== language) {
    language = value.locale;
    applyCopy();
  }
  if (value.consentModel === "session" || value.consentModel === "system") consentModel = value.consentModel;
  if ("automationEnabled" in value && typeof value.automationEnabled === "boolean") {
    automationEnabled = value.automationEnabled;
  }
  renderAutomation();
  if (value.presentation === "permission-recovery" || value.presentation === "standalone" || value.presentation === "attached") {
    hostPermissionRecovery = value.presentation === "permission-recovery";
  }
  if (typeof value.restarting === "boolean") applicationRestarting = value.restarting;
  if ("permissions" in value) {
    const permissions = parsePermissions(value.permissions);
    if (permissions !== null) currentPermissions = permissions;
  }
  if ("preferences" in value) commitPreferences(parsePreferences(value.preferences));
  if ("tasks" in value) commitTasks(parseTasks(value.tasks));
  if ("timeHistory" in value) {
    historyLoaded = true;
    commitTimeHistory(parseTimeHistory(value.timeHistory));
  }
  if ("runtime" in value) {
    currentRuntime = parseRuntimeView(value.runtime);
    renderRuntime();
  }
  renderOnboarding();
}

function renderRuntime(): void {
  const copy = strings[language];
  const statusDot = requireElement("statusDot");
  const view = currentRuntime;
  if (view === null) {
    requireElement("remainingTime").textContent = "—";
    requireElement("phaseLabel").textContent = "POMODORO";
    requireElement("sessionStatus").textContent = copy.noActiveSession;
    requireElement("statusTitle").textContent = copy.unavailable;
    statusDot.dataset.state = "unavailable";
    requireButton("resetTimer").disabled = true;
    requireButton("skipPhase").disabled = true;
    return;
  }
  requireElement("remainingTime").textContent = formatDuration(view.remainingMs, "timer");
  requireElement("phaseLabel").textContent = phaseLabel(view.phase, language).toUpperCase();
  requireElement("sessionStatus").textContent = view.sessionState === "running" ? "Promethee · Live" : "Promethee · Paused";
  const live = view.availability === "live";
  requireElement("statusTitle").textContent = live ? copy.connected : view.availability === "idle" ? copy.noActiveSession : copy.unavailable;
  statusDot.dataset.state = live ? "live" : "unavailable";
  requireButton("resetTimer").disabled = !["focus", "focus-paused", "short-break", "long-break"].includes(view.phase);
  requireButton("skipPhase").disabled = !["focus", "focus-paused", "short-break", "long-break"].includes(view.phase);
  const cadence = currentPreferences?.settings.focusesPerLongBreak ?? 4;
  requireElement("cycleValue").textContent = `${(view.completedFocusCount % cadence) + 1} / ${cadence}`;
  renderAutomation();
}

function commitPreferences(value: Preferences | null): void {
  if (value === null) return;
  const previousSelection = currentPreferences?.selectedTask?.id ?? null;
  currentPreferences = value;
  if (pendingTaskId === undefined || pendingTaskId === previousSelection) pendingTaskId = value.selectedTask?.id ?? null;
  renderPreferencesFields();
  renderAutomation();
  renderOnboarding();
  const selection = value.selectedTask?.id ?? null;
  if (selection !== previousSelection || selectedTaskIdRendered === undefined) renderTasks(true);
  renderTracking();
}

function renderPreferencesFields(): void {
  const value = currentPreferences;
  if (value === null) return;
  setNumber("focusMinutes", value.settings.focusDurationMs / 60_000);
  setNumber("shortBreakMinutes", value.settings.shortBreakDurationMs / 60_000);
  setNumber("longBreakMinutes", value.settings.longBreakDurationMs / 60_000);
  setNumber("cadence", value.settings.focusesPerLongBreak);
  requireInput("autoPause").checked = value.settings.autoPausePromethee;
  requireInput("autoResume").checked = value.settings.autoResumePromethee;
}

function renderAutomation(): void {
  const settings = currentPreferences?.settings;
  const copy = strings[language];
  requireElement("automationValue").textContent = !automationEnabled || settings === undefined
    ? copy.unavailable
    : `${settings.autoPausePromethee ? copy.pauseOn : copy.pauseOff} · ${settings.autoResumePromethee ? copy.resumeOn : copy.resumeOff}`;
  // The pointer warning sits with the switches that would move it, and only
  // where moving it is one way. It is about what the automation does when it
  // runs, so it is shown whether or not either switch is currently on.
  requireElement("pointerNotice").hidden = !automationEnabled || consentModel !== "session";
}

function isOnboardingVisible(): boolean {
  return currentPermissions.supported &&
    (permissionReviewOpen || hostPermissionRecovery || currentPreferences?.onboardingCompleted === false);
}

function rendererPermissionRecoveryRequired(permissions = currentPermissions): boolean {
  if (!permissions.screenCapture) return true;
  const settings = currentPreferences?.settings;
  return currentPreferences?.onboardingCompleted === true && !permissions.inputEvents &&
    (settings?.autoPausePromethee === true || settings?.autoResumePromethee === true);
}

function renderOnboarding(): void {
  const copy = strings[language];
  const visible = isOnboardingVisible();
  const grantedCount = Number(currentPermissions.inputEvents) + Number(currentPermissions.screenCapture);
  const allGranted = currentPermissions.status === "granted" && grantedCount === 2;

  onboardingPanel.hidden = !visible;
  menuTabs.hidden = visible;
  for (const [candidate, button, target] of tabs) {
    const selected = candidate === activePanel;
    target.hidden = visible || !selected;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }

  requireElement("onboardingIntro").textContent = consentModel === "session" ? copy.sessionIntro : copy.onboardingIntro;
  renderPermissionRow("inputPermissionRow", "inputPermissionStatus", "openInputSettings", currentPermissions.inputEvents);
  renderPermissionRow("capturePermissionRow", "capturePermissionStatus", "openCaptureSettings", currentPermissions.screenCapture);

  const feedback = requireElement("permissionFeedback");
  feedback.textContent = applicationRestarting
    ? copy.restarting
    : refreshingPermissions ? copy.checkingPermissions
    : !currentPermissions.supported || currentPermissions.status === "unavailable"
      ? copy.permissionUnavailable
      : allGranted ? copy.permissionReady
      : !currentPermissions.screenCapture ? copy.screenRequired
      : consentModel === "session" ? copy.sessionPermissionHelp : copy.permissionHelp;
  feedback.dataset.state = allGranted ? "success" : currentPermissions.status === "unavailable" ? "unavailable" : "pending";

  const refresh = requireButton("refreshPermissions");
  refresh.disabled = applicationRestarting || refreshingPermissions || !currentPermissions.supported;
  refresh.textContent = applicationRestarting ? copy.restarting : refreshingPermissions ? copy.checkingPermissions : copy.checkAgain;
  const complete = requireButton("completeOnboarding");
  complete.disabled = applicationRestarting || refreshingPermissions || !currentPermissions.supported;
  complete.textContent = applicationRestarting ? copy.restarting : allGranted ? copy.continue : copy.allowPermissions;
  const dismiss = requireButton("dismissOnboarding");
  dismiss.disabled = applicationRestarting || !currentPermissions.screenCapture;
  dismiss.textContent = permissionReviewOpen || (hostPermissionRecovery && currentPreferences?.onboardingCompleted === true) ? copy.back : copy.notNow;

  const settingsStatus = requireElement("settingsPermissionStatus");
  settingsStatus.textContent = !currentPermissions.supported
    ? copy.permissionNotRequired
    : allGranted
      ? copy.permissionsReady
      : copy.permissionsProgress.replace("{count}", String(grantedCount));
  requireButton("reviewPermissions").disabled = !currentPermissions.supported;
  scheduleSizeReport();
}

function renderPermissionRow(rowId: string, statusId: string, openButtonId: string, granted: boolean): void {
  const copy = strings[language];
  const row = requireElement(rowId);
  row.dataset.state = granted ? "granted" : "pending";
  // A row that is not granted means two different things. Where the system asks,
  // it is a switch the user has not turned on yet. Where nothing asks, it is a
  // protocol the session does not offer, which no amount of looking through
  // settings will produce, so the row says that instead of asking for an action.
  requireElement(statusId).textContent = granted
    ? copy.permissionGranted
    : consentModel === "session" ? copy.sessionPermissionPending : copy.permissionPending;
  // The button behind this opens a system pane, and its handler already refuses
  // anywhere but macOS. A control that cannot do anything is worse than absent.
  const open = requireButton(openButtonId);
  open.hidden = consentModel === "session";
  open.disabled = applicationRestarting || granted || refreshingPermissions;
}

async function refreshPermissions(): Promise<void> {
  if (runtimeApi === undefined || refreshingPermissions) return;
  refreshingPermissions = true;
  renderOnboarding();
  try {
    const permissions = parsePermissions(await runtimeApi.refreshPermissions());
    if (permissions !== null) {
      currentPermissions = permissions;
      if (!rendererPermissionRecoveryRequired(permissions)) hostPermissionRecovery = false;
    }
  } finally {
    refreshingPermissions = false;
    renderOnboarding();
  }
}

async function completeOnboarding(): Promise<void> {
  if (currentPermissions.status !== "granted") {
    await requestPermissions();
    return;
  }
  if (currentPreferences?.onboardingCompleted === true) {
    permissionReviewOpen = false;
    renderOnboarding();
    settingsTab.focus({ preventScroll: true });
    return;
  }
  const result = parseOnboardingMutation(await runtimeApi?.completeOnboarding());
  if (result === null || result.status === "error") {
    setPermissionFeedback(strings[language].permissionSaveError, "unavailable");
    return;
  }
  currentPermissions = result.permissions;
  if (result.status === "permission-required") {
    renderOnboarding();
    return;
  }
  permissionReviewOpen = false;
  commitPreferences(result.preferences);
  showPanel("context");
  menuTitle.focus({ preventScroll: true });
}

async function requestPermissions(): Promise<void> {
  if (runtimeApi === undefined || refreshingPermissions) return;
  refreshingPermissions = true;
  renderOnboarding();
  try {
    const permissions = parsePermissions(await runtimeApi.requestPermissions());
    if (permissions !== null) {
      currentPermissions = permissions;
      if (!rendererPermissionRecoveryRequired(permissions)) hostPermissionRecovery = false;
    }
  } finally {
    refreshingPermissions = false;
    renderOnboarding();
  }
}

async function dismissOnboarding(): Promise<void> {
  if (hostPermissionRecovery && currentPreferences?.onboardingCompleted === true) {
    hostPermissionRecovery = false;
    runtimeApi?.closeMenu();
    return;
  }
  if (permissionReviewOpen) {
    permissionReviewOpen = false;
    renderOnboarding();
    settingsTab.focus({ preventScroll: true });
    return;
  }
  const result = parseOnboardingMutation(await runtimeApi?.dismissOnboarding());
  if (result?.status === "permission-required") {
    currentPermissions = result.permissions;
    setPermissionFeedback(strings[language].screenRequired, "pending");
    return;
  }
  if (result === null || result.status !== "completed") {
    setPermissionFeedback(strings[language].permissionSaveError, "unavailable");
    return;
  }
  currentPermissions = result.permissions;
  commitPreferences(result.preferences);
  showPanel("context");
  menuTitle.focus({ preventScroll: true });
}

function setPermissionFeedback(message: string, state: "pending" | "success" | "unavailable"): void {
  const feedback = requireElement("permissionFeedback");
  feedback.textContent = message;
  feedback.dataset.state = state;
  scheduleSizeReport();
}

function commitTasks(value: TasksSnapshot | null): void {
  if (value === null) return;
  currentTasks = value;
  renderTasks();
}

function renderTasks(force = false): void {
  const nextKey = `${taskKey(currentTasks)}|${pendingTaskId ?? ""}|${language}`;
  if (!force && nextKey === taskPayloadKey) return;
  taskPayloadKey = nextKey;
  selectedTaskIdRendered = pendingTaskId ?? null;
  const copy = strings[language];
  const status = requireElement("taskSourceStatus");
  const list = requireElement("taskList");
  list.replaceChildren();
  if (currentTasks.status !== "ready" && currentTasks.status !== "stale") {
    status.textContent = currentTasks.status === "incompatible" ? copy.incompatible : copy.tasksUnavailable;
    addStopTrackingOption(list);
    list.append(createEmptyMessage(status.textContent));
    renderTracking();
    scheduleSizeReport();
    return;
  }
  status.textContent = currentTasks.status === "stale" ? copy.staleTasks : copy.tasksCurrent;
  const projects = new Map(currentTasks.projects.map((project) => [project.id, project.title]));
  const openTasks = currentTasks.tasks.filter((task) => task.status === "open");
  addStopTrackingOption(list);
  if (openTasks.length === 0) list.append(createEmptyMessage(copy.noTasks));
  else for (const task of openTasks) addTaskOption(list, task, task.projectId === null ? "" : projects.get(task.projectId) ?? "");
  renderTracking();
  scheduleSizeReport();
}

function addTaskOption(parent: HTMLElement, task: Task, project: string): void {
  const selected = pendingTaskId === task.id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-option";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(selected));
  button.dataset.taskId = task.id;
  const radio = document.createElement("span");
  radio.className = "task-option__radio";
  radio.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "task-option__copy";
  const strong = document.createElement("strong");
  strong.textContent = task.title;
  text.append(strong);
  if (project.length > 0) {
    const small = document.createElement("small");
    small.textContent = project;
    text.append(small);
  }
  button.append(radio, text);
  button.addEventListener("click", () => {
    pendingTaskId = task.id;
    renderTasks(true);
    renderTracking(true);
  });
  parent.append(button);
}

function addStopTrackingOption(parent: HTMLElement): void {
  const copy = strings[language];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-option task-option--stop";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(pendingTaskId === null));
  const radio = document.createElement("span");
  radio.className = "task-option__radio";
  radio.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "task-option__copy";
  const title = document.createElement("strong");
  title.textContent = copy.stopTracking;
  const detail = document.createElement("small");
  detail.textContent = copy.stopTrackingHelp;
  text.append(title, detail);
  button.append(radio, text);
  button.addEventListener("click", () => { void stopTracking(); });
  parent.append(button);
}

function selectedTaskForAction(): SelectedTask | null {
  const selectedId = pendingTaskId;
  if (selectedId === null || selectedId === undefined) return null;
  if (currentTasks.status === "ready" || currentTasks.status === "stale") {
    const task = currentTasks.tasks.find((candidate) => candidate.id === selectedId && candidate.status === "open");
    if (task !== undefined) return { id: task.id, projectId: task.projectId, title: task.title };
  }
  return currentPreferences?.selectedTask?.id === selectedId ? currentPreferences.selectedTask : null;
}

function commitTimeHistory(value: TimeHistoryPayload | null): void {
  if (value === null) return;
  commitTracking(value.tracking);
  commitHistoryPage(value.history, value.entryOffset);
}

function commitHistoryPage(value: HistorySnapshot, entryOffset: number): void {
  if (value.status !== "ready" || currentHistory.status !== "ready") {
    commitHistory(value);
    return;
  }
  const entries = entryOffset === 0
    ? deduplicateHistoryEntries([...value.entries, ...currentHistory.entries])
    : deduplicateHistoryEntries([...currentHistory.entries, ...value.entries]);
  const keepLoadedCursor = entryOffset === 0 && currentHistory.entries.length > value.entries.length;
  commitHistory({
    entries,
    hasMore: keepLoadedCursor ? currentHistory.hasMore : value.hasMore,
    nextOffset: keepLoadedCursor ? currentHistory.nextOffset : value.nextOffset,
    status: "ready",
    summary: value.summary
  });
}

function commitTracking(value: TrackingSnapshot | null): void {
  if (value === null) return;
  currentTracking = value;
  renderTracking();
}

function renderTracking(force = false): void {
  const selected = selectedTaskForAction();
  const nextKey = `${trackingKey(currentTracking)}|${selected?.id ?? ""}|${selected?.title ?? ""}|${language}`;
  if (!force && nextKey === trackingPayloadKey) return;
  trackingPayloadKey = nextKey;
  const copy = strings[language];
  const strip = requireElement("trackingStrip");
  const eyebrow = requireElement("trackingEyebrow");
  const task = requireElement("trackingTask");
  const status = requireElement("trackingActionStatus");
  const action = requireButton("trackingAction");
  const label = requireElement("trackingActionLabel");
  strip.dataset.state = currentTracking.status === "tracking" ? "tracking" : currentTracking.status === "error" ? "error" : "idle";
  if (currentTracking.status === "tracking") {
    eyebrow.textContent = `${copy.trackingNow} · ${formatDuration(currentTracking.durationMs, "summary")}`;
    task.textContent = currentTracking.taskTitle;
  } else if (currentTracking.status === "loading") {
    eyebrow.textContent = copy.trackingUpdating;
    task.textContent = selected?.title ?? copy.noTask;
  } else {
    eyebrow.textContent = currentTracking.status === "idle" ? copy.readyToTrack : copy.trackingUnavailable;
    task.textContent = selected?.title ?? copy.noTask;
  }
  if (runtimeApi === undefined || currentTracking.status === "unavailable" || currentTracking.status === "error" || currentTracking.status === "loading") {
    action.disabled = true;
    label.textContent = currentTracking.status === "loading" ? copy.trackingUpdating : copy.trackingUnavailable;
    status.textContent = label.textContent;
  } else if (selected === null) {
    action.disabled = true;
    label.textContent = copy.trackTask;
    status.textContent = copy.selectTaskToTrack;
  } else if (currentTracking.status === "tracking" && currentTracking.taskId === selected.id) {
    action.disabled = true;
    label.textContent = copy.tracking;
    status.textContent = copy.taskTracked;
  } else {
    action.disabled = false;
    label.textContent = currentTracking.status === "tracking" ? copy.switchTask : copy.trackTask;
    status.textContent = selected.title;
  }
  scheduleSizeReport();
}

async function updateTrackingSelection(): Promise<void> {
  const task = selectedTaskForAction();
  if (runtimeApi === undefined || task === null) return;
  commitTracking({ status: "loading" });
  try {
    const preferences = parsePreferences(await runtimeApi.selectTask(task.id));
    if (preferences === null) throw new Error("Invalid task selection response");
    commitPreferences(preferences);
    const next = parseTimeHistory(await runtimeApi.getTimeHistory());
    if (next === null) throw new Error("Invalid time history response");
    commitTimeHistory(next);
    historyLoaded = false;
    if (activePanel === "history") void loadHistory(true);
  } catch {
    commitTracking({ status: "error" });
  }
}

async function stopTracking(): Promise<void> {
  if (runtimeApi === undefined) return;
  const previousTaskId = pendingTaskId;
  const previousTracking = currentTracking;
  pendingTaskId = null;
  renderTasks(true);
  commitTracking({ status: "loading" });
  try {
    const preferences = parsePreferences(await runtimeApi.selectTask(null));
    if (preferences === null) throw new Error("Invalid stop tracking response");
    commitPreferences(preferences);
    const next = parseTimeHistory(await runtimeApi.getTimeHistory());
    if (next === null) throw new Error("Invalid time history response");
    commitTimeHistory(next);
  } catch {
    pendingTaskId = previousTaskId;
    commitTracking(previousTracking);
    renderTasks(true);
  }
}

async function loadHistory(force: boolean): Promise<void> {
  if (runtimeApi === undefined) {
    commitHistory({ status: "unavailable" }, true);
    return;
  }
  if (historyLoaded && !force) return;
  historyLoaded = true;
  commitHistory({ status: "loading" }, true);
  try {
    const payload = parseTimeHistory(await runtimeApi.getTimeHistory());
    if (payload === null) throw new Error("Invalid time history response");
    commitTimeHistory(payload);
  } catch {
    commitHistory({ status: "error" });
  }
}

async function loadOlderHistory(): Promise<void> {
  if (runtimeApi === undefined || loadingOlderHistory || currentHistory.status !== "ready" || !currentHistory.hasMore || currentHistory.nextOffset === null) return;
  const offset = currentHistory.nextOffset;
  const button = requireButton("loadOlderHistory");
  loadingOlderHistory = true;
  button.disabled = true;
  button.textContent = strings[language].loadingOlder;
  try {
    const payload = parseTimeHistory(await runtimeApi.getTimeHistory(offset));
    if (payload === null || payload.entryOffset !== offset) throw new Error("Invalid history page");
    commitTimeHistory(payload);
  } catch {
    setHistoryFeedback(strings[language].historyError, "error");
  } finally {
    loadingOlderHistory = false;
    button.textContent = strings[language].loadOlder;
    renderHistory(true);
  }
}

function commitHistory(value: HistorySnapshot | null, force = false): void {
  if (value === null) return;
  const nextKey = `${historyKey(value)}|${language}`;
  currentHistory = value;
  if (!force && nextKey === historyPayloadKey) return;
  historyPayloadKey = nextKey;
  const entryIds = value.status === "ready" ? new Set(value.entries.map((entry) => entry.id)) : new Set<string>();
  if (pendingDeleteId !== null && !entryIds.has(pendingDeleteId)) pendingDeleteId = null;
  if (deletingEntryId !== null && !entryIds.has(deletingEntryId)) deletingEntryId = null;
  renderHistory(true);
}

function renderHistory(force = false): void {
  if (!force && historyPayloadKey === "") return;
  const copy = strings[language];
  const feedback = requireElement("historyFeedback");
  const status = requireElement("historyStatus");
  const retry = requireButton("retryHistory");
  const exportButton = requireButton("exportHistory");
  const loadOlder = requireButton("loadOlderHistory");
  const list = requireElement("historyList");
  list.replaceChildren();
  feedback.dataset.state = currentHistory.status === "error" ? "error" : "idle";
  retry.hidden = currentHistory.status !== "error";
  exportButton.disabled = true;
  loadOlder.hidden = true;
  requireElement("todayTotal").textContent = "—";
  requireElement("weekTotal").textContent = "—";
  requireElement("sessionCount").textContent = "—";
  if (currentHistory.status !== "ready") {
    status.textContent = currentHistory.status === "loading" ? copy.loadingHistory : currentHistory.status === "empty" ? copy.historyEmpty : currentHistory.status === "error" ? copy.historyError : copy.historyUnavailable;
    if (currentHistory.status === "empty") {
      requireElement("todayTotal").textContent = formatDuration(0, "summary");
      requireElement("weekTotal").textContent = formatDuration(0, "summary");
      requireElement("sessionCount").textContent = "0";
    }
    list.append(createEmptyMessage(status.textContent));
    scheduleSizeReport();
    return;
  }
  status.textContent = currentHistory.entries.length === 0 ? copy.historyEmpty : "";
  requireElement("todayTotal").textContent = formatDuration(currentHistory.summary.todayMs, "summary");
  requireElement("weekTotal").textContent = formatDuration(currentHistory.summary.weekMs, "summary");
  requireElement("sessionCount").textContent = String(currentHistory.summary.sessionCount);
  exportButton.disabled = runtimeApi === undefined || currentHistory.entries.length === 0;
  loadOlder.hidden = !currentHistory.hasMore;
  loadOlder.disabled = loadingOlderHistory;
  loadOlder.textContent = loadingOlderHistory ? copy.loadingOlder : copy.loadOlder;
  if (currentHistory.entries.length === 0) list.append(createEmptyMessage(copy.historyEmpty));
  else for (const entry of currentHistory.entries) list.append(createHistoryEntry(entry));
  scheduleSizeReport();
}

function createHistoryEntry(entry: HistoryEntry): HTMLElement {
  const copy = strings[language];
  const row = document.createElement("article");
  row.className = "history-entry";
  row.dataset.entryId = entry.id;
  const text = document.createElement("span");
  text.className = "history-entry__copy";
  const title = document.createElement("strong");
  title.textContent = entry.taskTitle;
  const detail = document.createElement("small");
  const date = new Intl.DateTimeFormat(language, { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" }).format(new Date(entry.startedAtMs));
  detail.textContent = entry.projectTitle === null ? date : `${entry.projectTitle} · ${date}`;
  text.append(title, detail);
  const meta = document.createElement("span");
  meta.className = "history-entry__meta";
  const duration = document.createElement("span");
  duration.className = "history-entry__duration";
  duration.textContent = formatDuration(entry.durationMs, "entry");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "quiet-icon-button history-entry__delete";
  remove.setAttribute("aria-label", copy.deleteEntry.replace("{task}", entry.taskTitle));
  remove.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6 2.75h4M5 4.5l.5 8h5l.5-8M6.75 6.5v4M9.25 6.5v4"></path></svg>';
  remove.addEventListener("click", () => {
    pendingDeleteId = entry.id;
    renderHistoryEntryConfirmation(row, entry);
  });
  meta.append(duration, remove);
  row.append(text, meta);
  if (pendingDeleteId === entry.id) renderHistoryEntryConfirmation(row, entry);
  return row;
}

function renderHistoryEntryConfirmation(row: HTMLElement, entry: HistoryEntry): void {
  row.querySelector(".history-confirm")?.remove();
  const copy = strings[language];
  const confirmation = document.createElement("div");
  confirmation.className = "history-confirm";
  const prompt = document.createElement("span");
  prompt.textContent = copy.deleteConfirm;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "text-button";
  cancel.textContent = copy.cancel;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-button history-confirm__delete";
  remove.textContent = deletingEntryId === entry.id ? copy.deleting : copy.delete;
  remove.disabled = deletingEntryId === entry.id;
  cancel.disabled = remove.disabled;
  cancel.addEventListener("click", () => {
    pendingDeleteId = null;
    confirmation.remove();
    const deleteButton = row.querySelector<HTMLButtonElement>(".history-entry__delete");
    deleteButton?.focus();
    scheduleSizeReport();
  });
  remove.addEventListener("click", () => { void deleteHistoryEntry(entry.id); });
  confirmation.append(prompt, cancel, remove);
  row.append(confirmation);
  scheduleSizeReport();
}

async function deleteHistoryEntry(entryId: string): Promise<void> {
  if (runtimeApi === undefined || deletingEntryId !== null) return;
  deletingEntryId = entryId;
  const row = [...document.querySelectorAll<HTMLElement>(".history-entry")].find((candidate) => candidate.dataset.entryId === entryId);
  const entry = currentHistory.status === "ready" ? currentHistory.entries.find((candidate) => candidate.id === entryId) : undefined;
  if (row !== undefined && entry !== undefined) renderHistoryEntryConfirmation(row, entry);
  try {
    const result = parseTimeHistory(await runtimeApi.deleteTimeEntry(entryId));
    if (result === null) throw new Error("Invalid history response");
    // Deletion shifts every offset after the removed row. Reset to the fresh
    // first page so a later "Load older" request cannot skip an entry.
    currentHistory = { status: "loading" };
    commitTimeHistory(result);
    setHistoryFeedback(strings[language].deleted, "success");
  } catch {
    deletingEntryId = null;
    setHistoryFeedback(strings[language].historyError, "error");
    renderHistory(true);
  }
}

async function exportHistory(): Promise<void> {
  if (runtimeApi === undefined) return;
  const button = requireButton("exportHistory");
  button.disabled = true;
  setHistoryFeedback(strings[language].exporting, "idle");
  try {
    const result = await runtimeApi.exportTimeCsv();
    const status = isRecord(result) && typeof result.status === "string" ? result.status : "error";
    setHistoryFeedback(status === "exported" ? strings[language].exportDone : status === "cancelled" ? strings[language].exportCancelled : strings[language].exportError, status === "exported" ? "success" : status === "cancelled" ? "idle" : "error");
  } catch {
    setHistoryFeedback(strings[language].exportError, "error");
  }
  button.disabled = currentHistory.status !== "ready" || currentHistory.entries.length === 0;
}

function setHistoryFeedback(message: string, state: "idle" | "success" | "error"): void {
  requireElement("historyStatus").textContent = message;
  requireElement("historyFeedback").dataset.state = state;
}

async function resetTimer(): Promise<void> {
  const button = requireButton("resetTimer");
  if (await runtimeApi?.restartPhase() !== true) return;
  button.dataset.state = "confirmed";
  const label = button.querySelector<HTMLElement>("[data-copy]");
  if (label !== null) label.textContent = strings[language].resetDone;
  window.setTimeout(() => {
    delete button.dataset.state;
    if (label !== null) label.textContent = strings[language].resetTimer;
  }, 1_200);
}

async function skipPhase(): Promise<void> {
  if (runtimeApi === undefined) return;
  const button = requireButton("skipPhase");
  if (await runtimeApi.skipPhase() !== true) return;
  button.dataset.state = "confirmed";
  const label = button.querySelector<HTMLElement>("[data-copy]");
  if (label !== null) label.textContent = strings[language].skipDone;
  window.setTimeout(() => {
    delete button.dataset.state;
    if (label !== null) label.textContent = strings[language].skipPhase;
  }, 1_200);
}

async function saveSettings(): Promise<void> {
  if (currentPreferences === null) return;
  const candidate: RuntimeSettings = {
    autoPausePromethee: requireInput("autoPause").checked,
    autoResumePromethee: requireInput("autoResume").checked,
    autoStartBreak: currentPreferences.settings.autoStartBreak,
    focusDurationMs: numberValue("focusMinutes") * 60_000,
    focusesPerLongBreak: numberValue("cadence"),
    longBreakDurationMs: numberValue("longBreakMinutes") * 60_000,
    shortBreakDurationMs: numberValue("shortBreakMinutes") * 60_000
  };
  const saved = parsePreferences(await runtimeApi?.saveSettings(candidate));
  if (saved === null) {
    localStatus.textContent = strings[language].saveError;
    localStatus.dataset.state = "error";
    return;
  }
  localStatus.textContent = strings[language].saved;
  delete localStatus.dataset.state;
  commitPreferences(saved);
}

async function checkUpdate(): Promise<void> {
  const button = requireButton("checkUpdate");
  const status = requireElement("updateStatus");
  const copy = strings[language];
  button.disabled = true;
  button.textContent = copy.checkingUpdate;
  delete button.dataset.state;
  const result = parseUpdateResult(await runtimeApi?.checkUpdate());
  button.disabled = false;
  if (result?.status === "update-available") {
    availableReleaseUrl = result.releaseUrl;
    status.textContent = copy.updateAvailable.replace("{version}", result.latestVersion);
    button.textContent = copy.downloadUpdate;
    button.dataset.state = "available";
    return;
  }
  availableReleaseUrl = null;
  status.textContent = result?.status === "current" ? copy.currentVersion : copy.updateUnavailable;
  button.textContent = copy.checkUpdate;
}

function scheduleSizeReport(): void {
  if (sizeReportFrame !== null) return;
  sizeReportFrame = requestAnimationFrame(() => {
    sizeReportFrame = null;
    const height = Math.ceil(requireElementBySelector(".runtime-menu").scrollHeight);
    if (height <= 0 || height === lastReportedHeight) return;
    lastReportedHeight = height;
    runtimeApi?.measureMenu({ height, width: 348 });
  });
}

function phaseLabel(phase: RuntimeView["phase"], locale: Language): string {
  const labels = locale === "fr"
    ? { idle: "En attente", focus: "Focus", "focus-paused": "Focus en pause", "awaiting-pause": "Pause…", "short-break": "Pause courte", "long-break": "Pause longue", ready: "Prêt ?", "awaiting-resume": "Reprise…" }
    : { idle: "Idle", focus: "Focus", "focus-paused": "Focus paused", "awaiting-pause": "Pausing…", "short-break": "Short break", "long-break": "Long break", ready: "Ready?", "awaiting-resume": "Resuming…" };
  return labels[phase];
}

function formatDuration(milliseconds: number | null, style: "timer" | "summary" | "entry"): string {
  if (milliseconds === null) return "—";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (style === "summary") return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
  if (style === "entry") return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}` : `${minutes}m`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parsePreferences(value: unknown): Preferences | null {
  if (!isRecord(value) || typeof value.onboardingCompleted !== "boolean" || !isRecord(value.settings) || !(value.selectedTask === null || isRecord(value.selectedTask))) return null;
  const settings = value.settings;
  if (typeof settings.autoPausePromethee !== "boolean" || typeof settings.autoResumePromethee !== "boolean" || typeof settings.autoStartBreak !== "boolean" || !positiveInteger(settings.focusDurationMs) || !positiveInteger(settings.shortBreakDurationMs) || !positiveInteger(settings.longBreakDurationMs) || !positiveInteger(settings.focusesPerLongBreak)) return null;
  let selectedTask: SelectedTask | null = null;
  if (value.selectedTask !== null) {
    if (typeof value.selectedTask.id !== "string" || typeof value.selectedTask.title !== "string" || !(value.selectedTask.projectId === null || typeof value.selectedTask.projectId === "string")) return null;
    selectedTask = { id: value.selectedTask.id, projectId: value.selectedTask.projectId, title: value.selectedTask.title };
  }
  return { onboardingCompleted: value.onboardingCompleted, selectedTask, settings: settings as unknown as RuntimeSettings };
}

function parsePermissions(value: unknown): PermissionSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.inputEvents !== "boolean" ||
    typeof value.screenCapture !== "boolean" ||
    typeof value.supported !== "boolean" ||
    (value.status !== "denied" && value.status !== "granted" && value.status !== "unavailable")
  ) return null;
  const bothGranted = value.inputEvents && value.screenCapture;
  if ((value.status === "granted") !== bothGranted || (!value.supported && value.status !== "unavailable")) return null;
  return {
    inputEvents: value.inputEvents,
    screenCapture: value.screenCapture,
    status: value.status,
    supported: value.supported
  };
}

function parseOnboardingMutation(value: unknown): OnboardingMutationResult | null {
  if (!isRecord(value) || (value.status !== "completed" && value.status !== "error" && value.status !== "permission-required")) return null;
  const permissions = parsePermissions(value.permissions);
  if (permissions === null) return null;
  if (value.status !== "completed") return { permissions, status: value.status };
  const preferences = parsePreferences(value.preferences);
  return preferences === null ? null : { permissions, preferences, status: "completed" };
}

function parseRuntimeView(value: unknown): RuntimeView | null {
  if (!isRecord(value)) return null;
  const phases = new Set<RuntimeView["phase"]>(["idle", "focus", "focus-paused", "awaiting-pause", "short-break", "long-break", "ready", "awaiting-resume"]);
  const phase = String(value.phase) as RuntimeView["phase"];
  if (!phases.has(phase) || !["idle", "live", "unavailable"].includes(String(value.availability)) || !Number.isSafeInteger(value.completedFocusCount)) return null;
  return {
    availability: value.availability as RuntimeView["availability"],
    completedFocusCount: value.completedFocusCount as number,
    phase,
    remainingMs: nonNegativeFinite(value.remainingMs) ? value.remainingMs : null,
    sessionState: value.sessionState === "paused" || value.sessionState === "running" ? value.sessionState : null
  };
}

function parseTasks(value: unknown): TasksSnapshot | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  if (value.status === "unavailable" || value.status === "incompatible") return { status: value.status };
  if ((value.status !== "ready" && value.status !== "stale") || !Array.isArray(value.tasks) || !Array.isArray(value.projects) || value.tasks.length > 500 || value.projects.length > 100) return null;
  const tasks: Task[] = [];
  const projects: Project[] = [];
  for (const raw of value.projects) {
    if (!isRecord(raw) || !boundedString(raw.id, 160) || !boundedString(raw.title, 512)) return null;
    projects.push({ id: raw.id, title: raw.title });
  }
  for (const raw of value.tasks) {
    if (!isRecord(raw) || !boundedString(raw.id, 160) || !boundedString(raw.title, 512) || (raw.status !== "open" && raw.status !== "completed") || !(raw.projectId === null || boundedString(raw.projectId, 160))) return null;
    tasks.push({ id: raw.id, projectId: raw.projectId, status: raw.status, title: raw.title });
  }
  return { projects, status: value.status, tasks };
}

function parseTimeHistory(value: unknown): TimeHistoryPayload | null {
  if (!isRecord(value) || typeof value.status !== "string") return null;
  const entryOffset = value.entryOffset === undefined ? 0 : value.entryOffset;
  if (!nonNegativeSafeInteger(entryOffset) || entryOffset > 10_000) return null;
  if (value.status === "storage-error") return { entryOffset, history: { status: "error" }, tracking: { status: "error" } };
  if (value.status !== "ready" || !Array.isArray(value.entries) || value.entries.length > 100 || !isRecord(value.totals) || !nonNegativeSafeInteger(value.totalEntryCount) || !nonNegativeFinite(value.totals.todayMs) || !nonNegativeFinite(value.totals.weekMs) || !nonNegativeFinite(value.totals.allMs)) return null;
  const hasMore = value.hasMore === undefined ? false : value.hasMore;
  const reportedNextOffset = value.nextOffset === undefined || value.nextOffset === null ? null : value.nextOffset;
  if (typeof hasMore !== "boolean" || !(reportedNextOffset === null || (nonNegativeSafeInteger(reportedNextOffset) && reportedNextOffset >= entryOffset && reportedNextOffset <= 10_000)) || (hasMore && (reportedNextOffset === null || reportedNextOffset === entryOffset))) return null;
  const nextOffset = hasMore ? reportedNextOffset : null;
  const selectedTask = value.selectedTask === null ? null : parseTrackedTask(value.selectedTask);
  if (value.selectedTask !== null && selectedTask === null) return null;
  let tracking: TrackingSnapshot = { status: "idle" };
  if (value.active !== null) {
    if (!isRecord(value.active) || !nonNegativeFinite(value.active.durationMs)) return null;
    const task = parseTrackedTask(value.active.task);
    if (task === null) return null;
    tracking = { durationMs: value.active.durationMs, projectTitle: task.projectTitle, status: "tracking", taskId: task.id, taskTitle: task.title };
  }
  const entries: HistoryEntry[] = [];
  for (const raw of value.entries) {
    if (!isRecord(raw) || !boundedString(raw.id, 160) || !nonNegativeFinite(raw.durationMs) || !validDateMs(raw.startedAtMs)) return null;
    const task = parseTrackedTask(raw.task);
    if (task === null) return null;
    entries.push({ durationMs: raw.durationMs, id: raw.id, projectTitle: task.projectTitle, startedAtMs: raw.startedAtMs, taskTitle: task.title });
  }
  return {
    entryOffset,
    history: { entries, hasMore, nextOffset, status: "ready", summary: { sessionCount: value.totalEntryCount, todayMs: value.totals.todayMs, weekMs: value.totals.weekMs } },
    tracking
  };
}

function parseTrackedTask(value: unknown): { readonly id: string; readonly projectTitle: string | null; readonly title: string } | null {
  if (!isRecord(value) || !boundedString(value.id, 160) || !boundedString(value.title, 512) || !(value.projectTitle === null || boundedString(value.projectTitle, 512))) return null;
  return { id: value.id, projectTitle: value.projectTitle, title: value.title };
}

function parseUpdateResult(value: unknown):
  | { readonly currentVersion: string; readonly status: "current" | "unavailable" }
  | { readonly currentVersion: string; readonly latestVersion: string; readonly releaseUrl: string; readonly status: "update-available" }
  | null {
  if (!isRecord(value) || typeof value.currentVersion !== "string" || typeof value.status !== "string") return null;
  if (value.status === "current" || value.status === "unavailable") return { currentVersion: value.currentVersion, status: value.status };
  if (value.status !== "update-available" || typeof value.latestVersion !== "string" || typeof value.releaseUrl !== "string") return null;
  return { currentVersion: value.currentVersion, latestVersion: value.latestVersion, releaseUrl: value.releaseUrl, status: value.status };
}

function taskKey(value: TasksSnapshot): string {
  if (!("projects" in value)) return value.status;
  return `${value.status}|${value.projects.map((project) => `${project.id}:${project.title}`).join("\u001e")}|${value.tasks.map((task) => `${task.id}:${task.projectId ?? ""}:${task.status}:${task.title}`).join("\u001e")}`;
}

function trackingKey(value: TrackingSnapshot): string {
  return value.status === "tracking" ? `${value.status}:${value.taskId}:${value.taskTitle}:${value.projectTitle ?? ""}:${value.durationMs}` : value.status;
}

function historyKey(value: HistorySnapshot): string {
  if (value.status !== "ready") return value.status;
  return `${value.summary.todayMs}:${value.summary.weekMs}:${value.summary.sessionCount}:${value.hasMore}:${value.nextOffset ?? ""}|${value.entries.map((entry) => `${entry.id}:${entry.taskTitle}:${entry.projectTitle ?? ""}:${entry.startedAtMs}:${entry.durationMs}`).join("\u001e")}`;
}

function deduplicateHistoryEntries(entries: readonly HistoryEntry[]): readonly HistoryEntry[] {
  const seen = new Set<string>();
  const result: HistoryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
    if (result.length === 10_000) break;
  }
  return result;
}

function createEmptyMessage(message: string): HTMLElement {
  const empty = document.createElement("p");
  empty.className = "task-empty";
  empty.textContent = message;
  return empty;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isCopyKey(value: string | undefined): value is CopyKey { return value !== undefined && Object.prototype.hasOwnProperty.call(strings.en, value); }
function boundedString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function nonNegativeSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function nonNegativeFinite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validDateMs(value: unknown): value is number { return nonNegativeSafeInteger(value) && value <= 8_640_000_000_000_000; }
function numberValue(id: string): number { return Number(requireInput(id).value); }
function setNumber(id: string, value: number): void { requireInput(id).value = String(value); }
function requireButton(id: string): HTMLButtonElement { const element = document.getElementById(id); if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${id}`); return element; }
function requireInput(id: string): HTMLInputElement { const element = document.getElementById(id); if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${id}`); return element; }
function requireElement(id: string): HTMLElement { const element = document.getElementById(id); if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${id}`); return element; }
function requireElementBySelector(selector: string): HTMLElement { const element = document.querySelector(selector); if (!(element instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`); return element; }

export {};
