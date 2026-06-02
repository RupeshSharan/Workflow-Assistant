import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler, notFound } from "./lib/http-error.js";
import { authRouter } from "./routes/auth.js";
import { aiRouter } from "./routes/ai.js";
import { automationRouter } from "./routes/automations.js";
import { customFieldRouter } from "./routes/custom-fields.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { documentRouter } from "./routes/documents.js";
import { healthRouter } from "./routes/health.js";
import { notificationRouter } from "./routes/notifications.js";
import { workItemTypeRouter } from "./routes/work-item-types.js";
import { workItemFieldRouter } from "./routes/work-item-fields.js";
import { workItemRouter } from "./routes/work-items.js";
import { workflowRouter } from "./routes/workflows.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { analyticsRouter } from "./routes/analytics.js";
import { orgRouter } from "./routes/org.js";
import { invitationRouter } from "./routes/invitations.js";
import { csrfProtection } from "./middleware/csrf.js";
import { webhookRouter } from "./routes/webhooks.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-workspace-id"]
  })
);
app.use(csrfProtection);
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Max 15 attempts
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many login/registration attempts, please try again after 15 minutes"
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/accept-invitation", authLimiter);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/ai", aiRouter);
app.use("/api/automation", automationRouter);
app.use("/api/workspaces", workspaceRouter);
app.use("/api/workflow-templates", workflowRouter);
app.use("/api/work-item-types", workItemTypeRouter);
app.use("/api/work-items", workItemFieldRouter);
app.use("/api/work-items", workItemRouter);
app.use("/api/custom-fields", customFieldRouter);
app.use("/api/documents", documentRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/org", orgRouter);
app.use("/api/invitations", invitationRouter);
app.use("/api/webhooks", webhookRouter);

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const openapiPath = fileURLToPath(new URL("./openapi.json", import.meta.url));
const openapiContent = JSON.parse(fs.readFileSync(openapiPath, "utf8"));

app.get("/api/docs/swagger.json", (req, res) => {
  res.json(openapiContent);
});

app.get("/api/docs", (req, res) => {
  res.setHeader("content-type", "text/html");
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>API Docs - AI Workflow Platform</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/docs/swagger.json',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout'
      });
    };
  </script>
</body>
</html>
  `);
});

app.use(notFound);
app.use(errorHandler);
