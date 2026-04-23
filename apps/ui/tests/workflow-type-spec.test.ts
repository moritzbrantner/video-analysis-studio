import { describe, expect, test } from "bun:test";

import type { WorkflowTypeSpec } from "../src/api/client";
import {
  formatWorkflowTypeSpec,
  formatWorkflowTypeSpecJson,
  workflowTypeSignature,
  workflowTypesAssignable,
} from "../src/workflowTypeSpec";

describe("workflow type compatibility", () => {
  test("semantic strings widen to plain strings but not the reverse", () => {
    const plain: WorkflowTypeSpec = { type: "string" };
    const youtube: WorkflowTypeSpec = { type: "string", semantic: "youtube_url" };

    expect(workflowTypesAssignable(youtube, plain)).toBe(true);
    expect(workflowTypesAssignable(plain, youtube)).toBe(false);
  });

  test("array assignability checks bounds and item types", () => {
    const source: WorkflowTypeSpec = {
      type: "array",
      items: { type: "number" },
      min_items: 2,
      max_items: 4,
    };
    const target: WorkflowTypeSpec = {
      type: "array",
      items: { type: "number" },
      min_items: 1,
      max_items: 5,
    };
    const tooNarrow: WorkflowTypeSpec = {
      type: "array",
      items: { type: "number" },
      min_items: 1,
      max_items: 3,
    };

    expect(workflowTypesAssignable(source, target)).toBe(true);
    expect(workflowTypesAssignable(source, tooNarrow)).toBe(false);
  });

  test("object assignability supports width subtyping and closed targets", () => {
    const source: WorkflowTypeSpec = {
      type: "object",
      properties: [
        { name: "id", value: { type: "string" }, required: true },
        { name: "title", value: { type: "string" }, required: true },
      ],
      additional_properties: false,
    };
    const openTarget: WorkflowTypeSpec = {
      type: "object",
      properties: [{ name: "id", value: { type: "string" }, required: true }],
      additional_properties: true,
    };
    const closedTarget: WorkflowTypeSpec = {
      type: "object",
      properties: [{ name: "id", value: { type: "string" }, required: true }],
      additional_properties: false,
    };

    expect(workflowTypesAssignable(source, openTarget)).toBe(true);
    expect(workflowTypesAssignable(source, closedTarget)).toBe(false);
  });

  test("union targets accept compatible variants", () => {
    const source: WorkflowTypeSpec = { type: "string", semantic: "template_string" };
    const target: WorkflowTypeSpec = {
      type: "union",
      variants: [{ type: "number" }, { type: "string" }],
    };

    expect(workflowTypesAssignable(source, target)).toBe(true);
  });
});

describe("workflow type formatting and signatures", () => {
  test("formatting exposes structural labels", () => {
    expect(
      formatWorkflowTypeSpec({
        type: "array",
        items: { type: "string" },
        min_items: 1,
        max_items: 10,
      }),
    ).toBe("Array<String>[1..10]");
  });

  test("signatures are stable for structurally equivalent object shapes", () => {
    const left: WorkflowTypeSpec = {
      type: "object",
      properties: [
        { name: "b", value: { type: "number" }, required: false },
        { name: "a", value: { type: "string" }, required: true },
      ],
      additional_properties: false,
    };
    const right: WorkflowTypeSpec = {
      type: "object",
      properties: [
        { name: "a", value: { type: "string" }, required: true },
        { name: "b", value: { type: "number" }, required: false },
      ],
      additional_properties: false,
    };

    expect(workflowTypeSignature(left)).toBe(workflowTypeSignature(right));
  });

  test("exact formatting emits canonical pretty JSON", () => {
    expect(
      formatWorkflowTypeSpecJson({
        type: "object",
        properties: [
          { name: "b", value: { type: "number" }, required: false },
          { name: "a", value: { type: "string", semantic: "youtube_url" }, required: true },
        ],
        additional_properties: false,
      }),
    ).toBe(`{
  "type": "object",
  "properties": [
    {
      "name": "a",
      "value": {
        "type": "string",
        "semantic": "youtube_url"
      },
      "required": true
    },
    {
      "name": "b",
      "value": {
        "type": "number"
      },
      "required": false
    }
  ],
  "additional_properties": false
}`);
  });
});
