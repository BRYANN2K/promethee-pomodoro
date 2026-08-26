import {
  createInitialState,
  progressAt,
  remainingMsAt,
  transition,
  validatePomodoroConfig,
  validatePomodoroState,
  type PomodoroConfig,
  type PomodoroEffect,
  type PomodoroState
} from "../core/index.ts";
import type { PrometheeSessionObservation } from "./promethee-sqlite.ts";

export interface RuntimeSettings extends PomodoroConfig {
  readonly autoPausePromethee: boolean;
  readonly autoResumePromethee: boolean;
}

export type RuntimeControlAction = "pause" | "resume";

export interface RuntimeControlPort {
  dispatch(action: RuntimeControlAction): Promise<{
    readonly execution: "indeterminate" | "not-sent" | "sent-unconfirmed";
  }>;
}

export type RuntimeAvailability = "idle" | "live" | "unavailable";
export type RuntimePhase =
  | "idle"
  | "focus"
  | "focus-paused"
  | "awaiting-pause"
  | "short-break"
  | "long-break"
  | "ready"
  | "awaiting-resume";

export interface RuntimeAutomationResult {
  readonly action: RuntimeControlAction;
  readonly attemptedAtMs: number;
  readonly execution: "disabled" | "indeterminate" | "not-sent" | "sent-unconfirmed";
  readonly occurrenceId: string;
}

export interface RuntimeView {
  readonly availability: RuntimeAvailability;
  readonly completedFocusCount: number;
  readonly durationMs: number | null;
  readonly lastAutomation: RuntimeAutomationResult | null;
  readonly phase: RuntimePhase;
  readonly progress: number | null;
  readonly remainingMs: number | null;
  readonly sessionId: string | null;
  readonly sessionState: "paused" | "running" | null;
}

export interface ExternalPomodoroRuntimeOptions {
  readonly control: RuntimeControlPort;
  readonly initialState?: PomodoroState;
  readonly settings: RuntimeSettings;
}

export class ExternalPomodoroRuntime {
  private availability: RuntimeAvailability = "idle";
  private readonly control: RuntimeControlPort;
  private handledPauseOccurrence: string | null = null;
  private handledResumeOccurrence: string | null = null;
  private lastAutomation: RuntimeAutomationResult | null = null;
  private pomodoro: PomodoroState;
  private operationQueue: Promise<void> = Promise.resolve();
  private sessionId: string | null = null;
  private sessionState: "paused" | "running" | null = null;
  private settings: RuntimeSettings;

  constructor(options: ExternalPomodoroRuntimeOptions) {
    this.control = options.control;
    this.settings = validateRuntimeSettings(options.settings) ?? defaultRuntimeSettings();
    const initial = options.initialState ?? createInitialState();
    this.pomodoro = validatePomodoroState(initial).valid ? initial : createInitialState();
  }

  get state(): PomodoroState {
    return this.pomodoro;
  }

  get currentSettings(): RuntimeSettings {
    return this.settings;
  }

  updateSettings(candidate: unknown): boolean {
    const validated = validateRuntimeSettings(candidate);
    if (validated === null) return false;
    this.settings = validated;
    return true;
  }

  ingest(observation: PrometheeSessionObservation, nowMs = observation.observedAtMs): Promise<RuntimeView> {
    return this.enqueue(() => this.ingestNow(observation, nowMs));
  }

  tick(nowMs: number): Promise<RuntimeView> {
    return this.enqueue(() => this.tickNow(nowMs));
  }

  restartPhase(nowMs: number): Promise<RuntimeView | null> {
    return this.enqueue(async () => {
      const result = transition(this.pomodoro, { type: "restart-phase" }, coreConfig(this.settings), nowMs);
      if (result.rejection !== undefined) return null;
      this.pomodoro = result.state;
      this.handledPauseOccurrence = null;
      this.handledResumeOccurrence = null;
      this.lastAutomation = null;
      return this.view(nowMs);
    });
  }

  skipPhase(nowMs: number): Promise<RuntimeView | null> {
    return this.enqueue(async () => {
      const event = this.pomodoro.kind === "focus-paused" && this.pomodoro.reason === "awaiting-break-start"
        ? { type: "skip-break" as const }
        : this.pomodoro.kind === "focus-running" || this.pomodoro.kind === "focus-paused"
          ? { type: "skip-focus" as const }
          : this.pomodoro.kind === "break-running"
          ? { type: "skip-break" as const }
          : null;
      if (event === null) return null;
      const previousState = this.pomodoro;
      const result = transition(this.pomodoro, event, coreConfig(this.settings), nowMs);
      if (result.rejection !== undefined) return null;
      this.pomodoro = result.state;
      for (const effect of result.effects) await this.handleEffect(effect, nowMs);
      const pauseEffect = result.effects.find((effect) => effect.type === "pause-promethee-requested");
      if (
        pauseEffect !== undefined &&
        this.lastAutomation?.action === "pause" &&
        this.lastAutomation.occurrenceId === pauseEffect.effectId &&
        (this.lastAutomation.execution === "disabled" || this.lastAutomation.execution === "not-sent")
      ) {
        this.pomodoro = previousState;
        this.handledPauseOccurrence = null;
        return null;
      }
      return this.view(nowMs);
    });
  }

  view(nowMs: number): RuntimeView {
    const remaining = remainingMsAt(this.pomodoro, nowMs);
    return Object.freeze({
      availability: this.availability,
      completedFocusCount: this.pomodoro.completedFocusCount,
      durationMs: "durationMs" in this.pomodoro ? this.pomodoro.durationMs : null,
      lastAutomation: this.lastAutomation,
      phase: phaseFor(this.pomodoro, this.lastAutomation),
      progress: progressAt(this.pomodoro, nowMs),
      remainingMs: remaining,
      sessionId: this.sessionId,
      sessionState: this.sessionState
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationQueue.then(operation, operation);
    this.operationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async ingestNow(observation: PrometheeSessionObservation, nowMs: number): Promise<RuntimeView> {
    if (observation.status === "unknown") {
      this.availability = "unavailable";
      return this.view(nowMs);
    }

    if (observation.status === "idle") {
      this.availability = "idle";
      this.sessionId = null;
      this.sessionState = null;
      this.handledPauseOccurrence = null;
      this.handledResumeOccurrence = null;
      this.apply("promethee-stopped", nowMs);
      return this.view(nowMs);
    }

    this.availability = "live";
    const replacedSession = this.sessionId !== null && this.sessionId !== observation.sessionId;
    if (replacedSession) {
      this.apply("promethee-stopped", nowMs);
      this.handledPauseOccurrence = null;
      this.handledResumeOccurrence = null;
    }

    const isFirstObservation = this.sessionId === null || replacedSession;
    const previousSessionState = replacedSession ? null : this.sessionState;
    this.sessionId = observation.sessionId;
    this.sessionState = observation.state;

    if (isFirstObservation) {
      this.apply("start-focus", nowMs);
      if (observation.state === "paused") this.apply("promethee-paused", nowMs);
    } else if (previousSessionState !== observation.state) {
      if (observation.state === "paused") {
        if (this.pomodoro.kind === "focus-paused" && this.pomodoro.reason === "awaiting-promethee-pause") {
          this.applyPauseObserved(nowMs);
        } else {
          this.apply("promethee-paused", nowMs);
        }
      } else {
        this.apply("promethee-played", nowMs);
        this.handledResumeOccurrence = null;
      }
    } else if (
      observation.state === "paused" &&
      this.pomodoro.kind === "focus-paused" &&
      this.pomodoro.reason === "awaiting-promethee-pause"
    ) {
      this.applyPauseObserved(nowMs);
    }

    await this.advance(nowMs);
    return this.view(nowMs);
  }

  private async tickNow(nowMs: number): Promise<RuntimeView> {
    await this.advance(nowMs);
    return this.view(nowMs);
  }

  private async advance(nowMs: number): Promise<void> {
    const result = transition(this.pomodoro, { type: "tick" }, coreConfig(this.settings), nowMs);
    this.pomodoro = result.state;
    for (const effect of result.effects) await this.handleEffect(effect, nowMs);
  }

  private apply(type: "promethee-paused" | "promethee-played" | "promethee-stopped" | "start-focus", nowMs: number): void {
    this.pomodoro = transition(this.pomodoro, { type }, coreConfig(this.settings), nowMs).state;
  }

  private applyPauseObserved(nowMs: number): void {
    if (this.pomodoro.kind !== "focus-paused" || this.pomodoro.reason !== "awaiting-promethee-pause") return;
    this.pomodoro = transition(
      this.pomodoro,
      { type: "promethee-pause-observed" },
      coreConfig(this.settings),
      nowMs
    ).state;
  }

  private async handleEffect(effect: PomodoroEffect, nowMs: number): Promise<void> {
    if (effect.type === "pause-promethee-requested") {
      if (this.handledPauseOccurrence === effect.effectId) return;
      this.handledPauseOccurrence = effect.effectId;
      if (!this.settings.autoPausePromethee || this.availability !== "live" || this.sessionState !== "running") {
        this.lastAutomation = Object.freeze({
          action: "pause",
          attemptedAtMs: nowMs,
          execution: "disabled",
          occurrenceId: effect.effectId
        });
        return;
      }
      await this.dispatch("pause", effect.effectId, nowMs);
      return;
    }

    if (this.handledResumeOccurrence === effect.readyOccurrenceId) return;
    this.handledResumeOccurrence = effect.readyOccurrenceId;
    if (!this.settings.autoResumePromethee || this.availability !== "live" || this.sessionState !== "paused") {
      this.lastAutomation = Object.freeze({
        action: "resume",
        attemptedAtMs: nowMs,
        execution: "disabled",
        occurrenceId: effect.readyOccurrenceId
      });
      return;
    }
    await this.dispatch("resume", effect.readyOccurrenceId, nowMs);
  }

  private async dispatch(action: RuntimeControlAction, occurrenceId: string, nowMs: number): Promise<void> {
    let execution: "indeterminate" | "not-sent" | "sent-unconfirmed" = "not-sent";
    try {
      execution = (await this.control.dispatch(action)).execution;
    } catch {
      execution = "not-sent";
    }
    this.lastAutomation = Object.freeze({ action, attemptedAtMs: nowMs, execution, occurrenceId });
  }
}

export function validateRuntimeSettings(value: unknown): RuntimeSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const exactKeys = [
    "autoPausePromethee",
    "autoResumePromethee",
    "autoStartBreak",
    "focusDurationMs",
    "focusesPerLongBreak",
    "longBreakDurationMs",
    "shortBreakDurationMs"
  ];
  const keys = Object.keys(record).sort();
  if (keys.length !== exactKeys.length || keys.some((key, index) => key !== exactKeys[index])) return null;
  if (typeof record.autoPausePromethee !== "boolean" || typeof record.autoResumePromethee !== "boolean") return null;
  const config = validatePomodoroConfig(record);
  if (!config.valid) return null;
  return Object.freeze({
    ...config.value,
    autoPausePromethee: record.autoPausePromethee,
    autoResumePromethee: record.autoResumePromethee
  });
}

export function defaultRuntimeSettings(): RuntimeSettings {
  return Object.freeze({
    autoPausePromethee: true,
    autoResumePromethee: false,
    autoStartBreak: true,
    focusDurationMs: 25 * 60_000,
    focusesPerLongBreak: 4,
    longBreakDurationMs: 15 * 60_000,
    shortBreakDurationMs: 5 * 60_000
  });
}

function coreConfig(settings: RuntimeSettings): PomodoroConfig {
  return {
    autoStartBreak: settings.autoStartBreak,
    focusDurationMs: settings.focusDurationMs,
    focusesPerLongBreak: settings.focusesPerLongBreak,
    longBreakDurationMs: settings.longBreakDurationMs,
    shortBreakDurationMs: settings.shortBreakDurationMs
  };
}

function phaseFor(state: PomodoroState, lastAutomation: RuntimeAutomationResult | null): RuntimePhase {
  switch (state.kind) {
    case "idle": return "idle";
    case "focus-running": return "focus";
    case "focus-paused":
      if (state.reason === "awaiting-promethee-pause") return "awaiting-pause";
      return "focus-paused";
    case "break-running": return state.breakKind === "long" ? "long-break" : "short-break";
    case "ready":
      return lastAutomation?.action === "resume" &&
        lastAutomation.execution === "sent-unconfirmed" &&
        lastAutomation.occurrenceId === state.readyOccurrenceId
        ? "awaiting-resume"
        : "ready";
  }
}
