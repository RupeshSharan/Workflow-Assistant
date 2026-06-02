import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";
import { closeDatabase, query } from "../db.js";
import { runSlaAndDueDateChecks } from "../worker.js";

vi.mock("../services/queue.js", () => ({
  enqueueDocumentIndexing: vi.fn(async () => undefined),
  enqueueWebhook: vi.fn(async () => undefined),
  documentQueue: { close: vi.fn(), add: vi.fn() },
  closeQueue: vi.fn(),
  initializeScheduler: vi.fn(async () => undefined)
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
  toPgVector: (embedding: number[]) => `[${embedding.join(",")}]`
}));

interface TestTenant {
  token: string;
  email: string;
  userId: string;
  orgId: string;
  workspaceId: string;
}

async function createTenant(label: string): Promise<TestTenant> {
  const email = `org-invites-${label.toLowerCase()}-${randomUUID()}@test.local`;
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

describe("organization invitations and admin controls", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTenant("OrgAdmin");
  });

  afterAll(async () => {
    if (tenant?.orgId) {
      await query("DELETE FROM organizations WHERE id = $1", [tenant.orgId]);
      await query("DELETE FROM users WHERE id = $1", [tenant.userId]);
    }
    await closeDatabase();
  });

  it("manages organization invitations and accepting flow", async () => {
    const inviteEmail = `invitee-${randomUUID()}@test.local`;

    // 1. Create invitation
    const inviteRes = await request(app)
      .post("/api/invitations")
      .set(tenantHeaders(tenant))
      .send({
        email: inviteEmail,
        role: "member"
      });

    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invitation).toBeDefined();
    expect(inviteRes.body.invitation.email).toBe(inviteEmail);
    expect(inviteRes.body.inviteUrl).toContain("token=");

    const token = inviteRes.body.inviteUrl.split("token=")[1];

    // 2. Public view invitation details
    const viewRes = await request(app).get(`/api/invitations/${token}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.invitation.email).toBe(inviteEmail);
    expect(viewRes.body.invitation.orgName).toBe("OrgAdmin Organization");

    // 3. Accept invitation (create account)
    const acceptRes = await request(app)
      .post(`/api/invitations/${token}/accept`)
      .send({
        name: "Invited Test User",
        password: "NewUserPassword123!"
      });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.token).toBeDefined();
    expect(acceptRes.body.user.email).toBe(inviteEmail);
    expect(acceptRes.body.workspaces[0].orgId).toBe(tenant.orgId);
    
    const newUserId = acceptRes.body.user.id;

    // 4. View members of organization
    const membersRes = await request(app)
      .get("/api/org/members")
      .set(tenantHeaders(tenant));

    expect(membersRes.status).toBe(200);
    const newMemberRow = membersRes.body.members.find((m: any) => m.id === newUserId);
    expect(newMemberRow).toBeDefined();
    expect(newMemberRow.role).toBe("member");

    // 5. Modify organization role
    const patchRes = await request(app)
      .patch(`/api/org/members/${newUserId}/role`)
      .set(tenantHeaders(tenant))
      .send({ role: "admin" });

    expect(patchRes.status).toBe(200);

    // Verify changed role
    const membersRes2 = await request(app)
      .get("/api/org/members")
      .set(tenantHeaders(tenant));
    const updatedMember = membersRes2.body.members.find((m: any) => m.id === newUserId);
    expect(updatedMember.role).toBe("admin");

    // 6. Delete member
    const deleteRes = await request(app)
      .delete(`/api/org/members/${newUserId}`)
      .set(tenantHeaders(tenant));

    expect(deleteRes.status).toBe(200);

    // Clean up created user database records
    await query("DELETE FROM users WHERE id = $1", [newUserId]);
  });

  it("triggers repeatable checks for overdue items and SLA breached tasks", async () => {
    // Get templates/stages
    const templates = await request(app)
      .get("/api/workflow-templates")
      .set(tenantHeaders(tenant));
    const workflow = templates.body.workflows[0]!;
    const stages = workflow.stages;
    const backlogStage = stages.find((s: any) => s.name === "Backlog");

    // 1. Create work item
    const createdItem = await request(app)
      .post("/api/work-items")
      .set(tenantHeaders(tenant))
      .send({
        title: "SLA Overdue test item",
        priority: "high",
        templateId: workflow.id
      });
    expect(createdItem.status).toBe(201);
    const itemId = createdItem.body.item.id;

    // 2. Set item as overdue and assign it to tenant owner
    await query(
      `UPDATE work_items 
          SET assignee_id = $2, 
              due_date = NOW() - INTERVAL '2 hours' 
        WHERE id = $1`,
      [itemId, tenant.userId]
    );

    // 3. Set Backlog stage to have a 1-hour SLA, and set item entry time to 3 hours ago
    await query(
      `UPDATE workflow_stages SET sla_hours = 1 WHERE id = $1`,
      [backlogStage.id]
    );
    await query(
      `UPDATE work_items SET created_at = NOW() - INTERVAL '3 hours' WHERE id = $1`,
      [itemId]
    );

    // 4. Run the worker SLA/due date check function directly
    await runSlaAndDueDateChecks();

    // 5. Query notifications to verify that both due-date and SLA warnings were generated
    const notificationsRes = await request(app)
      .get("/api/notifications")
      .set(tenantHeaders(tenant));

    expect(notificationsRes.status).toBe(200);
    const overdueNotification = notificationsRes.body.notifications.find(
      (n: any) => n.title === "Overdue Work Item"
    );
    const slaNotification = notificationsRes.body.notifications.find(
      (n: any) => n.title === "SLA Breached"
    );

    expect(overdueNotification).toBeDefined();
    expect(overdueNotification.body).toContain("was due on");
    expect(slaNotification).toBeDefined();
    expect(slaNotification.body).toContain("SLA limit of 1 hours");

    // Clean up created work items
    await query("DELETE FROM work_items WHERE id = $1", [itemId]);
  });
});
