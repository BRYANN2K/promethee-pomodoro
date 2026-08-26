import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

const MAX_TASKS = 500;
const MAX_PROJECTS = 128;
const MAX_ID_LENGTH = 160;
const MAX_TASK_TITLE_LENGTH = 512;
const MAX_PROJECT_TITLE_LENGTH = 256;
const MAX_SYNC_STATE_LENGTH = 64;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1_000;

const TASKS_SQL = `
  SELECT
    id,
    text,
    completed,
    position,
    project_id,
    updated_at,
    scheduled_date,
    parent_id,
    recurrence,
    bonus_target_seconds,
    bonus_accepted,
    sync_state
  FROM tasks
  WHERE COALESCE(deleted, 0) = 0
  ORDER BY completed ASC, position ASC, created_at ASC, id ASC
  LIMIT ${MAX_TASKS + 1}
`;

const PROJECTS_SQL = `
  SELECT id, name, position, updated_at, sync_state
  FROM task_projects
  WHERE COALESCE(deleted, 0) = 0
  ORDER BY position ASC, created_at ASC, id ASC
  LIMIT ${MAX_PROJECTS + 1}
`;

const ACTIVE_SESSION_SQL = `
  SELECT
    id,
    started_at,
    ended_at,
    duration_seconds,
    total_pause_ms,
    pause_started_at,
    parked_at,
    deleted
  FROM sessions
  WHERE ended_at IS NULL
    AND COALESCE(deleted, 0) = 0
  ORDER BY started_at DESC, id ASC
  LIMIT 2
`;

export interface PrometheeLocalProject {
  readonly id: string;
  readonly title: string;
  readonly position: number;
  readonly updatedAtMs: number | null;
  readonly syncState: string;
}

export interface PrometheeLocalTask {
  readonly id: string;
  readonly title: string;
  readonly status: "open" | "completed";
  readonly position: number;
  readonly projectId: string | null;
  readonly updatedAtMs: number | null;
  readonly scheduledDate: string | null;
  readonly parentId: string | null;
  readonly recurrence: string | null;
  readonly bonusTargetSeconds: number | null;
  readonly bonusAccepted: boolean;
  readonly syncState: string;
}

export type PrometheeTaskSnapshotResult =
  | {
      readonly status: "ready";
      readonly observedAtMs: number;
      readonly projects: readonly PrometheeLocalProject[];
      readonly tasks: readonly PrometheeLocalTask[];
    }
  | { readonly status: "closed" | "incompatible" | "read-error" };

export type PrometheeSessionObservation =
  | { readonly status: "idle"; readonly observedAtMs: number }
  | {
      readonly status: "observed";
      readonly observedAtMs: number;
      readonly sessionId: string;
      readonly state: "running" | "paused";
      readonly startedAtMs: number;
      readonly elapsedWorkMs: number;
      readonly totalPauseMs: number;
      readonly pauseStartedAtMs: number | null;
    }
  | {
      readonly status: "unknown";
      readonly observedAtMs: number;
      readonly reason:
        | "closed"
        | "multiple-active-sessions"
        | "parked-session"
        | "invalid-session"
        | "incompatible-schema"
        | "read-error";
    };

export type PrometheeSqliteOpenResult =
  | { readonly status: "ready"; readonly reader: PrometheeSqliteReader }
  | { readonly status: "not-found" | "unsafe-path" | "unsupported-platform" | "open-error" };

export function resolvePrometheeDatabasePath(
  platform: NodeJS.Platform,
  applicationDataDirectory: string
): string | null {
  if (platform !== "darwin" && platform !== "win32") return null;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (!platformPath.isAbsolute(applicationDataDirectory)) return null;
  return platformPath.join(applicationDataDirectory, "Promethee", "promethee.db");
}

export function openPrometheeSqlite(
  platform: NodeJS.Platform,
  applicationDataDirectory: string
): PrometheeSqliteOpenResult {
  const databasePath = resolvePrometheeDatabasePath(platform, applicationDataDirectory);
  if (databasePath === null) return Object.freeze({ status: "unsupported-platform" });
  const expectedDirectory = path.dirname(databasePath);
  if (!isSafeDatabasePath(databasePath, expectedDirectory)) {
    return Object.freeze({ status: lstatExists(databasePath) ? "unsafe-path" : "not-found" });
  }

  try {
    const identity = lstatSync(databasePath);
    const database = new DatabaseSync(databasePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: false,
      open: true,
      readOnly: true
    });
    try {
      database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 150;");
      return Object.freeze({
        status: "ready",
        reader: new PrometheeSqliteReader(database, createIdentityGuard(databasePath, identity))
      });
    } catch {
      database.close();
      return Object.freeze({ status: "open-error" });
    }
  } catch {
    return Object.freeze({ status: "open-error" });
  }
}

export class PrometheeSqliteReader {
  private closed = false;
  private readonly database: DatabaseSync;
  private readonly identityGuard: () => boolean;
  private readonly taskStatement: StatementSync;
  private readonly projectStatement: StatementSync;
  private readonly activeSessionStatement: StatementSync;

  constructor(database: DatabaseSync, identityGuard: () => boolean = () => true) {
    this.database = database;
    this.identityGuard = identityGuard;
    this.taskStatement = database.prepare(TASKS_SQL);
    this.projectStatement = database.prepare(PROJECTS_SQL);
    this.activeSessionStatement = database.prepare(ACTIVE_SESSION_SQL);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  readTasks(observedAtMs = Date.now()): PrometheeTaskSnapshotResult {
    if (this.closed) return Object.freeze({ status: "closed" });
    try {
      this.database.exec("BEGIN");
      const rawProjects = this.projectStatement.all();
      const rawTasks = this.taskStatement.all();
      this.database.exec("COMMIT");

      const projects: PrometheeLocalProject[] = [];
      if (rawProjects.length > MAX_PROJECTS || rawTasks.length > MAX_TASKS || !this.identityGuard()) {
        return Object.freeze({ status: "incompatible" });
      }
      for (const raw of rawProjects.slice(0, MAX_PROJECTS)) {
        const project = parseProject(raw);
        if (project === null) return Object.freeze({ status: "incompatible" });
        projects.push(project);
      }
      const tasks: PrometheeLocalTask[] = [];
      for (const raw of rawTasks.slice(0, MAX_TASKS)) {
        const task = parseTask(raw);
        if (task === null) return Object.freeze({ status: "incompatible" });
        tasks.push(task);
      }

      return Object.freeze({
        status: "ready",
        observedAtMs: normalizeObservedAt(observedAtMs),
        projects: Object.freeze(projects),
        tasks: Object.freeze(tasks)
      });
    } catch (error) {
      rollbackQuietly(this.database);
      return Object.freeze({ status: isSchemaError(error) ? "incompatible" : "read-error" });
    }
  }

  readSession(observedAtMs = Date.now()): PrometheeSessionObservation {
    const nowMs = normalizeObservedAt(observedAtMs);
    if (this.closed) return unknownSession(nowMs, "closed");
    try {
      if (!this.identityGuard()) return unknownSession(nowMs, "incompatible-schema");
      const rows = this.activeSessionStatement.all();
      if (!this.identityGuard()) return unknownSession(nowMs, "incompatible-schema");
      if (rows.length === 0) return Object.freeze({ status: "idle", observedAtMs: nowMs });
      if (rows.length !== 1) return unknownSession(nowMs, "multiple-active-sessions");

      const row = rows[0];
      if (!isRecord(row)) return unknownSession(nowMs, "invalid-session");

      const sessionId = boundedText(row.id, MAX_ID_LENGTH);
      const startedAtMs = nonNegativeInteger(row.started_at);
      const totalPauseMs = nonNegativeInteger(row.total_pause_ms);
      const pauseStartedAtMs = nullableNonNegativeInteger(row.pause_started_at);
      const parkedAtMs = nullableNonNegativeInteger(row.parked_at);
      if (
        sessionId === null || startedAtMs === null || totalPauseMs === null ||
        pauseStartedAtMs === undefined || parkedAtMs === undefined || row.ended_at !== null || row.deleted !== 0 ||
        row.duration_seconds !== null || startedAtMs > nowMs + FUTURE_CLOCK_TOLERANCE_MS ||
        (pauseStartedAtMs !== null && (
          pauseStartedAtMs < startedAtMs || pauseStartedAtMs > nowMs + FUTURE_CLOCK_TOLERANCE_MS
        ))
      ) {
        return unknownSession(nowMs, "invalid-session");
      }
      if (parkedAtMs !== null) return unknownSession(nowMs, "parked-session");

      const effectiveNowMs = pauseStartedAtMs ?? nowMs;
      const totalSpanMs = effectiveNowMs - startedAtMs;
      if (totalPauseMs > totalSpanMs) return unknownSession(nowMs, "invalid-session");
      const elapsedWorkMs = totalSpanMs - totalPauseMs;
      const state = pauseStartedAtMs === null ? "running" : "paused";
      return Object.freeze({
        status: "observed",
        observedAtMs: nowMs,
        sessionId,
        state,
        startedAtMs,
        elapsedWorkMs,
        totalPauseMs,
        pauseStartedAtMs,
      });
    } catch (error) {
      return unknownSession(nowMs, isSchemaError(error) ? "incompatible-schema" : "read-error");
    }
  }
}

function parseProject(value: unknown): PrometheeLocalProject | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, MAX_ID_LENGTH);
  const title = boundedText(value.name, MAX_PROJECT_TITLE_LENGTH);
  const position = safeInteger(value.position);
  const updatedAtMs = nullableNonNegativeInteger(value.updated_at);
  const syncState = boundedText(value.sync_state, MAX_SYNC_STATE_LENGTH);
  if (id === null || title === null || position === null || updatedAtMs === undefined || syncState === null) return null;
  return Object.freeze({ id, title, position, updatedAtMs, syncState });
}

function parseTask(value: unknown): PrometheeLocalTask | null {
  if (!isRecord(value)) return null;
  const id = boundedText(value.id, MAX_ID_LENGTH);
  const title = boundedText(value.text, MAX_TASK_TITLE_LENGTH);
  const completed = booleanInteger(value.completed);
  const position = safeInteger(value.position);
  const projectId = nullableBoundedText(value.project_id, MAX_ID_LENGTH);
  const updatedAtMs = nullableNonNegativeInteger(value.updated_at);
  const scheduledDate = nullableBoundedText(value.scheduled_date, 32);
  const parentId = nullableBoundedText(value.parent_id, MAX_ID_LENGTH);
  const recurrence = nullableBoundedText(value.recurrence, 128);
  const bonusTargetSeconds = nullableNonNegativeInteger(value.bonus_target_seconds);
  const bonusAccepted = booleanInteger(value.bonus_accepted);
  const syncState = boundedText(value.sync_state, MAX_SYNC_STATE_LENGTH);
  if (
    id === null || title === null || completed === null || position === null || projectId === undefined ||
    updatedAtMs === undefined || scheduledDate === undefined || parentId === undefined || recurrence === undefined ||
    bonusTargetSeconds === undefined || bonusAccepted === null || syncState === null
  ) return null;
  return Object.freeze({
    id,
    title,
    status: completed ? "completed" : "open",
    position,
    projectId,
    updatedAtMs,
    scheduledDate,
    parentId,
    recurrence,
    bonusTargetSeconds,
    bonusAccepted,
    syncState
  });
}

function isSafeDatabasePath(databasePath: string, expectedDirectory: string): boolean {
  if (!path.isAbsolute(databasePath) || !path.isAbsolute(expectedDirectory)) return false;
  try {
    const databaseStat = lstatSync(databasePath);
    const directoryStat = lstatSync(expectedDirectory);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink() || !directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return false;
    }
    const expectedRealDirectory = realpathSync(expectedDirectory);
    const databaseRealPath = realpathSync(databasePath);
    return path.dirname(databaseRealPath) === expectedRealDirectory && path.basename(databaseRealPath) === "promethee.db";
  } catch {
    return false;
  }
}

function createIdentityGuard(databasePath: string, expected: Stats): () => boolean {
  const expectedRealPath = realpathSync(databasePath);
  return () => {
    try {
      const current = lstatSync(databasePath);
      return !current.isSymbolicLink() && current.isFile() && realpathSync(databasePath) === expectedRealPath &&
        current.dev === expected.dev && current.ino === expected.ino;
    } catch {
      return false;
    }
  };
}

function lstatExists(targetPath: string): boolean {
  try { lstatSync(targetPath); return true; } catch { return false; }
}

function rollbackQuietly(database: DatabaseSync): void {
  try { if (database.isTransaction) database.exec("ROLLBACK"); } catch { /* fail closed */ }
}

function isSchemaError(error: unknown): boolean {
  return error instanceof Error && /no such (?:table|column)|has no column/i.test(error.message);
}

function unknownSession(
  observedAtMs: number,
  reason: Extract<PrometheeSessionObservation, { status: "unknown" }>["reason"]
): PrometheeSessionObservation {
  return Object.freeze({ status: "unknown", observedAtMs, reason });
}

function normalizeObservedAt(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

function nullableBoundedText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  return boundedText(value, maximumLength) ?? undefined;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = safeInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function nullableNonNegativeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return nonNegativeInteger(value) ?? undefined;
}

function booleanInteger(value: unknown): boolean | null {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}
