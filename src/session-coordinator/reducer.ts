import {
  createInitialState,
  transition,
  type PausePrometheeRequestedEffect,
  type PomodoroConfig,
  type PomodoroEffect,
  type PomodoroState
} from "../core/index.ts";
import type {
  ActiveSession,
  BridgeError,
  BridgeEvent,
  HudReadModel,
  SessionCommandAcknowledgement,
  TaskReadModel
} from "../promethee-adapter/v1/index.ts";
import type {
  AuthoritativeSnapshot,
  AcceptedCoordinatorLocalAction,
  BoundSession,
  CoordinatorCycleCheckpoint,
  CoordinatorEffect,
  CoordinatorIngress,
  CoordinatorLocalAction,
  CoordinatorReduction,
  PendingPause,
  SessionCoordinatorState
} from "./types.ts";

const NO_EFFECTS: readonly CoordinatorEffect[] = Object.freeze([]);
const MAX_PAUSE_ATTEMPTS = 2;
const MAX_TASK_REFRESH_ATTEMPTS = 2;
const MAX_CYCLE_CHECKPOINTS = 64;
const MAX_ACCEPTED_LOCAL_ACTIONS = 64;

type AuthoritySource = "event" | "bootstrap" | "reconcile";

function carriesSessionAuthority(event: BridgeEvent): boolean {
  return event.type === "session.changed" || event.type === "session.terminal";
}

function isReadModelOnlyEvent(event: BridgeEvent): boolean {
  return event.type === "hud.changed" || event.type === "tasks.refresh-required";
}

function isSameSessionNonNewerEvent(
  state: SessionCoordinatorState,
  event: BridgeEvent
): boolean {
  return event.type === "session.changed" &&
    event.connectionId === state.connectionId &&
    event.payload.session !== null &&
    state.boundSession !== null &&
    event.payload.session.id === state.boundSession.id &&
    event.payload.session.revision <= state.boundSession.revision;
}

export function createSessionCoordinatorState(): SessionCoordinatorState {
  return {
    status: "disconnected",
    nowMs: 0,
    connectionId: null,
    connectionGeneration: 0,
    effectSequence: 0,
    lastSequence: 0,
    lastEventOccurredAtMs: 0,
    pomodoro: createInitialState(),
    boundSession: null,
    pendingPause: null,
    localActionSequence: 0,
    acceptedLocalActions: [],
    cycleCheckpoints: [],
    tasks: null,
    taskRefreshRequired: false,
    taskRefreshInFlight: false,
    taskRefreshAttempts: 0,
    taskRefreshMarkerSequence: 0,
    pendingTaskRefresh: null,
    pendingReconciliation: null,
    hud: null,
    lastError: null
  };
}

function allocateEffectToken(
  state: SessionCoordinatorState,
  kind: "pause" | "reconcile" | "tasks"
): { readonly state: SessionCoordinatorState; readonly effectToken: string } | null {
  if (state.effectSequence === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const effectSequence = state.effectSequence + 1;
  return {
    state: { ...state, effectSequence },
    effectToken: `${kind}:g${state.connectionGeneration}:e${effectSequence}`
  };
}

function connectionCommandScope(connectionId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < connectionId.length; index += 1) {
    hash ^= connectionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function localError(
  code: BridgeError["code"],
  message: string,
  retryable: boolean
): BridgeError {
  return { code, message, execution: "not-sent", retryable };
}

function cycleIdentityExhaustedError(): BridgeError {
  return localError(
    "INVALID_ARGUMENT",
    "Pomodoro cycle identity is exhausted and cannot be reused safely.",
    false
  );
}

function resetPomodoro(state: SessionCoordinatorState): PomodoroState | null {
  if (state.pomodoro.cycleInstance === Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return createInitialState(
    0,
    0,
    state.pomodoro.cycleInstance + 1
  );
}

function cycleCheckpoint(
  state: SessionCoordinatorState,
  appliedLocalActionSequence = state.localActionSequence
): CoordinatorCycleCheckpoint {
  return {
    atMs: state.nowMs,
    connectionId: state.connectionId,
    connectionGeneration: state.connectionGeneration,
    localActionSequence: appliedLocalActionSequence,
    pomodoro: state.pomodoro,
    boundSession: state.boundSession,
    pendingPause: state.pendingPause
  };
}

function recordCycleCheckpoint(
  state: SessionCoordinatorState,
  appliedLocalActionSequence = state.localActionSequence
): SessionCoordinatorState {
  const checkpoint = cycleCheckpoint(state, appliedLocalActionSequence);
  const withoutSameTime = state.cycleCheckpoints.filter(
    (candidate) =>
      candidate.connectionId !== checkpoint.connectionId ||
      candidate.connectionGeneration !== checkpoint.connectionGeneration ||
      candidate.atMs !== checkpoint.atMs
  );
  let checkpoints = [...withoutSameTime, checkpoint]
    .sort((left, right) => left.atMs - right.atMs)
    .slice(-MAX_CYCLE_CHECKPOINTS);
  let acceptedLocalActions = state.acceptedLocalActions.slice(
    -MAX_ACCEPTED_LOCAL_ACTIONS
  );

  if (state.acceptedLocalActions.length > acceptedLocalActions.length) {
    const oldestRetained = acceptedLocalActions[0];
    if (oldestRetained !== undefined) {
      const replayFloor = oldestRetained.sequence - 1;
      checkpoints = checkpoints.filter(
        (candidate) => candidate.localActionSequence >= replayFloor
      );
    }
  }

  const earliestCheckpoint = checkpoints[0];
  if (earliestCheckpoint !== undefined) {
    acceptedLocalActions = acceptedLocalActions.filter(
      (entry) => entry.sequence > earliestCheckpoint.localActionSequence
    );
  }

  return { ...state, acceptedLocalActions, cycleCheckpoints: checkpoints };
}

interface RewoundCycle {
  readonly state: SessionCoordinatorState;
  readonly replayActions: readonly AcceptedCoordinatorLocalAction[];
  readonly previouslyIssuedPause: PendingPause | null;
  readonly checkpointLocalActionSequence: number;
}

function rewindCycleForEvent(
  state: SessionCoordinatorState,
  occurredAtMs: number
): RewoundCycle | null {
  if (occurredAtMs >= state.nowMs) {
    return {
      state,
      replayActions: [],
      previouslyIssuedPause: state.pendingPause,
      checkpointLocalActionSequence: state.localActionSequence
    };
  }
  const checkpoint = [...state.cycleCheckpoints]
    .reverse()
    .find(
      (candidate) =>
        candidate.connectionId === state.connectionId &&
        candidate.connectionGeneration === state.connectionGeneration &&
        candidate.atMs <= occurredAtMs
    );
  if (checkpoint === undefined) {
    return null;
  }

  const replayActions = state.acceptedLocalActions.filter(
    (entry) =>
      entry.connectionId === state.connectionId &&
      entry.connectionGeneration === state.connectionGeneration &&
      entry.sequence > checkpoint.localActionSequence &&
      entry.sequence <= state.localActionSequence
  );
  const expectedReplayCount = state.localActionSequence - checkpoint.localActionSequence;
  if (
    !Number.isSafeInteger(expectedReplayCount) ||
    expectedReplayCount < 0 ||
    replayActions.length !== expectedReplayCount ||
    replayActions.some(
      (entry, index) => entry.sequence !== checkpoint.localActionSequence + index + 1
    )
  ) {
    return null;
  }

  return {
    state: {
      ...state,
      nowMs: checkpoint.atMs,
      pomodoro: checkpoint.pomodoro,
      boundSession: checkpoint.boundSession,
      pendingPause: checkpoint.pendingPause,
      cycleCheckpoints: state.cycleCheckpoints.filter(
        (candidate) =>
          candidate.connectionId === state.connectionId &&
          candidate.connectionGeneration === state.connectionGeneration &&
          candidate.atMs <= checkpoint.atMs
      )
    },
    replayActions,
    previouslyIssuedPause: state.pendingPause,
    checkpointLocalActionSequence: checkpoint.localActionSequence
  };
}

function coreEvent(
  state: SessionCoordinatorState,
  event:
    | { readonly type: "promethee-paused" }
    | { readonly type: "promethee-played" }
    | { readonly type: "promethee-pause-confirmed"; readonly pauseRequestId: string }
    | { readonly type: "promethee-stopped" },
  config: PomodoroConfig
): SessionCoordinatorState {
  return {
    ...state,
    pomodoro: transition(state.pomodoro, event, config, state.nowMs).state
  };
}

function commandIdFor(
  state: SessionCoordinatorState,
  effect: PausePrometheeRequestedEffect,
  boundSession: BoundSession
): string {
  return `pomodoro:g${state.connectionGeneration}:c${connectionCommandScope(boundSession.connectionId)}:${effect.pauseRequestId}:r${boundSession.revision}`.slice(0, 160);
}

function pauseEffectFromCore(
  state: SessionCoordinatorState,
  effects: readonly PomodoroEffect[],
  previouslyIssuedPause?: PendingPause
): CoordinatorReduction {
  const request = effects.find(
    (effect): effect is PausePrometheeRequestedEffect =>
      effect.type === "pause-promethee-requested"
  );
  const bound = state.boundSession;
  if (
    request === undefined ||
    bound === null ||
    bound.status !== "running" ||
    state.status !== "ready" ||
    state.pendingPause !== null
  ) {
    return { state, effects: NO_EFFECTS };
  }

  if (previouslyIssuedPause !== undefined) {
    const canReuse =
      previouslyIssuedPause.effectId === request.effectId &&
      previouslyIssuedPause.pauseRequestId === request.pauseRequestId &&
      previouslyIssuedPause.command.connectionId === bound.connectionId &&
      previouslyIssuedPause.command.sessionId === bound.id &&
      previouslyIssuedPause.connectionGeneration === state.connectionGeneration;
    return canReuse
      ? {
          state: { ...state, pendingPause: previouslyIssuedPause },
          effects: NO_EFFECTS
        }
      : requestReconciliation(
          state,
          localError(
            "INVALID_PAYLOAD",
            "Replayed pause intent did not match its previously issued command.",
            true
          )
        );
  }

  const allocated = allocateEffectToken(state, "pause");
  if (allocated === null) {
    return unavailable(
      state,
      localError("INVALID_ARGUMENT", "Coordinator effect sequence is exhausted.", false),
      true
    );
  }
  state = allocated.state;

  const command = {
    commandId: commandIdFor(state, request, bound),
    connectionId: bound.connectionId,
    sessionId: bound.id,
    expectedRevision: bound.revision
  };
  const pendingPause: PendingPause = {
    command,
    effectId: request.effectId,
    pauseRequestId: request.pauseRequestId,
    attempts: 1,
    connectionGeneration: state.connectionGeneration,
    effectToken: allocated.effectToken
  };
  return {
    state: { ...state, pendingPause },
    effects: [{
      type: "send-pause",
      command,
      connectionGeneration: state.connectionGeneration,
      effectToken: allocated.effectToken
    }]
  };
}

function advanceClock(
  state: SessionCoordinatorState,
  config: PomodoroConfig,
  requestedNowMs: number,
  previouslyIssuedPause?: PendingPause
): CoordinatorReduction {
  const nowMs = Math.max(state.nowMs, requestedNowMs);
  if (state.status !== "ready") {
    return { state: { ...state, nowMs }, effects: NO_EFFECTS };
  }
  const ticked = transition(state.pomodoro, { type: "tick" }, config, nowMs);
  return pauseEffectFromCore(
    { ...state, nowMs, pomodoro: ticked.state },
    ticked.effects,
    previouslyIssuedPause
  );
}

function bindSession(
  state: SessionCoordinatorState,
  session: ActiveSession
): SessionCoordinatorState {
  return {
    ...state,
    boundSession: {
      connectionId: state.connectionId as string,
      id: session.id,
      status: session.status,
      revision: session.revision,
      taskId: session.taskId,
      startedAtMs: session.startedAtMs
    }
  };
}

function sameSession(left: BoundSession, right: ActiveSession): boolean {
  return left.id === right.id &&
    left.status === right.status &&
    left.revision === right.revision &&
    left.taskId === right.taskId &&
    left.startedAtMs === right.startedAtMs;
}

function sameTasks(left: TaskReadModel | null, right: TaskReadModel | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.revision !== right.revision || left.items.length !== right.items.length) {
    return false;
  }
  const rightById = new Map(right.items.map((item) => [item.id, item]));
  return left.items.every((item) => {
    const counterpart = rightById.get(item.id);
    return counterpart !== undefined && JSON.stringify(item) === JSON.stringify(counterpart);
  });
}

function sameHud(left: HudReadModel | null, right: HudReadModel | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameGeometry(left: HudReadModel, right: HudReadModel): boolean {
  return JSON.stringify(left.geometry) === JSON.stringify(right.geometry);
}

function unavailable(
  state: SessionCoordinatorState,
  error: BridgeError,
  cancelCycle = false
): CoordinatorReduction {
  const reset = cancelCycle ? resetPomodoro(state) : state.pomodoro;
  return {
    state: {
      ...state,
      status: "unavailable",
      pomodoro: reset ?? state.pomodoro,
      boundSession: cancelCycle ? null : state.boundSession,
      pendingPause: null,
      pendingTaskRefresh: null,
      pendingReconciliation: null,
      taskRefreshInFlight: false,
      lastError: error
    },
    effects: NO_EFFECTS
  };
}

function requestReconciliation(
  state: SessionCoordinatorState,
  error: BridgeError | null
): CoordinatorReduction {
  if (state.status === "reconciling") {
    return {
      state: error === null ? state : { ...state, lastError: error },
      effects: NO_EFFECTS
    };
  }
  if (state.connectionId === null) {
    return unavailable(
      state,
      error ?? localError("NOT_CONNECTED", "Reconciliation requires a connection.", false),
      true
    );
  }
  const connectionId = state.connectionId;
  const allocated = allocateEffectToken(state, "reconcile");
  if (allocated === null) {
    return unavailable(
      state,
      localError("INVALID_ARGUMENT", "Coordinator effect sequence is exhausted.", false),
      true
    );
  }
  state = allocated.state;
  const pendingReconciliation = {
    connectionId,
    connectionGeneration: state.connectionGeneration,
    effectToken: allocated.effectToken
  };
  return {
    state: {
      ...state,
      status: "reconciling",
      pendingReconciliation,
      lastError: error
    },
    effects: [{ type: "request-reconciliation", ...pendingReconciliation }]
  };
}

function resolveEqualConflict(
  state: SessionCoordinatorState,
  source: AuthoritySource,
  message: string
): CoordinatorReduction {
  const error = localError("INVALID_PAYLOAD", message, source === "event");
  return source === "event"
    ? requestReconciliation(state, error)
    : unavailable(state, error);
}

function retryOrDegradePendingPause(
  state: SessionCoordinatorState
): CoordinatorReduction {
  const pending = state.pendingPause;
  if (
    pending === null ||
    state.status !== "ready" ||
    state.boundSession === null ||
    state.boundSession.status !== "running" ||
    state.pomodoro.kind !== "focus-paused" ||
    state.pomodoro.reason !== "awaiting-promethee-pause"
  ) {
    return { state, effects: NO_EFFECTS };
  }

  if (
    pending.effectId !== state.pomodoro.pauseRequestId ||
    pending.pauseRequestId !== state.pomodoro.pauseRequestId
  ) {
    return unavailable(
      state,
      localError("INVALID_PAYLOAD", "Pending pause identity does not match the active cycle.", false),
      true
    );
  }
  if (pending.attempts >= MAX_PAUSE_ATTEMPTS) {
    return unavailable(
      state,
      localError(
        "TRANSPORT_ERROR",
        "Promethee remained running after the bounded pause reconciliation attempt.",
        false
      ),
      true
    );
  }

  const allocated = allocateEffectToken(state, "pause");
  if (allocated === null) {
    return unavailable(
      state,
      localError("INVALID_ARGUMENT", "Coordinator effect sequence is exhausted.", false),
      true
    );
  }
  state = allocated.state;
  const retried = {
    ...pending,
    attempts: pending.attempts + 1,
    connectionGeneration: state.connectionGeneration,
    effectToken: allocated.effectToken
  };
  return {
    state: { ...state, pendingPause: retried },
    effects: [{
      type: "send-pause",
      command: retried.command,
      connectionGeneration: retried.connectionGeneration,
      effectToken: retried.effectToken
    }]
  };
}

function ensurePauseIntent(state: SessionCoordinatorState): CoordinatorReduction {
  if (
    state.status !== "ready" ||
    state.boundSession === null ||
    state.boundSession.status !== "running" ||
    state.pomodoro.kind !== "focus-paused" ||
    state.pomodoro.reason !== "awaiting-promethee-pause"
  ) {
    return { state, effects: NO_EFFECTS };
  }
  if (state.pendingPause !== null) {
    return { state, effects: NO_EFFECTS };
  }

  const syntheticEffect: PausePrometheeRequestedEffect = {
    type: "pause-promethee-requested",
    effectId: state.pomodoro.pauseRequestId,
    phaseId: state.pomodoro.phaseId,
    pauseRequestId: state.pomodoro.pauseRequestId,
    requestedAtMs: state.nowMs
  };
  return pauseEffectFromCore(state, [syntheticEffect]);
}

function applyAuthoritativeSession(
  inputState: SessionCoordinatorState,
  session: ActiveSession | null,
  config: PomodoroConfig,
  source: AuthoritySource,
  terminal = false
): CoordinatorReduction {
  let state = inputState;
  const previous = state.boundSession;

  if (session === null || terminal) {
    if (previous !== null || state.pomodoro.kind !== "idle") {
      state = coreEvent(state, { type: "promethee-stopped" }, config);
    }
    return {
      state: { ...state, boundSession: null, pendingPause: null },
      effects: NO_EFFECTS
    };
  }

  if (previous !== null && previous.id === session.id) {
    if (session.revision < previous.revision) {
      return { state, effects: NO_EFFECTS };
    }
    if (session.revision === previous.revision) {
      if (!sameSession(previous, session)) {
        return resolveEqualConflict(
          state,
          source,
          "Equal session revisions carried different authoritative values."
        );
      }
      return source === "reconcile"
        ? retryOrDegradePendingPause(state)
        : ensurePauseIntent(state);
    }
  }

  if (previous !== null && previous.id !== session.id) {
    const reset = resetPomodoro(state);
    if (reset === null) {
      return unavailable(state, cycleIdentityExhaustedError(), true);
    }
    state = {
      ...state,
      pomodoro: reset,
      pendingPause: null
    };
    state = bindSession(state, session);
    return { state, effects: NO_EFFECTS };
  }

  if (previous === null) {
    if (state.pomodoro.kind !== "idle") {
      state = coreEvent(state, { type: "promethee-stopped" }, config);
    }
    state = { ...state, pendingPause: null };
    state = bindSession(state, session);
    if (session.status === "running") {
      state = coreEvent(state, { type: "promethee-played" }, config);
    }
    return ensurePauseIntent(state);
  }

  state = bindSession(state, session);
  if (session.status === "paused") {
    const pomodoro = state.pomodoro;
    const confirmsCompletion =
      pomodoro.kind === "focus-paused" &&
      pomodoro.reason === "awaiting-promethee-pause";
    if (confirmsCompletion) {
      const pauseRequestId = pomodoro.pauseRequestId;
      const pending = state.pendingPause;
      if (
        pending !== null &&
        (pending.effectId !== pauseRequestId || pending.pauseRequestId !== pauseRequestId)
      ) {
        return source === "event"
          ? requestReconciliation(
              state,
              localError("INVALID_PAYLOAD", "Pause event did not match the pending cycle.", true)
            )
          : unavailable(
              state,
              localError("INVALID_PAYLOAD", "Pause snapshot did not match the pending cycle.", false),
              true
            );
      }
      state = coreEvent(
        state,
        { type: "promethee-pause-confirmed", pauseRequestId },
        config
      );
      return { state: { ...state, pendingPause: null }, effects: NO_EFFECTS };
    }
    return {
      state: coreEvent(state, { type: "promethee-paused" }, config),
      effects: NO_EFFECTS
    };
  }

  const shouldApplyPlay =
    previous.status === "paused" &&
    session.status === "running" &&
    (state.pomodoro.kind === "idle" ||
      state.pomodoro.kind === "break-running" ||
      state.pomodoro.kind === "ready" ||
      (state.pomodoro.kind === "focus-paused" &&
        state.pomodoro.reason !== "awaiting-promethee-pause"));
  if (shouldApplyPlay) {
    state = coreEvent(state, { type: "promethee-played" }, config);
  }
  return source === "reconcile"
    ? retryOrDegradePendingPause(state)
    : ensurePauseIntent(state);
}

function validateReadModelProgression(
  state: SessionCoordinatorState,
  snapshot: AuthoritativeSnapshot
): BridgeError | null {
  if (state.connectionId !== snapshot.connectionId) {
    return null;
  }
  const currentTasks = state.tasks;
  const nextTasks = snapshot.value.tasks;
  if (currentTasks !== null && nextTasks !== null) {
    if (nextTasks.revision < currentTasks.revision) {
      return localError("INVALID_PAYLOAD", "Task snapshot revision moved backwards.", false);
    }
    if (nextTasks.revision === currentTasks.revision && !sameTasks(currentTasks, nextTasks)) {
      return localError("INVALID_PAYLOAD", "Equal task revisions carried different values.", false);
    }
  }

  const currentHud = state.hud;
  const nextHud = snapshot.value.hud;
  if (currentHud !== null && nextHud !== null) {
    if (nextHud.revision < currentHud.revision) {
      return localError("INVALID_PAYLOAD", "HUD snapshot revision moved backwards.", false);
    }
    if (nextHud.revision === currentHud.revision && !sameHud(currentHud, nextHud)) {
      return localError("INVALID_PAYLOAD", "Equal HUD revisions carried different values.", false);
    }
    if (
      currentHud.geometry !== null &&
      nextHud.geometry !== null &&
      nextHud.geometry.layoutRevision < currentHud.geometry.layoutRevision
    ) {
      return localError("INVALID_PAYLOAD", "HUD layout revision moved backwards.", false);
    }
    if (
      currentHud.geometry !== null &&
      nextHud.geometry !== null &&
      nextHud.geometry.layoutRevision === currentHud.geometry.layoutRevision &&
      !sameGeometry(currentHud, nextHud)
    ) {
      return localError("INVALID_PAYLOAD", "Equal HUD layout revisions carried different geometry.", false);
    }
  }
  return null;
}

function applyFreshConnectionSession(
  inputState: SessionCoordinatorState,
  session: ActiveSession | null,
  config: PomodoroConfig,
  preserveCycle: boolean
): CoordinatorReduction {
  let state: SessionCoordinatorState = {
    ...inputState,
    boundSession: null,
    pendingPause: null
  };
  if (session === null) {
    if (state.pomodoro.kind !== "idle") {
      state = coreEvent(state, { type: "promethee-stopped" }, config);
    }
    return { state, effects: NO_EFFECTS };
  }
  state = bindSession(state, session);
  if (!preserveCycle) {
    if (session.status === "running") {
      state = coreEvent(state, { type: "promethee-played" }, config);
    }
    return ensurePauseIntent(state);
  }
  if (session.status === "paused") {
    if (
      state.pomodoro.kind === "focus-paused" &&
      state.pomodoro.reason === "awaiting-promethee-pause"
    ) {
      const pauseRequestId = state.pomodoro.pauseRequestId;
      state = coreEvent(
        state,
        { type: "promethee-pause-confirmed", pauseRequestId },
        config
      );
      return { state, effects: NO_EFFECTS };
    }
    return {
      state: coreEvent(state, { type: "promethee-paused" }, config),
      effects: NO_EFFECTS
    };
  }
  const shouldApplyPlay =
    state.pomodoro.kind === "idle" ||
    state.pomodoro.kind === "break-running" ||
    state.pomodoro.kind === "ready" ||
    (state.pomodoro.kind === "focus-paused" &&
      state.pomodoro.reason !== "awaiting-promethee-pause");
  if (shouldApplyPlay) {
    state = coreEvent(state, { type: "promethee-played" }, config);
  }
  return ensurePauseIntent(state);
}

function applySnapshot(
  inputState: SessionCoordinatorState,
  snapshot: AuthoritativeSnapshot,
  config: PomodoroConfig,
  source: Exclude<AuthoritySource, "event">,
  newConnectionInstance = false
): CoordinatorReduction {
  const progressionError = newConnectionInstance
    ? null
    : validateReadModelProgression(inputState, snapshot);
  if (progressionError !== null) {
    return unavailable(inputState, progressionError);
  }

  let state = inputState;
  const connectionChanged =
    newConnectionInstance || state.connectionId !== snapshot.connectionId;
  const hadConnection = state.connectionId !== null;
  const preserveCycle =
    connectionChanged &&
    hadConnection &&
    state.boundSession !== null &&
    snapshot.value.session !== null &&
    state.boundSession.id === snapshot.value.session.id;
  if (connectionChanged && hadConnection && !preserveCycle) {
    const reset = resetPomodoro(state);
    if (reset === null) {
      return unavailable(state, cycleIdentityExhaustedError(), true);
    }
    state = { ...state, pomodoro: reset };
  }

  state = {
    ...state,
    status: "ready",
    connectionId: snapshot.connectionId,
    lastSequence: snapshot.atSequence,
    lastEventOccurredAtMs: connectionChanged ? 0 : state.lastEventOccurredAtMs,
    boundSession: connectionChanged ? null : state.boundSession,
    pendingPause: connectionChanged ? null : state.pendingPause,
    acceptedLocalActions: connectionChanged ? [] : state.acceptedLocalActions,
    cycleCheckpoints: connectionChanged ? [] : state.cycleCheckpoints,
    tasks: snapshot.value.tasks,
    taskRefreshRequired: false,
    taskRefreshInFlight: false,
    taskRefreshAttempts: 0,
    taskRefreshMarkerSequence: 0,
    pendingTaskRefresh: null,
    pendingReconciliation: null,
    hud: snapshot.value.hud,
    lastError: null
  };
  if (connectionChanged && hadConnection) {
    return applyFreshConnectionSession(
      state,
      snapshot.value.session,
      config,
      preserveCycle
    );
  }
  return applyAuthoritativeSession(state, snapshot.value.session, config, source);
}

function applyHudEvent(
  state: SessionCoordinatorState,
  hud: HudReadModel
): CoordinatorReduction {
  const current = state.hud;
  if (current === null) {
    return { state: { ...state, hud }, effects: NO_EFFECTS };
  }
  if (hud.revision < current.revision) {
    return { state, effects: NO_EFFECTS };
  }
  if (hud.revision === current.revision) {
    return sameHud(current, hud)
      ? { state, effects: NO_EFFECTS }
      : requestReconciliation(
          state,
          localError("INVALID_PAYLOAD", "Equal HUD revisions carried different values.", true)
        );
  }
  if (
    current.geometry !== null &&
    hud.geometry !== null &&
    (hud.geometry.layoutRevision < current.geometry.layoutRevision ||
      (hud.geometry.layoutRevision === current.geometry.layoutRevision &&
        !sameGeometry(current, hud)))
  ) {
    return requestReconciliation(
      state,
      localError("INVALID_PAYLOAD", "HUD layout revision is inconsistent.", true)
    );
  }
  return { state: { ...state, hud }, effects: NO_EFFECTS };
}

function applyBridgeEvent(
  state: SessionCoordinatorState,
  event: BridgeEvent,
  config: PomodoroConfig
): CoordinatorReduction {
  if (event.connectionId !== state.connectionId) {
    return { state, effects: NO_EFFECTS };
  }
  if (event.sequence <= state.lastSequence) {
    return { state, effects: NO_EFFECTS };
  }
  if (event.sequence !== state.lastSequence + 1) {
    return requestReconciliation(
      state,
      localError("SEQUENCE_GAP", "Coordinator observed an event sequence gap.", true)
    );
  }

  state = {
    ...state,
    lastSequence: event.sequence,
    lastEventOccurredAtMs: carriesSessionAuthority(event)
      ? event.occurredAtMs
      : state.lastEventOccurredAtMs
  };
  switch (event.type) {
    case "session.changed":
      return applyAuthoritativeSession(state, event.payload.session, config, "event");
    case "session.terminal":
      return state.boundSession?.id === event.payload.sessionId
        ? applyAuthoritativeSession(state, null, config, "event", true)
        : { state, effects: NO_EFFECTS };
    case "tasks.refresh-required":
      return {
        state: {
          ...state,
          taskRefreshRequired: true,
          taskRefreshAttempts: state.taskRefreshInFlight
            ? state.taskRefreshAttempts
            : 0,
          taskRefreshMarkerSequence: event.sequence
        },
        effects: NO_EFFECTS
      };
    case "hud.changed":
      return applyHudEvent(state, event.payload.hud);
    case "bridge.closing": {
      const stopped = coreEvent(state, { type: "promethee-stopped" }, config);
      return {
        state: {
          ...stopped,
          status: "disconnected",
          connectionId: null,
          boundSession: null,
          pendingPause: null,
          taskRefreshRequired: false,
          taskRefreshInFlight: false,
          taskRefreshAttempts: 0,
          taskRefreshMarkerSequence: 0,
          pendingTaskRefresh: null,
          pendingReconciliation: null
        },
        effects: NO_EFFECTS
      };
    }
  }
}

function applyAcknowledgement(
  state: SessionCoordinatorState,
  commandId: string,
  acknowledgement: SessionCommandAcknowledgement,
  config: PomodoroConfig
): CoordinatorReduction {
  if (state.status !== "ready") {
    return { state, effects: NO_EFFECTS };
  }
  const pending = state.pendingPause;
  if (pending === null || pending.command.commandId !== commandId) {
    return { state, effects: NO_EFFECTS };
  }
  if (
    state.pomodoro.kind !== "focus-paused" ||
    state.pomodoro.reason !== "awaiting-promethee-pause" ||
    pending.effectId !== state.pomodoro.pauseRequestId ||
    pending.pauseRequestId !== state.pomodoro.pauseRequestId
  ) {
    return requestReconciliation(
      state,
      localError("INVALID_PAYLOAD", "Pause acknowledgement did not match the active cycle.", true)
    );
  }
  if (
    acknowledgement.connectionId !== state.connectionId ||
    acknowledgement.authoritative.connectionId !== state.connectionId ||
    acknowledgement.commandId !== commandId ||
    acknowledgement.outcome === "rejected"
  ) {
    return requestReconciliation(
      state,
      localError("CONNECTION_CHANGED", "Pause acknowledgement requires reconciliation.", true)
    );
  }

  const authoritative = acknowledgement.authoritative.value;
  if (
    authoritative === null ||
    authoritative.id !== pending.command.sessionId ||
    authoritative.status !== "paused" ||
    authoritative.revision < pending.command.expectedRevision ||
    (state.boundSession?.id === authoritative.id &&
      authoritative.revision < state.boundSession.revision)
  ) {
    return requestReconciliation(
      state,
      localError("INVALID_PAYLOAD", "Pause acknowledgement did not confirm paused state.", true)
    );
  }
  return applyAuthoritativeSession(state, authoritative, config, "event");
}

function mergeEffects(
  first: readonly CoordinatorEffect[],
  second: readonly CoordinatorEffect[]
): readonly CoordinatorEffect[] {
  return first.length === 0 ? second : second.length === 0 ? first : [...first, ...second];
}

function applyEventWithoutCycleRewind(
  state: SessionCoordinatorState,
  event: BridgeEvent,
  receiptNowMs: number,
  config: PomodoroConfig
): CoordinatorReduction {
  const preserveSessionWatermark = isSameSessionNonNewerEvent(state, event);
  const atReceipt = advanceClock(state, config, receiptNowMs);
  const applied = applyBridgeEvent(atReceipt.state, event, config);
  return {
    state: preserveSessionWatermark
      ? {
          ...applied.state,
          lastEventOccurredAtMs: Math.max(
            state.lastEventOccurredAtMs,
            event.occurredAtMs
          )
        }
      : applied.state,
    effects: mergeEffects(atReceipt.effects, applied.effects)
  };
}

function applyReplayEvents(
  input: CoordinatorReduction,
  events: readonly BridgeEvent[],
  receiptNowMs: number,
  config: PomodoroConfig
): CoordinatorReduction {
  let result = input;
  for (const event of events) {
    const sameSessionNonNewer = isSameSessionNonNewerEvent(result.state, event);
    if (
      event.occurredAtMs > receiptNowMs ||
      (carriesSessionAuthority(event) &&
        event.occurredAtMs < result.state.lastEventOccurredAtMs &&
        !sameSessionNonNewer)
    ) {
      const invalid = requestReconciliation(
        result.state,
        localError("INVALID_PAYLOAD", "Replay event time is inconsistent.", true)
      );
      return {
        state: invalid.state,
        effects: mergeEffects(result.effects, invalid.effects)
      };
    }
    if (isReadModelOnlyEvent(event) || sameSessionNonNewer) {
      const applied = applyEventWithoutCycleRewind(
        result.state,
        event,
        receiptNowMs,
        config
      );
      result = {
        state: recordCycleCheckpoint(applied.state),
        effects: mergeEffects(result.effects, applied.effects)
      };
      continue;
    }
    const atEvent = advanceClock(result.state, config, event.occurredAtMs);
    const eventResult = applyBridgeEvent(atEvent.state, event, config);
    result = {
      state: recordCycleCheckpoint(eventResult.state),
      effects: mergeEffects(
        mergeEffects(result.effects, atEvent.effects),
        eventResult.effects
      )
    };
  }
  const atReceipt = advanceClock(result.state, config, receiptNowMs);
  return {
    state: atReceipt.state,
    effects: mergeEffects(result.effects, atReceipt.effects)
  };
}

function reduceBridgeEventIngress(
  state: SessionCoordinatorState,
  ingress: Extract<CoordinatorIngress, { readonly type: "bridge-event" }>,
  config: PomodoroConfig
): CoordinatorReduction {
  const sameSessionNonNewer = isSameSessionNonNewerEvent(state, ingress.event);
  if (
    ingress.event.occurredAtMs > ingress.nowMs ||
    (carriesSessionAuthority(ingress.event) &&
      ingress.event.occurredAtMs < state.lastEventOccurredAtMs &&
      !sameSessionNonNewer)
  ) {
    const suspended = requestReconciliation(
      { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) },
      localError("INVALID_PAYLOAD", "Bridge event time is inconsistent.", true)
    );
    return suspended;
  }

  if (
    ingress.event.connectionId !== state.connectionId ||
    ingress.event.sequence <= state.lastSequence
  ) {
    return advanceClock(state, config, ingress.nowMs);
  }
  if (ingress.event.sequence !== state.lastSequence + 1) {
    return requestReconciliation(
      { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) },
      localError("SEQUENCE_GAP", "Coordinator observed an event sequence gap.", true)
    );
  }
  if (ingress.event.type === "bridge.closing") {
    return applyBridgeEvent(
      { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) },
      ingress.event,
      config
    );
  }
  if (isReadModelOnlyEvent(ingress.event)) {
    return applyEventWithoutCycleRewind(
      state,
      ingress.event,
      ingress.nowMs,
      config
    );
  }
  if (sameSessionNonNewer) {
    return applyEventWithoutCycleRewind(
      state,
      ingress.event,
      ingress.nowMs,
      config
    );
  }

  const rewoundCycle = rewindCycleForEvent(state, ingress.event.occurredAtMs);
  if (rewoundCycle === null) {
    return requestReconciliation(
      { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) },
      localError(
        "INVALID_PAYLOAD",
        "No bounded cycle checkpoint covers the authoritative event time.",
        true
      )
    );
  }
  const replayPending = rewoundCycle.previouslyIssuedPause ?? undefined;
  const atEvent = advanceClock(
    rewoundCycle.state,
    config,
    ingress.event.occurredAtMs,
    replayPending
  );
  const applied = applyBridgeEvent(atEvent.state, ingress.event, config);
  const eventResult: CoordinatorReduction = {
    state: recordCycleCheckpoint(
      applied.state,
      rewoundCycle.checkpointLocalActionSequence
    ),
    effects: mergeEffects(atEvent.effects, applied.effects)
  };
  const replayed = eventResult.state.status === "ready"
    ? replayAcceptedLocalActions(
        eventResult,
        rewoundCycle.replayActions,
        config
      )
    : eventResult;

  if (
    replayed.state.status !== "ready" &&
    rewoundCycle.replayActions.length > 0
  ) {
    return requestReconciliation(
      {
        ...state,
        nowMs: Math.max(state.nowMs, ingress.nowMs),
        lastSequence: ingress.event.sequence,
        lastEventOccurredAtMs: ingress.event.occurredAtMs
      },
      replayed.state.lastError ?? localError(
        "INVALID_PAYLOAD",
        "Event-time correction could not preserve committed local intent.",
        true
      )
    );
  }
  const atReceipt = advanceClock(
    replayed.state,
    config,
    ingress.nowMs,
    replayPending
  );
  return {
    state: atReceipt.state,
    effects: mergeEffects(
      replayed.effects,
      atReceipt.effects
    )
  };
}

function reduceWithoutInitialTick(
  state: SessionCoordinatorState,
  ingress: CoordinatorIngress,
  config: PomodoroConfig
): CoordinatorReduction {
  const atReceipt = { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) };
  switch (ingress.type) {
    case "bootstrap": {
      if (state.connectionGeneration === Number.MAX_SAFE_INTEGER) {
        return unavailable(
          atReceipt,
          localError("INVALID_ARGUMENT", "Connection generation is exhausted.", false),
          true
        );
      }
      const applied = applySnapshot(
        {
          ...atReceipt,
          connectionGeneration: state.connectionGeneration + 1,
          pendingPause: null,
          pendingTaskRefresh: null,
          pendingReconciliation: null,
          taskRefreshInFlight: false
        },
        ingress.bootstrap.snapshot,
        config,
        "bootstrap",
        true
      );
      return applyReplayEvents(applied, ingress.bootstrap.replayEvents, ingress.nowMs, config);
    }
    case "sequence-gap":
      return ingress.connectionId === state.connectionId
        ? requestReconciliation(
            atReceipt,
            localError("SEQUENCE_GAP", "Adapter reported an event sequence gap.", true)
          )
        : { state: atReceipt, effects: NO_EFFECTS };
    case "protocol-fault":
      return requestReconciliation(atReceipt, ingress.error);
    case "reconcile-settled":
      if (
        state.status !== "reconciling" ||
        state.connectionId === null ||
        state.pendingReconciliation === null ||
        ingress.connectionId !== state.connectionId ||
        ingress.connectionGeneration !== state.connectionGeneration ||
        ingress.connectionId !== state.pendingReconciliation.connectionId ||
        ingress.connectionGeneration !== state.pendingReconciliation.connectionGeneration ||
        ingress.effectToken !== state.pendingReconciliation.effectToken
      ) {
        return { state: atReceipt, effects: NO_EFFECTS };
      }
      if (!ingress.result.ok) {
        return {
          state: {
            ...atReceipt,
            status: ingress.result.error.retryable ? "reconciling" : "unavailable",
            pendingReconciliation: null,
            lastError: ingress.result.error
          },
          effects: NO_EFFECTS
        };
      } else {
        const applied = applySnapshot(
          { ...state, pendingReconciliation: null },
          ingress.result.value.snapshot,
          config,
          "reconcile"
        );
        return applyReplayEvents(
          applied,
          ingress.result.value.replayEvents,
          ingress.nowMs,
          config
        );
      }
    case "disconnect": {
      const stopped = coreEvent(atReceipt, { type: "promethee-stopped" }, config);
      return {
        state: {
          ...stopped,
          status: "disconnected",
          connectionId: null,
          lastSequence: 0,
          lastEventOccurredAtMs: 0,
          boundSession: null,
          pendingPause: null,
          taskRefreshRequired: false,
          taskRefreshInFlight: false,
          taskRefreshAttempts: 0,
          taskRefreshMarkerSequence: 0,
          pendingTaskRefresh: null,
          pendingReconciliation: null,
          lastError: null
        },
        effects: NO_EFFECTS
      };
    }
    case "pause-settled":
    case "task-refresh-settled":
    case "bridge-event":
    case "tick":
    case "local-action":
      return { state: atReceipt, effects: NO_EFFECTS };
  }
}

function canApplyLocalAction(
  state: SessionCoordinatorState,
  action: CoordinatorLocalAction
): boolean {
  if (action.type === "end-pomodoro") {
    return state.pomodoro.kind !== "idle";
  }
  if (state.status !== "ready") {
    return false;
  }

  const boundStatus = state.boundSession?.status ?? null;
  switch (action.type) {
    case "start-break":
      return state.pomodoro.kind === "focus-paused" &&
        state.pomodoro.reason === "awaiting-break-start" &&
        boundStatus === "paused";
    case "skip-focus":
      return (state.pomodoro.kind === "focus-running" && boundStatus === "running") ||
        (state.pomodoro.kind === "focus-paused" &&
          state.pomodoro.reason === "promethee-paused" &&
          boundStatus === "paused");
    case "skip-break":
      return (state.pomodoro.kind === "break-running" ||
          (state.pomodoro.kind === "focus-paused" &&
            state.pomodoro.reason === "awaiting-break-start")) &&
        boundStatus === "paused";
    case "restart-phase":
      return (state.pomodoro.kind === "focus-running" && boundStatus === "running") ||
        (state.pomodoro.kind === "focus-paused" &&
          state.pomodoro.reason === "promethee-paused" &&
          boundStatus === "paused") ||
        (state.pomodoro.kind === "break-running" && boundStatus === "paused");
    case "dismiss-ready":
      return state.pomodoro.kind === "ready";
  }
}

function applyLocalAction(
  state: SessionCoordinatorState,
  action: CoordinatorLocalAction,
  config: PomodoroConfig,
  previouslyIssuedPause?: PendingPause
): CoordinatorReduction {
  const applyEngineEvent = (
    event:
      | { readonly type: "start-break" }
      | { readonly type: "skip-focus" }
      | { readonly type: "skip-break" }
      | { readonly type: "restart-phase" }
      | { readonly type: "ready-dismissed" }
      | { readonly type: "reset-cycle" }
  ): CoordinatorReduction => {
    const result = transition(state.pomodoro, event, config, state.nowMs);
    if (result.rejection !== undefined) {
      return { state, effects: NO_EFFECTS };
    }
    const nextState = {
      ...state,
      pomodoro: result.state,
      pendingPause: event.type === "reset-cycle" ? null : state.pendingPause
    };
    return pauseEffectFromCore(nextState, result.effects, previouslyIssuedPause);
  };

  if (!canApplyLocalAction(state, action)) {
    return { state, effects: NO_EFFECTS };
  }

  switch (action.type) {
    case "end-pomodoro":
      return applyEngineEvent({ type: "reset-cycle" });
    case "start-break":
      return applyEngineEvent({ type: "start-break" });
    case "skip-focus":
      return applyEngineEvent({ type: "skip-focus" });
    case "skip-break":
      return applyEngineEvent({ type: "skip-break" });
    case "restart-phase":
      return applyEngineEvent({ type: "restart-phase" });
    case "dismiss-ready":
      return applyEngineEvent({ type: "ready-dismissed" });
  }
}

function applyAndRecordLocalAction(
  state: SessionCoordinatorState,
  action: CoordinatorLocalAction,
  config: PomodoroConfig
): CoordinatorReduction {
  if (!canApplyLocalAction(state, action)) {
    return { state, effects: NO_EFFECTS };
  }
  if (state.localActionSequence === Number.MAX_SAFE_INTEGER) {
    return {
      state: {
        ...state,
        lastError: localError(
          "INVALID_ARGUMENT",
          "Coordinator local-action sequence is exhausted.",
          false
        )
      },
      effects: NO_EFFECTS
    };
  }

  const applied = applyLocalAction(state, action, config);
  const sequence = state.localActionSequence + 1;
  const entry: AcceptedCoordinatorLocalAction = {
    sequence,
    acceptedAtMs: state.nowMs,
    connectionId: state.connectionId,
    connectionGeneration: state.connectionGeneration,
    action,
    pendingPauseAfter: applied.state.pendingPause
  };
  return {
    state: {
      ...applied.state,
      localActionSequence: sequence,
      acceptedLocalActions: [...state.acceptedLocalActions, entry]
    },
    effects: applied.effects
  };
}

function replayAcceptedLocalActions(
  input: CoordinatorReduction,
  actions: readonly AcceptedCoordinatorLocalAction[],
  config: PomodoroConfig
): CoordinatorReduction {
  let result = input;
  for (const entry of actions) {
    const replayPending = entry.pendingPauseAfter ?? undefined;
    const atAction = advanceClock(
      result.state,
      config,
      entry.acceptedAtMs,
      replayPending
    );
    result = {
      state: atAction.state,
      effects: mergeEffects(result.effects, atAction.effects)
    };

    if (!canApplyLocalAction(result.state, entry.action)) {
      const reconciled = requestReconciliation(
        result.state,
        localError(
          "INVALID_PAYLOAD",
          "An accepted local action could not be replayed after event-time correction.",
          true
        )
      );
      return {
        state: reconciled.state,
        effects: mergeEffects(result.effects, reconciled.effects)
      };
    }

    const applied = applyLocalAction(
      result.state,
      entry.action,
      config,
      replayPending
    );
    result = {
      state: recordCycleCheckpoint(applied.state, entry.sequence),
      effects: mergeEffects(result.effects, applied.effects)
    };
    if (result.state.status !== "ready") {
      return result;
    }
  }
  return result;
}

function reduceAfterTick(
  state: SessionCoordinatorState,
  ingress: CoordinatorIngress,
  config: PomodoroConfig
): CoordinatorReduction {
  switch (ingress.type) {
    case "tick":
      return { state, effects: NO_EFFECTS };
    case "local-action":
      return applyAndRecordLocalAction(state, ingress.action, config);
    case "pause-settled":
      if (state.status !== "ready") {
        return { state, effects: NO_EFFECTS };
      }
      if (
        state.pendingPause === null ||
        ingress.connectionId !== state.connectionId ||
        ingress.connectionGeneration !== state.connectionGeneration ||
        ingress.connectionId !== state.pendingPause.command.connectionId ||
        ingress.connectionGeneration !== state.pendingPause.connectionGeneration ||
        ingress.effectToken !== state.pendingPause.effectToken
      ) {
        return { state, effects: NO_EFFECTS };
      }
      if (!ingress.result.ok) {
        return ingress.result.error.execution === "indeterminate"
          ? requestReconciliation(state, ingress.result.error)
          : unavailable(state, ingress.result.error, true);
      }
      return applyAcknowledgement(state, ingress.commandId, ingress.result.value, config);
    case "task-refresh-settled":
      if (
        !state.taskRefreshInFlight ||
        state.connectionId === null ||
        state.pendingTaskRefresh === null ||
        ingress.connectionId !== state.connectionId ||
        ingress.connectionGeneration !== state.connectionGeneration ||
        ingress.connectionId !== state.pendingTaskRefresh.connectionId ||
        ingress.connectionGeneration !== state.pendingTaskRefresh.connectionGeneration ||
        ingress.effectToken !== state.pendingTaskRefresh.effectToken
      ) {
        return { state, effects: NO_EFFECTS };
      }
      if (!ingress.result.ok) {
        const failedState = {
          ...state,
          taskRefreshInFlight: false,
          pendingTaskRefresh: null,
          taskRefreshRequired: true,
          taskRefreshAttempts: ingress.result.error.code === "SEQUENCE_GAP"
            ? state.taskRefreshAttempts
            : MAX_TASK_REFRESH_ATTEMPTS,
          lastError: ingress.result.error
        };
        if (
          ingress.result.error.code === "CONNECTION_CHANGED" ||
          ingress.result.error.code === "NOT_CONNECTED"
        ) {
          return unavailable(failedState, ingress.result.error);
        }
        return {
          state: failedState,
          effects: NO_EFFECTS
        };
      } else {
        const refreshed = ingress.result.value;
        if (refreshed.connectionId !== state.connectionId) {
          return {
            state: {
              ...state,
              taskRefreshInFlight: false,
              pendingTaskRefresh: null,
              taskRefreshRequired: true,
              taskRefreshAttempts: MAX_TASK_REFRESH_ATTEMPTS,
              lastError: localError(
                "CONNECTION_CHANGED",
                "Task refresh belongs to another connection.",
                false
              )
            },
            effects: NO_EFFECTS
          };
        }
        const current = state.tasks;
        const next = refreshed.value;
        if (
          current !== null &&
          next !== null &&
          (next.revision < current.revision ||
            (next.revision === current.revision && !sameTasks(current, next)))
        ) {
          return {
            state: {
              ...state,
              taskRefreshInFlight: false,
              pendingTaskRefresh: null,
              taskRefreshRequired: true,
              taskRefreshAttempts: MAX_TASK_REFRESH_ATTEMPTS,
              lastError: localError(
                "INVALID_PAYLOAD",
                "Task refresh revision is inconsistent with the current read model.",
                false
              )
            },
            effects: NO_EFFECTS
          };
        }
        const remainsDirty =
          state.taskRefreshMarkerSequence > state.pendingTaskRefresh.startedAtSequence ||
          refreshed.atSequence < state.taskRefreshMarkerSequence ||
          refreshed.atSequence < state.lastSequence;
        return {
          state: {
            ...state,
            tasks: next,
            taskRefreshInFlight: false,
            pendingTaskRefresh: null,
            taskRefreshRequired: remainsDirty,
            taskRefreshAttempts: remainsDirty ? state.taskRefreshAttempts : 0,
            lastError: null
          },
          effects: NO_EFFECTS
        };
      }
    case "bootstrap":
    case "bridge-event":
    case "sequence-gap":
    case "protocol-fault":
    case "reconcile-settled":
    case "disconnect":
      return { state, effects: NO_EFFECTS };
  }
}

function finalize(
  initialState: SessionCoordinatorState,
  reduction: CoordinatorReduction
): CoordinatorReduction {
  const phaseStillAwaiting =
    reduction.state.pomodoro.kind === "focus-paused" &&
    reduction.state.pomodoro.reason === "awaiting-promethee-pause";
  let effects = reduction.effects;
  let state = reduction.state;

  if (!phaseStillAwaiting) {
    state = { ...state, pendingPause: null };
    effects = effects.filter((effect) => effect.type !== "send-pause");
  }
  if (state.status !== "ready") {
    const createdInThisReduction =
      initialState.pendingPause === null && state.pendingPause !== null;
    effects = effects.filter((effect) => effect.type !== "send-pause");
    if (createdInThisReduction) {
      state = { ...state, pendingPause: null };
    }
  }
  if (
    state.status === "ready" &&
    state.taskRefreshRequired &&
    !state.taskRefreshInFlight &&
    state.taskRefreshAttempts < MAX_TASK_REFRESH_ATTEMPTS &&
    state.pendingPause === null
  ) {
    const allocated = allocateEffectToken(state, "tasks");
    if (allocated === null) {
      const failed = unavailable(
        state,
        localError("INVALID_ARGUMENT", "Coordinator effect sequence is exhausted.", false),
        true
      );
      return { state: recordCycleCheckpoint(failed.state), effects: NO_EFFECTS };
    }
    const connectionId = allocated.state.connectionId;
    if (connectionId !== null) {
      state = allocated.state;
      const pendingTaskRefresh = {
        connectionId,
        connectionGeneration: state.connectionGeneration,
        effectToken: allocated.effectToken,
        startedAtSequence: state.lastSequence
      };
      state = {
        ...state,
        taskRefreshInFlight: true,
        taskRefreshAttempts: state.taskRefreshAttempts + 1,
        pendingTaskRefresh
      };
      effects = [...effects, {
        type: "refresh-read-model",
        ...pendingTaskRefresh
      }];
    }
  }
  return { state: recordCycleCheckpoint(state), effects };
}

function matchesPendingAsyncEffect(
  state: SessionCoordinatorState,
  ingress: Extract<
    CoordinatorIngress,
    {
      readonly type:
        | "pause-settled"
        | "reconcile-settled"
        | "task-refresh-settled";
    }
  >
): boolean {
  if (
    ingress.connectionId !== state.connectionId ||
    ingress.connectionGeneration !== state.connectionGeneration
  ) {
    return false;
  }
  if (ingress.type === "pause-settled") {
    return state.pendingPause !== null &&
      ingress.commandId === state.pendingPause.command.commandId &&
      ingress.connectionId === state.pendingPause.command.connectionId &&
      ingress.connectionGeneration === state.pendingPause.connectionGeneration &&
      ingress.effectToken === state.pendingPause.effectToken;
  }
  if (ingress.type === "reconcile-settled") {
    return state.pendingReconciliation !== null &&
      ingress.connectionId === state.pendingReconciliation.connectionId &&
      ingress.connectionGeneration === state.pendingReconciliation.connectionGeneration &&
      ingress.effectToken === state.pendingReconciliation.effectToken;
  }
  return state.pendingTaskRefresh !== null &&
    ingress.connectionId === state.pendingTaskRefresh.connectionId &&
    ingress.connectionGeneration === state.pendingTaskRefresh.connectionGeneration &&
    ingress.effectToken === state.pendingTaskRefresh.effectToken;
}

export function reduceSessionCoordinator(
  state: SessionCoordinatorState,
  ingress: CoordinatorIngress,
  config: PomodoroConfig
): CoordinatorReduction {
  if (!Number.isSafeInteger(ingress.nowMs) || ingress.nowMs < 0) {
    return {
      state: {
        ...state,
        lastError: localError("INVALID_ARGUMENT", "Coordinator time is invalid.", false)
      },
      effects: NO_EFFECTS
    };
  }

  if (
    (ingress.type === "pause-settled" ||
      ingress.type === "reconcile-settled" ||
      ingress.type === "task-refresh-settled") &&
    !matchesPendingAsyncEffect(state, ingress)
  ) {
    return { state, effects: NO_EFFECTS };
  }

  let reduction: CoordinatorReduction;
  if (
    ingress.type === "bridge-event" &&
    state.status === "reconciling" &&
    ingress.event.type !== "bridge.closing"
  ) {
    reduction = {
      state: { ...state, nowMs: Math.max(state.nowMs, ingress.nowMs) },
      effects: NO_EFFECTS
    };
  } else if (ingress.type === "bridge-event") {
    reduction = reduceBridgeEventIngress(state, ingress, config);
  } else if (
    ingress.type === "bootstrap" ||
    ingress.type === "sequence-gap" ||
    ingress.type === "protocol-fault" ||
    ingress.type === "reconcile-settled" ||
    ingress.type === "disconnect" ||
    (ingress.type === "pause-settled" && state.status === "reconciling")
  ) {
    reduction = reduceWithoutInitialTick(state, ingress, config);
  } else {
    const advanced = advanceClock(state, config, ingress.nowMs);
    const reduced = reduceAfterTick(advanced.state, ingress, config);
    reduction = {
      state: reduced.state,
      effects: mergeEffects(advanced.effects, reduced.effects)
    };
  }
  return finalize(state, reduction);
}
