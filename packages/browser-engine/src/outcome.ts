/**
 * Values instead of exceptions: expected failures travel as data so control flow
 * stays flat and explicit. `settle` defers the work into the promise chain, which
 * turns a synchronous throw into a rejection without try/catch.
 */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

export function ok<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function failed(error: unknown): Outcome<never> {
  return { ok: false, error };
}

export async function settle<T>(work: () => T | Promise<T>): Promise<Outcome<T>> {
  const [outcome] = await Promise.allSettled([Promise.resolve().then(work)]);
  if (outcome.status === "fulfilled") return ok(outcome.value);
  return failed(outcome.reason);
}
