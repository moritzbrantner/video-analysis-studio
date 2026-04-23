import { expect, type Page } from "@playwright/test";

const graphSummaryPattern = /(\d+)\s+components\s+\D+\s+(\d+)\s+connections/;
const savedVersionsPattern = /(\d+)\s+saved/;

export async function openWorkflowBuilder(page: Page) {
  await page.goto("/workflow");
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();
}

export async function graphCounts(page: Page): Promise<{ components: number; connections: number }> {
  const summary = page.locator("p").filter({ hasText: /\d+\s+components.*\d+\s+connections/ }).first();
  await expect(summary).toBeVisible();
  const text = (await summary.textContent()) ?? "";
  const match = text.match(graphSummaryPattern);
  expect(match, `Could not parse graph counts from: "${text}"`).not.toBeNull();
  return {
    components: Number(match?.[1] ?? "0"),
    connections: Number(match?.[2] ?? "0"),
  };
}

export async function savedVersionCount(page: Page): Promise<number> {
  const badge = page.locator("span").filter({ hasText: /\d+\s+saved/ }).first();
  await expect(badge).toBeVisible();
  const text = (await badge.textContent()) ?? "";
  const match = text.match(savedVersionsPattern);
  expect(match, `Could not parse saved version count from: "${text}"`).not.toBeNull();
  return Number(match?.[1] ?? "0");
}

export async function deselectWorkflowNodes(page: Page) {
  const pane = page.locator(".react-flow__pane").first();
  await pane.click({ position: { x: 16, y: 16 } });
}

export async function addComponentFromLibrary(page: Page, title: string, search = title) {
  await page.getByPlaceholder("Search components").fill(search);
  await page.getByTitle(`Add ${title}`).first().click();
  await expect(page.getByTitle("Delete selected component")).toBeVisible();
}
