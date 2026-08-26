#!/usr/bin/env node

"use strict";

const { existsSync, mkdirSync, readdirSync, copyFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = __dirname;
const command = process.argv[2];
const passthrough = process.argv.slice(3);
const sourceCheckout = [
  path.join(root, "src"),
  path.join(root, "Tests"),
  path.join(root, "scripts", "build-native-input-bridge.mjs"),
  path.join(root, "scripts", "verify-release-package.mjs")
].every(existsSync);

if (typeof command !== "string") fail("A package command is required.");

if (!sourceCheckout) {
  runInstalledCommand(command, passthrough);
} else {
  runSourceCommand(command, passthrough);
}

function runInstalledCommand(action, args) {
  if (action === "start" || action === "target:start") {
    run(process.execPath, [path.join(root, "bin", "promethee-pomodoro.cjs"), ...args]);
    return;
  }
  if (action === "test") {
    const target = `${process.platform}-${process.arch}`;
    const executable = process.platform === "win32" ? "promethee-input-bridge.exe" : "promethee-input-bridge";
    const required = [
      "dist/electron/main.js",
      "dist/electron/menu.js",
      "dist/electron/runtime-preload.cjs",
      `dist/native/${target}/${executable}`,
      "bin/promethee-pomodoro.cjs"
    ];
    const missing = required.filter((relativePath) => !existsSync(path.join(root, relativePath)));
    if (missing.length > 0) fail(`Installed package is incomplete: ${missing.join(", ")}`);
    process.stdout.write(`Installed Promethee Pomodoro payload is complete for ${target}.\n`);
    return;
  }
  if (action === "build") {
    process.stdout.write("Promethee Pomodoro is distributed as a prebuilt npm package; no local build is required.\n");
    return;
  }
  if (action === "prepublish") {
    fail("Republishing from an installed package is unsupported. Publish only from the reviewed source checkout.");
  }
  fail(`Development command '${action}' is available only from the source checkout.`);
}

function runSourceCommand(action, args) {
  switch (action) {
    case "build":
    case "target:build":
      buildNative();
      buildApplication();
      return;
    case "start":
    case "target:start":
      buildNative();
      buildApplication();
      run(require("electron"), [root, ...args]);
      return;
    case "test":
      runTests("core");
      runTests("integration");
      runTests("persistence");
      runTests("electron");
      return;
    case "prepublish":
    case "target:verify-release":
      run(process.execPath, [path.join(root, "scripts", "verify-release-package.mjs"), ...args]);
      return;
    case "target:build:app":
      buildApplication();
      return;
    case "target:build:native":
      buildNative();
      return;
    case "target:copy-resources":
      copyResources();
      return;
    case "target:typecheck":
      typecheck();
      return;
    case "target:test:core":
      runTests("core");
      return;
    case "target:test:integration":
      runTests("integration");
      return;
    case "target:test:persistence":
      runTests("persistence");
      return;
    case "target:test:electron":
      runTests("electron");
      return;
    default:
      fail(`Unknown package command '${action}'.`);
  }
}

function buildApplication() {
  typecheck();
  copyResources();
}

function buildNative() {
  run(process.execPath, [path.join(root, "scripts", "build-native-input-bridge.mjs")]);
}

function typecheck() {
  const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(compiler)) fail("TypeScript is not installed in this source checkout. Run npm ci before validation.");
  run(process.execPath, [compiler, "--build", "--pretty", "false"]);
}

function runTests(suite) {
  const directory = path.join(root, "Tests", suite);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
    .map((file) => path.join(directory, file));
  if (files.length === 0) fail(`No ${suite} tests were found.`);
  run(process.execPath, ["--experimental-strip-types", "--test", ...files]);
}

function copyResources() {
  for (const file of ["overlay.html", "overlay.css", "handle.html", "handle.css", "menu.html", "menu.css", "styles/tokens.css"]) {
    const source = path.join(root, "src", "electron", file);
    const target = path.join(root, "dist", "electron", file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.signal) fail(`Command terminated by ${result.signal}.`);
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
