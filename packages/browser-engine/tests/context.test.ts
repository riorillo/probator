import { expect, test } from "bun:test";
import { recentActions } from "../src/policy/context.ts";
import { criteria, request } from "../src/policy/questions.ts";
import { space } from "../src/policy/elements.ts";
import { entry, page } from "./support.ts";

test("compresses no-effect attempts without losing the preceding useful action", () => {
  const history = [entry({ action: "Search", page_changed: true }),
    ...Array.from({ length: 20 }, () => entry({ action: "Wait", kind: "wait", page_changed: false }))];
  const original = structuredClone(history);
  expect(recentActions(history)).toEqual([
    { action: "Search", kind: "click", text: null, page_changed: true },
    { action: "Wait", kind: "wait", text: null, page_changed: false, attempts: 20 },
  ]);
  expect(history).toEqual(original);
});

test("does not merge changed, unknown, different target, text or URL attempts", () => {
  for (const change of [{ page_changed: true }, { page_changed: null }, { target: "other" },
    { text: "other" }, { url: "https://other.test" }]) {
    expect(recentActions([entry({ page_changed: false }), entry({ page_changed: false, ...change })])).toHaveLength(2);
  }
});

test("bounds history and never treats a repeat count as completion", () => {
  expect(recentActions(Array.from({ length: 100 }, () => entry({ page_changed: false })))[0].attempts).toBe(40);
  expect(recentActions(Array.from({ length: 100 }, (_, i) => entry({ action: String(i) })))).toHaveLength(10);
});

test("text target references resolve to exact values and all select options", () => {
  const observed = page({ omitted_actions: 5, actions: [
    { id: "a", kind: "select", node: 1, label: "City → Rome", value: "ROM", current_value: "Milan" },
    { id: "b", kind: "select", node: 1, label: "City → Paris", value: "PAR", current_value: "Milan" },
  ] });
  const grouped = space(observed.actions);
  const input = { page: observed, space: grouped, criteria: criteria(grouped), goal: "Choose Rome", model: "test", history: [] };
  const built = request(input);
  const target = built.questions.select_target as { criteria: Record<string, unknown> };
  expect(target.criteria).toEqual({ "1:1": { element: "1", option: "1:1" }, "1:2": { element: "1", option: "1:2" } });
  expect(built.state.elements?.[0].value).toBe("Milan");
  expect(built.state.elements?.[0].options).toEqual([
    { index: "1:1", label: "City → Rome", value: "ROM" },
    { index: "1:2", label: "City → Paris", value: "PAR" },
  ]);
  expect(built.state.omitted_actions).toBe(5);
  const visual = request({ ...input, vision: true });
  const visualTarget = visual.questions.select_target as { criteria: Record<string, Record<string, unknown>> };
  expect(visualTarget.criteria["1:1"].element).toBe("[1:1] City → Rome");
  expect(visualTarget.criteria["1:1"].current_value).toBe("Milan");
});

test("snapshot hints reach text targets, visual criteria and text generation", async () => {
  const { build } = await import("../src/text/context.ts");
  const hints = { required: true, invalid: "true", description: "Enter a work email", context: "Billing contact" };
  const observed = page({ actions: [
    { id: "a", kind: "fill", node: 1, label: "Email", role: "textbox", value: "", ...hints },
    { id: "b", kind: "fill", node: 2, label: "Email", role: "textbox", value: "", context: "Guest contact" },
  ] });
  const grouped = space(observed.actions);
  const input = { page: observed, space: grouped, criteria: criteria(grouped), goal: "Set billing email", model: "test", history: [] };
  expect(request(input).state.elements?.[0]).toMatchObject(hints);
  const visual = request({ ...input, vision: true });
  const target = visual.questions.type_text_target as { criteria: Record<string, unknown> };
  expect(target.criteria["1"]).toMatchObject(hints);
  expect(build(input.goal, observed.actions[0], observed, []).field).toMatchObject(hints);
});
