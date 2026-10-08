import { RuntimeFailure, messageOf } from "../errors.ts";
import { decode, encode, isRecord } from "../json.ts";
import { settle } from "../outcome.ts";

export type Transport = {
  readonly endpoint: string;
  call(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  drain(): unknown[];
  subscribe(listener: (event: unknown) => void): () => void;
  close(): void;
};

type Pending = {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
};

const BUFFER_LIMIT = 500;

/** Opens the DevTools socket and multiplexes JSON-RPC calls over it. */
export async function open(endpoint: string): Promise<Transport> {
  const connected = await settle(() => connect(endpoint));
  if (!connected.ok) throw new RuntimeFailure(`Could not connect to ${endpoint}: ${messageOf(connected.error)}`);
  return connected.value;
}

function connect(endpoint: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    socket.addEventListener("open", () => resolve(attach(socket, endpoint)), { once: true });
    socket.addEventListener("close", () => reject(unreachable(endpoint)), { once: true });
    socket.addEventListener("error", () => reject(unreachable(endpoint)), { once: true });
  });
}

function unreachable(endpoint: string): RuntimeFailure {
  return new RuntimeFailure(`Could not connect to ${endpoint}.`);
}

function attach(socket: WebSocket, endpoint: string): Transport {
  const outstanding = new Map<number, Pending>();
  const events: unknown[] = [];
  const listeners = new Set<(event: unknown) => void>();
  let counter = 1;

  function buffer(message: unknown): void {
    if (events.length >= BUFFER_LIMIT) events.shift();
    events.push(message);
  }

  function fail(reason: RuntimeFailure): void {
    for (const pending of outstanding.values()) pending.reject(reason);
    outstanding.clear();
  }

  function deliver(message: Record<string, unknown>): void {
    const id = message.id;
    if (typeof id !== "number") {
      for (const listener of listeners) listener(message);
      return buffer(message);
    }
    const pending = outstanding.get(id);
    if (!pending) return buffer(message);
    outstanding.delete(id);
    if (isRecord(message.error)) {
      const detail = message.error.message ?? "unknown error";
      pending.reject(new RuntimeFailure(`${pending.method} failed: ${String(detail)}`));
      return;
    }
    pending.resolve(message.result);
  }

  async function receive(payload: unknown): Promise<void> {
    const decoded = await decode(asText(payload));
    if (!decoded.ok || !isRecord(decoded.value)) return;
    deliver(decoded.value);
  }

  socket.addEventListener("message", (message: MessageEvent) => void receive(message.data));
  socket.addEventListener("close", () => fail(new RuntimeFailure(`The browser connection to ${endpoint} closed.`)));

  async function call(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (socket.readyState !== WebSocket.OPEN) throw closed(endpoint);
    const id = counter;
    counter += 1;
    const message: Record<string, unknown> = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    const answer = new Promise((resolve, reject) => outstanding.set(id, { method, resolve, reject }));
    socket.send(encode(message));
    return answer;
  }

  return {
    endpoint,
    call,
    drain: () => events.splice(0),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    close: () => { listeners.clear(); socket.close(); },
  };
}

function closed(endpoint: string): RuntimeFailure {
  return new RuntimeFailure(`The browser connection to ${endpoint} is not open.`);
}

function asText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
  if (payload instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload));
  return "";
}
