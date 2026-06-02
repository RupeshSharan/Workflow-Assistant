import { test, expect } from "@playwright/test";

test("smoke test - registration, item creation, detail drawer interaction", async ({ page }) => {
  // 1. Go to homepage (should redirect to /login)
  await page.goto("/");
  await expect(page).toHaveURL(/.*\/login/);

  // 2. Fill registration details
  const randomEmail = `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}@test.local`;
  
  await page.locator('label:has-text("Your name") input').fill("E2E Test User");
  await page.locator('label:has-text("Organization name") input').fill("E2E Org");
  await page.locator('label:has-text("Workspace name") input').fill("E2E Workspace");
  await page.locator('label:has-text("Email") input').fill(randomEmail);
  await page.locator('label:has-text("Password") input').fill("E2ePassword123!");

  // 3. Submit form
  await page.locator('button[type="submit"]:has-text("Create platform space")').click();

  // 4. Verify we are on the dashboard
  await expect(page).toHaveURL(/.*\/dashboard/);
  await expect(page.locator("h3:has-text('Configurable delivery flow')")).toBeVisible();

  // 5. Add a work item
  const itemTitle = "Playwright Smoke Test Item";
  await page.locator('input[placeholder="Create a work item..."]').fill(itemTitle);
  await page.locator('button:has-text("Add")').click();

  // 6. Verify item appears on board
  const cardTitleBtn = page.locator(`.work-card button.card-title:has-text("${itemTitle}")`);
  await expect(cardTitleBtn).toBeVisible();

  // 7. Click card to open drawer
  await cardTitleBtn.click();

  // 8. Verify drawer is visible
  const drawer = page.locator('aside.item-drawer[role="dialog"]');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("h3")).toHaveText(itemTitle);

  // 9. Focus comment input inside drawer and press Escape key to close drawer
  await page.locator('input[placeholder="Add a comment"]').click();
  await page.keyboard.press("Escape");

  // 10. Verify drawer is closed
  await expect(drawer).not.toBeVisible();
});
