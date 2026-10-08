/**
 * The client reads JSON the server describes loosely, so every value it uses goes
 * through one of these readers first. A wrong shape becomes a plain default instead
 * of an exception travelling through a component.
 */

import { isRecord } from "../../src/json.ts";

/** Reads a JSON object; anything else becomes an empty one. */
export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Reads a string; anything else becomes the fallback. */
export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Reads a finite number; anything else becomes the fallback. */
export function whole(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads a finite number, or nothing at all. */
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads an array; anything else becomes an empty one. */
export function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
