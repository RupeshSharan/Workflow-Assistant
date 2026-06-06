import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Sparkles,
  LayoutDashboard,
  Workflow as WorkflowIcon,
  FileText,
  Bot,
  Zap,
  BarChart2,
  Settings,
  LogOut,
  ChevronDown,
  User,
  Building,
  Check
} from "lucide-react";
import type { Session, Workspace } from "../../types";

interface SidebarProps {
  session: Session;
  activeWorkspace: Workspace;
  onSelectWorkspace: (workspaceId: string) => void;
  onLogout: () => void;
}

export function Sidebar({
  session,
  activeWorkspace,
  onSelectWorkspace,
  onLogout
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const getButtonClass = (path: string) => {
    return location.pathname === path ? "selected" : "";
  };

  // Group workspaces by organization
  const orgs: Record<string, Workspace[]> = {};
  session.workspaces.forEach((w) => {
    if (!orgs[w.orgName]) {
      orgs[w.orgName] = [];
    }
    orgs[w.orgName].push(w);
  });

  return (
    <aside className="sidebar">
      {/* Brand Header */}
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <div>
          <strong>FlowAI</strong>
          <small>Platform</small>
        </div>
      </div>

      {/* Grouped Workspace Switcher Dropdown */}
      <div className="workspace-picker" style={{ position: "relative", cursor: "pointer" }}>
        <span>Workspace</span>
        <button
          className="workspace-selector-trigger"
          onClick={() => setShowWorkspaceMenu((prev) => !prev)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            background: "var(--surface-muted)",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            padding: "0.5rem 0.75rem",
            color: "var(--forest-dark)",
            fontSize: "0.85rem",
            fontWeight: "600",
            textAlign: "left"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Building size={14} className="text-green-600" />
            <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {activeWorkspace.orgName} / {activeWorkspace.name}
            </span>
          </div>
          <ChevronDown size={14} style={{ opacity: 0.6 }} />
        </button>

        {showWorkspaceMenu && (
          <div
            className="workspace-dropdown-menu"
            style={{
              position: "absolute",
              top: "55px",
              left: "0",
              right: "0",
              background: "white",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              zIndex: 110,
              padding: "0.5rem",
              maxHeight: "260px",
              overflowY: "auto"
            }}
          >
            {Object.entries(orgs).map(([orgName, workspaces]) => (
              <div key={orgName} style={{ marginBottom: "0.5rem" }}>
                <p
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: "800",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    padding: "0.25rem 0.5rem",
                    margin: "0",
                    letterSpacing: "0.05em"
                  }}
                >
                  {orgName}
                </p>
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => {
                      onSelectWorkspace(w.id);
                      setShowWorkspaceMenu(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "0.4rem 0.6rem",
                      fontSize: "0.8rem",
                      borderRadius: "6px",
                      background: w.id === activeWorkspace.id ? "var(--mint)" : "transparent",
                      color: "var(--forest-dark)",
                      textAlign: "left"
                    }}
                  >
                    <span>{w.name}</span>
                    {w.id === activeWorkspace.id && <Check size={12} style={{ color: "var(--green)" }} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Navigation Links */}
      <nav className="nav">
        <button className={getButtonClass("/dashboard")} onClick={() => navigate("/dashboard")}>
          <LayoutDashboard size={18} /> Dashboard
        </button>
        <button className={getButtonClass("/workflows")} onClick={() => navigate("/workflows")}>
          <WorkflowIcon size={18} /> Workflows
        </button>
        <button className={getButtonClass("/documents")} onClick={() => navigate("/documents")}>
          <FileText size={18} /> Documents
        </button>
        <button className={getButtonClass("/ai")} onClick={() => navigate("/ai")}>
          <Bot size={18} /> AI Assistant
        </button>
        <button className={getButtonClass("/automations")} onClick={() => navigate("/automations")}>
          <Zap size={18} /> Automations
        </button>
        <button className={getButtonClass("/analytics")} onClick={() => navigate("/analytics")}>
          <BarChart2 size={18} /> Analytics
        </button>
        <button className={getButtonClass("/settings")} onClick={() => navigate("/settings")}>
          <Settings size={18} /> Settings
        </button>
      </nav>

      {/* Bottom User Profile Section & Actions Menu */}
      <div style={{ position: "relative", marginTop: "auto", width: "100%" }}>
        <button
          className="user-profile-trigger"
          onClick={() => setShowUserMenu((prev) => !prev)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            width: "100%",
            background: "transparent",
            padding: "0.75rem",
            borderRadius: "10px",
            border: "0",
            textAlign: "left"
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "var(--mint)",
              color: "var(--forest)",
              fontWeight: "700",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.85rem",
              textTransform: "uppercase"
            }}
          >
            {session.user.name?.slice(0, 1) || "U"}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <p style={{ margin: "0", fontSize: "0.85rem", fontWeight: "700", color: "var(--forest-dark)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {session.user.name || "User"}
            </p>
            <p style={{ margin: "0", fontSize: "0.72rem", color: "var(--muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {session.user.email}
            </p>
          </div>
          <ChevronDown size={14} style={{ opacity: 0.6 }} />
        </button>

        {showUserMenu && (
          <div className="user-menu-dropdown">
            <div style={{ padding: "0.4rem 0.75rem", borderBottom: "1px solid var(--line)", marginBottom: "0.25rem" }}>
              <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>My Profile</p>
              <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--forest-dark)" }}>{session.user.name}</p>
            </div>
            <button className="user-menu-item" onClick={() => { navigate("/settings"); setShowUserMenu(false); }}>
              <User size={14} /> Profile Settings
            </button>
            <button className="user-menu-item" onClick={() => { navigate("/settings"); setShowUserMenu(false); }}>
              <Settings size={14} /> Workspace Preferences
            </button>
            <button
              className="user-menu-item"
              onClick={() => {
                const dark = document.documentElement.getAttribute("data-theme") === "dark";
                document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
                alert(`Theme toggled! Premium dark mode configuration updated.`);
                setShowUserMenu(false);
              }}
            >
              <Sparkles size={14} /> Toggle Theme (Light/Dark)
            </button>
            <div style={{ height: "1px", background: "var(--line)", margin: "0.25rem 0" }} />
            <button className="user-menu-item" onClick={onLogout} style={{ color: "var(--status-red)" }}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
