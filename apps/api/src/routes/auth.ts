import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { query, withTransaction } from "../db.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { uniqueOrganizationSlug } from "../lib/slug.js";
import { authenticate } from "../middleware/auth.js";
import { seedStarterWorkflow } from "../services/starter-workflow.js";
import { redis } from "../services/redis.js";
import { logger } from "../logger.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash?: string;
}

interface WorkspaceRow {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  role: string;
}

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  organizationName: z.string().trim().min(2).max(160),
  workspaceName: z.string().trim().min(2).max(160).default("General Workspace")
});

const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128)
});

export const authRouter = Router();

function issueToken(user: UserRow): string {
  return jwt.sign({ email: user.email }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"]
  });
}

async function getUserWorkspaces(userId: string): Promise<WorkspaceRow[]> {
  const workspaces = await query<WorkspaceRow>(
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

authRouter.post(
  "/register",
  asyncHandler(async (request, response) => {
    const input = registrationSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const created = await withTransaction(async (client) => {
      const existing = await client.query("SELECT id FROM users WHERE LOWER(email) = $1", [
        input.email
      ]);
      if (existing.rowCount) {
        throw new HttpError(409, "An account with this email already exists.");
      }

      const userResult = await client.query<UserRow>(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email`,
        [input.name, input.email, passwordHash]
      );
      const user = userResult.rows[0]!;

      const orgResult = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug)
         VALUES ($1, $2)
         RETURNING id`,
        [input.organizationName, uniqueOrganizationSlug(input.organizationName)]
      );
      const organizationId = orgResult.rows[0]!.id;

      const workspaceResult = await client.query<{ id: string }>(
        `INSERT INTO workspaces (org_id, name, description)
         VALUES ($1, $2, 'Initial workspace')
         RETURNING id`,
        [organizationId, input.workspaceName]
      );
      const workspaceId = workspaceResult.rows[0]!.id;

      await client.query(
        `INSERT INTO memberships (org_id, workspace_id, user_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [organizationId, workspaceId, user.id]
      );

      await seedStarterWorkflow(client, organizationId, workspaceId, user.id);

      await client.query(
        `INSERT INTO audit_logs
           (org_id, workspace_id, actor_id, action, entity_type, entity_id, payload_json)
         VALUES ($1, $2, $3, 'workspace.created', 'workspace', $2, $4::jsonb)`,
        [organizationId, workspaceId, user.id, JSON.stringify({ source: "registration" })]
      );

      return { user, workspaceId };
    });

    const workspaces = await getUserWorkspaces(created.user.id);
    response.status(201).json({
      token: issueToken(created.user),
      user: created.user,
      workspaces,
      activeWorkspaceId: created.workspaceId
    });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (request, response) => {
    const input = loginSchema.parse(request.body);
    const userResult = await query<UserRow>(
      `SELECT id, name, email, password_hash
         FROM users
        WHERE LOWER(email) = $1 AND is_active = TRUE`,
      [input.email]
    );
    const user = userResult.rows[0];

    if (!user?.password_hash || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new HttpError(401, "Email or password is incorrect.");
    }

    const safeUser: UserRow = { id: user.id, name: user.name, email: user.email };
    const workspaces = await getUserWorkspaces(user.id);
    response.json({
      token: issueToken(safeUser),
      user: safeUser,
      workspaces,
      activeWorkspaceId: workspaces[0]?.id ?? null
    });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (request, response) => {
    const workspaces = await getUserWorkspaces(request.auth!.id);
    response.json({ user: request.auth, workspaces });
  })
);

authRouter.post(
  "/refresh",
  authenticate,
  asyncHandler(async (request, response) => {
    const safeUser: UserRow = {
      id: request.auth!.id,
      name: request.auth!.name,
      email: request.auth!.email
    };
    const workspaces = await getUserWorkspaces(request.auth!.id);
    response.json({
      token: issueToken(safeUser),
      user: safeUser,
      workspaces
    });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (request, response) => {
    const authorization = request.header("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (token) {
      try {
        const decoded = jwt.decode(token) as any;
        if (decoded && typeof decoded.exp === "number") {
          const remainingSeconds = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
          if (remainingSeconds > 0) {
            await redis.set(`token_blocklist:${token}`, "1", "EX", remainingSeconds);
          }
        }
      } catch (err) {
        logger.error({ err }, "Error parsing token for blocklist registration during logout");
      }
    }

    response.json({ success: true, message: "Logged out successfully" });
  })
);
