import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";

export const orgRouter = Router();

orgRouter.use(authenticate, requireWorkspaceContext, requireRoles("owner", "admin"));

// 1. GET /api/org/members - Get all members of the organization
orgRouter.get(
  "/members",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const members = await query(
      `SELECT u.id, u.name, u.email,
              MIN(m.joined_at) AS "joinedAt",
              COALESCE(
                (SELECT role FROM memberships WHERE user_id = u.id AND org_id = $1 AND workspace_id IS NULL),
                (SELECT role FROM memberships WHERE user_id = u.id AND org_id = $1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END LIMIT 1)
              ) AS role
         FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE m.org_id = $1
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name`,
      [tenant.orgId]
    );

    response.json({ members: members.rows });
  })
);

// 2. PATCH /api/org/members/:id/role - Update an organization member's role
orgRouter.patch(
  "/members/:id/role",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const targetUserId = z.string().uuid().parse(request.params.id);
    const bodySchema = z.object({
      role: z.enum(["admin", "manager", "member", "viewer"])
    });
    const { role } = bodySchema.parse(request.body);

    if (targetUserId === request.auth!.id) {
      throw new HttpError(400, "You cannot update your own organization role.");
    }

    await withTransaction(async (client) => {
      // Check target user's current organization role
      const currentRoleQuery = await client.query<{ role: string }>(
        `SELECT role FROM memberships 
          WHERE org_id = $1 AND user_id = $2 AND workspace_id IS NULL`,
        [tenant.orgId, targetUserId]
      );
      
      const currentRole = currentRoleQuery.rows[0]?.role;
      if (currentRole === "owner") {
        throw new HttpError(403, "Owner role cannot be changed.");
      }

      if (tenant.role !== "owner" && currentRole === "admin") {
        throw new HttpError(403, "Only organization owners can modify admin roles.");
      }

      // Upsert the org-wide membership
      await client.query(
        `INSERT INTO memberships (org_id, workspace_id, user_id, role)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (org_id, user_id) WHERE workspace_id IS NULL
         DO UPDATE SET role = EXCLUDED.role`,
        [tenant.orgId, targetUserId, role]
      );

      // Audit Log
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'org.member_role_updated', 'user', $4, $5::jsonb)`,
        [
          tenant.orgId,
          tenant.workspaceId,
          request.auth!.id,
          targetUserId,
          JSON.stringify({ role })
        ]
      );
    });

    response.json({ message: "Organization member role updated successfully." });
  })
);

// 3. DELETE /api/org/members/:id - Remove a member from the organization
orgRouter.delete(
  "/members/:id",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const targetUserId = z.string().uuid().parse(request.params.id);

    if (targetUserId === request.auth!.id) {
      throw new HttpError(400, "You cannot remove yourself from the organization.");
    }

    await withTransaction(async (client) => {
      // Check target role
      const currentRoleQuery = await client.query<{ role: string }>(
        `SELECT role FROM memberships 
          WHERE org_id = $1 AND user_id = $2`,
        [tenant.orgId, targetUserId]
      );

      if (!currentRoleQuery.rowCount) {
        throw new HttpError(404, "Member not found in organization.");
      }

      const hasOwner = currentRoleQuery.rows.some((r) => r.role === "owner");
      if (hasOwner) {
        throw new HttpError(403, "Organization owner cannot be removed.");
      }

      const hasAdmin = currentRoleQuery.rows.some((r) => r.role === "admin");
      if (tenant.role !== "owner" && hasAdmin) {
        throw new HttpError(403, "Only organization owners can remove administrators.");
      }

      // Delete all memberships for user in this organization
      await client.query(
        `DELETE FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [tenant.orgId, targetUserId]
      );

      // Audit Log
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'org.member_removed', 'user', $4, '{}'::jsonb)`,
        [tenant.orgId, tenant.workspaceId, request.auth!.id, targetUserId]
      );
    });

    response.json({ message: "Member removed from organization successfully." });
  })
);

// 4. GET /api/org/audit-logs - Retrieve organization audit logs
orgRouter.get(
  "/audit-logs",
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const logs = await query(
      `SELECT al.id, al.org_id AS "orgId", al.workspace_id AS "workspaceId", al.actor_id AS "actorId",
              u.name AS "actorName", al.action, al.entity_type AS "entityType",
              al.entity_id AS "entityId", al.payload_json AS "payload", al.created_at AS "createdAt",
              w.name AS "workspaceName"
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
         LEFT JOIN workspaces w ON w.id = al.workspace_id
        WHERE al.org_id = $1
        ORDER BY al.created_at DESC
        LIMIT 100`,
      [tenant.orgId]
    );

    response.json({ logs: logs.rows });
  })
);

