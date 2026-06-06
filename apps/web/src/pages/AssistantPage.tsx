import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Bot, ShieldCheck, Terminal, FileText } from "lucide-react";
import { api } from "../api";
import type { Session } from "../types";

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
  const [activeMode, setActiveMode] = useState<"chat" | "agent">("chat");
  const [question, setQuestion] = useState("");
  const [command, setCommand] = useState("");

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
                placeholder="Ask about workspace files (e.g., What are the deployment steps?)"
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
                <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ShieldCheck size={18} className="text-green-600" /> Answer
                  <span className="citation-badge" style={{ fontSize: "0.65rem" }}>
                    Grounded in {chatMutation.data.sources.length} sources
                  </span>
                </h4>
                <p style={{ marginTop: "0.75rem", fontSize: "0.95rem", lineHeight: "1.6", color: "var(--forest-dark)" }}>
                  {chatMutation.data.answer}
                </p>
              </div>
            )}
          </div>

          {/* Right panel: ground sources references */}
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
                <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, color: "var(--forest-dark)" }}>
                  Planned Action Execution
                </h4>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 1rem 0" }}>
                  AI Agent has drafted a transaction. Confirm parameters to execute.
                </p>

                <div className="tool-preview-drawer">
                  <div className="tool-preview-title">
                    <Terminal size={15} /> Tool Name: {previewMutation.data.action.tool}
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "#5b21b6", marginTop: "0.25rem" }}>
                    <strong>Rationale:</strong> {previewMutation.data.action.rationale}
                  </p>
                  
                  <div className="tool-preview-args">
                    {JSON.stringify(previewMutation.data.action.arguments, null, 2)}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
                  <button className="primary" onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
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

          {/* Right panel: Agent security constraints details */}
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
      )}
    </section>
  );
}
