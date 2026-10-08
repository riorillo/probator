import type { Caller } from "../src/browser/client.ts";
import { create } from "../src/browser/client.ts";
import type { Session } from "../src/browser/session.ts";
import type { Action, BrowserPort, Freshness, Page } from "../src/browser/types.ts";
import type { Entry } from "../src/history.ts";
import type { Http } from "../src/http/client.ts";
import { INSTRUCTIONS } from "../src/heal/prompts.ts";
import type { Request } from "../src/policy/questions.ts";

/** The observed page the policy tests reason about, with two candidate nodes. */
export const ACTIONS: Action[] = [
  { id: "e1", kind: "fill", label: "Search", role: "textbox", value: "", node: 10 },
  { id: "e2", kind: "click", label: "Open Search", role: "textbox", value: "", node: 10 },
  { id: "e3", kind: "click", label: "Go", role: "button", value: "", node: 20 },
  { id: "wait", kind: "wait", label: "Wait" },
];

/** The two scroll controls the snapshot appends to every page, exactly as the browser reports them. */
export const SCROLLS: Action[] = [
  { id: "scroll_down", kind: "scroll", label: "Scroll down", delta: 560 },
  { id: "scroll_up", kind: "scroll", label: "Scroll up", delta: -560 },
];

export function page(mutations: Partial<Page> = {}): Page {
  return {
    url: "https://example.test/",
    title: "Search",
    w: 1120,
    h: 780,
    text: "Search",
    scroll: { y: 0, height: 780 },
    actions: structuredClone(ACTIONS),
    marker: "m1",
    page_key: [],
    guards: {},
    omitted_actions: 0,
    fingerprint: "f1",
    ...mutations,
  };
}

/** One provider answer that always selects the maximum of the ids it was given. */
export function choice(ids: readonly string[], selected: string): Record<string, unknown> {
  return {
    choice: selected,
    confidence: 1,
    probabilities: Object.fromEntries(ids.map((id) => [id, id === selected ? 1 : 0])),
  };
}

/** One recorded history entry, as the harness stores it. */
export function entry(mutations: Partial<Entry> = {}): Entry {
  return {
    step: 0,
    action: "Action",
    kind: "click",
    choice: "e1",
    probability: 1,
    confidence: 1,
    latency_ms: 10,
    text: null,
    text_helper: null,
    text_latency_ms: null,
    operation: "CLICK",
    target: "1",
    healed: false,
    heal_reason: null,
    page_changed: true,
    url: "https://example.test/",
    usage: {},
    executed_ms: 1,
    elapsed_ms: 1,
    ...mutations,
  };
}

/** A decision as the harness stores it, for tests that start from a predicted state. */
export function decision(action = "e1"): Record<string, unknown> {
  return {
    choice: action,
    operation: "TYPE_TEXT",
    target: "1",
    confidence: 1,
    probabilities: { [action]: 1 },
    operation_probabilities: { TYPE_TEXT: 1 },
    target_probabilities: {},
    target_confidence: null,
    raw_answers: {},
    model: "stub",
    usage: {},
    latency_ms: 10,
    request: {},
  };
}

type Questions = Record<string, { criteria: Record<string, unknown> }>;

export type ModelOptions = {
  /** The operation the provider picks; the first one by default. One per call, in order and on repeat, when a list is given. */
  readonly operation?: string | readonly string[];
  /** The target index the provider picks per head name; the first one by default. */
  readonly targets?: Record<string, string>;
};

/** The operation of one call: the scripted list is walked, in order, and then from its start again. */
function asked(value: string | readonly string[] | undefined, call: number): string | undefined {
  if (typeof value !== "object") return value;
  return value[call % value.length];
}

export type Model = Http & {
  readonly requests: Request[];
  readonly urls: string[];
  readonly keys: string[];
};

/** A decision provider that answers every question it is asked, in the order it is asked. */
export function model(options: ModelOptions = {}): Model {
  const requests: Request[] = [];
  const urls: string[] = [];
  const keys: string[] = [];
  let calls = 0;
  return {
    requests,
    urls,
    keys,
    async post(url, key, body) {
      const request = body as Request;
      requests.push(request);
      urls.push(url);
      keys.push(key);
      const questions = request.questions as unknown as Questions;
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(questions)) {
        const members = Object.keys(question.criteria);
        const wanted = name === "operation"
          ? asked(options.operation, calls) ?? members[0]
          : options.targets?.[name] ?? members[0];
        const selected = members.includes(wanted) ? wanted : members[0];
        answers[name] = choice(members, selected);
      }
      calls += 1;
      return { model: "stub", usage: { input_tokens: 3 }, answers };
    },
  };
}

export type TextModelOptions = {
  /** The JSON the text model returns; a single `text` key by default. */
  readonly content?: string;
  /** Fails every request with this value instead of answering. */
  readonly failure?: unknown;
};

export type TextModel = Http & { readonly bodies: Record<string, unknown>[] };

/** A text provider that answers one field value per request. */
export function textModel(options: TextModelOptions = {}): TextModel {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    async post(_url, _key, body) {
      bodies.push(body as Record<string, unknown>);
      if (options.failure !== undefined) throw options.failure;
      return { choices: [{ message: { content: options.content ?? '{"text":"Zurich"}' } }], usage: {} };
    },
  };
}

export type HealModelOptions = {
  /** The JSON the heal model returns; a click on the second element by default. */
  readonly content?: string;
  /** Fails every request with this value instead of answering. */
  readonly failure?: unknown;
};

export type HealModel = Http & {
  readonly bodies: Record<string, unknown>[];
  readonly urls: string[];
  readonly keys: string[];
};

/** A heal provider that answers one move per request. */
export function healModel(options: HealModelOptions = {}): HealModel {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const keys: string[] = [];
  return {
    bodies,
    urls,
    keys,
    async post(url, key, body) {
      bodies.push(body as Record<string, unknown>);
      urls.push(url);
      keys.push(key);
      if (options.failure !== undefined) throw options.failure;
      const content = options.content ?? '{"operation":"CLICK","target":"2","reason":"Try the other button."}';
      return { choices: [{ message: { content } }], model: "heal-stub", usage: { input_tokens: 5 } };
    },
  };
}

export type Provider = Http & { readonly decisions: Model; readonly texts: TextModel; readonly heals: HealModel };

/** One request body belongs to the heal model when it carries a healing instruction as its system message. */
function isHeal(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return false;
  const [first] = messages;
  if (typeof first !== "object" || first === null) return false;
  return INSTRUCTIONS.includes((first as { content?: string }).content ?? "");
}

/** One provider double that answers the decision model, the text model, and the heal model. */
export function provider(
  options: { decision?: ModelOptions; text?: TextModelOptions; heal?: HealModelOptions } = {},
): Provider {
  const decisions = model(options.decision);
  const texts = textModel(options.text);
  const heals = healModel(options.heal);
  return {
    decisions,
    texts,
    heals,
    post: (url, key, body) => {
      if (isRequest(body)) return decisions.post(url, key, body);
      if (isHeal(body)) return heals.post(url, key, body);
      return texts.post(url, key, body);
    },
  };
}

/** Whether a request body belongs to the decision model instead of the text model. */
function isRequest(body: unknown): boolean {
  return typeof body === "object" && body !== null && "questions" in body;
}

export type Acted = { readonly action: Action; readonly text: string | null };

/** A queue that reports an empty state instead of throwing. */
type Queue<T> = { push(value: T): void; next(): T | undefined };

function queue<T>(): Queue<T> {
  const items: T[] = [];
  return {
    push: (value) => void items.push(value),
    next: () => items.shift(),
  };
}

export type Stub = {
  readonly port: BrowserPort;
  /** The page as the port currently reports it. */
  page: () => Page;
  /** Replaces the observed page, keeping every field the caller did not set. */
  mutate: (mutations: Partial<Page>) => Page;
  /** How many times the page was observed. */
  observations: () => number;
  /** Whether each observation asked for a screenshot, in order. */
  flags: () => boolean[];
  /** How many times the port was closed. */
  closes: () => number;
  /** Every action the harness executed, in order. */
  acts: () => Acted[];
  /** Fails the next observation with this value. */
  breakObservation: (failure: unknown) => void;
  /** Fails the next action with this value. */
  breakAction: (failure: unknown) => void;
  /** Answers the next freshness check with this value. */
  answerFresh: (value: Freshness) => void;
};

export type StubOptions = {
  /** Milliseconds every port call takes, to give a run a measurable pace. */
  readonly pace?: number;
};

/** Puts one environment variable back exactly as it was, unset included. */
export function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** A browser port that never touches a real page and reports what it was asked to do. */
export function stub(initial: Page = page(), options: StubOptions = {}): Stub {
  let current = initial;
  const acted: Acted[] = [];
  const requested: boolean[] = [];
  const observationFailures = queue<unknown>();
  const actionFailures = queue<unknown>();
  const freshness = queue<Freshness>();
  let observed = 0;
  let closed = 0;
  const pace = async (): Promise<void> => {
    if (options.pace) await Bun.sleep(options.pace);
  };
  return {
    page: () => current,
    mutate(mutations) {
      current = { ...current, ...mutations };
      return current;
    },
    observations: () => observed,
    flags: () => requested,
    closes: () => closed,
    acts: () => acted,
    breakObservation: (failure) => observationFailures.push(failure),
    breakAction: (failure) => actionFailures.push(failure),
    answerFresh: (value) => freshness.push(value),
    port: {
      async observe(screenshot) {
        await pace();
        observed += 1;
        requested.push(screenshot);
        const failure = observationFailures.next();
        if (failure !== undefined) throw failure;
        return current;
      },
      async fresh() {
        await pace();
        return freshness.next() ?? { kind: "fresh" };
      },
      async act(action, _page, text) {
        await pace();
        const failure = actionFailures.next();
        if (failure !== undefined) throw failure;
        acted.push({ action, text: text ?? null });
      },
      async close() {
        closed += 1;
      },
    },
  };
}

export type Call = { readonly method: string; readonly params: Record<string, unknown>; readonly sessionId?: string };

export type Cdp = Caller & {
  readonly calls: Call[];
  /** The expressions the browser was asked to evaluate, in order. */
  readonly expressions: string[];
  /** Answers the next calls of a method, in order; an `Error` is thrown instead of answered. */
  reply(method: string, ...values: unknown[]): void;
  /** Answers the next evaluations, in order; `{ result: { value } }` by default. */
  replyRead(...values: unknown[]): void;
  /** Fails the next evaluations, in order. */
  breakRead(...failures: unknown[]): void;
  /** The methods the browser was asked to run, in order. */
  methods(): string[];
};

type Scripted = { readonly reply: unknown } | { readonly fail: unknown };

/** A Chrome DevTools Protocol caller that answers from scripted replies. */
export function cdp(): Cdp {
  const calls: Call[] = [];
  const expressions: string[] = [];
  const reads = queue<Scripted>();
  const replies = new Map<string, Queue<unknown>>();
  return {
    calls,
    expressions,
    methods: () => calls.map((call) => call.method),
    reply(method, ...values) {
      const answered = replies.get(method) ?? queue<unknown>();
      replies.set(method, answered);
      for (const value of values) answered.push(value);
    },
    replyRead: (...values) => {
      for (const value of values) reads.push({ reply: value });
    },
    breakRead: (...failures) => {
      for (const failure of failures) reads.push({ fail: failure });
    },
    async call(method, params = {}, sessionId) {
      calls.push({ method, params, sessionId });
      if (method === "Runtime.evaluate") {
        expressions.push(String(params.expression));
        const scripted = reads.next();
        if (scripted === undefined) return { result: { value: undefined } };
        if ("fail" in scripted) throw scripted.fail;
        return scripted.reply;
      }
      const scripted = replies.get(method)?.next();
      if (scripted instanceof Error) throw scripted;
      if (scripted !== undefined) return scripted;
      return {};
    },
  };
}

/** A browser session bound to a fake protocol caller. */
export function session(caller: Cdp, afterInput: Action | null = null): Session {
  return { caller, client: create(caller, "session-1"), targetId: "target-1", afterInput };
}

/** An evaluation reply that reports the value the page produced. */
export function value(answer: unknown): { result: { value: unknown } } {
  return { result: { value: answer } };
}

/** An evaluation reply that reports a document change. */
export const CHANGED: { exceptionDetails: Record<string, unknown> } = { exceptionDetails: {} };

/** The page marker read that reports an unchanged page. */
export const UNCHANGED = value("m1");
