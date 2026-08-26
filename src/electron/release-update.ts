import { net, shell } from "electron";

const RELEASE_API = "https://api.github.com/repos/BRYANN2K/promethee-pomodoro/releases/latest";
const RELEASE_PAGE_PREFIX = "https://github.com/BRYANN2K/promethee-pomodoro/releases/";
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

export type UpdateCheckResult =
  | { readonly currentVersion: string; readonly status: "current" }
  | { readonly currentVersion: string; readonly latestVersion: string; readonly releaseUrl: string; readonly status: "update-available" }
  | { readonly currentVersion: string; readonly status: "unavailable" };

export async function checkForReleaseUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  const normalizedCurrent = parseVersion(currentVersion);
  if (normalizedCurrent === null) return Object.freeze({ currentVersion, status: "unavailable" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `promethee-pomodoro/${currentVersion}` },
      signal: controller.signal
    });
    if (!response.ok) return Object.freeze({ currentVersion, status: "unavailable" });
    const body = await readBoundedText(response, MAX_RESPONSE_BYTES);
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload) || typeof payload.tag_name !== "string" || typeof payload.html_url !== "string") {
      return Object.freeze({ currentVersion, status: "unavailable" });
    }
    const latest = parseVersion(payload.tag_name);
    if (latest === null || !payload.html_url.startsWith(RELEASE_PAGE_PREFIX)) {
      return Object.freeze({ currentVersion, status: "unavailable" });
    }
    if (compareVersion(latest, normalizedCurrent) <= 0) {
      return Object.freeze({ currentVersion, status: "current" });
    }
    return Object.freeze({
      currentVersion,
      latestVersion: latest.join("."),
      releaseUrl: payload.html_url,
      status: "update-available"
    });
  } catch {
    return Object.freeze({ currentVersion, status: "unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

export async function openReleasePage(url: unknown): Promise<boolean> {
  if (typeof url !== "string" || !url.startsWith(RELEASE_PAGE_PREFIX)) return false;
  await shell.openExternal(url, { activate: true });
  return true;
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) throw new Error("Missing response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytesRead += result.value.byteLength;
    if (bytesRead > maximumBytes) {
      await reader.cancel();
      throw new Error("Update response is too large.");
    }
    text += decoder.decode(result.value, { stream: true });
  }
  return text + decoder.decode();
}

function parseVersion(value: string): readonly [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (match === null) return null;
  const parts = match.slice(1).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function compareVersion(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
