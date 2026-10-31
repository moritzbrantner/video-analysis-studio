import type { WorkflowKindId } from "../run/types";
import { inferWorkflowKindFromName, workflowKindId } from "../run/workflowKinds";
import {
  categoryForWorkflowNodes,
  normalizeWorkflowTags,
  tagsForWorkflowNodeData,
  workflowComponentCategory,
} from "./componentMetadata";
import { cloneWorkflowNodeData } from "./nodeData";
import { handleId, portsCompatible } from "./ports";
import type {
  FlowPort,
  SavedWorkflowBlock,
  WorkflowBlockOpenInput,
  WorkflowComponentCategory,
  WorkflowNodeModel,
  WorkflowPrimitiveConnectorTarget,
  WorkflowSavedBlockConnectorTarget,
} from "./types";

export const workflowComponentCategoryOrder: WorkflowComponentCategory[] = [
  "Application",
  "Input",
  "API",
  "Pipeline",
  "Ingest",
  "Detection",
  "Models",
  "Audio",
  "Text",
  "Data",
  "Report",
  "Dashboard",
  "Output",
  "Generator",
  "Control Flow",
  "Reusable",
];

export function groupWorkflowNodeTemplatesByCategory(
  nodes: WorkflowNodeModel[],
): Array<{ category: WorkflowComponentCategory; items: WorkflowNodeModel[] }> {
  return groupWorkflowComponentsByCategory(nodes, (node) => node.data.category ?? "Reusable");
}

export function groupSavedWorkflowBlocksByCategory(
  blocks: SavedWorkflowBlock[],
): Array<{ category: WorkflowComponentCategory; items: SavedWorkflowBlock[] }> {
  return groupWorkflowComponentsByCategory(blocks, (block) => block.category ?? "Reusable");
}

function groupWorkflowComponentsByCategory<T>(
  items: T[],
  getCategory: (item: T) => WorkflowComponentCategory,
): Array<{ category: WorkflowComponentCategory; items: T[] }> {
  const groups = new Map<WorkflowComponentCategory, T[]>();
  for (const item of items) {
    const category = workflowComponentCategory(getCategory(item));
    const group = groups.get(category);
    if (group) {
      group.push(item);
    } else {
      groups.set(category, [item]);
    }
  }
  return Array.from(groups.entries())
    .map(([category, groupItems]) => ({ category, items: groupItems }))
    .sort((left, right) => workflowComponentCategorySortIndex(left.category) - workflowComponentCategorySortIndex(right.category));
}

function workflowComponentCategorySortIndex(category: WorkflowComponentCategory): number {
  const index = workflowComponentCategoryOrder.indexOf(category);
  return index === -1 ? workflowComponentCategoryOrder.length : index;
}

export function filterWorkflowNodeTemplates(nodes: WorkflowNodeModel[], query: string): WorkflowNodeModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return nodes;
  }
  return nodes.filter((node) =>
    [
      node.data.title,
      node.data.packageName,
      node.data.description,
      node.data.category ?? "",
      ...(node.data.tags ?? []),
      ...node.data.inputs.map((portValue) => portValue.label),
      ...node.data.outputs.map((portValue) => portValue.label),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function workflowPrimitiveConnectorTargets(
  nodes: WorkflowNodeModel[],
  sourcePort: FlowPort,
): WorkflowPrimitiveConnectorTarget[] {
  return nodes.flatMap((template) => {
    const input = template.data.inputs.find((portValue) => portsCompatible(sourcePort, portValue));
    return input ? [{ template, input }] : [];
  });
}

export function workflowSavedBlockConnectorTargets(
  blocks: SavedWorkflowBlock[],
  sourcePort: FlowPort,
): WorkflowSavedBlockConnectorTarget[] {
  return blocks.flatMap((block) => {
    const input = savedWorkflowBlockOpenInputs(block).find((candidate) => portsCompatible(sourcePort, candidate.port));
    return input ? [{ block, input }] : [];
  });
}

export function savedWorkflowBlockOpenInputs(block: SavedWorkflowBlock): WorkflowBlockOpenInput[] {
  const incomingHandles = new Set(
    block.edges
      .filter((edge) => edge.targetHandle)
      .map((edge) => `${edge.target}:${edge.targetHandle}`),
  );

  return block.nodes.flatMap((node) =>
    node.data.inputs
      .filter((input) => !incomingHandles.has(`${node.id}:${handleId("in", input)}`))
      .map((input) => ({
        nodeId: node.id,
        nodeTitle: node.data.title,
        port: input,
      })),
  );
}

export function savedWorkflowBlockExposedOutputs(block: SavedWorkflowBlock): WorkflowBlockOpenInput[] {
  const outgoingHandles = new Set(
    block.edges
      .filter((edge) => edge.sourceHandle)
      .map((edge) => `${edge.source}:${edge.sourceHandle}`),
  );

  return block.nodes.flatMap((node) =>
    node.data.outputs
      .filter((output) => !outgoingHandles.has(`${node.id}:${handleId("out", output)}`))
      .map((output) => ({
        nodeId: node.id,
        nodeTitle: node.data.title,
        port: output,
      })),
  );
}

export function workflowKindForSavedWorkflowBlock(block: SavedWorkflowBlock): WorkflowKindId {
  return workflowKindId(block.kind) ?? inferWorkflowKindFromName(block.name);
}

export function filterSavedWorkflowBlocks(blocks: SavedWorkflowBlock[], query: string): SavedWorkflowBlock[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return blocks;
  }
  return blocks.filter((block) =>
    [
      block.name,
      block.category ?? "",
      ...(block.tags ?? []),
      ...block.nodes.flatMap((node) => [
        node.data.title,
        node.data.packageName,
        node.data.description,
        node.data.category ?? "",
        ...(node.data.tags ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function categoryForSavedWorkflowBlock(block: SavedWorkflowBlock): WorkflowComponentCategory {
  return categoryForWorkflowNodes(
    block.nodes.map((node) => ({
      id: node.id,
      type: "workflow" as const,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
  );
}

export function tagsForSavedWorkflowBlock(block: SavedWorkflowBlock): string[] {
  return normalizeWorkflowTags(block.nodes.flatMap((node) => node.data.tags ?? tagsForWorkflowNodeData(node.data)));
}
