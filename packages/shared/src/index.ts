import { z } from "zod";

// Pagination
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export interface PaginationMetadata {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Work items
export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const createWorkItemSchema = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: prioritySchema.default("medium"),
  typeId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional()
});

export const updateWorkItemSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: prioritySchema.optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional()
  })
  .refine((body) => Object.keys(body).length > 0, "At least one editable field is required.");

export const transitionWorkItemSchema = z.object({ toStageId: z.string().uuid() });
export const commentWorkItemSchema = z.object({ content: z.string().trim().min(1).max(5000) });

// Workspaces
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  visibility: z.enum(["private", "organization"]).default("private")
});

export const workspaceMemberSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "manager", "member", "viewer"]).default("member")
});

// Documents
export const createDocumentSchema = z.object({
  title: z.string().trim().min(2).max(240),
  sourceType: z.enum(["note", "plain_text"]).default("note"),
  contentText: z.string().trim().min(1).max(200_000)
});

export const documentSearchSchema = z.object({
  query: z.string().trim().min(2).max(1000),
  topK: z.number().int().min(1).max(20).default(5)
});

// Invitations
export const createInvitationSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "manager", "member", "viewer"]).default("member"),
  workspaceId: z.string().uuid().optional()
});

export const acceptInvitationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(128).optional()
});
