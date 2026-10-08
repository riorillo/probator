import { InputError, RuntimeFailure, StalePage } from "../errors.ts";
import { isRecord } from "../json.ts";
import { check } from "./fresh.ts";
import { DOCUMENT_CHANGED, type Client } from "./client.ts";
import { target as targetScript } from "./scripts.ts";
import type { Session } from "./session.ts";
import type { Action, Page } from "./types.ts";

const WAIT_MS = 100;
const BUTTON = "left";
const MOUSE_EVENTS = ["mousePressed", "mouseReleased"];
const SELECT_MODIFIER = process.platform === "darwin" ? 4 : 2;
const CHANGED_AFTER_CHOICE = "The page changed after this choice. Observe again.";
const INTERRUPTED = "Running the dropdown menu was interrupted; check the page before trying again.";
const UNCERTAIN = "Running the dropdown menu was not confirmed; check the page before trying again.";
const TARGET_CHANGED = "The target changed or is covered. Observe again.";
const BAD_NODE = "The observed node is not valid.";

export type Point = { readonly x: number; readonly y: number };

/** Executes a chosen action against the page it was chosen from. */
export async function act(session: Session, action: Action, page: Page, text: string | null): Promise<unknown> {
  const state = await check(session.client, page, action);
  if (state.kind === "unreadable") throw state.failure;
  if (state.kind === "changed") throw new StalePage(CHANGED_AFTER_CHOICE);
  if (action.kind === "wait") await Bun.sleep(WAIT_MS);
  const result = await perform(session.client, action, text);
  session.afterInput = action.kind === "wait" ? null : action;
  return result;
}

export async function perform(client: Client, action: Action, text: string | null): Promise<unknown> {
  if (action.kind === "scroll") await wheel(client, action);
  if (action.kind !== "scroll" && action.kind !== "wait") await reach(client, action, text);
  return { executed: action.id };
}

async function wheel(client: Client, action: Action): Promise<void> {
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 550,
    y: 650,
    deltaX: 0,
    deltaY: action.delta,
  });
}

async function reach(client: Client, action: Action, text: string | null): Promise<void> {
  if (!Number.isInteger(action.node)) throw new InputError(BAD_NODE);
  const probe = await client.read(targetScript(action));
  if (!probe.ok) throw interrupted(action.kind);
  if (probe.value === null || probe.value === undefined) throw refused(action.kind);
  const at = point(probe.value, action.kind);
  if (action.kind === "select") return;
  await press(client, at);
  if (action.kind === "fill") await insert(client, text);
}

function point(value: unknown, kind: string): Point {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") throw refused(kind);
  return { x: value.x, y: value.y };
}

async function press(client: Client, at: Point): Promise<void> {
  for (const type of MOUSE_EVENTS) {
    await client.call("Input.dispatchMouseEvent", {
      type,
      x: at.x,
      y: at.y,
      button: BUTTON,
      clickCount: 1,
    });
  }
}

async function insert(client: Client, text: string | null): Promise<void> {
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers: SELECT_MODIFIER,
    commands: ["selectAll"],
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    modifiers: SELECT_MODIFIER,
  });
  await client.call("Input.insertText", { text });
}

function interrupted(kind: string): Error {
  if (kind === "select") return new RuntimeFailure(INTERRUPTED);
  return new StalePage(DOCUMENT_CHANGED);
}

function refused(kind: string): Error {
  if (kind === "select") return new RuntimeFailure(UNCERTAIN);
  return new StalePage(TARGET_CHANGED);
}
