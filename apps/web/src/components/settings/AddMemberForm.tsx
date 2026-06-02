import { useState, type FormEvent } from "react";

interface AddMemberFormProps {
  onSubmit: (input: { email: string; role: "admin" | "manager" | "member" | "viewer" }) => void;
}

export function AddMemberForm({ onSubmit }: AddMemberFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "manager" | "member" | "viewer">("member");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ email, role });
    setEmail("");
  }

  return (
    <form className="inline-admin-form" onSubmit={submit}>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Existing user email"
        required
      />
      <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
        <option value="member">Member</option>
        <option value="viewer">Viewer</option>
        <option value="manager">Manager</option>
        <option value="admin">Admin</option>
      </select>
      <button className="primary">Add</button>
    </form>
  );
}
