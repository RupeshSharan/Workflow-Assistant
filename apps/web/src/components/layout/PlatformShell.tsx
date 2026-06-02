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

  const activeWorkspaceId = session.activeWorkspaceId ?? session.workspaces[0]?.id ?? null;
  const scopedSession = { ...session, activeWorkspaceId };
  const activeWorkspace = session.workspaces.find((workspace) => workspace.id === activeWorkspaceId);

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
