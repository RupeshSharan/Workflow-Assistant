import type {
  AutomationRule,
  AutomationRun,
  CommandAction,
  Comment,
  CustomField,
  DecisionLogEntry,
  HistoryEntry,
  ItemCustomField,
  Goal,
  GoalProbability,
  KnowledgeDocument,
  Member,
  Notification,
  Session,
  SearchMatch,
  Summary,
  TimelineEvent,
  WorkItem,
  Workflow,
  WorkflowDraft,
  Workspace,
  WorkspaceMemory,
  StageBottleneck,
  ProductivityStats,
  AdaptiveInsight,
  Invitation,
  InvitationDetails,
  AuditLog
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

interface RequestOptions {
  method?: string;
  body?: unknown;
  session?: Session;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.session) {
    headers.authorization = `Bearer ${options.session.token}`;
    if (options.session.activeWorkspaceId) {
      headers["x-workspace-id"] = options.session.activeWorkspaceId;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = (await response.json()) as any;

  if (!response.ok) {
    let errorMsg = "Request failed.";
    if (body && body.error) {
      if (typeof body.error === "object" && body.error.message) {
        errorMsg = body.error.message;
      } else if (typeof body.error === "string") {
        errorMsg = body.error;
      }
    }
    throw new Error(errorMsg);
  }
  return body as T;
}

export const api = {
  register(input: {
    name: string;
    email: string;
    password: string;
    organizationName: string;
    workspaceName: string;
  }): Promise<Session> {
    return request<Session>("/auth/register", { method: "POST", body: input });
  },

  login(input: { email: string; password: string }): Promise<Session> {
    return request<Session>("/auth/login", { method: "POST", body: input });
  },

  logout(): Promise<{ success: boolean; message: string }> {
    return request("/auth/logout", { method: "POST" });
  },

  refresh(session: Session): Promise<Session> {
    return request<Session>("/auth/refresh", { method: "POST", session });
  },

  workspaces(session: Session): Promise<{ workspaces: Workspace[] }> {
    return request("/workspaces", { session });
  },

  createWorkspace(
    session: Session,
    input: { name: string; description?: string; visibility: "private" | "organization" }
  ): Promise<{ id: string }> {
    return request("/workspaces", { method: "POST", session, body: input });
  },

  members(session: Session): Promise<{ members: Member[] }> {
    return request(`/workspaces/${session.activeWorkspaceId}/members`, { session });
  },

  addMember(
    session: Session,
    input: { email: string; role: "admin" | "manager" | "member" | "viewer" }
  ): Promise<{ member: Member }> {
    return request(`/workspaces/${session.activeWorkspaceId}/members`, {
      method: "POST",
      session,
      body: input
    });
  },

  workflows(session: Session): Promise<{ workflows: Workflow[] }> {
    return request("/workflow-templates", { session });
  },

  workItems(session: Session): Promise<{ items: WorkItem[] }> {
    return request("/work-items", { session });
  },

  summary(session: Session): Promise<Summary> {
    return request("/dashboard/summary", { session });
  },

  createItem(
    session: Session,
    input: {
      title: string;
      description?: string;
      priority: WorkItem["priority"];
      templateId?: string;
    }
  ): Promise<{ item: WorkItem }> {
    return request("/work-items", { method: "POST", session, body: input });
  },

  transitionItem(session: Session, itemId: string, toStageId: string): Promise<{ item: WorkItem }> {
    return request(`/work-items/${itemId}/transitions`, {
      method: "POST",
      session,
      body: { toStageId }
    });
  },

  itemFields(session: Session, itemId: string): Promise<{ fields: ItemCustomField[] }> {
    return request(`/work-items/${itemId}/custom-fields`, { session });
  },

  updateItemFields(
    session: Session,
    itemId: string,
    values: Array<{ customFieldId: string; value: unknown }>
  ): Promise<{ fields: ItemCustomField[] }> {
    return request(`/work-items/${itemId}/custom-fields`, {
      method: "PUT",
      session,
      body: { values }
    });
  },

  comments(session: Session, itemId: string): Promise<{ comments: Comment[] }> {
    return request(`/work-items/${itemId}/comments`, { session });
  },

  addComment(session: Session, itemId: string, content: string): Promise<{ comment: Comment }> {
    return request(`/work-items/${itemId}/comments`, { method: "POST", session, body: { content } });
  },

  history(session: Session, itemId: string): Promise<{ history: HistoryEntry[] }> {
    return request(`/work-items/${itemId}/history`, { session });
  },

  createWorkflow(
    session: Session,
    input: {
      name: string;
      category: string;
      isDefault: boolean;
      stages: Array<{ name: string; color: string; isTerminal: boolean }>;
    }
  ): Promise<{ id: string }> {
    return request("/workflow-templates", { method: "POST", session, body: input });
  },

  customFields(session: Session): Promise<{ fields: CustomField[] }> {
    return request("/custom-fields", { session });
  },

  createCustomField(
    session: Session,
    input: {
      name: string;
      fieldType: CustomField["fieldType"];
      isRequired: boolean;
      options: string[];
    }
  ): Promise<{ field: CustomField }> {
    return request("/custom-fields", { method: "POST", session, body: input });
  },

  documents(session: Session): Promise<{ documents: KnowledgeDocument[] }> {
    return request("/documents", { session });
  },

  createDocument(
    session: Session,
    input: { title: string; sourceType: "note" | "plain_text"; contentText: string }
  ): Promise<{ document: KnowledgeDocument }> {
    return request("/documents", { method: "POST", session, body: input });
  },

  uploadDocument(session: Session, file: File, title?: string): Promise<{ document: KnowledgeDocument }> {
    const headers: Record<string, string> = {};
    if (session.token) {
      headers.authorization = `Bearer ${session.token}`;
      if (session.activeWorkspaceId) {
        headers["x-workspace-id"] = session.activeWorkspaceId;
      }
    }
    const formData = new FormData();
    formData.append("file", file);
    if (title) {
      formData.append("title", title);
    }
    return fetch(`${API_BASE}/documents/upload`, {
      method: "POST",
      headers,
      body: formData
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || body?.error || "Upload failed.");
      }
      return body;
    });
  },

  indexDocument(session: Session, documentId: string): Promise<{ document: KnowledgeDocument; chunks: number }> {
    return request(`/documents/${documentId}/index`, { method: "POST", session });
  },

  searchDocuments(
    session: Session,
    input: { query: string; topK?: number }
  ): Promise<{ matches: SearchMatch[] }> {
    return request("/documents/search", { method: "POST", session, body: input });
  },

  groundedChat(
    session: Session,
    question: string
  ): Promise<{
    answer: string;
    sources: SearchMatch[];
    runId: string;
    confidence?: number;
    insufficientContext?: boolean;
    sourcesUsed?: string[];
    workspaceContextUsed?: any;
  }> {
    return request("/ai/chat", { method: "POST", session, body: { question } });
  },

  workspaceMemory(session: Session): Promise<WorkspaceMemory> {
    return request("/ai/workspace-memory", { session });
  },

  draftWorkflow(session: Session, prompt: string): Promise<{ draft: WorkflowDraft; runId: string }> {
    return request("/ai/workflow-draft", { method: "POST", session, body: { prompt } });
  },

  previewCommand(
    session: Session,
    command: string
  ): Promise<{ action: CommandAction; runId: string; requiresConfirmation: boolean }> {
    return request("/ai/command/preview", { method: "POST", session, body: { command } });
  },

  executeCommand(session: Session, previewRunId: string): Promise<{ result: unknown; runId: string }> {
    return request("/ai/command/execute", {
      method: "POST",
      session,
      body: { confirmed: true, previewRunId }
    });
  },

  automationRules(session: Session): Promise<{ rules: AutomationRule[] }> {
    return request("/automation/rules", { session });
  },

  automationRuns(session: Session): Promise<{ runs: AutomationRun[] }> {
    return request("/automation/runs", { session });
  },

  createAutomationRule(
    session: Session,
    input: {
      name: string;
      triggerType: "work_item.created";
      condition: { priority?: WorkItem["priority"] };
      action: { type: "notify_creator"; title: string; body: string };
    }
  ): Promise<{ rule: AutomationRule }> {
    return request("/automation/rules", { method: "POST", session, body: input });
  },

  notifications(session: Session): Promise<{ notifications: Notification[] }> {
    return request("/notifications", { session });
  },

  readNotification(session: Session, notificationId: string): Promise<{ notification: Notification }> {
    return request(`/notifications/${notificationId}/read`, { method: "POST", session });
  },

  workflowBottlenecks(session: Session): Promise<{ bottlenecks: StageBottleneck[] }> {
    return request("/analytics/workflow-bottlenecks", { session });
  },

  productivityStats(session: Session): Promise<ProductivityStats> {
    return request("/analytics/productivity", { session });
  },

  adaptiveInsights(session: Session): Promise<{ suggestions: AdaptiveInsight[] }> {
    return request("/analytics/adaptive-insights", { session });
  },

  generateWorkspaceReport(session: Session): Promise<{ document: KnowledgeDocument }> {
    return request("/analytics/report", { method: "POST", session });
  },

  orgMembers(session: Session): Promise<{ members: Member[] }> {
    return request("/org/members", { session });
  },

  updateOrgMemberRole(session: Session, userId: string, role: string): Promise<{ message: string }> {
    return request(`/org/members/${userId}/role`, { method: "PATCH", session, body: { role } });
  },

  removeOrgMember(session: Session, userId: string): Promise<{ message: string }> {
    return request(`/org/members/${userId}`, { method: "DELETE", session });
  },

  listInvitations(session: Session): Promise<{ invitations: Invitation[] }> {
    return request("/invitations", { session });
  },

  createInvitation(session: Session, email: string, role: string, workspaceId?: string): Promise<{ invitation: Invitation; inviteUrl: string }> {
    return request("/invitations", { method: "POST", session, body: { email, role, workspaceId } });
  },

  revokeInvitation(session: Session, invitationId: string): Promise<{ message: string }> {
    return request(`/invitations/${invitationId}`, { method: "DELETE", session });
  },

  getInvitationDetails(token: string): Promise<{ invitation: InvitationDetails }> {
    return request(`/invitations/${token}`);
  },

  acceptInvitation(token: string, name?: string, password?: string): Promise<Session> {
    return request(`/invitations/${token}/accept`, { method: "POST", body: { name, password } });
  },

  auditLogs(session: Session): Promise<{ logs: AuditLog[] }> {
    return request("/org/audit-logs", { session });
  },

  dailyStandup(session: Session): Promise<{ standup: string }> {
    return request("/ai/daily-standup", { session });
  },

  projectHealth(session: Session): Promise<{ score: number; drivers: string[] }> {
    return request("/ai/project-health", { session });
  },

  meetingTranscript(session: Session, transcript: string): Promise<{ summary: string; tasks: any[] }> {
    return request("/ai/meeting-transcript", { method: "POST", session, body: { transcript } });
  },

  meetingExecute(session: Session, tasks: any[]): Promise<{ success: boolean; count: number }> {
    return request("/ai/meeting-execute", { method: "POST", session, body: { tasks } });
  },

  knowledgeGraph(session: Session): Promise<{ nodes: any[]; links: any[] }> {
    return request("/ai/knowledge-graph", { session });
  },

  workflowSimulation(session: Session, reviewersCount: number, taskArrivalRate: number, wipLimit: number): Promise<{ workflowName: string; simulationMetrics: any[]; advice: string }> {
    return request("/ai/workflow-simulation", { method: "POST", session, body: { reviewersCount, taskArrivalRate, wipLimit } });
  },

  autoDocument(session: Session): Promise<{ success: boolean; documentId: string; changelog: string }> {
    return request("/ai/auto-document", { method: "POST", session });
  },

  presetsMarketplace(session: Session): Promise<{ presets: any[] }> {
    return request("/ai/workflow-presets", { session });
  },

  // Decision Log
  decisionLog(session: Session, limit?: number, offset?: number): Promise<{ decisions: DecisionLogEntry[]; total: number }> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    return request(`/ai/decision-log?${params}`, { session });
  },

  updateDecisionOutcome(session: Session, decisionId: string, outcome: string, notes?: string): Promise<{ success: boolean }> {
    return request(`/ai/decision-log/${decisionId}`, { method: 'PATCH', session, body: { outcome, outcomeNotes: notes } });
  },

  // Workspace Timeline
  workspaceTimeline(session: Session): Promise<{ events: TimelineEvent[] }> {
    return request('/ai/workspace-timeline', { session });
  },

  // Goals
  goals(session: Session): Promise<{ goals: Goal[] }> {
    return request('/ai/goals', { session });
  },

  createGoal(session: Session, input: { title: string; description?: string; targetDate?: string }): Promise<{ goal: Goal }> {
    return request('/ai/goals', { method: 'POST', session, body: input });
  },

  updateGoal(session: Session, goalId: string, input: { title?: string; description?: string; targetDate?: string; status?: string }): Promise<{ goal: Goal }> {
    return request(`/ai/goals/${goalId}`, { method: 'PATCH', session, body: input });
  },

  deleteGoal(session: Session, goalId: string): Promise<{ success: boolean }> {
    return request(`/ai/goals/${goalId}`, { method: 'DELETE', session });
  },

  goalProbability(session: Session, goalId: string): Promise<GoalProbability> {
    return request(`/ai/goal-probability/${goalId}`, { session });
  }
};
