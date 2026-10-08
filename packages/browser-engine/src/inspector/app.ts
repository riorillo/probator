import { Hono } from "hono";
import { InputError, RuntimeFailure, messageOf } from "../errors.ts";
import { decode, encode } from "../json.ts";
import { settle } from "../outcome.ts";
import * as assets from "./assets.ts";
import * as commands from "./commands.ts";
import * as lock from "./lock.ts";
import * as security from "./security.ts";
import type { Sessions } from "./session.ts";

const API = "/api/";
const STATE = "/api/state";
const MAXIMUM_BODY = 8192;

const FORBIDDEN = "Forbidden";
const NOT_FOUND = "Not found";
const LOCAL_ONLY = "Local requests only.";
const STEP_RUNNING = "A browser step is already running.";
const INVALID_SIZE = "Invalid request size.";
const MALFORMED_BODY = "The request body is not valid JSON.";
const LOCAL_ERROR = "Local error; no automatic retry. Restart with AVVIA.";

/** What the inspector serves: one run, one guard, one frontend. */
export type Inspector = {
  readonly sessions: Sessions;
  readonly guard: security.Guard;
  readonly directory: string;
};

/** Builds the HTTP surface: three read-only files and a JSON API behind the local guard. */
export function create(inspector: Inspector): Hono {
  const app = new Hono();
  const gate = lock.create();

  app.get("*", async (c) => {
    const request = c.req.raw;
    if (!security.local(request, inspector.guard)) return respond(FORBIDDEN, "text/plain", 403);
    const path = new URL(request.url).pathname;
    if (path === STATE) return state(inspector, gate);
    const page = await assets.read(path, inspector.guard.token, inspector.directory);
    if (page === null) return respond(NOT_FOUND, "text/plain", 404);
    return respond(page.body, `${page.type}; charset=utf-8`);
  });

  app.post("*", async (c) => {
    const request = c.req.raw;
    if (!security.trusted(request, inspector.guard)) return json({ error: LOCAL_ONLY }, 403);
    if (!gate.tryEnter()) return json({ error: STEP_RUNNING }, 409);
    const outcome = await settle(() => command(inspector, request));
    gate.leave();
    if (!outcome.ok) return failure(outcome.error);
    return json(outcome.value);
  });

  return app;
}

async function command(inspector: Inspector, request: Request): Promise<Record<string, unknown>> {
  const name = nameOf(new URL(request.url).pathname);
  return commands.run(inspector.sessions, name, await bodyOf(request));
}

/** Reading the state waits for a running step, so it never reports a half-applied one. */
async function state(inspector: Inspector, gate: lock.Gate): Promise<Response> {
  await gate.enter();
  const outcome = await settle(() => commands.report(inspector.sessions));
  gate.leave();
  if (!outcome.ok) return failure(outcome.error);
  return json(outcome.value);
}

async function bodyOf(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isInteger(length) || length <= 0 || length >= MAXIMUM_BODY) {
    throw new InputError(INVALID_SIZE);
  }
  const parsed = await decode(await request.text());
  if (!parsed.ok) throw new InputError(MALFORMED_BODY);
  return parsed.value;
}

function nameOf(path: string): string {
  return path.startsWith(API) ? path.slice(API.length) : path;
}

function failure(error: unknown): Response {
  if (error instanceof InputError || error instanceof RuntimeFailure) {
    return json({ error: messageOf(error) }, 400);
  }
  return json({ error: LOCAL_ERROR }, 500);
}

function json(body: unknown, status = 200): Response {
  return respond(encode(body), "application/json", status);
}

function respond(body: string, type: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
