import type { PoolClient } from "pg";
import { z } from "zod";
import type { TenantContext } from "../domain/types.js";
import { broadcastToWorkspace } from "./socket.js";

export const automationConditionSchema = z.object({
  priority: z.enum(["low", "medium", "high", "urgent"]).optional()
});

export const automationActionSchema = z.object({
  type: z.literal("notify_creator"),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1000)
});

interface RuleRow {
  id: string;
  condition_json: unknown;
  action_json: unknown;
}

export async function runWorkItemCreatedAutomations(
  client: PoolClient,
  tenant: TenantContext,
  actorId: string,
  itemId: string,
  itemTitle: string,
  priority: string
): Promise<void> {
  const rules = await client.query<RuleRow>(
    `SELECT id, condition_json, action_json
       FROM automation_rules
      WHERE org_id = $1
        AND workspace_id = $2
        AND trigger_type = 'work_item.created'
        AND is_active = TRUE`,
    [tenant.orgId, tenant.workspaceId]
  );

  for (const rule of rules.rows) {
    const condition = automationConditionSchema.safeParse(rule.condition_json);
    const action = automationActionSchema.safeParse(rule.action_json);
    if (!condition.success || !action.success) {
      await client.query(
        `INSERT INTO automation_runs (rule_id, trigger_source, status, result_json)
         VALUES ($1, $2, 'failed', $3::jsonb)`,
        [rule.id, itemId, JSON.stringify({ error: "Stored automation configuration is invalid." })]
      );
      continue;
    }

    if (condition.data.priority && condition.data.priority !== priority) {
      await client.query(
        `INSERT INTO automation_runs (rule_id, trigger_source, status, result_json)
         VALUES ($1, $2, 'skipped', $3::jsonb)`,
        [rule.id, itemId, JSON.stringify({ reason: "Priority condition did not match." })]
      );
      continue;
    }

    const body = action.data.body.replace(/\{title\}/g, itemTitle);
    await client.query(
      `INSERT INTO notifications (org_id, workspace_id, user_id, type, title, body)
       VALUES ($1, $2, $3, 'automation', $4, $5)`,
      [tenant.orgId, tenant.workspaceId, actorId, action.data.title, body]
    );
    broadcastToWorkspace(tenant.workspaceId, "notification:created", { userId: actorId });
    await client.query(
      `INSERT INTO automation_runs (rule_id, trigger_source, status, result_json)
       VALUES ($1, $2, 'succeeded', $3::jsonb)`,
      [rule.id, itemId, JSON.stringify({ action: action.data.type, recipientId: actorId })]
    );
  }
}
