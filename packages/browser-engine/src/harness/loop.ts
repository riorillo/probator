import type { Entry } from "../history.ts";
import { MAX_HEALS } from "../settings/limits.ts";
import * as config from "./config.ts";
import type { State } from "./state.ts";

/**
 * How a run repeats itself: a page that never changed, the same move on a page that did, or a cycle
 * of moves it keeps going round.
 */
export type Kind = "unchanged" | "repeated" | "oscillating";

/** A run that repeats itself, with the steps that show it. */
export type Loop = { readonly kind: Kind; readonly steps: readonly Entry[] };

/** How many steps must repeat before a run counts as stuck. */
export const REPEATS = 3;

/** The longest cycle of moves a run can go round in, and how many times it must go round. */
export const PERIODS = 3;
export const CYCLES = 2;

const WAIT = "wait";

/**
 * The loop a run is in, when its last steps repeat: either none of them changed the page, or all of
 * them made the same move while the page did change, or they went round the same cycle of moves. A
 * wait is never part of a loop: a page may load.
 */
export function looping(history: readonly Entry[]): Loop | null {
  const steps = history.slice(-REPEATS);
  if (steps.length !== REPEATS) return null;
  if (steps.some((step) => step.kind === WAIT)) return null;
  if (steps.every((step) => step.page_changed === false)) return { kind: "unchanged", steps };
  if (!steps.some((step) => step.page_changed === true)) return null;
  const moves = steps.map(move);
  if (moves[0] && moves.every((candidate) => candidate === moves[0])) return { kind: "repeated", steps };
  return cycle(history);
}

/**
 * The cycle a run is going round, when its last steps are the same sequence of moves twice. Two
 * moves that alternate are never the same move three times: a page that is scrolled up and down
 * again changes on every step, and only the cycle it repeats says that it is going nowhere.
 */
function cycle(history: readonly Entry[]): Loop | null {
  for (let period = 2; period <= PERIODS; period += 1) {
    const steps = history.slice(-period * CYCLES);
    if (steps.length !== period * CYCLES) continue;
    if (steps.some((step) => step.kind === WAIT)) continue;
    const moves = steps.map(move);
    if (moves.some((candidate) => candidate === null)) continue;
    if (new Set(moves.slice(0, period)).size < 2) continue;
    if (moves.every((candidate, index) => candidate === moves[index % period])) {
      return { kind: "oscillating", steps };
    }
  }
  return null;
}

/** Whether a stuck run may spend one more healing step. */
export function affordable(state: State): boolean {
  return healing(state) && state.heals < MAX_HEALS;
}

/** Whether a repeated run ends instead of being healed: no healer, or no budget left. */
export function stops(state: State, entry?: Entry): boolean {
  const loop = looping(left(state, entry));
  if (!loop) return false;
  if (affordable(state)) return false;
  // Without a healer the rule is the one such a run always had: only a page that never changes ends it.
  return healing(state) || loop.kind === "unchanged";
}

/** The history the run has once the step about to be recorded is part of it. */
function left(state: State, entry?: Entry): readonly Entry[] {
  if (!entry) return state.history;
  return [...state.history, entry];
}

/** The move of one step: the same operation on the same target is what repeats a run. */
function move(entry: Entry): string | null {
  if (typeof entry.operation !== "string" || !entry.operation) return null;
  return `${entry.operation} ${String(entry.target ?? "")}`;
}

function healing(state: State): boolean {
  return config.healing(state.config);
}
