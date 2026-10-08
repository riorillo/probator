/** Order-independent JSON text, so structural equality survives key order. */
export function canonical(value: unknown): string {
  return JSON.stringify(order(value));
}

function order(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(order);
  if (typeof value !== "object" || value === null) return value ?? null;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, entry]) => [key, order(entry)] as const);
  return Object.fromEntries(entries);
}
