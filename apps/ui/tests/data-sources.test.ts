import { describe, expect, test } from "bun:test";

import { dataSourceDeleteBlockers } from "../src/data-sources/derivations";
import { collectDataSourceReferences } from "../src/data-sources/references";
import { parseImportedDataSourcesJson } from "../src/data-sources/types";

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
