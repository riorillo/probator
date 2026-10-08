import type { Freshness, Page } from "../browser/types.ts";
import { StalePage } from "../errors.ts";
import { failed, ok, settle, type Outcome } from "../outcome.ts";
import * as config from "./config.ts";
import type { State } from "./state.ts";

/** Re-reads the page when the observation no longer describes it. */
export async function refresh(state: State): Promise<Outcome<Page>> {
  const probe = await inspect(state);
  if (!probe.ok) return failed(probe.error);
  if (probe.value.kind === "unreadable") return failed(probe.value.failure);
  if (probe.value.kind === "changed") return settle(() => state.port.observe(config.screenshots(state.config)));
  return ok(state.page);
}

/**
 * Confirms the observation before a decision is used.
 * A null result means the page still matches; the failure is the reason it does not.
 */
export async function confirm(state: State, message: string): Promise<Outcome<StalePage | null>> {
  const probe = await inspect(state);
  if (!probe.ok) return failed(probe.error);
  if (probe.value.kind === "unreadable") return ok(probe.value.failure);
  if (probe.value.kind === "fresh") return ok(null);
  return ok(new StalePage(message));
}

function inspect(state: State): Promise<Outcome<Freshness>> {
  return settle(() => state.port.fresh(state.page));
}
