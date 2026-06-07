import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useOutletContext,
  useSearchParams,
  useNavigate
} from "react-router-dom";
import { api } from "./api";
import { ToastProvider } from "./context/ToastContext";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { PlatformShell } from "./components/layout/PlatformShell";
import { AuthScreen } from "./pages/AuthScreen";
import { AcceptInvitationScreen } from "./pages/AcceptInvitationScreen";
import { Dashboard } from "./pages/Dashboard";
import { WorkflowBuilder } from "./pages/WorkflowBuilder";
import { DocumentsPage } from "./pages/DocumentsPage";
import { AssistantPage } from "./pages/AssistantPage";
import { AutomationPage } from "./pages/AutomationPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationCenter } from "./pages/NotificationCenter";
import { BoardPage } from "./pages/BoardPage";
import type { Session, Workspace } from "./types";

const SESSION_KEY = "workflow-platform-session";

function readSession(): Session | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as Session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

// Sub-page wrapper components to inject parameters from the Router Outlet Context
function DashboardWrapper() {
  const { session } = useOutletContext<{ session: Session }>();
  return <Dashboard session={session} />;
}

function BoardPageWrapper() {
  const { session } = useOutletContext<{ session: Session }>();
  return <BoardPage session={session} />;
}

function WorkflowBuilderWrapper() {
  const { session, activeWorkspace } = useOutletContext<{ session: Session; activeWorkspace: Workspace }>();
  return <WorkflowBuilder session={session} canEdit={activeWorkspace.role !== "viewer"} />;
}

function DocumentsPageWrapper() {
  const { session, activeWorkspace } = useOutletContext<{ session: Session; activeWorkspace: Workspace }>();
  return <DocumentsPage session={session} canContribute={activeWorkspace.role !== "viewer"} />;
}

function AssistantPageWrapper() {
  const { session, aiPreFillCommand, setAiPreFillCommand } = useOutletContext<{
    session: Session;
    aiPreFillCommand: string;
    setAiPreFillCommand: (val: string) => void;
  }>();
  return (
    <AssistantPage
      session={session}
      initialCommand={aiPreFillCommand}
      onCommandUsed={() => setAiPreFillCommand("")}
    />
  );
}

function AutomationPageWrapper() {
  const { session, activeWorkspace } = useOutletContext<{ session: Session; activeWorkspace: Workspace }>();
  return (
    <AutomationPage
      session={session}
      canConfigure={["owner", "admin", "manager"].includes(activeWorkspace.role)}
    />
  );
}

function AnalyticsPageWrapper() {
  const { session } = useOutletContext<{ session: Session }>();
  return <AnalyticsPage session={session} />;
}

function SettingsPageWrapper() {
  const { session, activeWorkspace, onSessionChange } = useOutletContext<{
    session: Session;
    activeWorkspace: Workspace;
    onSessionChange: (session: Session | null) => void;
  }>();
  return (
    <SettingsPage
      session={session}
      activeRole={activeWorkspace.role}
      onSessionChange={onSessionChange}
    />
  );
}

function NotificationCenterWrapper() {
  const { session } = useOutletContext<{ session: Session }>();
  return <NotificationCenter session={session} />;
}

interface AcceptInvitationWrapperProps {
  session: Session | null;
  onAccepted: (session: Session) => void;
}

function AcceptInvitationWrapper({
  session,
  onAccepted
}: AcceptInvitationWrapperProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  return (
    <AcceptInvitationScreen
      token={token}
      session={session}
      onAccepted={(newSession) => {
        onAccepted(newSession);
        navigate("/dashboard");
      }}
      onCancel={() => {
        navigate("/");
      }}
    />
  );
}

// Root redirect handler to check for incoming legacy invite links
function InviteRedirector() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  if (token) {
    return <Navigate to={`/accept-invitation?token=${token}`} replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export function App() {
  const [session, setSession] = useState<Session | null>(readSession);

  function saveSession(nextSession: Session | null) {
    setSession(nextSession);
    if (nextSession) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  useEffect(() => {
    if (!session) return;
    api.refresh(session)
      .then((newSession) => {
        saveSession({
          ...session,
          token: newSession.token,
          workspaces: newSession.workspaces
        });
      })
      .catch(() => {
        saveSession(null);
      });
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route
              path="/login"
              element={
                !session ? (
                  <AuthScreen onAuthenticated={saveSession} />
                ) : (
                  <Navigate to="/dashboard" replace />
                )
              }
            />

            <Route
              path="/accept-invitation"
              element={
                <AcceptInvitationWrapper
                  session={session}
                  onAccepted={saveSession}
                />
              }
            />

            {/* Private Shell Routes */}
            <Route
              path="/"
              element={
                session ? (
                  <PlatformShell session={session} onSessionChange={saveSession} />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            >
              <Route index element={<InviteRedirector />} />
              <Route path="dashboard" element={<DashboardWrapper />} />
              <Route path="board" element={<BoardPageWrapper />} />
              <Route path="workflows" element={<WorkflowBuilderWrapper />} />
              <Route path="documents" element={<DocumentsPageWrapper />} />
              <Route path="ai" element={<AssistantPageWrapper />} />
              <Route path="automations" element={<AutomationPageWrapper />} />
              <Route path="analytics" element={<AnalyticsPageWrapper />} />
              <Route path="settings" element={<SettingsPageWrapper />} />
              <Route path="notifications" element={<NotificationCenterWrapper />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  );
}
