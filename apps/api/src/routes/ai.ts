import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import { createWorkItem } from "../services/create-work-item.js";
import { chatCompletion, structuredChat } from "../services/ollama.js";
import { searchKnowledge } from "../services/semantic-search.js";
import { broadcastToWorkspace } from "../services/socket.js";

const groundedChatSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  topK: z.number().int().min(1).max(10).default(4)
});

const workflowPromptSchema = z.object({
  prompt: z.string().trim().min(5).max(2000)
});

const commandRequestSchema = z.object({
  command: z.string().trim().min(3).max(2000)
});

const commandPlanSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("create_work_item"),
    rationale: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(100),
    required_sources: z.array(z.string()),
    suggested_action: z.string().trim().min(1).max(500),
    can_execute: z.boolean(),
    arguments: z.object({
      title: z.string().trim().min(2).max(240),
      description: z.string().trim().max(5000).nullable().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
    })
  }),
  z.object({
    tool: z.literal("search_documents"),
    rationale: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(100),
    required_sources: z.array(z.string()),
    suggested_action: z.string().trim().min(1).max(500),
    can_execute: z.boolean(),
    arguments: z.object({
      query: z.string().trim().min(2).max(1000),
      topK: z.number().int().min(1).max(10).default(5)
    })
  }),
  z.object({
    tool: z.literal("update_work_item_status"),
    rationale: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(100),
    required_sources: z.array(z.string()),
    suggested_action: z.string().trim().min(1).max(500),
    can_execute: z.boolean(),
    arguments: z.object({
      itemTitle: z.string().trim().min(2).max(240),
      stageName: z.string().trim().min(2).max(80)
    })
  }),
  z.object({
    tool: z.literal("assign_work_item"),
    rationale: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(100),
    required_sources: z.array(z.string()),
    suggested_action: z.string().trim().min(1).max(500),
    can_execute: z.boolean(),
    arguments: z.object({
      itemTitle: z.string().trim().min(2).max(240),
      assigneeName: z.string().trim().min(2).max(120)
    })
  })
]);

const executeCommandSchema = z.object({
  confirmed: z.literal(true),
  previewRunId: z.string().uuid()
});

const workflowDraftSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000),
  category: z.string().trim().min(1).max(80),
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        isTerminal: z.boolean()
      })
    )
    .min(2)
    .max(12)
});

const workflowDraftFormat = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    stages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          isTerminal: { type: "boolean" }
        },
        required: ["name", "color", "isTerminal"]
      }
    }
  },
  required: ["name", "description", "category", "stages"]
};

const commandPlanFormat = {
  oneOf: [
    {
      type: "object",
      properties: {
        tool: { const: "create_work_item" },
        rationale: { type: "string" },
        intent: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        required_sources: { type: "array", items: { type: "string" } },
        suggested_action: { type: "string" },
        can_execute: { type: "boolean" },
        arguments: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
            priority: { enum: ["low", "medium", "high", "urgent"] }
          },
          required: ["title", "priority"]
        }
      },
      required: ["tool", "rationale", "intent", "confidence", "required_sources", "suggested_action", "can_execute", "arguments"]
    },
    {
      type: "object",
      properties: {
        tool: { const: "search_documents" },
        rationale: { type: "string" },
        intent: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        required_sources: { type: "array", items: { type: "string" } },
        suggested_action: { type: "string" },
        can_execute: { type: "boolean" },
        arguments: {
          type: "object",
          properties: {
            query: { type: "string" },
            topK: { type: "integer", minimum: 1, maximum: 10 }
          },
          required: ["query", "topK"]
        }
      },
      required: ["tool", "rationale", "intent", "confidence", "required_sources", "suggested_action", "can_execute", "arguments"]
    },
    {
      type: "object",
      properties: {
        tool: { const: "update_work_item_status" },
        rationale: { type: "string" },
        intent: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        required_sources: { type: "array", items: { type: "string" } },
        suggested_action: { type: "string" },
        can_execute: { type: "boolean" },
        arguments: {
          type: "object",
          properties: {
            itemTitle: { type: "string" },
            stageName: { type: "string" }
          },
          required: ["itemTitle", "stageName"]
        }
      },
      required: ["tool", "rationale", "intent", "confidence", "required_sources", "suggested_action", "can_execute", "arguments"]
    },
    {
      type: "object",
      properties: {
        tool: { const: "assign_work_item" },
        rationale: { type: "string" },
        intent: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 100 },
        required_sources: { type: "array", items: { type: "string" } },
        suggested_action: { type: "string" },
        can_execute: { type: "boolean" },
        arguments: {
          type: "object",
          properties: {
            itemTitle: { type: "string" },
            assigneeName: { type: "string" }
          },
          required: ["itemTitle", "assigneeName"]
        }
      },
      required: ["tool", "rationale", "intent", "confidence", "required_sources", "suggested_action", "can_execute", "arguments"]
    }
  ]
};

interface RunInput {
  taskType: string;
  input: unknown;
  output: unknown;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  success: boolean;
}

export const aiRouter = Router();

aiRouter.use(authenticate, requireWorkspaceContext);

async function recordRun(
  request: Express.Request,
  run: RunInput
): Promise<string> {
  const tenant = request.tenant!;
  const result = await query<{ id: string }>(
    `INSERT INTO ai_runs
       (org_id, workspace_id, user_id, model_name, task_type, input_json, output_json,
        latency_ms, tokens_in, tokens_out, success)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
     RETURNING id`,
    [
      tenant.orgId,
      tenant.workspaceId,
      request.auth!.id,
      config.OLLAMA_CHAT_MODEL,
      run.taskType,
      JSON.stringify(run.input),
      JSON.stringify(run.output),
      run.latencyMs,
      run.tokensIn,
      run.tokensOut,
      run.success
    ]
  );
  return result.rows[0]!.id;
}

aiRouter.get(
  "/workspace-memory",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    
    // 1. Fetch workspace info
    const workspaceRes = await query<{ name: string; description: string | null; settings_json: any }>(
      `SELECT name, description, settings_json FROM workspaces WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [tenant.workspaceId, tenant.orgId]
    );
    const workspaceInfo = workspaceRes.rows[0];

    // 2. Fetch default template and stages
    const workflowRes = await query<{ template_name: string; stage_name: string; is_terminal: boolean }>(
      `SELECT wt.name AS template_name, ws.name AS stage_name, ws.is_terminal
       FROM workflow_stages ws
       JOIN workflow_templates wt ON wt.id = ws.template_id
       WHERE wt.org_id = $1 AND wt.workspace_id = $2 AND wt.deleted_at IS NULL AND wt.is_default = TRUE
       ORDER BY ws.position`,
      [tenant.orgId, tenant.workspaceId]
    );

    // 3. Fetch count of work items by priority/status
    const workItemsRes = await query<{ priority: string; count: number }>(
      `SELECT priority, COUNT(*)::INTEGER AS count
       FROM work_items
       WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
       GROUP BY priority`,
      [tenant.orgId, tenant.workspaceId]
    );

    // 4. Fetch list of recent documents
    const documentsRes = await query<{ title: string; source_type: string }>(
      `SELECT title, source_type
       FROM documents
       WHERE org_id = $1 AND workspace_id = $2 AND status = 'indexed' AND deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 5`,
      [tenant.orgId, tenant.workspaceId]
    );

    // 5. Fetch active members
    const membersRes = await query<{ name: string; role: string }>(
      `SELECT u.name, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 AND m.workspace_id = $2`,
      [tenant.orgId, tenant.workspaceId]
    );

    // 6. Fetch automation rules
    const automationRes = await query<{ name: string; trigger_type: string; is_active: boolean }>(
      `SELECT name, trigger_type, is_active
       FROM automation_rules
       WHERE org_id = $1 AND workspace_id = $2`,
      [tenant.orgId, tenant.workspaceId]
    );

    response.json({
      name: workspaceInfo?.name || "FlowAI Workspace",
      purpose: workspaceInfo?.description || "No purpose defined yet.",
      defaultWorkflow: workflowRes.rows.length && workflowRes.rows[0] ? {
        templateName: workflowRes.rows[0].template_name,
        stages: workflowRes.rows.map(r => r.stage_name)
      } : null,
      activeUsers: membersRes.rows.map(r => `${r.name} (${r.role})`),
      keyDocs: documentsRes.rows.map(r => `${r.title} (${r.source_type})`),
      goals: (workspaceInfo?.settings_json as any)?.goals || ["Manage day-to-day work items", "Optimize workflow cycles"],
      rules: automationRes.rows.map(r => `${r.name} [${r.is_active ? 'Active' : 'Inactive'}]`)
    });
  })
);

aiRouter.post(
  "/chat",
  asyncHandler(async (request, response) => {
    const input = groundedChatSchema.parse(request.body);
    const startedAt = Date.now();
    try {
      const tenant = request.tenant!;
      const sources = await searchKnowledge(tenant, input.question, input.topK);
      const sourceText = sources
        .map((source, index) => `[Document ${index + 1}: ${source.title}]\n${source.chunkText}`)
        .join("\n\n");

      // Retrieve full workspace context
      const workspaceRes = await query<{ name: string; description: string | null }>(
        `SELECT name, description FROM workspaces WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [tenant.workspaceId, tenant.orgId]
      );
      const workspaceInfo = workspaceRes.rows[0];

      const workflowRes = await query<{ template_name: string; template_desc: string | null; stage_name: string; is_terminal: boolean }>(
        `SELECT wt.name AS template_name, wt.description AS template_desc, ws.name AS stage_name, ws.is_terminal
         FROM workflow_stages ws
         JOIN workflow_templates wt ON wt.id = ws.template_id
         WHERE wt.org_id = $1 AND wt.workspace_id = $2 AND wt.deleted_at IS NULL
         ORDER BY wt.name, ws.position`,
        [tenant.orgId, tenant.workspaceId]
      );

      const workItemsRes = await query<{ title: string; priority: string; stage_name: string; assignee_name: string | null; due_date: Date | null }>(
        `SELECT wi.title, wi.priority, ws.name AS stage_name, u.name AS assignee_name, wi.due_date
         FROM work_items wi
         LEFT JOIN workflow_stages ws ON ws.id = wi.current_stage_id
         LEFT JOIN users u ON u.id = wi.assignee_id
         WHERE wi.org_id = $1 AND wi.workspace_id = $2 AND wi.deleted_at IS NULL
         ORDER BY wi.updated_at DESC
         LIMIT 15`,
        [tenant.orgId, tenant.workspaceId]
      );

      const documentsRes = await query<{ title: string; source_type: string; summary: string | null }>(
        `SELECT title, source_type, summary
         FROM documents
         WHERE org_id = $1 AND workspace_id = $2 AND status = 'indexed' AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 10`,
        [tenant.orgId, tenant.workspaceId]
      );

      const activityRes = await query<{ actor_name: string | null; action: string; entity_type: string; created_at: Date }>(
        `SELECT u.name AS actor_name, al.action, al.entity_type, al.created_at
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
         WHERE al.org_id = $1 AND al.workspace_id = $2
         ORDER BY al.created_at DESC
         LIMIT 10`,
        [tenant.orgId, tenant.workspaceId]
      );

      const automationRes = await query<{ name: string; trigger_type: string; is_active: boolean }>(
        `SELECT name, trigger_type, is_active
         FROM automation_rules
         WHERE org_id = $1 AND workspace_id = $2
         ORDER BY created_at DESC`,
        [tenant.orgId, tenant.workspaceId]
      );

      const membersRes = await query<{ name: string; email: string; role: string }>(
        `SELECT u.name, u.email, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1 AND m.workspace_id = $2`,
        [tenant.orgId, tenant.workspaceId]
      );

      const workspaceContext = {
        workspace: workspaceInfo ? { name: workspaceInfo.name, description: workspaceInfo.description } : null,
        activeTemplates: workflowRes.rows.reduce((acc, row) => {
          let t = acc.find((item: any) => item.name === row.template_name);
          if (!t) {
            t = { name: row.template_name, description: row.template_desc, stages: [] };
            acc.push(t);
          }
          t.stages.push({ name: row.stage_name, isTerminal: row.is_terminal });
          return acc;
        }, [] as any[]),
        recentWorkItems: workItemsRes.rows.map(r => ({
          title: r.title,
          priority: r.priority,
          stage: r.stage_name,
          assignee: r.assignee_name || "Unassigned",
          dueDate: r.due_date ? r.due_date.toISOString() : null
        })),
        indexedDocuments: documentsRes.rows.map(r => ({
          title: r.title,
          type: r.source_type,
          summary: r.summary || "No summary"
        })),
        recentActivity: activityRes.rows.map(r => ({
          actor: r.actor_name || "System",
          action: r.action,
          entity: r.entity_type,
          time: r.created_at.toISOString()
        })),
        automationRules: automationRes.rows.map(r => ({
          name: r.name,
          trigger: r.trigger_type,
          isActive: r.is_active
        })),
        activeMembers: membersRes.rows.map(r => ({
          name: r.name,
          email: r.email,
          role: r.role
        }))
      };

      const workspaceContextText = JSON.stringify(workspaceContext, null, 2);

      const systemPrompt = `You are a workspace-grounded AI assistant for FlowAI.
You MUST follow these strict grounding rules:
1. Answer the user's question ONLY using the provided workspace context, document sources, active work items, workflow templates, members, and rules.
2. If the retrieved context does not contain enough information to safely and accurately answer the question, you MUST set "insufficientContext" to true and return the exact answer: "I could not find enough workspace-specific context to answer this safely."
3. Cite the exact document names or work item titles you used to answer the question in the "sourcesUsed" field.
4. Do NOT invent or assume any policies, task counts, workflow stages, or rules that are not explicitly present in the provided context.
5. Do NOT execute or claim to execute any actions. Action planning is handled separately. Only answer the question.
6. Provide a confidence score (from 0 to 100) indicating how well the provided workspace context grounds your answer. If insufficientContext is true, confidence must be 0.`;

      const userContent = `Question:\n${input.question}\n\nWorkspace Context:\n${workspaceContextText}\n\nRetrieved Document Sources:\n${sourceText || "No matching sources found."}`;

      const chatResponseJSONSchema = {
        type: "object",
        properties: {
          answer: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 100 },
          insufficientContext: { type: "boolean" },
          sourcesUsed: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["answer", "confidence", "insufficientContext", "sourcesUsed"]
      };

      const chatResponseZodSchema = z.object({
        answer: z.string(),
        confidence: z.number().min(0).max(100),
        insufficientContext: z.boolean(),
        sourcesUsed: z.array(z.string())
      });

      const parsedChat = await structuredChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        chatResponseJSONSchema,
        chatResponseZodSchema
      );

      const answerData = parsedChat.result;
      
      // Override safety check to force the exact fallback string
      if (answerData.insufficientContext && answerData.answer !== "I could not find enough workspace-specific context to answer this safely.") {
        answerData.answer = "I could not find enough workspace-specific context to answer this safely.";
      }

      const runId = await recordRun(request, {
        taskType: "grounded_chat",
        input,
        output: {
          answer: answerData.answer,
          confidence: answerData.confidence,
          insufficientContext: answerData.insufficientContext,
          sourcesUsed: answerData.sourcesUsed,
          sourceIds: sources.map((source) => source.chunkId)
        },
        latencyMs: Date.now() - startedAt,
        tokensIn: parsedChat.tokensIn,
        tokensOut: parsedChat.tokensOut,
        success: true
      });
      response.json({
        answer: answerData.answer,
        confidence: answerData.confidence,
        insufficientContext: answerData.insufficientContext,
        sourcesUsed: answerData.sourcesUsed,
        workspaceContextUsed: workspaceContext,
        sources,
        runId
      });
    } catch (error) {
      await recordRun(request, {
        taskType: "grounded_chat",
        input,
        output: { error: error instanceof Error ? error.message : "Assistant request failed." },
        latencyMs: Date.now() - startedAt,
        tokensIn: null,
        tokensOut: null,
        success: false
      }).catch(() => undefined);
      throw error;
    }
  })
);

aiRouter.post(
  "/command/preview",
  asyncHandler(async (request, response) => {
    const input = commandRequestSchema.parse(request.body);
    const startedAt = Date.now();
    try {
      const tenant = request.tenant!;

      // Retrieve full workspace context for grounded action planning
      const workspaceRes = await query<{ name: string; description: string | null }>(
        `SELECT name, description FROM workspaces WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
        [tenant.workspaceId, tenant.orgId]
      );
      const workspaceInfo = workspaceRes.rows[0];

      const workflowRes = await query<{ template_name: string; template_desc: string | null; stage_name: string; is_terminal: boolean }>(
        `SELECT wt.name AS template_name, wt.description AS template_desc, ws.name AS stage_name, ws.is_terminal
         FROM workflow_stages ws
         JOIN workflow_templates wt ON wt.id = ws.template_id
         WHERE wt.org_id = $1 AND wt.workspace_id = $2 AND wt.deleted_at IS NULL
         ORDER BY wt.name, ws.position`,
        [tenant.orgId, tenant.workspaceId]
      );

      const workItemsRes = await query<{ title: string; priority: string; stage_name: string; assignee_name: string | null; due_date: Date | null }>(
        `SELECT wi.title, wi.priority, ws.name AS stage_name, u.name AS assignee_name, wi.due_date
         FROM work_items wi
         LEFT JOIN workflow_stages ws ON ws.id = wi.current_stage_id
         LEFT JOIN users u ON u.id = wi.assignee_id
         WHERE wi.org_id = $1 AND wi.workspace_id = $2 AND wi.deleted_at IS NULL
         ORDER BY wi.updated_at DESC
         LIMIT 15`,
        [tenant.orgId, tenant.workspaceId]
      );

      const documentsRes = await query<{ title: string; source_type: string; summary: string | null }>(
        `SELECT title, source_type, summary
         FROM documents
         WHERE org_id = $1 AND workspace_id = $2 AND status = 'indexed' AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT 10`,
        [tenant.orgId, tenant.workspaceId]
      );

      const membersRes = await query<{ name: string; role: string }>(
        `SELECT u.name, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.org_id = $1 AND m.workspace_id = $2`,
        [tenant.orgId, tenant.workspaceId]
      );

      const workspaceContext = {
        workspace: workspaceInfo ? { name: workspaceInfo.name, description: workspaceInfo.description } : null,
        activeTemplates: workflowRes.rows.reduce((acc, row) => {
          let t = acc.find((item: any) => item.name === row.template_name);
          if (!t) {
            t = { name: row.template_name, description: row.template_desc, stages: [] };
            acc.push(t);
          }
          t.stages.push({ name: row.stage_name, isTerminal: row.is_terminal });
          return acc;
        }, [] as any[]),
        recentWorkItems: workItemsRes.rows.map(r => ({
          title: r.title,
          priority: r.priority,
          stage: r.stage_name,
          assignee: r.assignee_name || "Unassigned"
        })),
        indexedDocuments: documentsRes.rows.map(r => ({
          title: r.title,
          type: r.source_type
        })),
        activeMembers: membersRes.rows.map(r => ({
          name: r.name,
          role: r.role
        }))
      };

      const workspaceContextText = JSON.stringify(workspaceContext, null, 2);

      const systemPrompt = `Choose exactly one permitted platform tool for the user's command based on the workspace context provided.
You may only plan one of the following tools: create_work_item, search_documents, update_work_item_status, or assign_work_item.
Use only actual stages and assignee names present in the workspace context. Do not invent stages, usernames, or item IDs.
Return JSON matching the schema precisely. Determine intent, confidence, suggested_action, and set can_execute to true only if the context has sufficient references, otherwise set can_execute to false.`;

      const userContent = `User Command: ${input.command}\n\nWorkspace Context:\n${workspaceContextText}`;

      const plan = await structuredChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        commandPlanFormat,
        commandPlanSchema
      );
      const runId = await recordRun(request, {
        taskType: "command_preview",
        input,
        output: plan.result,
        latencyMs: Date.now() - startedAt,
        tokensIn: plan.tokensIn,
        tokensOut: plan.tokensOut,
        success: true
      });
      response.json({ action: plan.result, runId, requiresConfirmation: true });
    } catch (error) {
      await recordRun(request, {
        taskType: "command_preview",
        input,
        output: { error: error instanceof Error ? error.message : "Command planning failed." },
        latencyMs: Date.now() - startedAt,
        tokensIn: null,
        tokensOut: null,
        success: false
      }).catch(() => undefined);
      throw error;
    }
  })
);

aiRouter.post(
  "/command/execute",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const input = executeCommandSchema.parse(request.body);
    const tenant = request.tenant!;
    const startedAt = Date.now();
    const preview = await query<{ output_json: unknown }>(
      `SELECT output_json
         FROM ai_runs
        WHERE id = $1
          AND org_id = $2
          AND workspace_id = $3
          AND user_id = $4
          AND task_type = 'command_preview'
          AND success = TRUE`,
      [input.previewRunId, tenant.orgId, tenant.workspaceId, request.auth!.id]
    );
    if (!preview.rowCount) {
      throw new HttpError(404, "Confirmed command preview was not found.");
    }
    const action = commandPlanSchema.parse(preview.rows[0]!.output_json);
    let executionId: string;
    try {
      const reservation = await query<{ id: string }>(
        `INSERT INTO ai_command_executions
           (org_id, workspace_id, user_id, preview_run_id, status)
         VALUES ($1, $2, $3, $4, 'running')
         RETURNING id`,
        [tenant.orgId, tenant.workspaceId, request.auth!.id, input.previewRunId]
      );
      executionId = reservation.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new HttpError(409, "This command preview has already been executed.");
      }
      throw error;
    }

    try {
      let result: unknown;
      let entityId: string | null = null;

      if (action.tool === "create_work_item") {
        entityId = await createWorkItem(tenant, request.auth!.id, {
          ...action.arguments,
          priority: action.arguments.priority
        });
        result = { tool: action.tool, workItemId: entityId };
        broadcastToWorkspace(tenant.workspaceId, "work-item:created", { itemId: entityId });
      } else if (action.tool === "search_documents") {
        result = {
          tool: action.tool,
          matches: await searchKnowledge(
            tenant,
            action.arguments.query,
            action.arguments.topK
          )
        };
      } else if (action.tool === "update_work_item_status") {
        // 1. Find work item by title (fuzzy search in workspace)
        const itemRes = await query<{ id: string; current_stage_id: string; template_id: string }>(
          `SELECT id, current_stage_id, template_id
             FROM work_items
            WHERE org_id = $1 AND workspace_id = $2
              AND LOWER(title) LIKE LOWER($3)
              AND deleted_at IS NULL
            LIMIT 1`,
          [tenant.orgId, tenant.workspaceId, `%${action.arguments.itemTitle}%`]
        );
        if (!itemRes.rowCount) {
          throw new HttpError(404, `Work item with title similar to "${action.arguments.itemTitle}" was not found.`);
        }
        const workItem = itemRes.rows[0]!;
        entityId = workItem.id;

        // 2. Find stage by name (fuzzy search in workspace stages)
        const stageRes = await query<{ id: string; is_terminal: boolean }>(
          `SELECT id, is_terminal
             FROM workflow_stages
            WHERE template_id = $1
              AND LOWER(name) = LOWER($2)
            LIMIT 1`,
          [workItem.template_id, action.arguments.stageName]
        );
        if (!stageRes.rowCount) {
          throw new HttpError(404, `Workflow stage with name "${action.arguments.stageName}" was not found.`);
        }
        const targetStage = stageRes.rows[0]!;

        // 3. Update work item stage
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE work_items
                SET current_stage_id = $1,
                    started_at = COALESCE(started_at, NOW()),
                    closed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
              WHERE id = $3`,
            [targetStage.id, targetStage.is_terminal, workItem.id]
          );

          await client.query(
            `INSERT INTO work_item_history
               (work_item_id, changed_by, field_name, old_value, new_value)
             VALUES ($1, $2, 'current_stage_id', $3::jsonb, $4::jsonb)`,
            [
              workItem.id,
              request.auth!.id,
              JSON.stringify(workItem.current_stage_id),
              JSON.stringify(targetStage.id)
            ]
          );
        });

        result = { tool: action.tool, workItemId: workItem.id, toStageId: targetStage.id };
        broadcastToWorkspace(tenant.workspaceId, "work-item:transitioned", { itemId: workItem.id });
      } else if (action.tool === "assign_work_item") {
        // 1. Find work item by title
        const itemRes = await query<{ id: string; assignee_id: string | null }>(
          `SELECT id, assignee_id
             FROM work_items
            WHERE org_id = $1 AND workspace_id = $2
              AND LOWER(title) LIKE LOWER($3)
              AND deleted_at IS NULL
            LIMIT 1`,
          [tenant.orgId, tenant.workspaceId, `%${action.arguments.itemTitle}%`]
        );
        if (!itemRes.rowCount) {
          throw new HttpError(404, `Work item with title similar to "${action.arguments.itemTitle}" was not found.`);
        }
        const workItem = itemRes.rows[0]!;
        entityId = workItem.id;

        // 2. Find assignee user by name
        const memberRes = await query<{ user_id: string; user_name: string }>(
          `SELECT m.user_id, u.name AS user_name
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.org_id = $1 AND m.workspace_id = $2
              AND LOWER(u.name) LIKE LOWER($3)
            LIMIT 1`,
          [tenant.orgId, tenant.workspaceId, `%${action.arguments.assigneeName}%`]
        );
        if (!memberRes.rowCount) {
          throw new HttpError(404, `Workspace member with name similar to "${action.arguments.assigneeName}" was not found.`);
        }
        const targetMember = memberRes.rows[0]!;

        // 3. Assign work item
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE work_items
                SET assignee_id = $1
              WHERE id = $2`,
            [targetMember.user_id, workItem.id]
          );

          await client.query(
            `INSERT INTO work_item_history
               (work_item_id, changed_by, field_name, old_value, new_value)
             VALUES ($1, $2, 'assigneeId', $3::jsonb, $4::jsonb)`,
            [
              workItem.id,
              request.auth!.id,
              JSON.stringify(workItem.assignee_id),
              JSON.stringify(targetMember.user_id)
            ]
          );
        });

        result = { tool: action.tool, workItemId: workItem.id, assigneeId: targetMember.user_id };
        broadcastToWorkspace(tenant.workspaceId, "work-item:updated", { itemId: workItem.id });
      }

      await query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'ai.command.executed', $4, $5, $6::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          action.tool,
          entityId,
          JSON.stringify({ tool: action.tool, arguments: action.arguments, previewRunId: input.previewRunId })
        ]
      );
      const runId = await recordRun(request, {
        taskType: "command_execution",
        input: { previewRunId: input.previewRunId, action },
        output: result,
        latencyMs: Date.now() - startedAt,
        tokensIn: null,
        tokensOut: null,
        success: true
      });
      await query(
        `UPDATE ai_command_executions
            SET status = 'succeeded', result_json = $1::jsonb, finished_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ result, runId }), executionId]
      );
      response.json({ result, runId });
    } catch (error) {
      await query(
        `UPDATE ai_command_executions
            SET status = 'failed', result_json = $1::jsonb, finished_at = NOW()
          WHERE id = $2`,
        [JSON.stringify({ error: error instanceof Error ? error.message : "Execution failed." }), executionId]
      ).catch(() => undefined);
      throw error;
    }
  })
);

aiRouter.post(
  "/workflow-draft",
  asyncHandler(async (request, response) => {
    const input = workflowPromptSchema.parse(request.body);
    const startedAt = Date.now();
    try {
      const generated = await structuredChat(
        [
          {
            role: "system",
            content:
              "Convert a workflow request into a reusable, domain-neutral workflow template. Return only the required JSON. The last stage should normally be terminal."
          },
          { role: "user", content: input.prompt }
        ],
        workflowDraftFormat,
        workflowDraftSchema
      );
      const runId = await recordRun(request, {
        taskType: "workflow_draft",
        input,
        output: generated.result,
        latencyMs: Date.now() - startedAt,
        tokensIn: generated.tokensIn,
        tokensOut: generated.tokensOut,
        success: true
      });
      response.json({ draft: generated.result, runId });
    } catch (error) {
      await recordRun(request, {
        taskType: "workflow_draft",
        input,
        output: { error: error instanceof Error ? error.message : "Workflow generation failed." },
        latencyMs: Date.now() - startedAt,
        tokensIn: null,
        tokensOut: null,
        success: false
      }).catch(() => undefined);
      throw error;
    }
  })
);
