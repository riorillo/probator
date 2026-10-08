import * as labels from "../model/labels.ts";
import { TraceRow } from "./TraceRow.tsx";

/** Every executed action, or the word that says there is none yet. */
export function TraceRows({ history }: { readonly history: readonly unknown[] }) {
  if (history.length === 0) return <p className="muted">{labels.NO_ACTIONS}</p>;
  return (
    <>
      {history.map((entry, index) => (
        <TraceRow key={index} entry={entry} />
      ))}
    </>
  );
}
