import { record, text, whole } from "./read.ts";

/** The number of the step, as the run counted it. */
export function number(entry: unknown): number {
  return whole(record(entry).step);
}

/** The label of the executed action. */
export function action(entry: unknown): string {
  return String(record(entry).action ?? "");
}

/** The text the action typed, or nothing when it typed none. */
export function typed(entry: unknown): string | null {
  const value = text(record(entry).text);
  return value === "" ? null : value;
}

/** The helper that wrote the text. */
export function helper(entry: unknown): string {
  return String(record(entry).text_helper ?? "");
}

/** How long the model took to choose this action. */
export function latency(entry: unknown): number {
  return whole(record(entry).latency_ms);
}

/** Whether the action left the page different. */
export function changed(entry: unknown): boolean {
  return record(entry).page_changed === true;
}

/** Whether the heal model chose this action instead of the decision model. */
export function healed(entry: unknown): boolean {
  return record(entry).healed === true;
}

/** Why the heal model chose it, or nothing when it did not explain itself. */
export function reason(entry: unknown): string | null {
  const value = text(record(entry).heal_reason);
  return value === "" ? null : value;
}
