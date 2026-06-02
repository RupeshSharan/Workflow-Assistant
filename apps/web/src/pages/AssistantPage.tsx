import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Session } from "../types";

interface AssistantPageProps {
  session: Session;
  initialCommand?: string;
  onCommandUsed?: () => void;
}

export function AssistantPage({
  session,
  initialCommand,
  onCommandUsed
}: AssistantPageProps) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [command, setCommand] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.groundedChat(session, question)
  });

  const previewMutation = useMutation({
    mutationFn: (cmdVal: string) => api.previewCommand(session, cmdVal)
  });

  useEffect(() => {
    if (initialCommand) {
      setCommand(initialCommand);
      onCommandUsed?.();
      previewMutation.mutate(initialCommand);
    }
  }, [initialCommand]);

  const executeMutation = useMutation({
    mutationFn: () => api.executeCommand(session, previewMutation.data!.runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  return (
    <section className="assistant-page">
      <div className="page-intro">
        <p className="eyebrow">AI assistant</p>
        <h3>Ask questions grounded in indexed workspace documents.</h3>
        <p>Answers use tenant-scoped retrieval and are logged for quality review. AI actions are not enabled yet.</p>
      </div>

      <form
        className="assistant-question"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What is our approval policy for refund requests?"
          required
        />
        <button className="primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Thinking..." : "Ask assistant"}
        </button>
      </form>

      {mutation.error && <p className="form-error">{mutation.error.message}</p>}

      {mutation.data && (
        <div className="assistant-response">
          <article>
            <p className="eyebrow">Answer</p>
            <p>{mutation.data.answer}</p>
          </article>
          <aside>
            <h4>Sources</h4>
            {mutation.data.sources.map((source) => (
              <div key={source.chunkId}>
                <strong>{source.title}</strong>
                <p>{source.chunkText}</p>
              </div>
            ))}
            {!mutation.data.sources.length && <p className="muted-message">No indexed source was retrieved.</p>}
          </aside>
        </div>
      )}

      <section className="command-agent">
        <div>
          <p className="eyebrow">Action agent</p>
          <h3>Plan a controlled workspace action.</h3>
          <p>The assistant proposes one allowed tool. Nothing changes until you confirm it.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            previewMutation.mutate(command);
          }}
        >
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Create a high priority task to prepare the weekly report"
            required
          />
          <button className="primary">Preview action</button>
        </form>

        {previewMutation.error && <p className="form-error">{previewMutation.error.message}</p>}

        {previewMutation.data && (
          <article className="command-preview">
            <strong>{previewMutation.data.action.tool.replace(/_/g, " ")}</strong>
            <p>{previewMutation.data.action.rationale}</p>
            {previewMutation.data.action.tool === "create_work_item" ? (
              <small>
                {previewMutation.data.action.arguments.title} / {previewMutation.data.action.arguments.priority} priority
              </small>
            ) : previewMutation.data.action.tool === "search_documents" ? (
              <small>Search: {previewMutation.data.action.arguments.query}</small>
            ) : previewMutation.data.action.tool === "update_work_item_status" ? (
              <small>
                Move item "{previewMutation.data.action.arguments.itemTitle}" to stage "{previewMutation.data.action.arguments.stageName}"
              </small>
            ) : (
              <small>
                Assign item "{previewMutation.data.action.arguments.itemTitle}" to "{previewMutation.data.action.arguments.assigneeName}"
              </small>
            )}
            <button className="primary" onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
              {executeMutation.isPending ? "Executing..." : "Confirm and execute"}
            </button>
          </article>
        )}

        {executeMutation.error && <p className="form-error">{executeMutation.error.message}</p>}
        {executeMutation.isSuccess && <p className="command-success">Action executed and recorded in the audit log.</p>}
      </section>
    </section>
  );
}
