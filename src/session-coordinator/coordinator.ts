import type {
  AdapterSignal,
  BridgeError,
  BridgeResult,
  ConnectionBootstrap,
  ReconciliationSnapshot,
  SessionCommandAcknowledgement,
  TaskRefreshSnapshot
} from "../promethee-adapter/v1/index.ts";
import { createSessionCoordinatorState, reduceSessionCoordinator } from "./reducer.ts";
import type {
  CoordinatorEffect,
  CoordinatorIngress,
  CoordinatorLocalAction,
  SessionCoordinatorApi,
  SessionCoordinatorOptions,
  SessionCoordinatorState
} from "./types.ts";

interface QueuedIngress {
  readonly input: CoordinatorIngress;
  readonly resolve: () => void;
}

export class SessionCoordinator implements SessionCoordinatorApi {
  private currentState: SessionCoordinatorState = createSessionCoordinatorState();
  private readonly options: SessionCoordinatorOptions;
  private readonly queue: QueuedIngress[] = [];
  private draining = false;
  private inFlightEffects = 0;
  private readonly idleWaiters: Array<() => void> = [];

  constructor(options: SessionCoordinatorOptions) {
    this.options = options;
  }

  get state(): SessionCoordinatorState {
    return this.currentState;
  }

  start(bootstrap: ConnectionBootstrap, nowMs = this.options.clock()): Promise<void> {
    return this.enqueue({ type: "bootstrap", nowMs, bootstrap });
  }

  tick(nowMs = this.options.clock()): Promise<void> {
    return this.enqueue({ type: "tick", nowMs });
  }

  dispatchLocalAction(
    action: CoordinatorLocalAction,
    nowMs = this.options.clock()
  ): Promise<void> {
    return this.enqueue({ type: "local-action", nowMs, action });
  }

  acceptAdapterSignal(signal: AdapterSignal, nowMs = this.options.clock()): Promise<void> {
    switch (signal.type) {
      case "event":
        return this.enqueue({ type: "bridge-event", nowMs, event: signal.event });
      case "sequence-gap":
        return this.enqueue({
          type: "sequence-gap",
          nowMs,
          connectionId: signal.connectionId
        });
      case "protocol-fault":
        return this.enqueue({ type: "protocol-fault", nowMs, error: signal.error });
      case "event-dropped":
        return Promise.resolve();
    }
  }

  disconnect(nowMs = this.options.clock()): Promise<void> {
    return this.enqueue({ type: "disconnect", nowMs });
  }

  async settle(): Promise<void> {
    while (this.draining || this.queue.length > 0 || this.inFlightEffects > 0) {
      await new Promise<void>((resolve) => {
        this.idleWaiters.push(resolve);
      });
    }
  }

  private enqueue(input: CoordinatorIngress): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ input, resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const queued = this.queue.shift();
        if (queued === undefined) {
          break;
        }
        const reduction = reduceSessionCoordinator(
          this.currentState,
          queued.input,
          this.options.config
        );
        this.currentState = reduction.state;
        for (const effect of reduction.effects) {
          this.launch(effect);
        }
        queued.resolve();
      }
    } finally {
      this.draining = false;
      this.notifyIfIdle();
    }
  }

  private launch(effect: CoordinatorEffect): void {
    this.inFlightEffects += 1;
    if (effect.type === "send-pause") {
      void this.options.bridge.pause(effect.command)
        .then((result) =>
          this.enqueue({
            type: "pause-settled",
            nowMs: this.options.clock(),
            commandId: effect.command.commandId,
            connectionId: effect.command.connectionId,
            connectionGeneration: effect.connectionGeneration,
            effectToken: effect.effectToken,
            result
          })
        )
        .catch(() =>
          this.enqueue({
            type: "pause-settled",
            nowMs: this.options.clock(),
            commandId: effect.command.commandId,
            connectionId: effect.command.connectionId,
            connectionGeneration: effect.connectionGeneration,
            effectToken: effect.effectToken,
            result: this.unexpectedFailure<SessionCommandAcknowledgement>()
          })
        )
        .finally(() => {
          this.inFlightEffects -= 1;
          this.notifyIfIdle();
        });
      return;
    }

    const isReadModelRefresh = effect.type === "refresh-read-model";
    if (isReadModelRefresh) {
      void this.options.bridge.refreshReadModel()
        .then((result) =>
          this.enqueue({
            type: "task-refresh-settled",
            nowMs: this.options.clock(),
            connectionId: effect.connectionId,
            connectionGeneration: effect.connectionGeneration,
            effectToken: effect.effectToken,
            result
          })
        )
        .catch(() =>
          this.enqueue({
            type: "task-refresh-settled",
            nowMs: this.options.clock(),
            connectionId: effect.connectionId,
            connectionGeneration: effect.connectionGeneration,
            effectToken: effect.effectToken,
            result: this.unexpectedFailure<TaskRefreshSnapshot>()
          })
        )
        .finally(() => {
          this.inFlightEffects -= 1;
          this.notifyIfIdle();
        });
      return;
    }

    void this.options.bridge.reconcile()
      .then((result) =>
        this.enqueue({
          type: "reconcile-settled",
          nowMs: this.options.clock(),
          connectionId: effect.connectionId,
          connectionGeneration: effect.connectionGeneration,
          effectToken: effect.effectToken,
          result
        })
      )
      .catch(() =>
        this.enqueue({
          type: "reconcile-settled",
          nowMs: this.options.clock(),
          connectionId: effect.connectionId,
          connectionGeneration: effect.connectionGeneration,
          effectToken: effect.effectToken,
          result: this.unexpectedFailure<ReconciliationSnapshot>()
        })
      )
      .finally(() => {
        this.inFlightEffects -= 1;
        this.notifyIfIdle();
      });
  }

  private unexpectedFailure<T>(): BridgeResult<T> {
    const error: BridgeError = {
      code: "TRANSPORT_ERROR",
      message: "Coordinator bridge effect failed without a typed result.",
      execution: "indeterminate",
      retryable: true
    };
    return { ok: false, error };
  }

  private notifyIfIdle(): void {
    if (this.draining || this.queue.length > 0 || this.inFlightEffects > 0) {
      return;
    }
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  }
}
