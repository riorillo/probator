import { describe, expect, test } from "bun:test";
import { InputError, RuntimeFailure } from "../src/errors.ts";
import { post, unwrap } from "../src/http/client.ts";

type Reply = { status?: number; body?: string; type?: string };

type Provider = {
  readonly url: string;
  readonly requests: { body: string; authorization: string | null }[];
  reply(...replies: Reply[]): void;
  stop(): void;
};

/** A local stand-in for a model provider: it records the requests and answers in order. */
function stubProvider(): Provider {
  const requests: { body: string; authorization: string | null }[] = [];
  const replies: Reply[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({
        body: await request.text(),
        authorization: request.headers.get("authorization"),
      });
      const reply = replies.shift() ?? { body: JSON.stringify({ answers: {} }) };
      return new Response(reply.body ?? "", {
        status: reply.status ?? 200,
        headers: { "content-type": reply.type ?? "application/json" },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1/systemone`,
    requests,
    reply: (...next) => void replies.push(...next),
    stop: () => void server.stop(true),
  };
}

const ANSWER = JSON.stringify({ answers: { operation: { choice: "DONE" } } });

describe("post", () => {
  test("posts JSON with the credential and returns the parsed answer", async () => {
    const provider = stubProvider();
    provider.reply({ body: ANSWER });
    const answer = await post(provider.url, "secret-key", { model: "jev" });
    expect(answer).toEqual({ answers: { operation: { choice: "DONE" } } });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].body).toBe('{"model":"jev"}');
    expect(provider.requests[0].authorization).toBe("Bearer secret-key");
    provider.stop();
  });

  test("retries a transient status and succeeds", async () => {
    const provider = stubProvider();
    provider.reply({ status: 503, body: "unavailable" }, { body: ANSWER });
    const answer = await post(provider.url, "k", {});
    expect(answer).toEqual({ answers: { operation: { choice: "DONE" } } });
    expect(provider.requests).toHaveLength(2);
    provider.stop();
  });

  test("gives up after three transient statuses and reports the status", async () => {
    const provider = stubProvider();
    provider.reply({ status: 503, body: "unavailable" }, { status: 503, body: "unavailable" }, { status: 503, body: "unavailable" });
    const attempt = post(provider.url, "k", {});
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/HTTP 503: unavailable/);
    expect(provider.requests).toHaveLength(3);
    provider.stop();
  });

  test("does not retry a client error and keeps the provider detail", async () => {
    const provider = stubProvider();
    provider.reply({ status: 400, body: '{"error":"bad criteria"}' });
    const attempt = post(provider.url, "k", {});
    await expect(attempt).rejects.toThrow(/HTTP 400/);
    await expect(attempt).rejects.toThrow(/bad criteria/);
    expect(provider.requests).toHaveLength(1);
    provider.stop();
  });

  test("reports a body that is not JSON", async () => {
    const provider = stubProvider();
    provider.reply({ body: "not json", type: "text/plain" });
    const attempt = post(provider.url, "k", {});
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow(/not valid JSON/);
    provider.stop();
  });

  test("reports an unreachable provider without retrying forever", async () => {
    const attempt = post("http://127.0.0.1:1/v1/systemone", "k", {});
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/Could not reach the model provider/);
  });

  test("surfaces a provider error envelope with its detail", async () => {
    const provider = stubProvider();
    provider.reply({
      body: JSON.stringify({ success: false, errors: [{ code: 1000, message: "No route for that URI" }] }),
    });
    const attempt = post(provider.url, "k", {});
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/No route for that URI/);
    expect(provider.requests).toHaveLength(1);
    provider.stop();
  });

  test("does not retry a provider error envelope", async () => {
    const provider = stubProvider();
    provider.reply({ body: JSON.stringify({ success: false, messages: ["criteria are required"] }) });
    await expect(post(provider.url, "k", {})).rejects.toThrow(/criteria are required/);
    expect(provider.requests).toHaveLength(1);
    provider.stop();
  });

  test("unwraps the Workers AI result envelope", async () => {
    const provider = stubProvider();
    provider.reply({ body: JSON.stringify({ success: true, result: { answers: { operation: {} } } }) });
    expect(await post(provider.url, "k", {})).toEqual({ answers: { operation: {} } });
    provider.stop();
  });

  test("passes a body without questions through untouched", async () => {
    const provider = stubProvider();
    provider.reply({ body: JSON.stringify({ text: "hello" }) });
    expect(await post(provider.url, "k", {})).toEqual({ text: "hello" });
    provider.stop();
  });
});

describe("unwrap", () => {
  test("leaves an answer that already carries its choices", () => {
    expect(unwrap({ answers: {}, result: { answers: { ignored: {} } } })).toEqual({
      answers: {},
      result: { answers: { ignored: {} } },
    });
  });

  test("ignores a result that is not an object", () => {
    expect(unwrap({ success: true, result: "text" })).toEqual({ success: true, result: "text" });
  });

  test("returns a value that is not an object", () => {
    expect(unwrap("text")).toBe("text");
    expect(unwrap(null)).toBeNull();
  });

  test("reports an envelope without details", () => {
    expect(() => unwrap({ success: false })).toThrow(/no details/);
  });
});
