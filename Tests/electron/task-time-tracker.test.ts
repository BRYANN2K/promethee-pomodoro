import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_TIME_CSV_FORMAT,
  MAX_TASK_TIME_SNAPSHOT_BYTES,
  TaskTimeTracker,
  defaultTaskTimeSnapshot,
  validateTaskTimeSnapshot,
  validateTrackedTask,
  type TaskTimeObservation,
  type TaskTimeSnapshot,
  type TrackedTaskSnapshot
} from "../../src/electron/task-time-tracker.ts";

const TASK_A: TrackedTaskSnapshot = Object.freeze({
  id: "task-a",
  projectId: "project-1",
  projectTitle: "Client Alpha",
  title: "Prepare release"
});
const TASK_B: TrackedTaskSnapshot = Object.freeze({
  id: "task-b",
  projectId: null,
  projectTitle: null,
  title: "Write retrospective"
});

function running(observedAtMs: number, sessionId = "session-1"): TaskTimeObservation {
  return Object.freeze({ observedAtMs, sessionId, status: "running" });
}

function stopped(observedAtMs: number): TaskTimeObservation {
  return Object.freeze({ observedAtMs, status: "not-running" });
}

test("counts only bounded intervals between running observations", () => {
  const tracker = new TaskTimeTracker(defaultTaskTimeSnapshot(), { maximumObservationGapMs: 1_000 });
  assert.equal(tracker.selectTask(TASK_A, running(1_000)), true);
  assert.equal(tracker.observe(running(1_100)), true);
  assert.equal(tracker.observe(stopped(1_200)), true);
  assert.deepEqual(tracker.value.entries.map(({ durationMs, endedAtMs, startedAtMs }) => ({
    durationMs,
    endedAtMs,
    startedAtMs
  })), [{ durationMs: 100, endedAtMs: 1_100, startedAtMs: 1_000 }]);

  assert.equal(tracker.observe(running(2_000)), true);
  assert.equal(tracker.observe(running(2_200)), true);
  assert.equal(tracker.observe(running(5_000)), true);
  assert.equal(tracker.value.entries.at(-1)?.durationMs, 200);
  assert.equal(tracker.value.active?.durationMs, 0);
  assert.equal(tracker.value.active?.startedAtMs, 5_000);
  assert.equal(tracker.aggregate(5_000)?.allMs, 300);
});

test("closes the old task and opens the new task while Promethee remains running", () => {
  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK_A, running(10_000));
  tracker.observe(running(10_100));
  tracker.selectTask(TASK_B, running(10_100));
  tracker.observe(running(10_250));
  tracker.observe(stopped(10_300));

  assert.deepEqual(tracker.value.entries.map(({ durationMs, task }) => [task.id, task.title, task.projectTitle, durationMs]), [
    ["task-a", "Prepare release", "Client Alpha", 100],
    ["task-b", "Write retrospective", null, 150]
  ]);
  assert.equal(tracker.value.selectedTask?.id, "task-b");
  assert.equal(tracker.value.active, null);
});

test("retains a disappeared task snapshot until an explicit replacement or no-task selection", () => {
  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK_A, running(1_000));
  tracker.observe(running(1_100));

  // Task-list refreshes are deliberately not an input to this engine. The stable
  // snapshot therefore survives an upstream disappearance.
  tracker.observe(running(1_200));
  assert.deepEqual(tracker.value.selectedTask, TASK_A);
  assert.equal(tracker.value.active?.durationMs, 200);

  assert.equal(tracker.selectTask(null, running(1_200)), true);
  assert.equal(tracker.value.selectedTask, null);
  assert.equal(tracker.value.active, null);
  assert.equal(tracker.value.entries[0]?.durationMs, 200);
});

test("does not count across a Promethee session replacement", () => {
  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK_A, running(1_000, "session-a"));
  tracker.observe(running(1_100, "session-a"));
  tracker.observe(running(1_150, "session-b"));
  assert.equal(tracker.value.entries[0]?.durationMs, 100);
  assert.equal(tracker.value.active?.startedAtMs, 1_150);
  assert.equal(tracker.value.active?.durationMs, 0);
});

test("recovery closes at lastObservedAtMs and never counts the restart gap", () => {
  const beforeCrash = new TaskTimeTracker();
  beforeCrash.selectTask(TASK_A, running(1_000));
  beforeCrash.observe(running(1_200));

  const restored = new TaskTimeTracker(beforeCrash.value);
  assert.equal(restored.value.active, null);
  assert.equal(restored.value.entries[0]?.durationMs, 200);
  restored.observe(running(100_000));
  assert.equal(restored.value.active?.durationMs, 0);
  restored.observe(running(100_100));
  assert.equal(restored.aggregate(100_100)?.allMs, 300);
});

test("deletes only closed local history by entry id", () => {
  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK_A, running(1_000));
  tracker.observe(running(1_100));
  tracker.observe(stopped(1_200));
  const closedId = tracker.value.entries[0]?.id;
  assert.ok(closedId);
  tracker.observe(running(1_300));
  const activeId = tracker.value.active?.id;
  assert.ok(activeId);

  assert.equal(tracker.deleteEntry(activeId), false);
  assert.equal(tracker.deleteEntry("local-99999999"), false);
  const deleted = tracker.closedEntry(closedId);
  assert.ok(deleted);
  assert.equal(tracker.deleteEntry(closedId), true);
  assert.equal(tracker.value.entries.length, 0);
  assert.equal(tracker.restoreEntry(deleted), true);
  assert.equal(tracker.value.entries[0]?.id, closedId);
  assert.deepEqual(tracker.value.selectedTask, TASK_A);
});

test("paginates newest history without overlap", () => {
  const snapshot: TaskTimeSnapshot = {
    active: null,
    entries: Array.from({ length: 205 }, (_, index) => entry(index + 1, TASK_A, index * 2, 1)),
    nextEntryNumber: 206,
    selectedTask: TASK_A
  };
  const tracker = new TaskTimeTracker(snapshot);
  assert.equal(tracker.recentEntries(100, 0)[0]?.id, "local-00000205");
  assert.equal(tracker.recentEntries(100, 100)[0]?.id, "local-00000105");
  assert.deepEqual(tracker.recentEntries(100, 200).map(({ id }) => id), [
    "local-00000005", "local-00000004", "local-00000003", "local-00000002", "local-00000001"
  ]);
});

test("computes deterministic today, ISO-week, all, and per-task totals", () => {
  const hour = 60 * 60 * 1_000;
  const monday = Date.UTC(2026, 7, 24);
  const reference = Date.UTC(2026, 7, 26, 12);
  const snapshot: TaskTimeSnapshot = {
    active: null,
    entries: [
      entry(1, TASK_A, monday + hour, hour),
      entry(2, TASK_B, monday + 24 * hour + hour, 2 * hour),
      entry(3, TASK_A, monday + 2 * 24 * hour + hour, 3 * hour),
      entry(4, TASK_B, monday - 7 * 24 * hour + hour, 4 * hour)
    ],
    nextEntryNumber: 5,
    selectedTask: TASK_A
  };
  const aggregate = new TaskTimeTracker(snapshot).aggregate(reference, 0);
  assert.deepEqual(aggregate && { allMs: aggregate.allMs, todayMs: aggregate.todayMs, weekMs: aggregate.weekMs }, {
    allMs: 10 * hour,
    todayMs: 3 * hour,
    weekMs: 6 * hour
  });
  assert.deepEqual(aggregate?.tasks.map(({ allMs, task, todayMs, weekMs }) => ({
    allMs,
    id: task.id,
    todayMs,
    weekMs
  })), [
    { allMs: 4 * hour, id: "task-a", todayMs: 3 * hour, weekMs: 4 * hour },
    { allMs: 6 * hour, id: "task-b", todayMs: 0, weekMs: 2 * hour }
  ]);
});

test("uses DST-aware local day boundaries when no fixed offset is requested", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "Europe/Brussels";
  try {
    const startedAtMs = Date.UTC(2026, 9, 24, 22, 30);
    const durationMs = 15 * 60_000;
    const tracker = new TaskTimeTracker({
      active: null,
      entries: [entry(1, TASK_A, startedAtMs, durationMs)],
      nextEntryNumber: 2,
      selectedTask: TASK_A
    });
    assert.equal(tracker.aggregate(Date.UTC(2026, 9, 25, 12))?.todayMs, durationMs);
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test("exports a deterministic UTF-8 BOM CSV with Excel formula protection", () => {
  const formulaTask: TrackedTaskSnapshot = {
    id: "task-csv",
    projectId: "project-csv",
    projectTitle: "@Client, Inc.",
    title: "=SUM(1,2)\n\"quoted\""
  };
  const tracker = new TaskTimeTracker();
  tracker.selectTask(formulaTask, running(1_000, "session-csv"));
  tracker.observe(running(1_125, "session-csv"));
  const csv = tracker.exportCsv();

  assert.equal(TASK_TIME_CSV_FORMAT, "UTF-8 BOM, RFC 4180 CRLF, Excel formula-safe text");
  assert.equal(csv, tracker.exportCsv());
  assert.equal(csv.startsWith("\uFEFF\"entry_id\",\"status\""), true);
  assert.equal(csv.endsWith("\r\n"), true);
  assert.doesNotMatch(csv, /session-csv|promethee_session_id/u);
  assert.match(csv, /"'=SUM\(1,2\)\n""quoted"""/u);
  assert.match(csv, /"'@Client, Inc\."/u);
  assert.match(csv, /"active"/u);
  assert.match(csv, /,125,0\.125,0\.000035\r\n$/u);
});

test("caps closed history by evicting the oldest interval deterministically", () => {
  const entries = Array.from({ length: 10_000 }, (_, index) => entry(index + 1, TASK_A, index * 2, 1));
  const tracker = new TaskTimeTracker({
    active: {
      durationMs: 1,
      id: "local-00010001",
      lastObservedAtMs: 20_001,
      startedAtMs: 20_000,
      task: TASK_A
    },
    entries,
    nextEntryNumber: 10_002,
    selectedTask: TASK_A
  });
  assert.equal(tracker.value.entries.length, 10_000);
  assert.equal(tracker.value.entries[0]?.id, "local-00000002");
  assert.equal(tracker.value.entries.at(-1)?.id, "local-00010001");
  assert.notEqual(validateTaskTimeSnapshot(tracker.value), null);
  assert.ok(new TextEncoder().encode(JSON.stringify(tracker.value)).byteLength < MAX_TASK_TIME_SNAPSHOT_BYTES);
});

test("also evicts oldest byte-heavy entries until the snapshot fits the atomic store", () => {
  const heavyTask: TrackedTaskSnapshot = {
    id: "heavy-task",
    projectId: "heavy-project",
    projectTitle: "\u0001".repeat(512),
    title: "\u0002".repeat(512)
  };
  const entries = Array.from({ length: 2_000 }, (_, index) => entry(index + 1, heavyTask, index * 2, 1));
  const tracker = new TaskTimeTracker({
    active: null,
    entries,
    nextEntryNumber: 2_001,
    selectedTask: heavyTask
  });
  assert.ok(tracker.value.entries.length < entries.length);
  assert.equal(tracker.value.entries.at(-1)?.id, "local-00002000");
  assert.ok(new TextEncoder().encode(JSON.stringify(tracker.value)).byteLength < MAX_TASK_TIME_SNAPSHOT_BYTES);
});

test("rejects malformed snapshots and independently optional project snapshots", () => {
  assert.equal(validateTaskTimeSnapshot({ ...defaultTaskTimeSnapshot(), unexpected: true }), null);
  assert.equal(validateTrackedTask({ id: "task", projectId: "project", projectTitle: null, title: "Task" })?.projectId, "project");
  assert.equal(validateTrackedTask({ id: "task", projectId: null, projectTitle: "Recovered title", title: "Task" })?.projectTitle, "Recovered title");
  assert.equal(validateTrackedTask({ id: " ", projectId: null, projectTitle: null, title: "Task" }), null);
});

function entry(
  number: number,
  task: TrackedTaskSnapshot,
  startedAtMs: number,
  durationMs: number
): TaskTimeSnapshot["entries"][number] {
  return Object.freeze({
    durationMs,
    endedAtMs: startedAtMs + durationMs,
    id: `local-${String(number).padStart(8, "0")}`,
    startedAtMs,
    task
  });
}
