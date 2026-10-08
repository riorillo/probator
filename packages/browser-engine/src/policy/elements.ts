import type { Action } from "../browser/types.ts";
import { RuntimeFailure } from "../errors.ts";
import { numbers } from "../marks.ts";
import { name } from "./operations.ts";

export type Option = { index: string; label: string; value: unknown };

export type Element = {
  index: string;
  label: string;
  operations: string[];
  options?: Option[];
  [field: string]: unknown;
};

export type Space = {
  readonly elements: Element[];
  readonly targets: Record<string, Record<string, Action>>;
  readonly controls: Record<string, Action>;
};

const SUMMARY_FIELDS = ["role", "value", "checked", "selected", "expanded", "required", "invalid", "description", "context"] as const;

/**
 * Groups the observed actions into the elements, targets, and controls the model chooses from.
 * Every action kind without an operation becomes a direct control instead of a modelled choice.
 */
export function space(actions: readonly Action[]): Space {
  const elements: Element[] = [];
  const seen = new Map<number, Element>();
  const numbered = numbers(actions);
  const targets: Record<string, Record<string, Action>> = {};
  const controls: Record<string, Action> = {};
  for (const action of actions) {
    const operation = name(action.kind);
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const element = elementFor(elements, seen, numbered, action);
    if (!element.operations.includes(operation)) element.operations.push(operation);
    const candidates = targets[operation] ?? (targets[operation] = {});
    if (action.kind !== "select") {
      candidates[element.index] = action;
      continue;
    }
    const options = element.options ?? (element.options = []);
    const target = `${element.index}:${options.length + 1}`;
    options.push({ index: target, label: String(action.label ?? ""), value: action.value });
    candidates[target] = action;
  }
  return { elements, targets, controls };
}

/**
 * The element of one action: the very index the frame shows over it, because both walk the
 * same observed actions with the same rule, so no id the model reads can be off by one.
 */
function elementFor(
  elements: Element[],
  seen: Map<number, Element>,
  numbered: ReadonlyMap<number, string>,
  action: Action,
): Element {
  const node = nodeOf(action);
  const known = seen.get(node);
  if (known) return known;
  const index = numbered.get(node);
  if (index === undefined) throw new RuntimeFailure("The observed action carries no snapshot index.");
  const element = summarize(action);
  element.index = index;
  element.label = String(action.label ?? "").split(" → ")[0];
  element.operations = [];
  if (action.kind === "select") {
    element.value = action.current_value ?? "";
    element.options = [];
  }
  seen.set(node, element);
  elements.push(element);
  return element;
}

function summarize(action: Action): Element {
  const element: Record<string, unknown> = {};
  for (const field of SUMMARY_FIELDS) if (field in action) element[field] = action[field];
  return element as Element;
}

function nodeOf(action: Action): number {
  if (typeof action.node !== "number" || !Number.isInteger(action.node)) {
    throw new RuntimeFailure("The observed action carries no element node.");
  }
  return action.node;
}
