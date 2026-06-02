import { useNavigate } from "react-router-dom";
import { Search, Bell } from "lucide-react";
import type { Workspace } from "../../types";

interface HeaderProps {
  activeWorkspace: Workspace;
  onOpenCommandPalette: () => void;
}

export function Header({ activeWorkspace, onOpenCommandPalette }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{activeWorkspace.orgName}</p>
        <h2>{activeWorkspace.name}</h2>
      </div>
      <div className="command-placeholder" style={{ cursor: "pointer" }} onClick={onOpenCommandPalette}>
        <Search size={17} />
        <span>Ask AI or run a command</span>
        <kbd>Ctrl+K</kbd>
      </div>
      <button className="icon-button" aria-label="Notifications" onClick={() => navigate("/notifications")}>
        <Bell size={18} />
      </button>
    </header>
  );
}
