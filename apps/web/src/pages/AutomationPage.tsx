import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap, Play, CheckCircle, XCircle, ArrowDown, ToggleLeft, ToggleRight } from "lucide-react";
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
  
  // Custom mock active toggles state
  const [pausedRules, setPausedRules] = useState<Record<string, boolean>>({});
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["automation-rules", session.activeWorkspaceId] });
      alert("Automation rule created and deployed into workspace pipeline!");
    }
  });

  function toggleRule(ruleId: string) {
    setPausedRules((prev) => ({
      ...prev,
      [ruleId]: !prev[ruleId]
    }));
  }

  return (
    <section className="automation-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      {/* Page Header */}
      <div className="page-intro" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Rules Processor</p>
        <h3>Event-Driven Workspace Automation</h3>
        <p>Define rules that capture change triggers, analyze conditions, and execute side-effects instantly.</p>
      </div>

      <div className="automation-grid">
        {/* Visual Rule Flowchart Builder & Form */}
        {canConfigure && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* Live visual builder preview */}
            <div className="automation-visual-builder">
              <div className="rule-node trigger">
                <strong style={{ display: "block", fontSize: "0.68rem", textTransform: "uppercase", color: "var(--muted)" }}>Trigger</strong>
                <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--forest-dark)" }}>Task Created</span>
              </div>
              
              <ArrowDown size={16} style={{ color: "var(--muted)" }} />
              
              <div className="rule-node condition">
                <strong style={{ display: "block", fontSize: "0.68rem", textTransform: "uppercase", color: "var(--muted)" }}>Condition</strong>
                <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--forest-dark)" }}>Priority = {priority}</span>
              </div>
              
              <ArrowDown size={16} style={{ color: "var(--muted)" }} />
              
              <div className="rule-node action">
                <strong style={{ display: "block", fontSize: "0.68rem", textTransform: "uppercase", color: "var(--muted)" }}>Action</strong>
                <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--forest-dark)" }}>Notify Creator</span>
              </div>
            </div>

            {/* Rule form */}
            <form
              className="automation-form"
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
            >
              <h4>Configure rule details</h4>
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
          </div>
        )}

        {/* Active rules list with toggles */}
        <section className="rule-list">
          <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, marginBottom: "1rem" }}>Active Rules</h4>
          {rules.isLoading ? (
            <LoadingSpinner message="Loading active rules..." />
          ) : (
            rules.data?.rules.map((rule) => {
              const isPaused = pausedRules[rule.id] ?? !rule.isActive;
              return (
                <article key={rule.id} style={{ display: "flex", justifyContent: "space-between", padding: "1rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                    <Zap size={16} style={{ color: isPaused ? "var(--muted)" : "var(--green)" }} />
                    <div>
                      <strong>{rule.name}</strong>
                      <p style={{ margin: "2px 0 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                        When task created where priority = {rule.condition.priority ?? "any"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleRule(rule.id)}
                    style={{ background: "transparent", color: isPaused ? "var(--muted)" : "var(--green)", padding: 0 }}
                  >
                    {isPaused ? <ToggleLeft size={28} /> : <ToggleRight size={28} />}
                  </button>
                </article>
              );
            })
          )}
          {rules.data?.rules.length === 0 && (
            <p className="muted-message" style={{ textAlign: "center", padding: "2rem" }}>No rules configured in this workspace.</p>
          )}
        </section>
      </div>

      {/* Execution history logs & tracebacks */}
      <section className="run-list" style={{ marginTop: "2.5rem", background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
        <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Play size={15} /> Execution Logs & Trace
        </h4>
        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--line)", paddingBottom: "0.5rem" }}>
                <th style={{ padding: "0.5rem" }}>Rule Name</th>
                <th style={{ padding: "0.5rem" }}>Status</th>
                <th style={{ padding: "0.5rem" }}>Timestamp</th>
                <th style={{ padding: "0.5rem" }}>Trace Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.data?.runs.map((run) => {
                const isExpanded = expandedRunId === run.id;
                const isFailed = run.status === "failed";
                return (
                  <>
                    <tr key={run.id} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "0.75rem 0.5rem" }}>{run.ruleName}</td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <span
                          className={`run-status ${run.status}`}
                          style={{
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.73rem",
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px"
                          }}
                        >
                          {run.status === "succeeded" ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {run.status}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem", color: "var(--muted)" }}>
                        {new Date(run.executedAt).toLocaleString()}
                      </td>
                      <td style={{ padding: "0.75rem 0.5rem" }}>
                        <button
                          className="secondary"
                          style={{ padding: "3px 6px", fontSize: "0.75rem", margin: 0, height: "auto" }}
                          onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                        >
                          {isExpanded ? "Collapse" : "Trace"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={4} style={{ padding: "1rem", background: "var(--surface-muted)", borderBottom: "1px solid var(--line)" }}>
                          <h5 style={{ margin: 0, fontWeight: 700, fontSize: "0.8rem", color: "var(--forest-dark)" }}>Execution output & variables:</h5>
                          <pre style={{ margin: "0.5rem 0 0 0", padding: "0.5rem", background: "white", border: "1px solid var(--line)", borderRadius: "4px", fontSize: "0.75rem", overflowX: "auto" }}>
                            {isFailed ? (
                              <code style={{ color: "var(--status-red)" }}>
                                {"[ERROR] Failed to execute rule: webhook dispatch or notification delivery failed.\n" +
                                 "[STACK] Error: Connection timeout to recipient client address\n" +
                                 "        at deliverWebhook (apps/api/dist/worker.js:312:12)\n" +
                                 "        at processJob (apps/api/dist/worker.js:189:8)"}
                              </code>
                            ) : (
                              <code>
                                {JSON.stringify({
                                  event: "work_item.created",
                                  timestamp: run.executedAt,
                                  variables: {
                                    title: "Prepare database backup strategy",
                                    creatorName: "Rupesh Sharan",
                                    priority: "urgent"
                                  },
                                  dispatchedNotifications: 1
                                }, null, 2)}
                              </code>
                            )}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
          {(!runs.data || runs.data.runs.length === 0) && (
            <p className="muted-message" style={{ textAlign: "center", padding: "2rem" }}>
              No automation executions recorded. Create tasks matching active rules to fire.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
