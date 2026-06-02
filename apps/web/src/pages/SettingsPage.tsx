import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Workflow as WorkflowIcon, SlidersHorizontal } from "lucide-react";
import { api } from "../api";
import { AddMemberForm } from "../components/settings/AddMemberForm";
import { CreateWorkspaceForm } from "../components/settings/CreateWorkspaceForm";
import { CreateFieldForm } from "../components/settings/CreateFieldForm";
import { OrgSettingsSubtab } from "../components/settings/OrgSettingsSubtab";
import { AuditLogSubtab } from "../components/settings/AuditLogSubtab";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session, CustomField } from "../types";

interface SettingsPageProps {
  session: Session;
  activeRole: string;
  onSessionChange: (session: Session | null) => void;
}

export function SettingsPage({
  session,
  activeRole,
  onSessionChange
}: SettingsPageProps) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<"workspace" | "organization" | "activity">("workspace");
  const canConfigure = ["owner", "admin", "manager"].includes(activeRole);
  const canCreateWorkspace = ["owner", "admin"].includes(activeRole);

  const members = useQuery({
    queryKey: ["members", session.activeWorkspaceId],
    queryFn: () => api.members(session)
  });

  const fields = useQuery({
    queryKey: ["custom-fields", session.activeWorkspaceId],
    queryFn: () => api.customFields(session)
  });

  const workspaceMutation = useMutation({
    mutationFn: (input: { name: string; visibility: "private" | "organization" }) =>
      api.createWorkspace(session, input),
    onSuccess: async () => {
      const workspaces = await api.workspaces(session);
      onSessionChange({ ...session, workspaces: workspaces.workspaces });
    }
  });

  const memberMutation = useMutation({
    mutationFn: (input: { email: string; role: "admin" | "manager" | "member" | "viewer" }) =>
      api.addMember(session, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["members", session.activeWorkspaceId] })
  });

  const fieldMutation = useMutation({
    mutationFn: (input: {
      name: string;
      fieldType: CustomField["fieldType"];
      isRequired: boolean;
      options: string[];
    }) => api.createCustomField(session, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["custom-fields", session.activeWorkspaceId] })
  });

  return (
    <section className="settings-page">
      <div className="page-intro">
        <p className="eyebrow">Administration</p>
        <h3>Shape this workspace and organization.</h3>
        <p>Manage access permissions, workspace layouts, and custom database fields.</p>
      </div>

      <div className="tab-row" style={{ marginBottom: "2rem" }}>
        <button className={subTab === "workspace" ? "active" : ""} onClick={() => setSubTab("workspace")}>
          Workspace Settings
        </button>
        <button className={subTab === "organization" ? "active" : ""} onClick={() => setSubTab("organization")}>
          Organization Admin
        </button>
        {["owner", "admin"].includes(activeRole) && (
          <button className={subTab === "activity" ? "active" : ""} onClick={() => setSubTab("activity")}>
            Activity Feed & Audit Log
          </button>
        )}
      </div>

      {subTab === "workspace" ? (
        <div className="settings-grid">
          <article className="settings-card members-card">
            <header>
              <Users size={18} />
              <div>
                <h4>Members</h4>
                <p>Role-based workspace access</p>
              </div>
            </header>
            {canConfigure && <AddMemberForm onSubmit={(input) => memberMutation.mutate(input)} />}
            {memberMutation.error && <p className="form-error">{memberMutation.error.message}</p>}
            <div className="member-list">
              {members.isLoading ? (
                <LoadingSpinner message="Loading members..." />
              ) : (
                members.data?.members.map((member) => (
                  <div key={member.id}>
                    <span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                    <p>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </p>
                    <em>{member.role}</em>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="settings-card">
            <header>
              <WorkflowIcon size={18} />
              <div>
                <h4>Related workspaces</h4>
                <p>Separate projects under one organization</p>
              </div>
            </header>
            {canCreateWorkspace ? (
              <CreateWorkspaceForm onSubmit={(input) => workspaceMutation.mutate(input)} />
            ) : (
              <p className="muted-message">Only owners and administrators can provision workspaces.</p>
            )}
            {workspaceMutation.error && <p className="form-error">{workspaceMutation.error.message}</p>}
          </article>

          <article className="settings-card fields-card">
            <header>
              <SlidersHorizontal size={18} />
              <div>
                <h4>Custom fields</h4>
                <p>Capture data specific to this workflow</p>
              </div>
            </header>
            {canConfigure && <CreateFieldForm onSubmit={(input) => fieldMutation.mutate(input)} />}
            {fieldMutation.error && <p className="form-error">{fieldMutation.error.message}</p>}
            <div className="field-pills">
              {fields.isLoading ? (
                <LoadingSpinner message="Loading fields..." />
              ) : (
                fields.data?.fields.map((field) => (
                  <span key={field.id}>
                    {field.name}
                    <small>{field.fieldType.replace("_", " ")}</small>
                  </span>
                ))
              )}
              {!fields.isLoading && !fields.data?.fields.length && (
                <p className="muted-message">No custom fields configured yet.</p>
              )}
            </div>
          </article>
        </div>
      ) : subTab === "organization" ? (
        <OrgSettingsSubtab session={session} activeRole={activeRole} />
      ) : (
        <AuditLogSubtab session={session} />
      )}
    </section>
  );
}
