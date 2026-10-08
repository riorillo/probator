import type { Entry } from "../history.ts";

/** Keep useful recent moves visible when identical no-effect waits/clicks repeat.
 * Counts describe attempts, never completed requirements. The full trace is untouched.
 */
export function recentActions(history: readonly Entry[]): Record<string, unknown>[] {
  const groups: Record<string, unknown>[] = [];
  let previous: Entry | undefined;
  for (let i = history.length - 1; i >= Math.max(0, history.length - 40); i--) {
    const entry = history[i];
    const last = groups.at(-1);
    if (last && previous && entry.page_changed === false && previous.page_changed === false &&
      entry.action === previous.action && entry.kind === previous.kind && entry.text === previous.text &&
      entry.url === previous.url && entry.target === previous.target) {
      last.attempts = Number(last.attempts ?? 1) + 1;
    } else {
      if (groups.length === 10) break;
      groups.push({ action: entry.action ?? null, kind: entry.kind, text: entry.text ?? null,
        page_changed: entry.page_changed ?? null });
    }
    previous = entry;
  }
  return groups.reverse();
}
