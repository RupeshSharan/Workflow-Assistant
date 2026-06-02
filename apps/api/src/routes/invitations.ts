import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { authenticate, requireRoles, requireWorkspaceContext } from "../middleware/auth.js";
import { config } from "../config.js";
import { invalidateCache } from "../services/redis.js";
import { createInvitationSchema, acceptInvitationSchema } from "@workflow/shared";

export const invitationRouter = Router();

// Helper to issue JWT token (similar to auth.ts)
function issueToken(user: { id: string; name: string; email: string }): string {
  return jwt.sign({ email: user.email }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  });
}

// Helper to retrieve user workspaces
async function getUserWorkspaces(userId: string) {
  const workspaces = await query(
    `SELECT w.id,
            w.org_id AS "orgId",
            o.name AS "orgName",
            w.name,
            m.role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id AND w.org_id = m.org_id
       JOIN organizations o ON o.id = w.org_id
      WHERE m.user_id = $1
        AND w.deleted_at IS NULL
      ORDER BY o.name, w.name`,
    [userId]
  );
  return workspaces.rows;
}

// 1. POST /api/invitations - Create a new invitation (requires auth & workspace admin/owner/manager roles)
invitationRouter.post(
  "/",
  authenticate,
  requireWorkspaceContext,
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const { email, role, workspaceId } = createInvitationSchema.parse(request.body);
    const targetWorkspaceId = workspaceId || tenant.workspaceId;

    // Check if user is already a member of the target workspace
    const existingMembership = await query(
      `SELECT m.id FROM memberships m
        JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 AND m.workspace_id = $2 AND LOWER(u.email) = $3`,
      [tenant.orgId, targetWorkspaceId, email]
    );

    if ((existingMembership.rowCount ?? 0) > 0) {
      throw new HttpError(400, "User is already a member of this workspace.");
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

    const invitation = await withTransaction(async (client) => {
      // Deactivate any existing pending invitations for this email in this workspace
      await client.query(
        `UPDATE workspace_invitations SET status = 'revoked'
          WHERE org_id = $1 AND workspace_id = $2 AND LOWER(email) = $3 AND status = 'pending'`,
        [tenant.orgId, targetWorkspaceId, email]
      );

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO workspace_invitations (org_id, workspace_id, email, token, invited_by, role, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, email, role, expires_at AS "expiresAt"`,
        [tenant.orgId, targetWorkspaceId, email, token, request.auth!.id, role, expiresAt]
      );

      // Audit Log
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'invitation.created', 'invitation', $4, $5::jsonb)`,
        [
          tenant.orgId,
          targetWorkspaceId,
          request.auth!.id,
          inserted.rows[0]!.id,
          JSON.stringify({ email, role })
        ]
      );

      return inserted.rows[0]!;
    });

    response.status(201).json({
      invitation,
      inviteUrl: `${config.WEB_ORIGIN}/accept-invitation?token=${token}`
    });
  })
);

// 2. GET /api/invitations - List all invitations (requires auth & workspace context)
invitationRouter.get(
  "/",
  authenticate,
  requireWorkspaceContext,
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const invitations = await query(
      `SELECT i.id, i.email, i.role, i.status, i.expires_at AS "expiresAt", i.created_at AS "createdAt",
              u.name AS "invitedBy"
         FROM workspace_invitations i
         JOIN users u ON u.id = i.invited_by
        WHERE i.org_id = $1
        ORDER BY i.created_at DESC`,
      [tenant.orgId]
    );

    response.json({ invitations: invitations.rows });
  })
);

// 3. GET /api/invitations/:token - Public endpoint to retrieve details of a pending invitation
invitationRouter.get(
  "/:token",
  asyncHandler(async (request, response) => {
    const token = z.string().trim().parse(request.params.token);
    const result = await query<{
      email: string;
      role: string;
      status: string;
      expiresAt: Date;
      orgName: string;
      workspaceName: string;
      invitedByName: string;
    }>(
      `SELECT i.email, i.role, i.status, i.expires_at AS "expiresAt",
              o.name AS "orgName",
              w.name AS "workspaceName",
              u.name AS "invitedByName"
         FROM workspace_invitations i
         JOIN organizations o ON o.id = i.org_id
         LEFT JOIN workspaces w ON w.id = i.workspace_id
         JOIN users u ON u.id = i.invited_by
        WHERE i.token = $1 AND i.status = 'pending' AND i.expires_at > NOW()`,
      [token]
    );

    if (!(result.rowCount ?? 0)) {
      throw new HttpError(400, "Invitation token is invalid, expired, or already accepted.");
    }

    response.json({ invitation: result.rows[0] });
  })
);

// 4. POST /api/invitations/:token/accept - Public endpoint to accept a pending invitation
invitationRouter.post(
  "/:token/accept",
  asyncHandler(async (request, response) => {
    const token = z.string().trim().parse(request.params.token);
    const { name, password } = acceptInvitationSchema.parse(request.body);

    // Get invitation details
    const inviteQuery = await query<{
      id: string;
      org_id: string;
      workspace_id: string | null;
      email: string;
      role: string;
    }>(
      `SELECT id, org_id, workspace_id, email, role 
         FROM workspace_invitations
        WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [token]
    );

    if (!(inviteQuery.rowCount ?? 0)) {
      throw new HttpError(400, "Invitation is invalid, expired, or already accepted.");
    }

    const invitation = inviteQuery.rows[0]!;

    // Check if user exists
    const userQuery = await query<{ id: string; name: string; email: string; password_hash: string }>(
      `SELECT id, name, email, password_hash FROM users WHERE LOWER(email) = $1 AND is_active = TRUE`,
      [invitation.email.toLowerCase()]
    );

    const userExists = (userQuery.rowCount ?? 0) > 0;
    let targetUserId = "";
    let userRecord: { id: string; name: string; email: string };

    if (userExists) {
      const existingUser = userQuery.rows[0]!;
      targetUserId = existingUser.id;
      userRecord = { id: existingUser.id, name: existingUser.name, email: existingUser.email };

      // Verify credentials if not logged in
      const authHeader = request.header("authorization");
      let authenticatedUserId: string | null = null;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const jwtToken = authHeader.slice("Bearer ".length);
          const decoded = jwt.verify(jwtToken, config.JWT_SECRET) as { sub: string };
          authenticatedUserId = decoded.sub;
        } catch {
          // ignore invalid token error during public invitation accept
        }
      }

      if (authenticatedUserId && authenticatedUserId === targetUserId) {
        // Logged in as the invited user. Proceed.
      } else {
        // Authenticate with password
        if (!password) {
          throw new HttpError(401, "Account already exists. Please provide your password to accept.");
        }
        const matches = await bcrypt.compare(password, existingUser.password_hash);
        if (!matches) {
          throw new HttpError(401, "Invalid password credentials.");
        }
      }
    } else {
      // Must supply name and password to create new account
      if (!name || !password) {
        throw new HttpError(400, "Please provide a name and password to complete registration.");
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const createdUser = await query<{ id: string; name: string; email: string }>(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email`,
        [name, invitation.email.toLowerCase(), passwordHash]
      );
      
      userRecord = createdUser.rows[0]!;
      targetUserId = userRecord.id;
    }

    // Link user to organization and workspace inside a transaction
    await withTransaction(async (client) => {
      // Org membership (workspace_id = null)
      await client.query(
        `INSERT INTO memberships (org_id, workspace_id, user_id, role)
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (org_id, user_id) WHERE workspace_id IS NULL
         DO NOTHING`,
        [invitation.org_id, targetUserId, invitation.role === "admin" ? "admin" : "member"]
      );

      // Workspace membership (workspace_id = invitation.workspace_id)
      if (invitation.workspace_id) {
        await client.query(
          `INSERT INTO memberships (org_id, workspace_id, user_id, role)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, user_id) WHERE workspace_id IS NOT NULL
           DO UPDATE SET role = EXCLUDED.role`,
          [invitation.org_id, invitation.workspace_id, targetUserId, invitation.role]
        );
      }

      // Mark invitation accepted
      await client.query(
        `UPDATE workspace_invitations 
            SET status = 'accepted', accepted_at = NOW() 
          WHERE id = $1`,
        [invitation.id]
      );

      // Audit Log
      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'invitation.accepted', 'invitation', $4, '{}'::jsonb)`,
        [invitation.org_id, invitation.workspace_id, targetUserId, invitation.id]
      );
    });

    await invalidateCache(`user:workspaces:${targetUserId}`);
    const workspaces = await getUserWorkspaces(targetUserId);
    const activeWorkspaceId = invitation.workspace_id || workspaces[0]?.id || null;

    response.status(200).json({
      token: issueToken(userRecord),
      user: userRecord,
      workspaces,
      activeWorkspaceId
    });
  })
);

// 5. DELETE /api/invitations/:id - Revoke invitation (requires auth & admin/owner/manager roles)
invitationRouter.delete(
  "/:id",
  authenticate,
  requireWorkspaceContext,
  requireRoles("owner", "admin", "manager"),
  asyncHandler(async (request, response) => {
    const tenant = request.tenant!;
    const inviteId = z.string().uuid().parse(request.params.id);

    const result = await query(
      `UPDATE workspace_invitations SET status = 'revoked'
        WHERE id = $1 AND org_id = $2 AND status = 'pending'
        RETURNING id`,
      [inviteId, tenant.orgId]
    );

    if (!(result.rowCount ?? 0)) {
      throw new HttpError(404, "Pending invitation not found.");
    }

    // Audit Log
    await query(
      `INSERT INTO audit_logs
         (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
       VALUES ($1, $2, $3, 'invitation.revoked', 'invitation', $4, '{}'::jsonb)`,
      [tenant.orgId, tenant.workspaceId, request.auth!.id, inviteId]
    );

    response.json({ message: "Invitation revoked successfully." });
  })
);
