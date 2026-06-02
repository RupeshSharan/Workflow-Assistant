import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";

export const webhookRouter = Router();

webhookRouter.use(authenticate, requireWorkspaceContext);

const createWebhookSchema = z.object({
  url: z.string().trim().url(),
  events: z.array(z.string().trim()).min(1),
  secretToken: z.string().trim().max(128).optional().nullable()
});

webhookRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const result = await query(
      `SELECT id, url, events, secret_token AS "secretToken", is_active AS "isActive", created_at AS "createdAt"
         FROM webhook_subscriptions
        WHERE org_id = $1 AND workspace_id = $2
        ORDER BY created_at DESC`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ subscriptions: result.rows });
  })
);

webhookRouter.post(
  "/",
  requireRoles("owner", "admin"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const input = createWebhookSchema.parse(request.body);

    const result = await query<{ id: string }>(
      `INSERT INTO webhook_subscriptions (org_id, workspace_id, url, events, secret_token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenant.orgId, tenant.workspaceId, input.url, input.events, input.secretToken ?? null]
    );

    response.status(201).json({ id: result.rows[0]!.id });
  })
);

webhookRouter.delete(
  "/:id",
  requireRoles("owner", "admin"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const subId = z.string().uuid().parse(request.params.id);

    const result = await query(
      `DELETE FROM webhook_subscriptions
        WHERE id = $1 AND org_id = $2 AND workspace_id = $3`,
      [subId, tenant.orgId, tenant.workspaceId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "Webhook subscription not found.");
    }

    response.json({ message: "Webhook subscription deleted successfully." });
  })
);
