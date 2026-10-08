/**
 * The overlay draws one box per element that has a rectangle. The server sends the
 * viewport size and rectangles in pixels, the browser draws percentages.
 */

import { actions, height, width } from "./page.ts";
import { numeric, record, text } from "./read.ts";
import * as report from "./report.ts";

/** Where an element sits in the viewport, as percentages of it. */
export type Spot = {
  readonly left: string;
  readonly top: string;
  readonly width: string;
  readonly height: string;
};

/** One drawable target: the element index and where it sits. */
export type Box = { readonly node: number; readonly spot: Spot };

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Every element of the page that has a rectangle, once each. */
export function boxes(page: unknown): readonly Box[] {
  const seen = new Set<number>();
  return actions(page)
    .map((entry) => box(entry, page))
    .filter((found) => found !== null)
    .filter((found) => first(seen, found.node));
}

/** The element the run pointed at, or nothing when it pointed at none. */
export function chosen(state: unknown): number | null {
  const picked = report.choice(state);
  if (picked === null) return null;
  return nodeOf(report.page(state), picked);
}

/** The element an action id belongs to. */
export function nodeOf(page: unknown, id: string): number | null {
  const found = actions(page).map(record).find((action) => text(action.id) === id);
  return found === undefined ? null : numeric(found.node);
}

function first(seen: Set<number>, node: number): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  return true;
}

function box(entry: unknown, page: unknown): Box | null {
  const action = record(entry);
  const node = numeric(action.node);
  const found = rect(action.rect);
  if (node === null || found === null) return null;
  return { node, spot: share(found, page) };
}

function rect(value: unknown): Rect | null {
  const found = record(value);
  const x = numeric(found.x);
  const y = numeric(found.y);
  const w = numeric(found.w);
  const h = numeric(found.h);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

function share(found: Rect, page: unknown): Spot {
  const wide = width(page);
  const tall = height(page);
  return {
    left: percent(found.x, wide),
    top: percent(found.y, tall),
    width: percent(found.w, wide),
    height: percent(found.h, tall),
  };
}

function percent(value: number, total: number): string {
  return total > 0 ? `${(100 * value) / total}%` : "0%";
}
