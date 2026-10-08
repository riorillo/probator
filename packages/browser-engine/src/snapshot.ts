/**
 * A typed projection of a reported snapshot.
 *
 * The harness reports plain records, because the inspector and the frontend read them
 * loosely. Code that reports a run reads them strictly instead: a missing field is a
 * contract drift, so it fails loudly rather than reporting a zero.
 */

import { RuntimeFailure } from "./errors.ts";
import type { Snapshot } from "./harness/agent.ts";
import { isRecord } from "./json.ts";

/** One executed action of a run. */
export type Step = {
  readonly action: string;
  readonly executed_ms: number;
  readonly elapsed_ms: number;
};

/** One model call that chose an action. */
export type Decision = {
  readonly latency_ms: number;
  readonly elapsed_ms: number;
};

/** One model call that wrote text for an action. */
export type Call = {
  readonly model: string;
};

/** What a run reported, as typed values. */
export type View = {
  readonly elapsed_ms: number;
  readonly status: string;
  readonly history: readonly Step[];
  readonly decisions: readonly Decision[];
  readonly text_calls: readonly Call[];
};

/** The page of a run, as the code that verifies a run reads it. */
export type PageView = {
  readonly url: string;
  readonly text: string;
  readonly actions: readonly ActionView[];
};

/** One element of a page, reduced to the label and the value it reports. */
export type ActionView = {
  readonly label: string;
  readonly value?: string;
};

export function view(snapshot: Snapshot): View {
  return {
    elapsed_ms: number(snapshot.elapsed_ms, "elapsed_ms"),
    status: text(snapshot.status, "status"),
    history: entries(snapshot.history, "history").map(step),
    decisions: entries(snapshot.decisions, "decisions").map(decision),
    text_calls: entries(snapshot.text_calls, "text_calls").map(call),
  };
}

export function page(snapshot: Snapshot): PageView {
  const reported = snapshot.page;
  if (!isRecord(reported)) throw new RuntimeFailure("A run reported no page.");
  return {
    url: text(reported.url, "page.url"),
    text: text(reported.text, "page.text"),
    actions: actions(reported.actions),
  };
}

function step(entry: Record<string, unknown>): Step {
  return {
    action: reported(entry.action),
    executed_ms: number(entry.executed_ms, "history.executed_ms"),
    elapsed_ms: number(entry.elapsed_ms, "history.elapsed_ms"),
  };
}

function decision(entry: Record<string, unknown>): Decision {
  return {
    latency_ms: number(entry.latency_ms, "decisions.latency_ms"),
    elapsed_ms: number(entry.elapsed_ms, "decisions.elapsed_ms"),
  };
}

function call(entry: Record<string, unknown>): Call {
  return { model: text(entry.model, "text_calls.model") };
}

function actions(value: unknown): readonly ActionView[] {
  if (!Array.isArray(value)) throw new RuntimeFailure("A run reported no page actions.");
  return value.map((action) => reportedAction(action));
}

function reportedAction(value: unknown): ActionView {
  const entry = record(value, "page.actions");
  return {
    label: typeof entry.label === "string" ? entry.label : "",
    value: typeof entry.value === "string" ? entry.value : undefined,
  };
}

/** The action label as reported; a step without one reads as an empty label. */
function reported(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function entries(value: unknown, field: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new RuntimeFailure(`A run reported no ${field}.`);
  return value.map((entry) => record(entry, field));
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RuntimeFailure(`A run reported a malformed ${field} entry.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new RuntimeFailure(`A run reported no ${field}.`);
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number") throw new RuntimeFailure(`A run reported no ${field}.`);
  return value;
}
