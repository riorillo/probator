import * as labels from "../model/labels.ts";
import * as page from "../model/page.ts";
import * as report from "../model/report.ts";
import { chosen } from "../model/targets.ts";
import { EmptyState } from "./EmptyState.tsx";
import { Shot } from "./Shot.tsx";
import { TargetOverlay } from "./TargetOverlay.tsx";
import { ViewBar } from "./ViewBar.tsx";

/** The observed page: its address, its frame with the targets over it, its title. */
export function Viewport({
  state,
  running,
  marked,
}: {
  readonly state: unknown;
  readonly running: boolean;
  readonly marked: boolean;
}) {
  const seen = report.page(state);
  const frame = seen === null ? null : page.shot(seen);
  return (
    <section className="panel">
      <ViewBar address={address(seen)} running={running} vision={report.vision(state)} />
      <div className="viewport">
        {seen === null ? <EmptyState /> : null}
        {frame === null ? null : <Shot frame={frame} />}
        <TargetOverlay page={seen} picked={chosen(state)} marked={marked} />
      </div>
    </section>
  );
}

/** The address of the observed page, or the placeholder before there is one. */
function address(seen: unknown): string {
  if (seen === null) return labels.NO_PAGE;
  return page.url(seen);
}
