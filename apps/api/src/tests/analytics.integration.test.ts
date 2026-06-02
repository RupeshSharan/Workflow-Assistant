import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { closeDatabase, query } from "../db.js";

vi.mock("../services/queue.js", () => ({
  enqueueDocumentIndexing: vi.fn(async () => undefined),
  enqueueWebhook: vi.fn(async () => undefined),
  documentQueue: { close: vi.fn() },
  closeQueue: vi.fn()
}));

vi.mock("../services/storage.js", () => ({
  uploadFile: vi.fn(async (key) => `http://localhost:9000/workflow-documents/${key}`),
  getFile: vi.fn(async () => Buffer.from("mock text content")),
  bucketName: "workflow-documents",
  initializeStorage: vi.fn(async () => undefined)
}));

vi.mock("../services/ollama.js", () => ({
  embedTexts: vi.fn(async (texts: string[]) =>
    texts.map(() => Array<number>(768).fill(0))
  ),
  toPgVector: (embedding: number[]) => `[${embedding.join(",")}]`,
  chatCompletion: vi.fn(async () => ({
    content: "General suggestions",
    tokensIn: 10,
    tokensOut: 10
  })),
  structuredChat: vi.fn(async () => ({
    result: {
      suggestions: [
        {
          title: "Optimize Review Stage",
          suggestion: "Item stays too long in Review.",
          expectedImpact: "Reduce delays by 20%.",
          stageId: null
        }
      ]
    },
    tokensIn: 15,
    tokensOut: 25
  }))
}));

interface TestTenant {
  token: string;
  email: string;
  userId: string;
  orgId: string;
  workspaceId: string;
}

async function createTenant(label: string): Promise<TestTenant> {
  const email = `analytics-${label.toLowerCase()}-${randomUUID()}@test.local`;
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

describe("analytics dashboard integration", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTenant("Analytics");
  });

  afterAll(async () => {
    if (tenant?.orgId) {
      await query("DELETE FROM organizations WHERE id = $1", [tenant.orgId]);
      await query("DELETE FROM users WHERE id = $1", [tenant.userId]);
    }
    await closeDatabase();
  });

  it("calculates bottlenecks and stage times correctly", async () => {
    // 1. Get default templates and stages
    const templates = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(tenant));
    expect(templates.status).toBe(200);
    const workflow = templates.body.workflows[0]!;
    const stages = workflow.stages;
    const backlogStage = stages.find((s: any) => s.name === "Backlog");
    const inProgressStage = stages.find((s: any) => s.name === "In Progress");

    // 2. Create work item
    const createdItem = await request(app)
      .post("/api/work-items")
      .set(tenantHeaders(tenant))
      .send({
        title: "Test analytics item",
        priority: "high",
        templateId: workflow.id
      });
    expect(createdItem.status).toBe(201);
    const itemId = createdItem.body.item.id;

    // 3. Transition stage (creates transition history entries)
    const transition = await request(app)
      .post(`/api/work-items/${itemId}/transitions`)
      .set(tenantHeaders(tenant))
      .send({ toStageId: inProgressStage.id });
    expect(transition.status).toBe(200);

    // 4. Query bottlenecks API
    const res = await request(app)
      .get("/api/analytics/workflow-bottlenecks")
      .set(tenantHeaders(tenant));
    
    expect(res.status).toBe(200);
    expect(res.body.bottlenecks).toBeDefined();
    expect(res.body.bottlenecks.length).toBe(stages.length);
    const backlogData = res.body.bottlenecks.find((b: any) => b.stageName === "Backlog");
    expect(backlogData.itemCount).toBe(1);
  });

  it("retrieves user productivity and priority metrics", async () => {
    const res = await request(app)
      .get("/api/analytics/productivity")
      .set(tenantHeaders(tenant));

    expect(res.status).toBe(200);
    expect(res.body.completedItemsPerUser).toBeDefined();
    expect(res.body.cycleTimeStats).toBeDefined();
    expect(res.body.priorityBreakdown).toBeDefined();
    expect(res.body.completedItemsPerUser[0].userName).toBe("Analytics Owner");
  });

  it("recommends insights from LLM", async () => {
    const res = await request(app)
      .get("/api/analytics/adaptive-insights")
      .set(tenantHeaders(tenant));

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toBeDefined();
    expect(res.body.suggestions[0].title).toBe("Configure automatic assignment");
  });

  it("compiles and saves workspace report document note", async () => {
    const res = await request(app)
      .post("/api/analytics/report")
      .set(tenantHeaders(tenant));

    expect(res.status).toBe(201);
    expect(res.body.document).toBeDefined();
    expect(res.body.document.title).toContain("Workspace Performance Report");
    expect(res.body.document.status).toBe("uploaded");
  });
});
