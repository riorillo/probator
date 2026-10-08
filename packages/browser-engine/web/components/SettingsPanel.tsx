import * as fields from "../model/fields.ts";
import * as labels from "../model/labels.ts";
import { snapshotAsImage } from "./handlers.ts";
import { FieldGroup } from "./FieldGroup.tsx";
import { Toggle } from "./Toggle.tsx";

/** The two model settings and the mode of the snapshot, folded away until they are needed. */
export function SettingsPanel({
  values,
  disabled,
  vision,
}: {
  readonly values: fields.Values;
  readonly disabled: boolean;
  readonly vision: boolean;
}) {
  return (
    <details>
      <summary>MODEL SETTINGS</summary>
      <div className="settings">
        {fields.GROUPS.map((group) => (
          <FieldGroup key={group.title} group={group} values={values} disabled={disabled} />
        ))}
      </div>
      <div className="modes">
        <Toggle
          id="vision"
          label={labels.VISION_FIELD}
          checked={vision}
          onChange={snapshotAsImage}
        />
      </div>
      <p className="fine">
        Settings apply from the next START. API keys stay on this machine and are not included in the trace.
      </p>
    </details>
  );
}
