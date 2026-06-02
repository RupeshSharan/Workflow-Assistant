import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import { seedStarterWorkflow } from "../services/starter-workflow.js";
import { getCached, setCached, invalidateCache } from "../services/redis.js";

interface WorkspaceRow {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  description: string | null;
  visibility: string;
  settings: Record<string, unknown>;
  role: string;
}

import { createWorkspaceSchema, workspaceMemberSchema as memberSchema } from "@workflow/shared";

export const workspaceRouter = Router();

workspaceRouter.use(authenticate);

workspaceRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const cacheKey = `user:workspaces:${request.auth!.id}`;
    const cached = await getCached<WorkspaceRow[]>(cacheKey);
    if (cached) {
      response.json({ workspaces: cached });
      return;
    }

    const result = await query<WorkspaceRow>(
      `SELECT w.id,
              w.org_id AS "orgId",
              o.name AS "orgName",
              w.name,
              w.description,
              w.visibility,
              w.settings_json AS settings,
              m.role
         FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id AND w.org_id = m.org_id
         JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1
          AND w.deleted_at IS NULL
        ORDER BY o.name, w.name`,
      [request.auth!.id]
    );

    await setCached(cacheKey, result.rows, 300);
    response.json({ workspaces: result.rows });
  })
);

workspaceRouter.post(
  "/",
  requireWorkspaceContext,
  requireRoles("owner", "admin"),
  asyncHandler(async (request, response) => {
    const input = createWorkspaceSchema.parse(request.body);
    const tenant = request.tenant!;
    const workspace = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workspaces (org_id, name, description, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [tenant.orgId, input.name, input.description ?? null, input.visibility]
      );
      const workspaceId = inserted.rows[0]!.id;
      const creatorRole = tenant.role === "owner" ? "owner" : "admin";

      await client.query(
        `INSERT INTO memberships (org_id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, $4)`,
        [tenant.orgId, workspaceId, request.auth!.id, creatorRole]
      );
      await seedStarterWorkflow(client, tenant.orgId, workspaceId, request.auth!.id);
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'workspace.created', 'workspace', $2, $4::jsonb)`,
        [
          tenant.orgId,
          workspaceId,
          request.auth!.id,
          JSON.stringify({ sourceWorkspaceId: tenant.workspaceId, name: input.name })
        ]
      );
      return workspaceId;
    });

    await invalidateCache(`user:workspaces:${request.auth!.id}`);
    response.status(201).json({ id: workspace });
  })
);

workspaceRouter.get(
  "/:id/members",
  requireWorkspaceContext,
  asyncHandler(async (request, response) => {
    const workspaceId = z.string().uuid().parse(request.params.id);
    const tenant = request.tenant!;
    if (workspaceId !== tenant.workspaceId) {
      throw new HttpError(403, "Select this workspace before viewing its members.");
    }

    const members = await query(
      `SELECT u.id, u.name, u.email, m.role, m.joined_at AS "joinedAt"
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1
          AND m.workspace_id = $2
        ORDER BY
          CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
          u.name`,
      [tenant.orgId, tenant.workspaceId]
    );
    response.json({ members: members.rows });
  })
);

workspaceRouter.post(
  "/:id/members",
  requireWorkspaceContext,
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const workspaceId = z.string().uuid().parse(request.params.id);
    const tenant = request.tenant!;
    const input = memberSchema.parse(request.body);
    if (workspaceId !== tenant.workspaceId) {
      throw new HttpError(403, "Select this workspace before changing its members.");
    }
    if (tenant.role !== "owner" && input.role === "admin") {
      throw new HttpError(403, "Only a workspace owner can appoint an administrator.");
    }

    const user = await query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND is_active = TRUE`,
      [input.email]
    );
    if (!user.rowCount) {
      throw new HttpError(404, "The user must create an account before they can be added.");
    }

    const member = await withTransaction(async (client) => {
      const existingMembership = await client.query<{ role: string }>(
        `SELECT role
           FROM memberships
          WHERE org_id = $1
            AND workspace_id = $2
            AND user_id = $3
          FOR UPDATE`,
        [tenant.orgId, tenant.workspaceId, user.rows[0]!.id]
      );
      const currentRole = existingMembership.rows[0]?.role;
      if (currentRole === "owner") {
        throw new HttpError(403, "Owner membership cannot be changed through this action.");
      }
      if (tenant.role !== "owner" && currentRole === "admin") {
        throw new HttpError(403, "Only an owner can change an administrator membership.");
      }

      const assigned = await client.query(
        `INSERT INTO memberships (org_id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id) WHERE workspace_id IS NOT NULL
         DO UPDATE SET role = EXCLUDED.role
         RETURNING role, joined_at AS "joinedAt"`,
        [tenant.orgId, tenant.workspaceId, user.rows[0]!.id, input.role]
      );
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'membership.assigned', 'user', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          user.rows[0]!.id,
          JSON.stringify({ role: input.role })
        ]
      );
      return assigned.rows[0] as { role: string; joinedAt: string };
    });

    await invalidateCache(`user:workspaces:${user.rows[0]!.id}`);
    response.status(201).json({
      member: { ...user.rows[0]!, ...member }
    });
  })
);
