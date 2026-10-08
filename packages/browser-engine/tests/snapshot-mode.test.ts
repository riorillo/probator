import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { MARKER, READ_STATE, guard } from "../src/browser/scripts.ts";

// Execute the actual reader against a deterministic DOM double. This checks mode
// equivalence and guard lifetime, not browser layout or hit-testing implementation.
function world(count: number, shared = false) {
  let scopeReads = 0;
  let content = "Container";
  const scope = { parentElement: null, getRootNode: () => ({}),
    matches: (selector: string) => selector.startsWith("form,") || selector.startsWith("article,"),
    get innerText() { scopeReads++; return content; } };
  const nodes = Array.from({ length: count }, (_, i) => ({
    tagName: "BUTTON", isConnected: true, parentElement: shared ? scope : null, childNodes: [],
    getAttribute: (key: string) => key === "aria-label" ? `Button ${i}` : null,
    matches: (selector: string) => !shared && selector.startsWith("form,"),
    checkVisibility: () => true,
    getBoundingClientRect: () => ({ x: i, y: 0, width: 1, height: 1 }),
    getRootNode: () => document,
    get innerText() { return scope.innerText; },
  }));
  const document = {
    body: {}, title: "Test", documentElement: { scrollHeight: 720 },
    querySelectorAll: (selector: string) => selector === "*" || selector.startsWith("a[href]") ? nodes : [],
    elementFromPoint: (x: number) => nodes[Math.floor(x)],
    createRange: () => ({}), createTreeWalker: () => ({ nextNode: () => null }),
    getElementById: () => null,
  };
  return { context: { document, window: {}, performance: { timeOrigin: 1 }, location: { href: "https://test/" },
    scrollX: 0, scrollY: 0, innerWidth: 2000, innerHeight: 720, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 } },
    reads: () => scopeReads, nodes, setContent: (text: string) => { content = text; } };
}

test("marker mode preserves full semantics without building target guards", () => {
  const full = world(400), light = world(400);
  const page = runInNewContext(READ_STATE, full.context);
  expect(runInNewContext(MARKER, light.context)).toEqual(page.marker);
  expect(full.reads()).toBe(250);
  expect(light.reads()).toBe(0);
  expect(page.omitted_actions).toBe(150);
  expect(Object.keys(page.guards)).toHaveLength(250);
  // Even omitted controls still affect freshness.
  light.nodes[399].getAttribute = () => "Changed";
  expect(runInNewContext(MARKER, light.context)).not.toEqual(page.marker);
  // A marker pass must leave live guards usable for a subsequent click.
  runInNewContext(MARKER, full.context);
  expect(runInNewContext(guard(1), full.context)).toEqual([page.page_key, page.guards[1]]);
});

test("reads a shared form once, but rechecks live text after the snapshot", () => {
  const fixture = world(250, true);
  const page = runInNewContext(READ_STATE, fixture.context);
  expect(fixture.reads()).toBe(1);
  fixture.setContent("Validation failed");
  expect(runInNewContext(guard(1), fixture.context)).not.toEqual([page.page_key, page.guards[1]]);
  expect(fixture.reads()).toBe(2);
});

test("adds bounded context only to ambiguous labels and preserves validation hints", () => {
  const fixture = world(3, true);
  fixture.setContent("Hotel Roma, breakfast included. ".repeat(30));
  for (const node of fixture.nodes.slice(0, 2)) {
    node.getAttribute = (key: string) => ({ "aria-label": "Book", "aria-required": "true",
      "aria-invalid": "grammar" } as Record<string, string>)[key] ?? null;
  }
  const page = runInNewContext(READ_STATE, fixture.context);
  expect(page.actions[0].context).toHaveLength(240);
  expect(page.actions[0].required).toBe(true);
  expect(page.actions[0].invalid).toBe("grammar");
  expect(page.actions[1].context).toBe(page.actions[0].context);
  expect(page.actions[2].context).toBeUndefined();
  expect(fixture.reads()).toBe(1);
});

test("uses the dialog text budget instead of background text", () => {
  const fixture = world(0);
  const dialog = { getAttribute: () => "true", matches: () => false,
    checkVisibility: () => true, parentElement: null, getRootNode: () => ({}),
    querySelectorAll: () => [] };
  const document = { ...fixture.context.document,
    querySelectorAll: (selector: string) => selector.startsWith("dialog[") ? [dialog] : [],
    createRange: () => ({ selectNodeContents: () => {},
      getBoundingClientRect: () => ({ width: 20, height: 20, top: 0, bottom: 20, left: 0, right: 20 }) }),
    createTreeWalker: (root: unknown) => {
      const values = [root === dialog ? "Please confirm your booking" : "Background navigation"];
      return { nextNode: () => values.length ? { nodeType: 3, textContent: values.pop(),
        parentElement: { ...dialog, matches: () => false } } : null };
    },
  };
  const context = { ...fixture.context, document, Node: { ELEMENT_NODE: 1 } };
  const page = runInNewContext(READ_STATE, context);
  expect(page.text).toBe("Please confirm your booking");
  expect(runInNewContext(MARKER, context)).toEqual(page.marker);
});
