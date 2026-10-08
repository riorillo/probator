import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Hono } from "hono";
import type { Body, Session } from "../src/harness/agent.ts";
import type { Config } from "../src/harness/config.ts";
import { RuntimeFailure } from "../src/errors.ts";
import { create as createInspector } from "../src/inspector/app.ts";
import * as assets from "../src/inspector/assets.ts";
import * as form from "../src/inspector/form.ts";
import * as lock from "../src/inspector/lock.ts";
import * as security from "../src/inspector/security.ts";
import { create as createSessions, type Sessions } from "../src/inspector/session.ts";
import { MAX_STEPS } from "../src/settings/limits.ts";
import { stub } from "./support.ts";

const PORT = 8766;
const BASE = `http://127.0.0.1:${PORT}`;
const GOAL = "Find a book";
const TOKEN_HEADER = "X-Demo-Token";
const LOCAL_ERROR = "Local error; no automatic retry. Restart with AVVIA.";
const NO_SESSION = "Start a session first.";
const MISSING_SETTINGS = "Both model names and both API addresses are required.";
const INVALID_GOAL = "Write a goal of 1 to 2,000 characters.";
const INVALID_SIZE = "Invalid request size.";
const MALFORMED = "The request body is not valid JSON.";
const BUSY = "A browser step is already running.";
const FOREIGN = "Local requests only.";
const BODY = "The request body must be a JSON object.";

type Opening = { readonly url: string; readonly goal: string; readonly config: Config };
type Sent = { readonly name: string; readonly body: Body | undefined };
type Step = () => Promise<void> | void;

type Doubles = {
  readonly app: Hono;
  readonly guard: security.Guard;
  readonly sessions: Sessions;
  /** The state the current run reports, shaped by each test. */
  readonly state: Record<string, unknown>;
  /** Every run the inspector opened, in order. */
  readonly opened: Opening[];
  /** Every command the inspector ran, in order. */
  readonly sent: Sent[];
  /** How many times the inspector closed a run. */
  readonly closes: () => number;
  /** Makes the next command wait until the returned function is called. */
  readonly hold: () => () => void;
  /** Fails the next command with this value. */
  readonly fail: (failure: unknown) => void;
};

/** An inspector over a run that is never a browser: the HTTP surface is what is under test. */
function doubles(): Doubles {
  const guard: security.Guard = { ...security.loopback(PORT), token: "session-token" };
  const opened: Opening[] = [];
  const sent: Sent[] = [];
  const steps: Step[] = [];
  const state: Record<string, unknown> = { page: null, status: "ready", history: [], decision: null };
  let running: Session | null = null;
  let closed = 0;
  const sessionOf = (config: Config): Session => ({
    config,
    snapshot: () => state,
    command: async (name, body) => {
      sent.push({ name, body });
      const step = steps.shift();
      if (step) await step();
      return state;
    },
    setGoal: () => undefined,
    drainRecordingEvents: async () => [],
    captureScreenshot: async () => null,
    close: async () => {
      closed += 1;
    },
    [Symbol.asyncDispose]: async () => {
      closed += 1;
    },
    run: async function* (): AsyncGenerator<Record<string, unknown>> {
      yield state;
    },
  });
  const sessions: Sessions = {
    current: () => running,
    open: async (url, goal, config) => {
      opened.push({ url, goal, config });
      running = sessionOf(config);
      return running;
    },
    close: async () => {
      if (running === null) return;
      closed += 1;
      running = null;
    },
  };
  return {
    app: createInspector({ sessions, guard, directory: assets.DIRECTORY }),
    guard,
    sessions,
    state,
    opened,
    sent,
    closes: () => closed,
    hold: () => {
      const waiting = deferred();
      steps.push(() => waiting.promise);
      return waiting.resolve;
    },
    fail: (failure) => {
      steps.push(() => {
        throw failure;
      });
    },
  };
}

/** One run of the inspector, with the guard satisfied: the caller then breaks one thing at a time. */
async function start(): Promise<Doubles> {
  const world = doubles();
  const response = await post(world, "reset", { goal: GOAL, ...settings() });
  expect(response.status).toBe(200);
  return world;
}

/** The four addresses and names every reset has to carry. */
function settings(): Record<string, string> {
  return {
    typesafe_api_url: "https://decide.example/v1",
    typesafe_model: "decide-model",
    text_model_base_url: "https://write.example/v1",
    text_model: "write-model",
  };
}

/** Headers are built by setting, not by listing: a later case-insensitive spelling wins. */
function set(header: Headers, entries: Record<string, string>): Headers {
  for (const [name, value] of Object.entries(entries)) header.set(name, value);
  return header;
}

function get(world: Doubles, path: string, extra: Record<string, string> = {}): Promise<Response> {
  const sent = set(new Headers({ host: world.guard.host }), extra);
  return Promise.resolve(world.app.fetch(new Request(`${BASE}${path}`, { headers: sent })));
}

/** A string body is sent as it is, so a test can hand over bytes that are not JSON. */
function payloadOf(body: unknown): string | null {
  if (body === undefined) return null;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function post(
  world: Doubles,
  name: string,
  body: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const payload = payloadOf(body);
  const sent = set(new Headers({ host: world.guard.host }), { [TOKEN_HEADER]: world.guard.token });
  if (payload !== null) sent.set("content-length", String(new TextEncoder().encode(payload).length));
  set(sent, extra);
  const request = new Request(`${BASE}/api/${name}`, {
    method: "POST",
    headers: sent,
    ...(payload === null ? {} : { body: payload }),
  });
  return Promise.resolve(world.app.fetch(request));
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let finish = (): void => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, resolve: () => finish() };
}

describe("guard", () => {
  test("binds the host and the origin to the port it listens on", () => {
    expect(security.loopback(PORT)).toEqual({
      host: `127.0.0.1:${PORT}`,
      origin: `http://127.0.0.1:${PORT}`,
    });
  });

  test("mints an unguessable token that is safe to put in a URL", () => {
    const first = security.token();
    const second = security.token();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  test("reads state only from the local host", () => {
    const guard: security.Guard = { ...security.loopback(PORT), token: "token" };
    const remote = new Request("http://127.0.0.1:9000/", { headers: { host: "127.0.0.1:9000" } });

    expect(security.local(new Request(BASE, { headers: { host: guard.host } }), guard)).toBe(true);
    expect(security.local(new Request(`${BASE}/`, { headers: { host: "evil.test" } }), guard)).toBe(false);
    expect(security.trusted(remote, guard)).toBe(false);
  });

  test("writes state only with the token and no foreign origin", () => {
    const guard: security.Guard = { ...security.loopback(PORT), token: "token" };
    const local = { host: guard.host };

    expect(security.trusted(new Request(BASE, { headers: local }), guard)).toBe(false);
    expect(security.trusted(new Request(BASE, { headers: { ...local, "x-demo-token": "other" } }), guard)).toBe(false);
    expect(security.trusted(new Request(BASE, { headers: { ...local, "x-demo-token": "token" } }), guard)).toBe(true);
    expect(
      security.trusted(new Request(BASE, { headers: { ...local, "x-demo-token": "token", origin: guard.origin } }), guard),
    ).toBe(true);
    expect(
      security.trusted(
        new Request(BASE, { headers: { ...local, ["x-demo-token"]: "token", origin: "https://evil.test" } }),
        guard,
      ),
    ).toBe(false);
  });
});

describe("gate", () => {
  test("lets only one step hold it at a time", () => {
    const gate = lock.create();

    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
    gate.leave();
  });

  test("hands the turn to whoever waited first", async () => {
    const gate = lock.create();
    const order: string[] = [];
    gate.tryEnter();
    const first = gate.enter().then(() => void order.push("first"));
    const second = gate.enter().then(() => void order.push("second"));

    expect(order).toEqual([]);
    gate.leave();
    await first;
    expect(order).toEqual(["first"]);
    gate.leave();
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});

describe("assets", () => {
  test("serves the three frontend files with their own type", async () => {
    const index = await assets.read("/", "token-value");
    const script = await assets.read("/app.js", "token-value");
    const style = await assets.read("/style.css", "token-value");

    expect(index?.type).toBe("text/html");
    expect(script?.type).toBe("text/javascript");
    expect(style?.type).toBe("text/css");
  });

  test("injects the token into the page that hands it back", async () => {
    const page = await assets.read("/", "token-value");

    expect(page?.body).toContain("token-value");
    expect(page?.body).not.toContain("__TOKEN__");
  });

  test("has no page for anything else", async () => {
    expect(await assets.read("/admin", "token-value")).toBeNull();
    expect(await assets.read("/app.js.map", "token-value")).toBeNull();
  });
});

describe("reading", () => {
  test("refuses a request from another host", async () => {
    const world = doubles();
    const response = await get(world, "/", { host: "evil.test" });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  test("reports an idle inspector with the settings and the step limit", async () => {
    const response = await get(doubles(), "/api/state");
    const state = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(state)).toEqual([
      "page",
      "status",
      "history",
      "decision",
      "typesafe_api_url",
      "typesafe_model",
      "text_model_base_url",
      "text_model",
      "max_steps",
    ]);
    expect(state.page).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.history).toEqual([]);
    expect(state.decision).toBeNull();
    expect(state.max_steps).toBe(MAX_STEPS);
    expect(typeof state.typesafe_model).toBe("string");
  });

  test("reports the run in effect with the settings it was opened with", async () => {
    const world = await start();
    world.state.marker = "kept";
    const response = await get(world, "/api/state");
    const state = (await response.json()) as Record<string, unknown>;

    expect(state.marker).toBe("kept");
    expect(state.typesafe_api_url).toBe("https://decide.example/v1");
    expect(state.typesafe_model).toBe("decide-model");
    expect(state.text_model_base_url).toBe("https://write.example/v1");
    expect(state.text_model).toBe("write-model");
    expect(state.max_steps).toBe(MAX_STEPS);
  });

  test("answers an unknown path with a not found", async () => {
    const response = await get(doubles(), "/nothing-here");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  test("never lets a browser cache a page it serves", async () => {
    const page = await get(doubles(), "/");
    const state = await get(doubles(), "/api/state");

    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(state.headers.get("content-type")).toBe("application/json");
  });

  test("serves the frontend with the token of this run", async () => {
    const world = doubles();
    const response = await get(world, "/");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(body).toContain(world.guard.token);
    expect(body).not.toContain("__TOKEN__");
  });
});

describe("writing", () => {
  test("refuses a request without the token of this run", async () => {
    const world = doubles();
    const response = await post(world, "reset", { goal: GOAL }, { [TOKEN_HEADER]: "stale-token" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: FOREIGN });
    expect(world.opened).toEqual([]);
  });

  test("refuses a request from another host or origin", async () => {
    const world = doubles();
    const foreignHost = await post(world, "reset", { goal: GOAL }, { host: "evil.test" });
    const foreignOrigin = await post(world, "reset", { goal: GOAL }, { origin: "https://evil.test" });

    expect(foreignHost.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(world.opened).toEqual([]);
  });

  test("accepts the token however the client spells the header", async () => {
    const world = doubles();
    const response = await post(world, "reset", { goal: GOAL, ...settings() }, { "x-demo-token": world.guard.token });

    expect(response.status).toBe(200);
    expect(world.opened).toHaveLength(1);
  });

  test("refuses a command before a run exists", async () => {
    const world = doubles();
    const response = await post(world, "tick", {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: NO_SESSION });
  });

  test("refuses a body that is too small or too large", async () => {
    const world = await start();
    const absent = await post(world, "tick", undefined);
    const empty = await post(world, "tick", "{}", { "content-length": "0" });
    const huge = await post(world, "tick", "{}", { "content-length": "8192" });
    const odd = await post(world, "tick", "{}", { "content-length": "twenty" });

    expect(absent.status).toBe(400);
    expect(await absent.json()).toEqual({ error: INVALID_SIZE });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: INVALID_SIZE });
    expect(huge.status).toBe(400);
    expect(await huge.json()).toEqual({ error: INVALID_SIZE });
    expect(odd.status).toBe(400);
    expect(await odd.json()).toEqual({ error: INVALID_SIZE });
    expect(world.sent).toEqual([]);
  });

  test("refuses a body that is not JSON", async () => {
    const world = await start();
    const response = await post(world, "tick", "{oops");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: MALFORMED });
  });

  test("runs the command the path names and returns the state it reached", async () => {
    const world = await start();
    world.state.status = "done";
    const response = await post(world, "tick", {});
    const state = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(state.status).toBe("done");
    expect(world.sent).toEqual([{ name: "tick", body: { fingerprint: null } }]);
  });

  test("passes the fingerprint a command was sent with", async () => {
    const world = await start();
    await post(world, "act", { fingerprint: "f9" });
    await post(world, "act", { fingerprint: 7 });
    await post(world, "act", [1, 2]);
    await post(world, "act", '"a string"');

    expect(world.sent).toEqual([
      { name: "act", body: { fingerprint: "f9" } },
      { name: "act", body: { fingerprint: null } },
      { name: "act", body: { fingerprint: null } },
      { name: "act", body: { fingerprint: null } },
    ]);
  });

  test("reports a run that failed as a local error", async () => {
    const world = await start();
    world.fail(new RuntimeFailure("The chosen action is no longer on the page."));
    const response = await post(world, "tick", {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The chosen action is no longer on the page." });
  });

  test("hides an unexpected failure behind a local error and frees the gate", async () => {
    const world = await start();
    world.fail(new Error("socket exploded"));
    const failed = await post(world, "tick", {});
    const next = await post(world, "tick", {});

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: LOCAL_ERROR });
    expect(next.status).toBe(200);
  });

  test("refuses a second step while one is running", async () => {
    const world = await start();
    const release = world.hold();
    const running = post(world, "tick", {});
    await Bun.sleep(5);
    const refused = await post(world, "tick", {});

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: BUSY });
    release();
    expect((await running).status).toBe(200);
    expect(world.sent).toHaveLength(1);
  });

  test("makes a state read wait for the step in progress", async () => {
    const world = await start();
    const release = world.hold();
    const running = post(world, "tick", {});
    await Bun.sleep(5);
    let read = false;
    const waiting = get(world, "/api/state").then((response) => {
      read = true;
      return response;
    });

    await Bun.sleep(5);
    expect(read).toBe(false);
    release();
    await running;
    expect((await waiting).status).toBe(200);
    expect(read).toBe(true);
  });
});

describe("reset", () => {
  test("opens the start page with the goal and the settings it was given", async () => {
    const world = doubles();
    await post(world, "reset", {
      goal: `  ${GOAL}  `,
      ...settings(),
      typesafe_api_key: " decision-key ",
      text_model_api_key: " text-key ",
    });

    expect(world.opened).toEqual([
      {
        url: form.START,
        goal: GOAL,
        config: {
          decisionAddress: "https://decide.example/v1",
          decisionCredential: "decision-key",
          decisionIdentity: "decide-model",
          textAddress: "https://write.example/v1",
          textCredential: "text-key",
          textIdentity: "write-model",
          screenshots: true,
          recordDir: null,
          vision: false,
        },
      },
    ]);
  });

  test("keeps the settings in effect for everything the client left out", async () => {
    const world = await start();
    await post(world, "reset", { goal: "Report the price" });

    expect(world.opened[1]).toEqual({
      url: form.START,
      goal: "Report the price",
      config: {
        decisionAddress: "https://decide.example/v1",
        decisionCredential: null,
        decisionIdentity: "decide-model",
        textAddress: "https://write.example/v1",
        textCredential: null,
        textIdentity: "write-model",
        screenshots: true,
        recordDir: null,
        vision: false,
      },
    });
  });

  test("reads the snapshot as an image when the client asks for it", async () => {
    const world = await start();
    await post(world, "reset", { goal: GOAL, vision: true });

    expect(world.opened[1].config.vision).toBe(true);
  });

  test("records the frames of a run only when it is asked to", async () => {
    const world = await start();
    await post(world, "reset", { goal: GOAL, record: true });

    expect(world.opened[1].config.recordDir).toBe(join(process.cwd(), form.RECORDING));
    expect(world.opened[1].config.screenshots).toBe(true);
  });

  test("refuses a body that is not an object", async () => {
    const world = doubles();
    const array = await post(world, "reset", ["goal"]);
    const text = await post(world, "reset", '"goal"');

    expect(array.status).toBe(400);
    expect(await array.json()).toEqual({ error: BODY });
    expect(text.status).toBe(400);
    expect(await text.json()).toEqual({ error: BODY });
    expect(world.opened).toEqual([]);
  });

  test("refuses a goal that is missing, blank or too long", async () => {
    const world = doubles();
    const missing = await post(world, "reset", {});
    const blank = await post(world, "reset", { goal: "   " });
    const long = await post(world, "reset", { goal: "x".repeat(2001) });

    expect(await missing.json()).toEqual({ error: INVALID_GOAL });
    expect(await blank.json()).toEqual({ error: INVALID_GOAL });
    expect(await long.json()).toEqual({ error: INVALID_GOAL });
    expect(world.opened).toEqual([]);
  });

  test("refuses a field of the wrong type or one that is too long", async () => {
    const world = doubles();
    const typed = await post(world, "reset", { goal: GOAL, typesafe_api_url: 5 });
    const long = await post(world, "reset", { goal: GOAL, text_model_api_key: "k".repeat(4097) });

    expect(await typed.json()).toEqual({ error: "TypeSafe address: at most 2000 characters." });
    expect(await long.json()).toEqual({ error: "Text model API key: at most 4096 characters." });
    expect(world.opened).toEqual([]);
  });

  test("refuses a reset without both model names and both addresses", async () => {
    const world = doubles();
    const partial = await post(world, "reset", {
      goal: GOAL,
      typesafe_api_url: "https://decide.example/v1",
      typesafe_model: "decide-model",
      text_model_base_url: "",
      text_model: "",
    });

    expect(await partial.json()).toEqual({ error: MISSING_SETTINGS });
    expect(world.opened).toEqual([]);
  });
});

describe("sessions", () => {
  test("closes the run in progress before it opens the next", async () => {
    const sessions = createSessions();
    const first = stub();
    const second = stub();
    await sessions.open("https://example.test/", GOAL, { port: first.port });
    expect(first.closes()).toBe(0);
    expect(sessions.current()).not.toBeNull();

    await sessions.open("https://example.test/", GOAL, { port: second.port });

    expect(first.closes()).toBe(1);
    expect(second.closes()).toBe(0);
  });

  test("closes the run once and forgets it", async () => {
    const sessions = createSessions();
    const browser = stub();
    await sessions.open("https://example.test/", GOAL, { port: browser.port });

    await sessions.close();
    await sessions.close();

    expect(browser.closes()).toBe(1);
    expect(sessions.current()).toBeNull();
  });
});
