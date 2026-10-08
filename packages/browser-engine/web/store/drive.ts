/**
 * The run loop, as plain async functions over the store: each turn reads the screen,
 * asks the server one command and writes the answer back. No component holds a run.
 */

import type { Outcome } from "../../src/outcome.ts";
import * as fields from "../model/fields.ts";
import * as label from "../model/labels.ts";
import * as report from "../model/report.ts";
import * as client from "./client.ts";
import { current, update } from "./screen.ts";

/** How long the shortcut leaves a predicted action on screen before applying it. */
export const SPEED_TURN_MS = 450;

/** One request of the loop. */
export type Turn = { readonly name: client.Command; readonly body: unknown };

/** Starts a new run from what the form currently holds. */
export async function start(): Promise<void> {
  if (current().busy) return;
  const values = fields.filled(current().values, current().report);
  update({ values, busy: true, automatic: true, fault: null, note: label.OPENING });
  await begin(values);
  update({ busy: false });
}

/** Opens the run and, when the reset was accepted, drives it. */
async function begin(values: fields.Values): Promise<void> {
  const answer = await client.run("reset", reset(values, current().vision));
  await landing(answer);
  if (!answer.ok) return;
  await auto();
}

/** The body that opens a run: the form as it is, and the mode the snapshot is read in. */
export function reset(values: fields.Values, vision: boolean): Record<string, unknown> {
  return { ...fields.body(values), vision };
}

/** Drives the run to its end, one request at a time. */
async function auto(): Promise<void> {
  let spent = 0;
  while (runs(spent)) {
    spent += 1;
    await turn();
  }
  update({ automatic: false, note: null });
}

/** Whether the loop asks one more time. */
function runs(spent: number): boolean {
  if (!current().automatic) return false;
  if (spent >= report.budget(current().report)) return false;
  return !report.ended(current().report);
}

/** One turn: the next decision, then the action it asked for. */
async function turn(): Promise<void> {
  update({ note: label.RUNNING });
  const step = ask(current().report, current().speeding);
  await landing(await client.run(step.name, step.body));
  await follow();
}

/** Applies a predicted decision, once the shortcut delay has passed. */
async function follow(): Promise<void> {
  if (!current().speeding) return;
  await delay(SPEED_TURN_MS);
  if (!current().automatic) return;
  const step = act(current().report, current().speeding);
  if (step === null) return;
  await landing(await client.run(step.name, step.body));
}

/** The request that moves the run one decision forward. */
export function ask(state: unknown, speeding: boolean): Turn {
  const page = report.pageKey(state);
  if (!speeding) return tick(state, page);
  if (report.status(state) === report.IDLE) return tick(state, page);
  if (page === null) return tick(state, page);
  return { name: "predict", body: { status: report.status(state), fingerprint: page } };
}

/** The request that applies the decision just predicted, or nothing when it cannot. */
export function act(state: unknown, speeding: boolean): Turn | null {
  const page = report.pageKey(state);
  if (!speeding) return null;
  if (report.status(state) !== report.PREDICTED) return null;
  if (page === null) return null;
  return { name: "act", body: { fingerprint: page } };
}

function tick(state: unknown, page: string | null): Turn {
  return { name: "tick", body: { status: report.status(state), fingerprint: page } };
}

/** Writes the answer of one request into the screen, or reports its failure. */
async function landing(answer: Outcome<unknown>): Promise<void> {
  if (answer.ok) {
    update({ report: answer.value });
    return;
  }
  await recover(client.reason(answer.error));
}

/** Stops the loop, shows why, and reads back the state the server holds. */
async function recover(message: string): Promise<void> {
  update({ automatic: false, fault: message, note: label.ATTENTION });
  const state = await client.load();
  if (state.ok) update({ report: state.value });
}

/** Reads the state the server already holds, so a reload shows the run in effect. */
export async function greet(): Promise<void> {
  const state = await client.load();
  if (!state.ok) {
    update({ note: label.UNREACHABLE });
    return;
  }
  const vision = report.status(state.value) === report.IDLE ? current().vision : report.vision(state.value);
  update({ report: state.value, vision });
}

/** Asks the loop to stop once the request in flight is back. */
export function pause(): void {
  if (!current().automatic) return;
  update({ automatic: false, note: label.PAUSING });
}

/** The shortcut on and off. */
export function speed(on: boolean): void {
  update({ speeding: on });
}

/** The overlay on and off. */
export function mark(on: boolean): void {
  update({ marking: on });
}

/** The image mode of the snapshot, as the next run will read it. */
export function vision(on: boolean): void {
  update({ vision: on });
}

/** One edited field, with the rest of the form left as it is. */
export function edit(key: fields.Key, value: string): void {
  const screen = current();
  update({ values: fields.edited(screen.values, screen.report, key, value) });
}

/** Waits, so a predicted action stays visible before it is applied. */
async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
