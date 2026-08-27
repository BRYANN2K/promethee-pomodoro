import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const parentDirectory = path.dirname(currentDirectory);
const nativeDirectory = path.basename(parentDirectory) === "src"
  ? path.join(path.dirname(parentDirectory), "dist", "native")
  : path.join(parentDirectory, "native");
const PROCESS_ID_TIMEOUT_MS = 500;
const PROCESS_ID_MAX_BUFFER_BYTES = 4 * 1024;
const PERMISSION_REQUEST_TIMEOUT_MS = 30_000;

export interface NativeBridgeExecutionRequest {
  readonly args: readonly string[];
  readonly executable: string;
  readonly maxBufferBytes: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export interface NativeBridgeExecutionResult {
  readonly stdout: string;
}

export type NativeBridgeExecutor = (
  request: NativeBridgeExecutionRequest
) => Promise<NativeBridgeExecutionResult>;

export interface NativeProcessLookupOptions {
  readonly arch?: NodeJS.Architecture;
  readonly executor?: NativeBridgeExecutor;
  readonly platform?: NodeJS.Platform;
  readonly signal?: AbortSignal;
}

export interface NativeAutomationPermissionStatus {
  readonly inputEvents: boolean;
  readonly screenCapture: boolean;
  readonly status: "denied" | "granted" | "unavailable";
  readonly supported: boolean;
}

export interface NativePermissionRequestOptions {
  readonly arch?: NodeJS.Architecture;
  readonly executor?: NativeBridgeExecutor;
  readonly platform?: NodeJS.Platform;
}

export function canArmNativeAutomation(
  automationAvailable: boolean,
  onboardingCompleted: boolean,
  permissions: NativeAutomationPermissionStatus
): boolean {
  return automationAvailable && onboardingCompleted && permissions.supported && permissions.status === "granted" &&
    permissions.inputEvents && permissions.screenCapture;
}

export function nativeAutomationPermissionStatus(
  inputEvents: boolean,
  screenCapture: boolean,
  supported: boolean
): NativeAutomationPermissionStatus {
  if (!supported) return unavailablePermissions(false);
  return Object.freeze({
    inputEvents,
    screenCapture,
    status: inputEvents && screenCapture ? "granted" as const : "denied" as const,
    supported: true
  });
}

export function effectiveNativeAutomationPermissionStatus(
  helperPermissions: NativeAutomationPermissionStatus,
  screenCaptureTransportAvailable: boolean
): NativeAutomationPermissionStatus {
  if (!helperPermissions.supported || helperPermissions.status === "unavailable") return unavailablePermissions(false);
  return nativeAutomationPermissionStatus(
    helperPermissions.inputEvents,
    helperPermissions.screenCapture && screenCaptureTransportAvailable,
    true
  );
}

export function requiresNativePermissionRecovery(
  automationAvailable: boolean,
  onboardingCompleted: boolean,
  permissions: NativeAutomationPermissionStatus,
  automationRequested: boolean
): boolean {
  if (!automationAvailable || !permissions.supported) return false;
  if (!permissions.screenCapture) return true;
  return onboardingCompleted && automationRequested && !permissions.inputEvents;
}

export function shouldRequestNativePermissionsAtStartup(
  automationAvailable: boolean,
  onboardingCompleted: boolean,
  permissions: NativeAutomationPermissionStatus,
  automationRequested: boolean
): boolean {
  if (!automationAvailable || !permissions.supported) return false;
  if (!permissions.screenCapture) return true;
  return !permissions.inputEvents && (!onboardingCompleted || automationRequested);
}

export function shouldRelaunchAfterScreenPermissionRequest(
  request: boolean,
  screenCaptureWasGranted: boolean,
  screenCaptureIsGranted: boolean
): boolean {
  return request && !screenCaptureWasGranted && screenCaptureIsGranted;
}

export function supportsAttachedRuntime(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

export function supportsNativeAutomation(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin" || platform === "linux";
}

// How long a press is given before the wait on it becomes a kill. macOS presses
// through an API that answers or refuses in one call, so the original bound is
// what it needs and it keeps it. Linux presses through a compositor it has to
// hold a conversation with, and the helper bounds that conversation at 1.2s and
// then owes itself another 0.5s to put the button back up and let go of the
// display. Killing it inside its own bound is what would leave a button held
// down on the user's session, so the wait here is set above the worst case the
// helper can spend rather than at the figure that reads best.
const NATIVE_CLICK_TIMEOUT_MS = 800;
const LINUX_NATIVE_CLICK_TIMEOUT_MS = 2_500;

export function nativeClickTimeoutMs(platform: NodeJS.Platform = process.platform): number {
  return platform === "linux" ? LINUX_NATIVE_CLICK_TIMEOUT_MS : NATIVE_CLICK_TIMEOUT_MS;
}

// Where the consent for automation actually lives, which is not the same on both
// platforms and is the difference the user has to be told about. On macOS the
// system asks, records the answer, and keeps a pane to take it back through, so
// the app's own switches sit on top of a grant the user can always revoke
// elsewhere. On Linux nothing asks: the protocols that read the HUD and move the
// pointer are open to any client that can reach the display, so there is no
// prompt to see, no pane to open, and no revocation outside this app. The
// switches are the whole of the consent there. Copy that points a Linux user at
// system settings is pointing at something they do not have, and copy that
// implies a grant they could withdraw is describing macOS.
export type NativeAutomationConsentModel = "session" | "system";

export function nativeAutomationConsentModel(
  platform: NodeJS.Platform = process.platform
): NativeAutomationConsentModel {
  return platform === "darwin" ? "system" : "session";
}

// macOS always has a mechanism to ask, so a permission nobody has read yet is
// safely taken to be withheld: the worst that assumption costs is one prompt.
// Linux may have no mechanism at all, and there the same assumption is not
// pessimism but a claim, that something is present and refused the app. It puts
// the recovery UI in front of a session with nothing to recover and no setting
// to go and change. So on a platform where the mechanism is not assured, every
// answer the app could not read leaves the feature unavailable rather than
// denied, and only the probe itself can report a refusal.
export function nativeAutomationMechanismIsAssured(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "darwin";
}

export function nativeBridgeExecutable(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string | null {
  const supported = (platform === "darwin" && (arch === "arm64" || arch === "x64")) ||
    (platform === "linux" && arch === "x64") ||
    (platform === "win32" && arch === "x64");
  if (!supported) return null;
  const targetDirectory = path.join(nativeDirectory, `${platform}-${arch}`);
  if (platform === "darwin" || platform === "linux") return path.join(targetDirectory, "promethee-input-bridge");
  if (platform === "win32") return path.join(targetDirectory, "promethee-input-bridge.exe");
  return null;
}

export function parseNativeProcessId(output: unknown): number | null {
  if (typeof output !== "string") return null;
  const normalized = output.trim();
  if (!/^\d{1,10}$/.test(normalized)) return null;
  const processId = Number(normalized);
  return Number.isSafeInteger(processId) && processId > 0 && processId <= 0xffff_ffff ? processId : null;
}

export async function readNativePrometheeProcessId(
  options: NativeProcessLookupOptions = {}
): Promise<number | null> {
  const executable = nativeBridgeExecutable(options.platform, options.arch);
  if (executable === null) return null;
  try {
    const { stdout } = await (options.executor ?? executeNativeBridge)({
      args: Object.freeze(["pid"]),
      executable,
      maxBufferBytes: PROCESS_ID_MAX_BUFFER_BYTES,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeoutMs: PROCESS_ID_TIMEOUT_MS
    });
    return parseNativeProcessId(stdout);
  } catch {
    return null;
  }
}

export async function requestNativeAutomationPermissions(
  options: NativePermissionRequestOptions = {}
): Promise<NativeAutomationPermissionStatus> {
  return loadNativeAutomationPermissions("permissions", options);
}

export async function readNativeAutomationPermissions(
  options: NativePermissionRequestOptions = {}
): Promise<NativeAutomationPermissionStatus> {
  return loadNativeAutomationPermissions("permission-status", options);
}

async function loadNativeAutomationPermissions(
  command: "permission-status" | "permissions",
  options: NativePermissionRequestOptions
): Promise<NativeAutomationPermissionStatus> {
  const platform = options.platform ?? process.platform;
  if (!supportsNativeAutomation(platform)) return unavailablePermissions(false);
  const unreadable = unavailablePermissions(nativeAutomationMechanismIsAssured(platform));
  const executable = nativeBridgeExecutable(platform, options.arch);
  if (executable === null) return unreadable;
  try {
    const { stdout } = await (options.executor ?? executeNativeBridge)({
      args: Object.freeze([command]),
      executable,
      maxBufferBytes: PROCESS_ID_MAX_BUFFER_BYTES,
      timeoutMs: PERMISSION_REQUEST_TIMEOUT_MS
    });
    const receipt = stdout.trim();
    // The helper says this when the session has no mechanism to ask, which is a
    // thing only Linux can be. It is not a denial, and it is the one refusal
    // there is no point taking the user to their system settings over.
    if (receipt === "automation-unsupported") return unavailablePermissions(false);
    const match = /^permissions,([01]),([01])$/.exec(receipt);
    if (match === null) return unreadable;
    const inputEvents = match[1] === "1";
    const screenCapture = match[2] === "1";
    return nativeAutomationPermissionStatus(inputEvents, screenCapture, true);
  } catch {
    return unreadable;
  }
}

function unavailablePermissions(supported: boolean): NativeAutomationPermissionStatus {
  return Object.freeze({ inputEvents: false, screenCapture: false, status: "unavailable", supported });
}

export function executeNativeBridge(
  request: NativeBridgeExecutionRequest
): Promise<NativeBridgeExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(
      request.executable,
      [...request.args],
      {
        encoding: "utf8",
        maxBuffer: request.maxBufferBytes,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        timeout: request.timeoutMs,
        windowsHide: true
      },
      (error, stdout) => {
        const completeNativeFailure = error !== null &&
          typeof error.code === "number" &&
          error.killed !== true &&
          error.signal == null &&
          stdout.length > 0 &&
          stdout.endsWith("\n");
        if (error === null || completeNativeFailure) {
          resolve(Object.freeze({ stdout }));
        } else {
          reject(error);
        }
      }
    );
  });
}
