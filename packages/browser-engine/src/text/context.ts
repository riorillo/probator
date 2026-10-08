import type { Action, Page } from "../browser/types.ts";
import type { TextEntry } from "../history.ts";

const FIELD_FIELDS = ["label", "role", "value", "required", "invalid", "description", "context"] as const;
const TEXT_LIMIT = 6000;

/** The context a small model needs to write one field value. */
export function build(
  goal: string,
  action: Action,
  page: Page,
  history: readonly TextEntry[],
): Record<string, unknown> {
  const field: Record<string, unknown> = {};
  for (const name of FIELD_FIELDS) {
    if (name === "label" || name === "role" || name === "value" || name in action) field[name] = action[name] ?? null;
  }
  return {
    goal,
    field,
    page: { title: page.title, text: page.text.slice(0, TEXT_LIMIT) },
    recent_actions: history.slice(-6).map(recent),
  };
}

function recent(entry: TextEntry): Record<string, unknown> {
  return { action: entry.action ?? null, text: entry.text ?? null };
}
