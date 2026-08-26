import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  defaultRuntimeSettings,
  validateRuntimeSettings,
  type RuntimeSettings
} from "./runtime-controller.ts";

const STORE_VERSION = 2;
const MAX_STORE_BYTES = 16 * 1024;
const MAX_TASK_ID_LENGTH = 160;
const MAX_TASK_TITLE_LENGTH = 512;

export interface SelectedTaskReference {
  readonly id: string;
  readonly projectId: string | null;
  readonly title: string;
}

export interface RuntimePreferences {
  readonly onboardingCompleted: boolean;
  readonly selectedTask: SelectedTaskReference | null;
  readonly settings: RuntimeSettings;
}

export class RuntimePreferenceStore {
  private current: RuntimePreferences = defaultPreferences();
  private readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) { this.filePath = filePath; }

  get value(): RuntimePreferences {
    return this.current;
  }

  async load(): Promise<RuntimePreferences> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      if (Buffer.byteLength(contents, "utf8") > MAX_STORE_BYTES) return this.current;
      const decoded = decodePreferences(contents);
      if (decoded !== null) this.current = decoded;
    } catch {
      // Missing, inaccessible, or corrupt preference files keep safe defaults.
    }
    return this.current;
  }

  save(candidate: RuntimePreferences): Promise<RuntimePreferences | null> {
    const validated = validatePreferences(candidate);
    if (validated === null) return Promise.resolve(null);
    const pending = this.saveQueue.then(() => this.saveValidated(validated));
    this.saveQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async saveValidated(validated: RuntimePreferences): Promise<RuntimePreferences | null> {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, encodePreferences(validated), { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      this.current = validated;
      return this.current;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return null;
    }
  }
}

export function defaultPreferences(): RuntimePreferences {
  return Object.freeze({ onboardingCompleted: false, selectedTask: null, settings: defaultRuntimeSettings() });
}

export function encodePreferences(value: RuntimePreferences): string {
  const validated = validatePreferences(value);
  if (validated === null) throw new TypeError("Invalid runtime preferences.");
  return JSON.stringify({ version: STORE_VERSION, ...validated });
}

export function decodePreferences(contents: string): RuntimePreferences | null {
  if (typeof contents !== "string" || Buffer.byteLength(contents, "utf8") > MAX_STORE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(contents);
    if (hasExactKeys(parsed, ["selectedTask", "settings", "version"]) && parsed.version === 1) {
      return validatePreferences({ onboardingCompleted: false, selectedTask: parsed.selectedTask, settings: parsed.settings });
    }
    if (!hasExactKeys(parsed, ["onboardingCompleted", "selectedTask", "settings", "version"]) || parsed.version !== STORE_VERSION) return null;
    return validatePreferences({ onboardingCompleted: parsed.onboardingCompleted, selectedTask: parsed.selectedTask, settings: parsed.settings });
  } catch {
    return null;
  }
}

export function validatePreferences(value: unknown): RuntimePreferences | null {
  if (!hasExactKeys(value, ["onboardingCompleted", "selectedTask", "settings"]) || typeof value.onboardingCompleted !== "boolean") return null;
  const settings = validateRuntimeSettings(value.settings);
  if (settings === null) return null;
  const selectedTask = value.selectedTask === null ? null : validateSelectedTask(value.selectedTask);
  if (value.selectedTask !== null && selectedTask === null) return null;
  return Object.freeze({ onboardingCompleted: value.onboardingCompleted, selectedTask, settings });
}

function validateSelectedTask(value: unknown): SelectedTaskReference | null {
  if (!hasExactKeys(value, ["id", "projectId", "title"])) return null;
  const id = boundedText(value.id, MAX_TASK_ID_LENGTH);
  const title = boundedText(value.title, MAX_TASK_TITLE_LENGTH);
  const projectId = value.projectId === null ? null : boundedText(value.projectId, MAX_TASK_ID_LENGTH);
  if (id === null || title === null || (value.projectId !== null && projectId === null)) return null;
  return Object.freeze({ id, projectId, title });
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength && !normalized.includes("\0") ? normalized : null;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}
