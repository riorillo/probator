/** One checkbox of the viewport footer. */
export function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />{" "}
      {label}
    </label>
  );
}
