import { expect, test } from "@playwright/test";
import {
  addComponentFromLibrary,
  deselectWorkflowNodes,
  graphCounts,
  openWorkflowBuilder,
  savedVersionCount,
} from "./helpers";

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
});
