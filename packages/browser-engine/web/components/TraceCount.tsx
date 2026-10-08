import * as labels from "../model/labels.ts";

/** How many actions the run executed, and how long it has been going. */
export function TraceCount({
  steps,
  elapsedMs,
}: {
  readonly steps: number;
  readonly elapsedMs: number;
}) {
  return <b className="count">{labels.counted(steps, elapsedMs)}</b>;
}
