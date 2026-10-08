import { resolve } from "../cdp/endpoint.ts";
import { open as openTransport, type Transport } from "../cdp/transport.ts";
import { act as runAction } from "./execute.ts";
import { check as checkFreshness } from "./fresh.ts";
import { observe as readObservation } from "./read.ts";
import { close as closeSession, open as openSession, type OpenOptions, type Session } from "./session.ts";
import type { Action, BrowserPort } from "./types.ts";

export type ConnectOptions = OpenOptions & {
  /** Sends the snapshot to the model as a frame with the numbered boxes of the elements. */
  readonly vision?: boolean;
  /** Leaves the tab behind for inspection, closing only the socket, when it leaves a `using` block. */
  readonly keepOpen?: boolean;
};

export type Connection = {
  readonly port: BrowserPort;
  readonly session: Session;
  readonly transport: Transport;
  /** Closes the tab and the socket, or only the socket when the connection was opened to be kept. */
  [Symbol.asyncDispose](): Promise<void>;
};

/** Resolves the browser endpoint, opens one background tab and binds it as a port. */
export async function connect(url: string, options: ConnectOptions = {}): Promise<Connection> {
  const endpoint = await resolve();
  const transport = await openTransport(endpoint);
  const pendingEvents: unknown[] = [];
  const unsubscribePending = transport.subscribe((event) => {
    if (!event || typeof event !== "object") return;
    const message = event as { method?: string; params?: { name?: string } };
    if (message.method === "Runtime.bindingCalled" && message.params?.name === "__probatorRecordEvent") pendingEvents.push(event);
  });
  let session: Session;
  try {
    session = await openSession(transport, url, options);
  } catch (error) {
    unsubscribePending();
    transport.close();
    throw error;
  }
  const port = bind(session, transport, options.vision, pendingEvents, unsubscribePending);
  return {
    port,
    session,
    transport,
    [Symbol.asyncDispose]: async () => {
      if (options.keepOpen) {
        transport.close();
        return;
      }
      await port.close();
    },
  };
}

export function bind(session: Session, transport?: Transport, vision = false, pendingEvents: unknown[] = [], unsubscribePending?: () => void): BrowserPort {
  const recordingEvents: unknown[] = [];
  const capture = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const event = message as { method?: string; sessionId?: string; params?: { name?: string; payload?: string } };
    if (event.method !== "Runtime.bindingCalled" || event.sessionId !== session.client.sessionId || event.params?.name !== "__probatorRecordEvent" || typeof event.params.payload !== "string") return;
    try { recordingEvents.push(JSON.parse(event.params.payload)); } catch { /* Ignore malformed browser recorder events. */ }
  };
  pendingEvents.forEach(capture);
  pendingEvents.length = 0;
  unsubscribePending?.();
  const unsubscribe = transport?.subscribe(capture);
  return {
    observe: (screenshot) =>
      readObservation(session.client, { screenshot, vision, afterInput: consume(session) }),
    fresh: (page, action) => checkFreshness(session.client, page, action),
    act: (action, page, text) => runAction(session, action, page, text ?? null),
    drainRecordingEvents: async () => recordingEvents.splice(0),
    captureScreenshot: async () => {
      try {
        const response = await session.client.call("Page.captureScreenshot", { format: "jpeg", quality: 72, captureBeyondViewport: false });
        if (response && typeof response === "object" && "data" in response && typeof response.data === "string") return response.data;
        return null;
      } catch { return null; }
    },
    close: async () => {
      unsubscribe?.();
      await closeSession(session);
      if (transport) await transport.close();
    },
  };
}

function consume(session: Session): Action | null {
  const pending = session.afterInput;
  session.afterInput = null;
  return pending;
}
