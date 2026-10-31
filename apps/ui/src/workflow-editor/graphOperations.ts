import { type Edge } from "@xyflow/react";
import type { WorkflowKindId } from "../run/types";
import {
  categoryForWorkflowNodes,
  parseWorkflowTags,
  tagsForWorkflowNodes,
  workflowComponentCategory,
} from "./componentMetadata";
import { workflowEdgeFromConnection } from "./connections";
import { defaultWorkflowGroupHeight, defaultWorkflowNodeWidth } from "./constants";
import { createWorkflowBlockId, safeFlowId } from "./ids";
import { cloneWorkflowNodeData, normalizeFlowPort } from "./nodeData";
import { findPort, handleId, handleSignature, parseHandleId, port, portIsStream } from "./ports";
import type {
  FlowPort,
  PortDirection,
  SavedWorkflowBlock,
  WorkflowBlockCategoryDraft,
  WorkflowClipboardState,
  WorkflowComponentCategory,
  WorkflowGroupBoundary,
  WorkflowNodeModel,
} from "./types";

export function buildSavedWorkflowBlock(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  {
    requestedName,
    requestedTags = "",
    requestedCategory = "Auto",
    requestedKind,
    id,
    createdAt,
    minNodeCount = 2,
  }: {
    requestedName: string;
    requestedTags?: string;
    requestedCategory?: WorkflowBlockCategoryDraft | WorkflowComponentCategory;
    requestedKind?: WorkflowKindId;
    id?: string;
    createdAt?: string;
    minNodeCount?: number;
  },
): SavedWorkflowBlock | null {
  if (selectedNodes.length < minNodeCount) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = requestedName.trim() || defaultWorkflowBlockName(selectedNodes);
  const tags = parseWorkflowTags(requestedTags);
  const category =
    requestedCategory === "Auto" ? categoryForWorkflowNodes(selectedNodes) : workflowComponentCategory(requestedCategory);

  return {
    id: id ?? createWorkflowBlockId(),
    name,
    createdAt: createdAt ?? new Date().toISOString(),
    ...(requestedKind ? { kind: requestedKind } : {}),
    category,
    tags: tags.length > 0 ? tags : tagsForWorkflowNodes(selectedNodes),
    nodes: selectedNodes.map((node) => ({
      id: node.id,
      position: {
        x: node.position.x - minX,
        y: node.position.y - minY,
      },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
    })),
  };
}

export function createSavedWorkflowBlock(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  requestedName: string,
  requestedTags = "",
  requestedCategory: WorkflowBlockCategoryDraft = "Auto",
  requestedKind?: WorkflowKindId,
): SavedWorkflowBlock | null {
  return buildSavedWorkflowBlock(selectedNodes, edges, {
    requestedName,
    requestedTags,
    requestedCategory,
    requestedKind,
  });
}

export function createWorkflowClipboardState(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
): WorkflowClipboardState | null {
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = selectedNodes.length === 1 ? selectedNodes[0].data.title : defaultWorkflowBlockName(selectedNodes);

  return {
    block: {
      id: createWorkflowBlockId(),
      name,
      createdAt: new Date().toISOString(),
      category: categoryForWorkflowNodes(selectedNodes),
      tags: tagsForWorkflowNodes(selectedNodes),
      nodes: selectedNodes.map((node) => ({
        id: node.id,
        position: {
          x: node.position.x - minX,
          y: node.position.y - minY,
        },
        data: cloneWorkflowNodeData(node.data),
      })),
      edges: edges
        .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
    },
    anchor: { x: minX, y: minY },
    pasteCount: 0,
  };
}

export function createWorkflowGroup(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  requestedName: string,
): { node: WorkflowNodeModel; edges: Edge[]; groupedNodeCount: number } | null {
  if (selectedNodes.length < 2) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = requestedName.trim() || defaultWorkflowBlockName(selectedNodes);
  const groupId = createWorkflowBlockId();
  const internalEdges = edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const incomingEdges = edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoingEdges = edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const inputPorts: FlowPort[] = [];
  const outputPorts: FlowPort[] = [];
  const inputBoundaries: WorkflowGroupBoundary[] = [];
  const outputBoundaries: WorkflowGroupBoundary[] = [];

  for (const node of selectedNodes) {
    for (const input of node.data.inputs) {
      const handle = handleId("in", input);
      const hasInternalEdge = internalEdges.some((edge) => edge.target === node.id && edge.targetHandle === handle);
      const hasIncomingEdge = incomingEdges.some((edge) => edge.target === node.id && edge.targetHandle === handle);
      if (!hasInternalEdge || hasIncomingEdge) {
        const wrapperPort = groupBoundaryPort("in", node, input);
        inputPorts.push(wrapperPort);
        inputBoundaries.push({
          wrapperPortId: wrapperPort.id,
          nodeId: node.id,
          handle,
          type: input.type,
          ...(portIsStream(input) ? { stream: true } : {}),
        });
      }
    }

    for (const output of node.data.outputs) {
      const handle = handleId("out", output);
      const hasInternalEdge = internalEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      const hasOutgoingEdge = outgoingEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      if (!hasInternalEdge || hasOutgoingEdge) {
        const wrapperPort = groupBoundaryPort("out", node, output);
        outputPorts.push(wrapperPort);
        outputBoundaries.push({
          wrapperPortId: wrapperPort.id,
          nodeId: node.id,
          handle,
          type: output.type,
          ...(portIsStream(output) ? { stream: true } : {}),
        });
      }
    }
  }

  const inputBoundaryByHandle = new Map(inputBoundaries.map((boundary) => [boundaryKey(boundary.nodeId, boundary.handle), boundary]));
  const outputBoundaryByHandle = new Map(outputBoundaries.map((boundary) => [boundaryKey(boundary.nodeId, boundary.handle), boundary]));
  const groupNode: WorkflowNodeModel = {
    id: groupId,
    type: "workflow",
    position: { x: Math.max(0, minX), y: Math.max(0, minY) },
    data: {
      title: name,
      packageName: "Component Group",
      description: `${selectedNodes.length} components abstracted behind boundary ports.`,
      category: categoryForWorkflowNodes(selectedNodes),
      tone: "zinc",
      inputs: dedupePorts(inputPorts),
      outputs: dedupePorts(outputPorts),
      tags: tagsForWorkflowNodes(selectedNodes),
      size: { width: defaultWorkflowNodeWidth, height: defaultWorkflowGroupHeight },
      kind: "group",
      group: {
        memberCount: selectedNodes.length,
        nodes: selectedNodes.map((node) => ({
          id: node.id,
          position: {
            x: node.position.x - minX,
            y: node.position.y - minY,
          },
          data: cloneWorkflowNodeData(node.data),
        })),
        edges: internalEdges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
        inputBoundaries,
        outputBoundaries,
      },
    },
  };

  const visibleEdges = edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const reroutedIncomingEdges = incomingEdges.flatMap((edge) => {
    const boundary = inputBoundaryByHandle.get(boundaryKey(edge.target, edge.targetHandle));
    if (!boundary) {
      return [];
    }
    const wrapperPort = groupNode.data.inputs.find((candidate) => candidate.id === boundary.wrapperPortId);
    if (!wrapperPort) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? null,
          target: groupId,
          targetHandle: handleId("in", wrapperPort),
        },
        wrapperPort,
      ),
    ];
  });
  const reroutedOutgoingEdges = outgoingEdges.flatMap((edge) => {
    const boundary = outputBoundaryByHandle.get(boundaryKey(edge.source, edge.sourceHandle));
    if (!boundary) {
      return [];
    }
    const wrapperPort = groupNode.data.outputs.find((candidate) => candidate.id === boundary.wrapperPortId);
    if (!wrapperPort) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source: groupId,
          sourceHandle: handleId("out", wrapperPort),
          target: edge.target,
          targetHandle: edge.targetHandle ?? null,
        },
        wrapperPort,
      ),
    ];
  });

  return {
    node: groupNode,
    edges: dedupeEdges(visibleEdges.concat(reroutedIncomingEdges, reroutedOutgoingEdges)),
    groupedNodeCount: selectedNodes.length,
  };
}

export function restoreWorkflowGroup(
  groupNode: WorkflowNodeModel,
  currentNodes: WorkflowNodeModel[],
  currentEdges: Edge[],
): { nodes: WorkflowNodeModel[]; edges: Edge[]; restoredNodeIds: string[] } {
  const group = groupNode.data.group;
  if (!group) {
    return { nodes: currentNodes, edges: currentEdges, restoredNodeIds: [] };
  }

  const occupiedIds = new Set(currentNodes.filter((node) => node.id !== groupNode.id).map((node) => node.id));
  const idByOriginalId = new Map<string, string>();
  for (const node of group.nodes) {
    const restoredId = occupiedIds.has(node.id) ? `${groupNode.id}-${safeFlowId(node.id)}` : node.id;
    occupiedIds.add(restoredId);
    idByOriginalId.set(node.id, restoredId);
  }

  const restoredNodes: WorkflowNodeModel[] = group.nodes.map((node) => ({
    id: idByOriginalId.get(node.id)!,
    type: "workflow",
    position: {
      x: groupNode.position.x + node.position.x,
      y: groupNode.position.y + node.position.y,
    },
    data: cloneWorkflowNodeData(node.data),
    selected: true,
  }));
  const restoredNodeIds = restoredNodes.map((node) => node.id);
  const inputBoundaryByPort = new Map(group.inputBoundaries.map((boundary) => [boundary.wrapperPortId, boundary]));
  const outputBoundaryByPort = new Map(group.outputBoundaries.map((boundary) => [boundary.wrapperPortId, boundary]));
  const edgesWithoutGroup = currentEdges.filter((edge) => edge.source !== groupNode.id && edge.target !== groupNode.id);
  const restoredInternalEdges = group.edges.flatMap((edge) => {
    const source = idByOriginalId.get(edge.source);
    const target = idByOriginalId.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourcePort = findPort(restoredNodes, source, edge.sourceHandle, "out");
    const targetPort = findPort(restoredNodes, target, edge.targetHandle, "in");
    const edgePort = sourcePort ?? targetPort ?? "run_config";
    return [
      workflowEdgeFromConnection(
        {
          source,
          sourceHandle: edge.sourceHandle ?? null,
          target,
          targetHandle: edge.targetHandle ?? null,
        },
        edgePort,
      ),
    ];
  });
  const restoredExternalEdges = currentEdges.flatMap((edge) => {
    if (edge.target === groupNode.id && edge.targetHandle) {
      const parsed = parseHandleId(edge.targetHandle);
      const boundary = parsed ? inputBoundaryByPort.get(parsed.portId) : null;
      const target = boundary ? idByOriginalId.get(boundary.nodeId) : null;
      if (!boundary || !target) {
        return [];
      }
      return [
        workflowEdgeFromConnection(
          {
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? null,
            target,
            targetHandle: boundary.handle ?? null,
          },
          port(boundary.wrapperPortId, boundary.wrapperPortId, boundary.type, { stream: boundary.stream }),
        ),
      ];
    }
    if (edge.source === groupNode.id && edge.sourceHandle) {
      const parsed = parseHandleId(edge.sourceHandle);
      const boundary = parsed ? outputBoundaryByPort.get(parsed.portId) : null;
      const source = boundary ? idByOriginalId.get(boundary.nodeId) : null;
      if (!boundary || !source) {
        return [];
      }
      return [
        workflowEdgeFromConnection(
          {
            source,
            sourceHandle: boundary.handle ?? null,
            target: edge.target,
            targetHandle: edge.targetHandle ?? null,
          },
          port(boundary.wrapperPortId, boundary.wrapperPortId, boundary.type, { stream: boundary.stream }),
        ),
      ];
    }
    return [];
  });

  const remainingNodes: WorkflowNodeModel[] = currentNodes
    .filter((node) => node.id !== groupNode.id)
    .map((node) => ({ ...node, selected: false }));

  return {
    nodes: remainingNodes.concat(restoredNodes),
    edges: dedupeEdges(edgesWithoutGroup.concat(restoredInternalEdges, restoredExternalEdges)),
    restoredNodeIds,
  };
}

export function instantiateSavedWorkflowBlock(
  block: SavedWorkflowBlock,
  anchor: { x: number; y: number },
): { nodes: WorkflowNodeModel[]; edges: Edge[]; idByOriginalId: Map<string, string> } {
  const instanceId = createWorkflowBlockId();
  const idByOriginalId = new Map(block.nodes.map((node) => [node.id, `${instanceId}-${safeFlowId(node.id)}`]));
  const nodes = block.nodes.map((node) => ({
    id: idByOriginalId.get(node.id)!,
    type: "workflow" as const,
    position: {
      x: anchor.x + node.position.x,
      y: anchor.y + node.position.y,
    },
    data: cloneWorkflowNodeData(node.data),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = block.edges.flatMap((edge) => {
    const source = idByOriginalId.get(edge.source);
    const target = idByOriginalId.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourcePort = findPort(nodes, source, edge.sourceHandle, "out");
    const targetPort = findPort(nodes, target, edge.targetHandle, "in");
    const edgePort = sourcePort ?? targetPort ?? "run_config";
    if (!nodeById.has(source) || !nodeById.has(target)) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source,
          target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        },
        edgePort,
      ),
    ];
  });

  return { nodes, edges, idByOriginalId };
}

function groupBoundaryPort(direction: PortDirection, node: WorkflowNodeModel, portValue: FlowPort): FlowPort {
  return normalizeFlowPort({
    id: `${direction}-${safeFlowId(node.id)}-${safeFlowId(portValue.id)}`,
    label: `${node.data.title}: ${portValue.label}`,
    type: portValue.type,
    kind: portValue.kind,
    valueType: structuredClone(portValue.valueType),
    optional: portValue.optional,
    stream: portValue.stream,
    exposableInput: portValue.exposableInput,
    inputSurface: portValue.inputSurface,
    suggestedAdapters: portValue.suggestedAdapters,
    runtimeValidation: portValue.runtimeValidation,
  });
}

function boundaryKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}|${handle ?? ""}`;
}

function dedupePorts(ports: FlowPort[]): FlowPort[] {
  const seen = new Set<string>();
  return ports.filter((portValue) => {
    const key = `${portValue.id}|${handleSignature(portValue)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

function defaultWorkflowBlockName(nodes: WorkflowNodeModel[]): string {
  const [firstNode, secondNode] = nodes;
  if (!firstNode || !secondNode) {
    return "Saved Component";
  }
  if (nodes.length === 2) {
    return `${firstNode.data.title} + ${secondNode.data.title}`;
  }
  return `${firstNode.data.title} + ${nodes.length - 1} more`;
}
