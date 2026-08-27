import assert from "node:assert/strict";
import test from "node:test";

import {
  canArmNativeAutomation,
  effectiveNativeAutomationPermissionStatus,
  executeNativeBridge,
  nativeAutomationMechanismIsAssured,
  nativeBridgeExecutable,
  nativeAutomationPermissionStatus,
  parseNativeProcessId,
  readNativeAutomationPermissions,
  readNativePrometheeProcessId,
  requestNativeAutomationPermissions,
  requiresNativePermissionRecovery,
  shouldRequestNativePermissionsAtStartup,
  shouldRelaunchAfterScreenPermissionRequest,
  supportsAttachedRuntime,
  supportsNativeAutomation,
  type NativeBridgeExecutionRequest
} from "../../src/electron/native-promethee-bridge.ts";

test("arms native automation only after both OS grants and persisted onboarding consent", () => {
  const granted = { inputEvents: true, screenCapture: true, status: "granted" as const, supported: true };
  assert.equal(canArmNativeAutomation(true, true, granted), true);
  assert.equal(canArmNativeAutomation(true, false, granted), false);
  assert.equal(canArmNativeAutomation(false, true, granted), false);
  assert.equal(canArmNativeAutomation(true, true, { ...granted, inputEvents: false, status: "denied" }), false);
  assert.equal(canArmNativeAutomation(true, true, { ...granted, screenCapture: false, status: "denied" }), false);
});

test("derives renderer permission checks from the native automation actor grants", () => {
  assert.deepEqual(nativeAutomationPermissionStatus(true, true, true), {
    inputEvents: true,
    screenCapture: true,
    status: "granted",
    supported: true
  });
  assert.deepEqual(nativeAutomationPermissionStatus(true, false, true), {
    inputEvents: true,
    screenCapture: false,
    status: "denied",
    supported: true
  });
  assert.deepEqual(nativeAutomationPermissionStatus(true, true, false), {
    inputEvents: false,
    screenCapture: false,
    status: "unavailable",
    supported: false
  });
});

test("requests one relaunch only when an explicit request newly grants screen capture", () => {
  assert.equal(shouldRelaunchAfterScreenPermissionRequest(true, false, true), true);
  assert.equal(shouldRelaunchAfterScreenPermissionRequest(false, false, true), false);
  assert.equal(shouldRelaunchAfterScreenPermissionRequest(true, true, true), false);
  assert.equal(shouldRelaunchAfterScreenPermissionRequest(true, false, false), false);
});

test("fails screen permission closed when the real capture transport cannot read pixels", () => {
  const helperGranted = nativeAutomationPermissionStatus(true, true, true);
  assert.deepEqual(effectiveNativeAutomationPermissionStatus(helperGranted, false), {
    inputEvents: true,
    screenCapture: false,
    status: "denied",
    supported: true
  });
  assert.deepEqual(effectiveNativeAutomationPermissionStatus(helperGranted, true), helperGranted);
});

test("keeps screen-only passive mode attached after onboarding", () => {
  const screenOnly = nativeAutomationPermissionStatus(false, true, true);
  assert.equal(requiresNativePermissionRecovery(true, true, screenOnly, false), false);
  assert.equal(requiresNativePermissionRecovery(true, true, screenOnly, true), true);
  assert.equal(requiresNativePermissionRecovery(true, true, nativeAutomationPermissionStatus(false, false, true), false), true);
});

test("requires timer-control recovery when passive mode turns automation back on", () => {
  const screenOnly = nativeAutomationPermissionStatus(false, true, true);
  const recoveryBeforeEnable = requiresNativePermissionRecovery(true, true, screenOnly, false);
  const recoveryAfterEnable = requiresNativePermissionRecovery(true, true, screenOnly, true);
  const recoveryAfterDisable = requiresNativePermissionRecovery(true, true, screenOnly, false);
  assert.deepEqual([recoveryBeforeEnable, recoveryAfterEnable, recoveryAfterDisable], [false, true, false]);
});

test("registers missing grants once at startup without re-prompting passive screen-only mode", () => {
  const missing = nativeAutomationPermissionStatus(false, false, true);
  const screenOnly = nativeAutomationPermissionStatus(false, true, true);
  assert.equal(shouldRequestNativePermissionsAtStartup(true, false, missing, true), true);
  assert.equal(shouldRequestNativePermissionsAtStartup(true, false, screenOnly, true), true);
  assert.equal(shouldRequestNativePermissionsAtStartup(true, true, screenOnly, false), false);
  assert.equal(shouldRequestNativePermissionsAtStartup(true, true, screenOnly, true), true);
  assert.equal(shouldRequestNativePermissionsAtStartup(false, false, missing, true), false);
});

test("declares Windows as an attached passive runtime and Linux as one that can act", () => {
  assert.equal(supportsAttachedRuntime("darwin"), true);
  assert.equal(supportsAttachedRuntime("win32"), true);
  assert.equal(supportsAttachedRuntime("linux"), true);
  assert.equal(supportsAttachedRuntime("freebsd"), false);
  assert.equal(supportsNativeAutomation("darwin"), true);
  assert.equal(supportsNativeAutomation("linux"), true);
  assert.equal(supportsNativeAutomation("win32"), false);

  // Saying Linux can act is not saying any given Linux session will. Whether a
  // mechanism is there at all is a question only the session can answer, so the
  // app never assumes one is present and refusing while nobody has looked.
  assert.equal(nativeAutomationMechanismIsAssured("darwin"), true);
  assert.equal(nativeAutomationMechanismIsAssured("linux"), false);
  assert.equal(nativeAutomationMechanismIsAssured("win32"), false);
});

test("resolves the platform-specific native helper", () => {
  assert.match(nativeBridgeExecutable("darwin", "arm64") ?? "", /dist\/native\/darwin-arm64\/promethee-input-bridge$/);
  assert.match(nativeBridgeExecutable("darwin", "x64") ?? "", /dist\/native\/darwin-x64\/promethee-input-bridge$/);
  assert.match(nativeBridgeExecutable("linux", "x64") ?? "", /dist\/native\/linux-x64\/promethee-input-bridge$/);
  assert.match(nativeBridgeExecutable("win32", "x64") ?? "", /dist\/native\/win32-x64\/promethee-input-bridge\.exe$/);
  assert.equal(nativeBridgeExecutable("win32", "arm64"), null);
  assert.equal(nativeBridgeExecutable("linux", "arm64"), null);
  assert.equal(nativeBridgeExecutable("freebsd", "x64"), null);
});

test("parses only one bounded positive native process identifier", () => {
  assert.equal(parseNativeProcessId("42\n"), 42);
  assert.equal(parseNativeProcessId("4294967295\n"), 4_294_967_295);
  for (const invalid of [null, "", "0\n", "-1\n", "4294967296\n", "1\n2\n", "process-not-found\n"]) {
    assert.equal(parseNativeProcessId(invalid), null);
  }
});

test("performs a bounded Windows PID lookup through an injected executor", async () => {
  let observed: NativeBridgeExecutionRequest | null = null;
  const processId = await readNativePrometheeProcessId({
    arch: "x64",
    executor: async (request) => {
      observed = request;
      return Object.freeze({ stdout: "31415\n" });
    },
    platform: "win32"
  });

  assert.equal(processId, 31_415);
  assert.deepEqual(observed?.args, ["pid"]);
  assert.match(observed?.executable ?? "", /promethee-input-bridge\.exe$/);
  assert.equal(observed?.maxBufferBytes, 4 * 1024);
  assert.equal(observed?.timeoutMs, 500);
});

test("treats malformed PID output and executor failure as unavailable", async () => {
  assert.equal(await readNativePrometheeProcessId({
    arch: "x64",
    executor: async () => Object.freeze({ stdout: "process-ambiguous\n" }),
    platform: "win32"
  }), null);
  assert.equal(await readNativePrometheeProcessId({
    arch: "x64",
    executor: async () => Promise.reject(new Error("unavailable")),
    platform: "win32"
  }), null);
});

test("requests macOS automation permissions once through the bounded native helper", async () => {
  let observed: NativeBridgeExecutionRequest | null = null;
  const status = await requestNativeAutomationPermissions({
    arch: "arm64",
    executor: async (request) => {
      observed = request;
      return Object.freeze({ stdout: "permissions,1,1\n" });
    },
    platform: "darwin"
  });

  assert.deepEqual(status, { inputEvents: true, screenCapture: true, status: "granted", supported: true });
  assert.deepEqual(observed?.args, ["permissions"]);
  assert.equal(observed?.maxBufferBytes, 4 * 1024);
  assert.equal(observed?.timeoutMs, 30_000);
});

test("preflights macOS automation permissions without entering the request command", async () => {
  let observed: NativeBridgeExecutionRequest | null = null;
  const status = await readNativeAutomationPermissions({
    arch: "arm64",
    executor: async (request) => {
      observed = request;
      return Object.freeze({ stdout: "permissions,0,1\n" });
    },
    platform: "darwin"
  });
  assert.deepEqual(status, { inputEvents: false, screenCapture: true, status: "denied", supported: true });
  assert.deepEqual(observed?.args, ["permission-status"]);
});

test("permission bootstrap exposes each macOS grant and fails closed on malformed output", async () => {
  assert.deepEqual(await requestNativeAutomationPermissions({ platform: "win32" }), {
    inputEvents: false,
    screenCapture: false,
    status: "unavailable",
    supported: false
  });
  assert.deepEqual(await requestNativeAutomationPermissions({
    arch: "arm64",
    executor: async () => Object.freeze({ stdout: "permissions,1,0\n" }),
    platform: "darwin"
  }), { inputEvents: true, screenCapture: false, status: "denied", supported: true });
  assert.deepEqual(await requestNativeAutomationPermissions({
    arch: "arm64",
    executor: async () => Object.freeze({ stdout: "unexpected\n" }),
    platform: "darwin"
  }), { inputEvents: false, screenCapture: false, status: "unavailable", supported: true });
});

test("reads a Linux session that has no mechanism as unavailable rather than refused", async () => {
  const unavailable = { inputEvents: false, screenCapture: false, status: "unavailable", supported: false };

  // The helper's own word for a session that offers no slot to ask. There is no
  // system setting behind this and no prompt to raise, so the app must not put
  // the permission recovery UI in front of it.
  assert.deepEqual(await readNativeAutomationPermissions({
    arch: "x64",
    executor: async () => Object.freeze({ stdout: "automation-unsupported\n" }),
    platform: "linux"
  }), unavailable);

  // Anything the app could not read means the same thing there, for the same
  // reason: on a platform that may have no mechanism, an unreadable answer is
  // not evidence that one is present and said no. A helper that will not run at
  // all is the ordinary way this happens, Linux being a source checkout.
  assert.deepEqual(await readNativeAutomationPermissions({
    arch: "x64",
    executor: async () => Object.freeze({ stdout: "garbage\n" }),
    platform: "linux"
  }), unavailable);
  assert.deepEqual(await readNativeAutomationPermissions({
    arch: "x64",
    executor: async () => { throw new Error("ENOENT"); },
    platform: "linux"
  }), unavailable);

  // macOS keeps the opposite reading of the same two cases, because there the
  // mechanism is certainly present and only its answer went missing.
  assert.deepEqual(await readNativeAutomationPermissions({
    arch: "arm64",
    executor: async () => { throw new Error("ENOENT"); },
    platform: "darwin"
  }), { ...unavailable, supported: true });

  // A slot that is present and says no is still a denial on Linux, and the two
  // probes still answer independently: capture may work where injection does
  // not, and the app is told exactly that rather than all or nothing.
  assert.deepEqual(await readNativeAutomationPermissions({
    arch: "x64",
    executor: async () => Object.freeze({ stdout: "permissions,0,1\n" }),
    platform: "linux"
  }), { inputEvents: false, screenCapture: true, status: "denied", supported: true });
});

test("accepts a complete structured native failure but rejects partial output", async () => {
  const complete = await executeNativeBridge({
    args: ["-e", "process.stdout.write('process-not-found\\n'); process.exit(2)"],
    executable: process.execPath,
    maxBufferBytes: 1024,
    timeoutMs: 1_000
  });
  assert.equal(complete.stdout, "process-not-found\n");

  await assert.rejects(executeNativeBridge({
    args: ["-e", "process.stdout.write('partial'); process.exit(2)"],
    executable: process.execPath,
    maxBufferBytes: 1024,
    timeoutMs: 1_000
  }));
});
