import { Router } from "express";
import { query } from "../db.js";
import { redis } from "../services/redis.js";
import { config } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";

export const healthRouter = Router();

// Liveness check - verifies process liveness and DB status for Vitest integration tests
healthRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    await query("SELECT 1");
    response.json({
      status: "ok",
      service: "workflow-api",
      database: "connected"
    });
  })
);

// Readiness check - verifies all downstream dependencies (Postgres, Redis, Ollama)
healthRouter.get(
  "/ready",
  asyncHandler(async (_request, response) => {
    const details: Record<string, string> = {
      database: "down",
      redis: "down",
      ollama: "down"
    };
    let isHealthy = true;

    // 1. Check PostgreSQL
    try {
      await query("SELECT 1");
      details.database = "up";
    } catch (err) {
      isHealthy = false;
    }

    // 2. Check Redis
    try {
      const pingRes = await redis.ping();
      if (pingRes === "PONG") {
        details.redis = "up";
      } else {
        isHealthy = false;
      }
    } catch (err) {
      isHealthy = false;
    }

    // 3. Check Ollama base url
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 2000); // 2 second timeout
      const res = await fetch(`${config.OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        details.ollama = "up";
      } else {
        details.ollama = "unreachable";
      }
    } catch (err) {
      details.ollama = "down";
    }

    if (!isHealthy) {
      response.status(503).json({
        status: "unhealthy",
        details
      });
      return;
    }

    response.json({
      status: "healthy",
      details
    });
  })
);
