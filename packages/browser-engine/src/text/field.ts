import { InputError } from "../errors.ts";
import * as http from "../http/client.ts";
import type { Http } from "../http/client.ts";
import { decode, encode, isRecord } from "../json.ts";
import { elapsed, now } from "../time.ts";
import * as url from "../url.ts";
import { TEXT_VALUE } from "./prompts.ts";
import * as settings from "./settings.ts";

const MISSING_CREDENTIAL = "TYPE_TEXT needs TEXT_MODEL_API_KEY: no text is defaulted or guessed.";
const ADDRESS_ERROR = "The text model address must be an absolute HTTP(S) URL without credentials.";
const INVALID_OUTPUT = "The text model returned no valid value: no text was typed.";
const TEXT_LIMIT = 2000;
const MAX_TOKENS = 1024;

export type Helper = { model: string; latency_ms: number; usage: unknown };
export type Written = { value: string; helper: Helper };
export type Options = settings.Settings & { readonly http?: Http };

/** Writes one field value from the goal: the only place text enters a page. */
export async function write(context: unknown, options: Options = {}): Promise<Written> {
  const key = settings.credential(options);
  if (!key) throw new InputError(MISSING_CREDENTIAL);
  const base = endpoint(settings.address(options));
  if (!url.absolute(base)) throw new InputError(ADDRESS_ERROR);
  const model = settings.identity(options);
  const started = now();
  const client = options.http ?? http;
  const answer = await client.post(`${base}/chat/completions`, key, payload(model, base, context));
  return {
    value: await readText(answer),
    helper: { model, latency_ms: elapsed(started), usage: usageOf(answer) },
  };
}

function payload(model: string, base: string, context: unknown): Record<string, unknown> {
  return {
    model,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    ...settings.reasoning(base),
    messages: [
      { role: "system", content: TEXT_VALUE },
      { role: "user", content: encode(context) },
    ],
  };
}

async function readText(answer: unknown): Promise<string> {
  const parsed = await decode(contentOf(answer));
  if (!parsed.ok) throw invalid();
  if (!isRecord(parsed.value)) throw invalid();
  const names = Object.keys(parsed.value);
  if (names.length !== 1 || names[0] !== "text") throw invalid();
  const value = parsed.value.text;
  if (typeof value !== "string") throw invalid();
  if (!value.trim() || value.length > TEXT_LIMIT) throw invalid();
  return value;
}

function contentOf(answer: unknown): string {
  if (!isRecord(answer)) throw invalid();
  if (!Array.isArray(answer.choices)) throw invalid();
  const [first] = answer.choices;
  if (!isRecord(first) || !isRecord(first.message)) throw invalid();
  if (typeof first.message.content !== "string") throw invalid();
  return first.message.content;
}

function usageOf(answer: unknown): unknown {
  if (!isRecord(answer)) return {};
  return answer.usage ?? {};
}

function invalid(): InputError {
  return new InputError(INVALID_OUTPUT);
}

/** A provider address is used without its trailing slashes so a path can be appended. */
function endpoint(base: string): string {
  return base.replace(/\/+$/, "");
}
