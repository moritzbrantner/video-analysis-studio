import { type Connection, type Edge, MarkerType } from "@xyflow/react";
import { workflowGraphWouldCreateCycle } from "../workflowGraph";
import { portTypeColorVar } from "./portColors";
import { findPort, formatFlowPortType, portIsStream, portsCompatible } from "./ports";
import { formatPortType } from "./portTypes";
import type { FlowPort, PortType, WorkflowNodeModel } from "./types";

export function workflowEdgeFromConnection(connection: Connection | Edge, portValue: FlowPort | PortType): Edge {
  const type = typeof portValue === "string" ? portValue : portValue.type;
  const stream = typeof portValue === "string" ? false : portIsStream(portValue);
  return {
    id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
    source: connection.source ?? "",
    target: connection.target ?? "",
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    label: typeof portValue === "string" ? formatPortType(type, stream) : formatFlowPortType(portValue),
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: portTypeColorVar(type) },
    style: { stroke: portTypeColorVar(type), strokeWidth: 1.7 },
    labelStyle: { fill: "#3f3f46", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
  };
}

export function compatibleConnection(nodes: WorkflowNodeModel[], connection: Connection | Edge): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return false;
  }
  const sourcePort = findPort(nodes, connection.source, connection.sourceHandle, "out");
  const targetPort = findPort(nodes, connection.target, connection.targetHandle, "in");
  return Boolean(sourcePort && targetPort && portsCompatible(sourcePort, targetPort));
}

export function connectionCreatesLoop(
  edges: Edge[],
  connection: Pick<Connection, "source" | "target">,
  ignoredEdgeId?: string | null,
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }
  return workflowGraphWouldCreateCycle(
    edges,
    { source: connection.source, target: connection.target },
    { ignoreEdgeId: ignoredEdgeId },
  );
}

export function connectionMismatchMessage(sourcePort: FlowPort | null, targetPort: FlowPort | null): string {
  if (!sourcePort || !targetPort) {
    return "Connection is invalid for the selected handles.";
  }
  const suggestions = [...(targetPort.suggestedAdapters ?? []), ...(sourcePort.suggestedAdapters ?? [])];
  return `${sourcePort.label} emits ${formatFlowPortType(sourcePort)}, but ${targetPort.label} expects ${formatFlowPortType(targetPort)}.${suggestions.length > 0 ? ` Try ${[...new Set(suggestions)].join(", ")}.` : ""}`;
}

export function connectionLoopMessage(nodes: WorkflowNodeModel[], connection: Pick<Connection, "source" | "target">): string {
  const sourceTitle = nodes.find((node) => node.id === connection.source)?.data.title ?? "This component";
  const targetTitle = nodes.find((node) => node.id === connection.target)?.data.title ?? "that component";
  return `Connecting ${sourceTitle} to ${targetTitle} would create a workflow loop. Keep workflows acyclic and use For Each Item or While Loop for intentional iteration.`;
}
