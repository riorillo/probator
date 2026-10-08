import { status } from "../model/report.ts";

/** The lamp beside the status text; the stylesheet colours it from the state. */
export function StatusDot({ state }: { readonly state: unknown }) {
  return <b className="mark" data-state={status(state)} />;
}
