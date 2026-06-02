import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";

const typeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.string().trim().max(80).nullable().optional(),
  defaultTemplateId: z.string().uuid()
});

interface TypeRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  defaultTemplateId: string | null;
}

export const workItemTypeRouter = Router();

workItemTypeRouter.use(authenticate, requireWorkspaceContext);

workItemTypeRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const types = await query<TypeRow>(
      `SELECT id,
              name,
              description,
              icon,
              default_template_id AS "defaultTemplateId"
         FROM work_item_types
        WHERE org_id = $1
          AND workspace_id = $2
        ORDER BY name`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ types: types.rows });
  })
);

workItemTypeRouter.post(
  "/",
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = typeSchema.parse(request.body);
    const inserted = await query<{ id: string }>(
      `INSERT INTO work_item_types
         (org_id, workspace_id, name, description, icon, default_template_id)
       SELECT $1, $2, $3, $4, $5, wt.id
         FROM workflow_templates wt
        WHERE wt.id = $6
          AND wt.org_id = $1
          AND wt.workspace_id = $2
          AND wt.deleted_at IS NULL
       RETURNING id`,
      [
        tenant.orgId,
        tenant.workspaceId,
        input.name,
        input.description ?? null,
        input.icon ?? null,
        input.defaultTemplateId
      ]
    );

    if (!inserted.rowCount) {
      response.status(400).json({ error: "Default workflow template is not available in this workspace." });
      return;
    }

    response.status(201).json({ id: inserted.rows[0]!.id });
  })
);
