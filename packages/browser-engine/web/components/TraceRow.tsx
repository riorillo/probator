import * as labels from "../model/labels.ts";
import * as step from "../model/step.ts";

/** One executed action as a row of the trace. */
export function TraceRow({ entry }: { readonly entry: unknown }) {
  const typed = step.typed(entry);
  const changed = step.changed(entry);
  const healed = step.healed(entry);
  const reason = step.reason(entry);
  return (
    <div className="row">
      <b className="num">{labels.numbered(step.number(entry))}</b>
      <span className="what">{step.action(entry)}</span>
      {healed ? <b className="heal">{labels.HEAL}</b> : null}
      {typed === null ? null : (
        <span className="text">
          “{typed}” <small>{step.helper(entry)}</small>
        </span>
      )}
      <span className="ms">{labels.milliseconds(step.latency(entry))}</span>
      <b className={changed ? "effect" : "effect flat"}>{labels.effect(changed)}</b>
      {healed && reason !== null ? <p className="why">{labels.because(reason)}</p> : null}
    </div>
  );
}
