export {};

declare global {
  interface Window {
    readonly prometheePomodoroFoundation?: Readonly<{
      readonly calibrationMode: "disabled" | "macos-read-only-requested";
      readonly contractVersion: 1;
      readonly integration: "disabled";
      readonly runtimeMode: "safe-demo";
    }>;
    readonly prometheePomodoroRuntime?: Readonly<{
      checkUpdate: () => Promise<unknown>;
      closeMenu: () => void;
      completeOnboarding: () => Promise<unknown>;
      deleteTimeEntry: (entryId: string) => Promise<unknown>;
      dismissOnboarding: () => Promise<unknown>;
      exportTimeCsv: () => Promise<unknown>;
      getState: () => Promise<unknown>;
      getTimeHistory: (offset?: number) => Promise<unknown>;
      measureMenu: (measurement: { readonly height: number; readonly width: number }) => void;
      onMenuState: (listener: (open: boolean) => void) => () => void;
      onPreferences: (listener: (preferences: unknown) => void) => () => void;
      onSnapshot: (listener: (snapshot: unknown) => void) => () => void;
      onTasks: (listener: (tasks: unknown) => void) => () => void;
      onTimeHistory: (listener: (history: unknown) => void) => () => void;
      openRelease: (url: string) => Promise<unknown>;
      openPermissionSettings: (permission: "input-events" | "screen-capture") => Promise<unknown>;
      refreshPermissions: () => Promise<unknown>;
      requestPermissions: () => Promise<unknown>;
      refreshTasks: () => Promise<unknown>;
      restartPhase: () => Promise<unknown>;
      skipPhase: () => Promise<unknown>;
      saveSettings: (settings: unknown) => Promise<unknown>;
      selectTask: (taskId: string | null) => Promise<unknown>;
      toggleMenu: () => void;
    }>;
  }
}
