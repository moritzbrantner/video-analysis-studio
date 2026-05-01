import { expect, test } from "@playwright/test";
import {
  addComponentFromLibrary,
  deselectWorkflowNodes,
  graphCounts,
  openWorkflowBuilder,
  savedVersionCount,
} from "./workflow.e2e-support";
import { encodeWorkflowSharePayload, workflowShareUrl } from "../workflowShare";

test.describe("workflow builder interactions", () => {
  test("search, add, and delete component updates graph counts", async ({ page }) => {
    await openWorkflowBuilder(page);
    const before = await graphCounts(page);

    await addComponentFromLibrary(page, "Conditional Select");
    const afterAdd = await graphCounts(page);
    expect(afterAdd.components).toBe(before.components + 1);

    await page.getByTitle("Delete selected component").click();
    const afterDelete = await graphCounts(page);
    expect(afterDelete.components).toBe(before.components);
  });

  test("reset restores the active workflow graph", async ({ page }) => {
    await openWorkflowBuilder(page);
    const before = await graphCounts(page);

    await addComponentFromLibrary(page, "HTTP Client", "http client");
    const afterAdd = await graphCounts(page);
    expect(afterAdd.components).toBe(before.components + 1);

    await page.getByTitle("Reset workflow").click();
    const afterReset = await graphCounts(page);
    expect(afterReset.components).toBe(before.components);
    expect(afterReset.connections).toBe(before.connections);
  });

  test("rename workflow, create blank workflow, clone, and delete clone", async ({ page }) => {
    await openWorkflowBuilder(page);

    const workflowNameInput = page.getByPlaceholder("Workflow name");
    const renamedWorkflow = "Playwright Workflow";
    await workflowNameInput.fill(renamedWorkflow);
    await workflowNameInput.press("Enter");
    await expect(page.getByTitle(renamedWorkflow).first()).toBeVisible();

    await page.getByTitle("New blank workflow").click();
    await expect(workflowNameInput).toHaveValue("Untitled Workflow");
    const blankCounts = await graphCounts(page);
    expect(blankCounts.components).toBe(0);
    expect(blankCounts.connections).toBe(0);

    await page.getByTitle("Clone active workflow").click();
    await expect(workflowNameInput).toHaveValue("Untitled Workflow Copy");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTitle("Delete active workflow").click();
    await expect(workflowNameInput).not.toHaveValue("Untitled Workflow Copy");
  });

  test("saving workflow version increases saved version count", async ({ page }) => {
    await openWorkflowBuilder(page);
    const beforeSaved = await savedVersionCount(page);

    await addComponentFromLibrary(page, "Conditional Select");
    await page.getByRole("button", { name: "Save Version" }).first().click();
    await deselectWorkflowNodes(page);

    const afterSaved = await savedVersionCount(page);
    expect(afterSaved).toBe(beforeSaved + 1);
  });

  test("shared links import into another browser context", async ({ page, browser }) => {
    await openWorkflowBuilder(page);

    const workflowNameInput = page.getByPlaceholder("Workflow name");
    await workflowNameInput.fill("Shared Workflow Example");
    await workflowNameInput.press("Enter");
    await addComponentFromLibrary(page, "HTTP Client", "http client");
    const sharedCounts = await graphCounts(page);

    const workflowPayload = await page.evaluate(() => {
      const raw = window.localStorage.getItem("video-analysis.workflows.v1");
      if (!raw) {
        throw new Error("missing workflow library");
      }
      const library = JSON.parse(raw) as {
        activeWorkflowId: string;
        workflows: Array<Record<string, unknown>>;
      };
      const activeWorkflow = library.workflows.find((workflow) => workflow.id === library.activeWorkflowId);
      if (!activeWorkflow) {
        throw new Error("missing active workflow");
      }
      return {
        format: "video-analysis.workflow",
        version: 1,
        lastUpdated: String(activeWorkflow.updatedAt ?? new Date().toISOString()),
        workflowName: String(activeWorkflow.name ?? "Shared Workflow"),
        workflowKind: String(activeWorkflow.kind ?? "youtube-video"),
        workflowVersion: Number(activeWorkflow.version ?? 1),
        nodes: Array.isArray(activeWorkflow.nodes) ? activeWorkflow.nodes : [],
        edges: Array.isArray(activeWorkflow.edges) ? activeWorkflow.edges : [],
      };
    });
    const shareToken = await encodeWorkflowSharePayload(workflowPayload);
    const sharedLink = workflowShareUrl(new URL(page.url()).origin, shareToken);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto(sharedLink);
    await expect(recipientPage.getByPlaceholder("Workflow name")).toHaveValue("Shared Workflow Example");
    await expect(recipientPage).toHaveURL(/\/workflow\/[^/?#]+$/);
    expect(await graphCounts(recipientPage)).toEqual(sharedCounts);
    await recipientContext.close();
  });
});
