import { describe, expect, test } from "bun:test";
import { matchesVisibleText, overall } from "../src/domain/evaluation.ts";

describe("visible text evidence", () => {
  test("matches exact configured text without case sensitivity", () => {
    expect(matchesVisibleText("Order confirmed", "Your order is ORDER CONFIRMED and ready.")).toBe(true);
  });

  test("does not infer evidence from an empty or absent expectation", () => {
    expect(matchesVisibleText("", "Anything is visible")).toBe(false);
    expect(matchesVisibleText("Order confirmed", "Payment failed")).toBe(false);
  });
});

describe("overall outcome", () => {
  test("passes only when every required step and check passes", () => {
    expect(overall([{ required: true, status: "passed" }], [{ required: true, status: "passed" }])).toBe("passed");
  });

  test("fails when a required violation is demonstrated", () => {
    expect(overall([{ required: true, status: "failed" }], [{ required: true, status: "blocked" }])).toBe("failed");
  });

  test("blocks when a required result cannot be verified or was not run", () => {
    expect(overall([{ required: true, status: "blocked" }, { required: true, status: undefined }], [])).toBe("blocked");
  });

  test("ignores a failed optional result", () => {
    expect(overall([{ required: true, status: "passed" }, { required: false, status: "failed" }], [])).toBe("passed");
  });
});
