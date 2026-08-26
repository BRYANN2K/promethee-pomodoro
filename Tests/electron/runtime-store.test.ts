import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RuntimePreferenceStore,
  decodePreferences,
  defaultPreferences,
  encodePreferences
} from "../../src/electron/runtime-store.ts";

test("enables auto-pause and keeps auto-resume off for new installations", () => {
  assert.equal(defaultPreferences().onboardingCompleted, false);
  assert.equal(defaultPreferences().settings.autoPausePromethee, true);
  assert.equal(defaultPreferences().settings.autoResumePromethee, false);
});

test("round-trips bounded preferences and selected task", () => {
  const value = {
    onboardingCompleted: true,
    settings: { ...defaultPreferences().settings, autoResumePromethee: true },
    selectedTask: { id: "task-1", projectId: "project-1", title: "Prepare release" }
  };
  assert.deepEqual(decodePreferences(encodePreferences(value)), value);
});

test("rejects corrupt, future, extra-field, and invalid setting files", () => {
  assert.equal(decodePreferences("{"), null);
  assert.equal(decodePreferences(JSON.stringify({ version: 3, ...defaultPreferences() })), null);
  assert.equal(decodePreferences(JSON.stringify({ version: 2, ...defaultPreferences(), extra: true })), null);
  assert.equal(decodePreferences(JSON.stringify({
    version: 2,
    onboardingCompleted: false,
    selectedTask: null,
    settings: { ...defaultPreferences().settings, focusDurationMs: 0 }
  })), null);
});

test("migrates version-1 preferences into the permission onboarding", () => {
  const previous = {
    selectedTask: { id: "task-1", projectId: null, title: "Existing task" },
    settings: defaultPreferences().settings,
    version: 1
  };
  assert.deepEqual(decodePreferences(JSON.stringify(previous)), {
    onboardingCompleted: false,
    selectedTask: previous.selectedTask,
    settings: previous.settings
  });
});

test("persists with atomic replacement and preserves the previous value after invalid input", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-store-"));
  const store = new RuntimePreferenceStore(path.join(root, "preferences.json"));
  const next = { onboardingCompleted: true, settings: defaultPreferences().settings, selectedTask: { id: "task", projectId: null, title: "Task" } };
  assert.deepEqual(await store.save(next), next);
  assert.deepEqual(await new RuntimePreferenceStore(path.join(root, "preferences.json")).load(), next);
  assert.equal(await store.save({ onboardingCompleted: true, settings: { ...next.settings, focusDurationMs: 0 }, selectedTask: null }), null);
  assert.deepEqual(store.value, next);
});
