import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../../src/electron/main.ts", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");

test("Electron smoke mode waits for readiness, emits one target marker, and exits without normal startup", () => {
  assert.match(main, /PROMETHEE_POMODORO_SMOKE_TEST === "1"/);
  assert.match(main, /const SMOKE_TEST_TIMEOUT_MS = 8_000/);
  assert.match(main, /const SMOKE_TEST_MARKER = "promethee-pomodoro-smoke-ready"/);
  assert.match(main, /void app\.whenReady\(\)\.then\(/);
  assert.match(main, /PROMETHEE_POMODORO_SMOKE_RESULT_FILE/);
  assert.match(main, /writeFile\(resultFile, `\$\{message\}\\n`/);
  assert.match(main, /`\$\{SMOKE_TEST_MARKER\},\$\{app\.getVersion\(\)\},\$\{process\.platform\}-\$\{process\.arch\}`/);
  assert.match(main, /if \(SMOKE_TEST\) \{\s*runElectronSmokeTest\(\);\s*\} else \{\s*const ownsInstanceLock/s);
});

test("the exact installed tarball is smoke-launched through branded macOS bundles and Windows", () => {
  assert.match(releaseWorkflow, /runner: macos-15\s+target: darwin-arm64/);
  assert.match(releaseWorkflow, /runner: macos-15-intel\s+target: darwin-x64/);
  assert.match(releaseWorkflow, /runner: windows-2025\s+target: win32-x64/);
  assert.equal(releaseWorkflow.match(/--smoke-test/g)?.length, 1);
  assert.match(releaseWorkflow, /PROMETHEE_POMODORO_INSTALL_DIR="\$INSTALL_ROOT" "\$PREFIX\/bin\/promethee-pomodoro" --install-only/);
  assert.match(releaseWorkflow, /plutil -extract CFBundleIdentifier raw/);
  assert.match(releaseWorkflow, /codesign --verify --deep --strict/);
  assert.match(releaseWorkflow, /"\$APP\/Contents\/MacOS\/Promethee Pomodoro"/);
  assert.match(releaseWorkflow, /PROMETHEE_POMODORO_SMOKE_RESULT_FILE="\$SMOKE_RESULT"/);
  assert.match(releaseWorkflow, /\$env:PROMETHEE_POMODORO_SMOKE_RESULT_FILE = \$smokeResult/);
  assert.match(releaseWorkflow, /promethee-pomodoro-smoke-ready,\$\{EXPECTED_VERSION\},\$\{RELEASE_TARGET\}/);
  assert.match(releaseWorkflow, /promethee-pomodoro-smoke-ready,\$expectedVersion,\$env:RELEASE_TARGET/);
});

test("npm publication is skipped only for an exact registry integrity match", () => {
  assert.equal(releaseWorkflow.match(/name: Verify package checksum/g)?.length, 1);
  assert.match(releaseWorkflow, /id: registry/);
  assert.match(releaseWorkflow, /createHash\("sha512"\)/);
  assert.match(releaseWorkflow, /registry_status=matching/);
  assert.match(releaseWorkflow, /registry_status=missing/);
  assert.match(releaseWorkflow, /if: steps\.registry\.outputs\.registry_status == 'missing'/);
  assert.match(releaseWorkflow, /name: Verify published npm integrity/);
  assert.match(releaseWorkflow, /dist-tags/);
  assert.match(releaseWorkflow, /tags\?\.latest === version/);
  assert.match(releaseWorkflow, /needs: publish-npm/);
  assert.match(releaseWorkflow, /node-version: "24\.19\.0"/);
  assert.match(releaseWorkflow, /npm@11\.17\.0/);
  assert.match(releaseWorkflow, /group: release-\$\{\{ github\.ref \}\}/);
  assert.match(releaseWorkflow, /gh release view/);
  assert.match(releaseWorkflow, /gh release upload.*--clobber/);
  assert.match(releaseWorkflow, /cmp "\.release\/\$PACKAGE_NAME" "\$VERIFY_DIR\/\$PACKAGE_NAME"/);
});
