import { expect, test } from "bun:test";
import { canonical } from "../src/canonical.ts";
import { equal } from "../src/equal.ts";

test("matches canonical comparison for CDP values and null normalization", () => {
  const values: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 0, -0, false, true, "", "0",
    [], [null], [undefined], Array(1), {}, { a: null }, { a: undefined },
    { a: 1, b: [2, { x: "value" }] }, { b: [2, { x: "value" }], a: 1 },
    { a: 1, b: [2, { x: "changed" }] }, { b: null }, { constructor: 1 },
    JSON.parse('{"__proto__": 1}')];
  for (const a of values) for (const b of values) {
    expect(equal(a, b)).toBe(canonical(a) === canonical(b));
  }
});

test("detects late page changes and does not cache mutable input", () => {
  const a = Array.from({ length: 1000 }, (_, node) => ({ node, label: `Button ${node}`, value: "" }));
  const b = structuredClone(a);
  expect(equal(a, b)).toBe(true);
  b[999]!.value = "changed";
  expect(equal(a, b)).toBe(false);
  b[999]!.value = "";
  expect(equal(a, b)).toBe(true);
  b.reverse();
  expect(equal(a, b)).toBe(false);
});
