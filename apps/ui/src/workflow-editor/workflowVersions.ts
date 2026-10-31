import { type Edge } from "@xyflow/react";
import { cloneWorkflowNodeData } from "./nodeData";
import type {
  SavedWorkflow,
  SavedWorkflowBlockEdge,
  SavedWorkflowBlockNode,
  SavedWorkflowVersion,
  WorkflowNodeModel,
} from "./types";

export function workflowHasChangesSinceLatestVersion(
  workflow: SavedWorkflow,
  name: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
): boolean {
  const latestVersion = latestSavedWorkflowVersion(workflow);
  if (!latestVersion) {
    return true;
  }
  return workflowVersionSnapshot(name, nodes, edges) !== savedWorkflowVersionSnapshot(latestVersion);
}

function latestSavedWorkflowVersion(workflow: SavedWorkflow): SavedWorkflowVersion | null {
  const versions = Array.isArray(workflow.versions) ? workflow.versions : [];
  return versions.reduce<SavedWorkflowVersion | null>(
    (latest, version) => (!latest || version.version > latest.version ? version : latest),
    null,
  );
}

function workflowVersionSnapshot(name: string, nodes: WorkflowNodeModel[], edges: Edge[]): string {
  return JSON.stringify({
    name,
    nodes: nodes
      .map(serializeWorkflowNode)
      .map(comparableWorkflowNode)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(serializeWorkflowEdge)
      .map(comparableWorkflowEdge)
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle ?? ""}|${a.target}|${a.targetHandle ?? ""}`.localeCompare(
          `${b.source}|${b.sourceHandle ?? ""}|${b.target}|${b.targetHandle ?? ""}`,
        ),
      ),
  });
}

function savedWorkflowVersionSnapshot(version: SavedWorkflowVersion): string {
  return JSON.stringify({
    name: version.name,
    nodes: version.nodes.map(comparableWorkflowNode).sort((a, b) => a.id.localeCompare(b.id)),
    edges: version.edges
      .map(comparableWorkflowEdge)
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle ?? ""}|${a.target}|${a.targetHandle ?? ""}`.localeCompare(
          `${b.source}|${b.sourceHandle ?? ""}|${b.target}|${b.targetHandle ?? ""}`,
        ),
      ),
  });
}

export function comparableWorkflowNode(node: SavedWorkflowBlockNode): SavedWorkflowBlockNode {
  return {
    id: node.id,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
  };
}

export function comparableWorkflowEdge(edge: SavedWorkflowBlockEdge): SavedWorkflowBlockEdge {
  return {
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  };
}

export function serializeWorkflowNode(node: WorkflowNodeModel): SavedWorkflowBlockNode {
  return {
    id: node.id,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
  };
}

export function serializeWorkflowEdge(edge: Edge): SavedWorkflowBlockEdge {
  return {
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}
