import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the attached menu localizes its close and section accessible names", () => {
  const html = readFileSync(new URL("../../src/electron/menu.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../../src/electron/menu.ts", import.meta.url), "utf8");

  assert.match(html, /data-copy-aria="close"/);
  assert.match(html, /data-copy-aria="menuSections"/);
  assert.match(renderer, /close: "Fermer le menu Pomodoro"/);
  assert.match(renderer, /menuSections: "Sections du menu Pomodoro"/);
  assert.match(renderer, /resetTimer: "Réinitialiser le timer"/);
  assert.match(renderer, /setAttribute\("aria-label", copy\[key\]\)/);
});

test("the first-launch permission onboarding is wired to detected grants", () => {
  const html = readFileSync(new URL("../../src/electron/menu.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../../src/electron/menu.ts", import.meta.url), "utf8");
  const preload = readFileSync(new URL("../../src/electron/runtime-preload.cts", import.meta.url), "utf8");

  for (const id of [
    "onboardingPanel",
    "inputPermissionRow",
    "inputPermissionStatus",
    "capturePermissionRow",
    "capturePermissionStatus",
    "openInputSettings",
    "openCaptureSettings",
    "refreshPermissions",
    "completeOnboarding",
    "dismissOnboarding",
    "settingsPermissionStatus",
    "reviewPermissions"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(renderer, new RegExp(`"${id}"`));
  }
  assert.match(renderer, /row\.dataset\.state = granted \? "granted" : "pending"/);
  assert.match(renderer, /complete\.disabled = applicationRestarting \|\| refreshingPermissions \|\| !currentPermissions\.supported/);
  assert.match(renderer, /currentPreferences\?\.onboardingCompleted === false/);
  assert.match(renderer, /permissionReviewOpen \|\| hostPermissionRecovery \|\| currentPreferences\?\.onboardingCompleted === false/);
  assert.match(renderer, /restarting: "Restarting Promethee Pomodoro…"/);
  assert.match(renderer, /restarting: "Redémarrage de Promethee Pomodoro…"/);
  assert.match(preload, /runtime:refresh-permissions/);
  assert.match(preload, /runtime:request-permissions/);
  assert.match(preload, /runtime:complete-onboarding/);
  assert.match(preload, /runtime:dismiss-onboarding/);
  assert.match(html, /data-copy-aria="openInputSettingsLabel"/);
  assert.match(html, /data-copy-aria="openCaptureSettingsLabel"/);
});
