import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import { getCached, setCached, invalidateCache } from "../services/redis.js";

const stageSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
  slaHours: z.number().int().nonnegative().nullable().optional(),
  isTerminal: z.boolean().default(false)
});

const workflowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().min(1).max(80).default("general"),
  isDefault: z.boolean().default(false),
  stages: z.array(stageSchema).min(2).max(20),
  transitions: z
    .array(
      z.object({
        fromPosition: z.number().int().nonnegative(),
        toPosition: z.number().int().nonnegative()
      })
    )
    .optional()
});

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  isDefault: boolean;
  stages: unknown[];
  createdAt: string;
}

export const workflowRouter = Router();

workflowRouter.use(authenticate, requireWorkspaceContext);

workflowRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const cacheKey = `workspace:workflows:${tenant.orgId}:${tenant.workspaceId}`;
    const cached = await getCached<WorkflowRow[]>(cacheKey);
    if (cached) {
      response.json({ workflows: cached });
      return;
    }

    const result = await query<WorkflowRow>(
      `SELECT wt.id,
              wt.name,
              wt.description,
              wt.category,
              wt.is_default AS "isDefault",
              wt.created_at AS "createdAt",
              COALESCE(
                JSONB_AGG(
                  JSONB_BUILD_OBJECT(
                    'id', ws.id,
                    'name', ws.name,
                    'position', ws.position,
                    'color', ws.color,
                    'slaHours', ws.sla_hours,
                    'isTerminal', ws.is_terminal
                  ) ORDER BY ws.position
                ) FILTER (WHERE ws.id IS NOT NULL),
                '[]'::JSONB
              ) AS stages
         FROM workflow_templates wt
         LEFT JOIN workflow_stages ws ON ws.template_id = wt.id
        WHERE wt.org_id = $1
          AND wt.workspace_id = $2
          AND wt.deleted_at IS NULL
        GROUP BY wt.id
        ORDER BY wt.is_default DESC, wt.name`,
      [tenant.orgId, tenant.workspaceId]
    );

    await setCached(cacheKey, result.rows, 300);
    response.json({ workflows: result.rows });
  })
);

workflowRouter.post(
  "/",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = workflowSchema.parse(request.body);

    const workflow = await withTransaction(async (client) => {
      if (input.isDefault) {
        await client.query(
          `UPDATE workflow_templates
              SET is_default = FALSE
            WHERE org_id = $1
              AND workspace_id = $2
              AND category = $3
              AND deleted_at IS NULL`,
          [tenant.orgId, tenant.workspaceId, input.category]
        );
      }

      const template = await client.query<{ id: string }>(
        `INSERT INTO workflow_templates
           (org_id, workspace_id, name, description, category, is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          tenant.orgId,
          tenant.workspaceId,
          input.name,
          input.description ?? null,
          input.category,
          input.isDefault,
          request.auth!.id
        ]
      );
      const templateId = template.rows[0]!.id;
      const stageIds = new Map<number, string>();

      for (const [position, stage] of input.stages.entries()) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO workflow_stages
             (template_id, name, position, sla_hours, color, is_terminal)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            templateId,
            stage.name,
            position,
            stage.slaHours ?? null,
            stage.color,
            stage.isTerminal
          ]
        );
        stageIds.set(position, inserted.rows[0]!.id);
      }

      const transitions =
        input.transitions ??
        input.stages.slice(0, -1).map((_stage, position) => ({
          fromPosition: position,
          toPosition: position + 1
        }));

      for (const transition of transitions) {
        const fromStageId = stageIds.get(transition.fromPosition);
        const toStageId = stageIds.get(transition.toPosition);
        if (!fromStageId || !toStageId || fromStageId === toStageId) {
          throw new HttpError(400, "Workflow transition positions are invalid.");
        }

        await client.query(
          `INSERT INTO workflow_transitions (template_id, from_stage_id, to_stage_id)
           VALUES ($1, $2, $3)`,
          [templateId, fromStageId, toStageId]
        );
      }

      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'workflow.created', 'workflow_template', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          templateId,
          JSON.stringify({ name: input.name, category: input.category })
        ]
      );

      return templateId;
    });

    await invalidateCache(`workspace:workflows:${tenant.orgId}:${tenant.workspaceId}`);
    response.status(201).json({ id: workflow });
  })
);
