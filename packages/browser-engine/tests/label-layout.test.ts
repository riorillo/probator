import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type Rect = { left: number; top: number; width: number; height: number };
type Target = { index: string; rect: Rect };
type Label = Rect & Target;
const layout = runInNewContext(readFileSync(new URL("../src/browser/label-layout.js", import.meta.url), "utf8")) as
  (targets: Target[], width: number, height: number) => Label[];
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

test("keeps exact IDs and target geometry, with deterministic viewport-bounded badges", () => {
  const targets = [
    { index: "1", rect: { left: 0, top: 0, width: 15, height: 15 } },
    { index: "250", rect: { left: 310, top: 190, width: 10, height: 10 } },
  ];
  const before = structuredClone(targets);
  const labels = layout(targets, 320, 200);
  expect(layout(targets, 320, 200)).toEqual(labels);
  expect(targets).toEqual(before);
  for (const [i, label] of labels.entries()) {
    expect(label.index).toBe(targets[i].index);
    expect(label.rect).toEqual(targets[i].rect);
    expect(label.left).toBeGreaterThanOrEqual(0);
    expect(label.top).toBeGreaterThanOrEqual(0);
    expect(label.left + label.width).toBeLessThanOrEqual(320);
    expect(label.top + label.height).toBeLessThanOrEqual(200);
  }
});

test("separates coincident labels instead of printing their numbers on top of each other", () => {
  const targets = Array.from({ length: 4 }, (_, i) => ({ index: String(i + 1), rect: { left: 100, top: 100, width: 80, height: 30 } }));
  const labels = layout(targets, 640, 480);
  for (let i = 0; i < labels.length; i++) {
    expect(area(labels[i], targets[i].rect)).toBe(0);
    for (let j = i + 1; j < labels.length; j++) expect(area(labels[i], labels[j])).toBe(0);
  }
});

test("keeps a dense calendar legible without removing any target", () => {
  const targets = Array.from({ length: 42 }, (_, i) => ({ index: String(i + 1),
    rect: { left: 100 + i % 7 * 44, top: 100 + Math.floor(i / 7) * 44, width: 40, height: 40 } }));
  const labels = layout(targets, 640, 480);
  expect(labels).toHaveLength(42);
  let overlap = 0;
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) overlap += area(labels[i], labels[j]);
  expect(overlap).toBe(0);
  expect(layout([], 640, 480)).toEqual([]);
});

test("prefers free space over obscuring a field label", () => {
  const target = { index: "1", rect: { left: 100, top: 100, width: 160, height: 40 } };
  const heading = { left: 100, top: 78, width: 100, height: 20 };
  const withText = layout as (targets: Target[], width: number, height: number, text: Rect[]) => Label[];
  const [badge] = withText([target], 640, 480, [heading]);
  expect(area(badge, heading)).toBe(0);
  expect(badge.index).toBe("1");
});
