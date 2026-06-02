import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import { automationActionSchema, automationConditionSchema } from "../services/automation.js";

const createRuleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  triggerType: z.literal("work_item.created"),
  condition: automationConditionSchema.default({}),
  action: automationActionSchema,
  isActive: z.boolean().default(true)
});

const activeSchema = z.object({ isActive: z.boolean() });

export const automationRouter = Router();

automationRouter.use(authenticate, requireWorkspaceContext);

automationRouter.get(
  "/rules",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const result = await query(
      `SELECT id,
              name,
              trigger_type AS "triggerType",
              condition_json AS condition,
              action_json AS action,
              is_active AS "isActive",
              created_at AS "createdAt"
         FROM automation_rules
        WHERE org_id = $1 AND workspace_id = $2
        ORDER BY created_at DESC`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ rules: result.rows });
  })
);

automationRouter.post(
  "/rules",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = createRuleSchema.parse(request.body);
    const rule = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO automation_rules
           (org_id, workspace_id, name, trigger_type, condition_json, action_json, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
         RETURNING id, name, trigger_type AS "triggerType", condition_json AS condition,
                   action_json AS action, is_active AS "isActive"`,
        [
          tenant.orgId,
          tenant.workspaceId,
          input.name,
          input.triggerType,
          JSON.stringify(input.condition),
          JSON.stringify(input.action),
          input.isActive,
          request.auth!.id
        ]
      );
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'automation_rule.created', 'automation_rule', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          inserted.rows[0]!.id,
          JSON.stringify({ triggerType: input.triggerType })
        ]
      );
      return inserted.rows[0];
    });
    response.status(201).json({ rule });
  })
);

automationRouter.patch(
  "/rules/:id",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const ruleId = z.string().uuid().parse(request.params.id);
    const input = activeSchema.parse(request.body);
    const rule = await query(
      `UPDATE automation_rules
          SET is_active = $1
        WHERE id = $2 AND org_id = $3 AND workspace_id = $4
        RETURNING id, is_active AS "isActive"`,
      [input.isActive, ruleId, tenant.orgId, tenant.workspaceId]
    );
    if (!rule.rowCount) {
      throw new HttpError(404, "Automation rule was not found.");
    }
    response.json({ rule: rule.rows[0] });
  })
);

automationRouter.get(
  "/runs",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const runs = await query(
      `SELECT run.id,
              rule.name AS "ruleName",
              run.trigger_source AS "triggerSource",
              run.status,
              run.result_json AS result,
              run.executed_at AS "executedAt"
         FROM automation_runs run
         JOIN automation_rules rule ON rule.id = run.rule_id
        WHERE rule.org_id = $1 AND rule.workspace_id = $2
        ORDER BY run.executed_at DESC
        LIMIT 100`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ runs: runs.rows });
  })
);
