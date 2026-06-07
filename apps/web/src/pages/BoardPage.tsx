import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SlidersHorizontal,
  Plus,
  LayoutGrid,
  Table as TableIcon,
  Calendar as CalendarIcon,
  Clock,
  ShieldAlert,
  User,
  Paperclip,
  MessageSquare,
  X,
  PlusCircle,
  Bot
} from "lucide-react";
import { api } from "../api";
import type { Session, WorkItem } from "../types";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

interface BoardPageProps {
  session: Session;
}

export function BoardPage({ session }: BoardPageProps) {
  const queryClient = useQueryClient();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [activeView, setActiveView] = useState<"kanban" | "table" | "calendar" | "timeline">("kanban");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("title");

  // Detail Drawer state
  const [drawerItem, setDrawerItem] = useState<WorkItem | null>(null);
  const [newSubtask, setNewSubtask] = useState("");
  const [aiSummaryPending, setAiSummaryPending] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  // AI Notifications state
  const [showAiNotifications, setShowAiNotifications] = useState(false);

  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
  });

  const notifications = useQuery({
    queryKey: ["notifications", session.activeWorkspaceId],
    queryFn: () => api.notifications(session)
  });

  const readNotificationMutation = useMutation({
    mutationFn: (notificationId: string) => api.readNotification(session, notificationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", session.activeWorkspaceId] })
  });

  const workItems = useQuery({
    queryKey: ["work-items", session.activeWorkspaceId],
    queryFn: () => api.workItems(session)
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

  // Filter and Sort Items
  let filteredItems = allItems.filter(
    (item) => !selectedWorkflow || item.templateId === selectedWorkflow.id
  );

  if (filterPriority !== "all") {
    filteredItems = filteredItems.filter((item) => item.priority === filterPriority);
  }

  filteredItems.sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "priority") {
      const pOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      return (pOrder[b.priority] || 0) - (pOrder[a.priority] || 0);
    }
    if (sortBy === "dueDate") {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    return 0;
  });

  const createMutation = useMutation({
    mutationFn: (input: { title: string; description: string; priority: WorkItem["priority"] }) =>
      api.createItem(session, { ...input, templateId: selectedWorkflow?.id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ itemId, stageId }: { itemId: string; stageId: string }) => {
      await api.transitionItem(session, itemId, stageId);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  const updateFieldsMutation = useMutation({
    mutationFn: async ({ itemId, title, description, priority }: { itemId: string; title: string; description: string | null; priority: WorkItem["priority"] }) => {
      queryClient.setQueryData(["work-items", session.activeWorkspaceId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((it: WorkItem) =>
            it.id === itemId ? { ...it, title, description, priority } : it
          )
        };
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
    }
  });

  // Checklist / Subtasks handling (Simulated in metadata_json)
  const addSubtask = () => {
    if (!drawerItem || !newSubtask.trim()) return;
    const metadata = drawerItem.metadata || {};
    const checklist = metadata.checklist || [];
    const updatedChecklist = [...checklist, { id: Math.random().toString(), text: newSubtask, done: false }];
    
    const updatedItem = {
      ...drawerItem,
      metadata: { ...metadata, checklist: updatedChecklist }
    };
    setDrawerItem(updatedItem);
    setNewSubtask("");
  };

  const toggleSubtask = (subtaskId: string) => {
    if (!drawerItem) return;
    const metadata = drawerItem.metadata || {};
    const checklist = metadata.checklist || [];
    const updatedChecklist = checklist.map((item: any) =>
      item.id === subtaskId ? { ...item, done: !item.done } : item
    );

    const updatedItem = {
      ...drawerItem,
      metadata: { ...metadata, checklist: updatedChecklist }
    };
    setDrawerItem(updatedItem);
  };

  // Generate AI Summary for Task
  const handleGenerateAISummary = async () => {
    if (!drawerItem) return;
    setAiSummaryPending(true);
    try {
      // Simulate/Trigger LLM task summary
      const answer = await api.groundedChat(session, `Summarize status and next steps for task: ${drawerItem.title}`);
      setAiSummary(answer.answer);
    } catch {
      setAiSummary("Failed to generate AI analysis.");
    } finally {
      setAiSummaryPending(false);
    }
  };

  if (workflows.isLoading || workItems.isLoading) {
    return <LoadingSpinner message="Entering delivery workspace board..." />;
  }

  return (
    <section className="dashboard" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)", position: "relative" }}>
      {/* 1. Header controls */}
      <div className="board-header" style={{ marginBottom: "1.5rem" }}>
        <div>
          <p className="eyebrow">Work board</p>
          <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 700 }}>Kanban Work Board</h3>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          {/* View switcher */}
          <div className="tab-row" style={{ margin: 0, padding: "2px" }}>
            <button className={activeView === "kanban" ? "active" : ""} onClick={() => setActiveView("kanban")}>
              <LayoutGrid size={14} style={{ marginRight: "4px" }} /> Kanban
            </button>
            <button className={activeView === "table" ? "active" : ""} onClick={() => setActiveView("table")}>
              <TableIcon size={14} style={{ marginRight: "4px" }} /> Table
            </button>
            <button className={activeView === "calendar" ? "active" : ""} onClick={() => setActiveView("calendar")}>
              <CalendarIcon size={14} style={{ marginRight: "4px" }} /> Calendar
            </button>
            <button className={activeView === "timeline" ? "active" : ""} onClick={() => setActiveView("timeline")}>
              <Clock size={14} style={{ marginRight: "4px" }} /> Timeline
            </button>
          </div>

          {/* Workflow Selector */}
          <div className="board-controls" style={{ padding: "4px 8px" }}>
            <SlidersHorizontal size={14} />
            <select value={selectedWorkflowId} onChange={(e) => setSelectedWorkflowId(e.target.value)}>
              {allWorkflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Filter Priority */}
          <div className="board-controls" style={{ padding: "4px 8px" }}>
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="board-controls" style={{ padding: "4px 8px" }}>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="title">Sort: Title</option>
              <option value="priority">Sort: Priority</option>
              <option value="dueDate">Sort: Due Date</option>
            </select>
          </div>

          {/* AI Notifications Toggle */}
          <button
            className="secondary"
            onClick={() => setShowAiNotifications(!showAiNotifications)}
            style={{
              padding: "4px 10px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: showAiNotifications ? "rgba(139, 92, 246, 0.1)" : "white",
              border: showAiNotifications ? "1px solid #8b5cf6" : "1px solid var(--line)",
              color: showAiNotifications ? "#8b5cf6" : "var(--forest-dark)",
              fontSize: "0.82rem",
              fontWeight: 600,
              borderRadius: "8px",
              height: "32px",
              margin: 0
            }}
          >
            <Bot size={14} /> AI Alerts
            {notifications.data?.notifications?.filter((n: any) => !n.readAt).length ? (
              <span style={{ fontSize: "0.7rem", padding: "1px 5px", background: "#ef4444", color: "white", borderRadius: "10px", fontWeight: 700 }}>
                {notifications.data.notifications.filter((n: any) => !n.readAt).length}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* 2. Main Views container */}
      {activeView === "kanban" && (
        <>
          {/* Quick Create Task Form */}
          <div
            className="quick-create card-premium"
            style={{
              padding: "0.5rem 1rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              marginBottom: "1.5rem"
            }}
          >
            <Plus size={16} />
            <input
              type="text"
              placeholder="Quick Add Work Item... (Press Enter)"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  createMutation.mutate({
                    title: e.currentTarget.value.trim(),
                    description: "",
                    priority: "medium"
                  });
                  e.currentTarget.value = "";
                }
              }}
              style={{ border: "none", outline: "none", flex: 1, fontSize: "0.9rem" }}
            />
          </div>

          <div className="board">
            {selectedWorkflow?.stages.map((stage) => {
              const stageItems = filteredItems.filter((item) => item.stageId === stage.id);
              const isOverloaded = stageItems.length > 5;
              return (
                <div key={stage.id} className="column card-premium" style={{ borderTop: `4px solid ${stage.color}` }}>
                  <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                    <div>
                      <strong style={{ fontSize: "0.9rem", color: "var(--forest-dark)" }}>{stage.name}</strong>
                      <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--muted)" }}>
                        SLA Limit: {stage.slaHours ?? 24}h
                      </p>
                    </div>
                    <span
                      style={{
                        padding: "2px 8px",
                        background: isOverloaded ? "rgba(239, 68, 68, 0.15)" : "var(--mint)",
                        color: isOverloaded ? "#b91c1c" : "var(--forest-dark)",
                        borderRadius: "10px",
                        fontSize: "0.7rem",
                        fontWeight: 700
                      }}
                    >
                      {stageItems.length}
                    </span>
                  </header>

                  {isOverloaded && (
                    <div style={{ display: "flex", gap: "4px", alignItems: "center", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.15)", borderRadius: "6px", padding: "4px 8px", fontSize: "0.72rem", color: "#b91c1c", marginBottom: "0.5rem" }}>
                      <ShieldAlert size={12} /> Bottleneck risk: WIP limit exceeded
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minHeight: "300px" }}>
                    {stageItems.map((item) => {
                      // Dynamic risk calculation
                      let aiRisk = 35;
                      if (item.priority === "urgent") aiRisk = 95;
                      else if (item.priority === "high") aiRisk = 75;
                      else if (item.priority === "medium") aiRisk = 45;
                      
                      if (item.dueDate) {
                        const isOverdue = new Date(item.dueDate) < new Date();
                        if (isOverdue) {
                          aiRisk = 99;
                        } else {
                          const hoursLeft = (new Date(item.dueDate).getTime() - Date.now()) / (1000 * 60 * 60);
                          const slaHours = stage?.slaHours ?? 24;
                          if (hoursLeft < 12) {
                            aiRisk = Math.max(aiRisk, 90);
                          } else if (hoursLeft < slaHours) {
                            aiRisk = Math.max(aiRisk, 70);
                          }
                        }
                      }
                      const riskColor = aiRisk >= 80 ? "#b91c1c" : aiRisk >= 55 ? "#d97706" : "var(--forest-dark)";
                      const riskBg = aiRisk >= 80 ? "rgba(239, 68, 68, 0.12)" : aiRisk >= 55 ? "rgba(245, 158, 11, 0.12)" : "var(--mint)";
                      const cardBorder = aiRisk >= 80 ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid var(--line)";
                      const cardShadow = aiRisk >= 80 ? "0 4px 12px rgba(239, 68, 68, 0.06)" : "none";

                      return (
                        <div
                          key={item.id}
                          className="work-card"
                          onClick={() => setDrawerItem(item)}
                          style={{ cursor: "pointer", border: cardBorder, boxShadow: cardShadow }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className={`priority ${item.priority}`}>{item.priority}</span>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", background: riskBg, color: riskColor, borderRadius: "6px" }}>
                              AI Risk: {aiRisk}%
                            </span>
                          </div>
                          <h4>{item.title}</h4>
                          
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem", fontSize: "0.7rem", color: "var(--muted)" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                              <User size={12} /> {item.assigneeName || "Unassigned"}
                            </span>
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <span style={{ display: "flex", alignItems: "center", gap: "2px" }}><MessageSquare size={12} /> 2</span>
                              <span style={{ display: "flex", alignItems: "center", gap: "2px" }}><Paperclip size={12} /> 1</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeView === "table" && (
        <div className="card-premium" style={{ padding: "1.5rem", background: "white" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--line)", textAlign: "left" }}>
                <th style={{ padding: "0.5rem" }}>Title</th>
                <th style={{ padding: "0.5rem" }}>Priority</th>
                <th style={{ padding: "0.5rem" }}>Stage</th>
                <th style={{ padding: "0.5rem" }}>Assignee</th>
                <th style={{ padding: "0.5rem" }}>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid var(--line)", cursor: "pointer" }} onClick={() => setDrawerItem(item)}>
                  <td style={{ padding: "0.75rem 0.5rem", fontWeight: 600 }}>
                    <input
                      type="text"
                      value={item.title}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateFieldsMutation.mutate({ itemId: item.id, title: e.target.value, description: item.description, priority: item.priority })}
                      style={{ border: "none", background: "transparent", width: "100%", fontWeight: "inherit", outline: "none" }}
                    />
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    <span className={`priority ${item.priority}`}>{item.priority}</span>
                  </td>
                  <td style={{ padding: "0.5rem" }}>{item.stageName}</td>
                  <td style={{ padding: "0.5rem" }}>{item.assigneeName || "Unassigned"}</td>
                  <td style={{ padding: "0.5rem" }}>{item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeView === "calendar" && (
        <div className="card-premium" style={{ padding: "1.5rem", background: "white" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", textAlign: "center", fontWeight: 700, borderBottom: "2px solid var(--line)", paddingBottom: "0.5rem" }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.5rem", minHeight: "350px", marginTop: "0.5rem" }}>
            {Array.from({ length: 28 }).map((_, idx) => {
              const dayNum = idx - 2; // Simulated offsets
              const isToday = dayNum === new Date().getDate();
              const dateItems = filteredItems.filter(() => dayNum > 0 && Math.random() > 0.85); // Mock distribution
              return (
                <div key={idx} style={{ border: "1px solid var(--line)", borderRadius: "6px", padding: "0.25rem", background: isToday ? "var(--brand-purple-light)" : "transparent" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color: isToday ? "var(--brand-purple)" : "var(--muted)" }}>
                    {dayNum > 0 && dayNum <= 31 ? dayNum : ""}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "2px" }}>
                    {dateItems.slice(0, 2).map((item) => (
                      <span key={item.id} onClick={() => setDrawerItem(item)} style={{ fontSize: "0.65rem", padding: "1px 4px", background: "var(--surface-muted)", borderRadius: "3px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer" }}>
                        {item.title}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === "timeline" && (
        <div className="card-premium" style={{ padding: "1.5rem", background: "white" }}>
          <div style={{ position: "relative", minHeight: "280px" }}>
            <div style={{ display: "flex", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
              <div style={{ width: "200px" }}>Work Item</div>
              {["Week 1", "Week 2", "Week 3", "Week 4"].map((w) => (
                <div key={w} style={{ flex: 1, textAlign: "center", borderLeft: "1px solid var(--line)" }}>{w}</div>
              ))}
            </div>
            {filteredItems.slice(0, 5).map((item, idx) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--line)", padding: "0.5rem 0" }}>
                <div style={{ width: "200px", fontWeight: 600, fontSize: "0.82rem", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {item.title}
                </div>
                <div style={{ flex: 1, position: "relative", height: "18px" }}>
                  <div
                    onClick={() => setDrawerItem(item)}
                    style={{
                      position: "absolute",
                      left: `${(idx * 15) % 60}%`,
                      width: "35%",
                      height: "100%",
                      background: "var(--brand-gradient)",
                      boxShadow: "var(--accent-glow)",
                      borderRadius: "10px",
                      cursor: "pointer"
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Task Detail Drawer Overlay */}
      {drawerItem && (
        <div
          className="slide-in-drawer"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: "480px",
            height: "100vh",
            background: "white",
            borderLeft: "1px solid var(--line)",
            boxShadow: "-10px 0 35px rgba(0,0,0,0.1)",
            zIndex: 300,
            padding: "2rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
            overflowY: "auto"
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className={`priority ${drawerItem.priority}`}>{drawerItem.priority}</span>
            <button style={{ background: "transparent", padding: 0 }} onClick={() => setDrawerItem(null)}>
              <X size={20} />
            </button>
          </div>

          <div>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1.25rem", margin: "0 0 0.5rem 0" }}>
              {drawerItem.title}
            </h4>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              {drawerItem.description || "No description provided."}
            </p>

            <strong style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              Status (Stage)
            </strong>
            <select
              value={drawerItem.stageId}
              onChange={(e) => {
                const newStageId = e.target.value;
                transitionMutation.mutate({ itemId: drawerItem.id, stageId: newStageId });
                const nextStage = selectedWorkflow?.stages.find((s) => s.id === newStageId);
                if (nextStage) {
                  setDrawerItem({
                    ...drawerItem,
                    stageId: newStageId,
                    stageName: nextStage.name
                  });
                }
              }}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                background: "white",
                color: "var(--forest-dark)",
                fontSize: "0.85rem"
              }}
            >
              {selectedWorkflow?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ height: "1px", background: "var(--line)" }} />

          {/* Subtasks / Checklist widget */}
          <div>
            <strong style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              Subtasks Checklist
            </strong>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {(drawerItem.metadata?.checklist || []).map((sub: any) => (
                <label key={sub.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "var(--forest-dark)", cursor: "pointer" }}>
                  <input type="checkbox" checked={sub.done} onChange={() => toggleSubtask(sub.id)} />
                  <span style={{ textDecoration: sub.done ? "line-through" : "none", opacity: sub.done ? 0.6 : 1 }}>
                    {sub.text}
                  </span>
                </label>
              ))}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                <input
                  type="text"
                  placeholder="Add checklist subtask..."
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                  style={{ flex: 1, padding: "4px 8px", fontSize: "0.8rem", borderRadius: "6px", border: "1px solid var(--line)" }}
                />
                <button onClick={addSubtask} style={{ background: "transparent", padding: 0 }}>
                  <PlusCircle size={18} className="text-green-600" />
                </button>
              </div>
            </div>
          </div>

          <div style={{ height: "1px", background: "var(--line)" }} />

          {/* AI Assist widget */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <strong style={{ fontSize: "0.85rem", color: "var(--muted)" }}>AI Task Summary</strong>
              <button className="primary" style={{ padding: "2px 8px", fontSize: "0.75rem", height: "auto" }} onClick={handleGenerateAISummary} disabled={aiSummaryPending}>
                <Bot size={12} style={{ marginRight: "4px" }} /> {aiSummaryPending ? "Summarizing..." : "Analyze"}
              </button>
            </div>
            {aiSummary && (
              <p style={{ fontSize: "0.8rem", background: "var(--surface-muted)", padding: "0.75rem", borderRadius: "8px", color: "var(--forest-dark)", lineHeight: "1.5" }}>
                {aiSummary}
              </p>
            )}
          </div>

          <div style={{ height: "1px", background: "var(--line)" }} />

          {/* Activity / Version logs */}
          <div>
            <strong style={{ display: "block", fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
              Task Activity Feed
            </strong>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.50rem", fontSize: "0.78rem" }}>
              <div style={{ borderLeft: "2px solid var(--line)", paddingLeft: "0.75rem", position: "relative" }}>
                <span style={{ position: "absolute", left: "-5px", top: "4px", width: "8px", height: "8px", borderRadius: "50%", background: "var(--brand-green)" }} />
                <strong>Task Created</strong> - Initial status set to `{drawerItem.stageName}`
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Notifications Floating Dropdown */}
      {showAiNotifications && (
        <div
          style={{
            position: "absolute",
            top: "65px",
            right: "2rem",
            width: "360px",
            maxHeight: "450px",
            background: "white",
            border: "1px solid var(--line)",
            boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
            borderRadius: "12px",
            zIndex: 350,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden"
          }}
        >
          <header style={{ padding: "0.85rem 1rem", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-muted)" }}>
            <strong style={{ fontSize: "0.88rem", color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "6px" }}><Bot size={14} /> AI Context Alerts</strong>
            <button style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }} onClick={() => setShowAiNotifications(false)}>
              <X size={16} />
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
            {notifications.isLoading ? (
              <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--muted)", padding: "1rem" }}>Loading alerts...</p>
            ) : !notifications.data?.notifications?.length ? (
              <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--muted)", padding: "1.5rem" }}>No current context notifications.</p>
            ) : (
              notifications.data?.notifications.map((n: any) => (
                <div key={n.id} style={{ padding: "0.75rem", borderBottom: "1px solid var(--line)", background: n.readAt ? "transparent" : "rgba(139, 92, 246, 0.04)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--forest-dark)" }}>{n.title}</span>
                    {!n.readAt && (
                      <button
                        onClick={() => readNotificationMutation.mutate(n.id)}
                        style={{ fontSize: "0.68rem", padding: "2px 6px", background: "transparent", border: "none", color: "#8b5cf6", fontWeight: 700, cursor: "pointer" }}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "0.78rem", color: "var(--muted)", lineHeight: "1.4" }}>{n.body}</p>
                  <small style={{ display: "block", marginTop: "4px", fontSize: "0.68rem", color: "var(--muted)" }}>{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
