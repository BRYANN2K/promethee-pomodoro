import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TaskTimeStore,
  decodeTaskTimeSnapshot,
  encodeTaskTimeSnapshot
} from "../../src/electron/task-time-store.ts";
import {
  TaskTimeTracker,
  defaultTaskTimeSnapshot,
  type TaskTimeObservation,
  type TrackedTaskSnapshot
} from "../../src/electron/task-time-tracker.ts";

const TASK: TrackedTaskSnapshot = Object.freeze({
  id: "task-store",
  projectId: "project-store",
  projectTitle: "Client Store",
  title: "Persist ledger"
});

function running(observedAtMs: number): TaskTimeObservation {
  return Object.freeze({ observedAtMs, sessionId: "session-store", status: "running" });
}

test("round-trips strict versioned snapshots including active last observation", () => {
  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK, running(1_000));
  tracker.observe(running(1_200));
  const encoded = encodeTaskTimeSnapshot(tracker.value);
  assert.doesNotMatch(encoded, /session-store/u);
  assert.deepEqual(decodeTaskTimeSnapshot(encoded), tracker.value);
});

test("rejects corrupt, future, extra-field, and inconsistent ledgers", () => {
  const empty = defaultTaskTimeSnapshot();
  assert.equal(decodeTaskTimeSnapshot("{"), null);
  assert.equal(decodeTaskTimeSnapshot(JSON.stringify({ version: 2, ...empty })), null);
  assert.equal(decodeTaskTimeSnapshot(JSON.stringify({ version: 1, ...empty, unexpected: true })), null);

  const tracker = new TaskTimeTracker();
  tracker.selectTask(TASK, running(1_000));
  tracker.observe(running(1_200));
  const inconsistent = JSON.parse(encodeTaskTimeSnapshot(tracker.value)) as Record<string, unknown>;
  const active = inconsistent.active as Record<string, unknown>;
  active.durationMs = 201;
  assert.equal(decodeTaskTimeSnapshot(JSON.stringify(inconsistent)), null);
});

test("atomically replaces the ledger and serializes concurrent saves in call order", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-ledger-"));
  const filePath = path.join(root, "task-time.json");
  const store = new TaskTimeStore(filePath);
  const first = new TaskTimeTracker();
  first.selectTask(TASK, running(1_000));
  first.observe(running(1_100));
  const second = new TaskTimeTracker(first.value);
  second.observe(running(2_000));
  second.observe(running(2_100));

  const [savedFirst, savedSecond] = await Promise.all([store.save(first.value), store.save(second.value)]);
  assert.deepEqual(savedFirst, first.value);
  assert.deepEqual(savedSecond, second.value);
  assert.deepEqual(store.value, second.value);
  assert.deepEqual(await new TaskTimeStore(filePath).load(), second.value);
  assert.equal(readFileSync(filePath, "utf8"), encodeTaskTimeSnapshot(second.value));
  assert.equal(await store.save({ ...second.value, nextEntryNumber: 0 }), null);
  assert.deepEqual(store.value, second.value);
});

test("restored active time is closed before any later running observation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-recovery-"));
  const filePath = path.join(root, "task-time.json");
  const beforeCrash = new TaskTimeTracker();
  beforeCrash.selectTask(TASK, running(1_000));
  beforeCrash.observe(running(1_200));
  await new TaskTimeStore(filePath).save(beforeCrash.value);

  const restoredSnapshot = await new TaskTimeStore(filePath).load();
  const restored = new TaskTimeTracker(restoredSnapshot);
  assert.equal(restored.value.active, null);
  assert.equal(restored.value.entries[0]?.durationMs, 200);
  restored.observe(running(100_000));
  assert.equal(restored.value.active?.durationMs, 0);
  restored.observe(running(100_100));
  assert.equal(restored.aggregate(100_100)?.allMs, 300);
});

test("preserves a corrupt or future ledger instead of overwriting it", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-corrupt-ledger-"));
  const filePath = path.join(root, "task-time.json");
  const futureContents = JSON.stringify({ version: 2, ...defaultTaskTimeSnapshot() });
  writeFileSync(filePath, futureContents, "utf8");

  const store = new TaskTimeStore(filePath);
  assert.deepEqual(await store.load(), defaultTaskTimeSnapshot());
  assert.equal(store.status, "corrupt");
  assert.equal(await store.save(defaultTaskTimeSnapshot()), null);
  assert.equal(readFileSync(filePath, "utf8"), futureContents);
});
