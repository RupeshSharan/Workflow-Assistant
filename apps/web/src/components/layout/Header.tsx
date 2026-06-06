import { useNavigate } from "react-router-dom";
import { Search, Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Session, Workspace } from "../../types";

interface HeaderProps {
  session: Session;
  activeWorkspace: Workspace;
  onOpenCommandPalette: () => void;
}

export function Header({ session, activeWorkspace, onOpenCommandPalette }: HeaderProps) {
  const navigate = useNavigate();

  // Query unread notifications count in real-time
  const notifications = useQuery({
    queryKey: ["notifications", session.activeWorkspaceId],
    queryFn: () => api.notifications(session)
  });

  const unreadCount = (notifications.data?.notifications ?? []).filter(
    (n) => !n.readAt
  ).length;

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
      <button
        className="icon-button"
        aria-label="Notifications"
        onClick={() => navigate("/notifications")}
        style={{ position: "relative" }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              background: "var(--status-red)",
              color: "white",
              borderRadius: "50%",
              width: "16px",
              height: "16px",
              fontSize: "0.65rem",
              fontWeight: "700",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>
    </header>
  );
}
