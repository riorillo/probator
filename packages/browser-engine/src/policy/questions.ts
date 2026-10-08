import type { Action, Page } from "../browser/types.ts";
import { RuntimeFailure } from "../errors.ts";
import type { Entry } from "../history.ts";
import type { Element, Space } from "./elements.ts";
import { BLOCKED, DONE, describe } from "./operations.ts";
import { recentActions } from "./context.ts";
import { NEXT_ACTION, TARGET } from "./prompts.ts";

const CANDIDATE_FIELDS = ["role", "checked", "selected", "expanded", "required", "invalid", "description", "context"] as const;

export type Request = {
  model: string;
  /** What the model reads about the page: the text snapshot, or the frame alone in image mode. */
  state: {
    page?: { url: string; title: string; text: string };
    elements?: Element[];
    url?: string;
    title?: string;
    recent_actions: Record<string, unknown>[];
    omitted_actions?: number;
  };
  /** Put on the wire by image mode only: the record of a decision stays free of frames. */
  images?: readonly string[];
  questions: Record<string, unknown>;
};

/** Everything one provider request is built from. */
export type RequestInput = {
  readonly goal: string;
  readonly model: string;
  readonly page: Page;
  readonly history: readonly Entry[];
  readonly space: Space;
  readonly criteria: Record<string, string>;
  readonly vision?: boolean;
};

/** The provider name of the target head that belongs to an operation. */
export function head(operation: string): string {
  return `${operation.toLowerCase()}_target`;
}

/** The choice list for the operation question: targets, then controls, then the two endings. */
export function criteria(space: Space): Record<string, string> {
  const operations: Record<string, string> = {};
  for (const operation of Object.keys(space.targets)) operations[operation] = describe(operation);
  for (const [key, control] of Object.entries(space.controls)) operations[key] = String(control.label);
  operations[DONE] = describe(DONE);
  operations[BLOCKED] = describe(BLOCKED);
  return operations;
}

/** Builds the provider request: one choice per operation plus a head for every ambiguous target set. */
export function request(input: RequestInput): Request {
  const questions: Record<string, unknown> = {
    operation: {
      type: "choice",
      criteria: input.criteria,
      instructions: { goal: input.goal, rules: NEXT_ACTION },
    },
  };
  for (const [operation, candidates] of Object.entries(input.space.targets)) {
    // A single candidate is forced: providers such as Cloudflare clef reject one-option criteria.
    if (Object.keys(candidates).length === 1) continue;
    questions[head(operation)] = {
      type: "choice",
      criteria: candidatesOf(candidates, Boolean(input.vision)),
      instructions: { goal: input.goal, operation, rules: TARGET },
    };
  }
  const context = state(input, Boolean(input.vision));
  if (input.page.omitted_actions > 0) context.omitted_actions = input.page.omitted_actions;
  return { model: input.model, state: context, questions };
}

/**
 * The visible page as the model reads it. In image mode the elements arrive as numbered boxes
 * on the frame, so only the address of that frame travels as text.
 */
function state(input: RequestInput, vision: boolean): Request["state"] {
  const recent_actions = recentActions(input.history);
  if (vision) return { url: input.page.url, title: input.page.title, recent_actions };
  return {
    page: { url: input.page.url, title: input.page.title, text: input.page.text },
    elements: input.space.elements,
    recent_actions,
  };
}

/** The captured frame as the provider wants it: a data URL, because remote images are refused. */
export function image(page: Page): string {
  if (!page.screenshot) throw new RuntimeFailure("The observation carries no screenshot to send.");
  return `data:image/jpeg;base64,${page.screenshot}`;
}

function candidatesOf(candidates: Record<string, Action>, vision: boolean): Record<string, unknown> {
  const criteria: Record<string, unknown> = {};
  for (const [index, action] of Object.entries(candidates)) {
    criteria[index] = vision ? candidate(index, action) : {
      element: index.split(":")[0],
      ...(action.kind === "select" ? { option: index } : {}),
    };
  }
  return criteria;
}

function candidate(index: string, action: Action): Record<string, unknown> {
  const criteria: Record<string, unknown> = {
    element: `[${index}] ${String(action.label ?? "")}`,
    current_value: action.current_value ?? action.value ?? "",
  };
  for (const field of CANDIDATE_FIELDS) if (field in action) criteria[field] = action[field];
  return criteria;
}
