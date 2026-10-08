import { space } from "../src/policy/elements.ts";
import { criteria, request } from "../src/policy/questions.ts";
import { NEXT_ACTION, TARGET } from "../src/policy/prompts.ts";
import { page } from "../tests/support.ts";

// Controlled comparison: same page, history and rules, with/without duplicated
// candidate metadata and operation rules. Bytes are not model token counts.
for (const count of [25, 250]) {
  const observed = page({ actions: Array.from({ length: count }, (_, node) => ({
    id: `e${node}`, node, kind: "click", role: "checkbox", checked: "false",
    label: `Filter ${node}: free cancellation and breakfast included`,
  })) });
  const grouped = space(observed.actions);
  const compact = request({ page: observed, space: grouped, criteria: criteria(grouped),
    model: "benchmark", goal: "Apply the requested filters", history: [] });
  const duplicated = structuredClone(compact);
  duplicated.questions.click_target = { type: "choice", criteria: Object.fromEntries(
    Object.entries(grouped.targets.CLICK).map(([index, action]) => [index, {
      element: `[${index}] ${action.label}`, current_value: "", role: action.role, checked: action.checked,
    }]),
  ), instructions: { goal: "Apply the requested filters", operation: "CLICK", rules: [NEXT_ACTION, TARGET] } };
  const before = Buffer.byteLength(JSON.stringify(duplicated));
  const after = Buffer.byteLength(JSON.stringify(compact));
  console.log(JSON.stringify({ controls: count, duplicated_bytes: before, compact_bytes: after,
    reduction_percent: 100 * (1 - after / before) }));
}
