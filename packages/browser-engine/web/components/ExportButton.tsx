import { traceIt } from "./handlers.ts";

/** Saves the trace of the run, once it has something to save. */
export function ExportButton({
  state,
  ready,
}: {
  readonly state: unknown;
  readonly ready: boolean;
}) {
  return (
    <button type="button" disabled={!ready} onClick={() => traceIt(state)}>
      EXPORT JSON ↓
    </button>
  );
}
