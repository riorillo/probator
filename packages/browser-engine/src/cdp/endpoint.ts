import { RuntimeFailure } from "../errors.ts";
import { settle } from "../outcome.ts";
import { now } from "../time.ts";
import * as profiles from "./profiles.ts";

const VERSION_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_000;
const BUDGET_MS = 30_000;
const LIVENESS_MS = 2_000;
const POLL_MS = 200;
const RETRY_MS = 1_000;
const NO_TOGGLE_GRACE_MS = 3_000;
const TOGGLE_GRACE_MS = 12_000;
const PROBE_PORTS = [9222, 9223];

const PERMISSION_BLOCKED =
  "permission-blocked: Chrome is reachable, but the per-session Allow remote debugging popup has not been accepted";
const NOT_RUNNING = "chrome-not-running: no supported Chromium-family browser is running -- start Chrome, then retry";
const TOGGLE_OFF =
  'remote debugging is turned off for this browser instance — enable chrome://inspect/#remote-debugging ' +
  '(tick "Allow remote debugging for this browser instance")';

type Probe =
  | { readonly kind: "ok"; readonly endpoint: string }
  | { readonly kind: "forbidden" }
  | { readonly kind: "notFound" }
  | { readonly kind: "absent" };

/** Resolves the DevTools websocket endpoint, honouring explicit configuration first. */
export async function resolve(): Promise<string> {
  const socket = process.env.BU_CDP_WS;
  if (socket) return socket;
  const configured = process.env.BU_CDP_URL;
  if (configured) return fromUrl(configured);
  return fromLocal();
}

async function fromUrl(configured: string): Promise<string> {
  const base = configured.replace(/\/+$/, "");
  const deadline = now() + BUDGET_MS;
  let last = "no answer";
  while (now() < deadline) {
    const probe = await version(base, VERSION_TIMEOUT_MS);
    if (probe.kind === "ok") return probe.endpoint;
    if (probe.kind === "forbidden") throw new RuntimeFailure(PERMISSION_BLOCKED);
    if (probe.kind === "notFound") {
      const fallback = await fromActivePort(configured);
      if (fallback) return fallback;
    }
    last = probe.kind;
    await Bun.sleep(RETRY_MS);
  }
  throw new RuntimeFailure(`BU_CDP_URL=${configured} unreachable after 30s: ${last} -- ${launchHint()}`);
}

async function fromLocal(): Promise<string> {
  const started = now();
  const deadline = started + BUDGET_MS;
  let nextLiveness = 0;
  while (now() < deadline) {
    const found = await scan();
    if (found) return found;
    const instant = now();
    if (instant >= nextLiveness) {
      if (!(await profiles.running())) throw new RuntimeFailure(NOT_RUNNING);
      nextLiveness = instant + LIVENESS_MS;
    }
    const grace = (await profiles.toggleOn()).length > 0 ? TOGGLE_GRACE_MS : NO_TOGGLE_GRACE_MS;
    if (instant > started + grace) break;
    await Bun.sleep(POLL_MS);
  }
  const probed = await probePorts();
  if (probed) return probed;
  if ((await profiles.userEnabled()) === false) throw new RuntimeFailure(TOGGLE_OFF);
  throw new RuntimeFailure(
    `DevToolsActivePort not found in ${JSON.stringify(profiles.list())} — enable ` +
      "chrome://inspect/#remote-debugging, or set BU_CDP_WS for a remote browser",
  );
}

async function scan(): Promise<string | null> {
  for (const base of profiles.list()) {
    const record = await profiles.port(base);
    if (!record?.port) continue;
    const probe = await version(`http://127.0.0.1:${record.port}`, PROBE_TIMEOUT_MS);
    if (probe.kind === "ok") return probe.endpoint;
    if (probe.kind === "forbidden") throw new RuntimeFailure(PERMISSION_BLOCKED);
    if (probe.kind === "notFound" && record.path) return `ws://127.0.0.1:${record.port}${record.path}`;
  }
  return null;
}

async function probePorts(): Promise<string | null> {
  for (const port of PROBE_PORTS) {
    const probe = await version(`http://127.0.0.1:${port}`, PROBE_TIMEOUT_MS);
    if (probe.kind === "ok") return probe.endpoint;
    if (probe.kind === "forbidden") throw new RuntimeFailure(PERMISSION_BLOCKED);
  }
  return null;
}

async function version(base: string, timeoutMs: number): Promise<Probe> {
  const answered = await settle(() => fetch(`${base}/json/version`, { signal: AbortSignal.timeout(timeoutMs) }));
  if (!answered.ok) return { kind: "absent" };
  if (answered.value.status === 403) return { kind: "forbidden" };
  if (answered.value.status === 404) return { kind: "notFound" };
  if (answered.value.status >= 400) return { kind: "absent" };
  const body = await settle(() => answered.value.json() as Promise<unknown>);
  if (!body.ok) return { kind: "absent" };
  const endpoint = endpointOf(body.value);
  if (!endpoint) return { kind: "absent" };
  return { kind: "ok", endpoint };
}

function endpointOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>).webSocketDebuggerUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Chrome 147+ answers 404 on the default profile, but still writes the live path to disk. */
async function fromActivePort(url: string): Promise<string | null> {
  const parsed = await settle(() => Promise.resolve(new URL(url)));
  if (!parsed.ok) return null;
  const port = parsed.value.port;
  if (!port) return null;
  const hostname = parsed.value.hostname;
  const host = hostname.includes(":") ? `[${hostname}]` : hostname || "127.0.0.1";
  for (const base of profiles.list()) {
    const record = await profiles.port(base);
    if (!record?.path || record.port !== port) continue;
    return `ws://${host}:${record.port}${record.path}`;
  }
  return null;
}

function launchHint(): string {
  const hint =
    "is the dedicated automation Chrome running? Launch it with --remote-debugging-port=<port> " +
    "--user-data-dir=<dedicated dir>";
  if (process.platform === "win32") {
    return `${hint}; on Windows also check that a firewall/antivirus isn't blocking localhost connections`;
  }
  return hint;
}
