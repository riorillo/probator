import type { Action, Page } from "../browser/types.ts";
import { InputError, RuntimeFailure } from "../errors.ts";
import type { Entry } from "../history.ts";
import * as http from "../http/client.ts";
import type { Http } from "../http/client.ts";
import { isRecord } from "../json.ts";
import { elapsed, now } from "../time.ts";
import * as url from "../url.ts";
import * as elements from "./elements.ts";
import type { Space } from "./elements.ts";
import * as questions from "./questions.ts";
import * as settings from "./settings.ts";
import type { Choice } from "./types.ts";
import { validate, type Answer } from "./validate.ts";

const ADDRESS_ERROR = "The TypeSafe address must be an absolute HTTP(S) URL without credentials.";
const CREDENTIAL_ERROR = "Set TYPESAFE_API_KEY or enter a TypeSafe API key in the settings.";
const ANSWER_ERROR = "The model provider answered without a usable set of choices.";

export type Options = settings.Settings & { readonly http?: Http; readonly vision?: boolean };

/**
 * Asks the decision model what to do next and resolves the answer to a concrete action id.
 * The model only ever answers with ids: the mapping back to the observed page stays local.
 * In image mode it also reads the frame, with the ids drawn on the elements they belong to.
 */
export async function choose(
  page: Page,
  goal: string,
  history: readonly Entry[],
  options: Options = {},
): Promise<Choice> {
  const vision = Boolean(options.vision);
  const space = elements.space(page.actions);
  const criteria = questions.criteria(space);
  const request = questions.request({
    goal,
    model: settings.identity(options),
    page,
    history,
    space,
    criteria,
    vision,
  });
  const endpoint = settings.address(options);
  if (!url.absolute(endpoint)) throw new InputError(ADDRESS_ERROR);
  const key = settings.credential(options);
  if (!key) throw new InputError(CREDENTIAL_ERROR);
  const started = now();
  const client = options.http ?? http;
  const answer = await client.post(endpoint, key, pictured(request, page, vision));
  const parts = unwrap(answer);
  const operation = validate(parts.answers.operation ?? {}, criteria);
  const selection = select(space, operation, parts.answers);
  return {
    choice: selection.choice,
    operation: operation.choice,
    target: selection.target,
    confidence: operation.confidence,
    probabilities: selection.probabilities,
    operation_probabilities: operation.probabilities,
    target_probabilities: selection.answer ? selection.answer.probabilities : {},
    target_confidence: selection.answer ? selection.answer.confidence : null,
    raw_answers: parts.answers,
    model: parts.model,
    usage: parts.usage,
    latency_ms: elapsed(started),
    request,
  };
}

type Selection = {
  readonly target: string | null;
  readonly choice: string;
  readonly probabilities: Record<string, number>;
  readonly answer: Answer | null;
};

/** The body of the call: image mode adds the frame, and only the wire ever sees it. */
function pictured(request: questions.Request, page: Page, vision: boolean): questions.Request {
  if (!vision) return request;
  return { ...request, images: [questions.image(page)] };
}

function select(space: Space, operation: Answer, answers: Record<string, unknown>): Selection {
  const candidates = space.targets[operation.choice];
  if (!candidates) return controlled(space, operation);
  const answer = head(candidates, operation.choice, answers);
  const target = String(answer.choice);
  const action = candidates[target];
  if (!action) throw new RuntimeFailure(ANSWER_ERROR);
  return { target, choice: action.id, probabilities: resolution(candidates, answer), answer };
}

function controlled(space: Space, operation: Answer): Selection {
  const control = space.controls[operation.choice];
  const choice = control ? control.id : operation.choice;
  return {
    target: null,
    choice,
    probabilities: { [choice]: operation.probabilities[operation.choice] },
    answer: null,
  };
}

function head(candidates: Record<string, Action>, operation: string, answers: Record<string, unknown>): Answer {
  const indices = Object.keys(candidates);
  if (indices.length === 1) {
    return { choice: indices[0], probabilities: { [indices[0]]: 1 }, confidence: 1 };
  }
  return validate(answers[questions.head(operation)] ?? {}, candidates);
}

function resolution(candidates: Record<string, Action>, answer: Answer): Record<string, number> {
  const probabilities: Record<string, number> = {};
  for (const [index, action] of Object.entries(candidates)) {
    probabilities[action.id] = answer.probabilities[index];
  }
  return probabilities;
}

function unwrap(answer: unknown): {
  answers: Record<string, unknown>;
  model: unknown;
  usage: unknown;
} {
  if (!isRecord(answer)) throw new RuntimeFailure(ANSWER_ERROR);
  if (!isRecord(answer.answers)) throw new RuntimeFailure(ANSWER_ERROR);
  return { answers: answer.answers, model: answer.model ?? null, usage: answer.usage ?? {} };
}
