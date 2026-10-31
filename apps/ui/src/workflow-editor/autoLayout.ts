import { type Edge } from "@xyflow/react";
import {
  defaultWorkflowGroupHeight,
  defaultWorkflowNodeWidth,
  inlineWorkflowNodeHeight,
  inlineWorkflowNodeWidth,
  workflowInlineAttachGap,
  workflowLayoutBackEdgeTolerance,
  workflowLayoutColumnGap,
  workflowLayoutRowGap,
  workflowLayoutStartX,
  workflowLayoutStartY,
} from "./constants";
import { workflowLayoutNodeSize, workflowNodeDataUsesInlineLayout } from "./nodeSizing";
import type {
  WorkflowLayoutEdge,
  WorkflowLayoutSize,
  WorkflowNodeData,
  WorkflowNodeModel,
} from "./types";

export function autoArrangeWorkflowNodes(nodes: WorkflowNodeModel[], edges: Edge[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) {
    return nodes.map((node) => ({
      ...node,
      position: { x: workflowLayoutStartX, y: workflowLayoutStartY },
    }));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutEdges = workflowLayoutEdges(edges, nodeById);
  const rankEdges = workflowLayoutRankEdges(layoutEdges, nodeById);
  const rankById = compactWorkflowLayoutRanks(workflowLayoutRanks(nodes, rankEdges));
  const columns = workflowLayoutColumns(nodes, rankById);
  const orderedColumns = orderWorkflowLayoutColumns(columns, layoutEdges);
  const sizeById = new Map(nodes.map((node) => [node.id, workflowLayoutNodeSize(node)]));
  const positionById = new Map<string, { x: number; y: number }>();
  let x = workflowLayoutStartX;

  for (const column of orderedColumns) {
    const columnWidth = Math.max(
      defaultWorkflowNodeWidth,
      ...column.map((node) => sizeById.get(node.id)?.width ?? defaultWorkflowNodeWidth),
    );
    let y = workflowLayoutStartY;

    for (const node of column) {
      const size = sizeById.get(node.id) ?? { width: defaultWorkflowNodeWidth, height: defaultWorkflowGroupHeight };
      positionById.set(node.id, { x, y });
      y += size.height + workflowLayoutRowGap;
    }

    x += columnWidth + workflowLayoutColumnGap;
  }

  positionInlineWorkflowNodes(nodes, edges, sizeById, positionById);

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? { ...node.position },
  }));
}

function positionInlineWorkflowNodes(
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  sizeById: Map<string, WorkflowLayoutSize>,
  positionById: Map<string, { x: number; y: number }>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inlineNodesBySource = new Map<string, WorkflowNodeModel[]>();
  const inlineNodesByTarget = new Map<string, WorkflowNodeModel[]>();
  const positionedInlineNodeIds = new Set<string>();

  for (const node of nodes) {
    if (!workflowNodeDataUsesInlineLayout(node.data)) {
      continue;
    }
    const incomingEdge = edges.find((edge) => edge.target === node.id && nodeById.has(edge.source));
    if (!incomingEdge) {
      continue;
    }
    inlineNodesBySource.set(incomingEdge.source, [...(inlineNodesBySource.get(incomingEdge.source) ?? []), node]);
    positionedInlineNodeIds.add(node.id);
  }

  for (const node of nodes) {
    if (!workflowNodeDataUsesInlineLayout(node.data) || positionedInlineNodeIds.has(node.id)) {
      continue;
    }
    const outgoingEdge = edges.find((edge) => edge.source === node.id && nodeById.has(edge.target));
    if (!outgoingEdge) {
      continue;
    }
    inlineNodesByTarget.set(outgoingEdge.target, [...(inlineNodesByTarget.get(outgoingEdge.target) ?? []), node]);
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const [sourceId, inlineNodes] of inlineNodesBySource) {
      const source = nodeById.get(sourceId);
      const sourcePosition = positionById.get(sourceId);
      if (!source || !sourcePosition) {
        continue;
      }

      const sourceSize = sizeById.get(source.id) ?? workflowLayoutNodeSize(source);
      const orderedInlineNodes = [...inlineNodes].sort(compareWorkflowLayoutNodesByPosition);
      const totalHeight =
        orderedInlineNodes.length * inlineWorkflowNodeHeight +
        Math.max(0, orderedInlineNodes.length - 1) * workflowInlineAttachGap;
      const startY = sourcePosition.y + sourceSize.height / 2 - totalHeight / 2;

      orderedInlineNodes.forEach((node, index) => {
        positionById.set(node.id, {
          x: sourcePosition.x + sourceSize.width + workflowInlineAttachGap,
          y: startY + index * (inlineWorkflowNodeHeight + workflowInlineAttachGap),
        });
      });
    }

    for (const [targetId, inlineNodes] of inlineNodesByTarget) {
      const target = nodeById.get(targetId);
      const targetPosition = positionById.get(targetId);
      if (!target || !targetPosition) {
        continue;
      }

      const targetSize = sizeById.get(target.id) ?? workflowLayoutNodeSize(target);
      const orderedInlineNodes = [...inlineNodes].sort(compareWorkflowLayoutNodesByPosition);
      const totalHeight =
        orderedInlineNodes.length * inlineWorkflowNodeHeight +
        Math.max(0, orderedInlineNodes.length - 1) * workflowInlineAttachGap;
      const startY = targetPosition.y + targetSize.height / 2 - totalHeight / 2;

      orderedInlineNodes.forEach((node, index) => {
        positionById.set(node.id, {
          x: targetPosition.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
          y: startY + index * (inlineWorkflowNodeHeight + workflowInlineAttachGap),
        });
      });
    }
  }
}

function workflowLayoutEdges(edges: Edge[], nodeById: Map<string, WorkflowNodeModel>): WorkflowLayoutEdge[] {
  const seen = new Set<string>();
  const layoutEdges: WorkflowLayoutEdge[] = [];

  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) {
      continue;
    }
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    const key = `${edge.source}|${edge.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    layoutEdges.push({ source: edge.source, target: edge.target });
  }

  return layoutEdges;
}

function workflowLayoutRankEdges(
  edges: WorkflowLayoutEdge[],
  nodeById: Map<string, WorkflowNodeModel>,
): WorkflowLayoutEdge[] {
  const forwardEdges = edges.filter((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    return Boolean(source && target && target.position.x + workflowLayoutBackEdgeTolerance >= source.position.x);
  });
  return forwardEdges.length > 0 ? forwardEdges : edges;
}

function workflowLayoutRanks(nodes: WorkflowNodeModel[], edges: WorkflowLayoutEdge[]): Map<string, number> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const rankById = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort((left, right) => compareWorkflowLayoutNodeIds(left, right, nodeById));
  const processed = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (processed.has(id)) {
      continue;
    }
    processed.add(id);

    for (const target of outgoing.get(id) ?? []) {
      rankById.set(target, Math.max(rankById.get(target) ?? 0, (rankById.get(id) ?? 0) + 1));
      const nextIncomingCount = (incomingCount.get(target) ?? 0) - 1;
      incomingCount.set(target, nextIncomingCount);
      if (nextIncomingCount === 0) {
        queue.push(target);
        queue.sort((left, right) => compareWorkflowLayoutNodeIds(left, right, nodeById));
      }
    }
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const fallbackColumnWidth = defaultWorkflowNodeWidth + workflowLayoutColumnGap;
  for (const node of nodes) {
    if (processed.has(node.id)) {
      continue;
    }
    rankById.set(node.id, Math.max(0, Math.round((node.position.x - minX) / fallbackColumnWidth)));
  }

  return rankById;
}

function compactWorkflowLayoutRanks(rankById: Map<string, number>): Map<string, number> {
  const compactRankByValue = new Map(
    [...new Set([...rankById.values()])]
      .sort((left, right) => left - right)
      .map((rank, index) => [rank, index]),
  );
  return new Map([...rankById.entries()].map(([id, rank]) => [id, compactRankByValue.get(rank) ?? 0]));
}

function workflowLayoutColumns(
  nodes: WorkflowNodeModel[],
  rankById: Map<string, number>,
): WorkflowNodeModel[][] {
  const columnCount = Math.max(0, ...rankById.values()) + 1;
  const columns: WorkflowNodeModel[][] = Array.from({ length: columnCount }, () => []);

  for (const node of nodes) {
    columns[rankById.get(node.id) ?? 0].push(node);
  }

  return columns.map((column) => [...column].sort(compareWorkflowLayoutNodesByPosition));
}

function orderWorkflowLayoutColumns(
  columns: WorkflowNodeModel[][],
  edges: WorkflowLayoutEdge[],
): WorkflowNodeModel[][] {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const ordered = columns.map((column) => [...column]);
  let orderById = workflowLayoutOrderById(ordered);

  for (let pass = 0; pass < 3; pass += 1) {
    for (let columnIndex = 1; columnIndex < ordered.length; columnIndex += 1) {
      ordered[columnIndex].sort((left, right) =>
        compareWorkflowLayoutBarycenter(left, right, incoming, orderById),
      );
    }
    orderById = workflowLayoutOrderById(ordered);

    for (let columnIndex = ordered.length - 2; columnIndex >= 0; columnIndex -= 1) {
      ordered[columnIndex].sort((left, right) =>
        compareWorkflowLayoutBarycenter(left, right, outgoing, orderById),
      );
    }
    orderById = workflowLayoutOrderById(ordered);
  }

  return ordered;
}

function workflowLayoutOrderById(columns: WorkflowNodeModel[][]): Map<string, number> {
  const orderById = new Map<string, number>();
  for (const column of columns) {
    column.forEach((node, index) => orderById.set(node.id, index));
  }
  return orderById;
}

function compareWorkflowLayoutBarycenter(
  left: WorkflowNodeModel,
  right: WorkflowNodeModel,
  neighborsById: Map<string, string[]>,
  orderById: Map<string, number>,
): number {
  const leftCenter = workflowLayoutNeighborMedian(left.id, neighborsById, orderById);
  const rightCenter = workflowLayoutNeighborMedian(right.id, neighborsById, orderById);

  if (leftCenter !== null && rightCenter !== null && leftCenter !== rightCenter) {
    return leftCenter - rightCenter;
  }
  if (leftCenter !== null && rightCenter === null) {
    return -1;
  }
  if (leftCenter === null && rightCenter !== null) {
    return 1;
  }
  return compareWorkflowLayoutNodesByPosition(left, right);
}

function workflowLayoutNeighborMedian(
  nodeId: string,
  neighborsById: Map<string, string[]>,
  orderById: Map<string, number>,
): number | null {
  const neighborOrders = (neighborsById.get(nodeId) ?? [])
    .map((neighborId) => orderById.get(neighborId))
    .filter((order): order is number => order !== undefined)
    .sort((left, right) => left - right);

  if (neighborOrders.length === 0) {
    return null;
  }
  const middle = Math.floor(neighborOrders.length / 2);
  return neighborOrders.length % 2 === 1
    ? neighborOrders[middle]
    : (neighborOrders[middle - 1] + neighborOrders[middle]) / 2;
}

function compareWorkflowLayoutNodeIds(
  left: string,
  right: string,
  nodeById: Map<string, WorkflowNodeModel>,
): number {
  const leftNode = nodeById.get(left);
  const rightNode = nodeById.get(right);
  if (!leftNode || !rightNode) {
    return left.localeCompare(right);
  }
  return compareWorkflowLayoutNodesByPosition(leftNode, rightNode);
}

function compareWorkflowLayoutNodesByPosition(left: WorkflowNodeModel, right: WorkflowNodeModel): number {
  return left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id);
}

export function nextBlockAnchor(nodes: WorkflowNodeModel[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 80, y: 80 };
  }
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 420, y: Math.max(40, minY) };
}

export function connectedWorkflowNodePosition(
  sourceNode: WorkflowNodeModel,
  nodes: WorkflowNodeModel[],
  connectedNodeData?: WorkflowNodeData,
): { x: number; y: number } {
  const sourceSize = workflowLayoutNodeSize(sourceNode);
  const inlineTarget = connectedNodeData ? workflowNodeDataUsesInlineLayout(connectedNodeData) : false;
  const basePosition = inlineTarget
    ? {
        x: sourceNode.position.x + sourceSize.width + workflowInlineAttachGap,
        y: sourceNode.position.y + sourceSize.height / 2 - inlineWorkflowNodeHeight / 2,
      }
    : {
        x: sourceNode.position.x + sourceSize.width + 140,
        y: sourceNode.position.y,
      };
  return avoidOccupiedWorkflowPosition(basePosition, nodes);
}

function avoidOccupiedWorkflowPosition(position: { x: number; y: number }, nodes: WorkflowNodeModel[]): { x: number; y: number } {
  let y = position.y;
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const occupied = nodes.some(
      (node) => Math.abs(node.position.x - position.x) < 90 && Math.abs(node.position.y - y) < 90,
    );
    if (!occupied) {
      return { x: position.x, y };
    }
    y += 96;
  }
  return { x: position.x, y };
}
