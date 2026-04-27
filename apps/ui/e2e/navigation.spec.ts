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

  await page.locator('button[aria-label="Components"][title="Components"]').click();
  await expect(page).toHaveURL(/\/components$/);
  await expect(page.getByRole("heading", { name: "Components" })).toBeVisible();

  await page.locator('button[aria-label="Data Sources"][title="Data Sources"]').click();
  await expect(page).toHaveURL(/\/data-sources$/);
  await expect(page.getByRole("heading", { name: "Data Sources", level: 1 })).toBeVisible();

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

test("saved components can be opened for modification and testing", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "video-analysis.workflowBlocks.v1",
      JSON.stringify([
        {
          id: "component-1",
          name: "Transcript Review Block",
          kind: "youtube-video",
          createdAt: "2026-04-27T10:00:00.000Z",
          category: "Pipeline",
          tags: ["review", "transcript"],
          nodes: [
            {
              id: "report-loader",
              position: { x: 0, y: 0 },
              data: {
                title: "Report Loader",
                packageName: "playwright.fixture",
                description: "Loads a report for preview.",
                category: "Pipeline",
                tone: "sky",
                inputs: [{ id: "report", label: "report", type: "json_report" }],
                outputs: [{ id: "dashboard", label: "dashboard", type: "dashboard_view" }],
              },
            },
          ],
          edges: [],
        },
      ]),
    );
  });

  await page.goto("/components");
  await expect(page.getByRole("heading", { name: "Components" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transcript Review Block" })).toBeVisible();

  await page.getByRole("button", { name: "Modify" }).click();
  await expect(page).toHaveURL(/\/workflow\/[^/]+$/);
  await expect(page.getByRole("button", { name: "Update Component" })).toBeVisible();

  await page.goto("/components");
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "New Run" })).toBeVisible();
});
