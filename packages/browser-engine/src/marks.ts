/**
 * The numbered snapshot of a page: one index per observed element, in the order the policy
 * numbers them. The browser draws the same numbers over the page before it captures the
 * frame, so the boxes the model reads and the ids it answers with cannot drift apart.
 */

import type { Action } from "./browser/types.ts";
import { RuntimeFailure } from "./errors.ts";
import { name } from "./policy/operations.ts";

/** One numbered box of the snapshot: the element index and the node it was observed on. */
export type Mark = { readonly index: string; readonly node: number };

const NO_NODE = "The observed action carries no element node.";

/** The index of every observed node that carries an operation, in element order. */
export function numbers(actions: readonly Action[]): ReadonlyMap<number, string> {
  const numbered = new Map<number, string>();
  for (const action of actions) {
    if (!name(action.kind)) continue;
    const node = nodeOf(action);
    if (!numbered.has(node)) numbered.set(node, String(numbered.size + 1));
  }
  return numbered;
}

/** The boxes to draw over one observation, in element order. */
export function plan(actions: readonly Action[]): readonly Mark[] {
  return [...numbers(actions)].map(([node, index]) => ({ index, node }));
}

function nodeOf(action: Action): number {
  if (typeof action.node !== "number" || !Number.isInteger(action.node)) throw new RuntimeFailure(NO_NODE);
  return action.node;
}
