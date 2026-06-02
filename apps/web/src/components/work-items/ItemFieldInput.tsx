import type { ItemCustomField } from "../../types";

interface ItemFieldInputProps {
  field: ItemCustomField;
  value: unknown;
  members: Array<{ id: string; name: string }>;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

export function ItemFieldInput({
  field,
  value,
  members,
  onChange,
  disabled
}: ItemFieldInputProps) {
  if (field.fieldType === "boolean") {
    return (
      <label className="checkbox item-checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        {field.name}
      </label>
    );
  }

  if (field.fieldType === "select" || field.fieldType === "user") {
    const options =
      field.fieldType === "select"
        ? field.options.map((option) => ({ id: option, name: option }))
        : members;
    return (
      <label className="field">
        <span>
          {field.name}
          {field.isRequired ? " *" : ""}
        </span>
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputValue = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return (
    <label className="field">
      <span>
        {field.name}
        {field.isRequired ? " *" : ""}
      </span>
      <input
        type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"}
        value={inputValue}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.fieldType === "multi_select" ? "Comma-separated options" : undefined}
        disabled={disabled}
      />
    </label>
  );
}
