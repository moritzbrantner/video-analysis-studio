import { expect, test } from "@playwright/test";

test("can navigate between core pages and toggle the sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();

  await page.locator('button[aria-label="Settings"][title="Settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.locator('button[aria-label="Workflow"][title="Workflow"]').click();
  await expect(page).toHaveURL(/\/workflow\/[^/]+$/);
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
  await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
});

test("workflow links are shareable via workflow ids in the url", async ({ browser, page }) => {
  const workflowName = "Song Analysis Quick Match";
  await page.goto("/workflow");
  await page.getByRole("button", { name: `Edit ${workflowName}` }).click();
  await expect(page).toHaveURL(/\/workflow\/[^/]+$/);

  const sharedUrl = page.url();
  const selectedWorkflowId = new URL(sharedUrl).pathname.split("/").at(-1);

  expect(selectedWorkflowId).toBeTruthy();
  await expect(page.getByRole("heading", { name: workflowName })).toBeVisible();

  const sharedContext = await browser.newContext();
  const sharedPage = await sharedContext.newPage();
  await sharedPage.goto(sharedUrl);

  await expect(sharedPage).toHaveURL(/\/workflow\/[^/]+$/);
  expect(new URL(sharedPage.url()).pathname.split("/").at(-1)).toBe(selectedWorkflowId);
  await expect(sharedPage.getByRole("heading", { name: workflowName })).toBeVisible();

  await sharedContext.close();
});
