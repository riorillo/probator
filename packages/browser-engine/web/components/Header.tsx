import * as labels from "../model/labels.ts";
import * as report from "../model/report.ts";
import { useScreen } from "../store/hook.ts";
import { StatusDot } from "./StatusDot.tsx";

/** The brand, and the state of the run in one line. */
export function Header() {
  const screen = useScreen();
  const shown = screen.note ?? labels.statusLabel(report.status(screen.report));
  return (
    <header className="top">
      <a className="brand" href="/"><span>S1</span> VISUAL BROWSER AGENT</a>
      <p className="status">
        <StatusDot state={screen.report} />
        <span role="status">{shown}</span>
      </p>
    </header>
  );
}
