import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, MessageSquare, Clock3 } from "lucide-react";
import { api } from "../../api";
import type { Session, WorkItem, ItemCustomField } from "../../types";
import { ItemFieldInput } from "./ItemFieldInput";

function normalizeDraftValue(field: ItemCustomField, value: unknown): unknown {
  if (field.fieldType === "number") {
    return value === "" ? null : Number(value);
  }
  if (field.fieldType === "boolean") {
    return Boolean(value);
  }
  if (field.fieldType === "multi_select" && typeof value === "string") {
    return value.split(",").map((option) => option.trim()).filter(Boolean);
  }
  return value === "" ? null : value;
}

function friendlyFieldName(fieldName: string): string {
  if (fieldName.startsWith("custom_field:")) return "a custom field";
  return fieldName.replace(/_/g, " ");
}

interface WorkItemPanelProps {
  item: WorkItem;
  session: Session;
  onClose: () => void;
}

export function WorkItemPanel({
  item,
  session,
  onClose
}: WorkItemPanelProps) {
  const queryClient = useQueryClient();
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [comment, setComment] = useState("");
  const activeRole = session.workspaces.find((workspace) => workspace.id === session.activeWorkspaceId)?.role;
  const canContribute = activeRole !== "viewer";
  const fields = useQuery({
    queryKey: ["item-fields", session.activeWorkspaceId, item.id],
    queryFn: () => api.itemFields(session, item.id)
  });
  const comments = useQuery({
    queryKey: ["comments", session.activeWorkspaceId, item.id],
    queryFn: () => api.comments(session, item.id)
  });
  const history = useQuery({
    queryKey: ["history", session.activeWorkspaceId, item.id],
    queryFn: () => api.history(session, item.id)
  });
  const members = useQuery({
    queryKey: ["members", session.activeWorkspaceId],
    queryFn: () => api.members(session)
  });

  useEffect(() => {
    if (!fields.data) return;
    setDraftValues(
      Object.fromEntries(fields.data.fields.map((field) => [field.id, field.value ?? ""]))
    );
  }, [fields.data]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fieldMutation = useMutation({
    mutationFn: () =>
      api.updateItemFields(
        session,
        item.id,
        (fields.data?.fields ?? []).map((field) => ({
          customFieldId: field.id,
          value: normalizeDraftValue(field, draftValues[field.id])
        }))
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["item-fields", session.activeWorkspaceId, item.id] });
      void queryClient.invalidateQueries({ queryKey: ["history", session.activeWorkspaceId, item.id] });
    }
  });

  const commentMutation = useMutation({
    mutationFn: () => api.addComment(session, item.id, comment),
    onSuccess: () => {
      setComment("");
      void queryClient.invalidateQueries({ queryKey: ["comments", session.activeWorkspaceId, item.id] });
    }
  });

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="item-drawer" role="dialog" aria-label={item.title} onClick={(event) => event.stopPropagation()}>
        <header className="drawer-heading">
          <div>
            <span className={`priority ${item.priority}`}>{item.priority}</span>
            <h3>{item.title}</h3>
            <p>
              {item.templateName} / {item.stageName}
            </p>
          </div>
          <button className="icon-button" aria-label="Close detail" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <section className="drawer-section">
          <h4>Custom fields</h4>
          {fields.data?.fields.length ? (
            <form
              className="item-field-form"
              onSubmit={(event) => {
                event.preventDefault();
                fieldMutation.mutate();
              }}
            >
              {fields.data.fields.map((field) => (
                <ItemFieldInput
                  key={field.id}
                  field={field}
                  value={draftValues[field.id]}
                  members={members.data?.members ?? []}
                  onChange={(value) => setDraftValues({ ...draftValues, [field.id]: value })}
                  disabled={!canContribute}
                />
              ))}
              {fieldMutation.error && <p className="form-error">{fieldMutation.error.message}</p>}
              {canContribute && <button className="primary">Save fields</button>}
            </form>
          ) : (
            <p className="muted-message">Define fields in Settings to collect structured data.</p>
          )}
        </section>
        <section className="drawer-section">
          <h4>
            <MessageSquare size={15} /> Discussion
          </h4>
          {canContribute && (
            <form
              className="comment-form"
              onSubmit={(event) => {
                event.preventDefault();
                commentMutation.mutate();
              }}
            >
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add a comment"
                required
              />
              <button className="primary">Post</button>
            </form>
          )}
          <div className="comment-list">
            {comments.data?.comments.map((entry) => (
              <article key={entry.id}>
                <strong>{entry.userName}</strong>
                <small>{new Date(entry.createdAt).toLocaleString()}</small>
                <p>{entry.content}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="drawer-section history">
          <h4>
            <Clock3 size={15} /> Activity
          </h4>
          {history.data?.history.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.changedBy}</strong> changed {friendlyFieldName(entry.fieldName)}
              <small>{new Date(entry.changedAt).toLocaleString()}</small>
            </p>
          ))}
        </section>
      </aside>
    </div>
  );
}
