import { type WorkflowTypeSpec } from "../api/client";
import { fileDateStamp, isRecord } from "../shared/utils";
import { categoryForSavedWorkflowBlock, tagsForSavedWorkflowBlock } from "./componentCatalog";
import { normalizeWorkflowTags, workflowComponentCategory } from "./componentMetadata";
import { savedWorkflowBlocksJsonFormat, savedWorkflowBlocksStorageKey } from "./constants";
import { isSavedWorkflowBlock } from "./guards";
import { createWorkflowBlockId } from "./ids";
import { cloneWorkflowNodeData } from "./nodeData";
import { handleId, port } from "./ports";
import type { SavedWorkflowBlock } from "./types";
import { savedWorkflowBlockHasValidGraph } from "./workflowLibrary";

export function loadSavedWorkflowBlocks(): SavedWorkflowBlock[] {
  if (typeof window === "undefined") {
    return defaultSavedWorkflowBlocks();
  }
  try {
    const raw = window.localStorage.getItem(savedWorkflowBlocksStorageKey);
    if (!raw) {
      return defaultSavedWorkflowBlocks();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return defaultSavedWorkflowBlocks();
    }
    const blocks = parsed.filter(isSavedWorkflowBlock).map(normalizeSavedWorkflowBlock).filter(savedWorkflowBlockHasValidGraph);
    return withDevSavedWorkflowBlockSeeds(blocks);
  } catch {
    return defaultSavedWorkflowBlocks();
  }
}

function defaultSavedWorkflowBlocks(): SavedWorkflowBlock[] {
  return withDevSavedWorkflowBlockSeeds([]);
}

function withDevSavedWorkflowBlockSeeds(blocks: SavedWorkflowBlock[]): SavedWorkflowBlock[] {
  if (!devFixturesEnabled()) {
    return blocks;
  }
  const existingIds = new Set(blocks.map((block) => block.id));
  const existingNames = new Set(blocks.map((block) => block.name));
  const missingSeeds = devSavedWorkflowBlockSeeds()
    .map(normalizeSavedWorkflowBlock)
    .filter(savedWorkflowBlockHasValidGraph)
    .filter((block) => !existingIds.has(block.id) && !existingNames.has(block.name));
  return missingSeeds.concat(blocks);
}

function devFixturesEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DISABLE_DEV_SEEDS !== "1";
}

function devSavedWorkflowBlockSeeds(): SavedWorkflowBlock[] {
  const createdAt = "2026-05-02T00:00:00.000Z";
  const clipCandidateType: WorkflowTypeSpec = {
    type: "object",
    properties: [
      { name: "clipId", value: { type: "string" }, required: true },
      { name: "startSeconds", value: { type: "number" }, required: true },
      { name: "endSeconds", value: { type: "number" }, required: true },
      { name: "transcript", value: { type: "string" }, required: false },
      { name: "confidence", value: { type: "number" }, required: true },
    ],
    additional_properties: false,
  };
  const reviewedClipType: WorkflowTypeSpec = {
    type: "object",
    properties: [
      { name: "clip", value: clipCandidateType, required: true },
      { name: "reviewer", value: { type: "string" }, required: true },
      { name: "accepted", value: { type: "boolean" }, required: true },
      { name: "notes", value: { type: "array", items: { type: "string" } }, required: false },
    ],
    additional_properties: false,
  };
  const httpExperimentRequestType: WorkflowTypeSpec = {
    type: "object",
    properties: [
      { name: "url", value: { type: "string" }, required: true },
      { name: "method", value: { type: "string" }, required: true },
      {
        name: "headers",
        value: {
          type: "array",
          items: {
            type: "object",
            properties: [
              { name: "name", value: { type: "string" }, required: true },
              { name: "value", value: { type: "string" }, required: true },
            ],
            additional_properties: false,
          },
        },
        required: false,
      },
      { name: "body", value: { type: "string" }, required: false },
    ],
    additional_properties: false,
  };

  const clipFixtureOutput = port("clip", "clip candidate", "object_value", { valueType: clipCandidateType });
  const clipReviewInput = port("clip", "clip candidate", "object_value", { valueType: clipCandidateType });
  const clipReviewOutput = port("review", "reviewed clip", "object_value", { valueType: reviewedClipType });
  const endpointOutput = port("url", "endpoint URL", "string_value");
  const requestUrlInput = port("url", "URL", "string_value");
  const requestOutput = port("request", "experiment request", "http_request", { valueType: httpExperimentRequestType });
  const clientInput = port("request", "HTTP request", "http_request", { valueType: httpExperimentRequestType });
  const clientOutput = port("body", "response body", "data_value");

  return [
    {
      id: "dev-clip-review-block",
      name: "Dev Clip Review Block",
      kind: "youtube-video",
      createdAt,
      category: "Pipeline",
      tags: ["dev", "custom-type", "review"],
      nodes: [
        {
          id: "dev-clip-fixture",
          position: { x: 0, y: 0 },
          data: {
            title: "Dev Clip Fixture",
            packageName: "dev-fixtures",
            description: "Emits a typed clip candidate for custom type and adapter experiments.",
            category: "Generator",
            tone: "cyan",
            inputs: [],
            outputs: [clipFixtureOutput],
            tags: ["dev", "fixture", "clip"],
          },
        },
        {
          id: "dev-review-annotator",
          position: { x: 360, y: 0 },
          data: {
            title: "Dev Review Annotator",
            packageName: "dev-review",
            description: "Wraps a clip candidate with reviewer notes and acceptance status.",
            category: "Pipeline",
            tone: "violet",
            inputs: [clipReviewInput],
            outputs: [clipReviewOutput],
            tags: ["dev", "review", "custom-type"],
          },
        },
      ],
      edges: [
        {
          source: "dev-clip-fixture",
          sourceHandle: handleId("out", clipFixtureOutput),
          target: "dev-review-annotator",
          targetHandle: handleId("in", clipReviewInput),
        },
      ],
    },
    {
      id: "dev-http-experiment-block",
      name: "Dev HTTP Experiment Block",
      kind: "youtube-video",
      createdAt,
      category: "API",
      tags: ["dev", "http", "custom-type"],
      nodes: [
        {
          id: "dev-endpoint-url",
          position: { x: 0, y: 0 },
          data: {
            title: "Dev Endpoint URL",
            packageName: "dev-fixtures",
            description: "Provides a placeholder URL for HTTP request experiments.",
            category: "Generator",
            tone: "sky",
            inputs: [],
            outputs: [endpointOutput],
            tags: ["dev", "url", "http"],
          },
        },
        {
          id: "dev-request-builder",
          position: { x: 360, y: 0 },
          data: {
            title: "Dev Request Builder",
            packageName: "fetch",
            description: "Builds a typed request object from the fixture URL.",
            category: "API",
            tone: "rose",
            inputs: [requestUrlInput],
            outputs: [requestOutput],
            tags: ["dev", "request", "http"],
          },
        },
        {
          id: "dev-http-client",
          position: { x: 720, y: 0 },
          data: {
            title: "Dev HTTP Client",
            packageName: "fetch",
            description: "Represents the request execution step and exposes a generic response body.",
            category: "API",
            tone: "amber",
            inputs: [clientInput],
            outputs: [clientOutput],
            tags: ["dev", "client", "http"],
          },
        },
      ],
      edges: [
        {
          source: "dev-endpoint-url",
          sourceHandle: handleId("out", endpointOutput),
          target: "dev-request-builder",
          targetHandle: handleId("in", requestUrlInput),
        },
        {
          source: "dev-request-builder",
          sourceHandle: handleId("out", requestOutput),
          target: "dev-http-client",
          targetHandle: handleId("in", clientInput),
        },
      ],
    },
  ];
}

export function persistSavedWorkflowBlocks(blocks: SavedWorkflowBlock[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowBlocksStorageKey, JSON.stringify(blocks));
}

export function downloadSavedWorkflowBlocksJson(blocks: SavedWorkflowBlock[]) {
  if (typeof document === "undefined") {
    return;
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    format: savedWorkflowBlocksJsonFormat,
    version: 1,
    exportedAt,
    blocks,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `video-analysis-components-${fileDateStamp(exportedAt)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function parseSavedWorkflowBlocksJson(text: string): SavedWorkflowBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  const candidates = savedWorkflowBlockJsonCandidates(parsed);
  if (!candidates || candidates.length === 0) {
    throw new Error("No components found in JSON");
  }
  if (!candidates.every(isSavedWorkflowBlock)) {
    throw new Error("JSON does not match the component format");
  }
  const blocks = candidates.map(cloneImportedSavedWorkflowBlock);
  const invalidBlock = blocks.find((block) => !savedWorkflowBlockHasValidGraph(block));
  if (invalidBlock) {
    throw new Error(`Component "${invalidBlock.name}" contains a workflow loop`);
  }
  return blocks;
}

function savedWorkflowBlockJsonCandidates(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Array.isArray(value.blocks)) {
    return value.blocks;
  }
  if (isSavedWorkflowBlock(value)) {
    return [value];
  }
  return null;
}

function cloneImportedSavedWorkflowBlock(block: SavedWorkflowBlock): SavedWorkflowBlock {
  return {
    id: createWorkflowBlockId(),
    name: block.name,
    createdAt: new Date().toISOString(),
    ...(block.kind ? { kind: block.kind } : {}),
    category: workflowComponentCategory(block.category ?? categoryForSavedWorkflowBlock(block)),
    tags: normalizeWorkflowTags(block.tags ?? tagsForSavedWorkflowBlock(block)),
    nodes: block.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: block.edges.map((edge) => ({ ...edge })),
  };
}

export function normalizeSavedWorkflowBlock(block: SavedWorkflowBlock): SavedWorkflowBlock {
  return {
    ...block,
    ...(block.kind ? { kind: block.kind } : {}),
    category: workflowComponentCategory(block.category ?? categoryForSavedWorkflowBlock(block)),
    tags: normalizeWorkflowTags(block.tags ?? tagsForSavedWorkflowBlock(block)),
    nodes: block.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: block.edges.map((edge) => ({ ...edge })),
  };
}

export function mergeSavedWorkflowBlocks(
  importedBlocks: SavedWorkflowBlock[],
  currentBlocks: SavedWorkflowBlock[],
): SavedWorkflowBlock[] {
  return importedBlocks.concat(currentBlocks).slice(0, 24);
}
