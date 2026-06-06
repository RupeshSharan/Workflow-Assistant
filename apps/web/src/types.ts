export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Workspace {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  role: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

export interface CustomField {
  id: string;
  name: string;
  fieldType: "text" | "number" | "date" | "select" | "multi_select" | "boolean" | "user";
  isRequired: boolean;
  options: string[];
  appliesToTypeId: string | null;
  appliesToTypeName: string | null;
}

export interface ItemCustomField extends CustomField {
  value: unknown;
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  userName: string;
}

export interface HistoryEntry {
  id: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: string;
  changedBy: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: string;
  summary: string | null;
  status: "uploaded" | "processing" | "indexed" | "failed" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface SearchMatch {
  documentId: string;
  title: string;
  chunkId: string;
  chunkText: string;
  similarity: number;
}

export interface WorkflowDraft {
  name: string;
  description: string;
  category: string;
  stages: Array<{
    name: string;
    color: string;
    isTerminal: boolean;
  }>;
}

export type CommandAction = (
  | {
      tool: "create_work_item";
      rationale: string;
      arguments: {
        title: string;
        description?: string | null;
        priority: WorkItem["priority"];
      };
    }
  | {
      tool: "search_documents";
      rationale: string;
      arguments: {
        query: string;
        topK: number;
      };
    }
  | {
      tool: "update_work_item_status";
      rationale: string;
      arguments: {
        itemTitle: string;
        stageName: string;
      };
    }
  | {
      tool: "assign_work_item";
      rationale: string;
      arguments: {
        itemTitle: string;
        assigneeName: string;
      };
    }
) & {
  intent: string;
  confidence: number;
  required_sources: string[];
  suggested_action: string;
  can_execute: boolean;
};

export interface WorkspaceMemory {
  name: string;
  purpose: string;
  defaultWorkflow: { templateName: string; stages: string[] } | null;
  activeUsers: string[];
  keyDocs: string[];
  goals: string[];
  rules: string[];
}

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: "work_item.created";
  condition: { priority?: WorkItem["priority"] };
  action: { type: "notify_creator"; title: string; body: string };
  isActive: boolean;
}

export interface AutomationRun {
  id: string;
  ruleName: string;
  triggerSource: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  result: Record<string, unknown>;
  executedAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface Session {
  token: string;
  user: User;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  color: string;
  slaHours: number | null;
  isTerminal: boolean;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  isDefault: boolean;
  stages: Stage[];
}

export interface WorkItem {
  id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  stageId: string;
  stageName: string;
  stageColor: string;
  stageTerminal: boolean;
  typeName: string;
  templateId: string;
  templateName: string;
  assigneeName: string | null;
  reporterName: string;
}

export interface Summary {
  workspace: { id: string; name: string };
  metrics: { total: number; overdue: number; priority: number };
  stages: Array<{ id: string; name: string; color: string; position: number; count: number }>;
}

export interface StageBottleneck {
  stageId: string;
  stageName: string;
  color: string;
  avgHours: number;
  itemCount: number;
}

export interface ProductivityStats {
  completedItemsPerUser: Array<{
    userId: string;
    userName: string;
    completedCount: number;
  }>;
  activeItemsPerUser: Array<{
    userId: string;
    userName: string;
    activeCount: number;
  }>;
  cycleTimeStats: {
    avgHoursClosed: number;
    closedCount: number;
    totalCount: number;
  };
  priorityBreakdown: Array<{
    priority: string;
    count: number;
  }>;
  weeklyVelocity: Array<{
    weekStart: string;
    count: number;
  }>;
}

export interface AdaptiveInsight {
  title: string;
  suggestion: string;
  expectedImpact: string;
  stageId: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "revoked";
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

export interface InvitationDetails {
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  orgName: string;
  workspaceName: string | null;
  invitedByName: string;
}

export interface AuditLog {
  id: string;
  orgId: string;
  workspaceId: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  workspaceName: string | null;
}


