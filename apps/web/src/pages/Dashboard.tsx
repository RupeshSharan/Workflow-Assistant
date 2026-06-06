import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  SlidersHorizontal,
  LayoutDashboard,
  Plus,
  FileText,
  Bot,
  Workflow as WorkflowIcon,
  BarChart2,
  ChevronRight
} from "lucide-react";
import { api } from "../api";
import type { Session, WorkItem } from "../types";
import { CreateItemForm } from "../components/dashboard/CreateItemForm";
import { BoardColumn } from "../components/dashboard/BoardColumn";
import { WorkItemPanel } from "../components/work-items/WorkItemPanel";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { EmptyState } from "../components/common/EmptyState";

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [myWorkTab, setMyWorkTab] = useState<"assigned" | "today" | "overdue">("assigned");

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
  const visibleItems = allItems.filter(
    (item) => !selectedWorkflow || item.templateId === selectedWorkflow.id
  );

  const activeCount = summary.data?.metrics.total ?? 0;
  const overdueCount = summary.data?.metrics.overdue ?? 0;

  // Filter My Work list items
  const myWorkItems = allItems.filter((item) => {
    const isAssigned = item.assigneeName === session.user.name;
    if (myWorkTab === "assigned") return isAssigned;
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

  const createMutation = useMutation({
    mutationFn: (input: { title: string; description: string; priority: WorkItem["priority"] }) =>
      api.createItem(session, { ...input, templateId: selectedWorkflow?.id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["audit-logs", session.activeWorkspaceId] });
    }
  });

  const transitionMutation = useMutation({
    mutationFn: ({ itemId, stageId }: { itemId: string; stageId: string }) =>
      api.transitionItem(session, itemId, stageId),
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

  if (workflows.isLoading || workItems.isLoading) {
    return <LoadingSpinner message="Assembling custom dashboard..." />;
  }

  const topSuggestion = adaptiveInsights.data?.suggestions?.[0];

  return (
    <section className="dashboard" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      {/* 1. Welcome Section Banner */}
      <div className="welcome-banner">
        <div>
          <h2>Good Morning, {session.user.name.split(" ")[0]} 👋</h2>
          <p>Here is what is happening across FlowAI workspaces today.</p>
        </div>
        <div className="welcome-stats">
          <div className="welcome-stat-pill">
            <strong>{activeCount}</strong>
            <span>Active Items</span>
          </div>
          <div className="welcome-stat-pill" style={{ borderColor: overdueCount > 0 ? "rgba(239, 68, 68, 0.4)" : "rgba(255,255,255,0.12)" }}>
            <strong style={{ color: overdueCount > 0 ? "var(--status-red)" : "white" }}>{overdueCount}</strong>
            <span>Overdue Items</span>
          </div>
          <div className="welcome-stat-pill">
            <strong>{topSuggestion ? "1" : "0"}</strong>
            <span>AI Suggestion</span>
          </div>
        </div>
      </div>

      {/* 2. Quick Actions Bar */}
      <div className="quick-actions-bar">
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

      {/* 3. Smart Insights AI recommendation banner */}
      {topSuggestion && (
        <div className="smart-insights-ticker">
          <div className="insight-icon">💡</div>
          <div className="insight-text">
            <strong>AI Recommendation:</strong> {topSuggestion.suggestion}{" "}
            {topSuggestion.expectedImpact && (
              <span style={{ fontStyle: "italic", opacity: 0.85 }}>({topSuggestion.expectedImpact})</span>
            )}
          </div>
          <button className="insight-action-btn" onClick={() => navigate("/analytics")}>
            Optimize Flow
          </button>
        </div>
      )}

      {/* 4. Multi-column High-Density Widgets */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
        
        {/* Left Side: My Work Tabbed Section */}
        <div className="my-work-container">
          <header className="my-work-header">
            <h4 className="my-work-title">My Assigned Work</h4>
            <div className="my-work-tabs">
              <button
                className={`my-work-tab-btn ${myWorkTab === "assigned" ? "active" : ""}`}
                onClick={() => setMyWorkTab("assigned")}
              >
                Assigned
              </button>
              <button
                className={`my-work-tab-btn ${myWorkTab === "today" ? "active" : ""}`}
                onClick={() => setMyWorkTab("today")}
              >
                Due Today
              </button>
              <button
                className={`my-work-tab-btn ${myWorkTab === "overdue" ? "active" : ""}`}
                onClick={() => setMyWorkTab("overdue")}
              >
                Overdue
              </button>
            </div>
          </header>

          <div className="my-work-list">
            {myWorkItems.length === 0 ? (
              <p className="muted-message" style={{ textAlign: "center", padding: "1.5rem 0" }}>
                No items match this filter in this workspace.
              </p>
            ) : (
              myWorkItems.map((item) => (
                <article key={item.id} className="my-work-item">
                  <div className="my-work-item-info">
                    <span className="my-work-item-title">{item.title}</span>
                    <div className="my-work-item-meta">
                      <span className={`my-work-item-pill ${item.priority}`}>{item.priority}</span>
                      <span>Stage: {item.stageName}</span>
                      {item.dueDate && (
                        <span>Due: {new Date(item.dueDate).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="my-work-item-actions">
                    <button
                      className="secondary"
                      style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto", margin: 0 }}
                      onClick={() => setSelectedItem(item)}
                    >
                      Open
                    </button>
                    <button
                      className="primary"
                      style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto", margin: 0, gap: "2px" }}
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

        {/* Right Side: Team Activity Feed */}
        <div className="activity-feed-card">
          <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1.1rem" }}>Team activity</h4>
          <div className="activity-list">
            {auditLogs.data?.logs.slice(0, 5).map((log) => (
              <div key={log.id} className="activity-row">
                <span className="dot" />
                <div>
                  <strong>{log.actorName || "User"}</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {log.action.replace("work_item.", "updated task ").replace("document.", "added document ")}
                  </span>
                  <small style={{ display: "block", color: "var(--muted)", fontSize: "0.7rem", marginTop: "2px" }}>
                    Entity: {((log.payload as any)?.title || (log.payload as any)?.name || "item")}
                  </small>
                </div>
                <span className="time">{new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )) ?? <p className="muted-message">No recent activity logs.</p>}
          </div>
        </div>
      </div>

      {/* 5. Traditional Kanban Board System with Selector */}
      <div className="board-header" style={{ marginTop: "2rem" }}>
        <div>
          <p className="eyebrow">Work board</p>
          <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 700 }}>Configurable delivery flow</h3>
        </div>
        <div className="board-controls">
          <SlidersHorizontal size={16} />
          {allWorkflows.length > 0 && (
            <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
              {allWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {allWorkflows.length === 0 ? (
        <EmptyState
          title="No Active Workflows"
          message="Define workflow stages and categories to build a Kanban board for your workspace."
          icon={<LayoutDashboard size={40} />}
        />
      ) : (
        <>
          <CreateItemForm onSubmit={(input) => createMutation.mutate(input)} pending={createMutation.isPending} />
          {createMutation.error && <p className="form-error">{createMutation.error.message}</p>}

          <div className="board" style={{ marginTop: "1rem" }}>
            {selectedWorkflow?.stages.map((stage, index) => (
              <BoardColumn
                key={stage.id}
                stage={stage}
                items={visibleItems.filter((item) => item.stageId === stage.id)}
                nextStage={selectedWorkflow.stages[index + 1]}
                onAdvance={(itemId, stageId) => transitionMutation.mutate({ itemId, stageId })}
                onOpen={setSelectedItem}
              />
            ))}
          </div>
        </>
      )}

      {selectedItem && (
        <WorkItemPanel item={selectedItem} session={session} onClose={() => setSelectedItem(null)} />
      )}
    </section>
  );
}
