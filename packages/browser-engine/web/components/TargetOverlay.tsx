import { boxes } from "../model/targets.ts";
import { TargetBox } from "./TargetBox.tsx";

/** Every element of the page that has a rectangle, over the frame. */
export function TargetOverlay({
  page,
  picked,
  marked,
}: {
  readonly page: unknown;
  readonly picked: number | null;
  readonly marked: boolean;
}) {
  return (
    <div className="targets" hidden={!marked}>
      {boxes(page).map((box) => (
        <TargetBox key={box.node} spot={box.spot} selected={box.node === picked} />
      ))}
    </div>
  );
}
