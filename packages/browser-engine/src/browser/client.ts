import { StalePage, messageOf } from "../errors.ts";
import { isRecord } from "../json.ts";
import { failed, ok, settle, type Outcome } from "../outcome.ts";

export const DOCUMENT_CHANGED = "The document changed while it was being read.";

/** How the browser reports a navigation that tore the page down under a call. */
const TEARDOWN = [
  "execution context was destroyed",
  "cannot find context with specified id",
  "inspected target navigated or closed",
  "unable to capture screenshot",
];

export type Caller = {
  call(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
};

export type ReadOptions = { readonly awaitPromise?: boolean };

export type Client = {
  readonly sessionId: string;
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Returns a failed outcome when the page changed mid-read, instead of throwing. */
  read(expression: string, options?: ReadOptions): Promise<Outcome<unknown>>;
  evaluate(expression: string, options?: ReadOptions): Promise<unknown>;
};

export function create(caller: Caller, sessionId: string): Client {
  const call = (method: string, params: Record<string, unknown> = {}) => caller.call(method, params, sessionId);

  async function read(expression: string, options: ReadOptions = {}): Promise<Outcome<unknown>> {
    const response = await settle(() => call("Runtime.evaluate", evaluation(expression, options)));
    if (!response.ok) return failed(navigated(response.error) ?? response.error);
    if (changed(response.value)) return failed(new StalePage(DOCUMENT_CHANGED));
    return ok(valueOf(response.value));
  }

  async function evaluate(expression: string, options: ReadOptions = {}): Promise<unknown> {
    const result = await read(expression, options);
    if (!result.ok) throw result.error;
    return result.value;
  }

  return { sessionId, call, read, evaluate };
}

function evaluation(expression: string, options: ReadOptions): Record<string, unknown> {
  const params: Record<string, unknown> = { expression, returnByValue: true };
  if (options.awaitPromise) params.awaitPromise = true;
  return params;
}

function changed(response: unknown): boolean {
  return isRecord(response) && Boolean(response.exceptionDetails);
}

/** The stale page a navigation reports, or nothing when the failure came from somewhere else. */
export function navigated(error: unknown): StalePage | null {
  const message = messageOf(error).toLowerCase();
  if (!TEARDOWN.some((fragment) => message.includes(fragment))) return null;
  return new StalePage(DOCUMENT_CHANGED);
}

function valueOf(response: unknown): unknown {
  if (!isRecord(response) || !isRecord(response.result)) return undefined;
  return response.result.value;
}
