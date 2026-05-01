import { describe, expect, test } from "bun:test";

import { dataSourceDeleteBlockers } from "./derivations";
import { collectDataSourceReferences } from "./references";
import {
  defaultDataSourcePopulationMode,
  parseImportedDataSourcesJson,
  dataSourcePopulationOptions,
} from "./types";
import {
  createTypeDefinitionFromSource,
  parseWorkflowTypeSourceWithDefinitions,
} from "../type-library/page";
import { workflowTypesAssignable } from "../workflowTypeSpec";
import { parseWorkflowTypeScriptType } from "../workflowTypeScript";

describe("data source import parsing", () => {
  test("converts legacy schema payloads into workflow type specs", () => {
    const imported = parseImportedDataSourcesJson(
      JSON.stringify({
        dataSources: [
          {
            id: "song_catalog",
            name: "Song Catalog",
            format: "sqlite",
            type: { type: "port", portType: "song_catalog" },
            location: "studio-data/catalog.sqlite",
            description: "catalog",
            tags: ["songs"],
            body: "",
          },
        ],
      }),
    );

    expect(imported).toEqual([
      {
        id: "song_catalog",
        name: "Song Catalog",
        kind: "sqlite",
        type: {
          type: "object",
          properties: [],
          additional_properties: true,
          semantic: "song_catalog",
        },
        location: "studio-data/catalog.sqlite",
        description: "catalog",
        tags: ["songs"],
        body: "",
        origin: { mode: "root" },
      },
    ]);
  });
});

describe("data source references", () => {
  test("collects workflow references by source id", () => {
    const references = collectDataSourceReferences({
      workflows: [
        {
          id: "workflow-1",
          name: "Workflow One",
          nodes: [
            {
              id: "node-1",
              data: { title: "Primary Source", dataSourceNode: true, dataSourceId: "catalog" },
            },
          ],
        },
      ],
    });

    expect(references).toEqual([
      {
        dataSourceId: "catalog",
        workflowId: "workflow-1",
        workflowName: "Workflow One",
        nodeId: "node-1",
        nodeTitle: "Primary Source",
      },
    ]);
  });

  test("delete blockers include children and workflow references", () => {
    const record = {
      id: "catalog",
      name: "Catalog",
      kind: "json",
      type: { type: "any" } as const,
      location: "",
      description: "",
      tags: [],
      body: "",
      origin: { mode: "root" } as const,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    const blockers = dataSourceDeleteBlockers(
      record,
      [
        record,
        {
          ...record,
          id: "catalog-view",
          origin: { mode: "derived_view", parent_id: "catalog", derivation_kind: "alias" as const },
        },
      ],
      [
        {
          dataSourceId: "catalog",
          workflowId: "workflow-1",
          workflowName: "Workflow One",
          nodeId: "node-1",
          nodeTitle: "Primary Source",
        },
      ],
    );

    expect(blockers).toEqual({ childCount: 1, referenceCount: 1 });
  });
});

describe("data source creation helpers", () => {
  test("json sources default to inline population with fallback options", () => {
    expect(defaultDataSourcePopulationMode("json")).toBe("inline");
    expect(dataSourcePopulationOptions("json").map((option) => option.value)).toEqual([
      "inline",
      "location",
      "metadata",
    ]);
  });

  test("sqlite sources require an external location or deferred setup", () => {
    expect(defaultDataSourcePopulationMode("sqlite")).toBe("location");
    expect(dataSourcePopulationOptions("sqlite").map((option) => option.value)).toEqual([
      "location",
      "metadata",
    ]);
  });

  test("TypeScript type input produces workflow type specs for source contracts", () => {
    expect(parseWorkflowTypeScriptType("{ id: string; score?: number }")).toEqual({
      type: "object",
      properties: [
        { name: "id", value: { type: "string" }, required: true },
        { name: "score", value: { type: "number" }, required: false },
      ],
      additional_properties: false,
    });
  });

  test("invalid TypeScript type input reports useful parser errors", () => {
    expect(() => parseWorkflowTypeScriptType("() => string")).toThrow("Function types");
  });

  test("derived source compatibility uses compiled TypeScript contracts", () => {
    const parent = parseWorkflowTypeScriptType("Record<string, number>");
    const derived = parseWorkflowTypeScriptType("{ score: number; [key: string]: number }");

    expect(workflowTypesAssignable(parent, derived)).toBe(true);
  });

  test("custom source contracts can reuse saved type definitions", () => {
    const catalogItem = createTypeDefinitionFromSource([], "CatalogItem", "{ id: string; score: number }");

    expect(parseWorkflowTypeSourceWithDefinitions("CatalogItem[]", [catalogItem])).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: [
          { name: "id", value: { type: "string" }, required: true },
          { name: "score", value: { type: "number" }, required: true },
        ],
        additional_properties: false,
      },
    });
  });
});
