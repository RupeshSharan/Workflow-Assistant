import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { authenticate, requireWorkspaceContext } from "../middleware/auth.js";

export const dashboardRouter = Router();

dashboardRouter.use(authenticate, requireWorkspaceContext);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const [stages, metrics] = await Promise.all([
      query(
        `SELECT ws.id, ws.name, ws.color, ws.position, COUNT(wi.id)::INTEGER AS count
           FROM workflow_stages ws
           JOIN workflow_templates wt
             ON wt.id = ws.template_id
            AND wt.org_id = $1
            AND wt.workspace_id = $2
            AND wt.is_default = TRUE
            AND wt.deleted_at IS NULL
           LEFT JOIN work_items wi
             ON wi.current_stage_id = ws.id
            AND wi.org_id = $1
            AND wi.workspace_id = $2
            AND wi.deleted_at IS NULL
          GROUP BY ws.id
          ORDER BY ws.position`,
        [tenant.orgId, tenant.workspaceId]
      ),
      query(
        `SELECT COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE due_date < NOW() AND closed_at IS NULL)::INTEGER AS overdue,
                COUNT(*) FILTER (WHERE priority IN ('high', 'urgent') AND closed_at IS NULL)::INTEGER AS priority
           FROM work_items
          WHERE org_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [tenant.orgId, tenant.workspaceId]
      )
    ]);

    response.json({
      workspace: { id: tenant.workspaceId, name: tenant.workspaceName },
      metrics: metrics.rows[0],
      stages: stages.rows
    });
  })
);
