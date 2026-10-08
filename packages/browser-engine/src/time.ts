import { RuntimeFailure } from "./errors.ts";

/** Monotonic time helpers: one clock for elapsed measurements and deadlines. */
export function now(): number {
  return performance.now();
}

export function elapsed(started: number): number {
  return Math.round(now() - started);
}

/** A promise that never settles with a value, used to bound work that may hang. */
export function expired(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new RuntimeFailure(`The browser did not answer within ${ms}ms.`)), ms);
  });
}

export function reach(ms: number): number {
  return now() + ms;
}
