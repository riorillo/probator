import type { Action, Page } from "../browser/types.ts";
import { InputError } from "../errors.ts";
import type { Entry } from "../history.ts";
import * as http from "../http/client.ts";
import type { Http } from "../http/client.ts";
import { decode, encode, isRecord } from "../json.ts";
import * as elements from "../policy/elements.ts";
import type { Space } from "../policy/elements.ts";
import { DONE } from "../policy/operations.ts";
import * as questions from "../policy/questions.ts";
import type { Choice } from "../policy/types.ts";
import { elapsed, now } from "../time.ts";
import * as url from "../url.ts";
import { GAVE_UP, HEAL } from "./prompts.ts";
import * as settings from "./settings.ts";

const MISSING_CREDENTIAL = "Healing needs HEAL_MODEL_API_KEY: a stuck run is blocked without one.";
const ADDRESS_ERROR = "The heal model address must be an absolute HTTP(S) URL without credentials.";
const INVALID_OUTPUT = "The heal model returned no usable move: the run keeps its own choice.";
const UNKNOWN_TARGET = "The heal model chose a target that is not on the page: the run keeps its own choice.";
const TEXT_LIMIT = 6000;
const REASON_LIMIT = 400;
const MAX_TOKENS = 1024;
const RECENT_FIELDS = ["step", "action", "kind", "operation", "target", "page_changed"] as const;

/** The kind of a run the driving model gave up on: there is no loop to show, only the ending it chose. */
export const ENDING = "blocked";

/** What a run reports as going nowhere: the loop it repeats, or the ending its model gave up with. */
export type Stuck = { readonly kind: string; readonly steps: readonly Entry[] };

export type Options = settings.Settings & { readonly http?: Http };

/** The parsed answer of the healer, with the envelope it arrived in. */
type Answer = { readonly moves: Record<string, unknown>; readonly model: unknown; readonly usage: unknown };

/** One move of the healer, resolved against the page it was chosen from. */
type Move = {
  readonly choice: string;
  readonly operation: string;
  readonly target: string | null;
  readonly reason: string | null;
};

/**
 * Asks a second model for one move out of a run that is going nowhere, and resolves the answer
 * against the observed page. The healer only ever answers with ids of the operations that were
 * offered: the mapping back to the page stays local, exactly like the mapping of a decision of the
 * model itself.
 */
export async function heal(
  page: Page,
  goal: string,
  history: readonly Entry[],
  stuck: Stuck,
  options: Options = {},
): Promise<Choice> {
  const key = settings.credential(options);
  if (!key) throw new InputError(MISSING_CREDENTIAL);
  const base = endpoint(settings.address(options));
  if (!url.absolute(base)) throw new InputError(ADDRESS_ERROR);
  const space = elements.space(page.actions);
  const operations = questions.criteria(space);
  const request = context(page, goal, history, stuck, space, operations);
  const started = now();
  const client = options.http ?? http;
  const answer = await client.post(
    `${base}/chat/completions`,
    key,
    payload(settings.identity(options), base, request, instruction(stuck.kind)),
  );
  const parts = await read(answer);
  const move = resolve(space, operations, parts.moves);
  return {
    choice: move.choice,
    operation: move.operation,
    target: move.target,
    confidence: 1,
    probabilities: { [move.choice]: 1 },
    operation_probabilities: { [move.operation]: 1 },
    target_probabilities: move.target === null ? {} : { [move.target]: 1 },
    target_confidence: move.target === null ? null : 1,
    raw_answers: parts.moves,
    model: parts.model,
    usage: parts.usage,
    latency_ms: elapsed(started),
    request,
    healed: true,
    reason: move.reason,
  };
}

function payload(
  model: string,
  base: string,
  context: Record<string, unknown>,
  instruction: string,
): Record<string, unknown> {
  return {
    model,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    ...settings.reasoning(base),
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: encode(context) },
    ],
  };
}

/** The instruction of the situation the run reported: a loop, or an ending its own model gave up with. */
function instruction(kind: string): string {
  return kind === ENDING ? GAVE_UP : HEAL;
}

/** The moves the page offers the healer: the target choices, the controls, and the BLOCKED ending. */
function context(
  page: Page,
  goal: string,
  history: readonly Entry[],
  stuck: Stuck,
  space: Space,
  operations: Record<string, string>,
): Record<string, unknown> {
  return {
    goal,
    loop: { kind: stuck.kind, steps: stuck.steps.map(recent) },
    operations,
    elements: space.elements,
    page: { url: page.url, title: page.title, text: page.text.slice(0, TEXT_LIMIT) },
    recent_actions: history.slice(-10).map(recent),
  };
}

function recent(entry: Entry): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of RECENT_FIELDS) summary[field] = entry[field] ?? null;
  return summary;
}

async function read(answer: unknown): Promise<Answer> {
  if (!isRecord(answer)) throw invalid();
  const parsed = await decode(contentOf(answer));
  if (!parsed.ok || !isRecord(parsed.value)) throw invalid();
  return { moves: parsed.value, model: answer.model ?? null, usage: answer.usage ?? {} };
}

/** The JSON the healer wrote, as the OpenAI-compatible envelope carries it. */
function contentOf(answer: Record<string, unknown>): string {
  if (!Array.isArray(answer.choices)) throw invalid();
  const [first] = answer.choices;
  if (!isRecord(first) || !isRecord(first.message)) throw invalid();
  if (typeof first.message.content !== "string") throw invalid();
  return first.message.content;
}

/** Resolves the answer: one offered operation, and a target whenever that operation has any. */
function resolve(space: Space, operations: Record<string, string>, moves: Record<string, unknown>): Move {
  const operation = typeof moves.operation === "string" ? moves.operation : "";
  if (!Object.hasOwn(operations, operation) || operation === DONE) throw invalid();
  const candidates = space.targets[operation];
  if (!candidates) return control(space, operation, moves);
  const target = targetOf(moves.target, candidates);
  const action = candidates[target];
  if (!action) throw new InputError(UNKNOWN_TARGET);
  return { choice: action.id, operation, target, reason: reasonOf(moves) };
}

/** A control such as a wait, or the BLOCKED ending: everything that is not a target choice. */
function control(space: Space, operation: string, moves: Record<string, unknown>): Move {
  const controlled = space.controls[operation];
  const choice = controlled ? controlled.id : operation;
  return { choice, operation, target: null, reason: reasonOf(moves) };
}

/** The target of the move: the single candidate of an operation is forced, as the criteria do. */
function targetOf(value: unknown, candidates: Record<string, Action>): string {
  if (value === undefined || value === null || value === "") {
    const only = Object.keys(candidates);
    if (only.length === 1) return only[0];
    throw invalid();
  }
  return String(value);
}

function reasonOf(moves: Record<string, unknown>): string | null {
  if (typeof moves.reason !== "string") return null;
  return moves.reason.trim().slice(0, REASON_LIMIT) || null;
}

function invalid(): InputError {
  return new InputError(INVALID_OUTPUT);
}

/** A provider address is used without its trailing slashes so a path can be appended. */
function endpoint(base: string): string {
  return base.replace(/\/+$/, "");
}
