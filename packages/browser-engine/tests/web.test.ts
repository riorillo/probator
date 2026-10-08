import { describe, expect, test } from "bun:test";
import { RuntimeFailure } from "../src/errors.ts";
import * as assets from "../src/inspector/assets.ts";
import * as fields from "../web/model/fields.ts";
import * as labels from "../web/model/labels.ts";
import * as page from "../web/model/page.ts";
import * as readers from "../web/model/read.ts";
import * as report from "../web/model/report.ts";
import * as step from "../web/model/step.ts";
import * as targets from "../web/model/targets.ts";
import * as trace from "../web/model/trace.ts";
import * as client from "../web/store/client.ts";
import * as drive from "../web/store/drive.ts";
import * as screen from "../web/store/screen.ts";

const ACTIONS: readonly Record<string, unknown>[] = [
  { id: "a1", node: 1, rect: { x: 0, y: 0, w: 10, h: 10 } },
  { id: "a2", node: 2, rect: { x: 10, y: 20, w: 30, h: 40 } },
  { id: "a1", node: 1, rect: { x: 0, y: 0, w: 10, h: 10 } },
  { id: "a3", node: 3 },
];

const PAGE = {
  url: "https://example.test/flights",
  title: "Voli",
  w: 200,
  h: 400,
  fingerprint: "abc123",
  screenshot: "AAAA",
  actions: ACTIONS,
};

const ENTRY = {
  step: 3,
  action: "click",
  text: "Milano",
  text_helper: "gpt-4o-mini",
  latency_ms: 812,
  page_changed: true,
};

const STATE = {
  status: "ready",
  page: PAGE,
  history: [ENTRY, { step: 4, action: "type_text", latency_ms: 90, page_changed: false }],
  elapsed_ms: 12345,
  max_steps: 5,
  text_model: "gpt-4o-mini",
  typesafe_api_url: "https://api.test/typesafe",
  typesafe_model: "clef-large",
  text_model_base_url: "https://api.test/text",
  typesafe_api_key: "secret",
};

/** A run the own model gave up on, and the heal model agreed with. */
const GAVE_UP = {
  status: "blocked",
  decisions: [{ operation: "CLICK" }, { operation: "BLOCKED" }],
  heal_calls: [{ healed: true, operation: "BLOCKED", reason: "The flights are sold out." }],
};

/** The screen as the page starts with it, so one test cannot colour the next. */
function home(): void {
  screen.update({ ...screen.START });
}

describe("readers", () => {
  test("turn anything that is not the wanted shape into the fallback", () => {
    expect(readers.record(null)).toEqual({});
    expect(readers.record("page")).toEqual({});
    expect(readers.text(7, "gone")).toBe("gone");
    expect(readers.text({})).toBe("");
    expect(readers.whole("7", 2)).toBe(2);
    expect(readers.whole(Number.NaN)).toBe(0);
    expect(readers.numeric(Infinity)).toBeNull();
    expect(readers.list("none")).toEqual([]);
  });

  test("keep the value that is the wanted shape", () => {
    const document = { status: "ready" };
    const history = [ENTRY];

    expect(readers.record(document)).toBe(document);
    expect(readers.text("ready")).toBe("ready");
    expect(readers.whole(3.5)).toBe(3.5);
    expect(readers.numeric(0)).toBe(0);
    expect(readers.list(history)).toBe(history);
  });
});

describe("page", () => {
  test("describe the observed page", () => {
    expect(page.url(PAGE)).toBe("https://example.test/flights");
    expect(page.title(PAGE)).toBe("Voli");
    expect(page.width(PAGE)).toBe(200);
    expect(page.height(PAGE)).toBe(400);
    expect(page.actions(PAGE)).toHaveLength(4);
  });

  test("hand the frame over as a data URL, or nothing when there is none", () => {
    expect(page.shot(PAGE)).toBe("data:image/jpeg;base64,AAAA");
    expect(page.shot({ screenshot: "" })).toBeNull();
    expect(page.shot({})).toBeNull();
  });
});

describe("report", () => {
  test("report the state of a run, idle when it says nothing", () => {
    expect(report.status({})).toBe(report.IDLE);
    expect(report.status(STATE)).toBe("ready");
    expect(report.ended({ status: "done" })).toBe(true);
    expect(report.ended({ status: "blocked" })).toBe(true);
    expect(report.ended(STATE)).toBe(false);
    expect(report.ended({})).toBe(false);
  });

  test("report the page, the trace and the counters of the run", () => {
    expect(report.page(STATE)).toBe(PAGE);
    expect(report.page({})).toBeNull();
    expect(report.history(STATE)).toHaveLength(2);
    expect(report.steps(STATE)).toBe(2);
    expect(report.steps({})).toBe(0);
    expect(report.elapsed(STATE)).toBe(12345);
    expect(report.elapsed({})).toBe(0);
  });

  test("double the step ceiling of the server, since a speeding run asks twice per step", () => {
    expect(report.budget(STATE)).toBe(10);
    expect(report.budget({})).toBe(2);
  });

  test("name the text model, or fall back before the server reports one", () => {
    expect(report.textModel(STATE, labels.NO_MODEL)).toBe("gpt-4o-mini");
    expect(report.textModel({}, labels.NO_MODEL)).toBe(labels.NO_MODEL);
  });

  test("report the snapshot mode of the run", () => {
    expect(report.vision({ vision: true })).toBe(true);
    expect(report.vision({ vision: false })).toBe(false);
    expect(report.vision({ vision: "true" })).toBe(false);
    expect(report.vision({})).toBe(false);
    expect(report.vision(null)).toBe(false);
  });

  test("read the fingerprint of the observed page", () => {
    expect(report.pageKey(STATE)).toBe("abc123");
    expect(report.pageKey({ page: {} })).toBeNull();
    expect(report.pageKey({})).toBeNull();
  });

  test("pick the decision in hand, or the last one of a finished run", () => {
    expect(report.choice({ decision: { choice: "a2" } })).toBe("a2");
    expect(report.choice({ state: "ready", decision: null, status: "done", decisions: [{ choice: "a1" }, { choice: "a2" }] })).toBe("a2");
    expect(report.choice({ decision: null, status: "ready", decisions: [{ choice: "a1" }] })).toBeNull();
    expect(report.choice({ decision: null, status: "done", decisions: [] })).toBeNull();
    expect(report.choice({})).toBeNull();
  });

  test("quote the heal model on a run that stopped by giving up, whether it answered or failed", () => {
    expect(report.healVerdict(GAVE_UP)).toEqual({ said: "The flights are sold out.", answered: true });
    expect(report.healVerdict({ ...GAVE_UP, heal_calls: [{ healed: false, error: "heal model timed out" }] })).toEqual({
      said: "heal model timed out",
      answered: false,
    });
  });

  test("say nothing about a run the heal model had no part in", () => {
    expect(report.healVerdict(STATE)).toBeNull();
    expect(report.healVerdict({ status: "done", decisions: [{ operation: "BLOCKED" }] })).toBeNull();
    expect(report.healVerdict({ ...GAVE_UP, decisions: [{ operation: "CLICK" }] })).toBeNull();
    expect(report.healVerdict({ ...GAVE_UP, heal_calls: [{ healed: true, operation: "CLICK", reason: "Try the other button." }] })).toBeNull();
    expect(report.healVerdict({ ...GAVE_UP, heal_calls: [] })).toBeNull();
    expect(report.healVerdict({ ...GAVE_UP, heal_calls: [{ healed: false, error: "" }] })).toBeNull();
    expect(report.healVerdict({})).toBeNull();
  });
});

describe("step", () => {
  test("describe one executed action", () => {
    expect(step.number(ENTRY)).toBe(3);
    expect(step.action(ENTRY)).toBe("click");
    expect(step.typed(ENTRY)).toBe("Milano");
    expect(step.helper(ENTRY)).toBe("gpt-4o-mini");
    expect(step.latency(ENTRY)).toBe(812);
    expect(step.changed(ENTRY)).toBe(true);
  });

  test("say nothing about an action it cannot read", () => {
    expect(step.number({})).toBe(0);
    expect(step.action({})).toBe("");
    expect(step.typed({})).toBeNull();
    expect(step.helper({})).toBe("");
    expect(step.latency({})).toBe(0);
    expect(step.changed({})).toBe(false);
  });

  test("mark the one action the heal model chose, and repeat the reason it gave", () => {
    const mended = { ...ENTRY, healed: true, heal_reason: "The filter was already open." };
    expect(step.healed(mended)).toBe(true);
    expect(step.healed(ENTRY)).toBe(false);
    expect(step.reason(mended)).toBe("The filter was already open.");
    expect(step.reason(ENTRY)).toBeNull();
  });

  test("mark no action as healed that the server described wrong", () => {
    expect(step.healed({ healed: "yes", heal_reason: 7 })).toBe(false);
    expect(step.reason({ healed: true, heal_reason: 7 })).toBeNull();
    expect(step.reason({ healed: true, heal_reason: "" })).toBeNull();
    expect(step.reason({ healed: true, heal_reason: null })).toBeNull();
  });
});

describe("labels", () => {
  test("name every state the run can report, and repeat one it does not know", () => {
    expect(labels.statusLabel("idle")).toBe("Pronto");
    expect(labels.statusLabel("ready")).toBe("In corso · pagina osservata");
    expect(labels.statusLabel("predicted")).toBe("In corso · scelta pronta");
    expect(labels.statusLabel("done")).toBe("Run finished · check the page");
    expect(labels.statusLabel("blocked")).toBe("Fermo · nessuna azione disponibile");
    expect(labels.statusLabel("nowhere")).toBe("nowhere");
  });

  test("count the steps, name them one at a time and pad the number", () => {
    expect(labels.counted(7, 12345)).toBe("7 PASSI · 12.3s");
    expect(labels.counted(1, 2000)).toBe("1 PASSO · 2.0s");
    expect(labels.numbered(3)).toBe("03");
    expect(labels.numbered(12)).toBe("12");
  });

  test("measure one decision and say what it changed", () => {
    expect(labels.milliseconds(812)).toBe("812 ms");
    expect(labels.effect(true)).toBe("CAMBIATA");
    expect(labels.effect(false)).toBe("INVARIATA");
  });

  test("chip the action the healer chose and quote its reason", () => {
    expect(labels.HEAL).toBe("HEAL");
    expect(labels.because("The filter was already open.")).toBe("↳ The filter was already open.");
  });

  test("repeat the last word of the healer on a run that gave up, or the reason it had none", () => {
    expect(labels.healNote("The flights are sold out.", true)).toBe("L'healer ha controllato: The flights are sold out.");
    expect(labels.healNote("heal model timed out", false)).toBe("L'healer non ha risposto: heal model timed out");
  });
});

describe("targets", () => {
  test("draw one box per element, sharing the viewport with it", () => {
    const drawn = targets.boxes(PAGE);

    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toEqual({ node: 1, spot: { left: "0%", top: "0%", width: "5%", height: "2.5%" } });
    expect(drawn[1]).toEqual({ node: 2, spot: { left: "5%", top: "5%", width: "15%", height: "10%" } });
  });

  test("leave the boxes at nothing when the page has no size", () => {
    expect(targets.boxes({ actions: ACTIONS })).toEqual([
      { node: 1, spot: { left: "0%", top: "0%", width: "0%", height: "0%" } },
      { node: 2, spot: { left: "0%", top: "0%", width: "0%", height: "0%" } },
    ]);
    expect(targets.boxes({})).toEqual([]);
  });

  test("point at the element the run chose, and only when it chose one of this page", () => {
    expect(targets.chosen({ page: PAGE, decision: { choice: "a2" } })).toBe(2);
    expect(targets.chosen({ page: PAGE, decision: { choice: "nowhere" } })).toBeNull();
    expect(targets.chosen({ page: PAGE })).toBeNull();
    expect(targets.chosen({})).toBeNull();
  });

  test("find the element an action id belongs to", () => {
    expect(targets.nodeOf(PAGE, "a1")).toBe(1);
    expect(targets.nodeOf(PAGE, "a3")).toBe(3);
    expect(targets.nodeOf(PAGE, "gone")).toBeNull();
    expect(targets.nodeOf({}, "a1")).toBeNull();
  });
});

describe("fields", () => {
  test("show what the user typed, else what the server reports", () => {
    expect(fields.shown(null, STATE, "typesafe_api_url")).toBe("https://api.test/typesafe");
    expect(fields.shown(null, STATE, "text_model")).toBe("gpt-4o-mini");
    expect(fields.shown(fields.BLANK, STATE, "typesafe_api_url")).toBe("");
    expect(fields.shown({ ...fields.BLANK, goal: "Trova un volo" }, STATE, "goal")).toBe("Trova un volo");
  });

  test("never show a key back, only the goal and the two model settings", () => {
    expect(fields.shown({ ...fields.BLANK, typesafe_api_key: "typed" }, STATE, "typesafe_api_key")).toBe("typed");
    expect(fields.shown(null, STATE, "typesafe_api_key")).toBe("");
    expect(fields.shown(null, STATE, "text_model_api_key")).toBe("");
  });

  test("fill the form from the report and keep an edited field apart", () => {
    const filled = fields.filled(null, STATE);
    const edited = fields.edited(filled, STATE, "goal", "Trova un volo");

    expect(filled.typesafe_model).toBe("clef-large");
    expect(filled.goal).toBe("");
    expect(edited.goal).toBe("Trova un volo");
    expect(edited.typesafe_model).toBe("clef-large");
    expect(fields.filled(null, {})).toEqual(fields.BLANK);
  });

  test("send exactly the goal and the two model settings", () => {
    expect(Object.keys(fields.body(fields.filled(null, STATE)))).toEqual([
      "goal",
      "typesafe_api_url",
      "typesafe_model",
      "typesafe_api_key",
      "text_model_base_url",
      "text_model",
      "text_model_api_key",
    ]);
  });

  test("describe the form: one goal, and two blocks of three settings", () => {
    expect(fields.GOAL.key).toBe("goal");
    expect(fields.GOAL.required).toBe(true);
    expect(fields.GROUPS.map((group) => group.specs.length)).toEqual([3, 3]);
    expect(fields.GROUPS.flatMap((group) => group.specs).filter((spec) => spec.required)).toHaveLength(4);
  });
});

describe("trace", () => {
  test("export the run without the frame the page has already shown", () => {
    const exported = JSON.parse(trace.trace(STATE)) as Record<string, unknown>;
    const page = exported.page as Record<string, unknown>;

    expect(exported.status).toBe("ready");
    expect(exported.max_steps).toBe(5);
    expect(page.url).toBe("https://example.test/flights");
    expect("screenshot" in page).toBe(false);
    expect(trace.trace(STATE)).toContain('\n  "');
    expect(trace.NAME).toBe("s1-visual-browser-agent-trace.json");
  });

  test("export a run that reported nothing at all", () => {
    expect(JSON.parse(trace.trace({}))).toEqual({ page: {} });
  });
});

describe("screen", () => {
  test("start on an idle page that marks the targets", () => {
    home();

    expect(screen.current().busy).toBe(false);
    expect(screen.current().automatic).toBe(false);
    expect(screen.current().marking).toBe(true);
    expect(screen.current().vision).toBe(true);
    expect(screen.current().report).toBeNull();
  });

  test("replace the screen with a whole new value and tell every listener", () => {
    home();
    let told = 0;
    const stop = screen.subscribe(() => {
      told += 1;
    });
    const before = screen.current();

    screen.update({ fault: "broken" });

    expect(told).toBe(1);
    expect(screen.current()).not.toBe(before);
    expect(screen.current().fault).toBe("broken");
    expect(before.fault).toBeNull();
    stop();
    screen.update({ fault: null });
    expect(told).toBe(1);
  });
});

describe("drive", () => {
  test("ask for the next step, or for a decision and then its action when speeding", () => {
    expect(drive.ask(STATE, false)).toEqual({ name: "tick", body: { status: "ready", fingerprint: "abc123" } });
    expect(drive.ask({}, false)).toEqual({ name: "tick", body: { status: "idle", fingerprint: null } });
    expect(drive.ask(STATE, true)).toEqual({ name: "predict", body: { status: "ready", fingerprint: "abc123" } });
    expect(drive.ask({}, true)).toEqual({ name: "tick", body: { status: "idle", fingerprint: null } });
    expect(drive.ask({ status: "ready", page: {} }, true)).toEqual({
      name: "tick",
      body: { status: "ready", fingerprint: null },
    });
  });

  test("apply a prediction only when there is one to apply", () => {
    const predicted = { status: "predicted", page: { fingerprint: "abc123" } };

    expect(drive.act(predicted, true)).toEqual({ name: "act", body: { fingerprint: "abc123" } });
    expect(drive.act(STATE, true)).toBeNull();
    expect(drive.act(predicted, false)).toBeNull();
    expect(drive.act({ status: "predicted" }, true)).toBeNull();
  });

  test("keep the pause for a run that is under way", () => {
    home();
    drive.pause();
    expect(screen.current().note).toBeNull();

    screen.update({ automatic: true });
    drive.pause();

    expect(screen.current().automatic).toBe(false);
    expect(screen.current().note).toBe(labels.PAUSING);
  });

  test("keep the two shortcuts apart and leave the overlay on by default", () => {
    home();
    drive.speed(true);
    drive.mark(false);

    expect(screen.current().speeding).toBe(true);
    expect(screen.current().marking).toBe(false);
    expect(drive.SPEED_TURN_MS).toBe(450);
  });

  test("edit one field over the settings the report holds", () => {
    home();
    screen.update({ report: STATE });
    drive.edit("goal", "Trova un volo");

    expect(screen.current().values?.goal).toBe("Trova un volo");
    expect(screen.current().values?.typesafe_model).toBe("clef-large");
  });

  test("open the run in the snapshot mode the screen holds", () => {
    home();
    const values = fields.filled(null, STATE);

    expect(drive.reset(values, true).vision).toBe(true);
    expect(drive.reset(values, false).vision).toBe(false);
    expect(Object.keys(drive.reset(values, true))).toHaveLength(8);
    expect(Object.keys(fields.body(values))).toHaveLength(7);
  });

  test("keep the snapshot mode of the next run apart from the form", () => {
    home();
    drive.vision(true);

    expect(screen.current().vision).toBe(true);
    expect(screen.current().values).toBeNull();
  });
});

describe("client", () => {
  test("show the message of a failure as the alert box shows it", () => {
    expect(client.reason(new RuntimeFailure("The client bundle failed."))).toBe("The client bundle failed.");
    expect(client.reason(new Error("Nope."))).toBe("Nope.");
    expect(client.reason("Nope.")).toBe("Nope.");
  });
});

describe("the served client", () => {
  test("compile the React client for the browser, once, without a debug build", async () => {
    const script = await assets.read("/app.js", "token-value");

    expect(script?.body).toContain('getElementById("root")');
    expect(script?.body).not.toContain("NODE_ENV");
    expect(script?.body).not.toContain("react.development");
  });

  test("compile the same client for every request that follows", async () => {
    const first = await assets.read("/app.js", "token-value");
    const second = await assets.read("/app.js", "token-value");

    expect(second?.body).toBe(first?.body);
  });

  test("serve the page that mounts the client, with the token of this run", async () => {
    const index = await assets.read("/", "token-value");

    expect(index?.body).toContain('content="token-value"');
    expect(index?.body).toContain('src="/app.js"');
    expect(index?.body).not.toContain("__TOKEN__");
  });
});
