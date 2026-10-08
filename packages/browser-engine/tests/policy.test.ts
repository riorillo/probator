import { describe, expect, test } from "bun:test";
import { InputError, RuntimeFailure } from "../src/errors.ts";
import { plan } from "../src/marks.ts";
import { choose } from "../src/policy/decision.ts";
import { space } from "../src/policy/elements.ts";
import { NEXT_ACTION, TARGET } from "../src/policy/prompts.ts";
import type { Request } from "../src/policy/questions.ts";
import { validate } from "../src/policy/validate.ts";
import { choice, entry, model, page } from "./support.ts";

const IDS = { a: "first", b: "second" };
const ADDRESS = "https://typesafe.example/v1/systemone";

describe("validate", () => {
  test("accepts the maximum of the offered ids", () => {
    expect(validate(choice(["a", "b"], "a"), IDS).choice).toBe("a");
  });

  test("rejects an id that was not offered", () => {
    expect(() => validate({ ...choice(["a", "b"], "a"), choice: "invented" }, IDS)).toThrow(InputError);
  });

  test("rejects a score that is not a finite number", () => {
    const answer = choice(["a", "b"], "a");
    (answer.probabilities as Record<string, number>).a = Number.NaN;
    expect(() => validate(answer, IDS)).toThrow(InputError);
  });

  test("rejects a score outside the unit interval", () => {
    const answer = choice(["a", "b"], "a");
    (answer.probabilities as Record<string, number>).b = -1;
    expect(() => validate(answer, IDS)).toThrow(InputError);
  });

  test("rejects a missing score", () => {
    const answer = choice(["a", "b"], "a");
    delete (answer.probabilities as Record<string, number>).b;
    expect(() => validate(answer, IDS)).toThrow(InputError);
  });

  test("rejects a choice that is not the maximum", () => {
    expect(() => validate({ ...choice(["a", "b"], "a"), choice: "b" }, IDS)).toThrow(InputError);
  });

  test("rejects a confidence that is not a probability", () => {
    expect(() => validate({ ...choice(["a", "b"], "a"), confidence: 5 }, IDS)).toThrow(InputError);
  });

  test("rejects scores that do not sum to one", () => {
    const answer = choice(["a", "b"], "a");
    (answer.probabilities as Record<string, number>).b = 0.5;
    expect(() => validate(answer, IDS)).toThrow(InputError);
  });

  test("rejects an answer that is not an object", () => {
    expect(() => validate(null, IDS)).toThrow(InputError);
    expect(() => validate([], IDS)).toThrow(InputError);
  });
});

describe("space", () => {
  test("indexes one candidate per node with operation specific targets", () => {
    const grouped = space(page().actions);
    expect(grouped.elements).toHaveLength(2);
    expect(grouped.elements[0].operations).toEqual(["TYPE_TEXT", "CLICK"]);
    expect(grouped.targets.TYPE_TEXT["1"].id).toBe("e1");
    expect(grouped.targets.CLICK["1"].id).toBe("e2");
    expect(grouped.targets.CLICK["2"].id).toBe("e3");
    expect(Object.keys(grouped.controls)).toContain("WAIT");
  });

  test("keeps the observed control state on the element", () => {
    const grouped = space([{ id: "c", kind: "click", node: 3, role: "checkbox", checked: "true" }]);
    expect(grouped.elements[0].index).toBe("1");
    expect(grouped.elements[0].checked).toBe("true");
    expect(grouped.elements[0].operations).toEqual(["CLICK"]);
  });

  test("numbers the drawn boxes exactly as the elements are indexed", () => {
    const actions = page().actions;
    const marks = plan(actions);
    expect(marks).toEqual([
      { index: "1", node: 10 },
      { index: "2", node: 20 },
    ]);
    expect(marks.map((mark) => mark.index)).toEqual(space(actions).elements.map((element) => element.index));
  });

  test("refuses an observable element without a node", () => {
    expect(() => plan([{ id: "e1", kind: "click", label: "Go" }])).toThrow(RuntimeFailure);
  });
});

describe("choose", () => {
  test("resolves a single candidate head locally with one request", async () => {
    const provider = model();
    const answer = await choose(page(), "Find a book", [], { apiUrl: ADDRESS, apiKey: "test", http: provider });
    expect(provider.requests).toHaveLength(1);
    expect(Object.keys(provider.requests[0].questions)).toEqual(["operation", "click_target"]);
    expect(answer.operation).toBe("TYPE_TEXT");
    expect(answer.target).toBe("1");
    expect(answer.choice).toBe("e1");
    expect(answer.target_probabilities).toEqual({ "1": 1 });
    expect(answer.target_confidence).toBe(1);
    expect(answer.operation_probabilities).toEqual({ TYPE_TEXT: 1, CLICK: 0, WAIT: 0, DONE: 0, BLOCKED: 0 });
  });

  test("posts to the configured address, key and model", async () => {
    const provider = model({ operation: "CLICK", targets: { click_target: "2" } });
    const answer = await choose(page(), "Find a book", [], {
      apiUrl: "https://typesafe.example/v1/other",
      apiKey: "custom-key",
      model: "custom-jev",
      http: provider,
    });
    expect(provider.urls).toEqual(["https://typesafe.example/v1/other"]);
    expect(provider.keys).toEqual(["custom-key"]);
    expect(provider.requests[0].model).toBe("custom-jev");
    expect(answer.choice).toBe("e3");
    expect(answer.target).toBe("2");
    expect(answer.probabilities).toEqual({ e2: 0, e3: 1 });
  });

  test("reads the page fields the provider needs and nothing else", async () => {
    const provider = model();
    await choose(page({ text: "Visible text" }), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
    });
    expect(provider.requests[0].state.page).toEqual({
      url: "https://example.test/",
      title: "Search",
      text: "Visible text",
    });
    expect(provider.requests[0].state.elements).toHaveLength(2);
  });

  test("summarises the recent actions it was given", async () => {
    const provider = model();
    const history = Array.from({ length: 12 }, (_, step) => entry({ step, action: `Action ${step}` }));
    await choose(page(), "Find a book", history, { apiUrl: ADDRESS, apiKey: "test", http: provider });
    expect(provider.requests[0].state.recent_actions).toHaveLength(10);
    expect(provider.requests[0].state.recent_actions[0]).toEqual({
      action: "Action 2",
      kind: "click",
      text: null,
      page_changed: true,
    });
  });

  test("sends the numbered frame instead of the text snapshot in image mode", async () => {
    const provider = model({ operation: "CLICK", targets: { click_target: "2" } });
    const answer = await choose(page({ screenshot: "jpeg-bytes" }), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
      vision: true,
    });
    expect(provider.requests[0].images).toEqual(["data:image/jpeg;base64,jpeg-bytes"]);
    expect(provider.requests[0].state).toEqual({
      url: "https://example.test/",
      title: "Search",
      recent_actions: [],
    });
    expect(answer.choice).toBe("e3");
    expect(answer.target).toBe("2");
    expect(answer.probabilities).toEqual({ e2: 0, e3: 1 });
  });

  test("keeps the frame out of the recorded decision", async () => {
    const provider = model();
    const answer = await choose(page({ screenshot: "jpeg-bytes" }), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
      vision: true,
    });
    const recorded = answer.request as Request;
    expect(recorded.images).toBeUndefined();
    expect(recorded.state.elements).toBeUndefined();
    expect(JSON.stringify(recorded)).not.toContain("jpeg-bytes");
    expect(Object.keys(recorded.state)).toEqual(["url", "title", "recent_actions"]);
  });

  test("refuses to send an image mode request without a frame", async () => {
    const provider = model();
    const attempt = choose(page(), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
      vision: true,
    });
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/no screenshot to send/);
    expect(provider.requests).toHaveLength(0);
  });

  test("carries no frame when the mode is off", async () => {
    const provider = model();
    const answer = await choose(page({ screenshot: "jpeg-bytes" }), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
      vision: false,
    });
    expect(provider.requests[0].images).toBeUndefined();
    expect((answer.request as Request).state.page?.title).toBe("Search");
  });

  test("rejects an address that is not an absolute HTTP(S) URL", async () => {
    const provider = model();
    const settings = { apiKey: "test", http: provider };
    await expect(choose(page(), "Find a book", [], { ...settings, apiUrl: "file:///tmp/model" })).rejects.toThrow(
      /absolute HTTP\(S\) URL/,
    );
    await expect(
      choose(page(), "Find a book", [], { ...settings, apiUrl: "https://user:key@example.test" }),
    ).rejects.toThrow(/absolute HTTP\(S\) URL/);
    expect(provider.requests).toHaveLength(0);
  });

  test("refuses to guess without a credential", async () => {
    const provider = model();
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    await expect(choose(page(), "Find a book", [], { apiUrl: ADDRESS, http: provider })).rejects.toThrow(
      /TYPESAFE_API_KEY/,
    );
    process.env.TYPESAFE_API_KEY = saved;
    expect(provider.requests).toHaveLength(0);
  });

  test("rejects a click that claims an unoffered target", async () => {
    const answer = choose(page(), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: {
        async post() {
          return {
            model: "test",
            answers: {
              operation: choice(["TYPE_TEXT", "CLICK", "WAIT", "DONE", "BLOCKED"], "CLICK"),
              click_target: choice(["1", "2", "999"], "999"),
            },
          };
        },
      },
    });
    await expect(answer).rejects.toThrow(InputError);
    await expect(answer).rejects.toThrow(/not valid/);
  });

  test("sends the control state and the next step rules to the target head", async () => {
    const observed = page();
    observed.actions.unshift({
      id: "toggle",
      kind: "click",
      label: "Free cancellation",
      node: 30,
      role: "checkbox",
      checked: "true",
      selected: false,
    });
    const provider = model({ operation: "CLICK", targets: { click_target: "3" } });
    const answer = await choose(observed, "Search with free cancellation", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: provider,
    });
    type Question = { criteria: Record<string, Record<string, unknown>>; instructions: Record<string, unknown> };
    const questions = provider.requests[0].questions as unknown as Record<string, Question>;
    expect(provider.requests[0].state.elements?.[0].checked).toBe("true");
    expect(provider.requests[0].state.elements?.[0].selected).toBe(false);
    expect(questions.click_target.criteria["1"]).toEqual({ element: "1" });
    expect(questions.operation.instructions.rules).toBe(NEXT_ACTION);
    expect(questions.click_target.instructions.rules).toBe(TARGET);
    expect(questions.click_target.instructions.operation).toBe("CLICK");
    expect(answer.choice).toBe("e3");
  });

  test("answers a control without asking for a target", async () => {
    const provider = model({ operation: "WAIT" });
    const answer = await choose(page(), "Find a book", [], { apiUrl: ADDRESS, apiKey: "test", http: provider });
    expect(answer.choice).toBe("wait");
    expect(answer.target).toBeNull();
    expect(answer.probabilities).toEqual({ wait: 1 });
    expect(Object.keys(provider.requests[0].questions)).toEqual(["operation", "click_target"]);
  });

  test("answers DONE without touching the page", async () => {
    const provider = model({ operation: "DONE" });
    const answer = await choose(page(), "Find a book", [], { apiUrl: ADDRESS, apiKey: "test", http: provider });
    expect(answer.choice).toBe("DONE");
    expect(answer.target).toBeNull();
  });

  test("reports a provider body without usable choices", async () => {
    const answer = choose(page(), "Find a book", [], {
      apiUrl: ADDRESS,
      apiKey: "test",
      http: {
        async post() {
          return { model: "test" };
        },
      },
    });
    await expect(answer).rejects.toThrow(RuntimeFailure);
    await expect(answer).rejects.toThrow(/usable set of choices/);
  });
});
