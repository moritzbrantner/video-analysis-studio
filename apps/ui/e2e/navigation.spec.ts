import { expect, test } from "@playwright/test";

test("can navigate between core pages and toggle the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();

  await page.locator('button[aria-label="Settings"][title="Settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.locator('button[aria-label="Workflow"][title="Workflow"]').click();
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();

  await page.locator('button[aria-label="Data Sources"][title="Data Sources"]').click();
  await expect(page).toHaveURL(/\/data-sources$/);
  await expect(page.getByRole("heading", { name: "Data Sources" })).toBeVisible();

  await page.getByLabel("Collapse sidebar").click();
  await expect(page.getByLabel("Expand sidebar")).toBeVisible();

  await page.getByLabel("Expand sidebar").click();
  await expect(page.getByLabel("Collapse sidebar")).toBeVisible();

  await page.locator('button[aria-label="Analysis"][title="Analysis"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
});
