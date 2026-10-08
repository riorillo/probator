import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const layout = runInNewContext(readFileSync(new URL("../src/browser/label-layout.js", import.meta.url), "utf8"));
for (const count of [50, 250]) {
  const targets = Array.from({ length: count }, (_, i) => ({ index: String(i + 1),
    rect: { left: i % 20 * 60, top: Math.floor(i / 20) * 50, width: 54, height: 40 } }));
  const text = targets.map(({ rect }) => ({ left: rect.left + 20, top: rect.top + 15, width: 15, height: 14 }));
  for (let i = 0; i < 5; i++) layout(targets, 1280, 900, text);
  const samples = Array.from({ length: 20 }, () => {
    const start = performance.now();
    layout(targets, 1280, 900, text);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  console.log(JSON.stringify({ targets: count, median_layout_ms: samples[10] }));
}
