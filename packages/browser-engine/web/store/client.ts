/**
 * The only place that talks to the server. It never throws: every call answers with
 * an `Outcome`, so the caller decides what to show and nothing unwinds the render.
 */

import { RuntimeFailure, messageOf } from "../../src/errors.ts";
import { failed, settle, type Outcome } from "../../src/outcome.ts";
import { record, text } from "../model/read.ts";

/** One command of the inspector. */
export type Command = "reset" | "tick" | "predict" | "act";

async function send(command: Command, body: unknown): Promise<Outcome<unknown>> {
  const answer = await settle(() =>
    fetch(`/api/${command}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-token": token() },
      body: JSON.stringify(body),
    }),
  );
  if (!answer.ok) return failed(answer.error);
  return settle(() => read(answer.value));
}

/** Reads the answer of a command that writes the state. */
export async function run(command: Command, body: unknown = {}): Promise<Outcome<unknown>> {
  return send(command, body);
}

/** Reads the state of the run without touching it. */
export async function load(): Promise<Outcome<unknown>> {
  const answer = await settle(() => fetch("/api/state", { headers: { "x-demo-token": token() } }));
  if (!answer.ok) return failed(answer.error);
  return settle(() => read(answer.value));
}

/** The JSON body of a response, or a failure naming what the server said. */
async function read(response: Response): Promise<unknown> {
  const body = await response.json();
  if (response.ok) return body;
  throw new RuntimeFailure(text(record(body).error, response.statusText));
}

/** The message of a failure as the alert box shows it. */
export function reason(error: unknown): string {
  return messageOf(error);
}

/** The token the server wrote into this page, read where it is used. */
function token(): string {
  const meta = document.querySelector('meta[name="demo-token"]');
  if (meta === null) return "";
  return meta.getAttribute("content") ?? "";
}
