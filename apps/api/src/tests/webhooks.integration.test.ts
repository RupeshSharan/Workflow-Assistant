import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { app } from "../app.js";
import { closeDatabase, query } from "../db.js";
import { redis } from "../services/redis.js";

// Mock queue to deliver webhooks synchronously in tests
vi.mock("../services/queue.js", () => ({
  enqueueWebhook: vi.fn(async (payload) => {
    const { orgId, workspaceId, event, payload: eventPayload } = payload;
    const subs = await query<{ id: string; url: string; secret_token: string | null }>(
      `SELECT id, url, secret_token
         FROM webhook_subscriptions
        WHERE org_id = $1
          AND workspace_id = $2
          AND is_active = TRUE
          AND $3 = ANY(events)`,
      [orgId, workspaceId, event]
    );

    for (const sub of subs.rows) {
      const timestamp = Date.now().toString();
      let signature = "";

      if (sub.secret_token) {
        const bodyStr = JSON.stringify(eventPayload);
        signature = crypto
          .createHmac("sha256", sub.secret_token)
          .update(`${timestamp}.${bodyStr}`)
          .digest("hex");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Timestamp": timestamp
      };

      if (signature) {
        headers["X-Webhook-Signature"] = signature;
      }

      await fetch(sub.url, {
        method: "POST",
        headers,
        body: JSON.stringify(eventPayload)
      });
    }
  }),
  webhookQueue: { close: vi.fn() },
  documentQueue: { close: vi.fn() },
  closeQueue: vi.fn()
}));

interface TestTenant {
  token: string;
  email: string;
  userId: string;
  orgId: string;
  workspaceId: string;
}

async function createTenant(label: string): Promise<TestTenant> {
  const email = `${label.toLowerCase()}-${randomUUID()}@test.local`;
  const registration = await request(app).post("/api/auth/register").send({
    name: `${label} Owner`,
    email,
    password: "IntegrationPass123!",
    organizationName: `${label} Organization`,
    workspaceName: `${label} Workspace`
  });

  expect(registration.status).toBe(201);
  return {
    token: registration.body.token as string,
    email,
    userId: registration.body.user.id as string,
    orgId: registration.body.workspaces[0].orgId as string,
    workspaceId: registration.body.activeWorkspaceId as string
  };
}

function tenantHeaders(tenant: TestTenant): Record<string, string> {
  return {
    authorization: `Bearer ${tenant.token}`,
    "x-workspace-id": tenant.workspaceId
  };
}

describe("Webhooks and Integrations Framework", () => {
  let tenant: TestTenant;
  let mockServer: Server;
  let receivedWebhook: {
    headers: any;
    body: any;
  } | null = null;
  const mockPort = 15555;
  const webhookSecret = "secret-webhook-signing-token";

  beforeAll(async () => {
    tenant = await createTenant("Webhooks");

    // Start mock webhook target server
    mockServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedWebhook = {
          headers: req.headers,
          body: JSON.parse(body)
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(mockPort, resolve);
    });
  });

  afterAll(async () => {
    await closeDatabase();
    await redis.quit();
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  it("manages webhook subscriptions and delivers events with hmac signatures", async () => {
    // 1. Create a webhook subscription
    const subRes = await request(app)
      .post("/api/webhooks")
      .set(tenantHeaders(tenant))
      .send({
        url: `http://localhost:${mockPort}/webhook`,
        events: ["work_item.created"],
        secretToken: webhookSecret
      });

    expect(subRes.status).toBe(201);
    const subId = subRes.body.id;
    expect(subId).toBeDefined();

    // Verify it is listed
    const listRes = await request(app).get("/api/webhooks").set(tenantHeaders(tenant));
    expect(listRes.status).toBe(200);
    expect(listRes.body.subscriptions).toHaveLength(1);
    expect(listRes.body.subscriptions[0].url).toBe(`http://localhost:${mockPort}/webhook`);

    // 2. Trigger work_item.created event by creating a work item
    // Setup Starter Template to make sure creating works
    const templatesRes = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(tenant));
    expect(templatesRes.status).toBe(200);
    const templateId = templatesRes.body.workflows[0]?.id;

    const createItemRes = await request(app)
      .post("/api/work-items")
      .set(tenantHeaders(tenant))
      .send({
        title: "Test Webhook Card",
        priority: "high",
        templateId
      });
    expect(createItemRes.status).toBe(201);

    // 3. Wait for the mock server to receive the webhook
    for (let i = 0; i < 10; i++) {
      if (receivedWebhook) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(receivedWebhook).not.toBeNull();
    expect(receivedWebhook!.body.item.title).toBe("Test Webhook Card");
    expect(receivedWebhook!.headers["x-webhook-event"]).toBe("work_item.created");

    // 4. Verify HMAC signature
    const signature = receivedWebhook!.headers["x-webhook-signature"];
    const timestamp = receivedWebhook!.headers["x-webhook-timestamp"];
    expect(signature).toBeDefined();
    expect(timestamp).toBeDefined();

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${JSON.stringify(receivedWebhook!.body)}`)
      .digest("hex");

    expect(signature).toBe(expectedSignature);

    // 5. Delete webhook subscription
    const delRes = await request(app)
      .delete(`/api/webhooks/${subId}`)
      .set(tenantHeaders(tenant));
    expect(delRes.status).toBe(200);

    // Verify list is empty
    const listAfterRes = await request(app).get("/api/webhooks").set(tenantHeaders(tenant));
    expect(listAfterRes.status).toBe(200);
    expect(listAfterRes.body.subscriptions).toHaveLength(0);
  });
});
