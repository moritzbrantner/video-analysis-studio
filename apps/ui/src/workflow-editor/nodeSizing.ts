import {
  defaultWorkflowNodeWidth,
  inlineWorkflowNodeHeight,
  inlineWorkflowNodeWidth,
  minWorkflowGroupHeight,
  minWorkflowGroupWidth,
} from "./constants";
import { handleId } from "./ports";
import type {
  PortType,
  SavedWorkflowBlockNode,
  WorkflowGroupMetadata,
  WorkflowLayoutSize,
  WorkflowNodeData,
  WorkflowNodeModel,
  WorkflowNodeSize,
} from "./types";

export function workflowNodeDataCanUseInlineLayout(data: WorkflowNodeData): boolean {
  return data.kind !== "group" && data.inputs.length <= 1 && data.outputs.length <= 1 && data.inputs.length + data.outputs.length > 0;
}

export function workflowNodeDataUsesInlineLayout(data: WorkflowNodeData): boolean {
  return data.minimized === true && workflowNodeDataCanUseInlineLayout(data);
}

export function workflowLayoutNodeSize(node: WorkflowNodeModel): WorkflowLayoutSize {
  if (workflowNodeDataUsesInlineLayout(node.data)) {
    return { width: inlineWorkflowNodeWidth, height: inlineWorkflowNodeHeight };
  }
  if (node.data.minimized) {
    return { width: 230, height: 54 };
  }

  const groupSize = node.data.kind === "group" ? normalizedWorkflowNodeSize(node.data.size) : null;
  if (groupSize) {
    const openGroupHeight =
      node.data.groupOpen && node.data.group ? workflowGroupOpenViewLayout(node.data.group).height + 128 : 0;
    return {
      width: groupSize.width,
      height: Math.max(groupSize.height, openGroupHeight),
    };
  }

  const portRows = Math.max(1, node.data.inputs.length, node.data.outputs.length);
  const descriptionRows = Math.max(1, Math.min(4, Math.ceil(node.data.description.length / 58)));
  return {
    width: defaultWorkflowNodeWidth,
    height: 112 + descriptionRows * 20 + portRows * 48,
  };
}

export const workflowGroupPreviewNodeWidth = 148;

export const workflowGroupPreviewNodeHeight = 62;

const workflowGroupPreviewPadding = 22;

export function normalizedWorkflowNodeSize(size: WorkflowNodeSize | undefined): WorkflowNodeSize | null {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    return null;
  }
  return {
    width: Math.max(minWorkflowGroupWidth, Math.round(size.width)),
    height: Math.max(minWorkflowGroupHeight, Math.round(size.height)),
  };
}

export function workflowGroupOpenViewLayout(group: WorkflowGroupMetadata): {
  width: number;
  height: number;
  nodes: Array<{ node: SavedWorkflowBlockNode; x: number; y: number }>;
  edges: Array<{ id: string; path: string; type: PortType }>;
} {
  if (group.nodes.length === 0) {
    return { width: 240, height: 150, nodes: [], edges: [] };
  }

  const xGroups = workflowGroupCoordinateGroups(group.nodes.map((node) => node.position.x), 120);
  const yGroups = workflowGroupCoordinateGroups(group.nodes.map((node) => node.position.y), 90);
  const cellCounts = new Map<string, number>();
  const layoutNodes = group.nodes.map((node) => {
    const xRank = workflowGroupCoordinateRank(node.position.x, xGroups);
    const yRank = workflowGroupCoordinateRank(node.position.y, yGroups);
    const cellKey = `${xRank}:${yRank}`;
    const cellIndex = cellCounts.get(cellKey) ?? 0;
    cellCounts.set(cellKey, cellIndex + 1);
    return {
      node,
      x: workflowGroupPreviewPadding + xRank * 190,
      y: workflowGroupPreviewPadding + yRank * 96 + cellIndex * 74,
    };
  });
  const layoutNodeById = new Map(layoutNodes.map((node) => [node.node.id, node]));
  const layoutEdges = group.edges.flatMap((edge, index) => {
    const source = layoutNodeById.get(edge.source);
    const target = layoutNodeById.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourceX = source.x + workflowGroupPreviewNodeWidth;
    const sourceY = source.y + workflowGroupPreviewNodeHeight / 2;
    const targetX = target.x;
    const targetY = target.y + workflowGroupPreviewNodeHeight / 2;
    const distance = Math.max(36, Math.abs(targetX - sourceX) * 0.45);
    const path = `M ${sourceX} ${sourceY} C ${sourceX + distance} ${sourceY}, ${targetX - distance} ${targetY}, ${targetX} ${targetY}`;
    const sourcePort = source.node.data.outputs.find((portValue) => edge.sourceHandle === handleId("out", portValue));
    const targetPort = target.node.data.inputs.find((portValue) => edge.targetHandle === handleId("in", portValue));
    const type = sourcePort?.type ?? targetPort?.type ?? "run_config";
    return [{ id: `${edge.source}-${edge.sourceHandle}-${edge.target}-${edge.targetHandle}-${index}`, path, type }];
  });
  const width =
    Math.max(...layoutNodes.map((node) => node.x)) + workflowGroupPreviewNodeWidth + workflowGroupPreviewPadding;
  const height =
    Math.max(...layoutNodes.map((node) => node.y)) + workflowGroupPreviewNodeHeight + workflowGroupPreviewPadding;

  return {
    width: Math.max(260, width),
    height: Math.max(150, height),
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}

function workflowGroupCoordinateGroups(values: number[], threshold: number): number[] {
  const groups: number[] = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const last = groups.at(-1);
    if (last === undefined || Math.abs(value - last) > threshold) {
      groups.push(value);
    } else {
      groups[groups.length - 1] = (last + value) / 2;
    }
  }
  return groups;
}

function workflowGroupCoordinateRank(value: number, groups: number[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  groups.forEach((groupValue, index) => {
    const distance = Math.abs(value - groupValue);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}
