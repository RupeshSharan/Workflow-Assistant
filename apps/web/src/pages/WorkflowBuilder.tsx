import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Trash2, Plus, ArrowDown, ArrowUp, Settings, Workflow as WorkflowIcon } from "lucide-react";
import { api } from "../api";
import type { Session } from "../types";

interface WorkflowBuilderProps {
  session: Session;
  canEdit: boolean;
}

interface DraftStage {
  name: string;
  color: string;
  isTerminal: boolean;
  slaHours?: number;
}

const PRESETS = [
  {
    name: "Bug Tracking",
    category: "engineering",
    stages: [
      { name: "Reported", color: "#64748b", isTerminal: false, slaHours: 24 },
      { name: "Triage", color: "#f97316", isTerminal: false, slaHours: 48 },
      { name: "Fixing", color: "#3b82f6", isTerminal: false, slaHours: 72 },
      { name: "Resolved", color: "#10b981", isTerminal: true, slaHours: 12 }
    ]
  },
  {
    name: "Hiring Pipeline",
    category: "recruiting",
    stages: [
      { name: "Applied", color: "#64748b", isTerminal: false, slaHours: 48 },
      { name: "Screening", color: "#7c3aed", isTerminal: false, slaHours: 24 },
      { name: "Interviewing", color: "#2563eb", isTerminal: false, slaHours: 72 },
      { name: "Offer Extended", color: "#10b981", isTerminal: true, slaHours: 96 }
    ]
  },
  {
    name: "Customer Support",
    category: "support",
    stages: [
      { name: "Ticket Open", color: "#ef4444", isTerminal: false, slaHours: 8 },
      { name: "Investigating", color: "#f97316", isTerminal: false, slaHours: 24 },
      { name: "Resolution Draft", color: "#3b82f6", isTerminal: false, slaHours: 12 },
      { name: "Ticket Closed", color: "#10b981", isTerminal: true, slaHours: 4 }
    ]
  },
  {
    name: "Approval Flow",
    category: "operations",
    stages: [
      { name: "Draft", color: "#64748b", isTerminal: false, slaHours: 168 },
      { name: "Under Review", color: "#f59e0b", isTerminal: false, slaHours: 48 },
      { name: "Approved", color: "#10b981", isTerminal: true, slaHours: 24 }
    ]
  }
];

export function WorkflowBuilder({ session, canEdit }: WorkflowBuilderProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("My Workflow Template");
  const [category, setCategory] = useState("general");
  const [makeDefault, setMakeDefault] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [inputError, setInputError] = useState("");

  const [stages, setStages] = useState<DraftStage[]>([
    { name: "New Request", color: "#64748b", isTerminal: false, slaHours: 24 },
    { name: "Review", color: "#2563eb", isTerminal: false, slaHours: 48 },
    { name: "Completed", color: "#10b981", isTerminal: true, slaHours: 12 }
  ]);
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(0);

  // Simulator state variables
  const [activeTab, setActiveTab] = useState<"builder" | "simulator">("builder");
  const [reviewersCount, setReviewersCount] = useState(2);
  const [taskArrivalRate, setTaskArrivalRate] = useState(1.0);
  const [wipLimit, setWipLimit] = useState(5);

  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
  });

  // Query dynamic presets from Marketplace
  const presetsMarketplace = useQuery({
    queryKey: ["presets-marketplace", session.activeWorkspaceId],
    queryFn: () => api.presetsMarketplace(session)
  });

  // Query digital twin process simulation
  const simulation = useQuery({
    queryKey: ["workflow-simulation", session.activeWorkspaceId, reviewersCount, taskArrivalRate, wipLimit],
    queryFn: () => api.workflowSimulation(session, reviewersCount, taskArrivalRate, wipLimit)
  });

  const mutation = useMutation({
    mutationFn: (workflow: {
      name: string;
      category: string;
      isDefault: boolean;
      stages: Array<{ name: string; color: string; isTerminal: boolean; slaHours?: number }>;
    }) => api.createWorkflow(session, workflow),
    onSuccess: () => {
      setName("My Workflow Template");
      setStages([
        { name: "New Request", color: "#64748b", isTerminal: false, slaHours: 24 },
        { name: "Review", color: "#2563eb", isTerminal: false, slaHours: 48 },
        { name: "Completed", color: "#10b981", isTerminal: true, slaHours: 12 }
      ]);
      setSelectedStageIndex(0);
      void queryClient.invalidateQueries({ queryKey: ["workflows", session.activeWorkspaceId] });
      alert("Workflow template created and configured successfully!");
    }
  });

  const draftMutation = useMutation({
    mutationFn: () => api.draftWorkflow(session, aiPrompt),
    onSuccess: ({ draft }) => {
      setName(draft.name);
      setCategory(draft.category);
      setStages(
        draft.stages.map((stage) => ({
          name: stage.name,
          color: stage.color,
          isTerminal: stage.isTerminal,
          slaHours: 48
        }))
      );
      setSelectedStageIndex(0);
      setAiPrompt("");
    }
  });

  function selectPreset(preset: any) {
    setName(preset.name);
    setCategory(preset.category || preset.description || "general");
    setStages(preset.stages.map((s: any) => ({
      name: s.name,
      color: s.color || "#64748b",
      isTerminal: s.isTerminal ?? (s.name.toLowerCase().includes("done") || s.name.toLowerCase().includes("closed") || s.name.toLowerCase().includes("publish") || s.name.toLowerCase().includes("shipped")),
      slaHours: s.slaHours ?? 24
    })));
    setSelectedStageIndex(0);
  }

  function addStage() {
    const nextStages = [...stages];
    nextStages.push({
      name: `Stage ${stages.length + 1}`,
      color: "#64748b",
      isTerminal: false,
      slaHours: 24
    });
    setStages(nextStages);
    setSelectedStageIndex(nextStages.length - 1);
  }

  function removeStage(index: number) {
    if (stages.length <= 2) {
      alert("A workflow must have at least two stages.");
      return;
    }
    const nextStages = stages.filter((_, i) => i !== index);
    setStages(nextStages);
    setSelectedStageIndex(0);
  }

  function moveStage(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= stages.length) return;
    
    const nextStages = [...stages];
    const temp = nextStages[index]!;
    nextStages[index] = nextStages[targetIndex]!;
    nextStages[targetIndex] = temp;
    setStages(nextStages);
    setSelectedStageIndex(targetIndex);
  }

  function updateSelectedStage(updated: Partial<DraftStage>) {
    if (selectedStageIndex === null) return;
    const nextStages = [...stages];
    nextStages[selectedStageIndex] = { ...nextStages[selectedStageIndex]!, ...updated };
    setStages(nextStages);
  }

  function submitWorkflow() {
    if (!name.trim()) {
      setInputError("Template name is required.");
      return;
    }
    if (stages.length < 2) {
      setInputError("Provide at least two workflow stages.");
      return;
    }
    setInputError("");
    mutation.mutate({
      name,
      category,
      isDefault: makeDefault,
      stages: stages.map((stage, index) => ({
        ...stage,
        isTerminal: index === stages.length - 1 ? true : stage.isTerminal
      }))
    });
  }

  const activeStage = selectedStageIndex !== null ? stages[selectedStageIndex] : null;

  return (
    <section className="workflow-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      <div className="page-intro" style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "end" }}>
        <div>
          <p className="eyebrow">Visual Creator & Simulator</p>
          <h3>Custom Process & Pipeline Canvas</h3>
          <p>Design stages, SLA durations, and simulate workload distribution with process digital twin simulation.</p>
        </div>
        
        {/* Active Tab Toggle */}
        <div className="tab-row" style={{ margin: 0, padding: "2px", height: "auto" }}>
          <button className={activeTab === "builder" ? "active" : ""} onClick={() => setActiveTab("builder")}>
            Canvas Builder
          </button>
          <button className={activeTab === "simulator" ? "active" : ""} onClick={() => setActiveTab("simulator")}>
            Digital Twin Simulator
          </button>
        </div>
      </div>

      {activeTab === "builder" ? (
        <>
          {canEdit && (
            <div className="ai-workflow-input">
              <input
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Let AI design one: 'Create hiring workflow with resume, test, manager interview, offer'"
              />
              <button className="primary" onClick={() => draftMutation.mutate()} disabled={draftMutation.isPending}>
                <Sparkles size={16} style={{ marginRight: "4px" }} /> {draftMutation.isPending ? "Generating..." : "AI Build"}
              </button>
            </div>
          )}

          <div className="workflow-builder-layout">
            {/* Left column: templates selector */}
            <aside className="templates-sidebar">
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, marginBottom: "1rem", fontSize: "0.95rem" }}>
                Marketplace Packs
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {(presetsMarketplace.data?.presets || PRESETS).map((preset: any) => (
                  <button
                    key={preset.name}
                    className="template-item"
                    onClick={() => selectPreset(preset)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <WorkflowIcon size={14} /> {preset.name}
                    </span>
                    <span style={{ fontSize: "0.62rem", background: "rgba(139, 92, 246, 0.12)", color: "#7c3aed", padding: "2px 6px", borderRadius: "8px", fontWeight: 700, flexShrink: 0 }}>
                      Pack
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ height: "1px", background: "var(--line)", margin: "1.5rem 0" }} />
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.95rem" }}>
                Existing templates
              </h4>
              {workflows.isLoading ? (
                <p>Loading...</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {workflows.data?.workflows.map((w) => (
                    <div
                      key={w.id}
                      style={{
                        fontSize: "0.8rem",
                        padding: "6px",
                        background: "var(--surface-muted)",
                        borderRadius: "6px",
                        color: "var(--forest-dark)"
                      }}
                    >
                      <strong>{w.name}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>{w.category}</small>
                    </div>
                  ))}
                </div>
              )}
            </aside>

            {/* Center column: visual stage connection canvas */}
            <main className="canvas-container">
              <header className="canvas-title-bar">
                <div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px dashed var(--line)",
                      fontSize: "1.2rem",
                      fontWeight: 700,
                      fontFamily: "var(--font-premium)",
                      color: "var(--forest-dark)",
                      outline: "none"
                    }}
                  />
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Category"
                    style={{
                      display: "block",
                      background: "transparent",
                      border: "none",
                      fontSize: "0.8rem",
                      color: "var(--muted)",
                      outline: "none"
                    }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem", color: "var(--muted)", cursor: "pointer", marginTop: "4px" }}>
                    <input
                      type="checkbox"
                      checked={makeDefault}
                      onChange={(e) => setMakeDefault(e.target.checked)}
                    />
                    Default workflow
                  </label>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="secondary" onClick={addStage}>
                    <Plus size={14} /> Add node
                  </button>
                  <button className="primary" onClick={submitWorkflow} disabled={mutation.isPending}>
                    Save Canvas
                  </button>
                </div>
              </header>

              {stages.map((stage, index) => (
                <div key={index} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    className={`canvas-node ${selectedStageIndex === index ? "active-edit" : ""}`}
                    onClick={() => setSelectedStageIndex(index)}
                  >
                    <div className="canvas-node-title">
                      <span className="badge" style={{ background: stage.color }} />
                      {stage.name}
                    </div>
                    <div className="canvas-node-meta">
                      SLA: {stage.slaHours ?? 24}h {stage.isTerminal && " • Terminal"}
                    </div>
                    
                    <div style={{ display: "flex", gap: "0.25rem", position: "absolute", right: "8px", top: "8px" }}>
                      <button
                        style={{ background: "transparent", padding: 0 }}
                        onClick={(e) => { e.stopPropagation(); moveStage(index, "up"); }}
                        disabled={index === 0}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        style={{ background: "transparent", padding: 0 }}
                        onClick={(e) => { e.stopPropagation(); moveStage(index, "down"); }}
                        disabled={index === stages.length - 1}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        style={{ background: "transparent", padding: 0, color: "var(--status-red)" }}
                        onClick={(e) => { e.stopPropagation(); removeStage(index); }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {index < stages.length - 1 && <div className="canvas-arrow" />}
                </div>
              ))}
              {inputError && <p className="form-error" style={{ marginTop: "1rem" }}>{inputError}</p>}
            </main>

            {/* Right column: node settings configuration pane */}
            <aside className="properties-sidebar">
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Settings size={16} /> Node settings
              </h4>
              {activeStage ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.5rem" }}>
                  <label className="field">
                    <span>Stage Name</span>
                    <input
                      value={activeStage.name}
                      onChange={(e) => updateSelectedStage({ name: e.target.value })}
                    />
                  </label>

                  <label className="field">
                    <span>SLA Hours Limit</span>
                    <input
                      type="number"
                      value={activeStage.slaHours ?? 24}
                      onChange={(e) => updateSelectedStage({ slaHours: parseInt(e.target.value) || 0 })}
                    />
                  </label>

                  <label className="field">
                    <span>Display Color</span>
                    <div style={{ display: "flex", gap: "0.25rem", marginTop: "4px" }}>
                      {["#64748b", "#2563eb", "#7c3aed", "#16a34a", "#ef4444", "#f59e0b"].map((c) => (
                        <button
                          key={c}
                          onClick={() => updateSelectedStage({ color: c })}
                          style={{
                            background: c,
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            border: activeStage.color === c ? "2px solid black" : "1px solid white"
                          }}
                        />
                      ))}
                    </div>
                  </label>

                  <label className="checkbox" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={activeStage.isTerminal}
                      onChange={(e) => updateSelectedStage({ isTerminal: e.target.checked })}
                    />
                    Is terminal (Closing state)
                  </label>
                </div>
              ) : (
                <p className="muted-message" style={{ textAlign: "center", marginTop: "2rem" }}>
                  Select a stage node in the canvas flowchart to configure attributes.
                </p>
              )}
            </aside>
          </div>
        </>
      ) : (
        /* Digital Twin Simulator panel */
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "2rem", alignItems: "start" }}>
          {/* Sliders Control Panel */}
          <aside className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.25rem" }}>
              <Settings size={18} /> Simulation Settings
            </h4>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600, color: "var(--forest-dark)" }}>Reviewers Count</span>
                  <strong style={{ color: "#7c3aed" }}>{reviewersCount} members</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={reviewersCount}
                  onChange={(e) => setReviewersCount(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "#7c3aed" }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Adjust to simulate team scaling effect on queues.</span>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600, color: "var(--forest-dark)" }}>Task Arrival Rate</span>
                  <strong style={{ color: "#2563eb" }}>{taskArrivalRate.toFixed(1)} / day</strong>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={taskArrivalRate}
                  onChange={(e) => setTaskArrivalRate(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: "#2563eb" }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Incoming task frequency from users/triggers.</span>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  <span style={{ fontWeight: 600, color: "var(--forest-dark)" }}>Stage WIP Limits</span>
                  <strong style={{ color: "var(--green-dark)" }}>Max {wipLimit} items</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={wipLimit}
                  onChange={(e) => setWipLimit(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--green)" }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Work-In-Progress constraints per workflow stage.</span>
              </div>
            </div>
          </aside>

          {/* Simulation Dashboard */}
          <main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            {/* AI Process Consultant advice box */}
            <div className="card-premium" style={{ background: "linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(16, 185, 129, 0.05))", padding: "1.5rem", borderRadius: "16px", border: "1px solid rgba(139, 92, 246, 0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--forest-dark)", marginBottom: "0.75rem" }}>
                <Sparkles size={18} style={{ color: "#7c3aed" }} />
                <h4 style={{ margin: 0, fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.1rem" }}>AI Process Consultant Recommendations</h4>
              </div>
              <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--forest-dark)", lineHeight: "1.6" }}>
                {simulation.data?.advice || "Simulating queue parameters to generate organizational cycle recommendations..."}
              </p>
            </div>

            {/* Stages overview grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              {simulation.isLoading ? (
                <p>Running queue calculations...</p>
              ) : (
                simulation.data?.simulationMetrics.map((stage: any) => {
                  const riskColor = stage.overloadRisk > 70 ? "var(--status-red)" : stage.overloadRisk > 35 ? "#f59e0b" : "var(--green)";
                  return (
                    <article key={stage.name} className="card-premium" style={{ background: "white", padding: "1.25rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
                      <h5 style={{ margin: 0, fontWeight: 700, color: "var(--forest-dark)" }}>{stage.name}</h5>
                      <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                          <span style={{ color: "var(--muted)" }}>Wait Time:</span>
                          <strong>{stage.waitTime}h</strong>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                          <span style={{ color: "var(--muted)" }}>Backlog Queue:</span>
                          <strong>{stage.backlog} items</strong>
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: "4px" }}>
                            <span style={{ color: "var(--muted)" }}>Overload Risk:</span>
                            <strong style={{ color: riskColor }}>{stage.overloadRisk}%</strong>
                          </div>
                          <div style={{ height: "6px", background: "var(--line)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${stage.overloadRisk}%`, height: "100%", background: riskColor, transition: "width 0.3s ease" }} />
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            {/* Predictive Stage Wait Times Bar Chart */}
            {!simulation.isLoading && simulation.data?.simulationMetrics && (
              <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
                <h4 style={{ margin: "0 0 1.25rem 0", fontFamily: "var(--font-premium)", fontWeight: 800, fontSize: "1.05rem", color: "var(--forest-dark)" }}>
                  Stage Bottleneck wait time comparison
                </h4>
                
                <div style={{ display: "flex", alignItems: "end", height: "200px", gap: "2.5rem", padding: "0 1rem 1.5rem 1rem", borderBottom: "1px solid var(--line)" }}>
                  {simulation.data.simulationMetrics.map((stage: any) => {
                    const maxVal = Math.max(...simulation.data.simulationMetrics.map((s: any) => s.waitTime), 1);
                    const heightPct = Math.max(8, (stage.waitTime / maxVal) * 100);
                    return (
                      <div key={stage.name} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", height: "100%", justifyContent: "end" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--forest-dark)" }}>{stage.waitTime}h</span>
                        <div
                          style={{
                            width: "100%",
                            maxWidth: "48px",
                            height: `${heightPct}%`,
                            background: "linear-gradient(to top, #8b5cf6, #3b82f6)",
                            borderRadius: "6px 6px 0 0",
                            boxShadow: "0 4px 12px rgba(139, 92, 246, 0.15)",
                            transition: "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                          }}
                        />
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)", textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden", width: "100%", textAlign: "center" }} title={stage.name}>
                          {stage.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
