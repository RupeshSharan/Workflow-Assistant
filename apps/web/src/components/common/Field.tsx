interface FieldProps {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}

export function Field({
  label,
  value,
  type = "text",
  onChange
}: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} required onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
