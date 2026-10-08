import { describe, expect, test } from "bun:test";
import { recorderBootstrap, recordingEventOrNull } from "../src/domain/recording";

describe("full-fidelity rrweb recording", () => {
  test("records page content, fields, canvas, fonts, and iframe snapshots without masks", () => {
    const source = recorderBootstrap("window.rrweb = { record() {} };" );
    expect(source).toContain("maskTextSelector: \"\"");
    expect(source).toContain("maskAllInputs: false");
    expect(source).toContain("recordCrossOriginIframes: true");
    expect(source).toContain("recordCanvas: true");
    expect(source).toContain("collectFonts: true");
    expect(source).toContain("inlineStylesheet: true");
    expect(source).not.toContain("blockSelector");
    expect(source).toContain("rrweb event transport is unavailable");
  });

  test("keeps page text, input values, identifying attributes, and full URL paths", () => {
    const event = { type: 2, data: { node: { textContent: "Visible name", attributes: { value: "typed value", placeholder: "email", href: "https://example.test/account?token=abc", class: "card", title: "account" } } } };
    expect(recordingEventOrNull(event)).toEqual(event);
  });

  test("rejects malformed and oversized events without changing valid payloads", () => {
    expect(recordingEventOrNull(null)).toBeNull();
    expect(recordingEventOrNull([1, 2])).toBeNull();
    expect(recordingEventOrNull({ text: "x".repeat(1_000_001) })).toBeNull();
  });
});
