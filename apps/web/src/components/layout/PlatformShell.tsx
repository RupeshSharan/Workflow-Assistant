import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { api } from "../../api";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "../ai/CommandPalette";
import type { Session } from "../../types";

interface PlatformShellProps {
  session: Session;
  onSessionChange: (session: Session | null) => void;
}

export function PlatformShell({ session, onSessionChange }: PlatformShellProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [aiPreFillCommand, setAiPreFillCommand] = useState("");

  // Onboarding Wizard state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [workspaceType, setWorkspaceType] = useState("tech_startup");
  const [primaryGoal, setPrimaryGoal] = useState("tasks_tracking");
  const [selectedTemplate, setSelectedTemplate] = useState("Standard Kanban");
  const [isGenerating, setIsGenerating] = useState(false);

  const activeWorkspaceId = session.activeWorkspaceId ?? session.workspaces[0]?.id ?? null;
  const scopedSession = { ...session, activeWorkspaceId };
  const activeWorkspace = session.workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  useEffect(() => {
    if (activeWorkspaceId) {
      const key = `flowai-onboarding-complete-${activeWorkspaceId}`;
      const completed = localStorage.getItem(key);
      if (!completed) {
        setShowOnboarding(true);
        setOnboardingStep(1);
      } else {
        setShowOnboarding(false);
      }
    }
  }, [activeWorkspaceId]);

  const handleCompleteOnboarding = async () => {
    setIsGenerating(true);
    try {
      // 1. Create chosen workflow template in DB
      let stages = [
        { name: "Backlog", color: "#64748b", isTerminal: false, slaHours: 72 },
        { name: "In Progress", color: "#2563eb", isTerminal: false, slaHours: 48 },
        { name: "Review", color: "#f59e0b", isTerminal: false, slaHours: 24 },
        { name: "Completed", color: "#10b981", isTerminal: true, slaHours: 12 }
      ];
      if (selectedTemplate === "Hiring Pipeline") {
        stages = [
          { name: "Applied", color: "#64748b", isTerminal: false, slaHours: 48 },
          { name: "Screening", color: "#7c3aed", isTerminal: false, slaHours: 24 },
          { name: "Interviewing", color: "#2563eb", isTerminal: false, slaHours: 72 },
          { name: "Offer Extended", color: "#10b981", isTerminal: true, slaHours: 96 }
        ];
      } else if (selectedTemplate === "Customer Support") {
        stages = [
          { name: "Ticket Open", color: "#ef4444", isTerminal: false, slaHours: 8 },
          { name: "Investigating", color: "#f97316", isTerminal: false, slaHours: 24 },
          { name: "Closed", color: "#10b981", isTerminal: true, slaHours: 12 }
        ];
      } else if (selectedTemplate === "Bug Tracking") {
        stages = [
          { name: "Reported", color: "#ef4444", isTerminal: false, slaHours: 24 },
          { name: "Triage", color: "#f97316", isTerminal: false, slaHours: 48 },
          { name: "Fixing", color: "#3b82f6", isTerminal: false, slaHours: 72 },
          { name: "Resolved", color: "#10b981", isTerminal: true, slaHours: 12 }
        ];
      }

      const workflowRes = await api.createWorkflow(scopedSession, {
        name: `${selectedTemplate} (Auto-generated)`,
        category: workspaceType,
        isDefault: true,
        stages
      });

      // 2. Create sample work items linked to this workflow template
      const itemsToCreate = [
        { title: "🚀 Kickoff team orientation meeting", description: `Auto-generated onboarding task for ${workspaceType} workspace.`, priority: "high" as const },
        { title: "📄 Review indexed documentations & notes", description: "Read standard procedures and upload guidelines.", priority: "medium" as const },
        { title: "⚙️ Setup automation workflow triggers", description: "Configure transition notifications rules.", priority: "low" as const }
      ];

      for (const item of itemsToCreate) {
        await api.createItem(scopedSession, {
          title: item.title,
          description: item.description,
          priority: item.priority,
          templateId: workflowRes.id
        });
      }

      // Invalidate queries so dashboard & board reload the new template and tasks instantly!
      void queryClient.invalidateQueries({ queryKey: ["workflows", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["work-items", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", activeWorkspaceId] });

      // Save complete status
      localStorage.setItem(`flowai-onboarding-complete-${activeWorkspaceId}`, "true");
      setShowOnboarding(false);
    } catch (err) {
      console.error(err);
      alert("Error initializing workspace sample data.");
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!session.token || !activeWorkspaceId) return;

    const socketUrl = import.meta.env.VITE_API_BASE_URL
      ? import.meta.env.VITE_API_BASE_URL.replace(/\/api$/, "")
      : "http://localhost:4000";

    const socket = io(socketUrl, {
      auth: {
        token: session.token,
        workspaceId: activeWorkspaceId
      }
    });

    socket.on("connect", () => {
      console.log("Real-time socket connected for workspace:", activeWorkspaceId);
    });

    socket.on("work-item:created", () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", activeWorkspaceId] });
    });

    socket.on("work-item:updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["item-fields", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["history", activeWorkspaceId] });
    });

    socket.on("work-item:transitioned", () => {
      void queryClient.invalidateQueries({ queryKey: ["work-items", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["history", activeWorkspaceId] });
    });

    socket.on("work-item:comment-added", () => {
      void queryClient.invalidateQueries({ queryKey: ["comments"] });
    });

    socket.on("notification:created", () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", activeWorkspaceId] });
    });

    return () => {
      socket.disconnect();
    };
  }, [session.token, activeWorkspaceId, queryClient]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        setShowCommandPalette((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function selectWorkspace(workspaceId: string) {
    onSessionChange({ ...session, activeWorkspaceId: workspaceId });
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    } finally {
      onSessionChange(null);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="empty-state">
        <h2>No workspace access found</h2>
        <button className="secondary" onClick={handleLogout}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="platform">
      <Sidebar
        session={scopedSession}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={selectWorkspace}
        onLogout={handleLogout}
      />
      <main className="workspace-main">
        <Header
          session={scopedSession}
          activeWorkspace={activeWorkspace}
          onOpenCommandPalette={() => setShowCommandPalette(true)}
        />
        <Outlet
          context={{
            session: scopedSession,
            activeWorkspace,
            onSessionChange,
            aiPreFillCommand,
            setAiPreFillCommand
          }}
        />
      </main>
      
      {/* Workspace Onboarding Wizard Modal Overlay */}
      {showOnboarding && (
        <div className="onboarding-backdrop">
          <div className="onboarding-modal">
            <h3 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1.35rem", marginBottom: "0.5rem" }}>
              Welcome to FlowAI 🚀
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              Let's tailor this workspace context to your organization requirements.
            </p>

            <div className="onboarding-step-indicator">
              <span className={`onboarding-dot ${onboardingStep >= 1 ? "active" : ""}`} />
              <span className={`onboarding-dot ${onboardingStep >= 2 ? "active" : ""}`} />
              <span className={`onboarding-dot ${onboardingStep >= 3 ? "active" : ""}`} />
              <span className={`onboarding-dot ${onboardingStep >= 4 ? "active" : ""}`} />
            </div>

            {onboardingStep === 1 && (
              <div>
                <strong style={{ display: "block", marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                  What kind of workspace is this?
                </strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    { id: "tech_startup", label: "Tech Startup Team" },
                    { id: "college_club", label: "College Club / Student Group" },
                    { id: "support_desk", label: "Customer Support Desk" },
                    { id: "operations", label: "Operations & HR Department" }
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setWorkspaceType(item.id)}
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        borderRadius: "10px",
                        border: workspaceType === item.id ? "2px solid var(--brand-purple)" : "1px solid var(--line)",
                        background: workspaceType === item.id ? "var(--brand-purple-light)" : "white",
                        fontWeight: workspaceType === item.id ? 700 : 500
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {onboardingStep === 2 && (
              <div>
                <strong style={{ display: "block", marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                  What is your primary workspace goal?
                </strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[
                    { id: "tasks_tracking", label: "Track Work Items & Kanban Delivery" },
                    { id: "rag_knowledge", label: "Manage Document Notes & Semantic AI Grounding" },
                    { id: "sla_automations", label: "Automate Reminders & SLA Escalation Rules" }
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setPrimaryGoal(item.id)}
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        borderRadius: "10px",
                        border: primaryGoal === item.id ? "2px solid var(--brand-purple)" : "1px solid var(--line)",
                        background: primaryGoal === item.id ? "var(--brand-purple-light)" : "white",
                        fontWeight: primaryGoal === item.id ? 700 : 500
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {onboardingStep === 3 && (
              <div>
                <strong style={{ display: "block", marginBottom: "0.75rem", fontSize: "0.95rem" }}>
                  Select a workflow stage template presets
                </strong>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {["Standard Kanban", "Hiring Pipeline", "Customer Support", "Bug Tracking"].map((tpl) => (
                    <button
                      key={tpl}
                      onClick={() => setSelectedTemplate(tpl)}
                      style={{
                        padding: "0.75rem",
                        textAlign: "left",
                        borderRadius: "10px",
                        border: selectedTemplate === tpl ? "2px solid var(--brand-purple)" : "1px solid var(--line)",
                        background: selectedTemplate === tpl ? "var(--brand-purple-light)" : "white",
                        fontWeight: selectedTemplate === tpl ? 700 : 500
                      }}
                    >
                      {tpl}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {onboardingStep === 4 && (
              <div style={{ textAlign: "center", padding: "1rem 0" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>⚡</div>
                <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                  Ready to configure your workspace context?
                </strong>
                <p style={{ color: "var(--muted)", fontSize: "0.82rem", lineHeight: "1.5", margin: "0 0 1.5rem 0" }}>
                  We will auto-generate your dashboard, default `{selectedTemplate}` workflow stages, custom labels, and mock tasks so you can get started instantly.
                </p>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2rem" }}>
              {onboardingStep > 1 ? (
                <button className="secondary" onClick={() => setOnboardingStep((s) => s - 1)} disabled={isGenerating}>
                  Back
                </button>
              ) : (
                <div />
              )}
              {onboardingStep < 4 ? (
                <button className="primary" onClick={() => setOnboardingStep((s) => s + 1)}>
                  Next Step
                </button>
              ) : (
                <button className="primary" onClick={handleCompleteOnboarding} disabled={isGenerating}>
                  {isGenerating ? "Configuring system..." : "Confirm & Setup"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCommandPalette && (
        <CommandPalette
          session={scopedSession}
          onClose={() => setShowCommandPalette(false)}
          onNavigate={(sec, cmd) => {
            if (cmd) setAiPreFillCommand(cmd);
            navigate(`/${sec}`);
          }}
        />
      )}
    </div>
  );
}
