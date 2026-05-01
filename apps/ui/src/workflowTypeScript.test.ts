import { describe, expect, test } from "bun:test";

import { formatWorkflowTypeScriptType, parseWorkflowTypeScriptType } from "./workflowTypeScript";

describe("workflow TypeScript type parsing", () => {
  test("parses primitives, arrays, tuples, and unions", () => {
    expect(parseWorkflowTypeScriptType("string")).toEqual({ type: "string" });
    expect(parseWorkflowTypeScriptType("number[]")).toEqual({ type: "array", items: { type: "number" } });
    expect(parseWorkflowTypeScriptType("[string, number]")).toEqual({
      type: "array",
      items: { type: "union", variants: [{ type: "string" }, { type: "number" }] },
      min_items: 2,
      max_items: 2,
    });
    expect(parseWorkflowTypeScriptType("string | null")).toEqual({
      type: "union",
      variants: [{ type: "string" }, { type: "null" }],
    });
  });

  test("parses object literals and interfaces with optional properties", () => {
    expect(
      parseWorkflowTypeScriptType(`
        interface FrameBatch {
          videoId: string;
          frames: Array<{ index: number; timestamp: number; path: string }>;
          sourceUrl?: YouTubeUrl;
        }
      `),
    ).toEqual({
      type: "object",
      properties: [
        { name: "videoId", value: { type: "string" }, required: true },
        {
          name: "frames",
          value: {
            type: "array",
            items: {
              type: "object",
              properties: [
                { name: "index", value: { type: "number" }, required: true },
                { name: "timestamp", value: { type: "number" }, required: true },
                { name: "path", value: { type: "string" }, required: true },
              ],
              additional_properties: false,
            },
          },
          required: true,
        },
        { name: "sourceUrl", value: { type: "string", semantic: "youtube_url" }, required: false },
      ],
      additional_properties: false,
    });
  });

  test("parses branded semantics and binary aliases", () => {
    expect(parseWorkflowTypeScriptType('string & WorkflowSemantic<"template_string">')).toEqual({
      type: "string",
      semantic: "template_string",
    });
    expect(parseWorkflowTypeScriptType("VideoFile")).toEqual({
      type: "binary",
      media_type: "video/*",
      semantic: "video_file",
    });
  });

  test("parses Record and string index signatures", () => {
    expect(parseWorkflowTypeScriptType("Record<string, number>")).toEqual({
      type: "object",
      properties: [],
      additional_properties: true,
      additional_property_value: { type: "number" },
    });
    expect(parseWorkflowTypeScriptType("{ id: string; [key: string]: string }")).toEqual({
      type: "object",
      properties: [{ name: "id", value: { type: "string" }, required: true }],
      additional_properties: true,
      additional_property_value: { type: "string" },
    });
  });

  test("formats workflow specs back to TypeScript", () => {
    expect(formatWorkflowTypeScriptType({ type: "string", semantic: "youtube_url" })).toBe("type WorkflowType = YouTubeUrl;\n");
  });

  test("rejects unsupported TypeScript constructs", () => {
    expect(() => parseWorkflowTypeScriptType("T extends string ? string : number")).toThrow("Conditional types");
    expect(() => parseWorkflowTypeScriptType("{ [K in string]: number }")).toThrow("Mapped types");
    expect(() => parseWorkflowTypeScriptType("() => string")).toThrow("Function types");
    expect(() => parseWorkflowTypeScriptType("class Model {}")).toThrow("Class types");
    expect(() => parseWorkflowTypeScriptType('type Status = "open" | "closed";')).toThrow("Literal types");
    expect(() => parseWorkflowTypeScriptType("type Node = { child?: Node };")).toThrow("Recursive type reference");
  });
});
