import * as labels from "../model/labels.ts";
import type { Verdict } from "../model/report.ts";

/** The last word of the heal model on a run that stopped by giving up, or nothing when it never had one. */
export function HealNote({ verdict }: { readonly verdict: Verdict | null }) {
  if (verdict === null) return null;
  return (
    <p className="note">
      <b className="heal">{labels.HEAL}</b>
      {labels.healNote(verdict.said, verdict.answered)}
    </p>
  );
}
