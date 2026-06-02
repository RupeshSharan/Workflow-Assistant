import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { closeDatabase, query } from "../db.js";
import { redis } from "../services/redis.js";

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

describe("Performance, Pagination and Caching Integration Tests", () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTenant("PerfCache");
  });

  afterAll(async () => {
    await closeDatabase();
    await redis.quit();
  });

  it("paginates notifications list endpoint", async () => {
    // 1. Insert 5 dummy notifications
    for (let i = 1; i <= 5; i++) {
      await query(
        `INSERT INTO notifications (org_id, workspace_id, user_id, type, title, body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenant.orgId, tenant.workspaceId, tenant.userId, "test", `Notification ${i}`, `Body ${i}`]
      );
    }

    // 2. Fetch page 1 (limit 2, offset 0)
    const page1 = await request(app)
      .get("/api/notifications?limit=2&offset=0")
      .set(tenantHeaders(tenant));

    expect(page1.status).toBe(200);
    expect(page1.body.notifications).toHaveLength(2);
    expect(page1.body.pagination).toEqual({
      total: 5,
      limit: 2,
      offset: 0,
      hasMore: true
    });

    // 3. Fetch page 3 (limit 2, offset 4)
    const page3 = await request(app)
      .get("/api/notifications?limit=2&offset=4")
      .set(tenantHeaders(tenant));

    expect(page3.status).toBe(200);
    expect(page3.body.notifications).toHaveLength(1);
    expect(page3.body.pagination).toEqual({
      total: 5,
      limit: 2,
      offset: 4,
      hasMore: false
    });
  });

  it("caches workspaces list and invalidates on workspace creation", async () => {
    const cacheKey = `user:workspaces:${tenant.userId}`;
    await redis.del(cacheKey);

    // 1. First fetch - queries DB and caches
    const res1 = await request(app).get("/api/workspaces").set(tenantHeaders(tenant));
    expect(res1.status).toBe(200);

    const cachedVal = await redis.get(cacheKey);
    expect(cachedVal).not.toBeNull();
    const workspacesInCache = JSON.parse(cachedVal!);
    expect(workspacesInCache).toHaveLength(res1.body.workspaces.length);

    // 2. Create workspace - should invalidate cache
    const createRes = await request(app)
      .post("/api/workspaces")
      .set(tenantHeaders(tenant))
      .send({
        name: "Second Workspace",
        description: "An extra workspace for testing cache invalidation",
        visibility: "private"
      });
    expect(createRes.status).toBe(201);

    // 3. Assert cache is invalidated
    const cachedValAfterCreate = await redis.get(cacheKey);
    expect(cachedValAfterCreate).toBeNull();
  });
});
