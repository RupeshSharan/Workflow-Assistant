export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
}

export interface TenantContext {
  orgId: string;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "manager" | "member" | "viewer";
}
