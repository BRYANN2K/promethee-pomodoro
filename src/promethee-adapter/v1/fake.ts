import { BridgePortFailure } from "./adapter.ts";
import type {
  ClientHello,
  RawPrometheeBridgePortV1,
  SessionCommand
} from "./types.ts";

export type ScriptedValue =
  | unknown
  | Error
  | ((argument?: unknown) => unknown | Promise<unknown>);

export interface ScriptedBridgePortOptions {
  readonly hello: ScriptedValue;
  readonly snapshots?: readonly ScriptedValue[];
  readonly pauses?: readonly ScriptedValue[];
  readonly resumes?: readonly ScriptedValue[];
}

export interface ScriptedBridgeCalls {
  readonly hellos: readonly ClientHello[];
  readonly snapshotConnectionIds: readonly string[];
  readonly pauses: readonly SessionCommand[];
  readonly resumes: readonly SessionCommand[];
}

export class ScriptedBridgePort implements RawPrometheeBridgePortV1 {
  private readonly helloScript: ScriptedValue;
  private readonly snapshotScript: ScriptedValue[];
  private readonly pauseScript: ScriptedValue[];
  private readonly resumeScript: ScriptedValue[];
  private listener: ((event: unknown) => void) | null = null;
  private beforeSnapshotRead: (() => void) | null = null;
  private readonly helloCalls: ClientHello[] = [];
  private readonly snapshotCalls: string[] = [];
  private readonly pauseCalls: SessionCommand[] = [];
  private readonly resumeCalls: SessionCommand[] = [];

  constructor(options: ScriptedBridgePortOptions) {
    this.helloScript = options.hello;
    this.snapshotScript = [...(options.snapshots ?? [])];
    this.pauseScript = [...(options.pauses ?? [])];
    this.resumeScript = [...(options.resumes ?? [])];
  }

  get calls(): ScriptedBridgeCalls {
    return {
      hellos: [...this.helloCalls],
      snapshotConnectionIds: [...this.snapshotCalls],
      pauses: [...this.pauseCalls],
      resumes: [...this.resumeCalls]
    };
  }

  async negotiate(hello: ClientHello): Promise<unknown> {
    this.helloCalls.push(hello);
    return this.resolve(this.helloScript, hello);
  }

  subscribe(_connectionId: string, listener: (event: unknown) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  async readSnapshot(connectionId: string): Promise<unknown> {
    this.snapshotCalls.push(connectionId);
    const hook = this.beforeSnapshotRead;
    this.beforeSnapshotRead = null;
    hook?.();
    return this.resolve(this.shiftRequired(this.snapshotScript, "snapshot"), connectionId);
  }

  async pause(command: SessionCommand): Promise<unknown> {
    this.pauseCalls.push(command);
    return this.resolve(this.shiftRequired(this.pauseScript, "pause"), command);
  }

  async resume(command: SessionCommand): Promise<unknown> {
    this.resumeCalls.push(command);
    return this.resolve(this.shiftRequired(this.resumeScript, "resume"), command);
  }

  emit(event: unknown): void {
    this.listener?.(event);
  }

  beforeNextSnapshotRead(callback: () => void): void {
    this.beforeSnapshotRead = callback;
  }

  enqueueSnapshot(value: ScriptedValue): void {
    this.snapshotScript.push(value);
  }

  enqueuePause(value: ScriptedValue): void {
    this.pauseScript.push(value);
  }

  enqueueResume(value: ScriptedValue): void {
    this.resumeScript.push(value);
  }

  static indeterminate(message = "Scripted command acknowledgement was lost."): Error {
    return new BridgePortFailure(message, "indeterminate");
  }

  private shiftRequired(script: ScriptedValue[], name: string): ScriptedValue {
    if (script.length === 0) {
      throw new BridgePortFailure(`No scripted ${name} result is available.`, "not-sent");
    }
    return script.shift() as ScriptedValue;
  }

  private async resolve(value: ScriptedValue, argument?: unknown): Promise<unknown> {
    if (value instanceof Error) {
      throw value;
    }
    return typeof value === "function" ? value(argument) : value;
  }
}
