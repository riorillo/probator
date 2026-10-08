import { Annotation } from "@langchain/langgraph";
import type { BrowserPort, Page } from "../browser/types.ts";
import { RuntimeFailure } from "../errors.ts";
import type { Entry } from "../history.ts";
import * as elements from "../policy/elements.ts";
import type { Choice } from "../policy/types.ts";
import type { Helper } from "../text/field.ts";
import { elapsed } from "../time.ts";
import * as config from "./config.ts";
import type { Config } from "./config.ts";

/** One command of the harness: a full step, a decision only, or a chosen action. */
export type Mode = "tick" | "predict" | "act";

/** The lifecycle of a run. */
export type Status = "ready" | "predicted" | "done" | "blocked";

/** A value the text model already wrote for one exact context, kept for a retry. */
export type Pending = { readonly context: unknown; readonly text: string; readonly helper: Helper };

/** One model call, as the inspector reports it. */
export type Call = Record<string, unknown>;

export const Definition = Annotation.Root({
  mode: Annotation<Mode>(),
  port: Annotation<BrowserPort>(),
  config: Annotation<Config>(),
  goal: Annotation<string>(),
  plan: Annotation<string[]>(),
  plan_index: Annotation<number>(),
  page: Annotation<Page>(),
  decision: Annotation<Choice | null>(),
  status: Annotation<Status>(),
  history: Annotation<Entry[]>({ reducer: appended, default: () => [] }),
  decisions: Annotation<Call[]>({ reducer: appended, default: () => [] }),
  text_calls: Annotation<Call[]>({ reducer: appended, default: () => [] }),
  /** How often this run already handed a choice it could not make on its own to the heal model. */
  heals: Annotation<number>(),
  /** One call to the heal model per healing step, as the inspector reports it. */
  heal_calls: Annotation<Call[]>({ reducer: appended, default: () => [] }),
  pending_text: Annotation<Pending | null>(),
  failure: Annotation<unknown>(),
  expect: Annotation<string | null>(),
  elapsed_ms: Annotation<number>(),
  started_at: Annotation<number | null>(),
  record: Annotation<boolean>(),
});

/** The state a run keeps between commands. */
export type State = typeof Definition.State;

/** What a graph node is allowed to change. */
export type Update = typeof Definition.Update;

export type Setup = {
  readonly mode: Mode;
  readonly port: BrowserPort;
  readonly config: Config;
  readonly goal: string;
  readonly page: Page;
  readonly record: boolean;
  readonly startedAt?: number | null;
};

/** The pristine state of a run that has just observed its first page. */
export function initial(setup: Setup): State {
  return {
    mode: setup.mode,
    port: setup.port,
    config: setup.config,
    goal: setup.goal,
    plan: [setup.goal],
    plan_index: 0,
    page: setup.page,
    decision: null,
    status: "ready",
    history: [],
    decisions: [],
    text_calls: [],
    heals: 0,
    heal_calls: [],
    pending_text: null,
    failure: null,
    expect: null,
    elapsed_ms: 0,
    started_at: setup.startedAt ?? null,
    record: setup.record,
  };
}

/** The payload the inspector and the frontend read; internal channels stay internal. */
export function snapshot(state: State): Record<string, unknown> {
  return {
    goal: state.goal,
    page: state.page,
    decision: state.decision,
    history: state.history,
    status: state.status,
    plan: state.plan,
    plan_index: state.plan_index,
    decisions: state.decisions,
    text_calls: state.text_calls,
    heal_calls: state.heal_calls,
    elapsed_ms: state.elapsed_ms,
    started_at: state.started_at,
    record: state.record,
    vision: config.vision(state.config),
    elements: elements.space(state.page.actions).elements,
  };
}

/** Elapsed milliseconds since the first decision started the clock. */
export function since(state: State): number {
  const started = state.started_at;
  if (started === null) throw new RuntimeFailure("The run has no clock yet.");
  return elapsed(started);
}

function appended<T>(left: T[], right: T[]): T[] {
  return left.concat(right);
}
