import * as fields from "../model/fields.ts";
import { submit, set } from "./handlers.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";

/** The goal, the model settings and the button that starts a run. */
export function TaskForm({
  values,
  model,
  disabled,
  vision,
}: {
  readonly values: fields.Values;
  readonly model: string;
  readonly disabled: boolean;
  readonly vision: boolean;
}) {
  return (
    <form onSubmit={submit}>
      <label className="tag" htmlFor={fields.GOAL.key}>
        {fields.GOAL.label}
      </label>
      <textarea
        id={fields.GOAL.key}
        name={fields.GOAL.key}
        rows={3}
        spellCheck={false}
        required
        placeholder={fields.GOAL.placeholder}
        value={values.goal}
        disabled={disabled}
        onChange={(event) => set(fields.GOAL.key, event.target.value)}
      />
      <div className="form-row">
        <button className="primary" type="submit" disabled={disabled}>
          START ▶
        </button>
        <p className="fine">
          START opens a new tab on google.com. S1 Visual Browser Agent observes the page, asks
          Clef to choose an action, and executes it. <b>PAUSE</b> stops it after the current request.
        </p>
      </div>
      <p className="helper">
        TEXT MODEL · <span>{model}</span>
      </p>
      <SettingsPanel values={values} disabled={disabled} vision={vision} />
    </form>
  );
}
