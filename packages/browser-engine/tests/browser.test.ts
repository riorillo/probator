import { describe, expect, test } from "bun:test";
import { create } from "../src/browser/client.ts";
import { act, perform } from "../src/browser/execute.ts";
import { check } from "../src/browser/fresh.ts";
import { bind } from "../src/browser/port.ts";
import { fingerprint, observe } from "../src/browser/read.ts";
import { LINKS, MARKER, READY_STATE, READ_STATE, CLEAR, draw, guard, settle, target } from "../src/browser/scripts.ts";
import { close, open } from "../src/browser/session.ts";
import type { Action, Page } from "../src/browser/types.ts";
import type { Transport } from "../src/cdp/transport.ts";
import { InputError, RuntimeFailure, StalePage } from "../src/errors.ts";
import { plan } from "../src/marks.ts";
import type { Outcome } from "../src/outcome.ts";
import { CHANGED, cdp, page, session, value } from "./support.ts";

/** The failure of an outcome the test expects to have failed. */
function failure(outcome: Outcome<unknown>): unknown {
  if (outcome.ok) throw new Error("Expected a failed outcome.");
  return outcome.error;
}

/** The expression, compiled by the engine the browser uses, without running it. */
function compile(expression: string): () => unknown {
  return new Function(`return (${expression})`) as () => unknown;
}

const FILL: Action = { id: "e1", kind: "fill", node: 10, label: "Search", value: "" };
const CLICK: Action = { id: "e2", kind: "click", node: 10, label: "Go" };
const SELECT: Action = { id: "s1", kind: "select", node: 12, value: "zrh" };
const SCROLL: Action = { id: "sc", kind: "scroll", delta: 400 };
const WAIT: Action = { id: "wait", kind: "wait" };

/** A page whose node 10 is guarded and whose node 12 is guarded for the dropdown. */
function guarded(): Page {
  return page({ page_key: ["k"], guards: { "10": "g10", "12": "g12" } });
}

/** The reply that reports the guard of one node of that page. */
function guardRead(node: number): { result: { value: unknown } } {
  return value([["k"], node === 12 ? "g12" : "g10"]);
}

describe("client", () => {
  test("reads a value from the page", async () => {
    const caller = cdp();
    caller.replyRead(value(7));
    const client = create(caller, "session-1");
    expect(await client.read("1+6")).toEqual({ ok: true, value: 7 });
    expect(caller.calls[0]).toEqual({
      method: "Runtime.evaluate",
      params: { expression: "1+6", returnByValue: true },
      sessionId: "session-1",
    });
  });

  test("reports a changed document as a failure instead of throwing", async () => {
    const caller = cdp();
    caller.replyRead(CHANGED);
    const outcome = await create(caller, "session-1").read("document.title");
    expect(failure(outcome)).toBeInstanceOf(StalePage);
    expect(String(failure(outcome))).toContain("The document changed while it was being read.");
  });

  test("reports a caller failure as data", async () => {
    const caller = cdp();
    caller.breakRead(new RuntimeFailure("The socket closed."));
    const outcome = await create(caller, "session-1").read("document.title");
    expect(String(failure(outcome))).toContain("The socket closed.");
  });

  test("reports a navigation that tore the document down as a change", async () => {
    const caller = cdp();
    caller.breakRead(new RuntimeFailure("Runtime.evaluate: Cannot find context with specified id"));
    const outcome = await create(caller, "session-1").read("document.title");
    expect(failure(outcome)).toBeInstanceOf(StalePage);
    expect(String(failure(outcome))).toContain("The document changed while it was being read.");
  });

  test("waits for a promise when asked", async () => {
    const caller = cdp();
    caller.replyRead(value(undefined));
    await create(caller, "session-1").evaluate("new Promise(() => {})", { awaitPromise: true });
    expect(caller.calls[0].params).toEqual({
      expression: "new Promise(() => {})",
      returnByValue: true,
      awaitPromise: true,
    });
  });

  test("reports a reply without a result as an undefined value", async () => {
    const caller = cdp();
    caller.replyRead({}, value(null));
    const client = create(caller, "session-1");
    expect(await client.read("a")).toEqual({ ok: true, value: undefined });
    expect(await client.read("b")).toEqual({ ok: true, value: null });
  });
});

describe("observe", () => {
  test("returns the page with its fingerprint", async () => {
    const caller = cdp();
    const state = page();
    caller.replyRead(value(state));
    const observed = await observe(create(caller, "s"), { screenshot: false, afterInput: null });
    expect(observed.fingerprint).toBe(fingerprint(state));
    expect(observed.url).toBe("https://example.test/");
    expect(observed.screenshot).toBeUndefined();
    expect(caller.methods()).toEqual(["Runtime.evaluate"]);
  });

  test("captures a screenshot when asked", async () => {
    const caller = cdp();
    caller.replyRead(value(page()));
    caller.reply("Page.captureScreenshot", { data: "jpeg-bytes" });
    const observed = await observe(create(caller, "s"), { screenshot: true, afterInput: null });
    expect(observed.screenshot).toBe("jpeg-bytes");
    expect(caller.methods()).toEqual(["Runtime.evaluate", "Page.captureScreenshot"]);
    expect(caller.calls[1]).toEqual({
      method: "Page.captureScreenshot",
      params: { format: "jpeg", quality: 72 },
      sessionId: "s",
    });
  });

  test("reports a screenshot the browser did not return", async () => {
    const caller = cdp();
    caller.replyRead(value(page()));
    caller.reply("Page.captureScreenshot", {});
    const attempt = observe(create(caller, "s"), { screenshot: true, afterInput: null });
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/did not return a screenshot/);
  });

  test("waits for the page to settle after an input", async () => {
    const caller = cdp();
    caller.replyRead(value("settled"), value(page()));
    await observe(create(caller, "s"), { screenshot: false, afterInput: FILL });
    expect(caller.calls[0].params).toEqual({
      expression: settle(FILL),
      returnByValue: true,
      awaitPromise: true,
    });
    expect(caller.calls[1].params.expression).toBe(READ_STATE);
  });

  test("retries a navigation that settles", async () => {
    const caller = cdp();
    caller.replyRead(CHANGED, value(page()));
    const observed = await observe(create(caller, "s"), { screenshot: false, afterInput: null });
    expect(observed.title).toBe("Search");
    expect(caller.methods()).toHaveLength(2);
  });

  test("waits out a document that is still navigating", async () => {
    const caller = cdp();
    caller.replyRead(value(null), value(page({ title: "Booking" })));
    const observed = await observe(create(caller, "s"), {
      screenshot: false,
      afterInput: null,
      navigationMs: 200,
    });
    expect(observed.title).toBe("Booking");
    expect(caller.methods()).toHaveLength(2);
  });

  test("reports a navigation that never settles", async () => {
    const caller = cdp();
    caller.replyRead(...Array.from({ length: 40 }, () => CHANGED));
    const attempt = observe(create(caller, "s"), { screenshot: false, afterInput: null, navigationMs: 60 });
    await expect(attempt).rejects.toThrow(StalePage);
    await expect(attempt).rejects.toThrow(/document changed/);
    expect(caller.methods().length).toBeGreaterThan(1);
    expect(caller.methods().length).toBeLessThan(40);
  });

  test("reports a document that never becomes readable", async () => {
    const caller = cdp();
    caller.replyRead(...Array.from({ length: 40 }, () => value(null)));
    const attempt = observe(create(caller, "s"), { screenshot: false, afterInput: null, navigationMs: 60 });
    await expect(attempt).rejects.toThrow(StalePage);
    await expect(attempt).rejects.toThrow(/navigating/);
  });

  test("retries a screenshot a navigation interrupted", async () => {
    const caller = cdp();
    caller.replyRead(value(page()), value(page()));
    caller.reply(
      "Page.captureScreenshot",
      new RuntimeFailure("Page.captureScreenshot: Unable to capture screenshot"),
      { data: "jpeg-bytes" },
    );
    const observed = await observe(create(caller, "s"), {
      screenshot: true,
      afterInput: null,
      navigationMs: 200,
    });
    expect(observed.screenshot).toBe("jpeg-bytes");
    expect(caller.methods()).toEqual([
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Runtime.evaluate",
      "Page.captureScreenshot",
    ]);
  });

  test("propagates a transport failure", async () => {
    const caller = cdp();
    caller.breakRead(new RuntimeFailure("The socket closed."));
    const attempt = observe(create(caller, "s"), { screenshot: false, afterInput: null });
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/socket closed/);
    expect(caller.methods()).toHaveLength(1);
  });
});

describe("observe with numbered elements", () => {
  test("numbers the observed elements before the frame and clears them after", async () => {
    const caller = cdp();
    caller.replyRead(value(page()), value(2), value(undefined));
    caller.reply("Page.captureScreenshot", { data: "marked-frame" });
    const observed = await observe(create(caller, "s"), { screenshot: true, vision: true, afterInput: null });
    expect(observed.screenshot).toBe("marked-frame");
    expect(caller.methods()).toEqual([
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Runtime.evaluate",
    ]);
    // Node 10 is drawn once, node 20 second, and the control without an operation is left out.
    expect(caller.expressions[1]).toContain('[{"index":"1","node":10},{"index":"2","node":20}]');
    expect(caller.expressions.at(-1)).toBe(CLEAR);
  });

  test("clears the numbers even when the frame fails", async () => {
    const caller = cdp();
    caller.replyRead(value(page()), value(2), value(undefined));
    caller.reply("Page.captureScreenshot", new RuntimeFailure("The socket closed."));
    const attempt = observe(create(caller, "s"), { screenshot: true, vision: true, afterInput: null });
    await expect(attempt).rejects.toThrow(/socket closed/);
    expect(caller.expressions.at(-1)).toBe(CLEAR);
  });

  test("retries a navigation that interrupted the drawing", async () => {
    const caller = cdp();
    caller.replyRead(value(page()), CHANGED, value(page()), value(2), value(undefined));
    caller.reply("Page.captureScreenshot", { data: "marked-frame" });
    const observed = await observe(create(caller, "s"), {
      screenshot: true,
      vision: true,
      afterInput: null,
      navigationMs: 200,
    });
    expect(observed.screenshot).toBe("marked-frame");
    expect(caller.methods()).toEqual([
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Runtime.evaluate",
    ]);
  });

  test("draws the numbers in the top layer, above a modal", () => {
    // A dialog opened with showModal() paints over a fixed overlay, so the numbers of the
    // elements inside it would be invisible: the host joins the top layer as a popover.
    const marks = draw([]);
    expect(marks).toContain("setAttribute('popover', 'manual')");
    expect(marks).toContain("host.showPopover()");
    expect(marks).toContain("removeAttribute('popover')");
  });

  test("stops the numbers at the scrollport, not at the border box", () => {
    // A scroll container clips its content to its padding box: a number that reached over a
    // border or a scrollbar would outline pixels no click can land on.
    const marks = draw([]);
    expect(marks).toContain("clientWidth");
    expect(marks).toContain("clientHeight");
    expect(marks).toContain("borderRightWidth");
    expect(marks).toContain("'rtl'");
  });

  test("draws nothing when the mode is off", async () => {
    const caller = cdp();
    caller.replyRead(value(page()));
    caller.reply("Page.captureScreenshot", { data: "jpeg-bytes" });
    const observed = await observe(create(caller, "s"), { screenshot: true, vision: false, afterInput: null });
    expect(observed.screenshot).toBe("jpeg-bytes");
    expect(caller.expressions).toEqual([READ_STATE]);
  });
});

describe("fingerprint", () => {
  test("ignores the screenshot and the marker", () => {
    const state = page();
    const digest = fingerprint(state);
    expect(digest).toBe(fingerprint({ ...state, screenshot: "jpeg-bytes", marker: "other" }));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("tracks the visible page state", () => {
    const state = page();
    const digest = fingerprint(state);
    expect(fingerprint({ ...state, url: "https://example.test/other" })).not.toBe(digest);
    expect(fingerprint({ ...state, text: "Other" })).not.toBe(digest);
    expect(fingerprint({ ...state, scroll: { y: 100, height: 780 } })).not.toBe(digest);
    expect(fingerprint({ ...state, actions: [{ ...FILL, node: 11 }] })).not.toBe(digest);
  });
});

describe("fresh", () => {
  test("compares the page marker", async () => {
    const caller = cdp();
    const observed = page({ marker: "m1" });
    caller.replyRead(value("m1"), value("m2"));
    const client = create(caller, "s");
    expect(await check(client, observed)).toEqual({ kind: "fresh" });
    expect(await check(client, observed)).toEqual({ kind: "changed" });
    expect(caller.calls[0].params.expression).toBe(MARKER);
  });

  test("compares the node guard before a click", async () => {
    const caller = cdp();
    const observed = guarded();
    caller.replyRead(value([["k"], "g10"]), value([["k"], "g11"]), value(null));
    const client = create(caller, "s");
    expect(await check(client, observed, CLICK)).toEqual({ kind: "fresh" });
    expect(await check(client, observed, CLICK)).toEqual({ kind: "changed" });
    expect(await check(client, observed, CLICK)).toEqual({ kind: "changed" });
    expect(caller.calls[0].params.expression).toBe(guard(10));
  });

  test("does not guard a field that receives text", async () => {
    const caller = cdp();
    caller.replyRead(value("m1"));
    await check(create(caller, "s"), page({ marker: "m1" }), FILL);
    expect(caller.calls[0].params.expression).toBe(MARKER);
  });

  test("reports an unreadable page instead of throwing", async () => {
    const caller = cdp();
    caller.replyRead(CHANGED);
    const state = await check(create(caller, "s"), guarded(), CLICK);
    expect(state.kind).toBe("unreadable");
    if (state.kind !== "unreadable") return;
    expect(state.failure).toBeInstanceOf(StalePage);
  });

  test("reports a click without a node as a changed page", async () => {
    const caller = cdp();
    expect(await check(create(caller, "s"), page(), { id: "e9", kind: "click" })).toEqual({ kind: "changed" });
    expect(caller.calls).toHaveLength(0);
  });
});

describe("execute", () => {
  test("clicks the observed node", async () => {
    const caller = cdp();
    const observed = guarded();
    caller.replyRead(guardRead(10), value({ x: 12, y: 34 }));
    const current = session(caller);
    expect(await act(current, CLICK, observed, null)).toEqual({ executed: "e2" });
    expect(caller.methods()).toEqual([
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
    ]);
    expect(caller.calls[2].params).toEqual({ type: "mousePressed", x: 12, y: 34, button: "left", clickCount: 1 });
    expect(caller.calls[3].params.type).toBe("mouseReleased");
    expect(current.afterInput).toBe(CLICK);
  });

  test("replaces the text of a field", async () => {
    const caller = cdp();
    caller.replyRead(value("m1"), value({ x: 5, y: 6 }));
    await act(session(caller), FILL, page({ marker: "m1" }), "Zurich");
    expect(caller.methods().slice(2)).toEqual([
      "Input.dispatchMouseEvent",
      "Input.dispatchMouseEvent",
      "Input.dispatchKeyEvent",
      "Input.dispatchKeyEvent",
      "Input.insertText",
    ]);
    expect(caller.calls.at(-1)?.params).toEqual({ text: "Zurich" });
  });

  test("refuses to act on a page that changed", async () => {
    const caller = cdp();
    caller.replyRead(value([["k"], "other"]));
    const attempt = act(session(caller), CLICK, guarded(), null);
    await expect(attempt).rejects.toThrow(StalePage);
    await expect(attempt).rejects.toThrow(/Observe again/);
    expect(caller.methods()).toEqual(["Runtime.evaluate"]);
  });

  test("reports an unreadable page when the guard cannot be read", async () => {
    const caller = cdp();
    caller.replyRead(CHANGED);
    const attempt = act(session(caller), CLICK, guarded(), null);
    await expect(attempt).rejects.toThrow(/document changed/);
  });

  test("waits without touching the page", async () => {
    const caller = cdp();
    caller.replyRead(value("m1"));
    const current = session(caller);
    const started = Date.now();
    expect(await act(current, WAIT, page({ marker: "m1" }), null)).toEqual({ executed: "wait" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(caller.methods()).toEqual(["Runtime.evaluate"]);
    expect(current.afterInput).toBeNull();
  });

  test("scrolls the window", async () => {
    const caller = cdp();
    caller.replyRead(value("m1"));
    await act(session(caller), SCROLL, page({ marker: "m1" }), null);
    expect(caller.calls.at(-1)?.params).toEqual({
      type: "mouseWheel",
      x: 550,
      y: 650,
      deltaX: 0,
      deltaY: 400,
    });
  });

  test("refuses a target that disappeared", async () => {
    const caller = cdp();
    caller.replyRead(guardRead(10), value(null));
    const attempt = act(session(caller), CLICK, guarded(), null);
    await expect(attempt).rejects.toThrow(StalePage);
    await expect(attempt).rejects.toThrow(/target changed or is covered/);
    expect(caller.methods()).toEqual(["Runtime.evaluate", "Runtime.evaluate"]);
  });

  test("refuses an action without a node", async () => {
    const caller = cdp();
    const attempt = perform(create(caller, "s"), { id: "e9", kind: "click" }, null);
    await expect(attempt).rejects.toThrow(InputError);
    await expect(attempt).rejects.toThrow(/node is not valid/);
    expect(caller.methods()).toEqual([]);
  });

  test("reports an interrupted click as a changed page", async () => {
    const caller = cdp();
    caller.replyRead(guardRead(10), CHANGED);
    const attempt = act(session(caller), CLICK, guarded(), null);
    await expect(attempt).rejects.toThrow(StalePage);
    await expect(attempt).rejects.toThrow(/document changed/);
  });

  test("reports an interrupted dropdown as an unconfirmed run", async () => {
    const caller = cdp();
    caller.replyRead(guardRead(12), CHANGED);
    const attempt = act(session(caller), SELECT, guarded(), null);
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/dropdown menu was interrupted/);
  });

  test("reports a dropdown that could not be chosen as uncertain", async () => {
    const caller = cdp();
    caller.replyRead(guardRead(12), value(null));
    const attempt = act(session(caller), SELECT, guarded(), null);
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/dropdown menu was not confirmed/);
  });

  test("selects a dropdown value through the page", async () => {
    const caller = cdp();
    caller.replyRead(guardRead(12), value({ x: 8, y: 9 }));
    const current = session(caller);
    expect(await act(current, SELECT, guarded(), null)).toEqual({ executed: "s1" });
    expect(caller.calls[1].params.expression).toBe(target(SELECT));
    expect(caller.methods()).toEqual(["Runtime.evaluate", "Runtime.evaluate"]);
    expect(current.afterInput).toBe(SELECT);
  });
});

describe("session", () => {
  test("opens a background tab and waits for it", async () => {
    const caller = cdp();
    caller.reply("Target.createTarget", { targetId: "t7" });
    caller.reply("Target.attachToTarget", { sessionId: "s7" });
    caller.replyRead(value("complete"));
    const opened = await open(caller, "https://example.test/");
    expect(opened.targetId).toBe("t7");
    expect(opened.client.sessionId).toBe("s7");
    expect(caller.calls[0].params).toEqual({ url: "about:blank", background: true });
    expect(caller.methods()).toEqual([
      "Target.createTarget",
      "Target.attachToTarget",
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setFocusEmulationEnabled",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.navigate",
      "Runtime.evaluate",
    ]);
    expect(caller.calls[2].params).toEqual({ width: 1120, height: 780, deviceScaleFactor: 1, mobile: false });
    expect(caller.calls[4].params).toEqual({ source: LINKS });
    expect(caller.calls[5].params).toEqual({ url: "https://example.test/" });
  });

  test("retries a tab that is still loading and honours the viewport", async () => {
    const caller = cdp();
    caller.reply("Target.createTarget", { targetId: "t7" });
    caller.reply("Target.attachToTarget", { sessionId: "s7" });
    caller.replyRead(value("loading"), CHANGED, value("complete"));
    const opened = await open(caller, "https://example.test/", { width: 800, height: 600 });
    expect(opened.targetId).toBe("t7");
    expect(caller.calls[2].params.width).toBe(800);
    expect(caller.calls[2].params.height).toBe(600);
    expect(caller.calls.at(-1)?.params.expression).toBe(READY_STATE);
  });

  test("installs the recorder binding and bootstrap before navigating", async () => {
    const caller = cdp();
    caller.reply("Target.createTarget", { targetId: "t8" });
    caller.reply("Target.attachToTarget", { sessionId: "s8" });
    caller.replyRead(value("complete"));
    await open(caller, "https://example.test/", { recordingScript: "window.__probatorRecorder = true;" });
    expect(caller.methods()).toEqual([
      "Target.createTarget",
      "Target.attachToTarget",
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setFocusEmulationEnabled",
      "Runtime.enable",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.navigate",
      "Runtime.evaluate",
    ]);
    expect(caller.calls[5].params).toEqual({ name: "__probatorRecordEvent" });
    expect(caller.calls[7].params).toEqual({ source: "window.__probatorRecorder = true;" });
  });

  test("reports a tab the browser did not create", async () => {
    const caller = cdp();
    caller.reply("Target.createTarget", {});
    const attempt = open(caller, "https://example.test/");
    await expect(attempt).rejects.toThrow(RuntimeFailure);
    await expect(attempt).rejects.toThrow(/did not provide targetId/);
  });

  test("closes the tab exactly once", async () => {
    const caller = cdp();
    const current = session(caller);
    await close(current);
    await close(current);
    expect(caller.calls).toEqual([
      { method: "Target.closeTarget", params: { targetId: "target-1" }, sessionId: undefined },
    ]);
    expect(current.targetId).toBeNull();
  });
});

describe("port", () => {
  test("consumes the pending input once", async () => {
    const caller = cdp();
    const current = session(caller, FILL);
    caller.replyRead(value("settled"), value(page()), value(page()));
    const port = bind(current);
    expect((await port.observe(false)).title).toBe("Search");
    expect(caller.calls[0].params).toEqual({
      expression: settle(FILL),
      returnByValue: true,
      awaitPromise: true,
    });
    expect(current.afterInput).toBeNull();
    await port.observe(false);
    expect(caller.expressions.filter((expression) => expression === settle(FILL))).toHaveLength(1);
  });

  test("numbers the frame when the connection was opened in image mode", async () => {
    const caller = cdp();
    caller.replyRead(value(page()), value(2), value(undefined));
    caller.reply("Page.captureScreenshot", { data: "marked-frame" });
    const port = bind(session(caller), undefined, true);
    const observed = await port.observe(true);
    expect(observed.screenshot).toBe("marked-frame");
    expect(caller.expressions[1]).toContain('[{"index":"1","node":10},{"index":"2","node":20}]');
    expect(caller.expressions.at(-1)).toBe(CLEAR);
  });

  test("closes the tab and the transport", async () => {
    const caller = cdp();
    const closed: string[] = [];
    const transport: Transport = {
      endpoint: "ws://127.0.0.1:9222/devtools/browser/x",
      call: async () => undefined,
      drain: () => [],
      subscribe: () => () => undefined,
      close: () => void closed.push("transport"),
    };
    const port = bind(session(caller), transport);
    await port.close();
    expect(closed).toEqual(["transport"]);
    expect(caller.methods()).toEqual(["Target.closeTarget"]);
  });

  test("drains rrweb events from CDP independently of page navigations", async () => {
    const caller = cdp();
    let listener: ((event: unknown) => void) | undefined;
    const transport: Transport = {
      endpoint: "ws://127.0.0.1:9222/devtools/browser/x",
      call: async () => undefined,
      drain: () => [],
      subscribe: (receive) => { listener = receive; return () => { listener = undefined; }; },
      close: () => undefined,
    };
    const port = bind(session(caller), transport);
    listener?.({ sessionId: "session-1", method: "Runtime.bindingCalled", params: { name: "__probatorRecordEvent", payload: JSON.stringify({ type: 2 }) } });
    listener?.({ sessionId: "another-tab", method: "Runtime.bindingCalled", params: { name: "__probatorRecordEvent", payload: JSON.stringify({ type: 2 }) } });
    expect(await port.drainRecordingEvents?.()).toEqual([{ type: 2 }]);
    expect(await port.drainRecordingEvents?.()).toEqual([]);
    await port.close();
    expect(listener).toBeUndefined();
  });

  test("captures the current page viewport without modifying its content", async () => {
    const caller = cdp();
    caller.reply("Page.captureScreenshot", { data: "page-frame" });
    const port = bind(session(caller));
    expect(await port.captureScreenshot?.()).toBe("page-frame");
    expect(caller.methods()).toEqual(["Page.captureScreenshot"]);
  });
});

describe("scripts", () => {
  test("reads the snapshot script and the ready state", () => {
    expect(READ_STATE).toContain("__jevFast");
    expect(READY_STATE).toBe("document.readyState");
    expect(MARKER).toContain("marker");
  });

  test("embeds the action in the target script", () => {
    expect(target(CLICK)).toContain('"id":"e2"');
    expect(target(CLICK)).toContain("action.kind!=='select'");
    expect(settle(FILL)).toContain('"node":10');
  });

  test("offers the reader only what the executor could click", () => {
    // The hit test of the reader mirrors the one of the target script, and a takeover
    // overlay scopes the candidates to its own elements: numbers and options are one set.
    expect(target(CLICK)).toContain("document.elementFromPoint");
    expect(READ_STATE).toContain("document.elementFromPoint");
    expect(READ_STATE).toContain('[aria-modal="true"]');
    expect(READ_STATE).toContain(":modal");
  });

  test("stands a label in for the toggle it hides", () => {
    // A styled checkbox is a 0×0 input under a label that paints it: the label is offered as the
    // control it names — role and checked state included — unless the input is what a click
    // reaches on its own, in which case offering the label too would be the same click twice.
    expect(READ_STATE).toContain("+ ',label'");
    expect(READ_STATE).toContain("e.control || null");
    expect(READ_STATE).toContain("['checkbox','radio'].includes(c.type)");
    expect(READ_STATE).toContain("!usable(c)");
    expect(READ_STATE).toContain("['checkbox','radio'].includes(c?.type)");
    expect(target(CLICK)).toContain("e.tagName==='LABEL' ? e.control");
  });

  test("keeps a click in the tab the harness watches", () => {
    // A link, a form or a base that would open a second tab is pointed back at this one, and
    // so is `window.open`. A target that names a frame of this page is left alone.
    expect(LINKS).toContain("'[target],[formtarget]'");
    expect(LINKS).toContain("attributeFilter: ['target', 'formtarget']");
    expect(LINKS).toContain("e.target = SELF");
    expect(LINKS).toContain("e.formTarget = SELF");
    expect(LINKS).toContain("if (name && framed(name)) return open.call(window, url, name, features);");
    expect(LINKS).toContain("location.assign(target)");
    expect(LINKS).toContain("return null");
  });

  test("reads a control a page paints inside an open shadow root", () => {
    // A banner or a custom control can live in an open shadow root: a document query never
    // reaches it and elementFromPoint answers with the host, so the reader walks the roots
    // and takes the deepest element as the one that answers for the point, and the executor
    // runs the same test before it clicks. A closed root stays out of reach.
    expect(READ_STATE).toContain("e.shadowRoot ? roots(e.shadowRoot) : []");
    expect(READ_STATE).toContain("top.shadowRoot.elementFromPoint(x, y)");
    expect(READ_STATE).toContain("node.parentElement ?? node.getRootNode()?.host ?? null");
    expect(READ_STATE).toContain("const owns = (e, top) => up(top, node => node === e) === e;");
    expect(READ_STATE).toContain("owns(e, deepest(x, y))");
    expect(target(CLICK)).toContain("top.shadowRoot.elementFromPoint(x,y)");
    expect(target(CLICK)).toContain("node.parentElement??node.getRootNode()?.host??null");
    expect(target(CLICK)).toContain("owns=(e,top)=>up(top,node=>node===e)===e");
    expect(target(CLICK)).toContain("!owns(e,deepest(x,y))");
    expect(READ_STATE).toContain("roots(scope || document)");
    // A banner can hang on the document element itself, outside the body, so the text of the
    // page is read from that element, and the head is skipped instead.
    expect(READ_STATE).toContain("read(document.documentElement)");
    expect(READ_STATE).toContain("'head,script,style,noscript,template'");
    expect(draw(plan(page().actions))).toContain("root instanceof ShadowRoot");
  });

  test("builds expressions the browser can actually run", () => {
    const scripts = [
      READ_STATE,
      LINKS,
      MARKER,
      CLEAR,
      guard(10),
      settle(FILL),
      target(CLICK),
      draw(plan(page().actions)),
    ];
    for (const script of scripts) expect(() => compile(script)).not.toThrow();
  });

  test("hands the drawer the numbers of the snapshot it was read with", () => {
    expect(draw(plan(page().actions))).toContain('[{"index":"1","node":10},{"index":"2","node":20}]');
  });
});
