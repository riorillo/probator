/** The exported trace: the reported run as JSON, ready to download. */

import { record } from "./read.ts";

/** The name of the exported file. */
export const NAME = "s1-visual-browser-agent-trace.json";

/** The run as JSON, without the frame the page has already shown. */
export function trace(state: unknown): string {
  const document = record(state);
  const page = without("screenshot", record(document.page));
  return JSON.stringify({ ...without("page", document), page }, null, 2);
}

/** The same object without one key. */
function without(key: string, source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}
