import { Router } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import type { TenantContext } from "../domain/types.js";
import { createWorkItem } from "../services/create-work-item.js";
import { broadcastToWorkspace } from "../services/socket.js";
import { enqueueWebhook } from "../services/queue.js";
import {
  paginationQuerySchema,
  createWorkItemSchema as createSchema,
  updateWorkItemSchema as updateSchema,
  transitionWorkItemSchema as transitionSchema,
  commentWorkItemSchema as commentSchema
} from "@workflow/shared";

interface WorkItemRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  stageId: string;
  stageName: string;
  stageColor: string;
  stageTerminal: boolean;
  typeId: string;
  typeName: string;
  templateId: string;
  templateName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  reporterId: string;
  reporterName: string;
}

const itemSelection = `
  SELECT wi.id,
         wi.title,
         wi.description,
         wi.priority,
         wi.due_date AS "dueDate",
         wi.created_at AS "createdAt",
         wi.updated_at AS "updatedAt",
         ws.id AS "stageId",
         ws.name AS "stageName",
         ws.color AS "stageColor",
         ws.is_terminal AS "stageTerminal",
         wit.id AS "typeId",
         wit.name AS "typeName",
         wt.id AS "templateId",
         wt.name AS "templateName",
         assignee.id AS "assigneeId",
         assignee.name AS "assigneeName",
         reporter.id AS "reporterId",
         reporter.name AS "reporterName"
    FROM work_items wi
    JOIN workflow_stages ws ON ws.id = wi.current_stage_id
    JOIN work_item_types wit ON wit.id = wi.type_id
    JOIN workflow_templates wt ON wt.id = wi.template_id
    JOIN users reporter ON reporter.id = wi.reporter_id
    LEFT JOIN users assignee ON assignee.id = wi.assignee_id
`;

async function ensureWorkspaceAssignee(
  client: PoolClient,
  tenant: TenantContext,
  assigneeId: string | null | undefined
): Promise<void> {
  if (!assigneeId) {
    return;
  }

  const result = await client.query(
    `SELECT id
       FROM memberships
      WHERE org_id = $1
        AND workspace_id = $2
        AND user_id = $3`,
    [tenant.orgId, tenant.workspaceId, assigneeId]
  );
  if (!result.rowCount) {
    throw new HttpError(400, "Assignee must be a member of this workspace.");
  }
}

async function getItem(
  itemId: string,
  tenant: TenantContext
): Promise<WorkItemRow> {
  const result = await query<WorkItemRow>(
    `${itemSelection}
      WHERE wi.id = $1
        AND wi.org_id = $2
        AND wi.workspace_id = $3
        AND wi.deleted_at IS NULL`,
    [itemId, tenant.orgId, tenant.workspaceId]
  );
  if (!result.rowCount) {
    throw new HttpError(404, "Work item was not found.");
  }
  return result.rows[0]!;
}

export const workItemRouter = Router();

workItemRouter.use(authenticate, requireWorkspaceContext);

workItemRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const { limit, offset } = paginationQuerySchema.parse(request.query);

    const countResult = await query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM work_items
        WHERE org_id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL`,
      [tenant.orgId, tenant.workspaceId]
    );
    const total = countResult.rows[0]?.count ?? 0;

    const items = await query<WorkItemRow>(
      `${itemSelection}
        WHERE wi.org_id = $1
          AND wi.workspace_id = $2
          AND wi.deleted_at IS NULL
        ORDER BY wi.updated_at DESC
        LIMIT $3 OFFSET $4`,
      [tenant.orgId, tenant.workspaceId, limit, offset]
    );

    response.json({
      items: items.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + items.rows.length < total
      }
    });
  })
);

workItemRouter.post(
  "/",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = createSchema.parse(request.body);
    const itemId = await createWorkItem(tenant, request.auth!.id, input);
    broadcastToWorkspace(tenant.workspaceId, "work-item:created", { itemId });

    const item = await getItem(itemId, tenant);
    await enqueueWebhook?.({
      orgId: tenant.orgId,
      workspaceId: tenant.workspaceId,
      event: "work_item.created",
      payload: { item }
    });

    response.status(201).json({ item });
  })
);

workItemRouter.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const itemId = z.string().uuid().parse(request.params.id);
    response.json({ item: await getItem(itemId, request.tenant!) });
  })
);

workItemRouter.patch(
  "/:id",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const itemId = z.string().uuid().parse(request.params.id);
    const input = updateSchema.parse(request.body);

    await withTransaction(async (client) => {
      const prior = await client.query<Record<string, unknown>>(
        `SELECT title, description, priority, assignee_id, due_date
           FROM work_items
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3 AND deleted_at IS NULL
          FOR UPDATE`,
        [itemId, tenant.orgId, tenant.workspaceId]
      );
      if (!prior.rowCount) {
        throw new HttpError(404, "Work item was not found.");
      }
      await ensureWorkspaceAssignee(client, tenant, input.assigneeId);

      const fieldColumns: Record<string, string> = {
        title: "title",
        description: "description",
        priority: "priority",
        assigneeId: "assignee_id",
        dueDate: "due_date"
      };
      const previousColumns: Record<string, string> = {
        title: "title",
        description: "description",
        priority: "priority",
        assigneeId: "assignee_id",
        dueDate: "due_date"
      };
      const assignments: string[] = [];
      const values: unknown[] = [itemId, tenant.orgId, tenant.workspaceId];

      for (const [field, value] of Object.entries(input)) {
        assignments.push(`${fieldColumns[field]} = $${values.length + 1}`);
        values.push(value ?? null);
        await client.query(
          `INSERT INTO work_item_history
             (work_item_id, changed_by, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            itemId,
            request.auth!.id,
            field,
            JSON.stringify(prior.rows[0]![previousColumns[field]!]),
            JSON.stringify(value ?? null)
          ]
        );
      }

      await client.query(
        `UPDATE work_items
            SET ${assignments.join(", ")}
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3`,
        values
      );
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'work_item.updated', 'work_item', $4, $5::jsonb)`,
        [tenant.orgId, tenant.workspaceId, request.auth!.id, itemId, JSON.stringify(input)]
      );
    });

    broadcastToWorkspace(tenant.workspaceId, "work-item:updated", { itemId });
    
    const item = await getItem(itemId, tenant);
    await enqueueWebhook?.({
      orgId: tenant.orgId,
      workspaceId: tenant.workspaceId,
      event: "work_item.updated",
      payload: { item }
    });

    response.json({ item });
  })
);

workItemRouter.post(
  "/:id/transitions",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const itemId = z.string().uuid().parse(request.params.id);
    const input = transitionSchema.parse(request.body);

    await withTransaction(async (client) => {
      const item = await client.query<{ template_id: string; current_stage_id: string }>(
        `SELECT template_id, current_stage_id
           FROM work_items
          WHERE id = $1 AND org_id = $2 AND workspace_id = $3 AND deleted_at IS NULL
          FOR UPDATE`,
        [itemId, tenant.orgId, tenant.workspaceId]
      );
      if (!item.rowCount) {
        throw new HttpError(404, "Work item was not found.");
      }

      const current = item.rows[0]!;
      const destination = await client.query<{ id: string; is_terminal: boolean }>(
        `SELECT ws.id, ws.is_terminal
           FROM workflow_transitions transition
           JOIN workflow_stages ws
             ON ws.id = transition.to_stage_id
            AND ws.template_id = transition.template_id
          WHERE transition.template_id = $1
            AND transition.from_stage_id = $2
            AND transition.to_stage_id = $3`,
        [current.template_id, current.current_stage_id, input.toStageId]
      );
      if (!destination.rowCount) {
        throw new HttpError(409, "That workflow transition is not allowed.");
      }

      await client.query(
        `UPDATE work_items
            SET current_stage_id = $1,
                started_at = COALESCE(started_at, NOW()),
                closed_at = CASE WHEN $2 THEN NOW() ELSE NULL END
          WHERE id = $3`,
        [input.toStageId, destination.rows[0]!.is_terminal, itemId]
      );
      await client.query(
        `INSERT INTO work_item_history
           (work_item_id, changed_by, field_name, old_value, new_value)
         VALUES ($1, $2, 'current_stage_id', $3::jsonb, $4::jsonb)`,
        [
          itemId,
          request.auth!.id,
          JSON.stringify(current.current_stage_id),
          JSON.stringify(input.toStageId)
        ]
      );
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'work_item.transitioned', 'work_item', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          itemId,
          JSON.stringify({ from: current.current_stage_id, to: input.toStageId })
        ]
      );
    });

    broadcastToWorkspace(tenant.workspaceId, "work-item:transitioned", { itemId });
    
    const item = await getItem(itemId, tenant);
    await enqueueWebhook?.({
      orgId: tenant.orgId,
      workspaceId: tenant.workspaceId,
      event: "work_item.updated",
      payload: { item }
    });

    response.json({ item });
  })
);

workItemRouter.get(
  "/:id/comments",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const itemId = z.string().uuid().parse(request.params.id);
    await getItem(itemId, tenant);
    const comments = await query(
      `SELECT c.id, c.content, c.created_at AS "createdAt", u.id AS "userId", u.name AS "userName"
         FROM comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.work_item_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.created_at`,
      [itemId]
    );
    response.json({ comments: comments.rows });
  })
);

workItemRouter.get(
  "/:id/history",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const itemId = z.string().uuid().parse(request.params.id);
    await getItem(itemId, tenant);
    const history = await query(
      `SELECT history.id,
              history.field_name AS "fieldName",
              history.old_value AS "oldValue",
              history.new_value AS "newValue",
              history.changed_at AS "changedAt",
              users.name AS "changedBy"
         FROM work_item_history history
         JOIN users ON users.id = history.changed_by
        WHERE history.work_item_id = $1
        ORDER BY history.changed_at DESC`,
      [itemId]
    );
    response.json({ history: history.rows });
  })
);

workItemRouter.post(
  "/:id/comments",
  requireRoles("owner", "admin", "manager", "member"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const itemId = z.string().uuid().parse(request.params.id);
    const input = commentSchema.parse(request.body);
    await getItem(itemId, tenant);
    const inserted = await query(
      `INSERT INTO comments (work_item_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at AS "createdAt"`,
      [itemId, request.auth!.id, input.content]
    );
    broadcastToWorkspace(tenant.workspaceId, "work-item:comment-added", { itemId });
    response.status(201).json({ comment: inserted.rows[0] });
  })
);
