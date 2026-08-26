const DEFAULT_MAXIMUM_OBSERVATION_GAP_MS = 1_000;
const MAXIMUM_OBSERVATION_GAP_MS = 60_000;
const MAX_ENTRIES = 10_000;
const MAX_IDENTIFIER_LENGTH = 160;
const MAX_TITLE_LENGTH = 512;
const MAX_DATE_MS = 8_640_000_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const PERSISTENCE_HEADROOM_BYTES = 4 * 1_024;

export const TASK_TIME_CSV_FORMAT = "UTF-8 BOM, RFC 4180 CRLF, Excel formula-safe text";
export const MAX_TASK_TIME_SNAPSHOT_BYTES = 8 * 1_024 * 1_024;

export interface TrackedTaskSnapshot {
  readonly id: string;
  readonly projectId: string | null;
  readonly projectTitle: string | null;
  readonly title: string;
}

export type TaskTimeObservation =
  | {
      readonly observedAtMs: number;
      readonly sessionId: string;
      readonly status: "running";
    }
  | {
      readonly observedAtMs: number;
      readonly status: "not-running";
    };

export interface TaskTimeEntry {
  readonly durationMs: number;
  readonly endedAtMs: number;
  readonly id: string;
  readonly startedAtMs: number;
  readonly task: TrackedTaskSnapshot;
}

export interface ActiveTaskTimeSegment {
  readonly durationMs: number;
  readonly id: string;
  readonly lastObservedAtMs: number;
  readonly startedAtMs: number;
  readonly task: TrackedTaskSnapshot;
}

export interface TaskTimeSnapshot {
  readonly active: ActiveTaskTimeSegment | null;
  readonly entries: readonly TaskTimeEntry[];
  readonly nextEntryNumber: number;
  readonly selectedTask: TrackedTaskSnapshot | null;
}

export interface TaskTimeTotals {
  readonly allMs: number;
  readonly todayMs: number;
  readonly weekMs: number;
}

export interface TaskTimeTaskTotals extends TaskTimeTotals {
  readonly task: TrackedTaskSnapshot;
}

export interface TaskTimeAggregate extends TaskTimeTotals {
  readonly tasks: readonly TaskTimeTaskTotals[];
}

export interface TaskTimeTrackerOptions {
  readonly maximumObservationGapMs?: number;
}

export class TaskTimeTracker {
  private active: ActiveTaskTimeSegment | null = null;
  private activeSessionId: string | null = null;
  private entries: TaskTimeEntry[] = [];
  private readonly maximumObservationGapMs: number;
  private nextEntryNumber = 1;
  private selectedTask: TrackedTaskSnapshot | null = null;

  constructor(snapshot: TaskTimeSnapshot = defaultTaskTimeSnapshot(), options: TaskTimeTrackerOptions = {}) {
    const validated = validateTaskTimeSnapshot(snapshot);
    if (validated === null) throw new TypeError("Invalid task time snapshot.");
    const gap = options.maximumObservationGapMs ?? DEFAULT_MAXIMUM_OBSERVATION_GAP_MS;
    if (!Number.isSafeInteger(gap) || gap <= 0 || gap > MAXIMUM_OBSERVATION_GAP_MS) {
      throw new TypeError("Invalid maximum observation gap.");
    }
    this.maximumObservationGapMs = gap;
    this.entries = [...validated.entries];
    this.nextEntryNumber = validated.nextEntryNumber;
    this.selectedTask = validated.selectedTask;

    // Recovery is intentionally lossy in only one direction: an active interval is
    // closed at its last persisted observation and never extended across downtime.
    if (validated.active !== null && validated.active.durationMs > 0) {
      this.appendClosedEntry(closeSegment(validated.active));
    }
    this.trimHistoryToPersistenceBound();
  }

  get value(): TaskTimeSnapshot {
    return freezeSnapshot({
      active: this.active,
      entries: this.entries,
      nextEntryNumber: this.nextEntryNumber,
      selectedTask: this.selectedTask
    });
  }

  get activeSegment(): ActiveTaskTimeSegment | null {
    return this.active === null ? null : freezeActive(this.active);
  }

  get entryCount(): number {
    return this.entries.length;
  }

  get currentSelection(): TrackedTaskSnapshot | null {
    return this.selectedTask === null ? null : Object.freeze({ ...this.selectedTask });
  }

  recentEntries(limit = 100, offset = 0): readonly TaskTimeEntry[] {
    if (
      !Number.isSafeInteger(limit) || limit < 0 || limit > MAX_ENTRIES ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ENTRIES
    ) {
      return Object.freeze([]);
    }
    const end = Math.max(0, this.entries.length - offset);
    const start = Math.max(0, end - limit);
    return Object.freeze(this.entries.slice(start, end).reverse().map(
      (entry) => Object.freeze({ ...entry, task: Object.freeze({ ...entry.task }) })
    ));
  }

  observe(candidate: TaskTimeObservation): boolean {
    const observation = validateObservation(candidate);
    if (observation === null) {
      this.closeActive();
      return false;
    }
    if (observation.status !== "running" || this.selectedTask === null) {
      this.closeActive();
      return true;
    }
    if (
      this.active === null ||
      this.activeSessionId !== observation.sessionId ||
      !sameTaskSnapshot(this.active.task, this.selectedTask)
    ) {
      this.closeActive();
      this.openActive(this.selectedTask, observation);
      return true;
    }

    const deltaMs = observation.observedAtMs - this.active.lastObservedAtMs;
    if (deltaMs < 0) {
      this.closeActive();
      return false;
    }
    if (deltaMs > this.maximumObservationGapMs) {
      this.closeActive();
      this.openActive(this.selectedTask, observation);
      return true;
    }
    if (deltaMs === 0) return true;
    this.active = freezeActive({
      ...this.active,
      durationMs: this.active.durationMs + deltaMs,
      lastObservedAtMs: observation.observedAtMs
    });
    return true;
  }

  selectTask(candidate: TrackedTaskSnapshot | null, observation: TaskTimeObservation | null = null): boolean {
    const task = candidate === null ? null : validateTrackedTask(candidate);
    if (candidate !== null && task === null) return false;
    const validatedObservation = observation === null ? null : validateObservation(observation);
    if (observation !== null && validatedObservation === null) return false;

    if (sameNullableTaskSnapshot(this.selectedTask, task)) {
      return validatedObservation === null ? true : this.observe(validatedObservation);
    }
    this.closeActive();
    this.selectedTask = task;
    if (task !== null && validatedObservation?.status === "running") {
      this.openActive(task, validatedObservation);
    }
    return true;
  }

  deleteEntry(entryId: string): boolean {
    if (!isEntryId(entryId)) return false;
    const index = this.entries.findIndex(({ id }) => id === entryId);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  closedEntry(entryId: string): TaskTimeEntry | null {
    if (!isEntryId(entryId)) return null;
    const entry = this.entries.find(({ id }) => id === entryId);
    return entry === undefined ? null : Object.freeze({ ...entry, task: Object.freeze({ ...entry.task }) });
  }

  restoreEntry(candidate: TaskTimeEntry): boolean {
    const entry = validateEntry(candidate);
    if (
      entry === null ||
      this.entries.some(({ id }) => id === entry.id) ||
      this.active?.id === entry.id ||
      entryNumber(entry.id) >= this.nextEntryNumber
    ) {
      return false;
    }
    this.appendClosedEntry(entry);
    return true;
  }

  aggregate(referenceMs: number, utcOffsetMinutes?: number): TaskTimeAggregate | null {
    if (
      !isTimestamp(referenceMs) ||
      (utcOffsetMinutes !== undefined &&
        (!Number.isSafeInteger(utcOffsetMinutes) || Math.abs(utcOffsetMinutes) > 14 * 60))
    ) {
      return null;
    }
    const intervals = this.measuredIntervals();
    const todayStartMs = utcOffsetMinutes === undefined
      ? systemLocalDayStart(referenceMs)
      : fixedOffsetDayStart(referenceMs, utcOffsetMinutes);
    const weekStartMs = utcOffsetMinutes === undefined
      ? systemLocalWeekStart(todayStartMs)
      : fixedOffsetWeekStart(todayStartMs, utcOffsetMinutes);
    const overall = totalsForIntervals(intervals, todayStartMs, weekStartMs, referenceMs);
    const byTask = new Map<string, { intervals: MeasuredInterval[]; task: TrackedTaskSnapshot; lastAtMs: number }>();
    for (const interval of intervals) {
      const current = byTask.get(interval.task.id);
      if (current === undefined) {
        byTask.set(interval.task.id, { intervals: [interval], task: interval.task, lastAtMs: interval.endedAtMs });
      } else {
        current.intervals.push(interval);
        if (interval.endedAtMs > current.lastAtMs) {
          current.task = interval.task;
          current.lastAtMs = interval.endedAtMs;
        }
      }
    }
    const tasks = [...byTask.values()]
      .map(({ intervals: taskIntervals, task }) => Object.freeze({
        task,
        ...totalsForIntervals(taskIntervals, todayStartMs, weekStartMs, referenceMs)
      }))
      .sort((left, right) => left.task.id.localeCompare(right.task.id));
    return Object.freeze({ ...overall, tasks: Object.freeze(tasks) });
  }

  exportCsv(): string {
    const header = [
      "entry_id", "status", "date", "task_id", "task_title", "project_id", "project_title",
      "started_at_utc", "ended_at_utc", "duration_ms", "duration_seconds", "duration_hours"
    ];
    const rows = this.measuredIntervals().map((interval) => {
      const durationMs = interval.endedAtMs - interval.startedAtMs;
      const startedAtUtc = new Date(interval.startedAtMs).toISOString();
      return [
        csvCell(interval.id),
        csvCell(interval.status),
        csvCell(startedAtUtc.slice(0, 10)),
        csvCell(interval.task.id),
        csvCell(interval.task.title),
        csvCell(interval.task.projectId ?? ""),
        csvCell(interval.task.projectTitle ?? ""),
        csvCell(startedAtUtc),
        csvCell(new Date(interval.endedAtMs).toISOString()),
        String(durationMs),
        (durationMs / 1_000).toFixed(3),
        (durationMs / (60 * 60 * 1_000)).toFixed(6)
      ];
    });
    return `\uFEFF${[header.map(csvCell), ...rows].map((row) => row.join(",")).join("\r\n")}\r\n`;
  }

  private closeActive(): void {
    if (this.active !== null && this.active.durationMs > 0) {
      this.appendClosedEntry(closeSegment(this.active));
    }
    this.active = null;
    this.activeSessionId = null;
  }

  private appendClosedEntry(entry: TaskTimeEntry): void {
    this.entries.push(entry);
    this.entries.sort(compareEntries);
    // The ledger retains the newest 10,000 closed intervals. This deterministic
    // eviction keeps every snapshot within the strict persistence bound.
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.trimHistoryToPersistenceBound();
  }

  private measuredIntervals(): MeasuredInterval[] {
    const intervals: MeasuredInterval[] = this.entries.map((entry) => ({ ...entry, status: "closed" as const }));
    if (this.active !== null && this.active.durationMs > 0) {
      intervals.push({
        ...this.active,
        endedAtMs: this.active.lastObservedAtMs,
        status: "active"
      });
    }
    return intervals.sort(compareEntries);
  }

  private openActive(task: TrackedTaskSnapshot, observation: Extract<TaskTimeObservation, { status: "running" }>): void {
    this.active = freezeActive({
      durationMs: 0,
      id: entryId(this.nextEntryNumber),
      lastObservedAtMs: observation.observedAtMs,
      startedAtMs: observation.observedAtMs,
      task
    });
    this.activeSessionId = observation.sessionId;
    this.nextEntryNumber += 1;
    this.trimHistoryToPersistenceBound();
  }

  private trimHistoryToPersistenceBound(): void {
    // Leave headroom for the version envelope and for bounded timestamp/duration
    // digit growth between observations. Retention only runs on open/close/recovery,
    // never on the high-frequency observation path.
    const maximumBytes = MAX_TASK_TIME_SNAPSHOT_BYTES - PERSISTENCE_HEADROOM_BYTES;
    if (this.entries.length === 0 || snapshotByteLength({
      active: this.active,
      entries: this.entries,
      nextEntryNumber: this.nextEntryNumber,
      selectedTask: this.selectedTask
    }) <= maximumBytes) return;

    let lowerBound = 1;
    let upperBound = this.entries.length;
    while (lowerBound < upperBound) {
      const removedCount = Math.floor((lowerBound + upperBound) / 2);
      const fits = snapshotByteLength({
        active: this.active,
        entries: this.entries.slice(removedCount),
        nextEntryNumber: this.nextEntryNumber,
        selectedTask: this.selectedTask
      }) <= maximumBytes;
      if (fits) upperBound = removedCount;
      else lowerBound = removedCount + 1;
    }
    this.entries.splice(0, lowerBound);
  }
}

interface MeasuredInterval extends Omit<TaskTimeEntry, "durationMs"> {
  readonly status: "active" | "closed";
}

export function defaultTaskTimeSnapshot(): TaskTimeSnapshot {
  return Object.freeze({ active: null, entries: Object.freeze([]), nextEntryNumber: 1, selectedTask: null });
}

export function validateTaskTimeSnapshot(candidate: unknown): TaskTimeSnapshot | null {
  if (!hasExactKeys(candidate, ["active", "entries", "nextEntryNumber", "selectedTask"])) return null;
  if (!Array.isArray(candidate.entries) || candidate.entries.length > MAX_ENTRIES) return null;
  if (!Number.isSafeInteger(candidate.nextEntryNumber) || (candidate.nextEntryNumber as number) < 1) return null;
  const selectedTask = candidate.selectedTask === null ? null : validateTrackedTask(candidate.selectedTask);
  if (candidate.selectedTask !== null && selectedTask === null) return null;
  const entries: TaskTimeEntry[] = [];
  const ids = new Set<string>();
  let maximumEntryNumber = 0;
  for (const raw of candidate.entries) {
    const entry = validateEntry(raw);
    if (entry === null || ids.has(entry.id)) return null;
    ids.add(entry.id);
    maximumEntryNumber = Math.max(maximumEntryNumber, entryNumber(entry.id));
    entries.push(entry);
  }
  const active = candidate.active === null ? null : validateActive(candidate.active);
  if (candidate.active !== null && active === null) return null;
  if (active !== null) {
    if (ids.has(active.id) || selectedTask === null || !sameTaskSnapshot(active.task, selectedTask)) return null;
    maximumEntryNumber = Math.max(maximumEntryNumber, entryNumber(active.id));
  }
  if ((candidate.nextEntryNumber as number) <= maximumEntryNumber) return null;
  entries.sort(compareEntries);
  return freezeSnapshot({
    active,
    entries,
    nextEntryNumber: candidate.nextEntryNumber as number,
    selectedTask
  });
}

export function validateTrackedTask(candidate: unknown): TrackedTaskSnapshot | null {
  if (!hasExactKeys(candidate, ["id", "projectId", "projectTitle", "title"])) return null;
  const id = boundedText(candidate.id, MAX_IDENTIFIER_LENGTH);
  const title = boundedText(candidate.title, MAX_TITLE_LENGTH);
  const projectId = candidate.projectId === null ? null : boundedText(candidate.projectId, MAX_IDENTIFIER_LENGTH);
  const projectTitle = candidate.projectTitle === null ? null : boundedText(candidate.projectTitle, MAX_TITLE_LENGTH);
  if (
    id === null || title === null ||
    (candidate.projectId !== null && projectId === null) ||
    (candidate.projectTitle !== null && projectTitle === null)
  ) {
    return null;
  }
  return Object.freeze({ id, projectId, projectTitle, title });
}

function validateObservation(candidate: unknown): TaskTimeObservation | null {
  if (!hasExactKeys(candidate, candidate !== null && typeof candidate === "object" && "status" in candidate && candidate.status === "running"
    ? ["observedAtMs", "sessionId", "status"]
    : ["observedAtMs", "status"])) return null;
  if (!isTimestamp(candidate.observedAtMs)) return null;
  if (candidate.status === "not-running") {
    return Object.freeze({ observedAtMs: candidate.observedAtMs, status: "not-running" });
  }
  if (candidate.status !== "running") return null;
  const sessionId = boundedText(candidate.sessionId, MAX_IDENTIFIER_LENGTH);
  return sessionId === null ? null : Object.freeze({ observedAtMs: candidate.observedAtMs, sessionId, status: "running" });
}

function validateEntry(candidate: unknown): TaskTimeEntry | null {
  if (!hasExactKeys(candidate, ["durationMs", "endedAtMs", "id", "startedAtMs", "task"])) return null;
  const common = validateSegmentCommon(candidate);
  if (common === null || !isTimestamp(candidate.endedAtMs) || candidate.endedAtMs <= common.startedAtMs) return null;
  const durationMs = candidate.endedAtMs - common.startedAtMs;
  if (candidate.durationMs !== durationMs) return null;
  return Object.freeze({ ...common, durationMs, endedAtMs: candidate.endedAtMs });
}

function validateActive(candidate: unknown): ActiveTaskTimeSegment | null {
  if (!hasExactKeys(candidate, ["durationMs", "id", "lastObservedAtMs", "startedAtMs", "task"])) return null;
  const common = validateSegmentCommon(candidate);
  if (common === null || !isTimestamp(candidate.lastObservedAtMs) || candidate.lastObservedAtMs < common.startedAtMs) return null;
  const durationMs = candidate.lastObservedAtMs - common.startedAtMs;
  if (candidate.durationMs !== durationMs) return null;
  return Object.freeze({ ...common, durationMs, lastObservedAtMs: candidate.lastObservedAtMs });
}

function validateSegmentCommon(candidate: Record<string, unknown>): {
  readonly id: string;
  readonly startedAtMs: number;
  readonly task: TrackedTaskSnapshot;
} | null {
  if (!isEntryId(candidate.id) || !isTimestamp(candidate.startedAtMs)) return null;
  const task = validateTrackedTask(candidate.task);
  return task === null ? null : Object.freeze({
    id: candidate.id,
    startedAtMs: candidate.startedAtMs,
    task
  });
}

function closeSegment(active: ActiveTaskTimeSegment): TaskTimeEntry {
  return Object.freeze({
    durationMs: active.durationMs,
    endedAtMs: active.lastObservedAtMs,
    id: active.id,
    startedAtMs: active.startedAtMs,
    task: active.task
  });
}

function freezeActive(active: ActiveTaskTimeSegment): ActiveTaskTimeSegment {
  return Object.freeze({ ...active, task: Object.freeze({ ...active.task }) });
}

function freezeSnapshot(snapshot: TaskTimeSnapshot): TaskTimeSnapshot {
  return Object.freeze({
    active: snapshot.active === null ? null : freezeActive(snapshot.active),
    entries: Object.freeze(snapshot.entries.map((entry) => Object.freeze({ ...entry, task: Object.freeze({ ...entry.task }) }))),
    nextEntryNumber: snapshot.nextEntryNumber,
    selectedTask: snapshot.selectedTask === null ? null : Object.freeze({ ...snapshot.selectedTask })
  });
}

function totalsForIntervals(
  intervals: readonly MeasuredInterval[],
  todayStartMs: number,
  weekStartMs: number,
  referenceMs: number
): TaskTimeTotals {
  let allMs = 0;
  let todayMs = 0;
  let weekMs = 0;
  for (const interval of intervals) {
    const durationMs = interval.endedAtMs - interval.startedAtMs;
    allMs += durationMs;
    todayMs += overlapMs(interval.startedAtMs, interval.endedAtMs, todayStartMs, referenceMs);
    weekMs += overlapMs(interval.startedAtMs, interval.endedAtMs, weekStartMs, referenceMs);
  }
  return Object.freeze({ allMs, todayMs, weekMs });
}

function fixedOffsetDayStart(referenceMs: number, utcOffsetMinutes: number): number {
  const offsetMs = utcOffsetMinutes * 60 * 1_000;
  return Math.floor((referenceMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
}

function fixedOffsetWeekStart(todayStartMs: number, utcOffsetMinutes: number): number {
  const offsetMs = utcOffsetMinutes * 60 * 1_000;
  const localDayNumber = Math.floor((todayStartMs + offsetMs) / DAY_MS);
  const dayOfWeekSundayZero = ((localDayNumber + 4) % 7 + 7) % 7;
  const daysSinceMonday = (dayOfWeekSundayZero + 6) % 7;
  return todayStartMs - daysSinceMonday * DAY_MS;
}

function systemLocalDayStart(referenceMs: number): number {
  const local = new Date(referenceMs);
  local.setHours(0, 0, 0, 0);
  return local.getTime();
}

function systemLocalWeekStart(todayStartMs: number): number {
  const local = new Date(todayStartMs);
  const daysSinceMonday = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - daysSinceMonday);
  return local.getTime();
}

function overlapMs(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number): number {
  return Math.max(0, Math.min(endMs, rangeEndMs) - Math.max(startMs, rangeStartMs));
}

function csvCell(value: string): string {
  const safe = /^[\t\r\n ]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function compareEntries(left: Pick<TaskTimeEntry, "id" | "startedAtMs">, right: Pick<TaskTimeEntry, "id" | "startedAtMs">): number {
  return left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id);
}

function sameNullableTaskSnapshot(left: TrackedTaskSnapshot | null, right: TrackedTaskSnapshot | null): boolean {
  return left === null || right === null ? left === right : sameTaskSnapshot(left, right);
}

function sameTaskSnapshot(left: TrackedTaskSnapshot, right: TrackedTaskSnapshot): boolean {
  return left.id === right.id && left.title === right.title && left.projectId === right.projectId && left.projectTitle === right.projectTitle;
}

function entryId(value: number): string {
  return `local-${String(value).padStart(8, "0")}`;
}

function entryNumber(value: string): number {
  return Number(value.slice("local-".length));
}

function isEntryId(value: unknown): value is string {
  return typeof value === "string" && /^local-[0-9]{8,12}$/u.test(value) && Number.isSafeInteger(entryNumber(value));
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE_MS;
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength && !normalized.includes("\0") ? normalized : null;
}

function hasExactKeys(candidate: unknown, expected: readonly string[]): candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function snapshotByteLength(snapshot: TaskTimeSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}
