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
    texts.map((text) => {
      const embedding = Array<number>(768).fill(0);
      embedding[text.toLowerCase().includes("refund") ? 0 : 1] = 1;
      return embedding;
    })
  ),
  toPgVector: (embedding: number[]) => `[${embedding.join(",")}]`,
  chatCompletion: vi.fn(async () => ({
    content: "Refund requests require manager review before payment is released.",
    tokensIn: 24,
    tokensOut: 10
  })),
  structuredChat: vi.fn(async (messages: Array<{ content: string }>) => {
    if (messages.some((message) => message.content.includes("permitted platform tool"))) {
      return {
        result: {
          tool: "create_work_item",
          rationale: "Track the requested follow-up in the board.",
          intent: "Create a work item to track the refund follow-up.",
          confidence: 95,
          required_sources: ["Refund Policy Document"],
          suggested_action: "create_work_item",
          can_execute: true,
          arguments: {
            title: "Prepare refund follow-up report",
            description: "Created after confirmed assistant command.",
            priority: "high"
          }
        },
        tokensIn: 18,
        tokensOut: 22
      };
    }
    if (messages.some((message) => message.content.includes("You are a workspace-grounded AI assistant"))) {
      return {
        result: {
          answer: "Refund requests require manager review before payment is released.",
          confidence: 90,
          insufficientContext: false,
          sourcesUsed: ["Refund policy"]
        },
        tokensIn: 25,
        tokensOut: 20
      };
    }
    return {
      result: {
        name: "Editorial Review",
        description: "Review submitted content before publication.",
        category: "publishing",
        stages: [
          { name: "Submitted", color: "#64748b", isTerminal: false },
          { name: "Review", color: "#2563eb", isTerminal: false },
          { name: "Published", color: "#16a34a", isTerminal: true }
        ]
      },
      tokensIn: 20,
      tokensOut: 30
    };
  })
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

describe("tenant-aware workflow foundation", () => {
  let alpha: TestTenant;
  let beta: TestTenant;
  let alphaItemId: string;

  beforeAll(async () => {
    alpha = await createTenant("Alpha");
    beta = await createTenant("Beta");
  });

  afterAll(async () => {
    if (alpha?.orgId && beta?.orgId) {
      await query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
        [alpha.orgId, beta.orgId]
      ]);
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[alpha.userId, beta.userId]]);
    }
    await closeDatabase();
  });

  it("serves a healthy database-backed API", async () => {
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok", database: "connected" });
  });

  it("seeds a configurable workflow separately for each workspace", async () => {
    const alphaWorkflows = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(alpha));
    const betaWorkflows = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(beta));

    expect(alphaWorkflows.status).toBe(200);
    expect(betaWorkflows.status).toBe(200);
    expect(alphaWorkflows.body.workflows[0].name).toBe("Standard Work");
    expect(alphaWorkflows.body.workflows[0].stages.map((stage: { name: string }) => stage.name)).toEqual([
      "Backlog",
      "In Progress",
      "Done"
    ]);
    expect(alphaWorkflows.body.workflows[0].id).not.toBe(betaWorkflows.body.workflows[0].id);
  });

  it("creates and advances an item through its tenant workflow", async () => {
    const workflowResponse = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(alpha));
    const workflow = workflowResponse.body.workflows[0] as {
      id: string;
      stages: Array<{ id: string; name: string }>;
    };

    const created = await request(app)
      .post("/api/work-items")
      .set(tenantHeaders(alpha))
      .send({
        title: "Review community event request",
        priority: "high",
        templateId: workflow.id
      });

    expect(created.status).toBe(201);
    expect(created.body.item.stageName).toBe("Backlog");
    alphaItemId = created.body.item.id as string;

    const moved = await request(app)
      .post(`/api/work-items/${created.body.item.id}/transitions`)
      .set(tenantHeaders(alpha))
      .send({ toStageId: workflow.stages[1]!.id });
    expect(moved.status).toBe(200);
    expect(moved.body.item.stageName).toBe("In Progress");

    const betaItems = await request(app).get("/api/work-items").set(tenantHeaders(beta));
    expect(betaItems.status).toBe(200);
    expect(betaItems.body.items).toHaveLength(0);
  });

  it("rejects a valid user token scoped to another organization's workspace", async () => {
    const alphaAgainstBeta = await request(app)
      .get("/api/work-items")
      .set({
        authorization: `Bearer ${alpha.token}`,
        "x-workspace-id": beta.workspaceId
      });

    expect(alphaAgainstBeta.status).toBe(403);
    expect(alphaAgainstBeta.body.error).toContain("do not have access");
  });

  it("stores typed custom field values on work items within the workspace", async () => {
    const field = await request(app)
      .post("/api/custom-fields")
      .set(tenantHeaders(alpha))
      .send({
        name: "Request channel",
        fieldType: "select",
        isRequired: true,
        options: ["Portal", "Email", "Walk-in"]
      });
    expect(field.status).toBe(201);

    const updated = await request(app)
      .put(`/api/work-items/${alphaItemId}/custom-fields`)
      .set(tenantHeaders(alpha))
      .send({
        values: [{ customFieldId: field.body.field.id, value: "Portal" }]
      });
    expect(updated.status).toBe(200);
    expect(updated.body.fields[0]).toMatchObject({ name: "Request channel", value: "Portal" });

    const comment = await request(app)
      .post(`/api/work-items/${alphaItemId}/comments`)
      .set(tenantHeaders(alpha))
      .send({ content: "Validated against the request policy." });
    expect(comment.status).toBe(201);

    const discussion = await request(app)
      .get(`/api/work-items/${alphaItemId}/comments`)
      .set(tenantHeaders(alpha));
    expect(discussion.body.comments[0].content).toContain("request policy");

    const history = await request(app)
      .get(`/api/work-items/${alphaItemId}/history`)
      .set(tenantHeaders(alpha));
    expect(
      history.body.history.some((entry: { fieldName: string }) => entry.fieldName.startsWith("custom_field:"))
    ).toBe(true);

    const invalidOption = await request(app)
      .put(`/api/work-items/${alphaItemId}/custom-fields`)
      .set(tenantHeaders(alpha))
      .send({
        values: [{ customFieldId: field.body.field.id, value: "Unknown" }]
      });
    expect(invalidOption.status).toBe(400);
  });

  it("cannot apply another workspace's custom field to an item", async () => {
    const betaField = await request(app)
      .post("/api/custom-fields")
      .set(tenantHeaders(beta))
      .send({ name: "Private note", fieldType: "text" });
    expect(betaField.status).toBe(201);

    const crossWorkspaceValue = await request(app)
      .put(`/api/work-items/${alphaItemId}/custom-fields`)
      .set(tenantHeaders(alpha))
      .send({
        values: [{ customFieldId: betaField.body.field.id, value: "Should not attach" }]
      });
    expect(crossWorkspaceValue.status).toBe(400);
  });

  it("indexes document text and retrieves semantic matches only in its workspace", async () => {
    const created = await request(app)
      .post("/api/documents")
      .set(tenantHeaders(alpha))
      .send({
        title: "Refund policy",
        sourceType: "note",
        contentText: "Refund requests require manager review before payment is released."
      });
    expect(created.status).toBe(201);

    const indexed = await request(app)
      .post(`/api/documents/${created.body.document.id}/index`)
      .set(tenantHeaders(alpha));
    expect(indexed.status).toBe(200);
    expect(indexed.body.document.status).toBe("indexed");
    expect(indexed.body.chunks).toBe(1);

    const alphaSearch = await request(app)
      .post("/api/documents/search")
      .set(tenantHeaders(alpha))
      .send({ query: "How is a refund approved?", topK: 3 });
    expect(alphaSearch.status).toBe(200);
    expect(alphaSearch.body.matches[0].title).toBe("Refund policy");

    const betaSearch = await request(app)
      .post("/api/documents/search")
      .set(tenantHeaders(beta))
      .send({ query: "refund", topK: 3 });
    expect(betaSearch.status).toBe(200);
    expect(betaSearch.body.matches).toHaveLength(0);
  });

  it("grounds assistant answers and produces structured workflow drafts with logged runs", async () => {
    const chat = await request(app)
      .post("/api/ai/chat")
      .set(tenantHeaders(alpha))
      .send({ question: "How are refund requests approved?", topK: 2 });
    expect(chat.status).toBe(200);
    expect(chat.body.answer).toContain("manager review");
    expect(chat.body.sources[0].title).toBe("Refund policy");

    const draft = await request(app)
      .post("/api/ai/workflow-draft")
      .set(tenantHeaders(alpha))
      .send({ prompt: "Create an editorial approval workflow before publishing." });
    expect(draft.status).toBe(200);
    expect(draft.body.draft.name).toBe("Editorial Review");
    expect(draft.body.draft.stages).toHaveLength(3);

    const runCount = await query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
         FROM ai_runs
        WHERE org_id = $1 AND workspace_id = $2 AND success = TRUE`,
      [alpha.orgId, alpha.workspaceId]
    );
    expect(runCount.rows[0]!.count).toBeGreaterThanOrEqual(2);
  });

  it("keeps AI command preview non-mutating and executes a confirmed audited action", async () => {
    const before = await request(app).get("/api/work-items").set(tenantHeaders(alpha));

    const preview = await request(app)
      .post("/api/ai/command/preview")
      .set(tenantHeaders(alpha))
      .send({ command: "Create a task to prepare a refund follow-up report." });
    expect(preview.status).toBe(200);
    expect(preview.body.action.tool).toBe("create_work_item");
    expect(preview.body.requiresConfirmation).toBe(true);

    const afterPreview = await request(app).get("/api/work-items").set(tenantHeaders(alpha));
    expect(afterPreview.body.items).toHaveLength(before.body.items.length);

    const stolenPreview = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(beta))
      .send({ confirmed: true, previewRunId: preview.body.runId });
    expect(stolenPreview.status).toBe(404);

    const unconfirmed = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(alpha))
      .send({ confirmed: false, previewRunId: preview.body.runId });
    expect(unconfirmed.status).toBe(400);

    const rule = await request(app)
      .post("/api/automation/rules")
      .set(tenantHeaders(alpha))
      .send({
        name: "Notify on high-priority creation",
        triggerType: "work_item.created",
        condition: { priority: "high" },
        action: {
          type: "notify_creator",
          title: "High priority item created",
          body: "Review {title} today."
        }
      });
    expect(rule.status).toBe(201);

    const executed = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(alpha))
      .send({ confirmed: true, previewRunId: preview.body.runId });
    expect(executed.status).toBe(200);
    expect(executed.body.result.tool).toBe("create_work_item");

    const repeatedExecution = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(alpha))
      .send({ confirmed: true, previewRunId: preview.body.runId });
    expect(repeatedExecution.status).toBe(409);

    const audit = await query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
         FROM audit_logs
        WHERE org_id = $1 AND action = 'ai.command.executed'`,
      [alpha.orgId]
    );
    expect(audit.rows[0]!.count).toBeGreaterThanOrEqual(1);

    const notifications = await request(app).get("/api/notifications").set(tenantHeaders(alpha));
    expect(notifications.status).toBe(200);
    expect(notifications.body.notifications[0].body).toContain("Prepare refund follow-up report");

    const runs = await request(app).get("/api/automation/runs").set(tenantHeaders(alpha));
    expect(runs.status).toBe(200);
    expect(runs.body.runs[0]).toMatchObject({
      ruleName: "Notify on high-priority creation",
      status: "succeeded"
    });
  });

  it("lets an owner provision another workspace with its own starter workflow", async () => {
    const created = await request(app)
      .post("/api/workspaces")
      .set(tenantHeaders(alpha))
      .send({ name: "Alpha Projects", visibility: "private" });

    expect(created.status).toBe(201);
    const projectHeaders = {
      authorization: `Bearer ${alpha.token}`,
      "x-workspace-id": created.body.id as string
    };
    const workflows = await request(app).get("/api/workflow-templates").set(projectHeaders);
    expect(workflows.status).toBe(200);
    expect(workflows.body.workflows[0].name).toBe("Standard Work");
    expect(workflows.body.workflows[0].id).not.toBeUndefined();
  });

  it("allows cross-workspace access only after an explicit member grant", async () => {
    const granted = await request(app)
      .post(`/api/workspaces/${alpha.workspaceId}/members`)
      .set(tenantHeaders(alpha))
      .send({ email: beta.email, role: "member" });
    expect(granted.status).toBe(201);
    expect(granted.body.member.role).toBe("member");

    const betaInAlpha = await request(app).get("/api/work-items").set({
      authorization: `Bearer ${beta.token}`,
      "x-workspace-id": alpha.workspaceId
    });
    expect(betaInAlpha.status).toBe(200);
    expect(
      betaInAlpha.body.items.some((item: { title: string }) => item.title === "Review community event request")
    ).toBe(true);
  });

  it("does not allow the owner role to be overwritten through membership assignment", async () => {
    const attemptedDemotion = await request(app)
      .post(`/api/workspaces/${alpha.workspaceId}/members`)
      .set(tenantHeaders(alpha))
      .send({ email: alpha.email, role: "member" });
    expect(attemptedDemotion.status).toBe(403);
    expect(attemptedDemotion.body.error).toContain("Owner membership");
  });

  it("handles token refresh and logout successfully", async () => {
    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set(tenantHeaders(alpha));
    expect(refresh.status).toBe(200);
    expect(refresh.body.token).toBeDefined();

    const logout = await request(app)
      .post("/api/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body.success).toBe(true);
  });

  it("allows uploading binary files and enqueues indexing", async () => {
    const fileContent = Buffer.from("Test plain text file ingestion.");
    const uploadRes = await request(app)
      .post("/api/documents/upload")
      .set(tenantHeaders(alpha))
      .attach("file", fileContent, "knowledge.txt")
      .field("title", "Ingested Knowledge");

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.document.title).toBe("Ingested Knowledge");
    expect(uploadRes.body.document.sourceType).toBe("file");
    expect(uploadRes.body.document.status).toBe("uploaded");
  });

  it("executes fuzzy AI actions: update_work_item_status and assign_work_item", async () => {
    // 1. Setup a preview run in DB manually to execute against it
    const previewRunId = randomUUID();
    const actionPlan = {
      tool: "update_work_item_status",
      rationale: "Fuzzy matching transition test",
      intent: "Fuzzy matching transition test intent",
      confidence: 90,
      required_sources: [],
      suggested_action: "update_work_item_status",
      can_execute: true,
      arguments: {
        itemTitle: "community event",
        stageName: "In Progress"
      }
    };

    await query(
      `INSERT INTO ai_runs (id, org_id, workspace_id, user_id, model_name, task_type, input_json, output_json, success)
       VALUES ($1, $2, $3, $4, 'llama3.1:8b', 'command_preview', '{}'::jsonb, $5::jsonb, TRUE)`,
      [previewRunId, alpha.orgId, alpha.workspaceId, alpha.userId, JSON.stringify(actionPlan)]
    );

    const executeRes = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(alpha))
      .send({ confirmed: true, previewRunId });

    expect(executeRes.status).toBe(200);
    expect(executeRes.body.result.tool).toBe("update_work_item_status");

    // 2. Setup assignee preview run
    const previewAssignId = randomUUID();
    const assignPlan = {
      tool: "assign_work_item",
      rationale: "Fuzzy matching assign test",
      intent: "Fuzzy matching assign test intent",
      confidence: 90,
      required_sources: [],
      suggested_action: "assign_work_item",
      can_execute: true,
      arguments: {
        itemTitle: "community event",
        assigneeName: "Alpha Owner"
      }
    };

    await query(
      `INSERT INTO ai_runs (id, org_id, workspace_id, user_id, model_name, task_type, input_json, output_json, success)
       VALUES ($1, $2, $3, $4, 'llama3.1:8b', 'command_preview', '{}'::jsonb, $5::jsonb, TRUE)`,
      [previewAssignId, alpha.orgId, alpha.workspaceId, alpha.userId, JSON.stringify(assignPlan)]
    );

    const assignRes = await request(app)
      .post("/api/ai/command/execute")
      .set(tenantHeaders(alpha))
      .send({ confirmed: true, previewRunId: previewAssignId });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.result.tool).toBe("assign_work_item");
  });
});
