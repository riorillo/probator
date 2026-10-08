import type { Action, Page } from "../browser/types.ts";
import { canonical } from "../canonical.ts";
import { InputError, RuntimeFailure } from "../errors.ts";
import type { Entry } from "../history.ts";
import { failed, ok, settle, type Outcome } from "../outcome.ts";
import { DONE, finished } from "../policy/operations.ts";
import type { Choice } from "../policy/types.ts";
import { MAX_STEPS } from "../settings/limits.ts";
import { build } from "../text/context.ts";
import { write, type Helper } from "../text/field.ts";
import * as config from "./config.ts";
import * as freshness from "./freshness.ts";
import * as loop from "./loop.ts";
import * as progress from "./progress.ts";
import * as recording from "./recording.ts";
import { since, type State, type Status, type Update } from "./state.ts";

const BEFORE_ACT = "Observe and choose before executing.";
const AFTER_CHOICE = "The page changed after the choice. Choose again.";
const BEFORE_TEXT = "The page changed before the text was generated. Choose again.";
const MISSING = "The chosen action is no longer on the page.";

/** What the text model produced for one configured action. */
type Typed = { readonly text: string | null; readonly helper: Helper | null; readonly update: Update };

/** Everything a recorded step needs to know about the action it ran. */
type Run = { readonly action: Action; readonly page: Page; readonly decision: Choice; readonly typed: Typed };

/** Runs the chosen action, records it, and observes the page it produced. */
export async function execute(state: State): Promise<Update> {
  if (!state.decision || !agrees(state)) return { failure: new InputError(BEFORE_ACT) };
  // The decision is consumed before any mutation or model call: a retry can never run it twice.
  const step = progress.start({ decision: null });
  if (finished(state.decision.choice)) return finish(state, step, state.decision.choice);
  const page = state.page;
  const action = page.actions.find((candidate: Action) => candidate.id === state.decision?.choice);
  if (!action) return progress.stop(step, new RuntimeFailure(MISSING));
  if (state.history.length >= MAX_STEPS) {
    const full = progress.add(step, { status: "blocked" as Status });
    return progress.stop(full, new InputError(`Stopped at the limit of ${MAX_STEPS} actions.`));
  }
  const typed = await configure(state, action);
  if (!typed.ok) return progress.stop(step, typed.error);
  const prepared = progress.add(step, typed.value.update);
  const ran = await settle(() => state.port.act(action, page, typed.value.text));
  if (!ran.ok) return progress.stop(prepared, ran.error);
  return recorded(state, prepared, { action, page, decision: state.decision, typed: typed.value });
}

/** A tick acts on the page its own decision was chosen from; a command must match the fingerprint it saw. */
function agrees(state: State): boolean {
  if (state.mode === "tick") return true;
  return state.expect === state.page.fingerprint;
}

/** Ends the run without touching the page, unless the page moved on since the choice. */
async function finish(state: State, step: progress.Progress, choice: string): Promise<Update> {
  const probe = await freshness.confirm(state, AFTER_CHOICE);
  if (!probe.ok) return progress.stop(step, probe.error);
  if (probe.value) return progress.stop(progress.add(step, { status: "ready" as Status }), probe.value);
  const done = choice === DONE;
  const ending = progress.add(step, {
    status: (done ? "done" : "blocked") as Status,
    plan_index: done ? 1 : 0,
    elapsed_ms: since(state),
  });
  return progress.finish(ending);
}

/** Writes the text a fill needs, reusing the text of the previous attempt when the context is unchanged. */
async function configure(state: State, action: Action): Promise<Outcome<Typed>> {
  const empty: Typed = { text: null, helper: null, update: {} };
  if (action.kind !== "fill") return ok(empty);
  const probe = await freshness.confirm(state, BEFORE_TEXT);
  if (!probe.ok) return failed(probe.error);
  if (probe.value) return failed(probe.value);
  const context = build(state.goal, action, state.page, state.history);
  const pending = state.pending_text;
  if (pending && canonical(pending.context) === canonical(context)) {
    return ok({ ...empty, text: pending.text, helper: pending.helper });
  }
  const written = await settle(() => write(context, config.text(state.config)));
  if (!written.ok) return failed(written.error);
  return ok({
    text: written.value.value,
    helper: written.value.helper,
    update: {
      pending_text: { context, text: written.value.value, helper: written.value.helper },
      text_calls: [{ ...written.value.helper, field: action.label ?? null, value: written.value.value }],
    },
  });
}

async function recorded(state: State, step: progress.Progress, run: Run): Promise<Update> {
  const entry = entryOf(state, run);
  const executed = progress.add(step, {
    history: [entry],
    pending_text: null,
    elapsed_ms: since(state),
  });
  const observed = await settle(() => state.port.observe(config.screenshots(state.config)));
  if (!observed.ok) return progress.stop(executed, observed.error);
  entry.page_changed = observed.value.fingerprint !== run.page.fingerprint;
  entry.url = observed.value.url;
  entry.elapsed_ms = since(state);
  const seen = progress.add(executed, { page: observed.value, elapsed_ms: entry.elapsed_ms });
  const stored = await store(state, entry.elapsed_ms, observed.value);
  if (!stored.ok) return progress.stop(seen, stored.error);
  return progress.finish(progress.add(seen, { status: status(state, entry) }));
}

/** A run is blocked when its last steps repeat and there is no way left out of the loop. */
function status(state: State, entry: Entry): Status {
  return loop.stops(state, entry) ? "blocked" : "ready";
}

function entryOf(state: State, run: Run): Entry {
  const helper = run.typed.helper;
  return {
    step: state.history.length + 1,
    action: run.action.label ?? null,
    kind: run.action.kind,
    choice: run.decision.choice,
    probability: run.decision.probabilities[run.decision.choice],
    confidence: run.decision.confidence,
    latency_ms: run.decision.latency_ms,
    text: run.typed.text,
    text_helper: helper ? helper.model : null,
    text_latency_ms: helper ? helper.latency_ms : 0,
    operation: run.decision.operation,
    target: run.decision.target,
    healed: run.decision.healed === true,
    heal_reason: run.decision.healed === true ? run.decision.reason ?? null : null,
    page_changed: null,
    url: run.page.url,
    usage: run.decision.usage,
    executed_ms: since(state),
    elapsed_ms: since(state),
  };
}

function store(state: State, elapsed_ms: number, page: Page): Promise<Outcome<void>> {
  const dir = config.frames(state.config);
  if (!state.record || !dir) return Promise.resolve(ok(undefined));
  return settle(async () => {
    await recording.store(dir, recording.frame(elapsed_ms), page.screenshot);
  });
}
