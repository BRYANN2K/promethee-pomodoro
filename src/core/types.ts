export const POMODORO_STATE_SCHEMA_VERSION = 2 as const;

export type BreakKind = "short" | "long";
export type BreakSource = "completed-focus" | "skipped-focus";

export interface PomodoroConfig {
  readonly focusDurationMs: number;
  readonly shortBreakDurationMs: number;
  readonly longBreakDurationMs: number;
  readonly focusesPerLongBreak: number;
  readonly autoStartBreak: boolean;
}

interface StateBase {
  readonly schemaVersion: typeof POMODORO_STATE_SCHEMA_VERSION;
  readonly completedFocusCount: number;
  readonly cycleInstance: number;
  readonly phaseSequence: number;
}

export interface IdleState extends StateBase {
  readonly kind: "idle";
}

export interface FocusRunningState extends StateBase {
  readonly kind: "focus-running";
  readonly phaseId: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly deadlineAtMs: number;
}

export interface ManuallyPausedFocusState extends StateBase {
  readonly kind: "focus-paused";
  readonly reason: "promethee-paused";
  readonly phaseId: string;
  readonly durationMs: number;
  readonly remainingMs: number;
}

export interface AwaitingPrometheePauseState extends StateBase {
  readonly kind: "focus-paused";
  readonly reason: "awaiting-promethee-pause";
  readonly phaseId: string;
  readonly pauseRequestId: string;
  readonly breakSource: BreakSource;
  readonly durationMs: number;
  readonly remainingMs: 0;
  readonly completedFocusStartedAtMs: number;
  readonly completedFocusDeadlineAtMs: number;
}

export interface AwaitingBreakStartState extends StateBase {
  readonly kind: "focus-paused";
  readonly reason: "awaiting-break-start";
  readonly phaseId: string;
  readonly durationMs: number;
  readonly remainingMs: 0;
  readonly pendingBreakKind: BreakKind;
  readonly breakSource: BreakSource;
}

export type FocusPausedState =
  | ManuallyPausedFocusState
  | AwaitingPrometheePauseState
  | AwaitingBreakStartState;

export interface BreakRunningState extends StateBase {
  readonly kind: "break-running";
  readonly breakKind: BreakKind;
  readonly breakSource: BreakSource;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly deadlineAtMs: number;
}

export interface ReadyState extends StateBase {
  readonly kind: "ready";
  readonly completedBreakKind: BreakKind;
  readonly breakSource: BreakSource;
  readonly readyOccurrenceId: string;
}

export type PomodoroState =
  | IdleState
  | FocusRunningState
  | FocusPausedState
  | BreakRunningState
  | ReadyState;

export type PomodoroEvent =
  | { readonly type: "start-focus" }
  | { readonly type: "tick" }
  | { readonly type: "promethee-paused" }
  | { readonly type: "promethee-pause-observed" }
  | { readonly type: "promethee-played" }
  | { readonly type: "promethee-pause-confirmed"; readonly pauseRequestId: string }
  | { readonly type: "promethee-stopped" }
  | { readonly type: "start-break" }
  | { readonly type: "skip-focus" }
  | { readonly type: "skip-break" }
  | { readonly type: "restart-phase" }
  | { readonly type: "ready-dismissed" }
  | { readonly type: "reset-cycle" };

export interface PausePrometheeRequestedEffect {
  readonly type: "pause-promethee-requested";
  readonly effectId: string;
  readonly phaseId: string;
  readonly pauseRequestId: string;
  readonly requestedAtMs: number;
}

export interface BreakCompletedEffect {
  readonly type: "break-completed";
  readonly effectId: string;
  readonly breakKind: BreakKind;
  readonly readyOccurrenceId: string;
  readonly completedAtMs: number;
}

export type PomodoroEffect =
  | PausePrometheeRequestedEffect
  | BreakCompletedEffect;

export type TransitionRejectionCode =
  | "invalid-configuration"
  | "invalid-time"
  | "invalid-state"
  | "mismatched-pause-request"
  | "invalid-event-for-state";

export interface TransitionRejection {
  readonly code: TransitionRejectionCode;
  readonly message: string;
}

export interface TransitionResult {
  readonly state: PomodoroState;
  readonly effects: readonly PomodoroEffect[];
  readonly rejection?: TransitionRejection;
}

export type ConfigField = keyof PomodoroConfig;

export interface ConfigValidationError {
  readonly field: ConfigField;
  readonly code: "not-boolean" | "not-finite-integer" | "out-of-range";
  readonly message: string;
}

export type ConfigValidationResult =
  | { readonly valid: true; readonly value: PomodoroConfig }
  | { readonly valid: false; readonly errors: readonly ConfigValidationError[] };
