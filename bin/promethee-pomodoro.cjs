#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { macInstallRoot, parseCliOptions, resolveLaunchMode, smokeTestEnvironment } = require("./cli-options.cjs");

const appRoot = path.resolve(__dirname, "..");
const packageVersion = require(path.join(appRoot, "package.json")).version;
const cliOptions = parseCliOptions(process.argv.slice(2));
if (cliOptions.version) {
  process.stdout.write(`${packageVersion}\n`);
  process.exit(0);
}
const target = `${process.platform}-${process.arch}`;
const supportedTargets = new Set(["darwin-arm64", "darwin-x64", "win32-x64"]);
if (!supportedTargets.has(target)) {
  process.stderr.write(`Promethee Pomodoro does not provide a V1 runtime for ${target}.\n`);
  process.exit(1);
}
if (cliOptions.installOnly && process.platform !== "darwin") {
  process.stderr.write("Promethee Pomodoro --install-only is available on macOS only.\n");
  process.exit(1);
}

let launchMode;
try {
  launchMode = resolveLaunchMode(process.platform, cliOptions);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Invalid command options."}\n`);
  process.exit(2);
}

let executable;
let executableArguments;
let launchEnvironment = process.env;
let foreground = cliOptions.foreground;
if (launchMode === "smoke-test") {
  executable = require("electron");
  executableArguments = [appRoot];
  launchEnvironment = smokeTestEnvironment(process.env);
  foreground = true;
} else if (launchMode === "macos-application") {
  const electron = require("electron");
  const electronVersion = require("electron/package.json").version;
  const { installMacApplication } = require("./macos-app.cjs");
  let installation;
  try {
    installation = installMacApplication({
      appRoot,
      electronAppPath: path.resolve(electron, "../../.."),
      electronVersion,
      installRoot: macInstallRoot(process.env),
      target
    });
  } catch (error) {
    process.stderr.write(`Unable to prepare Promethee Pomodoro: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exit(1);
  }
  for (const warning of installation.warnings) process.stderr.write(`Warning: ${warning}\n`);
  if (cliOptions.installOnly) {
    process.stdout.write(`Promethee Pomodoro ${installation.status} at ${installation.applicationPath}\n`);
    process.exit(0);
  }
  executable = installation.executablePath;
  executableArguments = [];
} else {
  executable = require("electron");
  executableArguments = [appRoot];
}

const child = spawn(executable, executableArguments, foreground
  ? { env: launchEnvironment, stdio: "inherit" }
  : { detached: true, env: launchEnvironment, stdio: "ignore" });

child.once("error", (error) => {
  process.stderr.write(`Unable to launch Promethee Pomodoro: ${error.message}\n`);
  process.exitCode = 1;
});

if (foreground) {
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
} else {
  child.unref();
}
