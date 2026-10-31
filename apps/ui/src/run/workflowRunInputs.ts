import { type WorkflowInputSurface } from "../api/client";
import type { SourceMode, WorkflowRunForm } from "./types";
import { handleId } from "../workflow-editor/ports";
import type {
  FlowPort,
  SavedWorkflow,
  SavedWorkflowBlockNode,
  WorkflowFocusTarget,
  WorkflowRunInput,
  WorkflowRunInputModel,
} from "../workflow-editor/types";

export function deriveWorkflowRunInputModel(workflow: SavedWorkflow): WorkflowRunInputModel {
  const incomingHandles = new Set(
    workflow.edges
      .filter((edge) => edge.targetHandle)
      .map((edge) => `${edge.target}:${edge.targetHandle}`),
  );
  const incomingNodes = new Set(workflow.edges.map((edge) => edge.target));
  const inputs: WorkflowRunInput[] = [];
  const seen = new Set<string>();

  const addInput = (
    node: SavedWorkflowBlockNode,
    portValue: FlowPort,
    source: WorkflowRunInput["source"],
  ) => {
    const key = `${node.id}:${handleId(source === "open" ? "in" : "out", portValue)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    inputs.push({
      key,
      nodeId: node.id,
      nodeTitle: node.data.title,
      port: portValue,
      source,
    });
  };

  for (const node of workflow.nodes) {
    for (const input of node.data.inputs) {
      if (!incomingHandles.has(`${node.id}:${handleId("in", input)}`)) {
        addInput(node, input, "open");
      }
    }
  }

  for (const node of workflow.nodes) {
    if (!isWorkflowInputProviderNode(node, incomingNodes)) {
      continue;
    }
    for (const output of node.data.outputs) {
      if (output.exposableInput) {
        addInput(node, output, "provider");
      }
    }
  }

  const sourceModes = inputs.reduce<SourceMode[]>((modes, input) => {
    const mode = sourceModeForWorkflowInput(input.port);
    if (mode && !modes.includes(mode)) {
      modes.push(mode);
    }
    return modes;
  }, []);

  const configInputs = inputs.filter((input) => workflowInputSurface(input.port) === "config");

  return {
    inputs,
    sourceModes,
    configInputs,
    openInputs: inputs.filter((input) => input.source === "open"),
    genericInputs: inputs.filter(
      (input) => input.source === "open" && workflowInputSurface(input.port) === "generic",
    ),
  };
}

export function workflowRunInputForSurface(inputModel: WorkflowRunInputModel, surface: WorkflowInputSurface): WorkflowRunInput | null {
  return (
    inputModel.inputs.find((input) => input.source === "open" && workflowInputSurface(input.port) === surface) ??
    inputModel.inputs.find((input) => workflowInputSurface(input.port) === surface) ??
    null
  );
}

export function workflowInputFieldLabel(label: string, input: WorkflowRunInput | null): string {
  if (!input) {
    return label;
  }
  return `${label} {${input.nodeTitle}}${input.port.optional ? " (optional)" : ""}`;
}

export function workflowFocusTargetKey(target: WorkflowFocusTarget): string {
  return `${target.workflowId}:${target.nodeId}:${target.direction}:${target.portId}:${target.portType}`;
}

function isWorkflowInputProviderNode(node: SavedWorkflowBlockNode, incomingNodes: Set<string>): boolean {
  return !incomingNodes.has(node.id) && node.data.outputs.some((output) => output.exposableInput);
}

function sourceModeForWorkflowInput(portValue: FlowPort): SourceMode | null {
  switch (workflowInputSurface(portValue)) {
    case "source_url":
      return "url";
    case "collection_url":
      return "collection";
    case "file":
      return "file";
    default:
      return null;
  }
}

function workflowInputSurface(portValue: FlowPort): WorkflowInputSurface {
  if (portValue.inputSurface) {
    return portValue.inputSurface;
  }
  switch (portValue.valueType.type) {
    case "string":
      if (portValue.valueType.semantic === "youtube_url") {
        return "source_url";
      }
      if (portValue.valueType.semantic === "youtube_collection_url") {
        return "collection_url";
      }
      return "generic";
    case "binary":
      if (portValue.valueType.semantic === "video_file" || portValue.valueType.semantic === "media_file") {
        return "file";
      }
      return "generic";
    case "object":
      return portValue.valueType.semantic === "run_config" || portValue.kind === "run_config" || portValue.type === "run_config"
        ? "config"
        : "generic";
    default:
      return "generic";
  }
}

export function effectiveSourceMode(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SourceMode {
  const sourceModes = inputModel?.sourceModes.length ? inputModel.sourceModes : (["url", "file"] as SourceMode[]);
  return sourceModes.includes(form.sourceMode) ? form.sourceMode : sourceModes[0] ?? form.sourceMode;
}
