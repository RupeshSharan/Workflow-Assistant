import { withTransaction } from "../db.js";
import type { TenantContext } from "../domain/types.js";
import { HttpError } from "../lib/http-error.js";
import { runWorkItemCreatedAutomations } from "./automation.js";

export interface CreateWorkItemCommand {
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  typeId?: string;
  templateId?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export async function createWorkItem(
  tenant: TenantContext,
  actorId: string,
  input: CreateWorkItemCommand
): Promise<string> {
  return withTransaction(async (client) => {
    if (input.assigneeId) {
      const assignee = await client.query(
        `SELECT id
           FROM memberships
          WHERE org_id = $1 AND workspace_id = $2 AND user_id = $3`,
        [tenant.orgId, tenant.workspaceId, input.assigneeId]
      );
      if (!assignee.rowCount) {
        throw new HttpError(400, "Assignee must be a member of this workspace.");
      }
    }

    const template = await client.query<{ id: string; stage_id: string }>(
      `SELECT wt.id, ws.id AS stage_id
         FROM workflow_templates wt
         JOIN workflow_stages ws ON ws.template_id = wt.id
        WHERE wt.org_id = $1
          AND wt.workspace_id = $2
          AND wt.deleted_at IS NULL
          AND ($3::uuid IS NULL OR wt.id = $3)
        ORDER BY
          CASE WHEN $3::uuid IS NOT NULL THEN 0 WHEN wt.is_default THEN 0 ELSE 1 END,
          ws.position
        LIMIT 1`,
      [tenant.orgId, tenant.workspaceId, input.templateId ?? null]
    );
    if (!template.rowCount) {
      throw new HttpError(400, "No available workflow template was found.");
    }

    const type = await client.query<{ id: string }>(
      `SELECT id
         FROM work_item_types
        WHERE org_id = $1
          AND workspace_id = $2
          AND ($3::uuid IS NULL OR id = $3)
        ORDER BY name
        LIMIT 1`,
      [tenant.orgId, tenant.workspaceId, input.typeId ?? null]
    );
    if (!type.rowCount) {
      throw new HttpError(400, "No available work item type was found.");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO work_items
         (org_id, workspace_id, type_id, template_id, current_stage_id, title,
          description, priority, assignee_id, reporter_id, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        tenant.orgId,
        tenant.workspaceId,
        type.rows[0]!.id,
        template.rows[0]!.id,
        template.rows[0]!.stage_id,
        input.title,
        input.description ?? null,
        input.priority,
        input.assigneeId ?? null,
        actorId,
        input.dueDate ?? null
      ]
    );
    const itemId = inserted.rows[0]!.id;

    await client.query(
      `INSERT INTO work_item_history
         (work_item_id, changed_by, field_name, old_value, new_value)
       VALUES ($1, $2, 'created', NULL, $3::jsonb)`,
      [itemId, actorId, JSON.stringify({ title: input.title })]
    );
    await client.query(
      `INSERT INTO audit_logs
         (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
       VALUES ($1, $2, $3, 'work_item.created', 'work_item', $4, $5::jsonb)`,
      [tenant.orgId, tenant.workspaceId, actorId, itemId, JSON.stringify({ title: input.title })]
    );
    await runWorkItemCreatedAutomations(client, tenant, actorId, itemId, input.title, input.priority);
    return itemId;
  });
}
