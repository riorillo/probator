import { list, record, text, whole } from "./read.ts";

/** The state of a run that has not started. */
export const IDLE = "idle";

/** The state of a run that reached its goal. */
const DONE = "done";

/** The state of a run that has chosen an action and not applied it yet. */
export const PREDICTED = "predicted";

/** The state of a run that stopped without reaching its goal. It is the one a giving-up model ends with. */
const BLOCKED = "blocked";

/** The operation of the ending both models answer with when nothing can progress the goal. */
const GIVE_UP = "BLOCKED";

/** The two states that end the loop. */
const ENDED: readonly string[] = [DONE, BLOCKED];

/** The state the run reports. */
export function status(state: unknown): string {
  return text(record(state).status, IDLE);
}

/** Whether the loop is over. */
export function ended(state: unknown): boolean {
  return ENDED.includes(status(state));
}

/** The observed page, or nothing before the run opened one. */
export function page(state: unknown): unknown {
  return record(state).page ?? null;
}

/** Every executed action, oldest first. */
export function history(state: unknown): readonly unknown[] {
  return list(record(state).history);
}

/** How many actions the run has executed. */
export function steps(state: unknown): number {
  return history(state).length;
}

/** The model that writes text, as the run reports it. */
export function textModel(state: unknown, fallback: string): string {
  return text(record(state).text_model, fallback);
}

/** Whether the run in effect reads the snapshot as a frame with numbered boxes. */
export function vision(state: unknown): boolean {
  return record(state).vision === true;
}

/** Milliseconds since the run started deciding. */
export function elapsed(state: unknown): number {
  return whole(record(state).elapsed_ms);
}

/** The step ceiling of the server, doubled: a speeding run asks twice per step. */
export function budget(state: unknown): number {
  return whole(record(state).max_steps, 1) * 2;
}

/** The fingerprint of the observed page, or nothing when there is none. */
export function pageKey(state: unknown): string | null {
  const value = text(record(page(state)).fingerprint);
  return value === "" ? null : value;
}

/** The choice in hand: the decision just made, or the last one of a finished run. */
export function choice(state: unknown): string | null {
  const picked = pending(record(state));
  const value = text(record(picked).choice);
  return value === "" ? null : value;
}

function pending(document: Record<string, unknown>): unknown {
  if (document.decision !== null && document.decision !== undefined) return document.decision;
  if (text(document.status, IDLE) !== DONE) return null;
  return list(document.decisions).at(-1) ?? null;
}

/** What the heal model left on a run that stopped by giving up: its own words, and whether it ever answered. */
export type Verdict = { readonly said: string; readonly answered: boolean };

/**
 * The verdict of the heal model on a run that stopped by giving up, or nothing when it had no part in
 * the ending. A healer that chose an action of its own moved the run on, and a healer of a run that
 * stopped for another reason, a spent loop or the step limit, has nothing to say about this ending.
 */
export function healVerdict(state: unknown): Verdict | null {
  if (status(state) !== BLOCKED || lastOperation(state) !== GIVE_UP) return null;
  const call = record(list(record(state).heal_calls).at(-1));
  if (call.healed === true && call.operation !== GIVE_UP) return null;
  const answered = call.healed === true;
  const said = answered ? text(call.reason) : text(call.error);
  return said === "" ? null : { said, answered };
}

/** The operation of the decision the run stopped with, or nothing when it recorded none. */
function lastOperation(state: unknown): string {
  return text(record(list(record(state).decisions).at(-1)).operation);
}
