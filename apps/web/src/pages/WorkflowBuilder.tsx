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

  const workflows = useQuery({
    queryKey: ["workflows", session.activeWorkspaceId],
    queryFn: () => api.workflows(session)
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

  function selectPreset(preset: typeof PRESETS[number]) {
    setName(preset.name);
    setCategory(preset.category);
    setStages([...preset.stages]);
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
      <div className="page-intro" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Visual Creator</p>
        <h3>Custom Process & Pipeline Canvas</h3>
        <p>Design stages and SLA durations. Use templates or describe a custom process to let AI construct nodes.</p>
      </div>

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
            Templates Presets
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {PRESETS.map((preset) => (
              <button key={preset.name} className="template-item" onClick={() => selectPreset(preset)}>
                <WorkflowIcon size={14} /> {preset.name}
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
    </section>
  );
}
