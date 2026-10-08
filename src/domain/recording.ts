/** Start rrweb without masking or blocking page content. */
export function recorderBootstrap(bundle: string): string {
  return `${bundle}\n;(() => {
    if (!globalThis.rrweb || typeof globalThis.rrweb.record !== "function") throw new Error("rrweb recorder failed to load");
    if (typeof globalThis.__probatorRecordEvent !== "function") throw new Error("rrweb event transport is unavailable");
    globalThis.__probatorRecording = globalThis.rrweb.record({
      emit: (event) => globalThis.__probatorRecordEvent(JSON.stringify(event)),
      maskAllInputs: false,
      maskTextSelector: "",
      recordCrossOriginIframes: true,
      recordCanvas: true,
      collectFonts: true,
      inlineStylesheet: true,
      sampling: { input: "last" }
    });
  })();`;
}

/** Keep valid rrweb events intact so replay matches the page as it appeared. */
export function recordingEventOrNull(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= 1_000_000 ? value : null;
  } catch {
    return null;
  }
}
