"use strict";

function parseCliOptions(argv) {
  const argumentsList = Array.isArray(argv) ? argv : [];
  return Object.freeze({
    foreground: argumentsList.includes("--foreground"),
    installOnly: argumentsList.includes("--install-only"),
    smokeTest: argumentsList.includes("--smoke-test"),
    version: argumentsList.includes("--version")
  });
}

function resolveLaunchMode(platform, options) {
  if (options.smokeTest && options.installOnly) {
    throw new Error("--smoke-test cannot be combined with --install-only.");
  }
  if (options.smokeTest) return "smoke-test";
  if (platform === "darwin") return "macos-application";
  return "direct-electron";
}

function smokeTestEnvironment(environment) {
  return {
    ...environment,
    PROMETHEE_POMODORO_DISABLE_AUTOMATION: "1",
    PROMETHEE_POMODORO_SMOKE_TEST: "1"
  };
}

function macInstallRoot(environment) {
  const configuredRoot = environment?.PROMETHEE_POMODORO_INSTALL_DIR;
  if (typeof configuredRoot !== "string") return undefined;
  const trimmedRoot = configuredRoot.trim();
  return trimmedRoot.length > 0 ? trimmedRoot : undefined;
}

module.exports = { macInstallRoot, parseCliOptions, resolveLaunchMode, smokeTestEnvironment };
