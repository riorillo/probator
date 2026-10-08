import { connect } from "./browser/port.ts";
import type { Page } from "./browser/types.ts";

export type RecorderEvent = Record<string, unknown>;
export type Recorder = {
  observe(): Promise<Page>;
  drainEvents(): Promise<unknown[]>;
  startFrameStream(onFrame: (frame: Uint8Array) => void): Promise<() => Promise<void>>;
  click(x: number, y: number): Promise<RecorderEvent>;
  type(text: string): Promise<RecorderEvent | null>;
  key(key: string): Promise<RecorderEvent | null>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<RecorderEvent>;
  close(): Promise<void>;
};

const KEYS: Record<string, { code: string; windowsVirtualKeyCode: number }> = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { code: "Home", windowsVirtualKeyCode: 36 },
  End: { code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { code: "PageDown", windowsVirtualKeyCode: 34 },
  " ": { code: "Space", windowsVirtualKeyCode: 32 },
};

/** Opens a user-controlled browser session and records semantic interaction events. */
export async function openRecorder(url: string): Promise<Recorder> {
  const connection = await connect(url, { recordingScript: script() });
  const { session, port, transport } = connection;
  return {
    observe: () => port.observe(true),
    drainEvents: () => port.drainRecordingEvents?.() ?? Promise.resolve([]),
    startFrameStream: async (onFrame) => {
      const unsubscribe = transport.subscribe((value) => {
        if (!value || typeof value !== "object") return;
        const event = value as { method?: string; sessionId?: string; params?: { data?: string; sessionId?: number } };
        if (event.method !== "Page.screencastFrame" || event.sessionId !== session.client.sessionId || typeof event.params?.data !== "string") return;
        onFrame(Uint8Array.from(atob(event.params.data), (character) => character.charCodeAt(0)));
        if (typeof event.params.sessionId === "number") void session.client.call("Page.screencastFrameAck", { sessionId: event.params.sessionId }).catch(() => undefined);
      });
      await session.client.call("Page.startScreencast", { format: "jpeg", quality: 78, maxWidth: 1120, maxHeight: 780, everyNthFrame: 1 });
      return async () => {
        unsubscribe();
        await session.client.call("Page.stopScreencast").catch(() => undefined);
      };
    },
    click: async (x, y) => {
      const element = await describe(session.client, `document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})`);
      await session.client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await session.client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await session.client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return { action: "click", element };
    },
    type: async (text) => {
      await session.client.call("Input.insertText", { text });
      const field = await session.client.evaluate(`(() => {
        const target = document.activeElement;
        if (!(target instanceof Element)) return null;
        const element = target.closest("button,a,input,textarea,select,[role],[tabindex],[contenteditable='true']") || target;
        const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(" ") : "";
        const name = labels || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || (element.innerText || "").trim().slice(0, 100);
        const secret = element instanceof HTMLInputElement && element.type === "password";
        const value = "value" in element ? String(element.value ?? "") : String(element.innerText ?? "");
        return { element: { role: element.getAttribute("role") || (element instanceof HTMLTextAreaElement ? "textbox" : element instanceof HTMLInputElement ? (element.type === "password" ? "password" : "textbox") : element.tagName.toLowerCase()), name, tag: element.tagName.toLowerCase(), inputType: element.getAttribute("type"), placeholder: element.getAttribute("placeholder"), nameAttribute: element.getAttribute("name"), id: element.id || null }, value: secret ? "" : value.slice(0, 1000), secret };
      })()`);
      if (!field || typeof field !== "object") return null;
      return { action: "fill", ...(field as Record<string, unknown>) };
    },
    key: async (key) => {
      const definition = KEYS[key];
      if (!definition) return null;
      const params = { key: key === " " ? " " : key, code: definition.code, windowsVirtualKeyCode: definition.windowsVirtualKeyCode };
      await session.client.call("Input.dispatchKeyEvent", { type: "keyDown", ...params });
      await session.client.call("Input.dispatchKeyEvent", { type: "keyUp", ...params });
      return { action: "key", key };
    },
    scroll: async (x, y, deltaX, deltaY) => {
      await session.client.call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY });
      return { action: "scroll", x, y, deltaX, deltaY };
    },
    close: () => port.close(),
  };
}

function script(): string {
  return `(() => {
    if (window.__probatorInteractionRecorder) return;
    window.__probatorInteractionRecorder = true;
    const emit = (entry) => { try { window.__probatorRecordEvent(JSON.stringify({ ...entry, at: new Date().toISOString(), url: location.href, page: { title: document.title, text: (document.body?.innerText || "").slice(0, 1200) } })); } catch {} };
    const labelFor = (element) => {
      if (element.labels?.length) return Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(" ");
      const labelled = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder");
      if (labelled) return labelled.trim();
      return (element.innerText || element.value || "").trim().slice(0, 100);
    };
    const describe = (target) => {
      const element = target instanceof Element ? target.closest("button,a,input,textarea,select,[role], [tabindex]") || target : null;
      if (!element) return null;
      const role = element.getAttribute("role") || ({ BUTTON: "button", A: "link", INPUT: element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox", TEXTAREA: "textbox", SELECT: "combobox" }[element.tagName] || element.tagName.toLowerCase());
      return { role, name: labelFor(element), tag: element.tagName.toLowerCase(), inputType: element.type || null, placeholder: element.getAttribute("placeholder"), accessibleLabel: element.getAttribute("aria-label"), testId: element.getAttribute("data-testid"), nameAttribute: element.getAttribute("name"), id: element.id || null };
    };
    let inputTimer;
    document.addEventListener("change", (event) => { const target = event.target; const element = describe(target); if (element && target.tagName === "SELECT") emit({ action: "select", element, value: String(target.value ?? "").slice(0, 300) }); }, true);
    document.addEventListener("submit", (event) => { const element = describe(event.submitter || event.target); emit({ action: "submit", element }); }, true);
    const pageLoaded = () => emit({ action: "page_loaded", element: { role: "page", name: document.title }, url: location.href });
    if (document.readyState === "complete") pageLoaded(); else addEventListener("load", pageLoaded, { once: true });
    addEventListener("popstate", () => pageLoaded());
    for (const method of ["pushState", "replaceState"]) { const original = history[method]; history[method] = function(...args) { const result = original.apply(this, args); setTimeout(pageLoaded, 0); return result; }; }
  })();`;
}

async function describe(client: { evaluate(expression: string): Promise<unknown> }, target: string) {
  const value = await client.evaluate(`(() => {
    const raw = ${target};
    if (!(raw instanceof Element)) return null;
    const element = raw.closest("button,a,input,textarea,select,[role],[tabindex],[contenteditable='true']") || raw;
    const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(" ") : "";
    const name = labels || element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || (element.innerText || element.value || "").trim().slice(0, 100);
    return { role: element.getAttribute("role") || (element instanceof HTMLInputElement ? (element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox") : element instanceof HTMLTextAreaElement ? "textbox" : element instanceof HTMLSelectElement ? "combobox" : element.tagName.toLowerCase()), name, tag: element.tagName.toLowerCase(), inputType: element.getAttribute("type"), placeholder: element.getAttribute("placeholder"), accessibleLabel: element.getAttribute("aria-label"), testId: element.getAttribute("data-testid"), nameAttribute: element.getAttribute("name"), id: element.id || null };
  })()`);
  return value && typeof value === "object" ? value as Record<string, unknown> : { role: "page", name: "Elemento non identificato" };
}
