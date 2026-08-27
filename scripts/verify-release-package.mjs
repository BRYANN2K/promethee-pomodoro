import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const failures = [];

if (manifest.private === true) failures.push("package.json must not be private");
if (manifest.name !== "promethee-pomodoro") failures.push("unexpected package name");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) failures.push("version must be stable semver");
if (manifest.publishConfig?.access !== "public") failures.push("publishConfig.access must be public");
if (manifest.publishConfig?.provenance !== true) failures.push("publishConfig.provenance must be enabled");

const requiredFiles = [
  "assets/app-icon.svg",
  "assets/PrometheePomodoro.icns",
  "assets/promethee-pomodoro-menu.png",
  "package-command.cjs",
  "bin/cli-options.cjs",
  "bin/macos-app.cjs",
  "bin/promethee-pomodoro.cjs",
  "dist/core/config.js",
  "dist/core/engine.js",
  "dist/core/index.js",
  "dist/core/state-validation.js",
  "dist/core/time.js",
  "dist/core/types.js",
  "dist/electron/handle.css",
  "dist/electron/handle.html",
  "dist/electron/handle.js",
  "dist/electron/geometry-poll-cadence.js",
  "dist/electron/linux-hud-capture.js",
  "dist/electron/linux-surface-attachment.js",
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
  "dist/native/darwin-arm64/promethee-input-bridge",
  "dist/native/darwin-x64/promethee-input-bridge",
  "dist/native/win32-x64/promethee-input-bridge.exe",
  "LICENSE",
  "README.md"
];

for (const relativePath of requiredFiles) {
  try {
    accessSync(path.join(repositoryRoot, relativePath), constants.R_OK);
  } catch {
    failures.push(`missing release file: ${relativePath}`);
  }
}

for (const relativePath of [
  "dist/native/darwin-arm64/promethee-input-bridge",
  "dist/native/darwin-x64/promethee-input-bridge"
]) {
  try {
    if ((statSync(path.join(repositoryRoot, relativePath)).mode & 0o111) === 0) {
      failures.push(`macOS helper is not executable: ${relativePath}`);
    }
  } catch {
    // The missing-file failure above is more actionable.
  }
}

verifyMachO("dist/native/darwin-arm64/promethee-input-bridge", 0x0100000c);
verifyMachO("dist/native/darwin-x64/promethee-input-bridge", 0x01000007);
verifyWindowsX64("dist/native/win32-x64/promethee-input-bridge.exe");

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const dryRun = spawnSync(
  npmExecutable,
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true }
);
if (dryRun.error !== undefined || dryRun.status !== 0) {
  failures.push(`npm pack dry-run failed${dryRun.stderr ? `: ${dryRun.stderr.trim()}` : ""}`);
} else {
  try {
    const result = JSON.parse(dryRun.stdout);
    const files = new Set((result[0]?.files ?? []).map((entry) => entry.path));
    for (const relativePath of requiredFiles) {
      if (!files.has(relativePath)) failures.push(`npm tarball omits: ${relativePath}`);
    }
    const forbiddenPrefixes = [".agents/", ".codex/", ".design-flow/", ".github/", "openspec/", "scripts/", "Tests/"];
    for (const packedPath of files) {
      if (forbiddenPrefixes.some((prefix) => packedPath.startsWith(prefix))) {
        failures.push(`npm tarball includes forbidden path: ${packedPath}`);
      }
      if (packedPath.startsWith("dist/native/") && !requiredFiles.includes(packedPath)) {
        failures.push(`npm tarball includes unexpected native file: ${packedPath}`);
      }
    }
  } catch {
    failures.push("npm pack dry-run did not return valid JSON");
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`release verification: ${failure}\n`);
  process.exit(1);
}

process.stdout.write(`Release package ${manifest.name}@${manifest.version} contains all three native targets and excludes private review artifacts.\n`);

function verifyMachO(relativePath, expectedCpuType) {
  let binary;
  try {
    binary = readFileSync(path.join(repositoryRoot, relativePath));
  } catch {
    return;
  }
  if (binary.length < 32 || binary.readUInt32LE(0) !== 0xfeedfacf) {
    failures.push(`native helper is not a thin 64-bit Mach-O: ${relativePath}`);
    return;
  }
  if (binary.readUInt32LE(4) !== expectedCpuType) {
    failures.push(`native helper has the wrong Mach-O architecture: ${relativePath}`);
  }
  const commandCount = binary.readUInt32LE(16);
  const commandBytes = binary.readUInt32LE(20);
  let offset = 32;
  const commandsEnd = offset + commandBytes;
  if (commandCount > 256 || commandsEnd > binary.length) {
    failures.push(`native helper has an invalid Mach-O load-command table: ${relativePath}`);
    return;
  }
  let minimumVersion = null;
  for (let index = 0; index < commandCount; index += 1) {
    if (offset + 8 > commandsEnd) break;
    const command = binary.readUInt32LE(offset);
    const commandSize = binary.readUInt32LE(offset + 4);
    if (commandSize < 8 || offset + commandSize > commandsEnd) break;
    if (command === 0x32 && commandSize >= 24) minimumVersion = binary.readUInt32LE(offset + 12);
    offset += commandSize;
  }
  if (minimumVersion !== 0x000e0000) {
    failures.push(`native helper must declare macOS 14.0 minimum: ${relativePath}`);
  }
}

function verifyWindowsX64(relativePath) {
  let binary;
  try {
    binary = readFileSync(path.join(repositoryRoot, relativePath));
  } catch {
    return;
  }
  if (binary.length < 64 || binary.readUInt16LE(0) !== 0x5a4d) {
    failures.push(`native helper is not a Windows PE executable: ${relativePath}`);
    return;
  }
  const peOffset = binary.readUInt32LE(0x3c);
  if (peOffset > binary.length - 6 || binary.readUInt32LE(peOffset) !== 0x00004550) {
    failures.push(`native helper has an invalid Windows PE header: ${relativePath}`);
    return;
  }
  if (binary.readUInt16LE(peOffset + 4) !== 0x8664) {
    failures.push(`native helper is not Windows x64: ${relativePath}`);
  }
}
