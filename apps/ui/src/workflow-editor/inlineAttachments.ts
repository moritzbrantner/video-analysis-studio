import { type Edge } from "@xyflow/react";
import { workflowGraphWouldCreateCycle } from "../workflowGraph";
import { workflowEdgeFromConnection } from "./connections";
import {
  inlineWorkflowNodeHeight,
  inlineWorkflowNodeWidth,
  workflowInlineAttachGap,
  workflowInlineSnapDistance,
} from "./constants";
import {
  workflowLayoutNodeSize,
  workflowNodeDataCanUseInlineLayout,
  workflowNodeDataUsesInlineLayout,
} from "./nodeSizing";
import { handleId, handleSignature, portsCompatible } from "./ports";
import type { FlowPort, PortDirection, WorkflowInlineAttachment, WorkflowNodeModel } from "./types";

export function workflowDisplayEdges(edges: Edge[], nodes: WorkflowNodeModel[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const hidden = source && target ? workflowEdgeHiddenByInlineAttachment(edge, source, target) : false;
    return hidden === Boolean(edge.hidden) ? edge : { ...edge, hidden };
  });
}

function workflowEdgeHiddenByInlineAttachment(edge: Edge, source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  if (!workflowEdgeTouchesInlineNode(edge, source, target)) {
    return false;
  }
  return workflowNodesAreVisuallyAttached(source, target);
}

function workflowEdgeTouchesInlineNode(edge: Edge, source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  const sourceInline = workflowNodeDataUsesInlineLayout(source.data);
  const targetInline = workflowNodeDataUsesInlineLayout(target.data);
  if (!sourceInline && !targetInline) {
    return false;
  }
  if (sourceInline) {
    const sourceOutput = source.data.outputs[0];
    if (!sourceOutput || edge.sourceHandle !== handleId("out", sourceOutput)) {
      return false;
    }
  }
  if (targetInline) {
    const targetInput = target.data.inputs[0];
    if (!targetInput || edge.targetHandle !== handleId("in", targetInput)) {
      return false;
    }
  }
  return true;
}

function workflowNodesAreVisuallyAttached(source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  const sourceSize = workflowLayoutNodeSize(source);
  const targetSize = workflowLayoutNodeSize(target);
  const gap = target.position.x - (source.position.x + sourceSize.width);
  if (gap < -2 || gap > workflowInlineAttachGap + 10) {
    return false;
  }

  const sourceCenterY = source.position.y + sourceSize.height / 2;
  const targetCenterY = target.position.y + targetSize.height / 2;
  const yTolerance = Math.max(42, Math.max(sourceSize.height, targetSize.height) / 2 + workflowInlineAttachGap);
  return Math.abs(sourceCenterY - targetCenterY) <= yTolerance;
}

export function stickWorkflowInlineAttachments(nodes: WorkflowNodeModel[], edges: Edge[]): WorkflowNodeModel[] {
  if (nodes.length === 0 || edges.length === 0) {
    return nodes;
  }

  let nextNodes = nodes;
  for (let pass = 0; pass < 4; pass += 1) {
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
    const incomingInlineNodeIds = new Set(
      edges
        .map((edge) => {
          const target = nodeById.get(edge.target);
          return target && workflowNodeDataUsesInlineLayout(target.data) ? target.id : null;
        })
        .filter((id): id is string => id !== null),
    );
    const positionByInlineNodeId = new Map<string, { x: number; y: number }>();

    for (const edge of edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) {
        continue;
      }

      const incomingPosition = workflowInlineIncomingAttachmentPosition(edge, source, target);
      if (incomingPosition) {
        positionByInlineNodeId.set(target.id, incomingPosition);
        continue;
      }

      if (incomingInlineNodeIds.has(source.id)) {
        continue;
      }

      const outgoingPosition = workflowInlineOutgoingAttachmentPosition(edge, source, target);
      if (outgoingPosition) {
        positionByInlineNodeId.set(source.id, outgoingPosition);
      }
    }

    if (positionByInlineNodeId.size === 0) {
      return nextNodes;
    }

    let changed = false;
    nextNodes = nextNodes.map((node) => {
      const position = positionByInlineNodeId.get(node.id);
      if (!position || (node.position.x === position.x && node.position.y === position.y)) {
        return node;
      }
      changed = true;
      return { ...node, position };
    });

    if (!changed) {
      return nextNodes;
    }
  }

  return nextNodes;
}

function workflowInlineIncomingAttachmentPosition(
  edge: Edge,
  source: WorkflowNodeModel,
  target: WorkflowNodeModel,
): { x: number; y: number } | null {
  if (!workflowNodeDataUsesInlineLayout(target.data)) {
    return null;
  }
  const input = target.data.inputs[0];
  if (!input || edge.targetHandle !== handleId("in", input)) {
    return null;
  }
  const sourcePort = source.data.outputs.find((portValue) => edge.sourceHandle === handleId("out", portValue));
  if (!sourcePort || !portsCompatible(sourcePort, input)) {
    return null;
  }
  const sourceSize = workflowLayoutNodeSize(source);
  const sourceHandlePoint = workflowPortHandlePoint(source, "out", sourcePort);
  return {
    x: source.position.x + sourceSize.width + workflowInlineAttachGap,
    y: sourceHandlePoint.y - inlineWorkflowNodeHeight / 2,
  };
}

function workflowInlineOutgoingAttachmentPosition(
  edge: Edge,
  source: WorkflowNodeModel,
  target: WorkflowNodeModel,
): { x: number; y: number } | null {
  if (!workflowNodeDataUsesInlineLayout(source.data)) {
    return null;
  }
  const output = source.data.outputs[0];
  if (!output || edge.sourceHandle !== handleId("out", output)) {
    return null;
  }
  const targetPort = target.data.inputs.find((portValue) => edge.targetHandle === handleId("in", portValue));
  if (!targetPort || !portsCompatible(output, targetPort)) {
    return null;
  }
  const targetHandlePoint = workflowPortHandlePoint(target, "in", targetPort);
  return {
    x: target.position.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
    y: targetHandlePoint.y - inlineWorkflowNodeHeight / 2,
  };
}

export function workflowInlineAttachmentForDraggedNode(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
): WorkflowInlineAttachment | null {
  return workflowInlineAttachmentForNode(nodeId, nodes, edges, "drag");
}

export function workflowInlineAttachmentForDrop(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  dropPoint: { x: number; y: number },
): WorkflowInlineAttachment | null {
  return workflowInlineAttachmentForNode(nodeId, nodes, edges, "drop", dropPoint);
}

function workflowInlineAttachmentForNode(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  mode: "drag" | "drop",
  dropPoint?: { x: number; y: number },
): WorkflowInlineAttachment | null {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !workflowNodeDataCanUseInlineLayout(node.data)) {
    return null;
  }

  const candidates: Array<WorkflowInlineAttachment & { score: number }> = [];
  const input = node.data.inputs[0];
  const output = node.data.outputs[0];
  const currentInputPoint = mode === "drop" && dropPoint
    ? dropPoint
    : { x: node.position.x, y: node.position.y + workflowLayoutNodeSize(node).height / 2 };
  const currentOutputPoint = mode === "drop" && dropPoint
    ? dropPoint
    : { x: node.position.x + workflowLayoutNodeSize(node).width, y: node.position.y + workflowLayoutNodeSize(node).height / 2 };

  if (input) {
    for (const source of nodes) {
      if (source.id === node.id) {
        continue;
      }
      for (const sourcePort of source.data.outputs) {
        if (!portsCompatible(sourcePort, input)) {
          continue;
        }
        const sourceHandlePoint = workflowPortHandlePoint(source, "out", sourcePort);
        const score = distanceBetweenPoints(currentInputPoint, sourceHandlePoint);
        if (score > workflowInlineSnapDistance) {
          continue;
        }
        const sourceSize = workflowLayoutNodeSize(source);
        const position = {
          x: source.position.x + sourceSize.width + workflowInlineAttachGap,
          y: sourceHandlePoint.y - inlineWorkflowNodeHeight / 2,
        };
        candidates.push({
          score,
          position,
          edge: workflowEdgeFromConnection(
            {
              source: source.id,
              sourceHandle: handleId("out", sourcePort),
              target: node.id,
              targetHandle: handleId("in", input),
            },
            sourcePort,
          ),
        });
      }
    }
  }

  if (output) {
    for (const target of nodes) {
      if (target.id === node.id) {
        continue;
      }
      for (const targetPort of target.data.inputs) {
        if (!portsCompatible(output, targetPort)) {
          continue;
        }
        const targetHandlePoint = workflowPortHandlePoint(target, "in", targetPort);
        const score = distanceBetweenPoints(currentOutputPoint, targetHandlePoint);
        if (score > workflowInlineSnapDistance) {
          continue;
        }
        const position = {
          x: target.position.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
          y: targetHandlePoint.y - inlineWorkflowNodeHeight / 2,
        };
        candidates.push({
          score,
          position,
          edge: workflowEdgeFromConnection(
            {
              source: node.id,
              sourceHandle: handleId("out", output),
              target: target.id,
              targetHandle: handleId("in", targetPort),
            },
            output,
          ),
        });
      }
    }
  }

  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  const safeCandidates = candidates.filter(
    (candidate) =>
      !existingEdgeIds.has(candidate.edge.id) && !workflowGraphWouldCreateCycle(edges, candidate.edge),
  );
  return (
    safeCandidates.sort((left, right) => left.score - right.score)[0] ??
    null
  );
}

function workflowPortHandlePoint(
  node: WorkflowNodeModel,
  direction: PortDirection,
  portValue: FlowPort,
): { x: number; y: number } {
  const size = workflowLayoutNodeSize(node);
  return {
    x: direction === "in" ? node.position.x : node.position.x + size.width,
    y: node.position.y + workflowPortCenterY(node, direction, portValue, size),
  };
}

function workflowPortCenterY(
  node: WorkflowNodeModel,
  direction: PortDirection,
  portValue: FlowPort,
  size = workflowLayoutNodeSize(node),
): number {
  if (workflowNodeDataUsesInlineLayout(node.data)) {
    return size.height / 2;
  }

  const ports = direction === "in" ? node.data.inputs : node.data.outputs;
  const index = Math.max(
    0,
    ports.findIndex(
      (candidate) => candidate.id === portValue.id && handleSignature(candidate) === handleSignature(portValue),
    ),
  );
  if (node.data.minimized) {
    return ((index + 1) / (ports.length + 1)) * size.height;
  }

  const portRows = Math.max(1, node.data.inputs.length, node.data.outputs.length);
  const portAreaHeight = portRows * 48;
  const headerHeight = Math.max(64, size.height - portAreaHeight);
  return Math.min(size.height - 18, headerHeight + index * 48 + 24);
}

function distanceBetweenPoints(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
