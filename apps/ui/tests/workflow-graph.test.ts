import { describe, expect, test } from "bun:test";

import { workflowGraphHasCycle, workflowGraphWouldCreateCycle } from "../src/workflowGraph";

describe("workflow graph cycle detection", () => {
  test("allows forward edges in an acyclic graph", () => {
    expect(
      workflowGraphWouldCreateCycle(
        [
          { id: "a-b", source: "a", target: "b" },
          { id: "b-c", source: "b", target: "c" },
        ],
        { source: "a", target: "c" },
      ),
    ).toBe(false);
  });

  test("rejects edges that close a cycle", () => {
    expect(
      workflowGraphWouldCreateCycle(
        [
          { id: "a-b", source: "a", target: "b" },
          { id: "b-c", source: "b", target: "c" },
        ],
        { source: "c", target: "a" },
      ),
    ).toBe(true);
  });

  test("supports reconnect validation by ignoring the edge being replaced", () => {
    const edges = [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" },
    ];

    expect(workflowGraphWouldCreateCycle(edges, { source: "c", target: "a" })).toBe(true);
    expect(workflowGraphWouldCreateCycle(edges, { source: "c", target: "a" }, { ignoreEdgeId: "a-b" })).toBe(false);
  });

  test("detects cycles in a stored graph", () => {
    expect(
      workflowGraphHasCycle([
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
      ]),
    ).toBe(true);
  });

  test("treats disconnected dags as acyclic", () => {
    expect(
      workflowGraphHasCycle([
        { source: "a", target: "b" },
        { source: "c", target: "d" },
      ]),
    ).toBe(false);
  });
});
