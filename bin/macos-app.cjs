"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP_BUNDLE_NAME = "Promethee Pomodoro.app";
const APP_DISPLAY_NAME = "Promethee Pomodoro";
const APP_EXECUTABLE_NAME = "Promethee Pomodoro";
const APP_BUNDLE_ID = "io.github.bryann2k.promethee-pomodoro";
const RETIRED_APP_BUNDLE_IDS = Object.freeze(["io.github.bryann2k.PrometheePomodoro"]);
const APP_MARKER_NAME = ".promethee-pomodoro-build.json";
const APP_MARKER_SCHEMA = 1;
const ACCESSIBILITY_USAGE_DESCRIPTION = "Promethee Pomodoro requests access at launch only for its bounded Pause and Resume automation. Automatic Pause starts enabled and can be turned off.";

const MAC_APP_PAYLOAD_FILES = Object.freeze([
  "dist/core/config.js",
  "dist/core/engine.js",
  "dist/core/index.js",
  "dist/core/state-validation.js",
  "dist/core/time.js",
  "dist/core/types.js",
  "dist/electron/geometry-poll-cadence.js",
  "dist/electron/handle.css",
  "dist/electron/handle.html",
  "dist/electron/handle.js",
  "dist/electron/macos-hud-capture.js",
  "dist/electron/main.js",
  "dist/electron/menu.css",
  "dist/electron/menu.html",
  "dist/electron/menu.js",
  "dist/electron/native-promethee-bridge.js",
  "dist/electron/overlay.css",
  "dist/electron/overlay.html",
  "dist/electron/overlay.js",
  "dist/electron/promethee-control.js",
  "dist/electron/promethee-sqlite.js",
  "dist/electron/promethee-window-locator.js",
  "dist/electron/release-update.js",
  "dist/electron/runtime-controller.js",
  "dist/electron/runtime-preload.cjs",
  "dist/electron/runtime-store.js",
  "dist/electron/runtime-window-plan.js",
  "dist/electron/styles/tokens.css",
  "dist/electron/task-time-store.js",
  "dist/electron/task-time-tracker.js",
  "dist/electron/window-plan.js",
  "assets/PrometheePomodoro.icns",
  "LICENSE",
  "package.json"
]);

function defaultRun(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
}

function installMacApplication(options) {
  const appRoot = path.resolve(options.appRoot);
  const electronAppPath = path.resolve(options.electronAppPath);
  const target = options.target;
  const electronVersion = options.electronVersion;
  const installRoot = path.resolve(options.installRoot ?? path.join(os.homedir(), "Applications"));
  const run = options.run ?? defaultRun;
  const warnings = [];

  if (!new Set(["darwin-arm64", "darwin-x64"]).has(target)) {
    throw new Error(`Cannot assemble the macOS application for ${target}.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(electronVersion ?? "")) {
    throw new Error("The packaged Electron version is invalid.");
  }

  const manifest = readJson(path.join(appRoot, "package.json"));
  if (manifest.name !== "promethee-pomodoro" || !/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) {
    throw new Error("The packaged Promethee Pomodoro manifest is invalid.");
  }
  if (manifest.dependencies?.electron !== electronVersion) {
    throw new Error("The packaged Electron.app runtime does not match the locked application dependency.");
  }

  assertMacOS14(run);
  assertDirectory(electronAppPath, "The packaged Electron.app runtime is unavailable.");
  const payloadFiles = payloadFilesForTarget(target);
  for (const relativePath of payloadFiles) {
    assertFile(path.join(appRoot, relativePath), `The packaged application file is unavailable: ${relativePath}`);
  }

  fs.mkdirSync(installRoot, { recursive: true, mode: 0o755 });
  const lockPath = path.join(installRoot, ".promethee-pomodoro-install.lock");
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Another Promethee Pomodoro installation is already running.");
    throw error;
  }

  const destinationApp = path.join(installRoot, APP_BUNDLE_NAME);
  let stagingRoot = null;
  let backupApp = null;
  try {
    const fingerprint = computeBuildFingerprint({
      appRoot,
      electronVersion,
      packageVersion: manifest.version,
      payloadFiles,
      target
    });

    if (isReusableApplication({
      destinationApp,
      fingerprint,
      packageVersion: manifest.version,
      run,
      target
    })) {
      return Object.freeze({
        applicationPath: destinationApp,
        executablePath: brandedExecutablePath(destinationApp),
        status: "reused",
        tccReset: false,
        warnings
      });
    }

    const hadExistingApplication = fs.existsSync(destinationApp);
    stagingRoot = fs.mkdtempSync(path.join(installRoot, ".promethee-pomodoro-stage-"));
    const stagingApp = path.join(stagingRoot, APP_BUNDLE_NAME);
    runRequired(run, "/usr/bin/ditto", [electronAppPath, stagingApp], "Unable to copy the packaged Electron.app runtime.");
    assembleApplicationPayload({
      appRoot,
      applicationPath: stagingApp,
      fingerprint,
      packageVersion: manifest.version,
      payloadFiles,
      target
    });
    configureApplicationPlist({
      applicationPath: stagingApp,
      packageVersion: manifest.version,
      run
    });
    runRequired(run, "/usr/bin/codesign", ["--force", "--deep", "--sign", "-", stagingApp], "Unable to apply the local ad hoc application signature.");
    runRequired(run, "/usr/bin/codesign", ["--verify", "--deep", "--strict", stagingApp], "The assembled macOS application signature is invalid.");

    if (hadExistingApplication) {
      backupApp = path.join(installRoot, `.Promethee Pomodoro.backup-${process.pid}-${Date.now()}.app`);
      fs.renameSync(destinationApp, backupApp);
    }
    try {
      fs.renameSync(stagingApp, destinationApp);
    } catch (error) {
      if (backupApp !== null && fs.existsSync(backupApp) && !fs.existsSync(destinationApp)) {
        fs.renameSync(backupApp, destinationApp);
        backupApp = null;
      }
      throw error;
    }
    if (backupApp !== null) {
      const obsoleteBackup = backupApp;
      backupApp = null;
      try {
        fs.rmSync(obsoleteBackup, { force: true, recursive: true });
      } catch {
        warnings.push(`The replaced application backup remains at ${obsoleteBackup}.`);
      }
    }

    for (const bundleIdentifier of [APP_BUNDLE_ID, ...RETIRED_APP_BUNDLE_IDS]) {
      for (const service of ["Accessibility", "ScreenCapture"]) {
        const result = run("/usr/bin/tccutil", ["reset", service, bundleIdentifier]);
        if (result.error !== undefined || result.status !== 0) {
          warnings.push(`macOS could not reset ${service} for ${bundleIdentifier}.`);
        }
      }
    }

    return Object.freeze({
      applicationPath: destinationApp,
      executablePath: brandedExecutablePath(destinationApp),
      status: hadExistingApplication ? "replaced" : "installed",
      tccReset: true,
      warnings
    });
  } finally {
    if (backupApp !== null && fs.existsSync(backupApp) && !fs.existsSync(destinationApp)) {
      fs.renameSync(backupApp, destinationApp);
      backupApp = null;
    }
    if (stagingRoot !== null) fs.rmSync(stagingRoot, { force: true, recursive: true });
    fs.rmSync(lockPath, { force: true, recursive: true });
  }
}

function payloadFilesForTarget(target) {
  const helperName = "promethee-input-bridge";
  return Object.freeze([
    ...MAC_APP_PAYLOAD_FILES,
    `dist/native/${target}/${helperName}`
  ]);
}

function computeBuildFingerprint({ appRoot, electronVersion, packageVersion, payloadFiles, target }) {
  const hash = createHash("sha256");
  hash.update(`promethee-pomodoro-macos-app\0${packageVersion}\0${electronVersion}\0${target}\0`);
  for (const relativePath of payloadFiles) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(appRoot, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function assembleApplicationPayload({ appRoot, applicationPath, fingerprint, packageVersion, payloadFiles, target }) {
  const resourcesPath = path.join(applicationPath, "Contents", "Resources");
  const appResourcesPath = path.join(resourcesPath, "app");
  const originalExecutable = path.join(applicationPath, "Contents", "MacOS", "Electron");
  const brandedExecutable = brandedExecutablePath(applicationPath);
  assertFile(originalExecutable, "The packaged Electron executable is unavailable.");

  fs.rmSync(path.join(resourcesPath, "default_app.asar"), { force: true, recursive: true });
  fs.rmSync(appResourcesPath, { force: true, recursive: true });
  fs.mkdirSync(appResourcesPath, { recursive: true, mode: 0o755 });
  for (const relativePath of payloadFiles) {
    const source = path.join(appRoot, relativePath);
    const destination = relativePath === "assets/PrometheePomodoro.icns"
      ? path.join(resourcesPath, "PrometheePomodoro.icns")
      : path.join(appResourcesPath, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    fs.copyFileSync(source, destination);
  }
  fs.chmodSync(path.join(appResourcesPath, `dist/native/${target}/promethee-input-bridge`), 0o755);
  fs.renameSync(originalExecutable, brandedExecutable);
  fs.chmodSync(brandedExecutable, 0o755);
  fs.writeFileSync(path.join(appResourcesPath, APP_MARKER_NAME), `${JSON.stringify({
    bundleIdentifier: APP_BUNDLE_ID,
    fingerprint,
    packageVersion,
    schemaVersion: APP_MARKER_SCHEMA,
    target
  })}\n`, { encoding: "utf8", mode: 0o644 });
}

function configureApplicationPlist({ applicationPath, packageVersion, run }) {
  const plistPath = path.join(applicationPath, "Contents", "Info.plist");
  assertFile(plistPath, "The packaged Electron Info.plist is unavailable.");
  setPlistValue(run, plistPath, "CFBundleIdentifier", "string", APP_BUNDLE_ID);
  setPlistValue(run, plistPath, "CFBundleName", "string", APP_DISPLAY_NAME);
  setPlistValue(run, plistPath, "CFBundleDisplayName", "string", APP_DISPLAY_NAME);
  setPlistValue(run, plistPath, "CFBundleExecutable", "string", APP_EXECUTABLE_NAME);
  setPlistValue(run, plistPath, "CFBundleShortVersionString", "string", packageVersion);
  setPlistValue(run, plistPath, "CFBundleVersion", "string", packageVersion);
  setPlistValue(run, plistPath, "CFBundleIconFile", "string", "PrometheePomodoro.icns");
  setPlistValue(run, plistPath, "LSUIElement", "bool", "true");
  setPlistValue(run, plistPath, "NSAccessibilityUsageDescription", "string", ACCESSIBILITY_USAGE_DESCRIPTION);
}

function setPlistValue(run, plistPath, key, type, value) {
  const setResult = run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath]);
  if (setResult.error === undefined && setResult.status === 0) return;
  runRequired(
    run,
    "/usr/libexec/PlistBuddy",
    ["-c", `Add :${key} ${type} ${value}`, plistPath],
    `Unable to configure ${key} in the macOS application identity.`
  );
}

function isReusableApplication({ destinationApp, fingerprint, packageVersion, run, target }) {
  try {
    if (!fs.statSync(destinationApp).isDirectory()) return false;
    const marker = readJson(path.join(destinationApp, "Contents", "Resources", "app", APP_MARKER_NAME));
    if (marker.schemaVersion !== APP_MARKER_SCHEMA ||
        marker.bundleIdentifier !== APP_BUNDLE_ID ||
        marker.fingerprint !== fingerprint ||
        marker.packageVersion !== packageVersion ||
        marker.target !== target) return false;
    assertFile(brandedExecutablePath(destinationApp), "missing executable");
    assertFile(path.join(destinationApp, "Contents", "Resources", "PrometheePomodoro.icns"), "missing icon");
    assertFile(path.join(destinationApp, "Contents", "Resources", "app", `dist/native/${target}/promethee-input-bridge`), "missing helper");
    return plistValue(run, destinationApp, "CFBundleIdentifier") === APP_BUNDLE_ID &&
      plistValue(run, destinationApp, "CFBundleName") === APP_DISPLAY_NAME &&
      plistValue(run, destinationApp, "CFBundleDisplayName") === APP_DISPLAY_NAME &&
      plistValue(run, destinationApp, "CFBundleExecutable") === APP_EXECUTABLE_NAME &&
      plistValue(run, destinationApp, "CFBundleShortVersionString") === packageVersion &&
      plistValue(run, destinationApp, "CFBundleVersion") === packageVersion &&
      plistValue(run, destinationApp, "CFBundleIconFile") === "PrometheePomodoro.icns" &&
      ["1", "true", "YES"].includes(plistValue(run, destinationApp, "LSUIElement")) &&
      plistValue(run, destinationApp, "NSAccessibilityUsageDescription") === ACCESSIBILITY_USAGE_DESCRIPTION &&
      commandPassed(run, "/usr/bin/codesign", ["--verify", "--deep", "--strict", destinationApp]);
  } catch {
    return false;
  }
}

function plistValue(run, applicationPath, key) {
  const result = run("/usr/bin/plutil", [
    "-extract", key, "raw", "-o", "-",
    path.join(applicationPath, "Contents", "Info.plist")
  ]);
  if (result.error !== undefined || result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
}

function assertMacOS14(run) {
  const result = run("/usr/bin/sw_vers", ["-productVersion"]);
  if (result.error !== undefined || result.status !== 0) throw new Error("Unable to determine the macOS version.");
  const version = String(result.stdout ?? "").trim();
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isSafeInteger(major) || major < 14) {
    throw new Error(`Promethee Pomodoro requires macOS 14 or later (found ${version || "unknown"}).`);
  }
}

function brandedExecutablePath(applicationPath) {
  return path.join(applicationPath, "Contents", "MacOS", APP_EXECUTABLE_NAME);
}

function commandPassed(run, command, args) {
  const result = run(command, args);
  return result.error === undefined && result.status === 0;
}

function runRequired(run, command, args, message) {
  const result = run(command, args);
  if (result.error !== undefined || result.status !== 0) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertDirectory(filePath, message) {
  try {
    if (fs.statSync(filePath).isDirectory()) return;
  } catch {}
  throw new Error(message);
}

function assertFile(filePath, message) {
  try {
    if (fs.statSync(filePath).isFile()) return;
  } catch {}
  throw new Error(message);
}

module.exports = {
  ACCESSIBILITY_USAGE_DESCRIPTION,
  APP_BUNDLE_ID,
  APP_BUNDLE_NAME,
  APP_DISPLAY_NAME,
  APP_EXECUTABLE_NAME,
  APP_MARKER_NAME,
  RETIRED_APP_BUNDLE_IDS,
  MAC_APP_PAYLOAD_FILES,
  brandedExecutablePath,
  computeBuildFingerprint,
  installMacApplication,
  payloadFilesForTarget
};
