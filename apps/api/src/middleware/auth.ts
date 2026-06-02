import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import type { AuthenticatedUser, TenantContext } from "../domain/types.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError } from "../lib/http-error.js";
import { redis } from "../services/redis.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
}

interface TenantRow {
  org_id: string;
  workspace_id: string;
  workspace_name: string;
  role: TenantContext["role"];
}

export const authenticate = asyncHandler(async (request, _response, next) => {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;

  if (!token) {
    throw new HttpError(401, "Authentication is required.");
  }

  const isBlocked = await redis.get(`token_blocklist:${token}`);
  if (isBlocked) {
    throw new HttpError(401, "Authentication token has been revoked.");
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      throw new Error("Token subject missing.");
    }
    userId = payload.sub;
  } catch {
    throw new HttpError(401, "Authentication token is invalid or expired.");
  }

  const user = await query<UserRow>(
    `SELECT id, name, email
       FROM users
      WHERE id = $1 AND is_active = TRUE`,
    [userId]
  );

  if (!user.rowCount) {
    throw new HttpError(401, "Authentication user is not active.");
  }

  request.auth = user.rows[0] as AuthenticatedUser;
  next();
});

export const requireWorkspaceContext = asyncHandler(async (request, _response, next) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication is required.");
  }

  const header = request.header("x-workspace-id");
  const parsedWorkspaceId = z.string().uuid().safeParse(header);
  if (!parsedWorkspaceId.success) {
    throw new HttpError(400, "A valid x-workspace-id header is required.");
  }

  const membership = await query<TenantRow>(
    `SELECT m.org_id, m.workspace_id, w.name AS workspace_name, m.role
       FROM memberships m
       JOIN workspaces w
         ON w.id = m.workspace_id
        AND w.org_id = m.org_id
      WHERE m.user_id = $1
        AND m.workspace_id = $2
        AND w.deleted_at IS NULL`,
    [request.auth.id, parsedWorkspaceId.data]
  );

  if (!membership.rowCount) {
    throw new HttpError(403, "You do not have access to this workspace.");
  }

  const row = membership.rows[0]!;
  request.tenant = {
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    role: row.role
  };
  next();
});

export function requireRoles(...allowedRoles: TenantContext["role"][]): RequestHandler {
  return (request, _response, next) => {
    if (!request.tenant || !allowedRoles.includes(request.tenant.role)) {
      next(new HttpError(403, "Your role cannot perform this action."));
      return;
    }
    next();
  };
}
