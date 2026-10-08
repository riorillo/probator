import { RuntimeFailure, StalePage } from "../errors.ts";
import { isRecord } from "../json.ts";
import { create, type Caller, type Client } from "./client.ts";
import { LINKS } from "./scripts.ts";
import type { Action } from "./types.ts";

export const VIEWPORT = { width: 1120, height: 780 } as const;
const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 20;

export type Session = {
  readonly caller: Caller;
  readonly client: Client;
  targetId: string | null;
  afterInput: Action | null;
};

export type OpenOptions = {
  readonly width?: number;
  readonly height?: number;
  readonly readyTimeoutMs?: number;
  readonly recordingScript?: string;
};

/**
 * Owns one background tab. Focus emulation keeps rAF and menus running in that tab
 * without activating the user's Chrome window.
 */
export async function open(caller: Caller, url: string, options: OpenOptions = {}): Promise<Session> {
  const created = await caller.call("Target.createTarget", { url: "about:blank", background: true });
  const targetId = required(created, "targetId");
  const attached = await caller.call("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = required(attached, "sessionId");
  const session: Session = { caller, client: create(caller, sessionId), targetId, afterInput: null };
  await session.client.call("Emulation.setDeviceMetricsOverride", {
    width: options.width ?? VIEWPORT.width,
    height: options.height ?? VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.client.call("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (options.recordingScript) {
    await session.client.call("Runtime.enable");
    await session.client.call("Runtime.addBinding", { name: "__probatorRecordEvent" });
  }
  // A click that opened a second tab would navigate a tab the harness never watches.
  await session.client.call("Page.addScriptToEvaluateOnNewDocument", { source: LINKS });
  if (options.recordingScript) {
    await session.client.call("Page.addScriptToEvaluateOnNewDocument", { source: options.recordingScript });
  }
  await session.client.call("Page.navigate", { url });
  await ready(session.client, options.readyTimeoutMs ?? READY_TIMEOUT_MS);
  return session;
}

export async function close(session: Session): Promise<void> {
  if (!session.targetId) return;
  const targetId = session.targetId;
  session.targetId = null;
  await session.caller.call("Target.closeTarget", { targetId });
}

async function ready(client: Client, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loaded = await client.read("document.readyState");
    if (loaded.ok && loaded.value === "complete") return;
    if (!loaded.ok && !(loaded.error instanceof StalePage)) throw loaded.error;
    await Bun.sleep(POLL_MS);
  }
}

function required(payload: unknown, field: string): string {
  if (isRecord(payload) && typeof payload[field] === "string") return payload[field] as string;
  throw new RuntimeFailure(`The browser did not provide ${field}.`);
}
