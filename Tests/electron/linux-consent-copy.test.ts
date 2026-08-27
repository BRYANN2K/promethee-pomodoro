import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nativeAutomationConsentModel } from "../../src/electron/native-promethee-bridge.ts";

const html = readFileSync(new URL("../../src/electron/menu.html", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../../src/electron/menu.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../../src/electron/main.ts", import.meta.url), "utf8");

test("only macOS has a consent the system recorded and can take back", () => {
  assert.equal(nativeAutomationConsentModel("darwin"), "system");
  assert.equal(nativeAutomationConsentModel("linux"), "session");
  assert.equal(nativeAutomationConsentModel("win32"), "session");
});

test("the menu is told which consent it is describing, at launch and on every refresh", () => {
  const sends = host.match(/consentModel: nativeAutomationConsentModel\(process\.platform\)/g) ?? [];
  assert.equal(sends.length, 2);
  assert.match(renderer, /value\.consentModel === "session" \|\| value\.consentModel === "system"/);
});

test("a session that grants nothing is not sent to system settings", () => {
  // Every place the macOS copy names a settings pane has a session counterpart,
  // and the choice between them is the consent model rather than the platform.
  assert.match(renderer, /consentModel === "session" \? copy\.sessionIntro : copy\.onboardingIntro/);
  assert.match(renderer, /consentModel === "session" \? copy\.sessionPermissionHelp : copy\.permissionHelp/);
  assert.match(renderer, /consentModel === "session" \? copy\.sessionPermissionPending : copy\.permissionPending/);
  assert.match(renderer, /open\.hidden = consentModel === "session"/);
  assert.match(html, /id="onboardingIntro"/);
});

test("the session copy exists in both languages and points nowhere the user cannot go", () => {
  for (const key of ["pointerNotice", "sessionIntro", "sessionPermissionHelp", "sessionPermissionPending"]) {
    const written = renderer.match(new RegExp(`${key}: "([^"]+)"`, "g")) ?? [];
    assert.equal(written.length, 2, `${key} is missing a translation`);
    for (const sentence of written) {
      assert.doesNotMatch(sentence, /System Settings|Réglages Système/);
    }
  }
});

test("the pointer the automation moves is declared where the automation is turned on", () => {
  assert.match(html, /id="pointerNotice" data-copy="pointerNotice" hidden/);
  assert.match(renderer, /requireElement\("pointerNotice"\)\.hidden = !automationEnabled \|\| consentModel !== "session"/);
  for (const sentence of renderer.match(/pointerNotice: "([^"]+)"/g) ?? []) {
    assert.match(sentence, /pointe(r|ur)/i);
  }
});
