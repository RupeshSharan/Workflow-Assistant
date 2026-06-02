import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { WorkItem } from "../../types";

interface CreateItemFormProps {
  onSubmit: (input: { title: string; description: string; priority: WorkItem["priority"] }) => void;
  pending: boolean;
}

export function CreateItemForm({ onSubmit, pending }: CreateItemFormProps) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<WorkItem["priority"]>("medium");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ title, description: "", priority });
    setTitle("");
  }

  return (
    <form className="quick-create" onSubmit={submit}>
      <Plus size={17} />
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Create a work item..."
        required
      />
      <select
        value={priority}
        onChange={(event) => setPriority(event.target.value as WorkItem["priority"])}
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </select>
      <button className="primary" disabled={pending}>
        Add
      </button>
    </form>
  );
}
