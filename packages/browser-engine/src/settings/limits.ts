/** Shared numeric limits of the harness. */
export const MAX_STEPS = 60;

/** One decision plus its execution per step, so stale decisions can be re-made. */
export const MAX_DECISIONS = MAX_STEPS * 2;

/** How often one run may hand a choice it cannot make on its own to the heal model before it is blocked. */
export const MAX_HEALS = 3;
