import type { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { query } from "../db.js";

let io: Server | null = null;

interface TokenPayload {
  sub: string;
  email: string;
}

/**
 * Initialize the Socket.io server with JWT authentication and workspace room routing.
 */
export function initSocket(httpServer: HttpServer, corsOrigin: string): Server {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      credentials: true,
      allowedHeaders: ["content-type", "authorization", "x-workspace-id"]
    }
  });

  // JWT Authentication middleware for Sockets
  io.use(async (socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const token = auth.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
      const workspaceId = auth.workspaceId || socket.handshake.headers["x-workspace-id"];

      if (!token) {
        return next(new Error("Authentication error: Token is required"));
      }

      if (!workspaceId) {
        return next(new Error("Authentication error: Workspace ID is required"));
      }

      // Verify token
      const decoded = jwt.verify(token, config.JWT_SECRET) as TokenPayload;
      const userId = decoded.sub;

      // Verify workspace membership
      const membership = await query(
        `SELECT role FROM memberships WHERE user_id = $1 AND workspace_id = $2`,
        [userId, workspaceId]
      );

      if (!membership.rowCount) {
        return next(new Error("Authentication error: Workspace membership not found"));
      }

      // Attach data to socket
      socket.data = {
        userId,
        email: decoded.email,
        workspaceId,
        role: membership.rows[0]!.role
      };

      next();
    } catch (error) {
      logger.error({ error }, "Socket handshake authentication failed");
      next(new Error("Authentication error: Invalid credentials"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { workspaceId, userId, email } = socket.data;
    const roomName = `workspace:${workspaceId}`;

    logger.info({ userId, email, workspaceId }, "Authenticated socket client connected");

    // Join the workspace room
    void socket.join(roomName);

    socket.emit("service:ready", {
      message: `Successfully subscribed to real-time room for workspace: ${workspaceId}`
    });

    socket.on("disconnect", () => {
      logger.info({ userId, workspaceId }, "Socket client disconnected");
    });
  });

  return io;
}

/**
 * Broadcasts an event to all users in a specific workspace room.
 */
export function broadcastToWorkspace(workspaceId: string, eventName: string, payload: unknown): void {
  if (!io) {
    logger.warn("Socket.io server is not initialized yet. Skipping broadcast.");
    return;
  }

  const roomName = `workspace:${workspaceId}`;
  io.to(roomName).emit(eventName, payload);
  logger.info({ workspaceId, eventName }, "Broadcasted real-time workspace event");
}
