export type ResultStatus = "passed" | "failed" | "blocked";
export type RequiredResult = { required: boolean; status: ResultStatus | undefined };

export function matchesVisibleText(expected: string, observed: string): boolean {
  const normalized = expected.trim().toLocaleLowerCase();
  return normalized.length > 0 && observed.toLocaleLowerCase().includes(normalized);
}

export function overall(steps: readonly RequiredResult[], checks: readonly RequiredResult[]): ResultStatus {
  const results = [...steps, ...checks];
  if (results.some((result) => result.required && result.status === "failed")) return "failed";
  if (results.some((result) => result.required && result.status !== "passed")) return "blocked";
  return "passed";
}
