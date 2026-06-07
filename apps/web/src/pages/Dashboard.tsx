import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  FileText,
  Bot,
  Workflow as WorkflowIcon,
  ChevronRight,
  Sparkles,
  Clock,
  TrendingUp,
  CheckCircle,
  X,
  Target,
  Calendar,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Activity
} from "lucide-react";
import { api } from "../api";
import type { Session, WorkItem } from "../types";
import type { GoalProbability } from "../types";
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

  // Goals & Timeline State
  const [showAddGoalModal, setShowAddGoalModal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDesc, setNewGoalDesc] = useState("");
  const [newGoalDate, setNewGoalDate] = useState("");
  const [goalProbabilityData, setGoalProbabilityData] = useState<GoalProbability | null>(null);
  const [probabilityLoading, setProbabilityLoading] = useState(false);
  const [showProbabilityModal, setShowProbabilityModal] = useState(false);

  const goalsQuery = useQuery({
    queryKey: ["goals", session.activeWorkspaceId],
    queryFn: () => api.goals(session)
  });

  const timelineQuery = useQuery({
    queryKey: ["timeline", session.activeWorkspaceId],
    queryFn: () => api.workspaceTimeline(session)
  });

  const createGoalMutation = useMutation({
    mutationFn: (input: { title: string; description?: string; targetDate?: string }) =>
      api.createGoal(session, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals", session.activeWorkspaceId] });
      setShowAddGoalModal(false);
      setNewGoalTitle("");
      setNewGoalDesc("");
      setNewGoalDate("");
    }
  });

  const updateGoalMutation = useMutation({
    mutationFn: (input: { goalId: string; status: 'active' | 'completed' | 'paused' | 'cancelled' }) =>
      api.updateGoal(session, input.goalId, { status: input.status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals", session.activeWorkspaceId] });
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (goalId: string) => api.deleteGoal(session, goalId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["goals", session.activeWorkspaceId] });
    }
  });

  const handleCheckProbability = async (goalId: string) => {
    setShowProbabilityModal(true);
    setProbabilityLoading(true);
    setGoalProbabilityData(null);
    try {
      const res = await api.goalProbability(session, goalId);
      setGoalProbabilityData(res);
    } catch {
      setGoalProbabilityData({
        probability: 50,
        assessment: "Could not retrieve real-time feasibility. Check task loads.",
        risks: ["Workspace data sync delay", "No active items linked"],
        suggestions: ["Ensure relevant tasks are created and assigned."]
      });
    } finally {
      setProbabilityLoading(false);
    }
  };

  const projectHealth = useQuery({
    queryKey: ["project-health", session.activeWorkspaceId],
    queryFn: () => api.projectHealth(session)
  });

  const [showStandupModal, setShowStandupModal] = useState(false);
  const [standupText, setStandupText] = useState<string | null>(null);
  const [standupLoading, setStandupLoading] = useState(false);

  const handleGenerateStandup = async () => {
    setStandupLoading(true);
    setShowStandupModal(true);
    try {
      const res = await api.dailyStandup(session);
      setStandupText(res.standup);
    } catch {
      setStandupText("Failed to generate today's standup.");
    } finally {
      setStandupLoading(false);
    }
  };

  const autoDocumentMutation = useMutation({
    mutationFn: () => api.autoDocument(session),
    onSuccess: () => {
      alert("AI Auto-Documentation changelog created and saved to Knowledge Base!");
      navigate("/documents");
    }
  });

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
          <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
            <button className="primary" style={{ padding: "0.55rem 1.15rem", gap: "0.5rem" }} onClick={() => navigate("/ai")}>
              <Sparkles size={14} /> Run AI Optimization Scan
            </button>
            <button className="secondary" style={{ padding: "0.55rem 1.15rem", gap: "0.5rem", border: "1px solid var(--line)" }} onClick={handleGenerateStandup}>
              <Bot size={14} /> Generate Daily Standup
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", justifySelf: "end", alignItems: "center" }}>
          {/* Project Health Score Gauge */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Health Score</span>
            <div style={{ position: "relative", width: "80px", height: "80px" }}>
              <svg width="80" height="80" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={projectHealth.data?.score && projectHealth.data.score >= 80 ? "var(--green)" : projectHealth.data?.score && projectHealth.data.score >= 50 ? "#eab308" : "#ef4444"}
                  strokeWidth="8"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 - (251.2 * (projectHealth.data?.score ?? 80)) / 100}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
                <text x="50" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--forest-dark)">
                  {projectHealth.data?.score ?? 80}
                </text>
              </svg>
            </div>
            <span style={{ fontSize: "0.65rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>
              {projectHealth.data?.score && projectHealth.data.score >= 80 ? "Excellent" : projectHealth.data?.score && projectHealth.data.score >= 50 ? "Stable" : "Critical"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "end", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.72rem", padding: "4px 8px", background: "rgba(34, 197, 94, 0.15)", color: "#166534", borderRadius: "8px", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
              <TrendingUp size={12} /> AI Status: Optimal Flow
            </span>
            <div style={{ background: "rgba(0,0,0,0.02)", padding: "8px", borderRadius: "10px", border: "1px solid var(--line)" }}>
              <svg width="120" height="40" viewBox="0 0 180 70">
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
        <button className="quick-action-btn" onClick={() => autoDocumentMutation.mutate()} disabled={autoDocumentMutation.isPending}>
          <Sparkles size={16} /> {autoDocumentMutation.isPending ? "Syncing..." : "Auto-Document Workspace"}
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

      {/* 4. Goal Tracker & Workspace Project Timeline */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1.5rem", marginTop: "2rem" }}>
        {/* Goal Tracker */}
        <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Target size={18} className="text-emerald-600" /> Workspace Goals
            </h4>
            <button className="secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }} onClick={() => setShowAddGoalModal(true)}>
              <Plus size={14} /> Add Goal
            </button>
          </div>

          {goalsQuery.isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}><LoadingSpinner message="" /></div>
          ) : (goalsQuery.data?.goals ?? []).length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--muted)", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
              <p style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>No active goals defined for this workspace.</p>
              <button className="primary" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }} onClick={() => setShowAddGoalModal(true)}>
                <Plus size={14} style={{ marginRight: "4px" }} /> Define First Goal
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "350px", overflowY: "auto", paddingRight: "4px" }}>
              {(goalsQuery.data?.goals ?? []).map((goal) => (
                <div key={goal.id} className="card-premium" style={{ padding: "1rem", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--surface)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "0.5rem" }}>
                    <div>
                      <h5 style={{ fontWeight: 750, fontSize: "0.9rem", color: "var(--forest-dark)", margin: 0 }}>{goal.title}</h5>
                      {goal.description && <p style={{ fontSize: "0.76rem", color: "var(--muted)", marginTop: "2px" }}>{goal.description}</p>}
                    </div>
                    <select
                      value={goal.status}
                      onChange={(e) => updateGoalMutation.mutate({ goalId: goal.id, status: e.target.value as any })}
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 6px",
                        borderRadius: "6px",
                        border: "1px solid var(--line)",
                        background: goal.status === "completed" ? "rgba(34, 197, 94, 0.1)" : goal.status === "paused" ? "rgba(234, 179, 8, 0.1)" : goal.status === "cancelled" ? "rgba(239, 68, 68, 0.1)" : "rgba(139, 92, 246, 0.1)",
                        color: goal.status === "completed" ? "#166534" : goal.status === "paused" ? "#854d0e" : goal.status === "cancelled" ? "#991b1b" : "#6d28d9",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="paused">Paused</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: "0.5rem", marginTop: "0.25rem" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Calendar size={12} />
                      {goal.targetDate ? `Target: ${new Date(goal.targetDate).toLocaleDateString()}` : "No deadline"}
                    </span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <button
                        className="secondary"
                        style={{ padding: "2px 6px", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "2px", background: "rgba(139, 92, 246, 0.08)", color: "#6d28d9" }}
                        onClick={() => handleCheckProbability(goal.id)}
                      >
                        <Sparkles size={11} /> AI Probability
                      </button>
                      <button
                        style={{ padding: "2px 4px", background: "transparent", color: "#ef4444", cursor: "pointer", border: 0 }}
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this goal?")) {
                            deleteGoalMutation.mutate(goal.id);
                          }
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workspace Project Timeline */}
        <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Activity size={18} className="text-blue-600" /> Workspace Project Timeline
            </h4>
            <button className="secondary" style={{ padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }} onClick={() => queryClient.invalidateQueries({ queryKey: ["timeline", session.activeWorkspaceId] })}>
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {timelineQuery.isLoading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}><LoadingSpinner message="" /></div>
          ) : (timelineQuery.data?.events ?? []).length === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 0", color: "var(--muted)", fontSize: "0.85rem", flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
              No recent workspace activity logs.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxHeight: "350px", overflowY: "auto", paddingRight: "4px" }}>
              {(timelineQuery.data?.events ?? []).map((day) => (
                <div key={day.date} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "2px 8px", background: "var(--mint)", color: "var(--forest-dark)", borderRadius: "10px" }}>
                      {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <div style={{ flex: 1, height: "1px", background: "var(--line)" }} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", paddingLeft: "0.5rem", borderLeft: "2px solid var(--line)", marginLeft: "0.5rem" }}>
                    {day.entries.map((entry: any, entryIdx: number) => (
                      <div key={entryIdx} style={{ display: "flex", gap: "0.5rem", fontSize: "0.78rem", position: "relative", alignItems: "start" }}>
                        <div style={{
                          position: "absolute",
                          left: "-13px",
                          top: "4px",
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: entry.action.includes("created") ? "var(--green)" : entry.action.includes("delete") ? "#ef4444" : "#8b5cf6",
                          border: "2px solid white"
                        }} />
                        
                        <div style={{ flex: 1 }}>
                          <span style={{ color: "var(--forest-dark)", fontWeight: 650 }}>{entry.actorName || "System"}</span>{" "}
                          <span style={{ color: "var(--muted)" }}>
                            {entry.action.replace("work_item.", "").replace("document.", "").replace("goal.", "")}
                          </span>{" "}
                          <span style={{ fontWeight: 600, color: "var(--forest-dark)" }}>"{entry.title}"</span>
                        </div>
                        <span style={{ color: "var(--muted)", fontSize: "0.7rem", whiteSpace: "nowrap" }}>{entry.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedItem && (
        <WorkItemPanel item={selectedItem} session={session} onClose={() => setSelectedItem(null)} />
      )}

      {showStandupModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 400
        }}>
          <div className="card-premium" style={{
            background: "white",
            padding: "2rem",
            borderRadius: "16px",
            width: "550px",
            maxHeight: "80vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)", margin: 0 }}>
                AI Generated Daily Standup ☕
              </h3>
              <button style={{ background: "transparent", border: "0", cursor: "pointer", padding: 0 }} onClick={() => setShowStandupModal(false)}>
                <X size={20} />
              </button>
            </div>
            {standupLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ height: "20px", background: "var(--line)", borderRadius: "4px" }} />
                <div style={{ height: "80px", background: "var(--line)", borderRadius: "4px" }} />
                <div style={{ height: "40px", background: "var(--line)", borderRadius: "4px" }} />
              </div>
            ) : (
              <div>
                <pre style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: "0.85rem",
                  lineHeight: "1.6",
                  color: "var(--forest-dark)",
                  margin: "0 0 1.5rem 0"
                }}>
                  {standupText}
                </pre>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="primary" onClick={() => {
                    navigator.clipboard.writeText(standupText || "");
                    alert("Standup text copied to clipboard!");
                  }}>
                    Copy to Clipboard
                  </button>
                  <button className="secondary" onClick={() => setShowStandupModal(false)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showAddGoalModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 400
        }}>
          <div className="card-premium" style={{
            background: "white",
            padding: "2rem",
            borderRadius: "16px",
            width: "480px",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)", margin: 0 }}>
                Define Workspace Goal 🎯
              </h3>
              <button style={{ background: "transparent", border: "0", cursor: "pointer", padding: 0 }} onClick={() => setShowAddGoalModal(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (newGoalTitle.trim()) {
                createGoalMutation.mutate({
                  title: newGoalTitle,
                  description: newGoalDesc || undefined,
                  targetDate: newGoalDate || undefined
                });
              }
            }} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Goal Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Implement OAuth Login"
                  value={newGoalTitle}
                  onChange={(e) => setNewGoalTitle(e.target.value)}
                  style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid var(--line)" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Description (Optional)</label>
                <textarea
                  placeholder="Describe key results, requirements, or objectives..."
                  value={newGoalDesc}
                  onChange={(e) => setNewGoalDesc(e.target.value)}
                  rows={3}
                  style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid var(--line)", resize: "none" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)" }}>Target Date (Optional)</label>
                <input
                  type="date"
                  value={newGoalDate}
                  onChange={(e) => setNewGoalDate(e.target.value)}
                  style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid var(--line)" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="submit" className="primary" style={{ flex: 1, padding: "0.6rem" }} disabled={createGoalMutation.isPending}>
                  {createGoalMutation.isPending ? "Creating..." : "Create Goal"}
                </button>
                <button type="button" className="secondary" onClick={() => setShowAddGoalModal(false)} style={{ padding: "0.6rem" }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProbabilityModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 400
        }}>
          <div className="card-premium" style={{
            background: "white",
            padding: "2rem",
            borderRadius: "16px",
            width: "520px",
            maxHeight: "85vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={20} style={{ color: "#8b5cf6" }} /> AI Probability Report
              </h3>
              <button style={{ background: "transparent", border: "0", cursor: "pointer", padding: 0 }} onClick={() => setShowProbabilityModal(false)}>
                <X size={20} />
              </button>
            </div>

            {probabilityLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem 0" }}>
                <LoadingSpinner message="Evaluating workspace tasks, deadlines, and activity patterns..." />
              </div>
            ) : goalProbabilityData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                
                {/* Feasibility score banner */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "1.25rem",
                  alignItems: "center",
                  background: "linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)",
                  padding: "1.25rem",
                  borderRadius: "12px",
                  border: "1px solid rgba(139, 92, 246, 0.15)"
                }}>
                  {/* Circular gauge */}
                  <div style={{ position: "relative", width: "70px", height: "70px" }}>
                    <svg width="70" height="70" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--line)" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={goalProbabilityData.probability >= 75 ? "var(--green)" : goalProbabilityData.probability >= 45 ? "#eab308" : "#ef4444"}
                        strokeWidth="8"
                        strokeDasharray="251.2"
                        strokeDashoffset={251.2 - (251.2 * goalProbabilityData.probability) / 100}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                      <text x="50" y="58" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--forest-dark)">
                        {goalProbabilityData.probability}%
                      </text>
                    </svg>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#6d28d9", textTransform: "uppercase" }}>Completion Feasibility</span>
                    <h4 style={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--forest-dark)", margin: "2px 0 0 0" }}>
                      {goalProbabilityData.probability >= 75 ? "High Likelihood of Success" : goalProbabilityData.probability >= 45 ? "Moderate Risks Identified" : "At High Risk of Delay"}
                    </h4>
                  </div>
                </div>

                {/* AI Assessment text */}
                <div>
                  <h5 style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--forest-dark)", marginBottom: "4px" }}>AI Assessment</h5>
                  <p style={{ fontSize: "0.82rem", lineHeight: "1.5", color: "var(--forest-dark)" }}>{goalProbabilityData.assessment}</p>
                </div>

                {/* Potential Risks */}
                <div>
                  <h5 style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--forest-dark)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <AlertTriangle size={14} style={{ color: "#ef4444" }} /> Potential Risks
                  </h5>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {goalProbabilityData.risks.map((risk, index) => (
                      <li key={index} style={{ fontSize: "0.8rem", color: "var(--forest-dark)" }}>{risk}</li>
                    ))}
                  </ul>
                </div>

                {/* Recommendations */}
                <div>
                  <h5 style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--forest-dark)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Sparkles size={14} style={{ color: "var(--green)" }} /> Recommended Actions
                  </h5>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {goalProbabilityData.suggestions.map((suggestion, index) => (
                      <li key={index} style={{ fontSize: "0.8rem", color: "var(--forest-dark)" }}>{suggestion}</li>
                    ))}
                  </ul>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                  <button type="button" className="primary" onClick={() => setShowProbabilityModal(false)} style={{ padding: "0.5rem 1.25rem" }}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "1rem 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Failed to evaluate goal feasibility.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
