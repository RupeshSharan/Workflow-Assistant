import { useNavigate, useLocation } from "react-router-dom";
import { Sparkles, LayoutDashboard, Workflow as WorkflowIcon, FileText, Bot, Zap, BarChart2, Settings, LogOut } from "lucide-react";
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

  const getButtonClass = (path: string) => {
    return location.pathname === path ? "selected" : "";
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <div>
          <strong>FlowAI</strong>
          <small>Platform</small>
        </div>
      </div>
      <label className="workspace-picker">
        <span>Workspace</span>
        <select value={activeWorkspace.id} onChange={(event) => onSelectWorkspace(event.target.value)}>
          {session.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.orgName} / {workspace.name}
            </option>
          ))}
        </select>
      </label>
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
      <button className="signout" onClick={onLogout}>
        <LogOut size={17} /> Sign out
      </button>
    </aside>
  );
}
