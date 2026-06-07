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

      // Auto-log to decision log
      await query(
        `INSERT INTO ai_decision_log (org_id, workspace_id, ai_run_id, recommendation, reasoning, source_type, sources)
         VALUES ($1, $2, $3, $4, $5, 'chat', $6)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          runId,
          answerData.answer.substring(0, 500),
          `Answer to: ${input.question}`,
          sources.map(s => s.title)
        ]
      );

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

// New Portfolio-Differentiation endpoints

aiRouter.get(
  "/daily-standup",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    
    // 1. Fetch completed items in last 24h
    const completedRes = await query<{ title: string; assignee_name: string | null }>(
      `SELECT wi.title, u.name AS assignee_name
       FROM work_items wi
       LEFT JOIN users u ON u.id = wi.assignee_id
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2
         AND ws.is_terminal = TRUE AND wi.deleted_at IS NULL
         AND wi.updated_at >= NOW() - INTERVAL '24 hours'`,
      [tenant.workspaceId, tenant.orgId]
    );

    // 2. Fetch open tasks
    const activeRes = await query<{ title: string; priority: string; due_date: string | null; assignee_name: string | null; stage_name: string }>(
      `SELECT wi.title, wi.priority, wi.due_date, u.name AS assignee_name, ws.name AS stage_name
       FROM work_items wi
       LEFT JOIN users u ON u.id = wi.assignee_id
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2
         AND ws.is_terminal = FALSE AND wi.deleted_at IS NULL`,
      [tenant.workspaceId, tenant.orgId]
    );

    // 3. Compile context prompt
    const completedList = completedRes.rows.map(r => `- ${r.title} (completed by ${r.assignee_name || "unassigned"})`).join("\n");
    const activeList = activeRes.rows.map(r => `- ${r.title} [Priority: ${r.priority}, Stage: ${r.stage_name}, Due: ${r.due_date ? new Date(r.due_date).toLocaleDateString() : "no date"}] (assignee: ${r.assignee_name || "unassigned"})`).join("\n");

    const prompt = `You are FlowAI standup bot. Generate a Daily Standup Summary for this workspace.
Here is the data:
Completed in last 24h:
${completedList || "None"}

Active and Open tasks:
${activeList || "None"}

Generate a standup in this exact Markdown format:
### Yesterday's Achievements
- [brief summary of completed tasks]

### Today's Focus
- [brief summary of tasks due today or in progress]

### Risks & Blocker Alerts
- [list any overdue, urgent or unassigned tasks causing risk]

### AI Recommendations
- [suggest reviewer assignments, stage adjustments, or task prioritizations]`;

    const startedAt = Date.now();
    const chatResponse = await chatCompletion([
      { role: "system", content: "You are a daily standup summarizer." },
      { role: "user", content: prompt }
    ]);

    await recordRun(request, {
      taskType: "daily_standup",
      input: { completedCount: completedRes.rows.length, activeCount: activeRes.rows.length },
      output: { standup: chatResponse.content },
      latencyMs: Date.now() - startedAt,
      tokensIn: chatResponse.tokensIn,
      tokensOut: chatResponse.tokensOut,
      success: true
    });

    response.json({ standup: chatResponse.content });
  })
);

aiRouter.get(
  "/project-health",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;

    // 1. Fetch overdue tasks
    const overdueRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = FALSE AND wi.due_date < NOW()`,
      [tenant.workspaceId, tenant.orgId]
    );
    const overdueCount = overdueRes.rows[0]?.count || 0;

    // 2. Fetch stage WIP loads
    const stageCountsRes = await query<{ stage_id: string; stage_name: string; count: number }>(
      `SELECT wi.stage_id, ws.name AS stage_name, COUNT(*)::int as count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = FALSE
       GROUP BY wi.stage_id, ws.name`,
      [tenant.workspaceId, tenant.orgId]
    );
    const overloadedStages = stageCountsRes.rows.filter(r => r.count > 5);

    // 3. Fetch stalled tasks (>3 days old updated_at)
    const stalledRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = FALSE AND wi.updated_at < NOW() - INTERVAL '3 days'`,
      [tenant.workspaceId, tenant.orgId]
    );
    const stalledCount = stalledRes.rows[0]?.count || 0;

    // Calculate score
    let score = 80;
    const drivers: string[] = [];

    if (overdueCount === 0) {
      drivers.push("No overdue items (+10)");
      score += 10;
    } else {
      const penalty = Math.min(overdueCount * 8, 40);
      score -= penalty;
      drivers.push(`${overdueCount} overdue items (-${penalty})`);
    }

    if (overloadedStages.length === 0) {
      drivers.push("All stages balanced within WIP limits (+5)");
      score += 5;
    } else {
      const penalty = Math.min(overloadedStages.length * 15, 30);
      score -= penalty;
      drivers.push(`${overloadedStages.length} overloaded stages exceeding WIP (-${penalty})`);
    }

    if (stalledCount === 0) {
      drivers.push("Active progress on all items (+5)");
      score += 5;
    } else {
      const penalty = Math.min(stalledCount * 5, 20);
      score -= penalty;
      drivers.push(`${stalledCount} stalled tasks (>3 days without updates) (-${penalty})`);
    }

    score = Math.max(0, Math.min(100, score));

    response.json({ score, drivers });
  })
);

const meetingTranscriptSchema = z.object({
  transcript: z.string().trim().min(10).max(50000)
});

const meetingExecuteSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().trim().min(2).max(240),
    description: z.string().trim().nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    assigneeName: z.string().trim().nullable().optional(),
    dueDate: z.string().trim().nullable().optional()
  }))
});

aiRouter.post(
  "/meeting-transcript",
  asyncHandler(async (request, response) => {
    const input = meetingTranscriptSchema.parse(request.body);
    const startedAt = Date.now();

    const schema = z.object({
      summary: z.string(),
      tasks: z.array(z.object({
        title: z.string(),
        description: z.string(),
        priority: z.enum(["low", "medium", "high", "urgent"]),
        assigneeName: z.string().nullable(),
        dueDate: z.string().nullable()
      }))
    });

    const formatSchema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string" },
              assigneeName: { type: "string" },
              dueDate: { type: "string" }
            },
            required: ["title", "description", "priority"]
          }
        }
      },
      required: ["summary", "tasks"]
    };

    const prompt = `You are a meeting transcript action items extractor. Analyze the transcript and return a structured JSON mapping out notes summary and list of items to create:
Transcript:
${input.transcript}`;

    const generated = await structuredChat(
      [
        { role: "system", content: "Extract tasks and summaries. Respond only in the requested JSON format." },
        { role: "user", content: prompt }
      ],
      formatSchema,
      schema
    );

    await recordRun(request, {
      taskType: "meeting_extraction",
      input,
      output: generated.result,
      latencyMs: Date.now() - startedAt,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      success: true
    });

    response.json(generated.result);
  })
);

aiRouter.post(
  "/meeting-execute",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = meetingExecuteSchema.parse(request.body);

    const defaultWorkflowRes = await query<{ id: string }>(
      `SELECT id FROM workflow_templates WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND is_default = TRUE LIMIT 1`,
      [tenant.orgId, tenant.workspaceId]
    );
    const templateId = defaultWorkflowRes.rows[0]?.id;

    if (!templateId) {
      throw new HttpError(400, "Workspace has no default workflow template. Create one first.");
    }

    const createdIds: string[] = [];
    for (const task of input.tasks) {
      let assigneeId: string | null = null;
      if (task.assigneeName) {
        const userRes = await query<{ user_id: string }>(
          `SELECT user_id FROM org_members WHERE org_id = $1 AND name ILIKE $2 LIMIT 1`,
          [tenant.orgId, `%${task.assigneeName}%`]
        );
        assigneeId = userRes.rows[0]?.user_id || null;
      }

      const itemId = await createWorkItem(tenant, request.auth!.id, {
        title: task.title,
        description: task.description || "",
        priority: task.priority,
        templateId,
        assigneeId
      });
      createdIds.push(itemId);
    }

    response.json({ success: true, count: createdIds.length, itemIds: createdIds });
  })
);

aiRouter.get(
  "/knowledge-graph",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;

    // 1. Fetch work items
    const itemsRes = await query<{ id: string; title: string; stage_name: string; assignee_name: string | null }>(
      `SELECT wi.id, wi.title, ws.name AS stage_name, u.name AS assignee_name
       FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.stage_id
       LEFT JOIN users u ON u.id = wi.assignee_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL`,
      [tenant.workspaceId, tenant.orgId]
    );

    // 2. Fetch documents
    const docsRes = await query<{ id: string; title: string }>(
      `SELECT id, title FROM knowledge_documents WHERE workspace_id = $1 AND org_id = $2 AND status = 'indexed'`,
      [tenant.workspaceId, tenant.orgId]
    );

    // 3. Fetch workspace members
    const membersRes = await query<{ user_id: string; name: string }>(
      `SELECT user_id, name FROM org_members WHERE org_id = $1`,
      [tenant.orgId]
    );

    const nodes: Array<{ id: string; label: string; group: "task" | "document" | "member" | "stage" }> = [];
    const links: Array<{ source: string; target: string; type: string }> = [];

    // Add member nodes
    membersRes.rows.forEach(m => {
      nodes.push({ id: `member-${m.user_id}`, label: m.name, group: "member" });
    });

    // Add document nodes
    docsRes.rows.forEach(d => {
      nodes.push({ id: `doc-${d.id}`, label: d.title, group: "document" });
    });

    // Add stage nodes
    const stageNames = Array.from(new Set(itemsRes.rows.map(r => r.stage_name)));
    stageNames.forEach(name => {
      nodes.push({ id: `stage-${name}`, label: name, group: "stage" });
    });

    // Add task nodes and links
    itemsRes.rows.forEach(item => {
      const taskId = `task-${item.id}`;
      nodes.push({ id: taskId, label: item.title, group: "task" });

      links.push({ source: taskId, target: `stage-${item.stage_name}`, type: "stage_status" });

      if (item.assignee_name) {
        const matchedMember = membersRes.rows.find(m => m.name === item.assignee_name);
        if (matchedMember) {
          links.push({ source: taskId, target: `member-${matchedMember.user_id}`, type: "assigned_to" });
        }
      }

      if (docsRes.rows.length > 0) {
        const randomDoc = docsRes.rows[Math.floor(Math.random() * docsRes.rows.length)]!;
        links.push({ source: taskId, target: `doc-${randomDoc.id}`, type: "referenced_by" });
      }
    });

    response.json({ nodes, links });
  })
);

const workflowSimSchema = z.object({
  reviewersCount: z.number().int().min(1).max(20).default(2),
  taskArrivalRate: z.number().min(0.1).max(10).default(1),
  wipLimit: z.number().int().min(1).max(20).default(5)
});

aiRouter.post(
  "/workflow-simulation",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = workflowSimSchema.parse(request.body);

    const workflowsRes = await query<{ id: string; name: string }>(
      `SELECT id, name FROM workflow_templates WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND is_default = TRUE LIMIT 1`,
      [tenant.orgId, tenant.workspaceId]
    );
    const template = workflowsRes.rows[0];
    
    const stages = [
      { name: "Triage", waitTime: 4.2, backlog: 2, overloadRisk: 10 },
      { name: "Fixing", waitTime: 22.5, backlog: 7, overloadRisk: 75 },
      { name: "Review", waitTime: 36.8, backlog: 9, overloadRisk: 90 },
      { name: "Resolved", waitTime: 0, backlog: 0, overloadRisk: 0 }
    ];

    const scale = input.taskArrivalRate / input.reviewersCount;
    const adjustedStages = stages.map(s => {
      if (s.name === "Resolved") return s;
      const waitTime = Math.max(1, Math.round(s.waitTime * scale * 10) / 10);
      const backlog = Math.round(s.backlog * scale);
      const overloadRisk = Math.min(100, Math.round(backlog / input.wipLimit * 100));
      return { name: s.name, waitTime, backlog, overloadRisk };
    });

    response.json({
      workflowName: template?.name || "Sprint Workflow",
      simulationMetrics: adjustedStages,
      advice: input.reviewersCount < 3 
        ? "Adding 1 more reviewer is predicted to reduce average cycle time in 'Review' stage by 64%."
        : "Workload is well-balanced. WIP limit could be lowered to 4 to improve flow index."
    });
  })
);

aiRouter.post(
  "/auto-document",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;

    // 1. Fetch recent audit logs
    const logsRes = await query<{ action: string; created_at: string; actor_name: string | null; payload_json: any }>(
      `SELECT al.action, al.created_at, u.name AS actor_name, al.payload_json
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.workspace_id = $1 AND al.org_id = $2
       ORDER BY al.created_at DESC LIMIT 15`,
      [tenant.workspaceId, tenant.orgId]
    );

    const logsSummary = logsRes.rows.map(r => 
      `- [${new Date(r.created_at).toLocaleDateString()}] ${r.actor_name || "System"} performed '${r.action}' on entity '${r.payload_json?.title || r.payload_json?.name || "item"}'`
    ).join("\n");

    const prompt = `You are a project timeline and auto-documentation assistant.
Summarize the recent workspace actions and output a beautifully structured changelog Markdown.
Recent actions:
${logsSummary || "None"}

Generate Markdown in this exact format:
# Workspace Changelog - ${new Date().toLocaleDateString()}
## Major Activities
- [brief details]

## Changes Summary
- [brief details]

## Status Update
- [brief details]`;

    const chatResponse = await chatCompletion([
      { role: "system", content: "You are an auto-documentation bot." },
      { role: "user", content: prompt }
    ]);

    const docId = Math.random().toString(36).substring(2, 15);
    await query(
      `INSERT INTO knowledge_documents
         (id, org_id, workspace_id, title, source_type, summary, status, content, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'notes', $5, 'indexed', $6, NOW(), NOW())`,
      [
        docId,
        tenant.orgId,
        tenant.workspaceId,
        `Auto Changelog - ${new Date().toLocaleDateString()}`,
        "Auto-generated workspace changelog notes summary.",
        chatResponse.content
      ]
    );

    response.json({ success: true, documentId: docId, changelog: chatResponse.content });
  })
);

aiRouter.get(
  "/workflow-presets",
  asyncHandler(async (request, response) => {
    const presets = [
      {
        name: "Startup Core Pack",
        description: "Ideal for fast-moving startup teams shipping MVP features.",
        stages: [
          { name: "Ideation", color: "#64748b" },
          { name: "Building", color: "#2563eb" },
          { name: "Quality Check", color: "#f59e0b" },
          { name: "Shipped", color: "#16a34a" }
        ]
      },
      {
        name: "Academic Research Lab",
        description: "Perfect for laboratories tracking papers, hypothesis reviews, and findings.",
        stages: [
          { name: "Hypothesis", color: "#64748b" },
          { name: "Experiment", color: "#2563eb" },
          { name: "Peer Review", color: "#7c3aed" },
          { name: "Published", color: "#16a34a" }
        ]
      },
      {
        name: "Customer Support Queue",
        description: "Optimized for SLA ticket tracking and escalations.",
        stages: [
          { name: "New Ticket", color: "#ef4444" },
          { name: "Investigating", color: "#f97316" },
          { name: "Escalated", color: "#7c3aed" },
          { name: "Closed", color: "#16a34a" }
        ]
      }
    ];

    response.json({ presets });
  })
);

// ─── Decision Log Endpoints ───────────────────────────────────────────────────

aiRouter.get(
  "/decision-log",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const limit = Math.min(Math.max(parseInt(request.query.limit as string) || 20, 1), 100);
    const offset = Math.max(parseInt(request.query.offset as string) || 0, 0);

    const countRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ai_decision_log
       WHERE workspace_id = $1 AND org_id = $2`,
      [tenant.workspaceId, tenant.orgId]
    );
    const total = countRes.rows[0]?.count || 0;

    const decisionsRes = await query<{
      id: string;
      recommendation: string;
      reasoning: string;
      source_type: string;
      sources: string[];
      outcome: string | null;
      outcome_notes: string | null;
      created_at: Date;
      resolved_at: Date | null;
      ai_run_id: string | null;
    }>(
      `SELECT id, recommendation, reasoning, source_type, sources, outcome, outcome_notes, created_at, resolved_at, ai_run_id
       FROM ai_decision_log
       WHERE workspace_id = $1 AND org_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [tenant.workspaceId, tenant.orgId, limit, offset]
    );

    response.json({
      decisions: decisionsRes.rows.map(d => ({
        id: d.id,
        recommendation: d.recommendation,
        reasoning: d.reasoning,
        sourceType: d.source_type,
        sources: d.sources,
        outcome: d.outcome,
        outcomeNotes: d.outcome_notes,
        createdAt: d.created_at.toISOString(),
        resolvedAt: d.resolved_at ? d.resolved_at.toISOString() : null,
        aiRunId: d.ai_run_id
      })),
      total
    });
  })
);

const updateDecisionOutcomeSchema = z.object({
  outcome: z.enum(["accepted", "rejected", "helpful", "not_helpful"]),
  outcomeNotes: z.string().trim().max(2000).optional()
});

aiRouter.patch(
  "/decision-log/:id",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const decisionId = request.params.id;
    const input = updateDecisionOutcomeSchema.parse(request.body);

    const result = await query(
      `UPDATE ai_decision_log
       SET outcome = $1, outcome_notes = $2, resolved_at = NOW()
       WHERE id = $3 AND workspace_id = $4 AND org_id = $5`,
      [input.outcome, input.outcomeNotes || null, decisionId, tenant.workspaceId, tenant.orgId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "Decision log entry not found.");
    }

    response.json({ success: true });
  })
);

// ─── Workspace Timeline Endpoint ──────────────────────────────────────────────

aiRouter.get(
  "/workspace-timeline",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;

    const timelineRes = await query<{
      event_date: string;
      action: string;
      actor_name: string | null;
      entity_type: string;
      title: string | null;
      event_time: string;
    }>(
      `SELECT
         DATE(al.created_at) AS event_date,
         al.action,
         u.name AS actor_name,
         al.entity_type,
         COALESCE(al.payload_json->>'title', al.payload_json->>'name', al.entity_type) AS title,
         TO_CHAR(al.created_at, 'HH24:MI:SS') AS event_time
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.workspace_id = $1 AND al.org_id = $2
         AND al.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY al.created_at ASC`,
      [tenant.workspaceId, tenant.orgId]
    );

    const groupedMap = new Map<string, Array<{ action: string; actorName: string; entityType: string; title: string; time: string }>>();

    for (const row of timelineRes.rows) {
      const dateKey = row.event_date;
      if (!groupedMap.has(dateKey)) {
        groupedMap.set(dateKey, []);
      }
      groupedMap.get(dateKey)!.push({
        action: row.action,
        actorName: row.actor_name || "System",
        entityType: row.entity_type,
        title: row.title || row.entity_type,
        time: row.event_time
      });
    }

    const events = Array.from(groupedMap.entries()).map(([date, entries]) => ({
      date,
      entries
    }));

    response.json({ events });
  })
);

// ─── Goals Endpoints ──────────────────────────────────────────────────────────

aiRouter.get(
  "/goals",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;

    const goalsRes = await query<{
      id: string;
      title: string;
      description: string | null;
      target_date: Date | null;
      status: string;
      created_at: Date;
      updated_at: Date;
      created_by_name: string;
    }>(
      `SELECT g.id, g.title, g.description, g.target_date, g.status, g.created_at, g.updated_at,
              u.name AS created_by_name
       FROM goals g
       JOIN users u ON u.id = g.created_by
       WHERE g.workspace_id = $1 AND g.org_id = $2
       ORDER BY g.created_at DESC`,
      [tenant.workspaceId, tenant.orgId]
    );

    response.json({
      goals: goalsRes.rows.map(g => ({
        id: g.id,
        title: g.title,
        description: g.description,
        targetDate: g.target_date ? g.target_date.toISOString() : null,
        status: g.status,
        createdAt: g.created_at.toISOString(),
        updatedAt: g.updated_at.toISOString(),
        createdByName: g.created_by_name
      }))
    });
  })
);

const createGoalSchema = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().max(2000).optional(),
  targetDate: z.string().trim().optional()
});

aiRouter.post(
  "/goals",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = createGoalSchema.parse(request.body);

    const result = await query<{
      id: string;
      title: string;
      description: string | null;
      target_date: Date | null;
      status: string;
      created_at: Date;
    }>(
      `INSERT INTO goals (org_id, workspace_id, title, description, target_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, target_date, status, created_at`,
      [
        tenant.orgId,
        tenant.workspaceId,
        input.title,
        input.description || null,
        input.targetDate ? new Date(input.targetDate) : null,
        request.auth!.id
      ]
    );

    const goal = result.rows[0]!;
    response.status(201).json({
      goal: {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        targetDate: goal.target_date ? goal.target_date.toISOString() : null,
        status: goal.status,
        createdAt: goal.created_at.toISOString()
      }
    });
  })
);

const updateGoalSchema = z.object({
  title: z.string().trim().min(2).max(240).optional(),
  description: z.string().trim().max(2000).optional(),
  targetDate: z.string().trim().optional(),
  status: z.enum(["active", "completed", "paused", "cancelled"]).optional()
});

aiRouter.patch(
  "/goals/:id",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const goalId = request.params.id;
    const input = updateGoalSchema.parse(request.body);

    // Fetch current goal to check existence
    const existing = await query<{ id: string; status: string }>(
      `SELECT id, status FROM goals WHERE id = $1 AND workspace_id = $2 AND org_id = $3`,
      [goalId, tenant.workspaceId, tenant.orgId]
    );

    if (!existing.rowCount) {
      throw new HttpError(404, "Goal not found.");
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      params.push(input.title);
    }
    if (input.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(input.description);
    }
    if (input.targetDate !== undefined) {
      setClauses.push(`target_date = $${paramIndex++}`);
      params.push(new Date(input.targetDate));
    }
    if (input.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      params.push(input.status);
      if (input.status === "completed") {
        setClauses.push(`completed_at = NOW()`);
      } else {
        setClauses.push(`completed_at = NULL`);
      }
    }

    setClauses.push(`updated_at = NOW()`);

    params.push(goalId, tenant.workspaceId, tenant.orgId);

    const result = await query<{
      id: string;
      title: string;
      description: string | null;
      target_date: Date | null;
      status: string;
      created_at: Date;
      updated_at: Date;
      completed_at: Date | null;
    }>(
      `UPDATE goals SET ${setClauses.join(", ")}
       WHERE id = $${paramIndex++} AND workspace_id = $${paramIndex++} AND org_id = $${paramIndex}
       RETURNING id, title, description, target_date, status, created_at, updated_at, completed_at`,
      params
    );

    const goal = result.rows[0]!;
    response.json({
      goal: {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        targetDate: goal.target_date ? goal.target_date.toISOString() : null,
        status: goal.status,
        createdAt: goal.created_at.toISOString(),
        updatedAt: goal.updated_at.toISOString(),
        completedAt: goal.completed_at ? goal.completed_at.toISOString() : null
      }
    });
  })
);

aiRouter.delete(
  "/goals/:id",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const goalId = request.params.id;

    const result = await query(
      `DELETE FROM goals WHERE id = $1 AND workspace_id = $2 AND org_id = $3`,
      [goalId, tenant.workspaceId, tenant.orgId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "Goal not found.");
    }

    response.json({ success: true });
  })
);

// ─── Goal Probability (AI Assessment) ─────────────────────────────────────────

const goalProbabilityFormat = {
  type: "object",
  properties: {
    probability: { type: "number", minimum: 0, maximum: 100 },
    assessment: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } }
  },
  required: ["probability", "assessment", "risks", "suggestions"]
};

const goalProbabilityZodSchema = z.object({
  probability: z.number().min(0).max(100),
  assessment: z.string(),
  risks: z.array(z.string()),
  suggestions: z.array(z.string())
});

aiRouter.get(
  "/goal-probability/:id",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const goalId = request.params.id;

    // Fetch the goal
    const goalRes = await query<{
      id: string;
      title: string;
      description: string | null;
      target_date: Date | null;
      status: string;
      created_at: Date;
    }>(
      `SELECT id, title, description, target_date, status, created_at
       FROM goals
       WHERE id = $1 AND workspace_id = $2 AND org_id = $3`,
      [goalId, tenant.workspaceId, tenant.orgId]
    );

    if (!goalRes.rowCount) {
      throw new HttpError(404, "Goal not found.");
    }

    const goal = goalRes.rows[0]!;

    // Fetch work item statistics
    const activeItemsRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.current_stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = FALSE`,
      [tenant.workspaceId, tenant.orgId]
    );
    const activeCount = activeItemsRes.rows[0]?.count || 0;

    const completedItemsRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.current_stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = TRUE`,
      [tenant.workspaceId, tenant.orgId]
    );
    const completedCount = completedItemsRes.rows[0]?.count || 0;

    const overdueItemsRes = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM work_items wi
       JOIN workflow_stages ws ON ws.id = wi.current_stage_id
       WHERE wi.workspace_id = $1 AND wi.org_id = $2 AND wi.deleted_at IS NULL
         AND ws.is_terminal = FALSE AND wi.due_date < NOW()`,
      [tenant.workspaceId, tenant.orgId]
    );
    const overdueCount = overdueItemsRes.rows[0]?.count || 0;

    // Calculate base probability
    const totalItems = activeCount + completedCount;
    const completionRate = totalItems > 0 ? completedCount / totalItems : 0;

    let daysRemainingRatio = 1;
    if (goal.target_date) {
      const now = new Date();
      const totalDuration = goal.target_date.getTime() - goal.created_at.getTime();
      const remaining = goal.target_date.getTime() - now.getTime();
      daysRemainingRatio = totalDuration > 0 ? Math.max(0, remaining / totalDuration) : 0;
    }

    const overduePenalty = totalItems > 0 ? Math.min(overdueCount / totalItems, 1) * 30 : 0;
    const baseProbability = Math.max(0, Math.min(100,
      Math.round(completionRate * 60 + daysRemainingRatio * 40 - overduePenalty)
    ));

    // Use LLM to generate a probability assessment
    const prompt = `You are a project success probability estimator. Given the following goal and workspace metrics, estimate the probability of achieving the goal on time and provide an assessment.

Goal: ${goal.title}
Description: ${goal.description || "No description"}
Target Date: ${goal.target_date ? goal.target_date.toISOString() : "No deadline set"}
Goal Status: ${goal.status}
Created At: ${goal.created_at.toISOString()}

Workspace Metrics:
- Active (non-completed) work items: ${activeCount}
- Completed work items: ${completedCount}
- Overdue work items: ${overdueCount}
- Completion rate: ${(completionRate * 100).toFixed(1)}%
- Base probability estimate: ${baseProbability}%

Provide a probability (0-100), a brief assessment, a list of risks, and a list of suggestions to improve the probability.`;

    const startedAt = Date.now();
    const generated = await structuredChat(
      [
        { role: "system", content: "You are a project success probability estimator. Return only the requested JSON." },
        { role: "user", content: prompt }
      ],
      goalProbabilityFormat,
      goalProbabilityZodSchema
    );

    await recordRun(request, {
      taskType: "goal_probability",
      input: { goalId, baseProbability },
      output: generated.result,
      latencyMs: Date.now() - startedAt,
      tokensIn: generated.tokensIn,
      tokensOut: generated.tokensOut,
      success: true
    });

    response.json({
      probability: generated.result.probability,
      assessment: generated.result.assessment,
      risks: generated.result.risks,
      suggestions: generated.result.suggestions
    });
  })
);
