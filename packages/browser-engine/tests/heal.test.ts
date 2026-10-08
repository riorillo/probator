import { describe, expect, test } from "bun:test";
import { InputError } from "../src/errors.ts";
import { ENDING, heal } from "../src/heal/decision.ts";
import { GAVE_UP, HEAL } from "../src/heal/prompts.ts";
import { BLOCKED, DONE } from "../src/policy/operations.ts";
import { entry, page, restore } from "./support.ts";

// The environment of the machine running the tests must never turn healing on behind a test's back.
delete process.env.HEAL_MODEL_API_KEY;
delete process.env.HEAL_MODEL_BASE_URL;
delete process.env.HEAL_MODEL;
delete process.env.HEAL_MODEL_REASONING;

const BASE = "https://heal.example/v1";
const ADDRESS = /absolute HTTP\(S\) URL/;
const MISSING = /HEAL_MODEL_API_KEY/;
const INVALID = /no usable move/;
const UNKNOWN = /target that is not on the page/;

type Stub = {
  readonly bodies: Record<string, unknown>[];
  readonly urls: string[];
  readonly keys: string[];
};

/** A heal provider that answers the content it was given, and records what it was asked. */
function healer(content = '{"operation":"WAIT"}'): Stub & { post: (url: string, key: string, body: unknown) => Promise<unknown> } {
  return {
    bodies: [],
    urls: [],
    keys: [],
    async post(url: string, key: string, body: unknown) {
      this.urls.push(url);
      this.keys.push(key);
      this.bodies.push(body as Record<string, unknown>);
      return { choices: [{ message: { content } }], model: "heal-stub", usage: { input_tokens: 5 } };
    },
  };
}

/** The context a request carried: the user message of the OpenAI-compatible payload. */
function handed(provider: Stub): Record<string, unknown> {
  const [message] = (provider.bodies[0].messages as Record<string, unknown>[]).slice(1);
  return JSON.parse(String(message.content)) as Record<string, unknown>;
}

/** The moves of the loop the run is stuck in, as the healer describes it. */
function steps(count = 3): ReturnType<typeof entry>[] {
  return Array.from({ length: count }, () => entry());
}

const STUCK = { kind: "unchanged", steps: steps() };

/** The situation of a run whose own model gave up: no loop to show, only the ending it chose. */
const ENDED = { kind: ENDING, steps: [] };

function ask(content: string, options: Record<string, unknown> = {}, goal = "Book a flight") {
  const provider = healer(content);
  return {
    provider,
    attempt: heal(page(), goal, steps(), STUCK, { baseUrl: BASE, apiKey: "heal-key", model: "gpt-mini", http: provider, ...options }),
  };
}

describe("context", () => {
  test("carries the goal, the loop, the page, and the moves it offers", async () => {
    const { provider, attempt } = await ask('{"operation":"WAIT"}');

    await attempt;

    expect(handed(provider)).toEqual({
      goal: "Book a flight",
      loop: {
        kind: "unchanged",
        steps: steps().map(() => ({
          step: 0,
          action: "Action",
          kind: "click",
          operation: "CLICK",
          target: "1",
          page_changed: true,
        })),
      },
      operations: {
        TYPE_TEXT: "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
        CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
        WAIT: "Wait",
        [DONE]: "Every requirement is visibly satisfied.",
        [BLOCKED]: "No supported operation can progress.",
      },
      elements: [
        { index: "1", label: "Search", operations: ["TYPE_TEXT", "CLICK"], role: "textbox", value: "" },
        { index: "2", label: "Go", operations: ["CLICK"], role: "button", value: "" },
      ],
      page: { url: "https://example.test/", title: "Search", text: "Search" },
      recent_actions: steps().map(() => ({
        step: 0,
        action: "Action",
        kind: "click",
        operation: "CLICK",
        target: "1",
        page_changed: true,
      })),
    });
  });

  test("truncates the page text and keeps only the last ten moves", async () => {
    const provider = healer();
    await heal(page({ text: "x".repeat(9000) }), "Book a flight", steps(14), STUCK, {
      baseUrl: BASE,
      apiKey: "k",
      http: provider,
    });

    const context = handed(provider) as { page: { text: string }; recent_actions: unknown[] };
    expect(context.page.text).toHaveLength(6000);
    expect(context.recent_actions).toHaveLength(10);
  });

  test("reports the ending of a run whose model gave up instead of a loop", async () => {
    const provider = healer();
    await heal(page(), "Book a flight", steps(), ENDED, { baseUrl: BASE, apiKey: "k", http: provider });

    // There is no loop to show: the healer reads the ending, and the moves are all in the history.
    expect(handed(provider).loop).toEqual({ kind: ENDING, steps: [] });
  });
});

describe("heal", () => {
  test("posts to the chat endpoint of the configured base", async () => {
    const { provider, attempt } = await ask('{"operation":"WAIT","reason":"The page is still loading."}');

    const chosen = await attempt;

    expect(provider.urls).toEqual([`${BASE}/chat/completions`]);
    expect(provider.keys).toEqual(["heal-key"]);
    expect(provider.bodies[0].model).toBe("gpt-mini");
    expect(provider.bodies[0].max_tokens).toBe(1024);
    expect(provider.bodies[0].response_format).toEqual({ type: "json_object" });
    expect((provider.bodies[0].messages as unknown[])[0]).toEqual({ role: "system", content: HEAL });
    expect(chosen).toMatchObject({
      choice: "wait",
      operation: "WAIT",
      target: null,
      confidence: 1,
      probabilities: { wait: 1 },
      operation_probabilities: { WAIT: 1 },
      target_probabilities: {},
      target_confidence: null,
      model: "heal-stub",
      usage: { input_tokens: 5 },
      healed: true,
      reason: "The page is still loading.",
    });
    expect(chosen.latency_ms).toBeNumber();
  });

  test("asks with the instruction of the situation the run reported", async () => {
    const provider = healer();
    await heal(page(), "Book a flight", steps(), STUCK, { baseUrl: BASE, apiKey: "k", http: provider });
    await heal(page(), "Book a flight", steps(), ENDED, { baseUrl: BASE, apiKey: "k", http: provider });

    // A loop is told about the loop; an ending is told about the model that gave up on the goal.
    expect((provider.bodies[0].messages as unknown[])[0]).toEqual({ role: "system", content: HEAL });
    expect((provider.bodies[1].messages as unknown[])[0]).toEqual({ role: "system", content: GAVE_UP });
  });

  test("uses the URL and credential it was given, and trims the trailing slashes", async () => {
    const provider = healer();
    await heal(page(), "Book a flight", steps(), STUCK, {
      baseUrl: "https://heal.example/v2/",
      apiKey: "other-key",
      model: "field-writer",
      http: provider,
    });

    expect(provider.urls).toEqual(["https://heal.example/v2/chat/completions"]);
    expect(provider.keys).toEqual(["other-key"]);
    expect(provider.bodies[0].model).toBe("field-writer");
  });

  test("disables thinking for DeepSeek and reasoning elsewhere", async () => {
    const provider = healer();
    await heal(page(), "Book a flight", steps(), STUCK, {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "k",
      http: provider,
    });
    expect(provider.bodies[0].thinking).toEqual({ type: "disabled" });
    expect(provider.bodies[0].reasoning).toBeUndefined();

    await heal(page(), "Book a flight", steps(), STUCK, { baseUrl: BASE, apiKey: "k", http: provider });
    expect(provider.bodies[1].reasoning).toEqual({ effort: "low" });
    expect(provider.bodies[1].thinking).toBeUndefined();
  });

  test("honours an explicit reasoning switch", async () => {
    const provider = healer();
    const saved = process.env.HEAL_MODEL_REASONING;
    process.env.HEAL_MODEL_REASONING = "none";
    await heal(page(), "Book a flight", steps(), STUCK, {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "k",
      http: provider,
    });
    restore("HEAL_MODEL_REASONING", saved);
    expect(provider.bodies[0].reasoning).toEqual({ enabled: false });
    expect(provider.bodies[0].thinking).toBeUndefined();
  });

  test("takes the model of the environment when it was not configured", async () => {
    const provider = healer();
    const saved = process.env.HEAL_MODEL;
    process.env.HEAL_MODEL = "env-healer";
    await heal(page(), "Book a flight", steps(), STUCK, { baseUrl: BASE, apiKey: "k", http: provider });
    restore("HEAL_MODEL", saved);
    expect(provider.bodies[0].model).toBe("env-healer");
  });

  test("resolves a target choice of a click", async () => {
    const { attempt } = await ask('{"operation":"CLICK","target":"2","reason":"  "}');

    const chosen = await attempt;

    expect(chosen).toMatchObject({
      choice: "e3",
      operation: "CLICK",
      target: "2",
      target_probabilities: { "2": 1 },
      target_confidence: 1,
      reason: null,
    });
  });

  test("forces the only target of an operation", async () => {
    const { attempt } = await ask('{"operation":"TYPE_TEXT"}');

    const chosen = await attempt;

    expect(chosen).toMatchObject({ choice: "e1", operation: "TYPE_TEXT", target: "1" });
  });

  test("accepts the BLOCKED ending as a control", async () => {
    const { attempt } = await ask(`{"operation":"${BLOCKED}"}`);

    const chosen = await attempt;

    expect(chosen).toMatchObject({ choice: BLOCKED, operation: BLOCKED, target: null });
  });

  test("refuses to guess a move without a credential", async () => {
    const provider = healer();
    const saved = process.env.HEAL_MODEL_API_KEY;
    delete process.env.HEAL_MODEL_API_KEY;
    await expect(heal(page(), "Book a flight", steps(), STUCK, { baseUrl: BASE, http: provider })).rejects.toThrow(
      MISSING,
    );
    restore("HEAL_MODEL_API_KEY", saved);
    expect(provider.bodies).toHaveLength(0);
  });

  test("rejects an address that is not an absolute HTTP(S) URL", async () => {
    const provider = healer();
    await expect(
      heal(page(), "Book a flight", steps(), STUCK, { baseUrl: "file:///tmp/model", apiKey: "k", http: provider }),
    ).rejects.toThrow(ADDRESS);
    expect(provider.bodies).toHaveLength(0);
  });

  test("rejects content that is not the expected JSON object", async () => {
    const cases = ["not json", "[]", '{"operation":7}', "{}", `{"operation":"${DONE}"}`, '{"operation":"JUMP","target":"1"}'];
    for (const content of cases) {
      const { attempt } = await ask(content);
      await expect(attempt).rejects.toThrow(InputError);
      await expect(attempt).rejects.toThrow(INVALID);
    }
  });

  test("rejects a target that is not on the page, and a missing one that is not forced", async () => {
    await expect(ask('{"operation":"CLICK","target":"9"}').attempt).rejects.toThrow(UNKNOWN);
    await expect(ask('{"operation":"CLICK"}').attempt).rejects.toThrow(INVALID);
  });

  test("rejects an answer without a message", async () => {
    const shapes: unknown[] = [
      {},
      { choices: [] },
      { choices: [{}] },
      { choices: [{ message: { content: 7 } }] },
      { choices: [{ message: {} }] },
    ];
    for (const answer of shapes) {
      const attempt = heal(page(), "Book a flight", steps(), STUCK, {
        baseUrl: BASE,
        apiKey: "k",
        http: {
          async post() {
            return answer;
          },
        },
      });
      await expect(attempt).rejects.toThrow(INVALID);
    }
  });

  test("reports an answer without a model and without usage", async () => {
    const chosen = await heal(page(), "Book a flight", steps(), STUCK, {
      baseUrl: BASE,
      apiKey: "k",
      http: {
        async post() {
          return { choices: [{ message: { content: '{"operation":"WAIT"}' } }] };
        },
      },
    });
    expect(chosen.model).toBeNull();
    expect(chosen.usage).toEqual({});
  });
});
