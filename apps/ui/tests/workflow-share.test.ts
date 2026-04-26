import { describe, expect, test } from "bun:test";

import {
  decodeWorkflowSharePayload,
  encodeWorkflowSharePayload,
  workflowShareTokenFromUrl,
  workflowShareUrl,
} from "../src/workflowShare";

describe("workflow sharing helpers", () => {
  test("share payloads round-trip through encoded tokens", async () => {
    const payload = {
      format: "video-analysis.workflow",
      version: 1,
      workflowName: "Shared Workflow",
      workflowKind: "youtube-video",
      nodes: [{ id: "node-1", position: { x: 10, y: 20 }, data: { title: "Node" } }],
      edges: [],
    };

    const token = await encodeWorkflowSharePayload(payload);
    const decoded = await decodeWorkflowSharePayload<typeof payload>(token);

    expect(decoded).toEqual(payload);
  });

  test("share URLs expose the embedded token", () => {
    const url = workflowShareUrl("https://studio.example", "plain.abc123");

    expect(workflowShareTokenFromUrl(url)).toBe("plain.abc123");
  });
});
