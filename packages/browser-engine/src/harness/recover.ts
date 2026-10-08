import { settle } from "../outcome.ts";
import * as config from "./config.ts";
import * as progress from "./progress.ts";
import { since, type State, type Update } from "./state.ts";

/**
 * Recovers from a page that changed while the harness was reasoning about it:
 * the decision is dropped and the page is observed again.
 */
export async function recover(state: State): Promise<Update> {
  // A full step that found a changed page reports the new page instead of the failure.
  const step = progress.start({ decision: null, status: "ready", failure: null });
  const observed = await settle(() => state.port.observe(config.screenshots(state.config)));
  if (!observed.ok) return progress.stop(step, observed.error);
  const refreshed = progress.add(step, { page: observed.value, elapsed_ms: since(state) });
  return progress.finish(refreshed);
}
