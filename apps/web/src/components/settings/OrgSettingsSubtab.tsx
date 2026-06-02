import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Zap, SlidersHorizontal } from "lucide-react";
import { api } from "../../api";
import type { Session } from "../../types";

interface OrgSettingsSubtabProps {
  session: Session;
  activeRole: string;
}

export function OrgSettingsSubtab({ session, activeRole }: OrgSettingsSubtabProps) {
  const queryClient = useQueryClient();
  const isOwnerOrAdmin = ["owner", "admin"].includes(activeRole);

  const orgMembers = useQuery({
    queryKey: ["org-members", session.activeWorkspaceId],
    queryFn: () => api.orgMembers(session)
  });

  const invitations = useQuery({
    queryKey: ["invitations", session.activeWorkspaceId],
    queryFn: () => api.listInvitations(session)
  });

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: string }) =>
      api.updateOrgMemberRole(session, input.userId, input.role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org-members"] });
    }
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.removeOrgMember(session, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["org-members"] });
    }
  });

  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; role: string; workspaceId?: string }) =>
      api.createInvitation(session, input.email, input.role, input.workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    }
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => api.revokeInvitation(session, invitationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    }
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "member" | "viewer">("member");
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState("");
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    setCreatedInviteUrl(null);
    inviteMutation.mutate(
      {
        email: inviteEmail,
        role: inviteRole,
        workspaceId: inviteWorkspaceId || undefined
      },
      {
        onSuccess: (data) => {
          setCreatedInviteUrl(data.inviteUrl);
          setInviteEmail("");
        }
      }
    );
  }

  return (
    <div className="settings-grid">
      <article className="settings-card members-card">
        <header>
          <Users size={18} />
          <div>
            <h4>Organization Members</h4>
            <p>Manage organization-wide users and access roles</p>
          </div>
        </header>

        <div className="member-list" style={{ marginTop: "1rem" }}>
          {orgMembers.data?.members.map((member) => (
            <div
              key={member.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.5rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                <p>
                  <strong>
                    {member.name} {member.id === session.user.id && <small>(You)</small>}
                  </strong>
                  <small>{member.email}</small>
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {isOwnerOrAdmin && member.id !== session.user.id && member.role !== "owner" ? (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => roleMutation.mutate({ userId: member.id, role: e.target.value })}
                      style={{
                        background: "rgba(0,0,0,0.2)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "4px",
                        padding: "2px 4px",
                        fontSize: "0.85rem",
                        color: "white"
                      }}
                      disabled={roleMutation.isPending}
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      className="signout"
                      style={{ padding: "3px 8px", fontSize: "0.8rem", margin: 0, height: "auto" }}
                      onClick={() => {
                        if (confirm(`Remove ${member.name} from the organization?`)) {
                          removeMutation.mutate(member.id);
                        }
                      }}
                      disabled={removeMutation.isPending}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <em style={{ textTransform: "capitalize" }}>{member.role}</em>
                )}
              </div>
            </div>
          ))}
          {orgMembers.isLoading && <p>Loading organization members...</p>}
        </div>
      </article>

      <article className="settings-card">
        <header>
          <Zap size={18} />
          <div>
            <h4>Invite Team Members</h4>
            <p>Generate secure tokens to link users to this space</p>
          </div>
        </header>

        {isOwnerOrAdmin ? (
          <form onSubmit={handleInvite} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
            <label className="field">
              <span>Invited Member Email</span>
              <input
                type="email"
                placeholder="colleague@company.com"
                value={inviteEmail}
                required
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <label className="field">
                <span>Access Role</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "4px",
                    padding: "8px",
                    color: "white"
                  }}
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              <label className="field">
                <span>Limit to Workspace</span>
                <select
                  value={inviteWorkspaceId}
                  onChange={(e) => setInviteWorkspaceId(e.target.value)}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "4px",
                    padding: "8px",
                    color: "white"
                  }}
                >
                  <option value="">Organization Default</option>
                  {session.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {inviteMutation.error && <p className="form-error">{inviteMutation.error.message}</p>}
            <button className="primary" type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Generating..." : "Generate Invite Token"}
            </button>

            {createdInviteUrl && (
              <div
                style={{
                  padding: "0.75rem",
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  borderRadius: "6px"
                }}
              >
                <p style={{ color: "#10b981", fontSize: "0.85rem", fontWeight: "bold" }}>Invite Token URL Generated!</p>
                <p
                  style={{
                    fontSize: "0.8rem",
                    wordBreak: "break-all",
                    background: "rgba(0,0,0,0.3)",
                    padding: "4px",
                    borderRadius: "4px",
                    marginTop: "4px"
                  }}
                >
                  {createdInviteUrl}
                </p>
                <button
                  type="button"
                  className="secondary full"
                  style={{ marginTop: "6px", fontSize: "0.8rem", padding: "4px" }}
                  onClick={() => {
                    navigator.clipboard.writeText(createdInviteUrl);
                    alert("Copied to clipboard!");
                  }}
                >
                  Copy URL Link
                </button>
              </div>
            )}
          </form>
        ) : (
          <p className="muted-message" style={{ marginTop: "1rem" }}>
            Only organization administrators can invite new members.
          </p>
        )}
      </article>

      <article className="settings-card fields-card">
        <header>
          <SlidersHorizontal size={18} />
          <div>
            <h4>Pending Invitations</h4>
            <p>Active unused secure invite tokens</p>
          </div>
        </header>

        <div className="member-list" style={{ marginTop: "1rem" }}>
          {invitations.data?.invitations
            .filter((i: any) => i.status === "pending")
            .map((invite: any) => (
              <div
                key={invite.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "0.5rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)"
                }}
              >
                <div>
                  <p>
                    <strong>{invite.email}</strong>
                    <small>
                      Role: {invite.role} | Invited by: {invite.invitedBy}
                    </small>
                  </p>
                  <small style={{ color: "rgba(255,255,255,0.4)" }}>
                    Expires: {new Date(invite.expiresAt).toLocaleDateString()}
                  </small>
                </div>
                {isOwnerOrAdmin && (
                  <button
                    className="signout"
                    style={{ padding: "3px 8px", fontSize: "0.8rem", margin: 0, height: "auto" }}
                    onClick={() => {
                      if (confirm("Revoke this invitation?")) {
                        revokeMutation.mutate(invite.id);
                      }
                    }}
                    disabled={revokeMutation.isPending}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          {invitations.isLoading && <p>Loading invitations...</p>}
          {!invitations.data?.invitations.filter((i: any) => i.status === "pending").length && (
            <p className="muted-message" style={{ marginTop: "1rem" }}>
              No pending invitations.
            </p>
          )}
        </div>
      </article>
    </div>
  );
}
