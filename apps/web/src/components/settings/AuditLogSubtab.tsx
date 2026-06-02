import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { LoadingSpinner } from "../common/LoadingSpinner";
import type { Session } from "../../types";

interface AuditLogSubtabProps {
  session: Session;
}

function formatAction(action: string): string {
  switch (action) {
    case "work_item.created":
      return "created a work item";
    case "work_item.updated":
      return "updated a work item";
    case "work_item.transitioned":
      return "moved a work item";
    case "document.created":
      return "uploaded a knowledge document";
    case "org.member_role_updated":
      return "updated a member's role";
    case "org.member_removed":
      return "removed a member from the organization";
    default:
      return action.replace(/[._]/g, " ");
  }
}

export function AuditLogSubtab({ session }: AuditLogSubtabProps) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["audit-logs", session.activeWorkspaceId],
    queryFn: () => api.auditLogs(session)
  });

  const logs = data?.logs ?? [];

  return (
    <article className="settings-card full-width-card" style={{ gridColumn: "1 / -1" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ShieldAlert size={18} />
          <div>
            <h4>Organization Activity & Audit Log</h4>
            <p>Trace administrative actions and item state changes across the organization</p>
          </div>
        </div>
        <button
          className="secondary"
          onClick={() => void refetch()}
          disabled={isLoading || isRefetching}
          style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0, padding: "6px 12px", height: "auto" }}
        >
          <RefreshCw size={14} className={isRefetching ? "spin" : ""} />
          Refresh
        </button>
      </header>

      <div className="audit-timeline" style={{ marginTop: "1.5rem" }}>
        {isLoading ? (
          <LoadingSpinner message="Retrieving security audit logs..." />
        ) : logs.length === 0 ? (
          <p className="muted-message" style={{ padding: "2rem 0", textAlign: "center" }}>
            No administrative activities recorded in this organization yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {logs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.95rem" }}>
                    <strong style={{ color: "white" }}>{log.actorName || "Unknown user"}</strong>{" "}
                    <span style={{ color: "rgba(255,255,255,0.7)" }}>{formatAction(log.action)}</span>
                  </p>
                  <small style={{ color: "rgba(255,255,255,0.4)" }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </small>
                </div>
                
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>
                  {log.workspaceName && (
                    <span>
                      Workspace: <strong>{log.workspaceName}</strong>
                    </span>
                  )}
                  <span>
                    Entity ID: <code style={{ background: "rgba(0,0,0,0.2)", padding: "1px 4px", borderRadius: "3px" }}>{log.entityId}</code>
                  </span>
                </div>

                {log.payload && Object.keys(log.payload).length > 0 && (
                  <pre
                    style={{
                      margin: "0.5rem 0 0 0",
                      padding: "0.5rem",
                      background: "rgba(0, 0, 0, 0.2)",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      overflowX: "auto",
                      color: "rgba(255,255,255,0.8)",
                      borderLeft: "2px solid rgba(255, 255, 255, 0.15)"
                    }}
                  >
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
