import type { Spot } from "../model/targets.ts";

/** One element of the observed page, drawn over the frame. */
export function TargetBox({
  spot,
  selected,
}: {
  readonly spot: Spot;
  readonly selected: boolean;
}) {
  return <div className={selected ? "target selected" : "target"} style={spot} />;
}
