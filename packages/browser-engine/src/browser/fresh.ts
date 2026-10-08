import { StalePage, messageOf } from "../errors.ts";
import { equal } from "../equal.ts";
import type { Action, Freshness, Page } from "./types.ts";
import type { Client } from "./client.ts";
import { MARKER, guard } from "./scripts.ts";

const GUARDED_KINDS = new Set(["click", "select"]);

/** Answers whether an observation still describes the page, without throwing. */
export async function check(client: Client, page: Page, action?: Action): Promise<Freshness> {
  if (action && GUARDED_KINDS.has(action.kind)) return guarded(client, page, action);
  return marker(client, page);
}

async function guarded(client: Client, page: Page, action: Action): Promise<Freshness> {
  const node = action.node;
  if (!Number.isInteger(node)) return { kind: "changed" };
  const probe = await client.read(guard(node as number));
  if (!probe.ok) return unreadable(probe.error);
  const expected = [page.page_key, page.guards[String(node)] ?? null];
  return equal(probe.value, expected) ? { kind: "fresh" } : { kind: "changed" };
}

async function marker(client: Client, page: Page): Promise<Freshness> {
  const probe = await client.read(MARKER);
  if (!probe.ok) return unreadable(probe.error);
  return equal(probe.value, page.marker) ? { kind: "fresh" } : { kind: "changed" };
}

function unreadable(error: unknown): Freshness {
  if (error instanceof StalePage) return { kind: "unreadable", failure: error };
  throw error;
}

export function stale(error: unknown): StalePage {
  if (error instanceof StalePage) return error;
  return new StalePage(messageOf(error));
}
