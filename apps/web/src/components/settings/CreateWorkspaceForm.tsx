import { useState, type FormEvent } from "react";
import { Field } from "../common/Field";

interface CreateWorkspaceFormProps {
  onSubmit: (input: { name: string; visibility: "private" | "organization" }) => void;
}

export function CreateWorkspaceForm({ onSubmit }: CreateWorkspaceFormProps) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "organization">("private");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ name, visibility });
    setName("");
  }

  return (
    <form className="stacked-admin-form" onSubmit={submit}>
      <Field label="Workspace name" value={name} onChange={setName} />
      <label className="field">
        <span>Visibility</span>
        <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
          <option value="private">Private</option>
          <option value="organization">Organization</option>
        </select>
      </label>
      <button className="primary">Create workspace</button>
    </form>
  );
}
