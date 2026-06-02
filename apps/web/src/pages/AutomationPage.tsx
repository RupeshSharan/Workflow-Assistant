import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { api } from "../api";
import { Field } from "../components/common/Field";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session, WorkItem } from "../types";

interface AutomationPageProps {
  session: Session;
  canConfigure: boolean;
}

export function AutomationPage({ session, canConfigure }: AutomationPageProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Notify on urgent creation");
  const [priority, setPriority] = useState<WorkItem["priority"]>("urgent");
  const [notificationTitle, setNotificationTitle] = useState("Attention required");
  const [body, setBody] = useState("A new work item needs review: {title}");

  const rules = useQuery({
    queryKey: ["automation-rules", session.activeWorkspaceId],
    queryFn: () => api.automationRules(session)
  });

  const runs = useQuery({
    queryKey: ["automation-runs", session.activeWorkspaceId],
    queryFn: () => api.automationRuns(session)
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.createAutomationRule(session, {
        name,
        triggerType: "work_item.created",
        condition: { priority },
        action: { type: "notify_creator", title: notificationTitle, body }
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["automation-rules", session.activeWorkspaceId] })
  });

  return (
    <section className="automation-page">
      <div className="page-intro">
        <p className="eyebrow">Automation engine</p>
        <h3>React to work events with configured rules.</h3>
        <p>The first supported action notifies the item creator when a matching priority item is created.</p>
      </div>

      <div className="automation-grid">
        {canConfigure && (
          <form
            className="automation-form"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <h4>Create rule</h4>
            <Field label="Rule name" value={name} onChange={setName} />
            <label className="field">
              <span>When created priority is</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as WorkItem["priority"])}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <Field label="Notification title" value={notificationTitle} onChange={setNotificationTitle} />
            <Field label="Notification body ({title} inserts item title)" value={body} onChange={setBody} />
            {mutation.error && <p className="form-error">{mutation.error.message}</p>}
            <button className="primary">Create rule</button>
          </form>
        )}

        <section className="rule-list">
          <h4>Active rules</h4>
          {rules.isLoading ? (
            <LoadingSpinner message="Loading active rules..." />
          ) : (
            rules.data?.rules.map((rule) => (
              <article key={rule.id}>
                <Zap size={15} />
                <div>
                  <strong>{rule.name}</strong>
                  <p>Work item created / {rule.condition.priority ?? "any"} priority</p>
                </div>
                <em>{rule.isActive ? "Active" : "Paused"}</em>
              </article>
            ))
          )}
        </section>
      </div>

      <section className="run-list">
        <h4>Recent runs</h4>
        {runs.isLoading ? (
          <LoadingSpinner message="Loading runs history..." />
        ) : (
          runs.data?.runs.map((run) => (
            <article key={run.id}>
              <strong>{run.ruleName}</strong>
              <span className={`run-status ${run.status}`}>{run.status}</span>
              <small>{new Date(run.executedAt).toLocaleString()}</small>
            </article>
          ))
        )}
      </section>
    </section>
  );
}
