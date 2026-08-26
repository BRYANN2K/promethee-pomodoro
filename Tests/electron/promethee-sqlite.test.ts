import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PrometheeSqliteReader,
  openPrometheeSqlite,
  resolvePrometheeDatabasePath
} from "../../src/electron/promethee-sqlite.ts";

test("resolves only the fixed macOS and Windows Promethee database locations", () => {
  assert.equal(
    resolvePrometheeDatabasePath("darwin", "/Users/test/Library/Application Support"),
    "/Users/test/Library/Application Support/Promethee/promethee.db"
  );
  assert.equal(
    resolvePrometheeDatabasePath("win32", "C:\\Users\\test\\AppData\\Roaming"),
    "C:\\Users\\test\\AppData\\Roaming\\Promethee\\promethee.db"
  );
  assert.equal(resolvePrometheeDatabasePath("linux", "/tmp"), null);
  assert.equal(resolvePrometheeDatabasePath("darwin", "relative"), null);
});

test("reads the allowlisted task and project projection", () => {
  const database = fixtureDatabase();
  const reader = new PrometheeSqliteReader(database);
  const snapshot = reader.readTasks(1_800_000_000_000);

  assert.deepEqual(snapshot, {
    status: "ready",
    observedAtMs: 1_800_000_000_000,
    projects: [{ id: "project-1", title: "Platform", position: 1, updatedAtMs: 50, syncState: "synced" }],
    tasks: [{
      id: "task-1",
      title: "Ship the bridge",
      status: "open",
      position: 2,
      projectId: "project-1",
      updatedAtMs: 100,
      scheduledDate: "2026-08-25",
      parentId: null,
      recurrence: null,
      bonusTargetSeconds: 900,
      bonusAccepted: true,
      syncState: "synced"
    }]
  });
  reader.close();
});

test("derives running and paused session time without reading session content", () => {
  const database = fixtureDatabase();
  const reader = new PrometheeSqliteReader(database);
  const nowMs = 1_800_000_000_000;
  database.prepare(`
    INSERT INTO sessions (
      id, started_at, ended_at, duration_seconds, total_pause_ms, pause_started_at,
      parked_at, resumed_gap_ms, sync_state, deleted
    ) VALUES (?, ?, NULL, NULL, ?, NULL, NULL, 0, 'synced', 0)
  `).run("session-1", nowMs - 1_600_000, 100_000);

  const running = reader.readSession(nowMs);
  assert.equal(running.status, "observed");
  if (running.status === "observed") {
    assert.equal(running.state, "running");
    assert.equal(running.elapsedWorkMs, 1_500_000);
  }

  database.prepare("UPDATE sessions SET pause_started_at = ? WHERE id = ?").run(nowMs - 10_000, "session-1");
  const paused = reader.readSession(nowMs);
  assert.equal(paused.status, "observed");
  if (paused.status === "observed") {
    assert.equal(paused.state, "paused");
    assert.equal(paused.elapsedWorkMs, 1_490_000);
  }
  reader.close();
});

test("fails closed for multiple, parked, future, or malformed active sessions", () => {
  const nowMs = 1_800_000_000_000;

  const multipleDatabase = fixtureDatabase();
  const multiple = new PrometheeSqliteReader(multipleDatabase);
  insertActiveSession(multipleDatabase, "one", nowMs - 1_000);
  insertActiveSession(multipleDatabase, "two", nowMs - 2_000);
  assert.equal(multiple.readSession(nowMs).status, "unknown");
  multiple.close();

  const parkedDatabase = fixtureDatabase();
  const parked = new PrometheeSqliteReader(parkedDatabase);
  insertActiveSession(parkedDatabase, "parked", nowMs - 1_000, nowMs - 500);
  assert.deepEqual(parked.readSession(nowMs), {
    status: "unknown",
    observedAtMs: nowMs,
    reason: "parked-session"
  });
  parked.close();

  const futureDatabase = fixtureDatabase();
  const future = new PrometheeSqliteReader(futureDatabase);
  insertActiveSession(futureDatabase, "future", nowMs + 6 * 60_000);
  assert.equal(future.readSession(nowMs).status, "unknown");
  future.close();
});

test("opens only the canonical regular promethee.db in the expected directory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "promethee-sqlite-test-"));
  const expectedDirectory = path.join(root, "Promethee");
  mkdirSync(expectedDirectory);
  const databasePath = path.join(expectedDirectory, "promethee.db");
  const seed = new DatabaseSync(databasePath);
  createSchema(seed);
  seed.close();

  const opened = openPrometheeSqlite("darwin", root);
  assert.equal(opened.status, "ready");
  if (opened.status === "ready") opened.reader.close();

  const realDatabasePath = path.join(root, "real.db");
  const realDatabase = new DatabaseSync(realDatabasePath);
  createSchema(realDatabase);
  realDatabase.close();
  unlinkSync(databasePath);
  symlinkSync(realDatabasePath, databasePath);
  assert.equal(openPrometheeSqlite("darwin", root).status, "unsafe-path");
  assert.equal(openPrometheeSqlite("darwin", path.join(root, "missing")).status, "not-found");
  assert.equal(openPrometheeSqlite("linux", root).status, "unsupported-platform");
});

test("fails a task snapshot instead of returning malformed or overflow rows partially", () => {
  const malformedDatabase = fixtureDatabase();
  malformedDatabase.prepare("UPDATE tasks SET text = '' WHERE id = 'task-1'").run();
  const malformed = new PrometheeSqliteReader(malformedDatabase);
  assert.equal(malformed.readTasks().status, "incompatible");
  malformed.close();

  const overflowDatabase = fixtureDatabase();
  const insert = overflowDatabase.prepare(`
    INSERT INTO tasks (
      id, text, completed, position, project_id, updated_at, scheduled_date, parent_id,
      recurrence, bonus_target_seconds, bonus_accepted, sync_state, deleted, created_at
    ) VALUES (?, ?, 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, 'synced', 0, ?)
  `);
  for (let index = 1; index <= 500; index += 1) insert.run(`overflow-${index}`, "Task", index, index);
  const overflow = new PrometheeSqliteReader(overflowDatabase);
  assert.equal(overflow.readTasks().status, "incompatible");
  overflow.close();
});

test("fails impossible pause totals instead of clamping elapsed time", () => {
  const nowMs = 1_800_000_000_000;
  const database = fixtureDatabase();
  insertActiveSession(database, "impossible", nowMs - 1_000);
  database.prepare("UPDATE sessions SET total_pause_ms = 2000 WHERE id = 'impossible'").run();
  const reader = new PrometheeSqliteReader(database);
  assert.deepEqual(reader.readSession(nowMs), {
    status: "unknown",
    observedAtMs: nowMs,
    reason: "invalid-session"
  });
  reader.close();
});

test("rejects a session snapshot if database identity changes during the read", () => {
  const nowMs = 1_800_000_000_000;
  const database = fixtureDatabase();
  insertActiveSession(database, "changing", nowMs - 1_000);
  let checks = 0;
  const reader = new PrometheeSqliteReader(database, () => ++checks === 1);
  assert.deepEqual(reader.readSession(nowMs), {
    status: "unknown",
    observedAtMs: nowMs,
    reason: "incompatible-schema"
  });
  reader.close();
});

function fixtureDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  createSchema(database);
  database.prepare(`
    INSERT INTO task_projects (id, name, position, updated_at, sync_state, deleted, created_at)
    VALUES ('project-1', 'Platform', 1, 50, 'synced', 0, 1)
  `).run();
  database.prepare(`
    INSERT INTO tasks (
      id, text, completed, position, project_id, updated_at, scheduled_date, parent_id,
      recurrence, bonus_target_seconds, bonus_accepted, sync_state, deleted, created_at
    ) VALUES (
      'task-1', 'Ship the bridge', 0, 2, 'project-1', 100, '2026-08-25', NULL,
      NULL, 900, 1, 'synced', 0, 1
    )
  `).run();
  return database;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE task_projects (
      id TEXT PRIMARY KEY, name TEXT, position INTEGER, updated_at INTEGER,
      sync_state TEXT, deleted INTEGER, created_at INTEGER
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, text TEXT, completed INTEGER, position INTEGER,
      project_id TEXT, updated_at INTEGER, scheduled_date TEXT, parent_id TEXT,
      recurrence TEXT, bonus_target_seconds INTEGER, bonus_accepted INTEGER,
      sync_state TEXT, deleted INTEGER, created_at INTEGER
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, started_at INTEGER, ended_at INTEGER, duration_seconds INTEGER,
      total_pause_ms INTEGER, pause_started_at INTEGER, parked_at INTEGER,
      resumed_gap_ms INTEGER, sync_state TEXT, deleted INTEGER
    );
  `);
}

function insertActiveSession(database: DatabaseSync, id: string, startedAtMs: number, parkedAtMs: number | null = null): void {
  database.prepare(`
    INSERT INTO sessions (
      id, started_at, ended_at, duration_seconds, total_pause_ms, pause_started_at,
      parked_at, resumed_gap_ms, sync_state, deleted
    ) VALUES (?, ?, NULL, NULL, 0, NULL, ?, 0, 'synced', 0)
  `).run(id, startedAtMs, parkedAtMs);
}
