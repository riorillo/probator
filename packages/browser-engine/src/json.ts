import { settle, type Outcome } from "./outcome.ts";

/** True for a JSON object: arrays and null are values, not records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  return !Array.isArray(value);
}

export function encode(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Parses JSON as a value: malformed input becomes a failed outcome, never a throw. */
export function decode(text: string): Promise<Outcome<unknown>> {
  return settle(() => JSON.parse(text) as unknown);
}
