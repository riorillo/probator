import * as report from "../model/report.ts";
import { ExportButton } from "./ExportButton.tsx";
import { TraceCount } from "./TraceCount.tsx";
import { TraceRows } from "./TraceRows.tsx";

/** The run as a list of executed actions, with the button that exports it. */
export function TracePanel({ state }: { readonly state: unknown }) {
  const history = report.history(state);
  return (
    <section className="panel">
      <div className="trace-head">
        <h2>
          ACTIONS TAKEN <TraceCount steps={history.length} elapsedMs={report.elapsed(state)} />
        </h2>
        <ExportButton state={state} ready={history.length > 0} />
      </div>
      <div className="trace">
        <TraceRows history={history} />
      </div>
    </section>
  );
}
