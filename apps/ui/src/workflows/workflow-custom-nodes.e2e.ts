import { expect, test, type Locator, type Page } from "@playwright/test";
import { addComponentFromLibrary, graphCounts, openWorkflowBuilder } from "./workflow.e2e-support";

const savedComponentsStorageKey = "video-analysis.workflowBlocks.v1";
const savedWorkflowsStorageKey = "video-analysis.workflows.v1";

test.describe("workflow custom nodes", () => {
  test("primitive nodes render metadata, ports, and minimized state", async ({ page }) => {
    await openWorkflowBuilder(page);
    await page.getByTitle("New blank workflow").click();
    await expect.poll(() => graphCounts(page)).toEqual({ components: 0, connections: 0 });

    await addComponentFromLibrary(page, "HTTP Client", "http client");

    const node = workflowNode(page, "HTTP Client");
    await expect(node).toBeVisible();
    await expect(node).toContainText("fetch");
    await expect(node).toContainText("Executes a typed HTTP request");
    await expect(node.getByText("Inputs")).toBeVisible();
    await expect(node.getByText("Outputs")).toBeVisible();
    await expect(port(node, "in", "HTTP request")).toBeVisible();
    await expect(port(node, "out", "HTTP response")).toBeVisible();
    await expect(port(node, "out", "response body")).toBeVisible();
    await expect(page.getByRole("heading", { name: "HTTP Client" })).toBeVisible();

    await page.getByTitle("Collapse details").click();
    await expect(page.getByLabel("Expand details")).toBeVisible();

    await node.getByTitle("Minimize component").dispatchEvent("click");
    await expect(node.locator('[data-testid="workflow-minimized-ports"]')).toBeVisible();
    await expect(node).toContainText("1 in");
    await expect(node).toContainText("2 out");
    await expect(node).not.toContainText("Executes a typed HTTP request");

    await node.getByTitle("Expand component").dispatchEvent("click");
    await expect(port(node, "in", "HTTP request")).toBeVisible();
    await expect(port(node, "out", "response body")).toBeVisible();

    await expect.poll(async () => {
      const workflow = await activeWorkflow(page);
      return workflow.nodes.some((candidate) => candidate.data.title === "HTTP Client");
    }).toBe(true);
  });

  test("saved reusable components instantiate custom nodes and persist after reload", async ({ page }) => {
    await seedSavedComponents(page);
    await openWorkflowBuilder(page);
    await page.getByTitle("New blank workflow").click();
    await expect.poll(() => graphCounts(page)).toEqual({ components: 0, connections: 0 });

    await page.getByPlaceholder("Search components").fill("request starter");
    await page.getByTitle("Add Request Starter Block").first().click();

    await expect.poll(() => graphCounts(page)).toEqual({ components: 2, connections: 1 });
    await expect(workflowNode(page, "Block String Generator")).toBeVisible();
    await expect(workflowNode(page, "Block Request Builder")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Selection" })).toBeVisible();
    await expect(page.getByText("2 components selected")).toBeVisible();

    await expect.poll(async () => {
      const workflow = await activeWorkflow(page);
      return {
        nodes: workflow.nodes.map((node) => node.data.title).sort(),
        edgeCount: workflow.edges.length,
      };
    }).toEqual({
      nodes: ["Block Request Builder", "Block String Generator"],
      edgeCount: 1,
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();
    await expect(graphCounts(page)).resolves.toEqual({ components: 2, connections: 1 });
    await expect(workflowNode(page, "Block String Generator")).toBeVisible();
    await expect(workflowNode(page, "Block Request Builder")).toBeVisible();
  });
});

function workflowNode(page: Page, title: string): Locator {
  return page.locator(`[data-testid="workflow-node"][data-node-title="${title}"]`).first();
}

function port(node: Locator, direction: "in" | "out", label: string): Locator {
  return node.locator(
    `[data-testid="workflow-port"][data-port-direction="${direction}"][data-port-label="${label}"]`,
  );
}

async function activeWorkflow(page: Page): Promise<StoredWorkflow> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      throw new Error("Missing workflow library");
    }
    const library = JSON.parse(raw) as StoredWorkflowLibrary;
    const workflow = library.workflows.find((candidate) => candidate.id === library.activeWorkflowId);
    if (!workflow) {
      throw new Error("Missing active workflow");
    }
    return workflow;
  }, savedWorkflowsStorageKey);
}

async function seedSavedComponents(page: Page) {
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: "request-starter-block",
            name: "Request Starter Block",
            kind: "youtube-video",
            createdAt: "2026-05-02T00:00:00.000Z",
            category: "API",
            tags: ["playwright", "http"],
            nodes: [
              {
                id: "string-generator",
                position: { x: 0, y: 0 },
                data: {
                  title: "Block String Generator",
                  packageName: "Generator",
                  description: "Emits a generated URL string for the request builder in custom node tests.",
                  category: "Generator",
                  tone: "cyan",
                  inputs: [],
                  outputs: [
                    {
                      id: "value",
                      label: "string",
                      type: "string_value",
                      valueType: { type: "string" },
                    },
                  ],
                  tags: ["generator", "string"],
                },
              },
              {
                id: "request-builder",
                position: { x: 360, y: 0 },
                data: {
                  title: "Block Request Builder",
                  packageName: "fetch",
                  description: "Combines the generated URL with request metadata for custom component tests.",
                  category: "API",
                  tone: "rose",
                  inputs: [
                    {
                      id: "url",
                      label: "URL",
                      type: "string_value",
                      valueType: { type: "string" },
                    },
                    {
                      id: "method",
                      label: "method",
                      type: "string_value",
                      optional: true,
                      valueType: { type: "string" },
                    },
                  ],
                  outputs: [
                    {
                      id: "request",
                      label: "HTTP request",
                      type: "http_request",
                      valueType: { type: "object", properties: [] },
                    },
                  ],
                  tags: ["http", "request"],
                },
              },
            ],
            edges: [
              {
                source: "string-generator",
                sourceHandle: "out|value|string_value",
                target: "request-builder",
                targetHandle: "in|url|string_value",
              },
            ],
          },
        ]),
      );
    },
    { key: savedComponentsStorageKey },
  );
}

interface StoredWorkflowLibrary {
  activeWorkflowId: string;
  workflows: StoredWorkflow[];
}

interface StoredWorkflow {
  id: string;
  nodes: Array<{ data: { title: string } }>;
  edges: unknown[];
}
