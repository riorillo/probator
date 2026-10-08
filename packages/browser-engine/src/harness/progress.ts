import type { Update } from "./state.ts";

/**
 * A node result in progress: the mutations it has produced so far, plus at most one failure.
 * Accumulating keeps the mutations of a failed step, exactly like a mutable state would.
 */
export type Progress = { readonly update: Update; readonly failure: unknown };

export function start(update: Update = {}): Progress {
  return { update, failure: null };
}

export function add(progress: Progress, update: Update): Progress {
  return { update: { ...progress.update, ...update }, failure: progress.failure };
}

/** Ends a node with everything it changed and the failure that stopped it. */
export function stop(progress: Progress, failure: unknown): Update {
  return { ...progress.update, failure };
}

/** Ends a node successfully. */
export function finish(progress: Progress): Update {
  return progress.update;
}
