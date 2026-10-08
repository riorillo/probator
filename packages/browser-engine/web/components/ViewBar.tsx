import * as labels from "../model/labels.ts";
import { pauseRun } from "./handlers.ts";

/** The address of the observed page, the mode it is read in, and the button that pauses the run. */
export function ViewBar({
  address,
  running,
  vision,
}: {
  readonly address: string;
  readonly running: boolean;
  readonly vision: boolean;
}) {
  return (
    <div className="bar">
      <span className="address">{address}</span>
      <span className="bar-right">
        <span className={vision ? "mode image" : "mode"}>
          {vision ? labels.VISION_ON : labels.VISION_OFF}
        </span>
        <b className="live">LIVE</b>
        {running ? (
          <button className="pause" type="button" onClick={pauseRun}>
            PAUSE
          </button>
        ) : null}
      </span>
    </div>
  );
}
