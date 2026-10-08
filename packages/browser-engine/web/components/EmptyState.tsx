import * as labels from "../model/labels.ts";

/** What the viewport shows before the run opens a page. */
export function EmptyState() {
  return (
    <div className="empty">
      <p className="big">{labels.EMPTY_BIG}</p>
      <p className="muted">{labels.EMPTY_SMALL}</p>
    </div>
  );
}
