import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(repositoryRoot, "dist", "native");
const target = `${process.platform}-${process.arch}`;
const minimumMacOSVersion = "14.0";
const supportedTargets = new Set(["darwin-arm64", "darwin-x64", "win32-x64"]);
if (!supportedTargets.has(target)) {
  process.stderr.write(`Native Promethee input is not supported for ${target}.\n`);
  process.exit(1);
}

const outputDirectory = path.join(nativeRoot, target);
mkdirSync(outputDirectory, { recursive: true });
rmSync(path.join(nativeRoot, "promethee-input-bridge"), { force: true });
rmSync(path.join(nativeRoot, "promethee-input-bridge.exe"), { force: true });

let executable;
let args;
if (process.platform === "darwin") {
  executable = "/usr/bin/clang";
  args = [
    "-fobjc-arc",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    `-mmacosx-version-min=${minimumMacOSVersion}`,
    "-framework", "AppKit",
    "-framework", "ApplicationServices",
    "-framework", "Foundation",
    path.join(repositoryRoot, "native", "macos", "promethee-input-bridge.m"),
    "-o", path.join(outputDirectory, "promethee-input-bridge")
  ];
} else if (process.platform === "win32") {
  executable = "cl.exe";
  args = [
    "/nologo", "/std:c++20", "/EHsc", "/O2", "/W4", "/WX",
    path.join(repositoryRoot, "native", "windows", "promethee-input-bridge.cpp"),
    `/Fe:${path.join(outputDirectory, "promethee-input-bridge.exe")}`,
    "dwmapi.lib",
    "user32.lib"
  ];
}

const result = spawnSync(executable, args, {
  cwd: repositoryRoot,
  env: process.platform === "darwin"
    ? { ...process.env, MACOSX_DEPLOYMENT_TARGET: minimumMacOSVersion }
    : process.env,
  stdio: "inherit",
  windowsHide: true
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
