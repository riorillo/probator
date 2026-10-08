import { readFileSync, readlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { once } from "node:events";
import { settle } from "../outcome.ts";

const MAC_PROFILES = [
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Google/Chrome Canary",
  "Library/Application Support/Comet",
  "Library/Application Support/Arc/User Data",
  "Library/Application Support/Dia/User Data",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Microsoft Edge Beta",
  "Library/Application Support/Microsoft Edge Dev",
  "Library/Application Support/Microsoft Edge Canary",
  "Library/Application Support/BraveSoftware/Brave-Browser",
  "Library/Application Support/BraveSoftware/Brave-Origin",
] as const;

const LINUX_PROFILES = [
  ".config/google-chrome",
  ".config/chromium",
  ".config/chromium-browser",
  ".config/microsoft-edge",
  ".config/microsoft-edge-beta",
  ".config/microsoft-edge-dev",
  ".var/app/org.chromium.Chromium/config/chromium",
  ".var/app/com.google.Chrome/config/google-chrome",
  ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser",
  ".var/app/com.microsoft.Edge/config/microsoft-edge",
] as const;

// Relative to %LOCALAPPDATA%; SxS is the Canary channel.
const WINDOWS_PROFILES = [
  "Google/Chrome/User Data",
  "Google/Chrome SxS/User Data",
  "Google/Chrome Beta/User Data",
  "Google/Chrome Dev/User Data",
  "Chromium/User Data",
  "Microsoft/Edge/User Data",
  "Microsoft/Edge Beta/User Data",
  "Microsoft/Edge Dev/User Data",
  "Microsoft/Edge SxS/User Data",
  "BraveSoftware/Brave-Browser/User Data",
] as const;

const WINDOWS_NAMES = ["chrome.exe", "msedge.exe", "chromium.exe", "brave.exe", "helium.exe"];
const LIVENESS_TIMEOUT_MS = 500;

export type PortRecord = { readonly port: string; readonly path: string };

export function list(): string[] {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return WINDOWS_PROFILES.map((name) => join(local, name));
  }
  if (process.platform === "darwin") return MAC_PROFILES.map((name) => join(homedir(), name));
  return LINUX_PROFILES.map((name) => join(homedir(), name));
}

export async function port(base: string): Promise<PortRecord | null> {
  const read = await settle(() => readFileSync(join(base, "DevToolsActivePort"), "utf8"));
  if (!read.ok) return null;
  const lines = read.value.split("\n");
  const value = (lines[0] ?? "").trim();
  if (!value) return null;
  return { port: value, path: (lines[1] ?? "").trim() };
}

/** True when something is listening on the profile's DevTools port. */
export async function live(base: string): Promise<boolean> {
  const record = await port(base);
  if (!record) return false;
  const value = Number.parseInt(record.port, 10);
  if (!Number.isInteger(value)) return false;
  return listening(value, LIVENESS_TIMEOUT_MS);
}

/** True when a running browser instance holds this user-data directory. */
export async function running(): Promise<boolean> {
  if (process.platform === "win32") return windowsRunning();
  for (const base of list()) {
    if (await profileRunning(base)) return true;
  }
  return false;
}

/**
 * Profile directories whose chrome://inspect "Allow remote debugging" toggle is on.
 * True only when a toggle-on profile also has a live DevTools port.
 */
export async function toggleOn(): Promise<string[]> {
  const flags = await Promise.all(list().map(async (base) => ({ base, enabled: await recorded(base) })));
  return flags.filter((flag) => flag.enabled === true).map((flag) => flag.base);
}

/** Null when no profile records the toggle at all. */
export async function userEnabled(): Promise<boolean | null> {
  const flags = await Promise.all(list().map(async (base) => ({ base, enabled: await recorded(base) })));
  for (const flag of flags) {
    if (flag.enabled === true && (await live(flag.base))) return true;
  }
  return flags.some((flag) => flag.enabled === false) ? false : null;
}

async function recorded(base: string): Promise<boolean | null> {
  const read = await settle(() => readFileSync(join(base, "Local State"), "utf8"));
  if (!read.ok) return null;
  const state = await settle(() => JSON.parse(read.value) as unknown);
  if (!state.ok) return null;
  const flag = toggleFlag(state.value);
  return typeof flag === "boolean" ? flag : null;
}

function toggleFlag(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return null;
  const devtools = (state as Record<string, unknown>).devtools;
  if (typeof devtools !== "object" || devtools === null) return null;
  const debugging = (devtools as Record<string, unknown>).remote_debugging;
  if (typeof debugging !== "object" || debugging === null) return null;
  return (debugging as Record<string, unknown>)["user-enabled"];
}

async function profileRunning(base: string): Promise<boolean> {
  const target = await settle(() => readlinkSync(join(base, "SingletonLock")));
  if (!target.ok) return false;
  const pid = Number.parseInt(target.value.split("-").at(-1) ?? "", 10);
  if (!Number.isInteger(pid)) return false;
  const alive = await settle(() => process.kill(pid, 0));
  if (alive.ok) return true;
  return !isMissing(alive.error);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ESRCH";
}

/** Chromium on Windows uses a named mutex instead of SingletonLock. */
async function windowsRunning(): Promise<boolean> {
  const listed = await settle(() => tasklist());
  if (!listed.ok) return true;
  const output = listed.value.toLowerCase();
  return WINDOWS_NAMES.some((name) => output.includes(name));
}

function tasklist(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tasklist", { timeout: 5_000 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}

async function listening(port: number, timeoutMs: number): Promise<boolean> {
  const connected = await settle(() => connect(port, timeoutMs));
  return connected.ok;
}

async function connect(port: number, timeoutMs: number): Promise<void> {
  const socket = new Socket();
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`Timed out after ${timeoutMs}ms`)));
  socket.connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.destroy();
}
