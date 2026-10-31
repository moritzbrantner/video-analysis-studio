import { isWorkflowTypeSpec } from "../workflowTypeSpec";
import { isWorkflowKindId } from "../run/workflowKinds";
import { isRecord } from "../shared/utils";
import { isAdapterTransformStep } from "./adapterTransforms";
import { savedWorkflowsJsonFormat, savedWorkflowsJsonVersion } from "./constants";
import { isDataSourceSchema } from "./dataSourceSchema";
import { isDataSourceType, isPortType } from "./portTypes";
import type {
  FlowPort,
  FlowTone,
  SavedWorkflow,
  SavedWorkflowBlock,
  SavedWorkflowBlockEdge,
  SavedWorkflowBlockNode,
  SavedWorkflowFile,
  SavedWorkflowLibrary,
  SavedWorkflowVersion,
  WorkflowComponentCategory,
  WorkflowComponentDragPayload,
  WorkflowGroupBoundary,
  WorkflowGroupMetadata,
  WorkflowNodeData,
  WorkflowNodeSize,
} from "./types";

export function isSavedWorkflowBlock(value: unknown): value is SavedWorkflowBlock {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.kind === undefined || isWorkflowKindId(value.kind)) &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    (value.category === undefined || isWorkflowComponentCategory(value.category)) &&
    (value.tags === undefined || isWorkflowTags(value.tags)) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflow(value: unknown): value is SavedWorkflow {
  if (!isRecord(value)) {
    return false;
  }
  const versionValid = value.version === undefined || typeof value.version === "number";
  const versionsValid =
    value.versions === undefined ||
    (Array.isArray(value.versions) && value.versions.every(isSavedWorkflowVersion));
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    versionValid &&
    versionsValid &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflowVersion(value: unknown): value is SavedWorkflowVersion {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

export function isSavedWorkflowLibrary(value: unknown): value is SavedWorkflowLibrary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.format === savedWorkflowsJsonFormat &&
    value.version === savedWorkflowsJsonVersion &&
    typeof value.activeWorkflowId === "string" &&
    Array.isArray(value.workflows) &&
    value.workflows.every(isSavedWorkflow)
  );
}

export function isSavedWorkflowFile(value: unknown): value is SavedWorkflowFile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.format === "string" &&
    typeof value.version === "number" &&
    typeof value.lastUpdated === "string" &&
    (value.workflowName === undefined || typeof value.workflowName === "string") &&
    (value.workflowKind === undefined || isWorkflowKindId(value.workflowKind)) &&
    (value.workflowVersion === undefined || typeof value.workflowVersion === "number") &&
    (value.resultPanel === undefined || isRecord(value.resultPanel)) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflowBlockNode(value: unknown): value is SavedWorkflowBlockNode {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.position)) {
    return false;
  }
  return (
    typeof value.position.x === "number" &&
    typeof value.position.y === "number" &&
    isWorkflowNodeData(value.data)
  );
}

function isSavedWorkflowBlockEdge(value: unknown): value is SavedWorkflowBlockEdge {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.target !== "string") {
    return false;
  }
  const sourceHandleValid =
    value.sourceHandle === null || value.sourceHandle === undefined || typeof value.sourceHandle === "string";
  const targetHandleValid =
    value.targetHandle === null || value.targetHandle === undefined || typeof value.targetHandle === "string";
  return sourceHandleValid && targetHandleValid;
}

function isWorkflowNodeData(value: unknown): value is WorkflowNodeData {
  if (!isRecord(value)) {
    return false;
  }
  const kindValid = value.kind === undefined || value.kind === "step" || value.kind === "group";
  const groupValid = value.group === undefined || isWorkflowGroupMetadata(value.group);
  const groupOpenValid = value.groupOpen === undefined || typeof value.groupOpen === "boolean";
  const minimizedValid = value.minimized === undefined || typeof value.minimized === "boolean";
  const categoryValid = value.category === undefined || isWorkflowComponentCategory(value.category);
  const tagsValid = value.tags === undefined || isWorkflowTags(value.tags);
  const sizeValid = value.size === undefined || isWorkflowNodeSize(value.size);
  const dataSourceNodeValid = value.dataSourceNode === undefined || typeof value.dataSourceNode === "boolean";
  const dataSourceIdValid = value.dataSourceId === undefined || typeof value.dataSourceId === "string";
  const dataSourceTypeValid = value.dataSourceType === undefined || isDataSourceType(value.dataSourceType);
  const adapterNodeValid = value.adapterNode === undefined || typeof value.adapterNode === "boolean";
  const adapterInputSchemaValid = value.adapterInputSchema === undefined || isDataSourceSchema(value.adapterInputSchema);
  const adapterOutputSchemaValid = value.adapterOutputSchema === undefined || isDataSourceSchema(value.adapterOutputSchema);
  const adapterStepsValid =
    value.adapterSteps === undefined ||
    (Array.isArray(value.adapterSteps) && value.adapterSteps.every(isAdapterTransformStep));
  return (
    typeof value.title === "string" &&
    typeof value.packageName === "string" &&
    typeof value.description === "string" &&
    categoryValid &&
    isFlowTone(value.tone) &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isFlowPort) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isFlowPort) &&
    tagsValid &&
    sizeValid &&
    kindValid &&
    groupValid &&
    groupOpenValid &&
    minimizedValid &&
    dataSourceNodeValid &&
    dataSourceIdValid &&
    dataSourceTypeValid &&
    adapterNodeValid &&
    adapterInputSchemaValid &&
    adapterOutputSchemaValid &&
    adapterStepsValid
  );
}

function isWorkflowGroupMetadata(value: unknown): value is WorkflowGroupMetadata {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.memberCount === "number" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge) &&
    Array.isArray(value.inputBoundaries) &&
    value.inputBoundaries.every(isWorkflowGroupBoundary) &&
    Array.isArray(value.outputBoundaries) &&
    value.outputBoundaries.every(isWorkflowGroupBoundary)
  );
}

function isWorkflowGroupBoundary(value: unknown): value is WorkflowGroupBoundary {
  if (!isRecord(value)) {
    return false;
  }
  const handleValid = value.handle === null || value.handle === undefined || typeof value.handle === "string";
  const streamValid = value.stream === undefined || typeof value.stream === "boolean";
  return (
    typeof value.wrapperPortId === "string" &&
    typeof value.nodeId === "string" &&
    handleValid &&
    typeof value.type === "string" &&
    isPortType(value.type) &&
    streamValid
  );
}

function isFlowPort(value: unknown): value is FlowPort {
  const streamValid = isRecord(value) && (value.stream === undefined || typeof value.stream === "boolean");
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.type === "string" &&
    isPortType(value.type) &&
    (value.kind === undefined || typeof value.kind === "string") &&
    (value.valueType === undefined || isWorkflowTypeSpec(value.valueType)) &&
    (value.optional === undefined || typeof value.optional === "boolean") &&
    (value.exposableInput === undefined || typeof value.exposableInput === "boolean") &&
    (value.inputSurface === undefined || typeof value.inputSurface === "string") &&
    (value.suggestedAdapters === undefined ||
      (Array.isArray(value.suggestedAdapters) && value.suggestedAdapters.every((adapter) => typeof adapter === "string"))) &&
    (value.runtimeValidation === undefined || typeof value.runtimeValidation === "string") &&
    streamValid
  );
}

export function isWorkflowComponentCategory(value: unknown): value is WorkflowComponentCategory {
  return (
    value === "Application" ||
    value === "Input" ||
    value === "API" ||
    value === "Pipeline" ||
    value === "Ingest" ||
    value === "Detection" ||
    value === "Models" ||
    value === "Audio" ||
    value === "Text" ||
    value === "Data" ||
    value === "Report" ||
    value === "Dashboard" ||
    value === "Output" ||
    value === "Generator" ||
    value === "Control Flow" ||
    value === "Reusable"
  );
}

function isWorkflowTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === "string");
}

function isWorkflowNodeSize(value: unknown): value is WorkflowNodeSize {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
  );
}

function isFlowTone(value: unknown): value is FlowTone {
  return (
    value === "sky" ||
    value === "rose" ||
    value === "amber" ||
    value === "emerald" ||
    value === "violet" ||
    value === "cyan" ||
    value === "indigo" ||
    value === "fuchsia" ||
    value === "slate" ||
    value === "zinc"
  );
}

export function parseWorkflowComponentDragPayload(value: string): WorkflowComponentDragPayload | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.id !== "string") {
      return null;
    }
    if (parsed.type === "primitive" || parsed.type === "block") {
      return { type: parsed.type, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}
