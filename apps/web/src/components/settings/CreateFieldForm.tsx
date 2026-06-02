import { useState, type FormEvent } from "react";
import { Field } from "../common/Field";
import type { CustomField } from "../../types";

interface CreateFieldFormProps {
  onSubmit: (input: {
    name: string;
    fieldType: CustomField["fieldType"];
    isRequired: boolean;
    options: string[];
  }) => void;
}

export function CreateFieldForm({ onSubmit }: CreateFieldFormProps) {
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<CustomField["fieldType"]>("text");
  const [options, setOptions] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const selectsOptions = fieldType === "select" || fieldType === "multi_select";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      name,
      fieldType,
      isRequired,
      options: selectsOptions ? options.split(",").map((option) => option.trim()).filter(Boolean) : []
    });
    setName("");
    setOptions("");
  }

  return (
    <form className="stacked-admin-form" onSubmit={submit}>
      <Field label="Field name" value={name} onChange={setName} />
      <label className="field">
        <span>Data type</span>
        <select value={fieldType} onChange={(event) => setFieldType(event.target.value as CustomField["fieldType"])}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="boolean">Checkbox</option>
          <option value="select">Single select</option>
          <option value="multi_select">Multi select</option>
          <option value="user">Workspace member</option>
        </select>
      </label>
      {selectsOptions && <Field label="Options (comma separated)" value={options} onChange={setOptions} />}
      <label className="checkbox">
        <input type="checkbox" checked={isRequired} onChange={(event) => setIsRequired(event.target.checked)} />
        Required value
      </label>
      <button className="primary">Add field</button>
    </form>
  );
}
