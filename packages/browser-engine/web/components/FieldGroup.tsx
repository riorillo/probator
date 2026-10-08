import type { Group, Values } from "../model/fields.ts";
import { Field } from "./Field.tsx";

/** One titled block of the settings grid. */
export function FieldGroup({
  group,
  values,
  disabled,
}: {
  readonly group: Group;
  readonly values: Values;
  readonly disabled: boolean;
}) {
  return (
    <>
      <h3>{group.title}</h3>
      {group.specs.map((spec) => (
        <Field key={spec.key} spec={spec} value={values[spec.key]} disabled={disabled} />
      ))}
    </>
  );
}
