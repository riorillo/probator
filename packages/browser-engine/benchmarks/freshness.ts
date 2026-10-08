import { canonical } from "../src/canonical.ts";
import { equal } from "../src/equal.ts";

// Isolates host-side freshness comparison; excludes CDP, DOM reads and model latency.
let sink = 0;
function median(fn: () => boolean): number {
  for (let i = 0; i < 100; i++) sink += Number(fn());
  const samples = [];
  for (let round = 0; round < 7; round++) {
    const start = performance.now();
    for (let i = 0; i < 200; i++) sink += Number(fn());
    samples.push((performance.now() - start) / 200);
  }
  return samples.sort((a, b) => a - b)[3]!;
}
for (const size of [25, 250, 1000]) {
  const marker = [12345, "https://example.test", 0, 0, 1280, 720, "Page", "visible text ".repeat(450),
    Array.from({ length: size }, (_, node) => ({ node, role: "button", label: `Button ${node}`, kind: "click", value: "" })),
    Array.from({ length: size }, (_, node) => [node, "value", false, -1, false, false])];
  for (const changed of [false, true]) {
    const other = structuredClone(marker);
    if (changed) (other[9] as unknown[][])[size - 1]![1] = "changed";
    const before = median(() => canonical(marker) === canonical(other));
    const after = median(() => equal(marker, other));
    console.log(JSON.stringify({ size, changed, before_ms: before, after_ms: after, speedup: before / after }));
  }
}
if (!sink) throw new Error("Benchmark did not run");
