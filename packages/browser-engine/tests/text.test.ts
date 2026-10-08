import { describe, expect, test } from "bun:test";
import { InputError } from "../src/errors.ts";
import * as context from "../src/text/context.ts";
import { write } from "../src/text/field.ts";
import { TEXT_VALUE } from "../src/text/prompts.ts";
import { ACTIONS, page, textModel } from "./support.ts";

const BASE = "https://text.example/v1";
const ADDRESS = /address must be an absolute HTTP\(S\) URL/;
const MISSING = /TEXT_MODEL_API_KEY/;

describe("context", () => {
  test("carries the field, the page, and the recent text work", () => {
    const built = context.build("Book a flight", ACTIONS[0], page({ text: "Passengers" }), [
      { action: "Type Berlin", text: "Berlin" },
    ]);
    expect(built).toEqual({
      goal: "Book a flight",
      field: { label: "Search", role: "textbox", value: "" },
      page: { title: "Search", text: "Passengers" },
      recent_actions: [{ action: "Type Berlin", text: "Berlin" }],
    });
  });

  test("defaults missing field values and keeps only the last six actions", () => {
    const history = Array.from({ length: 8 }, (_, step) => ({ action: step, text: null }));
    const built = context.build("Book a flight", { id: "x", kind: "fill" }, page(), history) as {
      field: Record<string, unknown>;
      recent_actions: unknown[];
    };
    expect(built.field).toEqual({ label: null, role: null, value: null });
    expect(built.recent_actions).toHaveLength(6);
    expect(built.recent_actions[0]).toEqual({ action: 2, text: null });
  });

  test("truncates the page text it sends", () => {
    const built = context.build("Book a flight", ACTIONS[0], page({ text: "x".repeat(9000) }), []) as {
      page: { text: string };
    };
    expect(built.page.text).toHaveLength(6000);
  });
});

describe("write", () => {
  test("posts to the chat endpoint of the configured base", async () => {
    const provider = textModel();
    const written = await write({ goal: "Book a flight" }, {
      baseUrl: BASE,
      apiKey: "text-key",
      model: "deepseek-chat",
      http: provider,
    });
    expect(written.value).toBe("Zurich");
    expect(provider.bodies).toHaveLength(1);
    expect(provider.bodies[0].model).toBe("deepseek-chat");
    expect(provider.bodies[0].max_tokens).toBe(1024);
    expect(provider.bodies[0].response_format).toEqual({ type: "json_object" });
    expect((provider.bodies[0].messages as unknown[])[0]).toEqual({ role: "system", content: TEXT_VALUE });
    expect((provider.bodies[0].messages as unknown[])[1]).toEqual({
      role: "user",
      content: JSON.stringify({ goal: "Book a flight" }),
    });
  });

  test("uses the URL and credential it was given", async () => {
    const seen: { url: string; key: string }[] = [];
    const written = await write({ goal: "Book a flight" }, {
      baseUrl: "https://text.example/v2/",
      apiKey: "text-key",
      model: "field-writer",
      http: {
        async post(url, key) {
          seen.push({ url, key });
          return { choices: [{ message: { content: '{"text":"Zurich"}' } }] };
        },
      },
    });
    expect(seen).toEqual([{ url: "https://text.example/v2/chat/completions", key: "text-key" }]);
    expect(written.helper.model).toBe("field-writer");
    expect(written.helper.latency_ms).toBeNumber();
    expect(written.helper.usage).toEqual({});
  });

  test("overrides the model", async () => {
    const provider = textModel();
    const written = await write({ goal: "Book a flight" }, { baseUrl: BASE, apiKey: "k", model: "gpt-mini", http: provider });
    expect(provider.bodies[0].model).toBe("gpt-mini");
    expect(written.helper.model).toBe("gpt-mini");
  });

  test("disables thinking for DeepSeek and reasoning elsewhere", async () => {
    const provider = textModel();
    await write({}, { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", http: provider });
    expect(provider.bodies[0].thinking).toEqual({ type: "disabled" });
    expect(provider.bodies[0].reasoning).toBeUndefined();

    await write({}, { baseUrl: BASE, apiKey: "k", http: provider });
    expect(provider.bodies[1].reasoning).toEqual({ effort: "low" });
    expect(provider.bodies[1].thinking).toBeUndefined();
  });

  test("honours an explicit reasoning switch", async () => {
    const provider = textModel();
    const saved = process.env.TEXT_MODEL_REASONING;
    process.env.TEXT_MODEL_REASONING = "none";
    await write({}, { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", http: provider });
    process.env.TEXT_MODEL_REASONING = saved;
    expect(provider.bodies[0].reasoning).toEqual({ enabled: false });
    expect(provider.bodies[0].thinking).toBeUndefined();
  });

  test("refuses to guess a value without a credential", async () => {
    const provider = textModel();
    const saved = process.env.TEXT_MODEL_API_KEY;
    delete process.env.TEXT_MODEL_API_KEY;
    await expect(write({}, { baseUrl: BASE, http: provider })).rejects.toThrow(MISSING);
    process.env.TEXT_MODEL_API_KEY = saved;
    expect(provider.bodies).toHaveLength(0);
  });

  test("rejects an address that is not an absolute HTTP(S) URL", async () => {
    const provider = textModel();
    await expect(write({}, { baseUrl: "file:///tmp/model", apiKey: "k", http: provider })).rejects.toThrow(ADDRESS);
    expect(provider.bodies).toHaveLength(0);
  });

  test("rejects content that is not the expected JSON object", async () => {
    const cases = ["not json", "[]", '{"text":5}', '{"text":"  "}', '{"text":"a","other":"b"}', "{}", '{"text":null}'];
    for (const content of cases) {
      const attempt = write({}, { baseUrl: BASE, apiKey: "k", http: textModel({ content }) });
      await expect(attempt).rejects.toThrow(InputError);
      await expect(attempt).rejects.toThrow(/no text was typed/);
    }
  });

  test("rejects an answer without a message and one with oversized text", async () => {
    const shapes: unknown[] = [
      {},
      { choices: [] },
      { choices: [{}] },
      { choices: [{ message: { content: 7 } }] },
      { choices: [{ message: { content: JSON.stringify({ text: "x".repeat(2001) }) } }] },
    ];
    for (const answer of shapes) {
      const attempt = write({}, {
        baseUrl: BASE,
        apiKey: "k",
        http: { async post() {
          return answer;
        } },
      });
      await expect(attempt).rejects.toThrow(/no text was typed/);
    }
  });

  test("accepts a value of exactly the limit", async () => {
    const value = "x".repeat(2000);
    const written = await write({}, {
      baseUrl: BASE,
      apiKey: "k",
      http: textModel({ content: JSON.stringify({ text: value }) }),
    });
    expect(written.value).toHaveLength(2000);
  });
});
