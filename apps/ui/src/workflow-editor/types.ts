import type React from "react";
import { type Node, type Edge } from "@xyflow/react";
import {
  type VideoRedCarsRunRequest,
  type YoutubeCollectionRunRequest,
  type SongAnalysisRunRequest,
  type SubtitleGenerationRunRequest,
} from "../index";
import {
  type DashboardWidgetId,
  type DashboardDataKind,
  type DashboardLayout,
} from "../ResultPageEditor";
import {
  type WorkflowSemanticKind,
  type PortKind as RustPortKind,
  type WorkflowTypeSpec,
  type WorkflowInputSurface,
  type WorkflowRuntimeValidation,
  type RunStatus,
  type YoutubeRunRequest,
} from "../api/client";
import type { ImageSimilarityRunRequest, SourceMode, WorkflowKindId } from "../run/types";

type JsonSchemaScalar = "number" | "boolean" | "null" | "any";

export type DataSourceSchema =
  | { type: "port"; portType: DataSourceType }
  | { type: "string"; semantic?: WorkflowSemanticKind }
  | { type: "binary"; mediaType: string; portType: DataSourceType; semantic?: WorkflowSemanticKind }
  | { type: "array"; items: DataSourceSchema; minItems?: number; maxItems?: number }
  | {
      type: "object";
      properties: DataSourceSchemaProperty[];
      additionalProperties?: boolean;
      additionalPropertySchema?: DataSourceSchema;
      semantic?: WorkflowSemanticKind;
    }
  | { type: "union"; variants: DataSourceSchema[] }
  | { type: JsonSchemaScalar };

export interface DataSourceSchemaProperty {
  id: string;
  name: string;
  schema: DataSourceSchema;
  required: boolean;
}

export type AdapterOperationKind = "map" | "filter" | "reduce" | "flat_map" | "group_by" | "pick" | "omit" | "custom";

export interface AdapterTransformStep {
  id: string;
  operation: AdapterOperationKind;
  expression: string;
  enabled?: boolean;
}

export type PortDirection = "in" | "out";

export type FlowTone = "sky" | "rose" | "amber" | "emerald" | "violet" | "cyan" | "indigo" | "fuchsia" | "slate" | "zinc";

export type WorkflowComponentCategory =
  | "Application"
  | "Input"
  | "API"
  | "Pipeline"
  | "Ingest"
  | "Detection"
  | "Models"
  | "Audio"
  | "Text"
  | "Data"
  | "Report"
  | "Dashboard"
  | "Output"
  | "Generator"
  | "Control Flow"
  | "Reusable";

export type WorkflowBlockCategoryDraft = WorkflowComponentCategory | "Auto";

type PortPresentationKind =
  | "run_request"
  | "run_config"
  | "template_string"
  | "string_value"
  | "number_value"
  | "boolean_value"
  | "array_value"
  | "youtube_url"
  | "youtube_collection_url"
  | "video_file"
  | "image_file"
  | "image_batch"
  | "audio_file"
  | "audio_waveform"
  | "media_file"
  | "mask_tensor"
  | "latent_batch"
  | "conditioning"
  | "model_ref"
  | "vae_ref"
  | "clip_ref"
  | "clip_vision_ref"
  | "upscale_model_ref"
  | "model_patch_ref"
  | "transcript"
  | "subtitle_file"
  | "collection_manifest"
  | "collection_item"
  | "collection_report"
  | "collection_table"
  | "video_metadata"
  | "video_frame"
  | "audio_frame"
  | "audio_wav"
  | "song_fingerprint"
  | "song_match"
  | "music_feature"
  | "scene_result"
  | "video_observation"
  | "model_request"
  | "model_prediction"
  | "transcript_segment"
  | "audio_event"
  | "text_event"
  | "http_request"
  | "http_response"
  | "object_value"
  | "data_value"
  | "data_record"
  | "data_bucket"
  | "json_report"
  | "dashboard_view"
  | "song_catalog";

export type PortType = PortPresentationKind;

export type DataSourceType = PortPresentationKind;

export interface FlowPort {
  id: string;
  label: string;
  type: PortType;
  kind?: RustPortKind;
  valueType: WorkflowTypeSpec;
  optional?: boolean;
  stream?: boolean;
  exposableInput?: boolean;
  inputSurface?: WorkflowInputSurface;
  suggestedAdapters?: string[];
  runtimeValidation?: WorkflowRuntimeValidation;
}

export type FlowPortOptions = Pick<
  FlowPort,
  "optional" | "stream" | "kind" | "exposableInput" | "inputSurface" | "suggestedAdapters" | "runtimeValidation"
> & { valueType?: WorkflowTypeSpec };

export interface WorkflowNodeSize {
  width: number;
  height: number;
}

export interface WorkflowRunInput {
  key: string;
  nodeId: string;
  nodeTitle: string;
  port: FlowPort;
  source: "open" | "provider";
}

export interface WorkflowRunInputModel {
  inputs: WorkflowRunInput[];
  sourceModes: SourceMode[];
  configInputs: WorkflowRunInput[];
  openInputs: WorkflowRunInput[];
  genericInputs: WorkflowRunInput[];
}

export interface WorkflowFocusTarget {
  workflowId: string;
  nodeId: string;
  direction: PortDirection;
  portId: string;
  portType: PortType;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  title: string;
  packageName: string;
  description: string;
  category?: WorkflowComponentCategory;
  tone: FlowTone;
  inputs: FlowPort[];
  outputs: FlowPort[];
  tags?: string[];
  size?: WorkflowNodeSize;
  kind?: "step" | "group";
  group?: WorkflowGroupMetadata;
  groupOpen?: boolean;
  minimized?: boolean;
  dataSourceNode?: boolean;
  dataSourceId?: string;
  dataSourceType?: DataSourceType;
  adapterNode?: boolean;
  adapterInputSchema?: DataSourceSchema;
  adapterOutputSchema?: DataSourceSchema;
  adapterSteps?: AdapterTransformStep[];
}

export type WorkflowNodeModel = Node<WorkflowNodeData, "workflow">;

export interface SavedWorkflowBlockNode {
  id: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface SavedWorkflowBlockEdge {
  source: string;
  target: string;
  sourceHandle: string | null | undefined;
  targetHandle: string | null | undefined;
}

export interface SavedWorkflowBlock {
  id: string;
  name: string;
  createdAt: string;
  kind?: WorkflowKindId;
  category?: WorkflowComponentCategory;
  tags?: string[];
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowComponentDraft {
  blockId: string;
  blockName: string;
}

export interface SavedWorkflowFile {
  format: string;
  version: number;
  lastUpdated: string;
  workflowName?: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  resultPanel?: WorkflowResultPanel;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

export type ResultPanelSourceKind = "completed_report" | "workflow_output" | "workspace_data_source";

export interface ResultPanelSourceBinding {
  componentId: DashboardWidgetId;
  dataKind: DashboardDataKind;
  sourceKind: ResultPanelSourceKind;
  nodeId?: string;
  portId?: string;
  dataSourceId?: string;
  reportPath?: string;
}

export interface WorkflowResultPanel {
  name: string;
  layout: DashboardLayout;
  bindings: ResultPanelSourceBinding[];
}

export interface SavedWorkflowVersion {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

export interface SavedWorkflow {
  id: string;
  kind: WorkflowKindId;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  versions: SavedWorkflowVersion[];
  componentDraft?: SavedWorkflowComponentDraft;
  resultPanel?: WorkflowResultPanel;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

export interface SavedWorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  inputSummary: string;
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest | ImageSimilarityRunRequest;
  backendRunId?: string;
  reportPath?: string;
  message?: string | null;
}

export interface SavedWorkflowLibrary {
  format: "video-analysis.workflows";
  version: 1;
  activeWorkflowId: string;
  workflows: SavedWorkflow[];
}

export interface WorkflowGroupBoundary {
  wrapperPortId: string;
  nodeId: string;
  handle: string | null | undefined;
  type: PortType;
  stream?: boolean;
}

export interface WorkflowGroupMetadata {
  memberCount: number;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
  inputBoundaries: WorkflowGroupBoundary[];
  outputBoundaries: WorkflowGroupBoundary[];
}

export interface WorkflowContextMenuState {
  x: number;
  y: number;
  nodeIds: string[];
}

export interface WorkflowOutputConnectorMenuState {
  x: number;
  y: number;
  sourceNodeId: string;
  sourceHandle: string;
  sourcePort: FlowPort;
}

export interface WorkflowBlockOpenInput {
  nodeId: string;
  nodeTitle: string;
  port: FlowPort;
}

export interface WorkflowPrimitiveConnectorTarget {
  template: WorkflowNodeModel;
  input: FlowPort;
}

export interface WorkflowSavedBlockConnectorTarget {
  block: SavedWorkflowBlock;
  input: WorkflowBlockOpenInput;
}

export interface WorkflowOutputConnectorContextValue {
  onOutputDoubleClick: (event: React.MouseEvent, nodeId: string, portValue: FlowPort) => void;
}

export type WorkflowComponentDragPayload =
  | { type: "primitive"; id: string }
  | { type: "block"; id: string };

export type PortTypeColors = Record<PortType, string>;

export type PortTypeColorStyle = React.CSSProperties & Record<`--workflow-port-color-${PortType}`, string>;

export type HotkeyActionId =
  | "copySelection"
  | "pasteSelection"
  | "deleteSelection"
  | "saveWorkflowVersion"
  | "groupSelection"
  | "ungroupSelection";

export interface HotkeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export type HotkeyBindings = Record<HotkeyActionId, HotkeyBinding>;

export interface WorkflowClipboardState {
  block: SavedWorkflowBlock;
  anchor: { x: number; y: number };
  pasteCount: number;
}

export interface WorkflowLayoutEdge {
  source: string;
  target: string;
}

export interface WorkflowSeedNodeLayout {
  id: string;
  x: number;
  y: number;
}

interface WorkflowSeedEdgeLayout {
  source: string;
  sourcePortId: string;
  target: string;
  targetPortId: string;
}

export interface WorkflowSeedTemplate {
  nodes: WorkflowSeedNodeLayout[];
  edges: WorkflowSeedEdgeLayout[];
}

export interface WorkflowSeedDefinitionsFile {
  starterTemplates: Record<string, WorkflowSeedTemplate>;
  basicTestTemplates: Record<string, WorkflowSeedTemplate>;
  exampleStarterTemplates: Record<string, WorkflowSeedTemplate>;
}

export interface WorkflowLayoutSize {
  width: number;
  height: number;
}

export interface WorkflowInlineAttachment {
  edge: Edge;
  position: { x: number; y: number };
}
