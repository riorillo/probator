/**
 * The single screen of the client. Components read it through `useScreen` and never
 * own state; every action replaces it with a whole new value so React sees the change.
 */

import type { Values } from "../model/fields.ts";

/** Everything the page needs to draw itself. */
export type Screen = {
  /** Every field as the user last left or edited it; nothing before a first edit. */
  readonly values: Values | null;
  /** The last reported run. */
  readonly report: unknown;
  /** What the run said when a request failed, or nothing. */
  readonly fault: string | null;
  /** What the status line shows instead of the state; nothing to show the state itself. */
  readonly note: string | null;
  /** Whether a request is in flight. */
  readonly busy: boolean;
  /** Whether the loop keeps asking the server. */
  readonly automatic: boolean;
  /** Whether the shortcut predicts and applies in one turn. */
  readonly speeding: boolean;
  /** Whether the overlay draws the targets of the page. */
  readonly marking: boolean;
  /** Whether the next run sends the snapshot to the model as a frame with numbered boxes. */
  readonly vision: boolean;
};

export const START: Screen = {
  values: null,
  report: null,
  fault: null,
  note: null,
  busy: false,
  automatic: false,
  speeding: false,
  marking: true,
  vision: true,
};

let screen: Screen = START;

const listeners = new Set<() => void>();

/** The screen as it is right now. */
export function current(): Screen {
  return screen;
}

/** Replaces the parts of the screen a change names. */
export function update(change: Partial<Screen>): void {
  screen = { ...screen, ...change };
  for (const listener of listeners) listener();
}

/** Called after every change; returns the way to stop listening. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
