import { createServer } from "node:http";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDatabase } from "./db.js";
import { logger } from "./logger.js";
import { initSocket } from "./services/socket.js";
import { initializeStorage } from "./services/storage.js";
import { initializeScheduler, closeQueue } from "./services/queue.js";
import { closeRedis } from "./services/redis.js";

const httpServer = createServer(app);
const socketServer = initSocket(httpServer, config.WEB_ORIGIN);

httpServer.listen(config.PORT, async () => {
  logger.info({ port: config.PORT }, "Workflow API is listening");
  try {
    await initializeStorage();
    await initializeScheduler();
  } catch (error) {
    logger.error({ error }, "Failed to initialize storage or scheduler service");
  }
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Initiating graceful shutdown...");

  // Stop accepting new socket connections
  socketServer.close();

  // Stop accepting new HTTP connections and wait for in-flight requests to complete
  httpServer.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error during HTTP server close");
    } else {
      logger.info("HTTP server connection pool drained.");
    }

    try {
      logger.info("Closing background workers and queues...");
      await closeQueue();
      
      logger.info("Closing Redis connection pool...");
      await closeRedis();

      logger.info("Closing database connection pool...");
      await closeDatabase();

      logger.info("Graceful shutdown completed successfully.");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Error during cleanup phase of shutdown");
      process.exit(1);
    }
  });

  // Force termination after a 10s grace timeout to prevent hang
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out, forcing exit.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
