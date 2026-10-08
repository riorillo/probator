import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectOptions, Connection } from "../src/browser/port.ts";
import type { BrowserPort, Page } from "../src/browser/types.ts";
import { InputError, RuntimeFailure, StalePage } from "../src/errors.ts";
import { attach, open, type Session } from "../src/harness/agent.ts";
import { decision, describe as describeSettings, frames, heal, healing, screenshots, vision } from "../src/harness/config.ts";
import { frame, start } from "../src/harness/recording.ts";
import { looping } from "../src/harness/loop.ts";
import { GAVE_UP } from "../src/heal/prompts.ts";
import type { Entry } from "../src/history.ts";
import type { HealModelOptions, ModelOptions, Stub, TextModelOptions } from "./support.ts";
import { ACTIONS, SCROLLS, entry, page, provider, restore, stub } from "./support.ts";

// The environment of the machine running the tests must never turn healing on behind a test's back.
delete process.env.HEAL_MODEL_API_KEY;
delete process.env.HEAL_MODEL_BASE_URL;
delete process.env.HEAL_MODEL;
delete process.env.HEAL_MODEL_REASONING;

const URL = "https://example.test/";
const GOAL = "Find a book";
const HEAL_URL = "https://heal.example/v1";
const CLICK = { operation: "CLICK", targets: { click_target: "1" } } as const;
const OVER = "This run is over. Start a new one.";
const BEFORE_ACT = "Observe and choose before executing.";

type Options = {
  readonly page?: Partial<Page>;
  readonly decision?: ModelOptions;
  readonly text?: TextModelOptions;
  /** Gives the run a healer; without it a repeated run is blocked instead. */
  readonly heal?: HealModelOptions;
  readonly goals?: string | readonly string[];
  /** The directory that records the frames of the run. */
  readonly recordDir?: string;
  /** Milliseconds every port call takes, to give a run a measurable pace. */
  readonly pace?: number;
};

type Harness = {
  readonly browser: Stub;
  readonly http: ReturnType<typeof provider>;
  readonly opened: Session;
};

/** A run over a scripted page, a scripted provider, and no browser at all. */
async function harness(options: Options = {}): Promise<Harness> {
  const browser = stub(page(options.page), { pace: options.pace });
  const http = provider({ decision: options.decision, text: options.text, heal: options.heal });
  const opened = await open(URL, options.goals ?? GOAL, {
    port: browser.port,
    http,
    decisionIdentity: "test-decision-model",
    decisionCredential: "decision-key",
    textIdentity: "test-text-model",
    textCredential: "text-key",
    recordDir: options.recordDir,
    ...(options.heal === undefined
      ? {}
      : { healAddress: HEAL_URL, healCredential: "heal-key", healIdentity: "test-heal-model" }),
  });
  return { browser, http, opened };
}

/** The context a heal request carried: the user message of the OpenAI-compatible payload. */
function handed(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as { readonly role: string; readonly content: string }[];
  return JSON.parse(messages[1].content) as Record<string, unknown>;
}

/** The history of a run, as the harness records it. */
function history(opened: Session): Entry[] {
  return opened.snapshot().history as Entry[];
}

/** The status of a run. */
function status(opened: Session): unknown {
  return opened.snapshot().status;
}

/** A stand-in for the browser connector: it hands back a port and records what it was asked for. */
function connector(
  opening: (url: string, options: ConnectOptions) => Promise<BrowserPort>,
): (url: string, options: ConnectOptions) => Promise<Connection> {
  return (url, options) => opening(url, options).then((port) => ({ port }) as Connection);
}

describe("session", () => {
  test("replaces the application goal without opening another browser session", async () => {
    const { browser, opened } = await harness();
    opened.setGoal("Confirm the order");
    expect(opened.snapshot().goal).toBe("Confirm the order");
    await opened.close();
    expect(browser.closes()).toBe(1);
  });

  test("rejects a blank application goal", async () => {
    const { opened } = await harness();
    expect(() => opened.setGoal("  ")).toThrow("A goal is required.");
    await opened.close();
  });

  test("refuses a goal without content", async () => {
    await expect(open(URL, "   ")).rejects.toThrow(InputError);
    await expect(open(URL, "   ")).rejects.toThrow("A goal is required.");
  });

  test("observes the page once and reports the snapshot of a fresh run", async () => {
    const { browser, opened } = await harness();

    expect(browser.observations()).toBe(1);
    expect(browser.flags()).toEqual([false]);
    const snapshot = opened.snapshot();
    expect(Object.keys(snapshot)).toEqual([
      "goal",
      "page",
      "decision",
      "history",
      "status",
      "plan",
      "plan_index",
      "decisions",
      "text_calls",
      "heal_calls",
      "elapsed_ms",
      "started_at",
      "record",
      "vision",
      "elements",
    ]);
    expect(snapshot.goal).toBe(GOAL);
    expect(snapshot.plan).toEqual([GOAL]);
    expect(snapshot.plan_index).toBe(0);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.decision).toBeNull();
    expect(snapshot.history).toEqual([]);
    expect(snapshot.started_at).toBeNull();
    expect(snapshot.record).toBe(false);
    expect(snapshot.vision).toBe(false);
    expect(snapshot.elements).toEqual([
      { index: "1", label: "Search", role: "textbox", value: "", operations: ["TYPE_TEXT", "CLICK"] },
      { index: "2", label: "Go", role: "button", value: "", operations: ["CLICK"] },
    ]);
  });

  test("joins a list of goals into one task", async () => {
    const { opened } = await harness({ goals: ["Find a book", "Report the price"] });

    expect(opened.snapshot().goal).toBe("Find a book\nReport the price");
    expect(opened.snapshot().plan).toEqual(["Find a book\nReport the price"]);
  });

  test("refuses an unknown command", async () => {
    const { opened } = await harness();

    await expect(opened.command("jump")).rejects.toThrow(InputError);
    await expect(opened.command("jump")).rejects.toThrow("Unknown command.");
  });

  test("closes the port when the first observation fails", async () => {
    const browser = stub();
    browser.breakObservation(new StalePage("The document is navigating."));

    await expect(open(URL, GOAL, { port: browser.port })).rejects.toThrow(StalePage);
    expect(browser.closes()).toBe(1);
  });

  test("closes the port when the session ends", async () => {
    const { browser, opened } = await harness();

    await opened.close();

    expect(browser.closes()).toBe(1);
  });
});

describe("predict", () => {
  test("chooses without touching the page", async () => {
    const { browser, opened } = await harness();

    const snapshot = await opened.command("predict");

    expect(snapshot.status).toBe("predicted");
    expect(browser.acts()).toEqual([]);
    expect(browser.observations()).toBe(1);
    const decision = snapshot.decision as Record<string, unknown>;
    expect(decision.choice).toBe("e1");
    expect(decision.operation).toBe("TYPE_TEXT");
    expect(decision.target).toBe("1");
    const recorded = snapshot.decisions as Record<string, unknown>[];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].choice).toBe("e1");
    expect(recorded[0].fingerprint).toBe("f1");
    expect(typeof recorded[0].elapsed_ms).toBe("number");
  });

  test("re-observes the page before it chooses when the page moved on", async () => {
    const { browser, http, opened } = await harness();
    browser.answerFresh({ kind: "changed" });
    browser.mutate({ text: "Second page", fingerprint: "f2" });

    const snapshot = await opened.command("predict");

    expect(browser.observations()).toBe(2);
    expect(http.decisions.requests[0].state.page?.text).toBe("Second page");
    expect((snapshot.decisions as Record<string, unknown>[])[0].fingerprint).toBe("f2");
  });

  test("reports a page it cannot read instead of choosing", async () => {
    const { browser, http, opened } = await harness();
    browser.answerFresh({ kind: "unreadable", failure: new StalePage("The document is navigating.") });

    await expect(opened.command("predict")).rejects.toThrow("The document is navigating.");
    expect(http.decisions.requests).toEqual([]);
    expect(status(opened)).toBe("ready");
    expect(opened.snapshot().decision).toBeNull();
  });

  test("stops at the model call limit", async () => {
    const { opened } = await harness();

    for (let call = 0; call < 120; call += 1) await opened.command("predict");

    await expect(opened.command("predict")).rejects.toThrow("The model call limit was reached.");
    expect((opened.snapshot().decisions as unknown[]).length).toBe(120);
  });
});

describe("tick", () => {
  test("chooses and runs one action", async () => {
    const { browser, opened } = await harness({ decision: CLICK });

    const snapshot = await opened.command("tick");

    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2"]);
    expect(snapshot.status).toBe("ready");
    expect(history(opened)).toHaveLength(1);
    expect(history(opened)[0].action).toBe("Open Search");
    expect(history(opened)[0].page_changed).toBe(false);
  });

  test("acts on the page it chose from, whatever fingerprint the caller believes", async () => {
    const { browser, opened } = await harness({ decision: CLICK });

    await opened.command("tick", { fingerprint: "outdated" });

    expect(browser.acts()).toHaveLength(1);
  });

  test("runs until the goal is done", async () => {
    const { browser, opened } = await harness({ decision: { operation: "DONE" } });

    const snapshots = [];
    for await (const snapshot of opened.run()) snapshots.push(snapshot);

    expect(snapshots).toHaveLength(1);
    expect(status(opened)).toBe("done");
    expect(opened.snapshot().plan_index).toBe(1);
    expect(browser.acts()).toEqual([]);
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("ends the run as blocked when the model cannot progress", async () => {
    const { opened } = await harness({ decision: { operation: "BLOCKED" } });

    await opened.command("tick");

    expect(status(opened)).toBe("blocked");
    expect(opened.snapshot().plan_index).toBe(0);
  });

  test("blocks a run that never changes the page", async () => {
    const { browser, http, opened } = await harness({ decision: CLICK });

    for (let step = 0; step < 3; step += 1) await opened.command("tick");

    expect(status(opened)).toBe("blocked");
    expect(browser.acts()).toHaveLength(3);
    expect(history(opened).map((entry) => entry.page_changed)).toEqual([false, false, false]);
    // A run without a healer never asks for one: it is blocked exactly as it always was.
    expect(http.heals.bodies).toEqual([]);
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("stops at the action limit", async () => {
    const { browser, opened } = await harness({ decision: CLICK });

    for (let step = 0; step < 60; step += 1) {
      browser.mutate({ fingerprint: `f${step + 2}` });
      await opened.command("tick");
    }
    browser.mutate({ fingerprint: "later" });

    await expect(opened.command("tick")).rejects.toThrow("Stopped at the limit of 60 actions.");
    expect(status(opened)).toBe("blocked");
    expect(history(opened)).toHaveLength(60);
    expect(history(opened).at(-1)?.step).toBe(60);
    expect(browser.acts()).toHaveLength(60);
  });

  test("never blocks on loading waits", async () => {
    const { browser, opened } = await harness({ decision: { operation: "WAIT" } });

    for (let step = 0; step < 5; step += 1) await opened.command("tick");

    expect(status(opened)).toBe("ready");
    expect(history(opened)).toHaveLength(5);
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["wait", "wait", "wait", "wait", "wait"]);
    expect(history(opened).map((entry) => entry.kind)).toEqual(["wait", "wait", "wait", "wait", "wait"]);
  });

  test("recovers a run whose page changed while it was choosing", async () => {
    const { browser, http, opened } = await harness({ decision: CLICK });
    browser.answerFresh({ kind: "changed" });
    browser.mutate({ text: "Second page", fingerprint: "f2" });

    const snapshot = await opened.command("tick");

    expect(http.decisions.requests[0].state.page?.text).toBe("Second page");
    expect(snapshot.page).toMatchObject({ text: "Second page" });
    expect(snapshot.status).toBe("ready");
    expect(browser.acts()).toHaveLength(1);
  });

  test("recovers a run whose page cannot be read while it was choosing", async () => {
    const { browser, opened } = await harness({ decision: CLICK });
    browser.answerFresh({ kind: "unreadable", failure: new StalePage("The document is navigating.") });

    const snapshot = await opened.command("tick");

    expect(snapshot.status).toBe("ready");
    expect(snapshot.decision).toBeNull();
    expect(browser.acts()).toEqual([]);
    expect(browser.observations()).toBe(2);
  });

  test("recovers a run whose page changed while it was acting", async () => {
    const { browser, opened } = await harness({ decision: CLICK });
    browser.breakAction(new StalePage("The target changed or is covered. Observe again."));

    const snapshot = await opened.command("tick");

    expect(snapshot.status).toBe("ready");
    expect(snapshot.decision).toBeNull();
    expect(browser.observations()).toBe(2);
    expect(history(opened)).toEqual([]);
  });
});

describe("loop", () => {
  /** One recorded step: a scroll control has no target, every other operation has an index. */
  const step = (operation: string, page_changed = true): Entry => ({
    ...entry({ page_changed }),
    kind: operation.startsWith("SCROLL") ? "scroll" : "click",
    operation,
    target: operation.startsWith("SCROLL") ? null : "1",
  });

  test("reads no loop into a history that does not repeat enough", () => {
    expect(looping([step("CLICK"), step("CLICK")])).toBeNull();
    expect(looping([step("SCROLL_UP"), step("SCROLL_DOWN"), step("SCROLL_UP")])).toBeNull();
  });

  test("reads a page that never changed", () => {
    const steps = [step("CLICK", false), step("CLICK", false), step("CLICK", false)];
    expect(looping(steps)).toMatchObject({ kind: "unchanged", steps });
  });

  test("reads one move chosen three times on a page that keeps changing", () => {
    const steps = [step("CLICK"), step("CLICK"), step("CLICK")];
    expect(looping(steps)).toMatchObject({ kind: "repeated", steps });
  });

  test("never reads a wait into a loop", () => {
    const waiting = entry({ kind: "wait", operation: "WAIT", page_changed: false });
    expect(looping([step("CLICK", false), step("CLICK", false), waiting])).toBeNull();
  });

  test("reads two moves that alternate, none of which repeats three times", () => {
    const steps = [step("SCROLL_UP"), step("SCROLL_DOWN"), step("SCROLL_UP"), step("SCROLL_DOWN")];
    expect(looping(steps)).toMatchObject({ kind: "oscillating", steps });
  });

  test("reads a cycle of three moves that goes round twice", () => {
    const steps = [
      step("CLICK"),
      step("SCROLL_DOWN"),
      step("SCROLL_UP"),
      step("CLICK"),
      step("SCROLL_DOWN"),
      step("SCROLL_UP"),
    ];
    expect(looping(steps)).toMatchObject({ kind: "oscillating" });
  });

  test("reads a page that never changed before it reads a cycle", () => {
    const steps = [
      step("SCROLL_UP", false),
      step("SCROLL_DOWN", false),
      step("SCROLL_UP", false),
      step("SCROLL_DOWN", false),
    ];
    expect(looping(steps)).toMatchObject({ kind: "unchanged" });
  });

  test("reads no cycle into moves that keep changing", () => {
    expect(looping([step("SCROLL_UP"), step("SCROLL_DOWN"), step("SCROLL_UP"), step("CLICK")])).toBeNull();
    expect(
      looping([step("CLICK"), step("SCROLL_UP"), step("SCROLL_DOWN"), step("SCROLL_UP"), step("CLICK")]),
    ).toBeNull();
  });
});

describe("healing", () => {
  test("heals a loop that never changes the page", async () => {
    const { browser, http, opened } = await harness({ decision: CLICK, heal: {} });

    for (let step = 0; step < 4; step += 1) await opened.command("tick");

    // The model chose three times, and the healer chose the fourth step in its place.
    expect(http.decisions.requests).toHaveLength(3);
    expect(http.heals.urls).toEqual([`${HEAL_URL}/chat/completions`]);
    expect(http.heals.keys).toEqual(["heal-key"]);
    expect(http.heals.bodies[0].model).toBe("test-heal-model");
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2", "e2", "e2", "e3"]);
    expect(history(opened).map((entry) => entry.healed)).toEqual([false, false, false, true]);
    expect(history(opened).map((entry) => entry.heal_reason)).toEqual([
      null,
      null,
      null,
      "Try the other button.",
    ]);
    expect(history(opened)[3]).toMatchObject({ page_changed: false, action: "Go", choice: "e3", healed: true });
    expect(opened.snapshot().heal_calls).toEqual([
      expect.objectContaining({
        healed: true,
        choice: "e3",
        operation: "CLICK",
        target: "2",
        reason: "Try the other button.",
        model: "heal-stub",
      }),
    ]);
    expect(status(opened)).toBe("ready");
  });

  test("returns control to the model as soon as the healed move breaks the loop", async () => {
    const { browser, http, opened } = await harness({ decision: CLICK, heal: {} });

    for (let step = 0; step < 4; step += 1) {
      // The page moves on after every step, so only the repeated move is a loop.
      browser.mutate({ fingerprint: `f${step + 2}` });
      await opened.command("tick");
    }

    expect(history(opened).map((entry) => entry.page_changed)).toEqual([true, true, true, true]);
    expect(http.heals.bodies).toHaveLength(1);
    expect(handed(http.heals.bodies[0])).toMatchObject({
      goal: GOAL,
      loop: { kind: "repeated" },
      recent_actions: expect.arrayContaining([expect.objectContaining({ operation: "CLICK", target: "1" })]),
    });
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2", "e2", "e2", "e3"]);

    browser.mutate({ fingerprint: "f6" });
    await opened.command("tick");

    // The step of the healer was a different move, so the model is asked again and chooses for itself.
    expect(http.heals.bodies).toHaveLength(1);
    expect(http.decisions.requests).toHaveLength(4);
    expect(browser.acts().at(-1)?.action.id).toBe("e2");
    expect(history(opened).at(-1)?.healed).toBe(false);
  });

  test("keeps the choice of the model when the healer answers a move that was not offered", async () => {
    const { browser, http, opened } = await harness({
      decision: CLICK,
      heal: { content: '{"operation":"JUMP","target":"2"}' },
    });

    for (let step = 0; step < 4; step += 1) await opened.command("tick");

    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2", "e2", "e2", "e2"]);
    // The healer was asked once, and the decision model was asked for every step of the run.
    expect(http.heals.bodies).toHaveLength(1);
    expect(http.decisions.requests).toHaveLength(4);
    expect(history(opened)[3].healed).toBe(false);
    expect(opened.snapshot().heal_calls).toEqual([
      expect.objectContaining({
        healed: false,
        error: "The heal model returned no usable move: the run keeps its own choice.",
      }),
    ]);
    expect(status(opened)).toBe("ready");
  });

  test("keeps the choice of the model when the healer fails", async () => {
    const { browser, opened } = await harness({
      decision: CLICK,
      heal: { failure: new RuntimeFailure("The healer is down.") },
    });

    for (let step = 0; step < 4; step += 1) await opened.command("tick");

    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2", "e2", "e2", "e2"]);
    expect(opened.snapshot().heal_calls).toEqual([
      expect.objectContaining({ healed: false, error: "The healer is down." }),
    ]);
    expect(status(opened)).toBe("ready");
  });

  test("heals a run that scrolls up and down the same page", async () => {
    const { browser, http, opened } = await harness({
      // The model alternates the two scroll controls, as it does when it loses the target it wanted.
      decision: { operation: ["SCROLL_UP", "SCROLL_DOWN"] },
      page: { actions: [...ACTIONS, ...SCROLLS] },
      heal: {},
    });

    for (let step = 0; step < 5; step += 1) {
      // Scrolling moves the page on every step, so the cycle is the only sign of a loop.
      browser.mutate({ fingerprint: `f${step + 2}` });
      await opened.command("tick");
    }

    expect(browser.acts().map((acted) => acted.action.id)).toEqual([
      "scroll_up",
      "scroll_down",
      "scroll_up",
      "scroll_down",
      "e3",
    ]);
    expect(history(opened).map((entry) => entry.healed)).toEqual([false, false, false, false, true]);
    // The model chose four times, and the healer chose the fifth step in its place.
    expect(http.decisions.requests).toHaveLength(4);
    expect(handed(http.heals.bodies[0])).toMatchObject({
      goal: GOAL,
      loop: {
        kind: "oscillating",
        steps: [
          { operation: "SCROLL_UP" },
          { operation: "SCROLL_DOWN" },
          { operation: "SCROLL_UP" },
          { operation: "SCROLL_DOWN" },
        ],
      },
    });
    expect(opened.snapshot().heal_calls).toEqual([expect.objectContaining({ healed: true, choice: "e3" })]);

    browser.mutate({ fingerprint: "f7" });
    await opened.command("tick");

    // The healed move broke the cycle, so the model drives the run again: it chose the sixth step.
    expect(http.heals.bodies).toHaveLength(1);
    expect(http.decisions.requests).toHaveLength(5);
    expect(browser.acts().at(-1)?.action.id).toBe("scroll_up");
    expect(history(opened).at(-1)?.healed).toBe(false);
    expect(status(opened)).toBe("ready");
  });

  test("leaves a run that oscillates alone when no healer was given", async () => {
    const { browser, http, opened } = await harness({
      decision: { operation: ["SCROLL_UP", "SCROLL_DOWN"] },
      page: { actions: [...ACTIONS, ...SCROLLS] },
    });

    for (let step = 0; step < 6; step += 1) {
      browser.mutate({ fingerprint: `f${step + 2}` });
      await opened.command("tick");
    }

    expect(http.heals.bodies).toEqual([]);
    expect(browser.acts().map((acted) => acted.action.id)).toEqual([
      "scroll_up",
      "scroll_down",
      "scroll_up",
      "scroll_down",
      "scroll_up",
      "scroll_down",
    ]);
    expect(status(opened)).toBe("ready");
  });

  test("blocks the run once the healing budget is spent", async () => {
    const { browser, http, opened } = await harness({ decision: CLICK, heal: {} });

    for (let step = 0; step < 6; step += 1) await opened.command("tick");

    expect(http.heals.bodies).toHaveLength(3);
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e2", "e2", "e2", "e3", "e3", "e3"]);
    expect(history(opened).filter((entry) => entry.healed === true)).toHaveLength(3);
    expect(status(opened)).toBe("blocked");
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("never heals a run that only waits", async () => {
    const { http, opened } = await harness({ decision: { operation: "WAIT" }, heal: {} });

    for (let step = 0; step < 5; step += 1) await opened.command("tick");

    expect(http.heals.bodies).toEqual([]);
    expect(status(opened)).toBe("ready");
  });

  test("heals a run whose own model gives up", async () => {
    const { browser, http, opened } = await harness({
      // The model finds no way forward on the first step, and drives the run again on the second.
      decision: { operation: ["BLOCKED", "CLICK"] },
      heal: {},
    });

    const snapshot = await opened.command("tick");

    // The model gave up on a page it could still move, so the healer is asked what it missed.
    expect(http.decisions.requests).toHaveLength(1);
    expect(http.heals.bodies).toHaveLength(1);
    expect((http.heals.bodies[0].messages as unknown[])[0]).toEqual({ role: "system", content: GAVE_UP });
    expect(handed(http.heals.bodies[0])).toMatchObject({
      goal: GOAL,
      loop: { kind: "blocked", steps: [] },
      recent_actions: [],
    });
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e3"]);
    expect(history(opened)[0]).toMatchObject({
      action: "Go",
      choice: "e3",
      healed: true,
      heal_reason: "Try the other button.",
    });
    expect(opened.snapshot().heal_calls).toEqual([
      expect.objectContaining({ healed: true, choice: "e3", operation: "CLICK", target: "2" }),
    ]);
    expect(snapshot.status).toBe("ready");

    browser.mutate({ fingerprint: "f2" });
    await opened.command("tick");

    // The healed move was run like any other, and the model is back in charge of the run.
    expect(http.heals.bodies).toHaveLength(1);
    expect(http.decisions.requests).toHaveLength(2);
    expect(browser.acts().at(-1)?.action.id).toBe("e2");
    expect(history(opened).at(-1)?.healed).toBe(false);
  });

  test("keeps the ending of the model when the healer gives up too", async () => {
    const { browser, http, opened } = await harness({
      decision: { operation: "BLOCKED" },
      heal: { content: '{"operation":"BLOCKED","reason":"Nothing here leads to the goal."}' },
    });

    await opened.command("tick");

    // Both models agree, so the run stops where the model left it, with the heal it spent on the record.
    expect(http.heals.bodies).toHaveLength(1);
    expect(browser.acts()).toEqual([]);
    expect(history(opened)).toEqual([]);
    expect(opened.snapshot().heal_calls).toEqual([
      expect.objectContaining({ healed: true, choice: "BLOCKED", reason: "Nothing here leads to the goal." }),
    ]);
    expect(status(opened)).toBe("blocked");
    expect(opened.snapshot().plan_index).toBe(0);
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("keeps the ending of the model when the healer fails", async () => {
    const { http, opened } = await harness({
      decision: { operation: "BLOCKED" },
      heal: { failure: new RuntimeFailure("The healer is down.") },
    });

    const snapshot = await opened.command("tick");

    // The heal is spent and on the record, and the ending the model chose is the one that stands.
    expect(http.heals.bodies).toHaveLength(1);
    expect(snapshot.heal_calls).toEqual([
      expect.objectContaining({ healed: false, error: "The healer is down." }),
    ]);
    expect((snapshot.decisions as unknown[]).length).toBe(1);
    expect(status(opened)).toBe("blocked");
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("blocks a run whose model gives up when no healer was given", async () => {
    const { http, opened } = await harness({ decision: { operation: "BLOCKED" } });

    await opened.command("tick");

    // A run without a healer is blocked exactly as it always was, and it asks no heal model at all.
    expect(http.heals.bodies).toEqual([]);
    expect(opened.snapshot().heal_calls).toEqual([]);
    expect(status(opened)).toBe("blocked");
    await expect(opened.command("tick")).rejects.toThrow(OVER);
  });

  test("hands a giving-up model to the healer only as long as it has the budget", async () => {
    const { browser, http, opened } = await harness({
      decision: { operation: "BLOCKED" },
      // A wait is never a loop the run could be healed for, so only the budget can stop the healing.
      heal: { content: '{"operation":"WAIT","reason":"The results are still loading."}' },
    });

    for (let step = 0; step < 3; step += 1) await opened.command("tick");

    expect(http.heals.bodies).toHaveLength(3);
    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["wait", "wait", "wait"]);
    expect(status(opened)).toBe("ready");

    await opened.command("tick");

    // The fourth ending has no heal left: the model keeps the choice it made.
    expect(http.heals.bodies).toHaveLength(3);
    expect(http.decisions.requests).toHaveLength(4);
    expect(browser.acts()).toHaveLength(3);
    expect(status(opened)).toBe("blocked");
  });
});

describe("act", () => {
  test("refuses to act before a decision was made", async () => {
    const { browser, opened } = await harness();

    await expect(opened.command("act")).rejects.toThrow(BEFORE_ACT);
    expect(browser.acts()).toEqual([]);
  });

  test("refuses to act on a page the decision was not made from", async () => {
    const { browser, opened } = await harness();
    await opened.command("predict");

    await expect(opened.command("act", { fingerprint: "other" })).rejects.toThrow(BEFORE_ACT);
    expect(browser.acts()).toEqual([]);
  });

  test("consumes the decision before it mutates the page", async () => {
    const { browser, opened } = await harness();
    await opened.command("predict");
    browser.answerFresh({ kind: "changed" });

    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow(
      "The page changed before the text was generated. Choose again.",
    );

    expect(browser.acts()).toEqual([]);
    expect(opened.snapshot().decision).toBeNull();
    expect(status(opened)).toBe("predicted");
  });

  test("writes the text of a field and records the helper", async () => {
    const { browser, http, opened } = await harness();
    await opened.command("predict");

    await opened.command("act", { fingerprint: "f1" });

    expect(browser.acts()).toEqual([{ action: expect.objectContaining({ id: "e1" }), text: "Zurich" }]);
    expect(http.texts.bodies).toHaveLength(1);
    const entry = history(opened)[0];
    expect(entry.text).toBe("Zurich");
    expect(entry.text_helper).toBe("test-text-model");
    expect(typeof entry.text_latency_ms).toBe("number");
    expect(opened.snapshot().text_calls).toEqual([
      expect.objectContaining({ field: "Search", value: "Zurich" }),
    ]);
  });

  test("reuses the text of a failed attempt with an identical context", async () => {
    const { browser, http, opened } = await harness();
    await opened.command("predict");
    browser.breakAction(new StalePage("The page changed after this choice. Observe again."));

    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow(StalePage);
    expect(http.texts.bodies).toHaveLength(1);
    expect(opened.snapshot().decision).toBeNull();

    await opened.command("predict");
    await opened.command("act", { fingerprint: "f1" });

    expect(http.texts.bodies).toHaveLength(1);
    expect(browser.acts()).toEqual([{ action: expect.objectContaining({ id: "e1" }), text: "Zurich" }]);
    expect(history(opened)[0].text).toBe("Zurich");
  });

  test("writes new text when the context of the field changed", async () => {
    const { browser, http, opened } = await harness();
    await opened.command("predict");
    browser.breakAction(new StalePage("The page changed after this choice. Observe again."));
    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow(StalePage);
    browser.answerFresh({ kind: "changed" });
    browser.mutate({ text: "Different page context" });

    await opened.command("predict");
    await opened.command("act", { fingerprint: "f1" });

    expect(http.texts.bodies).toHaveLength(2);
    expect(history(opened)[0].text).toBe("Zurich");
  });

  test("reports a text model that fails without touching the page", async () => {
    const { browser, opened } = await harness({ text: { failure: new RuntimeFailure("The text is unavailable.") } });
    await opened.command("predict");

    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow("The text is unavailable.");

    expect(browser.acts()).toEqual([]);
    expect(opened.snapshot().decision).toBeNull();
    expect(history(opened)).toEqual([]);
  });

  test("records the action before a stale post-action observation", async () => {
    const { browser, opened } = await harness({ decision: { operation: "CLICK", targets: { click_target: "2" } } });
    await opened.command("predict");
    browser.breakObservation(new StalePage("The document is navigating."));

    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow("The document is navigating.");

    expect(browser.acts().map((acted) => acted.action.id)).toEqual(["e3"]);
    expect(history(opened)).toHaveLength(1);
    expect(history(opened)[0].action).toBe("Go");
    expect(history(opened)[0].page_changed).toBeNull();
  });

  test("ends the run when the decision is finite", async () => {
    const { browser, opened } = await harness({ decision: { operation: "DONE" } });
    await opened.command("predict");

    await opened.command("act", { fingerprint: "f1" });

    expect(status(opened)).toBe("done");
    expect(browser.acts()).toEqual([]);
  });

  test("returns to a ready run when the page moved on before the decision was confirmed", async () => {
    const { browser, opened } = await harness({ decision: { operation: "DONE" } });
    await opened.command("predict");
    browser.answerFresh({ kind: "changed" });

    await expect(opened.command("act", { fingerprint: "f1" })).rejects.toThrow(
      "The page changed after the choice. Choose again.",
    );

    expect(status(opened)).toBe("ready");
    expect(opened.snapshot().decision).toBeNull();
  });

  test("passes the settings of the run to both models", async () => {
    const browser = stub();
    const http = provider();
    const opened = await open(URL, GOAL, {
      port: browser.port,
      http,
      decisionAddress: "https://typesafe.example/v1/systemone",
      decisionCredential: "decision-key",
      decisionIdentity: "custom-jev",
      textAddress: "https://llm.example/v1",
      textCredential: "text-key",
      textIdentity: "custom-text",
    });

    await opened.command("predict");
    await opened.command("act", { fingerprint: "f1" });

    expect(http.decisions.urls).toEqual(["https://typesafe.example/v1/systemone"]);
    expect(http.decisions.keys).toEqual(["decision-key"]);
    expect(http.decisions.requests[0].model).toBe("custom-jev");
    expect(http.texts.bodies[0].model).toBe("custom-text");
  });
});

describe("recording", () => {
  test("names a frame after the elapsed milliseconds", () => {
    expect(frame(0)).toBe("000000.jpg");
    expect(frame(93500)).toBe("093500.jpg");
  });

  test("stores the first frame of a run and one frame per step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-recording-"));
    const { browser, opened } = await harness({
      page: { screenshot: encoded("first") },
      decision: CLICK,
      recordDir: dir,
      // A frame is named after the milliseconds of the step, so the pace keeps the two names apart.
      pace: 5,
    });
    browser.mutate({ screenshot: encoded("second"), fingerprint: "f2" });

    await opened.command("tick");

    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toBe("000000.jpg");
    expect(files[1]).toMatch(/^\d{6}\.jpg$/);
    expect(await readFile(join(dir, files[0]), "utf8")).toBe("first");
    expect(await readFile(join(dir, files[1]), "utf8")).toBe("second");
    expect(opened.snapshot().record).toBe(true);
    expect(browser.flags()).toEqual([true, true]);
    await rm(dir, { recursive: true, force: true });
  });

  test("stores a frame on its own", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-frame-"));

    await start(dir, page({ screenshot: encoded("only") }));

    expect(await readFile(join(dir, "000000.jpg"), "utf8")).toBe("only");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("browser", () => {
  test("opens the connection in the snapshot mode the run asked for", async () => {
    const browser = stub();
    const asked: { readonly url: string; readonly options: unknown }[] = [];
    const opening = connector(async (url, options) => {
      asked.push({ url, options });
      return browser.port;
    });

    expect(await attach(URL, { vision: true }, opening)).toBe(browser.port);
    expect(asked).toEqual([{ url: URL, options: { vision: true } }]);
  });

  test("opens a connection in text mode by default", async () => {
    const browser = stub();
    const asked: unknown[] = [];
    const opening = connector(async (_url, options) => {
      asked.push(options);
      return browser.port;
    });

    await attach(URL, {}, opening);
    expect(asked).toEqual([{ vision: false }]);
  });

  test("keeps the port it was handed instead of opening a browser", async () => {
    const browser = stub();
    const opened: string[] = [];
    const opening = connector(async (url) => {
      opened.push(url);
      return browser.port;
    });

    expect(await attach(URL, { port: browser.port, vision: true }, opening)).toBe(browser.port);
    expect(opened).toEqual([]);
  });
});

describe("config", () => {
  test("describes the settings in effect", () => {
    const described = describeSettings({
      decisionAddress: "https://decide.example/v1",
      decisionIdentity: "decide-model",
      textAddress: "https://text.example/v1",
      textIdentity: "text-model",
    });

    expect(described).toEqual({
      decisionAddress: "https://decide.example/v1",
      decisionIdentity: "decide-model",
      textAddress: "https://text.example/v1",
      textIdentity: "text-model",
    });
  });

  test("needs screenshots only when it records or reads the image", () => {
    expect(frames({})).toBeNull();
    expect(frames({ recordDir: "/tmp/jev" })).toBe("/tmp/jev");
    expect(screenshots({})).toBe(false);
    expect(screenshots({ screenshots: true })).toBe(true);
    expect(screenshots({ recordDir: "/tmp/jev" })).toBe(true);
    expect(screenshots({ vision: true })).toBe(true);
  });

  test("reads the image only when the run asks for it", () => {
    expect(vision({})).toBe(false);
    expect(vision({ vision: false })).toBe(false);
    expect(vision({ vision: true })).toBe(true);
    expect(decision({ vision: true }).vision).toBe(true);
    expect(decision({}).vision).toBe(false);
  });

  test("heals only a run that was given a heal credential", () => {
    expect(healing({})).toBe(false);
    expect(healing({ healCredential: "" })).toBe(false);
    // The credential of another model is never used to heal a run.
    expect(healing({ decisionCredential: "decision-key", textCredential: "text-key" })).toBe(false);
    expect(healing({ healCredential: "heal-key" })).toBe(true);

    const saved = process.env.HEAL_MODEL_API_KEY;
    process.env.HEAL_MODEL_API_KEY = "env-key";
    expect(healing({})).toBe(true);
    restore("HEAL_MODEL_API_KEY", saved);
  });

  test("keeps the settings of the healer off the settings it was not given", () => {
    expect(heal({})).toEqual({ apiKey: undefined, baseUrl: undefined, http: undefined, model: undefined });
    expect(heal({ healIdentity: "healer" })).toMatchObject({ model: "healer" });
  });
});

/** A base64 frame as the page reports it. */
function encoded(content: string): string {
  return Buffer.from(content).toString("base64");
}
