import { isWorkflowTypeSpec } from "../workflowTypeSpec";
import { normalizeAdapterTransformSteps } from "./adapterTransforms";
import {
  categoryForWorkflowNodeData,
  normalizeWorkflowTags,
  workflowComponentCategory,
} from "./componentMetadata";
import {
  isDataSourceSchema,
  normalizeDataSourceSchema,
  workflowTypeForPortType,
} from "./dataSourceSchema";
import { isDataSourceType } from "./portTypes";
import type { FlowPort, WorkflowGroupMetadata, WorkflowNodeData } from "./types";

export function cloneWorkflowNodeData(data: WorkflowNodeData): WorkflowNodeData {
  const cloned: WorkflowNodeData = {
    title: data.title,
    packageName: data.packageName,
    description: data.description,
    category: workflowComponentCategory(data.category ?? categoryForWorkflowNodeData(data)),
    tone: data.tone,
    inputs: data.inputs.map(cloneFlowPort),
    outputs: data.outputs.map(cloneFlowPort),
  };
  if (data.tags) {
    cloned.tags = normalizeWorkflowTags(data.tags);
  }
  if (data.size) {
    cloned.size = { ...data.size };
  }
  if (data.kind) {
    cloned.kind = data.kind;
  }
  if (data.group) {
    cloned.group = cloneWorkflowGroupMetadata(data.group);
  }
  if (data.groupOpen) {
    cloned.groupOpen = true;
  }
  if (data.minimized) {
    cloned.minimized = true;
  }
  if (data.dataSourceNode) {
    cloned.dataSourceNode = true;
  }
  if (typeof data.dataSourceId === "string") {
    cloned.dataSourceId = data.dataSourceId;
  }
  if (isDataSourceType(data.dataSourceType)) {
    cloned.dataSourceType = data.dataSourceType;
  }
  if (data.adapterNode) {
    cloned.adapterNode = true;
  }
  if (isDataSourceSchema(data.adapterInputSchema)) {
    cloned.adapterInputSchema = normalizeDataSourceSchema(data.adapterInputSchema, { type: "any" });
  }
  if (isDataSourceSchema(data.adapterOutputSchema)) {
    cloned.adapterOutputSchema = normalizeDataSourceSchema(data.adapterOutputSchema, { type: "any" });
  }
  if (data.adapterNode || data.adapterSteps) {
    cloned.adapterSteps = normalizeAdapterTransformSteps(data.adapterSteps);
  }
  return cloned;
}

function cloneFlowPort(portValue: FlowPort): FlowPort {
  return normalizeFlowPort(portValue);
}

export function normalizeFlowPort(portValue: Pick<FlowPort, "id" | "label" | "type"> & Partial<FlowPort>): FlowPort {
  return {
    id: portValue.id,
    label: portValue.label,
    type: portValue.type,
    ...(portValue.kind ? { kind: portValue.kind } : {}),
    valueType: isWorkflowTypeSpec(portValue.valueType) ? structuredClone(portValue.valueType) : workflowTypeForPortType(portValue.type),
    ...(portValue.optional ? { optional: true } : {}),
    ...(portValue.stream ? { stream: true } : {}),
    ...(portValue.exposableInput ? { exposableInput: true } : {}),
    ...(portValue.inputSurface ? { inputSurface: portValue.inputSurface } : {}),
    ...(portValue.suggestedAdapters ? { suggestedAdapters: [...portValue.suggestedAdapters] } : {}),
    ...(portValue.runtimeValidation ? { runtimeValidation: portValue.runtimeValidation } : {}),
  };
}

function cloneWorkflowGroupMetadata(group: WorkflowGroupMetadata): WorkflowGroupMetadata {
  return {
    memberCount: group.memberCount,
    nodes: group.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: group.edges.map((edge) => ({ ...edge })),
    inputBoundaries: group.inputBoundaries.map((boundary) => ({ ...boundary })),
    outputBoundaries: group.outputBoundaries.map((boundary) => ({ ...boundary })),
  };
}
