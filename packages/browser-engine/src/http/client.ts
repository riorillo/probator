import { InputError, RuntimeFailure } from "../errors.ts";
import { decode, encode, isRecord } from "../json.ts";
import { settle } from "../outcome.ts";

export type Http = {
  post(url: string, key: string, body: unknown): Promise<unknown>;
};

const ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 529, 503]);
const RETRY_BASE_MS = 500;
const TIMEOUT_MS = 25_000;
const DETAIL_LIMIT = 300;
const NO_ACTION = "no action was executed.";

/** POSTs JSON, retries transient provider statuses, and unwraps the answer envelope. */
export async function post(url: string, key: string, body: unknown): Promise<unknown> {
  return attempt(url, key, body, 0);
}

/** Unwraps Workers AI's result envelope and surfaces provider errors. */
export function unwrap(answer: unknown): unknown {
  if (!isRecord(answer)) return answer;
  if (answer.success === false) throw new RuntimeFailure(providerError(answer));
  if (!("answers" in answer) && isRecord(answer.result)) return answer.result;
  return answer;
}

async function attempt(url: string, key: string, body: unknown, index: number): Promise<unknown> {
  const answered = await settle(() => send(url, key, body));
  if (!answered.ok) throw new RuntimeFailure(`Could not reach the model provider; ${NO_ACTION}`);
  return respond(answered.value, url, key, body, index);
}

async function respond(
  response: Response,
  url: string,
  key: string,
  body: unknown,
  index: number,
): Promise<unknown> {
  if (RETRY_STATUSES.has(response.status) && index < ATTEMPTS - 1) {
    await Bun.sleep(RETRY_BASE_MS * 2 ** index);
    return attempt(url, key, body, index + 1);
  }
  if (response.status >= 400) throw new RuntimeFailure(httpError(response.status, await detail(response)));
  return unwrap(await parse(response));
}

async function send(url: string, key: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function parse(response: Response): Promise<unknown> {
  const body = await settle(() => response.text());
  if (!body.ok) throw invalidBody();
  const parsed = await decode(body.value);
  if (!parsed.ok) throw invalidBody();
  return parsed.value;
}

function invalidBody(): InputError {
  return new InputError("The model provider answered with a body that is not valid JSON.");
}

async function detail(response: Response): Promise<string> {
  const text = await settle(() => response.text());
  if (!text.ok) return "";
  return text.value.slice(0, DETAIL_LIMIT);
}

function httpError(status: number, text: string): string {
  return `The model provider answered HTTP ${status}: ${text}; ${NO_ACTION}`;
}

function providerError(answer: Record<string, unknown>): string {
  return `The model provider reported an error: ${encodeDetail(pickDetail(answer))}; ${NO_ACTION}`;
}

function encodeDetail(value: unknown): string {
  return encode(value).slice(0, DETAIL_LIMIT);
}

function pickDetail(answer: Record<string, unknown>): unknown {
  if (present(answer.errors)) return answer.errors;
  if (present(answer.messages)) return answer.messages;
  return "no details";
}

function present(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
