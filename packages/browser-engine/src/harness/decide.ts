import { InputError, messageOf } from "../errors.ts";
import { ENDING, heal, type Stuck } from "../heal/decision.ts";
import { settle, type Outcome } from "../outcome.ts";
import { choose } from "../policy/decision.ts";
import { BLOCKED } from "../policy/operations.ts";
import type { Choice } from "../policy/types.ts";
import { MAX_DECISIONS } from "../settings/limits.ts";
import { elapsed, now } from "../time.ts";
import * as config from "./config.ts";
import * as freshness from "./freshness.ts";
import * as loop from "./loop.ts";
import * as progress from "./progress.ts";
import type { Call, State, Update } from "./state.ts";

const OVER = "This run is over. Start a new one.";
const LIMIT = "The model call limit was reached.";

/** What one call to the healer left behind: the move it found, or nothing, and the budget it spent. */
type Healed = { readonly progress: progress.Progress; readonly choice: Choice | null };

/** Chooses the next action: refresh the page, respect the limits, then ask a model. */
export async function decide(state: State): Promise<Update> {
  const started_at = state.started_at ?? now();
  const step = progress.start({ started_at });
  const refreshed = await freshness.refresh(state);
  if (!refreshed.ok) return progress.stop(step, refreshed.error);
  // The previous decision is always cleared before the guards: a refused command must not run later.
  const current = progress.add(step, { page: refreshed.value, decision: null });
  const refused = refuse(state);
  if (refused) return progress.stop(current, refused);
  const answered = await next(state, refreshed.value, started_at, current);
  if (answered.failure) return progress.stop(answered, answered.failure);
  return progress.finish(answered);
}

function refuse(state: State): InputError | null {
  if (state.status === "done" || state.status === "blocked") return new InputError(OVER);
  if (state.decisions.length >= MAX_DECISIONS) return new InputError(LIMIT);
  return null;
}

/** The choice of one step: the healer when the run goes nowhere on its own, otherwise the decision model. */
async function next(
  state: State,
  page: State["page"],
  started_at: number,
  base: progress.Progress,
): Promise<progress.Progress> {
  const stuck = loop.looping(state.history);
  // A run that repeats itself hands the choice to the heal model, as long as it has the budget.
  if (!stuck || !loop.affordable(state)) return await asked(state, page, started_at, base);
  const attempt = await healed(state, page, stuck, started_at, base);
  if (attempt.choice) return attempt.progress;
  // A healer that fails never fails the run: the decision model is asked instead, at today's costs.
  return await asked(state, page, started_at, attempt.progress);
}

/** The decision model chooses, as it always does; an ending it gives up on is handed to the healer. */
async function asked(
  state: State,
  page: State["page"],
  started_at: number,
  base: progress.Progress,
): Promise<progress.Progress> {
  const answer = await settle(() => choose(page, state.goal, state.history, config.decision(state.config)));
  if (!answer.ok) return { update: base.update, failure: answer.error };
  const decided = progress.add(base, recorded(answer.value, page, started_at));
  // A choice of BLOCKED is an ending of its own, so the healer gets one look at the page before the run
  // stops where the model left it. What it spent is kept either way; only a move of its own replaces it.
  if (answer.value.choice !== BLOCKED || !loop.affordable(state)) return decided;
  const attempt = await healed(state, page, ended(), started_at, base);
  if (attempt.choice) return attempt.progress;
  return progress.add(attempt.progress, recorded(answer.value, page, started_at));
}

/** The situation of a run whose own model gave up: no loop to show, only the ending it chose. */
function ended(): Stuck {
  return { kind: ENDING, steps: [] };
}

/** The heal model chooses one way out of the situation the run reported, and its choice runs like any other. */
async function healed(
  state: State,
  page: State["page"],
  stuck: Stuck,
  started_at: number,
  base: progress.Progress,
): Promise<Healed> {
  const called = now();
  const answer = await settle(() => heal(page, state.goal, state.history, stuck, config.heal(state.config)));
  // The budget is spent even when the healer fails, so a run can never be healed forever.
  const spent = progress.add(base, { heals: state.heals + 1, heal_calls: [call(answer, elapsed(called))] });
  if (!answer.ok) return { progress: spent, choice: null };
  return { progress: progress.add(spent, recorded(answer.value, page, started_at)), choice: answer.value };
}

function call(answer: Outcome<Choice>, latency_ms: number): Call {
  if (!answer.ok) return { healed: false, error: messageOf(answer.error), latency_ms };
  const choice = answer.value;
  return {
    healed: true,
    choice: choice.choice,
    operation: choice.operation,
    target: choice.target,
    reason: choice.reason ?? null,
    model: choice.model,
    latency_ms,
  };
}

function recorded(choice: Choice, page: State["page"], started_at: number): Update {
  return {
    decision: choice,
    status: "predicted",
    decisions: [{ ...choice, fingerprint: page.fingerprint, elapsed_ms: elapsed(started_at) }],
  };
}
