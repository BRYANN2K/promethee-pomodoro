import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const cliPath = path.join(repositoryRoot, "bin", "promethee-pomodoro.cjs");
const require = createRequire(import.meta.url);
const { parseCliOptions, resolveLaunchMode, smokeTestEnvironment } = require(path.join(repositoryRoot, "bin", "cli-options.cjs"));
const {
  ACCESSIBILITY_USAGE_DESCRIPTION,
  APP_BUNDLE_ID,
  APP_EXECUTABLE_NAME,
  APP_MARKER_NAME,
  RETIRED_APP_BUNDLE_IDS,
  installMacApplication,
  payloadFilesForTarget
} = require(path.join(repositoryRoot, "bin", "macos-app.cjs"));

test("reports the package version without launching Electron", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-version-"));
  try {
    mkdirSync(path.join(fixtureRoot, "bin"));
    cpSync(cliPath, path.join(fixtureRoot, "bin", "promethee-pomodoro.cjs"));
    cpSync(path.join(repositoryRoot, "bin", "cli-options.cjs"), path.join(fixtureRoot, "bin", "cli-options.cjs"));
    writeFileSync(path.join(fixtureRoot, "package.json"), '{"name":"promethee-pomodoro","version":"1.0.0"}\n');

    const result = spawnSync(process.execPath, [path.join(fixtureRoot, "bin", "promethee-pomodoro.cjs"), "--version"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      timeout: 2_000
    });

    assert.equal(result.status, 0);
    assert.equal(result.stdout, "1.0.0\n");
    assert.equal(result.stderr, "");
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("the public launcher explicitly allowlists only packaged V1 targets", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(cliPath, "utf8");
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { files?: unknown };
  const verifier = await readFile(path.join(repositoryRoot, "scripts", "verify-release-package.mjs"), "utf8");
  const packageCommand = await readFile(path.join(repositoryRoot, "package-command.cjs"), "utf8");

  assert.match(source, /new Set\(\["darwin-arm64", "darwin-x64", "win32-x64"\]\)/);
  assert.match(source, /does not provide a V1 runtime/);
  assert.ok(Array.isArray(manifest.files));
  assert.equal(manifest.files.some((entry) => typeof entry === "string" && entry.startsWith("scripts/")), false);
  assert.match(verifier, /"scripts\/"/);
  assert.match(packageCommand, /Installed Promethee Pomodoro payload is complete/);
  assert.match(packageCommand, /Republishing from an installed package is unsupported/);
});

test("install-only is an explicit non-launching CLI mode", () => {
  assert.deepEqual(parseCliOptions(["--install-only"]), {
    foreground: false,
    installOnly: true,
    smokeTest: false,
    version: false
  });
  assert.deepEqual(parseCliOptions(["--foreground", "--install-only"]), {
    foreground: true,
    installOnly: true,
    smokeTest: false,
    version: false
  });
});

test("smoke-test bypasses macOS installation and forces safe inherited execution", () => {
  const options = parseCliOptions(["--smoke-test"]);
  assert.deepEqual(options, {
    foreground: false,
    installOnly: false,
    smokeTest: true,
    version: false
  });
  assert.equal(resolveLaunchMode("darwin", options), "smoke-test");
  assert.equal(resolveLaunchMode("win32", options), "smoke-test");
  assert.throws(
    () => resolveLaunchMode("darwin", parseCliOptions(["--smoke-test", "--install-only"])),
    /cannot be combined/
  );
  assert.deepEqual(smokeTestEnvironment({ RETAINED: "value" }), {
    PROMETHEE_POMODORO_DISABLE_AUTOMATION: "1",
    PROMETHEE_POMODORO_SMOKE_TEST: "1",
    RETAINED: "value"
  });
});

test("macOS npm installation assembles, reuses, and safely replaces the branded app", () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "promethee-pomodoro-macos-package-"));
  const appRoot = path.join(fixtureRoot, "package");
  const electronAppPath = path.join(fixtureRoot, "Electron.app");
  const installRoot = path.join(fixtureRoot, "Applications");
  const calls: Array<{ command: string; args: string[] }> = [];
  const packageManifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as {
    dependencies: { electron: string };
  };
  const electronVersion = packageManifest.dependencies.electron;
  const plistValues: Record<string, string> = {
    CFBundleDisplayName: "Promethee Pomodoro",
    CFBundleExecutable: APP_EXECUTABLE_NAME,
    CFBundleIconFile: "PrometheePomodoro.icns",
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundleName: "Promethee Pomodoro",
    CFBundleShortVersionString: "1.0.0",
    CFBundleVersion: "1.0.0",
    LSUIElement: "true",
    NSAccessibilityUsageDescription: ACCESSIBILITY_USAGE_DESCRIPTION
  };

  try {
    for (const relativePath of payloadFilesForTarget("darwin-arm64")) {
      const source = path.join(repositoryRoot, relativePath);
      const destination = path.join(appRoot, relativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination);
    }
    mkdirSync(path.join(electronAppPath, "Contents", "MacOS"), { recursive: true });
    mkdirSync(path.join(electronAppPath, "Contents", "Resources"), { recursive: true });
    writeFileSync(path.join(electronAppPath, "Contents", "MacOS", "Electron"), "electron");
    writeFileSync(path.join(electronAppPath, "Contents", "Resources", "default_app.asar"), "default");
    writeFileSync(path.join(electronAppPath, "Contents", "Info.plist"), "plist");

    const run = (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "/usr/bin/sw_vers") return { status: 0, stdout: "14.7\n" };
      if (command === "/usr/bin/ditto") {
        cpSync(args[0], args[1], { recursive: true });
        return { status: 0, stdout: "" };
      }
      if (command === "/usr/bin/plutil") return { status: 0, stdout: `${plistValues[args[1]] ?? ""}\n` };
      return { status: 0, stdout: "" };
    };

    const first = installMacApplication({
      appRoot,
      electronAppPath,
      electronVersion,
      installRoot,
      run,
      target: "darwin-arm64"
    });
    assert.equal(first.status, "installed");
    assert.equal(first.tccReset, true);
    assert.equal(existsSync(first.executablePath), true);
    assert.equal(existsSync(path.join(first.applicationPath, "Contents", "MacOS", "Electron")), false);
    assert.equal(existsSync(path.join(first.applicationPath, "Contents", "Resources", "default_app.asar")), false);
    assert.equal(existsSync(path.join(first.applicationPath, "Contents", "Resources", "app", APP_MARKER_NAME)), true);
    assert.equal(calls.filter(({ command }) => command === "/usr/bin/tccutil").length, 4);
    assert.equal(calls.filter(({ command, args }) => command === "/usr/bin/codesign" && args.includes("--sign")).length, 1);
    assert.ok(calls.some(({ command, args }) => command === "/usr/libexec/PlistBuddy" && args[1] === `Set :CFBundleIdentifier ${APP_BUNDLE_ID}`));
    assert.ok(calls.some(({ command, args }) => command === "/usr/libexec/PlistBuddy" && args[1] === "Set :LSUIElement true"));
    assert.ok(calls.some(({ command, args }) => command === "/usr/libexec/PlistBuddy" && args[1] === `Set :NSAccessibilityUsageDescription ${ACCESSIBILITY_USAGE_DESCRIPTION}`));

    const second = installMacApplication({
      appRoot,
      electronAppPath,
      electronVersion,
      installRoot,
      run,
      target: "darwin-arm64"
    });
    assert.equal(second.status, "reused");
    assert.equal(second.tccReset, false);
    assert.equal(calls.filter(({ command }) => command === "/usr/bin/tccutil").length, 4);
    assert.equal(calls.filter(({ command, args }) => command === "/usr/bin/codesign" && args.includes("--sign")).length, 1);

    const menuPath = path.join(appRoot, "dist", "electron", "menu.css");
    writeFileSync(menuPath, `${readFileSync(menuPath, "utf8")}\n/* replacement */\n`);
    const third = installMacApplication({
      appRoot,
      electronAppPath,
      electronVersion,
      installRoot,
      run,
      target: "darwin-arm64"
    });
    assert.equal(third.status, "replaced");
    assert.equal(third.tccReset, true);
    assert.equal(calls.filter(({ command }) => command === "/usr/bin/tccutil").length, 8);
    assert.equal(calls.filter(({ command, args }) => command === "/usr/bin/codesign" && args.includes("--sign")).length, 2);
    assert.deepEqual(
      calls.filter(({ command }) => command === "/usr/bin/tccutil").map(({ args }) => args),
      [
        ["reset", "Accessibility", APP_BUNDLE_ID],
        ["reset", "ScreenCapture", APP_BUNDLE_ID],
        ["reset", "Accessibility", RETIRED_APP_BUNDLE_IDS[0]],
        ["reset", "ScreenCapture", RETIRED_APP_BUNDLE_IDS[0]],
        ["reset", "Accessibility", APP_BUNDLE_ID],
        ["reset", "ScreenCapture", APP_BUNDLE_ID],
        ["reset", "Accessibility", RETIRED_APP_BUNDLE_IDS[0]],
        ["reset", "ScreenCapture", RETIRED_APP_BUNDLE_IDS[0]]
      ]
    );
    assert.equal(existsSync(path.join(installRoot, ".promethee-pomodoro-install.lock")), false);
    assert.equal(calls.filter(({ command }) => command === "/usr/bin/ditto").length, 2);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});
