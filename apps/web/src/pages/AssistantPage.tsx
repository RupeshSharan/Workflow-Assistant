import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Bot, ShieldCheck, Terminal, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
import { api } from "../api";
import type { Session, DecisionLogEntry } from "../types";

interface AssistantPageProps {
  session: Session;
  initialCommand?: string;
  onCommandUsed?: () => void;
}

const CHAT_PROMPTS = [
  "What is our approval policy for refund requests?",
  "List active bottlenecks in General Workspace",
  "Summarize the recent workspace reports"
];

const AGENT_PROMPTS = [
  "Create urgent task to fix postgres connection pool leakage",
  "Move task 'Deploy Backend API' to Reviewing",
  "Assign task 'prepare weekly report' to Rupesh"
];

export function AssistantPage({
  session,
  initialCommand,
  onCommandUsed
}: AssistantPageProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [activeMode, setActiveMode] = useState<"chat" | "agent" | "decisions">("chat");
  const [question, setQuestion] = useState("");
  const [command, setCommand] = useState("");

  const memoryQuery = useQuery({
    queryKey: ["workspace-memory", session.activeWorkspaceId],
    queryFn: () => api.workspaceMemory(session),
    enabled: !!session.activeWorkspaceId
  });

  const chatMutation = useMutation({
    mutationFn: () => api.groundedChat(session, question)
  });

  const previewMutation = useMutation({
    mutationFn: (cmdVal: string) => api.previewCommand(session, cmdVal)
  });

  // Prefill command from location state (redirects from other pages)
  useEffect(() => {
    const locState = location.state as { prefill?: string } | null;
    if (locState?.prefill) {
      setActiveMode("agent");
      setCommand(locState.prefill);
      previewMutation.mutate(locState.prefill);
      // Clear location state so it doesn't run again on reload
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (initialCommand) {
      setActiveMode("agent");
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
      void queryClient.invalidateQueries({ queryKey: ["audit-logs", session.activeWorkspaceId] });
      alert("AI Agent executed the action successfully! Transaction has been logged in audit logs.");
    }
  });

  function clickPrompt(p: string, mode: "chat" | "agent") {
    if (mode === "chat") {
      setQuestion(p);
    } else {
      setCommand(p);
      previewMutation.mutate(p);
    }
  }

  return (
    <section className="assistant-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      {/* Page header */}
      <div className="page-intro" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">AI Engine</p>
        <h3>Action-Capable Workspace Assistant</h3>
        <p>Ground chat requests in local text note memories, or dispatch the Agent to invoke validated backend tools.</p>
      </div>

      {/* Mode Selectors */}
      <div className="tab-row" style={{ marginBottom: "2rem" }}>
        <button className={activeMode === "chat" ? "active" : ""} onClick={() => setActiveMode("chat")}>
          <Bot size={14} style={{ marginRight: "4px" }} /> Grounded Chat Mode
        </button>
        <button className={activeMode === "agent" ? "active" : ""} onClick={() => setActiveMode("agent")}>
          <Terminal size={14} style={{ marginRight: "4px" }} /> Action Agent Mode
        </button>
        <button className={activeMode === "decisions" ? "active" : ""} onClick={() => setActiveMode("decisions")}>
          <FileText size={14} style={{ marginRight: "4px" }} /> Decision Log
        </button>
      </div>

      {/* Chat Mode view */}
      {activeMode === "chat" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.5rem" }}>
          
          {/* Left panel: chat form & answers */}
          <div>
            {/* Suggested Prompts */}
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                Suggested Prompts
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {CHAT_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => clickPrompt(p, "chat")}
                    style={{
                      fontSize: "0.78rem",
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: "16px",
                      padding: "4px 12px",
                      color: "var(--forest-dark)",
                      textAlign: "left"
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <form
              className="assistant-question"
              onSubmit={(event) => {
                event.preventDefault();
                chatMutation.mutate();
              }}
              style={{ marginTop: "1rem" }}
            >
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask about workspace files (e.g., What are the approval rules?)"
                required
                style={{ height: "90px" }}
              />
              <button className="primary" disabled={chatMutation.isPending}>
                {chatMutation.isPending ? "Thinking..." : "Ask Assistant"}
              </button>
            </form>

            {chatMutation.error && <p className="form-error">{chatMutation.error.message}</p>}

            {chatMutation.data && (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "14px",
                  padding: "1.5rem",
                  marginTop: "1.5rem",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.02)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
                    <ShieldCheck size={18} className="text-green-600" /> Answer
                    <span className="citation-badge" style={{ fontSize: "0.65rem" }}>
                      Grounded in {chatMutation.data.sources.length} sources
                    </span>
                  </h4>
                  {chatMutation.data.confidence !== undefined && (
                    <span style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      padding: "3px 9px",
                      borderRadius: "12px",
                      background: chatMutation.data.insufficientContext 
                        ? "rgba(239, 68, 68, 0.15)" 
                        : chatMutation.data.confidence > 70 
                          ? "rgba(16, 185, 129, 0.15)" 
                          : chatMutation.data.confidence > 40 
                            ? "rgba(245, 158, 11, 0.15)" 
                            : "rgba(239, 68, 68, 0.15)",
                      color: chatMutation.data.insufficientContext 
                        ? "#b91c1c" 
                        : chatMutation.data.confidence > 70 
                          ? "#047857" 
                          : chatMutation.data.confidence > 40 
                            ? "#b45309" 
                            : "#b91c1c"
                    }}>
                      Confidence: {chatMutation.data.insufficientContext ? 0 : chatMutation.data.confidence}%
                    </span>
                  )}
                </div>

                {chatMutation.data.insufficientContext && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.75rem 1rem",
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.15)",
                    borderRadius: "8px",
                    color: "#b91c1c",
                    fontSize: "0.85rem",
                    fontWeight: 500
                  }}>
                    ⚠️ I could not find enough workspace-specific context to answer this safely.
                  </div>
                )}

                <p style={{ marginTop: "0.75rem", fontSize: "0.95rem", lineHeight: "1.6", color: "var(--forest-dark)" }}>
                  {chatMutation.data.answer}
                </p>

                {chatMutation.data.sourcesUsed && chatMutation.data.sourcesUsed.length > 0 && (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)" }}>
                    <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", margin: "0 0 0.35rem 0" }}>
                      Cited Sources
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      {chatMutation.data.sourcesUsed.map((src) => (
                        <span key={src} style={{ fontSize: "0.75rem", padding: "2px 8px", background: "var(--surface-muted)", border: "1px solid var(--line)", borderRadius: "6px", color: "var(--forest-dark)" }}>
                          📄 {src}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel: Workspace Memory Card & Ground sources references */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* Workspace Memory Card */}
            {memoryQuery.data && (
              <aside
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "1.25rem",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.01)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", marginBottom: "0.75rem" }}>
                  <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.9rem", margin: 0, color: "var(--forest-dark)" }}>
                    🧠 Workspace Memory
                  </h4>
                  <span style={{ fontSize: "0.65rem", padding: "2px 7px", background: "rgba(16, 185, 129, 0.15)", color: "#047857", borderRadius: "10px", fontWeight: 700 }}>
                    Active
                  </span>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8rem" }}>
                  <div>
                    <strong style={{ color: "var(--muted)", display: "block" }}>Workspace Purpose:</strong>
                    <span style={{ color: "var(--forest-dark)" }}>{memoryQuery.data.purpose}</span>
                  </div>
                  {memoryQuery.data.defaultWorkflow && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Workflow Template:</strong>
                      <span style={{ color: "var(--forest-dark)", fontSize: "0.75rem" }}>
                        {memoryQuery.data.defaultWorkflow.templateName} ({memoryQuery.data.defaultWorkflow.stages.join(" ➔ ")})
                      </span>
                    </div>
                  )}
                  {memoryQuery.data.activeUsers.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block", marginBottom: "3px" }}>Team Members:</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                        {memoryQuery.data.activeUsers.map((user) => (
                          <span key={user} style={{ padding: "1px 6px", background: "white", border: "1px solid var(--line)", borderRadius: "4px", fontSize: "0.75rem" }}>
                            {user}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {memoryQuery.data.keyDocs.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Key Documents:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.keyDocs.map((doc) => <li key={doc}>{doc}</li>)}
                      </ul>
                    </div>
                  )}
                  {memoryQuery.data.rules.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Automation Rules:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.rules.map((rule) => <li key={rule}>{rule}</li>)}
                      </ul>
                    </div>
                  )}
                  {memoryQuery.data.goals.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Current Goals:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.goals.map((goal) => <li key={goal}>{goal}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </aside>
            )}

            {/* Retrieved sources */}
            <aside
              style={{
                background: "white",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                padding: "1.25rem",
                height: "fit-content"
              }}
            >
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <FileText size={16} /> Retrieved sources
              </h4>
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {chatMutation.data?.sources.map((source, idx) => (
                  <div
                    key={source.chunkId}
                    style={{
                      padding: "0.75rem",
                      border: "1px solid var(--line)",
                      background: "var(--surface-muted)",
                      borderRadius: "6px",
                      fontSize: "0.8rem"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                      <span>{source.title}</span>
                      <span style={{ color: "var(--status-purple)" }}>[Source {idx + 1}]</span>
                    </div>
                    <p style={{ margin: "0.4rem 0", color: "var(--muted)" }}>{source.chunkText}</p>
                  </div>
                ))}
                {(!chatMutation.data || !chatMutation.data.sources.length) && (
                  <p className="muted-message" style={{ textAlign: "center", fontSize: "0.8rem" }}>
                    No source context chunks loaded yet.
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* Agent Mode view */}
      {activeMode === "agent" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.5rem" }}>
          
          {/* Left panel: agent input & command details */}
          <div>
            {/* Suggested Agent commands */}
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                Suggested Agent Commands
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {AGENT_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => clickPrompt(p, "agent")}
                    style={{
                      fontSize: "0.78rem",
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: "16px",
                      padding: "4px 12px",
                      color: "var(--forest-dark)",
                      textAlign: "left"
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                previewMutation.mutate(command);
              }}
              style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}
            >
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="Draft a command (e.g., Create a high priority task named prepare report)"
                required
                style={{
                  flex: 1,
                  padding: "0.65rem 0.85rem",
                  fontSize: "0.9rem",
                  borderRadius: "8px",
                  border: "1px solid var(--line)"
                }}
              />
              <button className="primary" disabled={previewMutation.isPending}>
                {previewMutation.isPending ? "Planning..." : "Preview action"}
              </button>
            </form>

            {previewMutation.error && <p className="form-error" style={{ marginTop: "1rem" }}>{previewMutation.error.message}</p>}

            {/* In-chat agent tool confirmation layout */}
            {previewMutation.data && (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "14px",
                  padding: "1.5rem",
                  marginTop: "1.5rem",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.02)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, color: "var(--forest-dark)", margin: 0 }}>
                    Planned Action Execution
                  </h4>
                  <span style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: previewMutation.data.action.can_execute ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: previewMutation.data.action.can_execute ? "#047857" : "#b91c1c"
                  }}>
                    {previewMutation.data.action.can_execute ? "✓ Verified executable" : "⚠ Blocked - Insufficient context"}
                  </span>
                </div>
                
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 1rem 0" }}>
                  AI Agent has drafted a transaction. Confirm parameters to execute.
                </p>

                <div className="tool-preview-drawer">
                  <div className="tool-preview-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span><Terminal size={15} /> Tool Name: {previewMutation.data.action.tool}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--status-purple)", fontWeight: 600 }}>
                      Confidence: {previewMutation.data.action.confidence}%
                    </span>
                  </div>
                  
                  <div style={{ padding: "0.75rem", borderTop: "1px solid var(--line)", fontSize: "0.82rem", color: "var(--forest-dark)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div>
                      <strong style={{ color: "var(--muted)" }}>Intent:</strong> {previewMutation.data.action.intent}
                    </div>
                    {previewMutation.data.action.required_sources.length > 0 && (
                      <div>
                        <strong style={{ color: "var(--muted)" }}>Required Grounding:</strong> {previewMutation.data.action.required_sources.join(", ")}
                      </div>
                    )}
                    <div>
                      <strong style={{ color: "var(--muted)" }}>Rationale:</strong> {previewMutation.data.action.rationale}
                    </div>
                  </div>
                  
                  <div className="tool-preview-args">
                    {JSON.stringify(previewMutation.data.action.arguments, null, 2)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
                  <button 
                    className="primary" 
                    onClick={() => executeMutation.mutate()} 
                    disabled={executeMutation.isPending || !previewMutation.data.action.can_execute}
                  >
                    {executeMutation.isPending ? "Executing..." : "Confirm and execute"}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      previewMutation.reset();
                      setCommand("");
                    }}
                  >
                    Cancel Action
                  </button>
                </div>
              </div>
            )}

            {executeMutation.error && <p className="form-error" style={{ marginTop: "1rem" }}>{executeMutation.error.message}</p>}
            {executeMutation.isSuccess && (
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  borderRadius: "10px",
                  padding: "1rem",
                  marginTop: "1.5rem",
                  color: "#065f46",
                  fontSize: "0.9rem"
                }}
              >
                <strong>Success!</strong> Action has been completed and recorded in the audit trail feed.
              </div>
            )}
          </div>

          {/* Right panel: Workspace Memory Card & Security parameters */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* Workspace Memory Card */}
            {memoryQuery.data && (
              <aside
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "1.25rem",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.01)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", marginBottom: "0.75rem" }}>
                  <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.9rem", margin: 0, color: "var(--forest-dark)" }}>
                    🧠 Workspace Memory
                  </h4>
                  <span style={{ fontSize: "0.65rem", padding: "2px 7px", background: "rgba(16, 185, 129, 0.15)", color: "#047857", borderRadius: "10px", fontWeight: 700 }}>
                    Active
                  </span>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.8rem" }}>
                  <div>
                    <strong style={{ color: "var(--muted)", display: "block" }}>Workspace Purpose:</strong>
                    <span style={{ color: "var(--forest-dark)" }}>{memoryQuery.data.purpose}</span>
                  </div>
                  {memoryQuery.data.defaultWorkflow && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Workflow Template:</strong>
                      <span style={{ color: "var(--forest-dark)", fontSize: "0.75rem" }}>
                        {memoryQuery.data.defaultWorkflow.templateName} ({memoryQuery.data.defaultWorkflow.stages.join(" ➔ ")})
                      </span>
                    </div>
                  )}
                  {memoryQuery.data.activeUsers.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block", marginBottom: "3px" }}>Team Members:</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                        {memoryQuery.data.activeUsers.map((user) => (
                          <span key={user} style={{ padding: "1px 6px", background: "white", border: "1px solid var(--line)", borderRadius: "4px", fontSize: "0.75rem" }}>
                            {user}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {memoryQuery.data.keyDocs.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Key Documents:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.keyDocs.map((doc) => <li key={doc}>{doc}</li>)}
                      </ul>
                    </div>
                  )}
                  {memoryQuery.data.rules.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Automation Rules:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.rules.map((rule) => <li key={rule}>{rule}</li>)}
                      </ul>
                    </div>
                  )}
                  {memoryQuery.data.goals.length > 0 && (
                    <div>
                      <strong style={{ color: "var(--muted)", display: "block" }}>Current Goals:</strong>
                      <ul style={{ margin: "2px 0 0 0", paddingLeft: "1rem", color: "var(--forest-dark)" }}>
                        {memoryQuery.data.goals.map((goal) => <li key={goal}>{goal}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </aside>
            )}

            {/* Security Parameters */}
            <aside
              style={{
                background: "white",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                padding: "1.25rem",
                height: "fit-content"
              }}
            >
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <ShieldCheck size={16} className="text-green-600" /> Security parameters
              </h4>
              <ul style={{ margin: "0.75rem 0 0 0", paddingLeft: "1.2rem", fontSize: "0.8rem", color: "var(--forest-dark)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <li><strong>Dry-Run Mode</strong>: AI cannot commit state changes without explicit user approval.</li>
                <li><strong>Validated Inputs</strong>: All parameters are run against Zod validators.</li>
                <li><strong>Isolation</strong>: Tasks/docs constraints are scoped to the active workspace only.</li>
                <li><strong>Permissions</strong>: Action runner uses user-level RBAC filters.</li>
              </ul>
            </aside>
          </div>
        </div>
      )}

      {/* Decision Log Mode view */}
      {activeMode === "decisions" && (
        <DecisionLogPanel session={session} />
      )}
    </section>
  );
}

/* ─── Decision Log Panel ────────────────────────────────────────────── */

function DecisionLogPanel({ session }: { session: Session }) {
  const queryClient = useQueryClient();

  const decisionsQuery = useQuery({
    queryKey: ["decision-log", session.activeWorkspaceId],
    queryFn: () => api.decisionLog(session),
    enabled: !!session.activeWorkspaceId
  });

  const outcomeMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: string }) =>
      api.updateDecisionOutcome(session, id, outcome),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["decision-log", session.activeWorkspaceId] });
    }
  });

  const decisions = decisionsQuery.data?.decisions ?? [];

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", margin: 0 }}>
            AI Decision Log
          </h4>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
            Review AI recommendations and provide feedback to improve future suggestions.
          </p>
        </div>
        {decisionsQuery.data && (
          <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 10px", background: "var(--mint)", color: "var(--forest-dark)", borderRadius: "12px" }}>
            {decisionsQuery.data.total} total
          </span>
        )}
      </div>

      {decisionsQuery.isLoading && (
        <p style={{ textAlign: "center", color: "var(--muted)", padding: "2rem 0" }}>Loading decisions…</p>
      )}

      {decisionsQuery.error && (
        <p className="form-error">Failed to load decision log: {decisionsQuery.error.message}</p>
      )}

      {!decisionsQuery.isLoading && decisions.length === 0 && (
        <div className="card-premium" style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "14px", padding: "3rem 1.5rem", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>No AI decisions recorded yet. Decisions appear when the AI makes recommendations through chat or agent actions.</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {decisions.map((d: DecisionLogEntry) => (
          <article
            key={d.id}
            className="card-premium"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "14px",
              padding: "1.25rem 1.5rem",
              boxShadow: "0 4px 15px rgba(0,0,0,0.02)"
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <div style={{ flex: 1, marginRight: "1rem" }}>
                <h5 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.92rem", color: "var(--forest-dark)", margin: 0 }}>
                  {d.recommendation.length > 120 ? d.recommendation.slice(0, 120) + "…" : d.recommendation}
                </h5>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
                <span style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "10px",
                  background: "rgba(139, 92, 246, 0.12)",
                  color: "#7c3aed"
                }}>
                  {d.sourceType}
                </span>
                {d.outcome && (
                  <span style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: d.outcome === "helpful" || d.outcome === "accepted"
                      ? "rgba(16, 185, 129, 0.15)"
                      : d.outcome === "not_helpful" || d.outcome === "rejected"
                        ? "rgba(239, 68, 68, 0.12)"
                        : "rgba(245, 158, 11, 0.12)",
                    color: d.outcome === "helpful" || d.outcome === "accepted"
                      ? "#047857"
                      : d.outcome === "not_helpful" || d.outcome === "rejected"
                        ? "#b91c1c"
                        : "#b45309"
                  }}>
                    {d.outcome.replace("_", " ")}
                  </span>
                )}
              </div>
            </div>

            {/* Reasoning */}
            <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0 0 0.75rem 0", lineHeight: "1.55" }}>
              {d.reasoning}
            </p>

            {/* Footer: date + actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.75rem", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                {new Date(d.createdAt).toLocaleDateString()} · {new Date(d.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>

              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  onClick={() => outcomeMutation.mutate({ id: d.id, outcome: "helpful" })}
                  disabled={outcomeMutation.isPending || d.outcome === "helpful"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: d.outcome === "helpful" ? "1.5px solid #047857" : "1px solid var(--line)",
                    background: d.outcome === "helpful" ? "rgba(16, 185, 129, 0.12)" : "white",
                    color: d.outcome === "helpful" ? "#047857" : "var(--forest-dark)",
                    cursor: d.outcome === "helpful" ? "default" : "pointer"
                  }}
                >
                  <ThumbsUp size={12} /> Helpful
                </button>
                <button
                  onClick={() => outcomeMutation.mutate({ id: d.id, outcome: "not_helpful" })}
                  disabled={outcomeMutation.isPending || d.outcome === "not_helpful"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: d.outcome === "not_helpful" ? "1.5px solid #b91c1c" : "1px solid var(--line)",
                    background: d.outcome === "not_helpful" ? "rgba(239, 68, 68, 0.10)" : "white",
                    color: d.outcome === "not_helpful" ? "#b91c1c" : "var(--forest-dark)",
                    cursor: d.outcome === "not_helpful" ? "default" : "pointer"
                  }}
                >
                  <ThumbsDown size={12} /> Not Helpful
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
