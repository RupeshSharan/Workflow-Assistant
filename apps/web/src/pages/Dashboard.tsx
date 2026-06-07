import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  FileText,
  Bot,
  Workflow as WorkflowIcon,
  BarChart2,
  ChevronRight,
  Sparkles,
  Clock,
  TrendingUp,
  CheckCircle
} from "lucide-react";
import { api } from "../api";
import type { Session, WorkItem } from "../types";
import { WorkItemPanel } from "../components/work-items/WorkItemPanel";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [myWorkTab, setMyWorkTab] = useState<"assigned" | "today" | "overdue" | "updated">("assigned");

  const summary = useQuery({
    queryKey: ["summary", session.activeWorkspaceId],
    queryFn: () => api.summary(session)
  });
  
  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
  });
  
  const workItems = useQuery({
    queryKey: ["work-items", session.activeWorkspaceId],
    queryFn: () => api.workItems(session)
  });

  const auditLogs = useQuery({
    queryKey: ["audit-logs", session.activeWorkspaceId],
    queryFn: () => api.auditLogs(session)
  });

  const adaptiveInsights = useQuery({
    queryKey: ["adaptive-insights", session.activeWorkspaceId],
    queryFn: () => api.adaptiveInsights(session)
  });

  const allWorkflows = workflows.data?.workflows ?? [];
  useEffect(() => {
    if (!allWorkflows.length) return;
    if (!allWorkflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(allWorkflows.find((workflow) => workflow.isDefault)?.id ?? allWorkflows[0]!.id);
    }
  }, [allWorkflows, selectedWorkflowId]);

  const selectedWorkflow = allWorkflows.find((workflow) => workflow.id === selectedWorkflowId);
  const allItems = workItems.data?.items ?? [];

  const activeCount = summary.data?.metrics.total ?? 0;
  const overdueCount = summary.data?.metrics.overdue ?? 0;

  // Filter My Work list items
  let myWorkItems = allItems.filter((item) => {
    const isAssigned = item.assigneeName === session.user.name;
    if (myWorkTab === "assigned" || myWorkTab === "updated") return isAssigned;
    if (myWorkTab === "overdue") {
      return isAssigned && item.dueDate && new Date(item.dueDate) < new Date() && !item.stageTerminal;
    }
    if (myWorkTab === "today") {
      if (!isAssigned || !item.dueDate) return false;
      const todayStr = new Date().toDateString();
      return new Date(item.dueDate).toDateString() === todayStr;
    }
    return false;
  });

  if (myWorkTab === "updated") {
    // Sort or slice to simulate recently updated
    myWorkItems = [...myWorkItems].slice(0, 3);
  }

  const createMutation = useMutation({
    mutationFn: (input: { title: string; description: string; priority: WorkItem["priority"] }) =>
      api.createItem(session, { ...input, templateId: selectedWorkflow?.id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["audit-logs", session.activeWorkspaceId] });
    }
  });



  const generateReportMutation = useMutation({
    mutationFn: () => api.generateWorkspaceReport(session),
    onSuccess: () => {
      alert("Workspace performance report compiled and indexed successfully!");
      navigate("/documents");
    }
  });

  const activeWorkspace = session.workspaces.find((w) => w.id === session.activeWorkspaceId);
  const workspaceName = activeWorkspace ? `${activeWorkspace.orgName} / ${activeWorkspace.name}` : "FlowAI Workspace";

  if (workflows.isLoading || workItems.isLoading) {
    return <LoadingSpinner message="Assembling custom dashboard..." />;
  }

  const topSuggestion = adaptiveInsights.data?.suggestions?.[0];

  return (
    <section className="dashboard" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)", background: "var(--surface-muted)" }}>
      {/* 1. Large Hero Section Panel */}
      <div className="welcome-banner card-premium" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "2rem", padding: "2.25rem", marginBottom: "2rem", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span className="eyebrow" style={{ margin: 0 }}>Active Workspace</span>
            <span style={{ fontSize: "0.8rem", padding: "2px 8px", background: "var(--mint)", color: "var(--forest-dark)", borderRadius: "12px", fontWeight: 700 }}>
              {workspaceName}
            </span>
          </div>
          <h2 style={{ fontSize: "2rem", fontWeight: 800, color: "var(--forest-dark)", fontFamily: "var(--font-premium)", letterSpacing: "-0.03em" }}>
            Good Morning, {session.user.name.split(" ")[0]} 👋
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "0.95rem", margin: 0 }}>
            <strong>Current Goal:</strong> Overhaul FlowAI 2.0 interface and verify workspace memory context alignment.
          </p>
          <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Active Tasks</span>
              <strong style={{ fontSize: "1.4rem", color: "var(--forest-dark)" }}>{activeCount}</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>Overdue</span>
              <strong style={{ fontSize: "1.4rem", color: overdueCount > 0 ? "var(--status-red)" : "var(--forest-dark)" }}>{overdueCount}</strong>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>AI Suggestions</span>
              <strong style={{ fontSize: "1.4rem", color: "var(--green)" }}>{topSuggestion ? "1" : "0"}</strong>
            </div>
          </div>
          <div style={{ marginTop: "1rem" }}>
            <button className="primary" style={{ padding: "0.55rem 1.15rem", gap: "0.5rem" }} onClick={() => navigate("/ai")}>
              <Sparkles size={14} /> Run AI Optimization Scan
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifySelf: "end", alignItems: "end", gap: "0.75rem" }}>
          <span style={{ fontSize: "0.72rem", padding: "4px 8px", background: "rgba(34, 197, 94, 0.15)", color: "#166534", borderRadius: "8px", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
            <TrendingUp size={12} /> AI Status: Optimal Flow
          </span>
          <div style={{ background: "rgba(0,0,0,0.02)", padding: "10px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <svg width="180" height="70" viewBox="0 0 180 70">
              <defs>
                <linearGradient id="sparklineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.3" />
                  <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M 0 55 Q 30 25 60 40 T 120 15 T 160 30 L 180 10 L 180 70 L 0 70 Z" fill="url(#sparklineGrad)" />
              <path d="M 0 55 Q 30 25 60 40 T 120 15 T 160 30 L 180 10" fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="180" cy="10" r="4" fill="var(--green)" />
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--muted)", marginTop: "4px" }}>
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri (94% velocity)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Quick Actions Bar */}
      <div className="quick-actions-bar" style={{ marginBottom: "2rem" }}>
        <button className="quick-action-btn" onClick={() => {
          const title = prompt("Enter task title:");
          if (title) createMutation.mutate({ title, description: "", priority: "medium" });
        }}>
          <Plus size={16} /> Create Task
        </button>
        <button className="quick-action-btn" onClick={() => navigate("/documents")}>
          <FileText size={16} /> Upload Document
        </button>
        <button className="quick-action-btn" onClick={() => navigate("/ai")}>
          <Bot size={16} /> Ask AI Assistant
        </button>
        <button className="quick-action-btn" onClick={() => navigate("/workflows")}>
          <WorkflowIcon size={16} /> Create Workflow
        </button>
        <button className="quick-action-btn" onClick={() => generateReportMutation.mutate()} disabled={generateReportMutation.isPending}>
          <BarChart2 size={16} /> {generateReportMutation.isPending ? "Generating..." : "Generate Report"}
        </button>
      </div>

      {/* 3. Multi-column High-Density Widgets Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
        
        {/* Left Widget: My Work (assigned tasks) */}
        <div className="my-work-container card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
          <header className="my-work-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h4 className="my-work-title" style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CheckCircle size={18} className="text-green-600" /> My Assigned Work
            </h4>
            <div className="my-work-tabs" style={{ display: "flex", gap: "4px", background: "var(--surface-muted)", padding: "2px", borderRadius: "8px" }}>
              {(["assigned", "today", "overdue", "updated"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`my-work-tab-btn ${myWorkTab === tab ? "active" : ""}`}
                  onClick={() => setMyWorkTab(tab)}
                  style={{
                    padding: "4px 8px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    borderRadius: "6px",
                    textTransform: "capitalize",
                    background: myWorkTab === tab ? "white" : "transparent",
                    color: myWorkTab === tab ? "var(--forest-dark)" : "var(--muted)",
                    boxShadow: myWorkTab === tab ? "0 1px 3px rgba(0,0,0,0.05)" : "none"
                  }}
                >
                  {tab === "assigned" ? "Assigned" : tab === "today" ? "Due Today" : tab === "overdue" ? "Overdue" : "Recent"}
                </button>
              ))}
            </div>
          </header>

          <div className="my-work-list" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {myWorkItems.length === 0 ? (
              <p className="muted-message" style={{ textAlign: "center", padding: "2rem 0" }}>
                No items match this filter in this workspace.
              </p>
            ) : (
              myWorkItems.map((item) => (
                <article key={item.id} className="my-work-item card-premium" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.9rem", border: "1px solid var(--line)", borderRadius: "10px" }}>
                  <div className="my-work-item-info">
                    <span className="my-work-item-title" style={{ fontWeight: 600, color: "var(--forest-dark)", fontSize: "0.88rem" }}>{item.title}</span>
                    <div className="my-work-item-meta" style={{ display: "flex", gap: "0.75rem", fontSize: "0.72rem", color: "var(--muted)", marginTop: "4px" }}>
                      <span className={`priority ${item.priority}`}>{item.priority}</span>
                      <span>Stage: {item.stageName}</span>
                      {item.dueDate && (
                        <span>Due: {new Date(item.dueDate).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="my-work-item-actions" style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className="secondary"
                      style={{ padding: "4px 8px", fontSize: "0.75rem", height: "auto", margin: 0 }}
                      onClick={() => setSelectedItem(item)}
                    >
                      Open
                    </button>
                    <button
                      className="primary"
                      style={{ padding: "4px 8px", fontSize: "0.75rem", height: "auto", margin: 0, gap: "2px" }}
                      onClick={() => navigate("/ai", { state: { prefill: `advance status of task "${item.title}"` } })}
                    >
                      Ask AI <ChevronRight size={12} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Stack of Team Activity & AI Recommendations */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* AI Recommendations */}
          <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <Sparkles size={18} className="text-purple-600" /> AI Recommendations
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ borderLeft: "3px solid #a855f7", paddingLeft: "0.75rem" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 700, color: "var(--forest-dark)" }}>
                  Bottleneck Alert in "Review" stage
                </p>
                <p style={{ margin: "2px 0 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                  Items exceed SLA limit of 24h. AI suggests reassigning 2 tickets to balance workload.
                </p>
              </div>
              <div style={{ borderLeft: "3px solid #eab308", paddingLeft: "0.75rem" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 700, color: "var(--forest-dark)" }}>
                  Overdue Risk Assessment
                </p>
                <p style={{ margin: "2px 0 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                  Task "Database Migrations" has 95% delay risk based on historical velocity.
                </p>
              </div>
              {topSuggestion && (
                <div style={{ borderLeft: "3px solid var(--green)", paddingLeft: "0.75rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 700, color: "var(--forest-dark)" }}>
                    Rule Optimization
                  </p>
                  <p style={{ margin: "2px 0 0 0", fontSize: "0.72rem", color: "var(--muted)" }}>
                    {topSuggestion.suggestion}
                  </p>
                </div>
              )}
              <button
                className="primary full"
                onClick={() => navigate("/analytics")}
                style={{ padding: "0.5rem 1rem", fontSize: "0.8rem", borderRadius: "8px", marginTop: "0.5rem" }}
              >
                Auto-Optimize Delivery Flow
              </button>
            </div>
          </div>

          {/* Team Activity Feed */}
          <div className="activity-feed-card card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <Clock size={18} className="text-blue-600" /> Team Activity Feed
            </h4>
            <div className="activity-list" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {auditLogs.data?.logs.slice(0, 4).map((log) => (
                <div key={log.id} className="activity-row" style={{ display: "flex", gap: "0.75rem", alignItems: "start", fontSize: "0.8rem" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: "var(--mint)",
                      color: "var(--forest-dark)",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.7rem",
                      marginTop: "2px"
                    }}
                  >
                    {log.actorName?.slice(0, 1) || "U"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, color: "var(--forest-dark)" }}>
                      <strong>{log.actorName || "User"}</strong>{" "}
                      <span style={{ color: "var(--muted)" }}>
                        {log.action.replace("work_item.", "updated task ").replace("document.", "added document ")}
                      </span>
                    </p>
                    <small style={{ color: "var(--muted)", fontSize: "0.7rem", display: "block", marginTop: "2px" }}>
                      Entity: {((log.payload as any)?.title || (log.payload as any)?.name || "item")}
                    </small>
                  </div>
                  <span className="time" style={{ color: "var(--muted)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )) ?? <p className="muted-message">No recent activity logs.</p>}
            </div>
          </div>

        </div>
      </div>

      {/* 4. Today's Schedule Timeline Strip */}
      <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)", marginTop: "2rem" }}>
        <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <Clock size={18} className="text-indigo-600" /> Today's Schedule Strip
        </h4>
        <div style={{ position: "relative", padding: "1rem 0" }}>
          {/* Time axis */}
          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600 }}>
            <span>9:00 AM</span>
            <span>10:00 AM</span>
            <span>11:00 AM</span>
            <span>12:00 PM</span>
            <span>1:00 PM</span>
            <span>2:00 PM</span>
            <span>3:00 PM</span>
            <span>4:00 PM</span>
            <span>5:00 PM</span>
          </div>
          {/* Blocks container */}
          <div style={{ position: "relative", height: "45px", marginTop: "0.75rem" }}>
            {/* Standup */}
            <div
              style={{
                position: "absolute",
                left: "12.5%",
                width: "6.25%",
                height: "30px",
                background: "rgba(139, 92, 246, 0.15)",
                borderLeft: "4px solid #8b5cf6",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#6d28d9",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
              title="Daily Standup Meeting"
            >
              Standup
            </div>

            {/* Core Redesign Review */}
            <div
              style={{
                position: "absolute",
                left: "31.25%",
                width: "12.5%",
                height: "30px",
                background: "rgba(34, 197, 94, 0.15)",
                borderLeft: "4px solid var(--green)",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#166534",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
              title="Sprint Redesign review session"
            >
              Redesign Review
            </div>

            {/* Code Sync */}
            <div
              style={{
                position: "absolute",
                left: "68.75%",
                width: "12.5%",
                height: "30px",
                background: "rgba(59, 130, 246, 0.15)",
                borderLeft: "4px solid #3b82f6",
                borderRadius: "4px",
                padding: "2px 6px",
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#1d4ed8",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
              title="Code Refinement Sync"
            >
              Code Refinement
            </div>
          </div>
        </div>
      </div>

      {selectedItem && (
        <WorkItemPanel item={selectedItem} session={session} onClose={() => setSelectedItem(null)} />
      )}
    </section>
  );
}
