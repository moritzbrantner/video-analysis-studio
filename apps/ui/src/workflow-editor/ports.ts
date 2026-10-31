import { type WorkflowTypeSpec, type PortSpec as RustPortSpec } from "../api/client";
import {
  isWorkflowTypeSpec,
  workflowTypesAssignable,
  formatWorkflowTypeSpec,
  workflowTypeSignature,
} from "../workflowTypeSpec";
import { workflowTypeForPortType, workflowTypeToPortType } from "./dataSourceSchema";
import { isPortType } from "./portTypes";
import type {
  FlowPort,
  FlowPortOptions,
  PortDirection,
  PortType,
  WorkflowNodeModel,
} from "./types";

function defaultSuggestedAdaptersForType(spec: WorkflowTypeSpec): string[] {
  switch (spec.type) {
    case "object":
      return ["object-adapter", "data-adapter"];
    case "array":
    case "union":
    case "any":
      return ["data-adapter"];
    default:
      return [];
  }
}

export function rustPortSpecToFlowPort(spec: RustPortSpec): FlowPort | null {
  const fallbackType = rustPortKindToPortType(spec.kind);
  if (!fallbackType) {
    return null;
  }
  const valueType = isWorkflowTypeSpec(spec.value_type) ? spec.value_type : workflowTypeForPortType(fallbackType);
  const type = workflowTypeToPortType(valueType, fallbackType);
  return port(spec.id, spec.label, type, {
    kind: spec.kind,
    optional: Boolean(spec.optional),
    stream: Boolean(spec.stream),
    valueType,
    exposableInput: Boolean(spec.exposable_input),
    inputSurface: spec.input_surface,
    suggestedAdapters:
      Array.isArray(spec.suggested_adapters) && spec.suggested_adapters.length > 0
        ? spec.suggested_adapters
        : defaultSuggestedAdaptersForType(valueType),
    runtimeValidation: spec.runtime_validation,
  });
}

function rustPortKindToPortType(kind: RustPortSpec["kind"]): PortType | null {
  const mapped: Partial<Record<RustPortSpec["kind"], PortType>> = {
    run_trigger: "run_request",
    run_config: "run_config",
    youtube_url: "youtube_url",
    youtube_collection_url: "youtube_collection_url",
    video_file: "video_file",
    image_file: "image_file",
    image_batch: "image_batch",
    audio_file: "audio_file",
    audio_waveform: "audio_waveform",
    media_file: "media_file",
    mask_tensor: "mask_tensor",
    latent_batch: "latent_batch",
    conditioning: "conditioning",
    model_ref: "model_ref",
    vae_ref: "vae_ref",
    clip_ref: "clip_ref",
    clip_vision_ref: "clip_vision_ref",
    upscale_model_ref: "upscale_model_ref",
    model_patch_ref: "model_patch_ref",
    transcript: "transcript",
    subtitle_file: "subtitle_file",
    scene_list: "scene_result",
    observation_list: "video_observation",
    audio_events: "audio_event",
    text_events: "text_event",
    data_buckets: "data_bucket",
    json_report: "json_report",
    collection_manifest: "collection_manifest",
    collection_items: "collection_item",
    song_fingerprint: "song_fingerprint",
    song_catalog: "song_catalog",
    song_matches: "song_match",
    music_features: "music_feature",
    template_string: "template_string",
    string: "string_value",
    number: "number_value",
    boolean: "boolean_value",
    array: "array_value",
    object: "object_value",
    http_request: "http_request",
    http_response: "http_response",
  };
  return mapped[kind] ?? null;
}

export function port(id: string, label: string, type: PortType, options: FlowPortOptions = {}): FlowPort {
  const valueType = options.valueType ?? workflowTypeForPortType(type);
  return {
    id,
    label,
    type,
    ...(options.kind ? { kind: options.kind } : {}),
    valueType,
    ...(options.optional ? { optional: true } : {}),
    ...(options.stream ? { stream: true } : {}),
    ...(options.exposableInput ? { exposableInput: true } : {}),
    ...(options.inputSurface ? { inputSurface: options.inputSurface } : {}),
    suggestedAdapters: [...(options.suggestedAdapters ?? defaultSuggestedAdaptersForType(valueType))],
    ...(options.runtimeValidation ? { runtimeValidation: options.runtimeValidation } : {}),
  };
}

export function portsCompatible(sourcePort: FlowPort, targetPort: FlowPort): boolean {
  const streamConnection = portIsStream(sourcePort) || portIsStream(targetPort);
  if (streamConnection) {
    return portIsStream(sourcePort) && portIsStream(targetPort) && workflowTypesAssignable(sourcePort.valueType, targetPort.valueType);
  }
  return workflowTypesAssignable(sourcePort.valueType, targetPort.valueType);
}

export function portIsStream(portValue: FlowPort): boolean {
  return portValue.stream === true;
}

export function findPort(
  nodes: WorkflowNodeModel[],
  nodeId: string | null,
  handle: string | null | undefined,
  direction: PortDirection,
): FlowPort | null {
  if (!nodeId || !handle) {
    return null;
  }
  const parsed = parseHandleId(handle);
  if (!parsed || parsed.direction !== direction) {
    return null;
  }
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const ports = direction === "in" ? node?.data.inputs : node?.data.outputs;
  return (
    ports?.find(
      (portCandidate) =>
        portCandidate.id === parsed.portId &&
        (handleSignature(portCandidate) === parsed.signature ||
          (parsed.legacyType !== undefined && portCandidate.type === parsed.legacyType)),
    ) ?? null
  );
}

export function handleId(direction: PortDirection, portValue: FlowPort): string {
  return `${direction}|${portValue.id}|${handleSignature(portValue)}`;
}

export function parseHandleId(handle: string): { direction: PortDirection; portId: string; signature: string; legacyType?: PortType } | null {
  const [direction, portId, ...signatureParts] = handle.split("|");
  const signature = signatureParts.join("|");
  if ((direction !== "in" && direction !== "out") || !portId || !signature) {
    return null;
  }
  return {
    direction,
    portId,
    signature,
    ...(isPortType(signature) ? { legacyType: signature } : {}),
  };
}

export function formatFlowPortType(portValue: FlowPort): string {
  return formatWorkflowTypeSpec(portValue.valueType, portIsStream(portValue));
}

export function handleSignature(portValue: FlowPort): string {
  return workflowTypeSignature(portValue.valueType, portIsStream(portValue));
}
