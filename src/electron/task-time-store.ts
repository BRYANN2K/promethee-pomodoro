import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_TASK_TIME_SNAPSHOT_BYTES,
  defaultTaskTimeSnapshot,
  validateTaskTimeSnapshot,
  type TaskTimeSnapshot
} from "./task-time-tracker.ts";

const STORE_VERSION = 1;

export type TaskTimeStoreStatus = "corrupt" | "missing" | "ready" | "storage-error";

export class TaskTimeStore {
  private current: TaskTimeSnapshot = defaultTaskTimeSnapshot();
  private readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();
  private storeStatus: TaskTimeStoreStatus = "missing";

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  get value(): TaskTimeSnapshot {
    return this.current;
  }

  get status(): TaskTimeStoreStatus {
    return this.storeStatus;
  }

  async load(): Promise<TaskTimeSnapshot> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(contents, "utf8") > MAX_TASK_TIME_SNAPSHOT_BYTES) {
        this.storeStatus = "corrupt";
        return this.current;
      }
      const decoded = decodeTaskTimeSnapshot(contents);
      if (decoded === null) {
        this.storeStatus = "corrupt";
        return this.current;
      }
      this.current = decoded;
      this.storeStatus = "ready";
    } catch (error) {
      this.storeStatus = isMissingFileError(error) ? "missing" : "storage-error";
      // Missing or inaccessible files keep the empty in-memory ledger. A corrupt
      // or inaccessible ledger is never overwritten by a later checkpoint.
    }
    return this.current;
  }

  save(candidate: TaskTimeSnapshot): Promise<TaskTimeSnapshot | null> {
    if (this.storeStatus === "corrupt" || this.storeStatus === "storage-error") return Promise.resolve(null);
    const validated = validateTaskTimeSnapshot(candidate);
    if (validated === null) return Promise.resolve(null);
    const pending = this.saveQueue.then(() => this.saveValidated(validated));
    this.saveQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async saveValidated(validated: TaskTimeSnapshot): Promise<TaskTimeSnapshot | null> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, encodeTaskTimeSnapshot(validated), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      this.current = validated;
      this.storeStatus = "ready";
      return this.current;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      this.storeStatus = "storage-error";
      return null;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function encodeTaskTimeSnapshot(candidate: TaskTimeSnapshot): string {
  const validated = validateTaskTimeSnapshot(candidate);
  if (validated === null) throw new TypeError("Invalid task time snapshot.");
  const encoded = JSON.stringify({ version: STORE_VERSION, ...validated });
  if (Buffer.byteLength(encoded, "utf8") > MAX_TASK_TIME_SNAPSHOT_BYTES) {
    throw new TypeError("Task time snapshot exceeds the persistence bound.");
  }
  return encoded;
}

export function decodeTaskTimeSnapshot(contents: string): TaskTimeSnapshot | null {
  if (typeof contents !== "string" || Buffer.byteLength(contents, "utf8") > MAX_TASK_TIME_SNAPSHOT_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!hasExactKeys(parsed, ["active", "entries", "nextEntryNumber", "selectedTask", "version"]) || parsed.version !== STORE_VERSION) {
      return null;
    }
    return validateTaskTimeSnapshot({
      active: parsed.active,
      entries: parsed.entries,
      nextEntryNumber: parsed.nextEntryNumber,
      selectedTask: parsed.selectedTask
    });
  } catch {
    return null;
  }
}

function hasExactKeys(candidate: unknown, expected: readonly string[]): candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}
