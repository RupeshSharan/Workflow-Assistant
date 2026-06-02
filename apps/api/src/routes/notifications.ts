import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireWorkspaceContext } from "../middleware/auth.js";
import { paginationQuerySchema } from "../lib/pagination.js";

export const notificationRouter = Router();

notificationRouter.use(authenticate, requireWorkspaceContext);

notificationRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const { limit, offset } = paginationQuerySchema.parse(request.query);

    const countResult = await query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM notifications
        WHERE org_id = $1
          AND workspace_id = $2
          AND user_id = $3`,
      [tenant.orgId, tenant.workspaceId, request.auth!.id]
    );
    const total = countResult.rows[0]?.count ?? 0;

    const notifications = await query(
      `SELECT id, type, title, body, read_at AS "readAt", created_at AS "createdAt"
         FROM notifications
        WHERE org_id = $1
          AND workspace_id = $2
          AND user_id = $3
        ORDER BY created_at DESC
        LIMIT $4 OFFSET $5`,
      [tenant.orgId, tenant.workspaceId, request.auth!.id, limit, offset]
    );
    response.json({
      notifications: notifications.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + notifications.rows.length < total
      }
    });
  })
);

notificationRouter.post(
  "/:id/read",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const notificationId = z.string().uuid().parse(request.params.id);
    const result = await query(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND org_id = $2 AND workspace_id = $3 AND user_id = $4
        RETURNING id, read_at AS "readAt"`,
      [notificationId, tenant.orgId, tenant.workspaceId, request.auth!.id]
    );
    if (!result.rowCount) {
      throw new HttpError(404, "Notification was not found.");
    }
    response.json({ notification: result.rows[0] });
  })
);
