import type { Spec } from "../model/fields.ts";
import { set } from "./handlers.ts";

/** One labelled input of the settings grid. */
export function Field({
  spec,
  value,
  disabled,
}: {
  readonly spec: Spec;
  readonly value: string;
  readonly disabled: boolean;
}) {
  return (
    <>
      <label htmlFor={spec.key}>{spec.label}</label>
      <input
        id={spec.key}
        name={spec.key}
        type={spec.type}
        value={value}
        placeholder={spec.placeholder}
        autoComplete={completion(spec.type)}
        required={spec.required}
        disabled={disabled}
        onChange={(event) => set(spec.key, event.target.value)}
      />
    </>
  );
}

/** What the browser may remember about a field. */
function completion(type: Spec["type"]): string | undefined {
  if (type === "url") return "url";
  if (type === "password") return "new-password";
  return undefined;
}
