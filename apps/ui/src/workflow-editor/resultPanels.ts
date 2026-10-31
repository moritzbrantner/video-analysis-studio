import {
  type ReportKind,
  defaultDashboardLayoutForReportKind,
  sanitizeDashboardLayout,
  dashboardWidgetOptionsForReportKind,
  type DashboardLayout,
  type DashboardWidgetId,
  type DashboardDataKind,
  type DashboardWidgetBindingSummary,
} from "../ResultPageEditor";
import { type TypeDefinition } from "../type-library/page";
import { type WorkflowTypeSpec } from "../api/client";
import { workflowTypeSignature } from "../workflowTypeSpec";
import type { DataSourceEntry, WorkflowKindId } from "../run/types";
import { isRecord } from "../shared/utils";
import { workflowTypeToPortType } from "./dataSourceSchema";
import type {
  PortType,
  ResultPanelSourceBinding,
  ResultPanelSourceKind,
  WorkflowNodeModel,
  WorkflowResultPanel,
} from "./types";

export function workflowReportKind(kind: WorkflowKindId): ReportKind {
  switch (kind) {
    case "youtube-collection":
      return "youtube-collection";
    case "song-analysis":
      return "song-analysis";
    case "subtitle-generation":
      return "subtitle-generation";
    case "image-similarity":
      return "youtube-video";
    case "video-red-cars":
    case "youtube-video":
      return "youtube-video";
  }
}

export function defaultWorkflowResultPanel(kind: WorkflowKindId, workflowName = "Workflow"): WorkflowResultPanel {
  return {
    name: `${workflowName} Results`,
    layout: defaultDashboardLayoutForReportKind(workflowReportKind(kind)),
    bindings: [],
  };
}

export function normalizeWorkflowResultPanel(
  value: unknown,
  kind: WorkflowKindId,
  workflowName = "Workflow",
): WorkflowResultPanel {
  const fallback = defaultWorkflowResultPanel(kind, workflowName);
  if (!isRecord(value)) {
    return fallback;
  }
  const reportKind = workflowReportKind(kind);
  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallback.name,
    layout: isDashboardLayout(value.layout)
      ? sanitizeDashboardLayout(value.layout, reportKind)
      : fallback.layout,
    bindings: Array.isArray(value.bindings)
      ? value.bindings.flatMap((binding) => normalizeResultPanelBinding(binding, reportKind))
      : [],
  };
}

function normalizeResultPanelBinding(value: unknown, reportKind: ReportKind): ResultPanelSourceBinding[] {
  if (!isRecord(value) || !isDashboardWidgetId(value.componentId) || !isDashboardDataKind(value.dataKind)) {
    return [];
  }
  const option = dashboardWidgetOptionsForReportKind(reportKind).find((candidate) => candidate.id === value.componentId);
  if (!option?.dataKinds.includes(value.dataKind)) {
    return [];
  }
  const sourceKind = isResultPanelSourceKind(value.sourceKind) ? value.sourceKind : "completed_report";
  return [
    {
      componentId: value.componentId,
      dataKind: value.dataKind,
      sourceKind,
      ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
      ...(typeof value.portId === "string" ? { portId: value.portId } : {}),
      ...(typeof value.dataSourceId === "string" ? { dataSourceId: value.dataSourceId } : {}),
      ...(typeof value.reportPath === "string" ? { reportPath: value.reportPath } : {}),
    },
  ];
}

export function cloneWorkflowResultPanel(panel: WorkflowResultPanel | undefined, kind: WorkflowKindId, workflowName: string): WorkflowResultPanel {
  const normalized = normalizeWorkflowResultPanel(panel, kind, workflowName);
  return {
    name: normalized.name,
    layout: structuredClone(normalized.layout),
    bindings: normalized.bindings.map((binding) => ({ ...binding })),
  };
}

function isDashboardLayout(value: unknown): value is DashboardLayout {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "widget") {
    return isDashboardWidgetId(value.id);
  }
  return (
    value.type === "split" &&
    typeof value.id === "string" &&
    (value.direction === "row" || value.direction === "column") &&
    Array.isArray(value.sizes) &&
    value.sizes.every((size) => typeof size === "number") &&
    Array.isArray(value.children) &&
    value.children.length > 0 &&
    value.children.every(isDashboardLayout)
  );
}

function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === "string" && dashboardWidgetOptionsForReportKind("youtube-video")
    .concat(dashboardWidgetOptionsForReportKind("youtube-collection"))
    .concat(dashboardWidgetOptionsForReportKind("song-analysis"))
    .concat(dashboardWidgetOptionsForReportKind("subtitle-generation"))
    .some((option) => option.id === value);
}

function isDashboardDataKind(value: unknown): value is DashboardDataKind {
  return (
    typeof value === "string" &&
    dashboardWidgetOptionsForReportKind("youtube-video")
      .concat(dashboardWidgetOptionsForReportKind("youtube-collection"))
      .concat(dashboardWidgetOptionsForReportKind("song-analysis"))
      .concat(dashboardWidgetOptionsForReportKind("subtitle-generation"))
      .some((option) => option.dataKinds.includes(value as DashboardDataKind))
  );
}

function isResultPanelSourceKind(value: unknown): value is ResultPanelSourceKind {
  return value === "completed_report" || value === "workflow_output" || value === "workspace_data_source";
}

interface ResultPanelSourceOption {
  key: string;
  kind: ResultPanelSourceKind;
  label: string;
  nodeId?: string;
  portId?: string;
  dataSourceId?: string;
}

export function resultPanelLayoutFromWidgetIds(widgetIds: DashboardWidgetId[]): DashboardLayout {
  const uniqueIds = Array.from(new Set(widgetIds));
  if (uniqueIds.length <= 1) {
    return { type: "widget", id: uniqueIds[0] ?? "summary" };
  }
  return {
    type: "split",
    id: `attached-result-${uniqueIds.join("-")}`,
    direction: "column",
    sizes: uniqueIds.map(() => 1),
    children: uniqueIds.map((id) => ({ type: "widget", id })),
  };
}

export function defaultResultPanelBinding(
  componentId: DashboardWidgetId,
  dataKind: DashboardDataKind,
): ResultPanelSourceBinding {
  return {
    componentId,
    dataKind,
    sourceKind: "completed_report",
    reportPath: defaultReportPathForDataKind(dataKind),
  };
}

export function resultDataKindPortType(dataKind: DashboardDataKind): PortType {
  switch (dataKind) {
    case "media_preview":
      return "media_file";
    case "video_metadata":
      return "video_metadata";
    case "scene_result":
      return "scene_result";
    case "video_observation":
      return "video_observation";
    case "audio_event":
      return "audio_event";
    case "audio_feature":
    case "audio_frame":
      return "audio_frame";
    case "audio_wav":
      return "audio_wav";
    case "transcript_segment":
      return "transcript_segment";
    case "text_event":
      return "text_event";
    case "data_record":
      return "data_record";
    case "data_bucket":
      return "data_bucket";
    case "model_prediction":
      return "model_prediction";
    case "video_frame":
      return "video_frame";
    case "json_report":
      return "json_report";
    case "collection_manifest":
      return "collection_manifest";
    case "collection_item":
      return "collection_item";
    case "collection_report":
      return "collection_report";
    case "collection_table":
      return "collection_table";
    case "song_fingerprint":
      return "song_fingerprint";
    case "song_match":
      return "song_match";
    case "music_feature":
      return "music_feature";
  }
}

export function defaultReportPathForDataKind(dataKind: DashboardDataKind): string {
  switch (dataKind) {
    case "media_preview":
      return "$.source.local_video";
    case "video_metadata":
      return "$.video";
    case "scene_result":
      return "$.video.scenes";
    case "video_observation":
      return "$.video.observations";
    case "audio_event":
      return "$.audio.events";
    case "audio_feature":
    case "audio_frame":
      return "$.audio";
    case "audio_wav":
      return "$.assets.audio_wav";
    case "transcript_segment":
      return "$.transcription.segments";
    case "text_event":
      return "$.text.events";
    case "data_record":
    case "data_bucket":
      return "$.data_buckets";
    case "model_prediction":
      return "$.video.observations";
    case "video_frame":
      return "$.video.frames_processed";
    case "json_report":
      return "$";
    case "collection_manifest":
      return "$.manifest";
    case "collection_item":
      return "$.items";
    case "collection_report":
      return "$.collection";
    case "collection_table":
      return "$.items";
    case "song_fingerprint":
      return "$.fingerprint";
    case "song_match":
      return "$.identification";
    case "music_feature":
      return "$.music";
  }
}

export function resultPanelSourceOptions(
  dataKind: DashboardDataKind,
  nodes: WorkflowNodeModel[],
  dataSources: DataSourceEntry[],
  typeDefinitions: TypeDefinition[],
): ResultPanelSourceOption[] {
  const targetType = resultDataKindPortType(dataKind);
  const workflowOptions = nodes.flatMap((node) =>
    node.data.outputs
      .filter((portValue) => resultPanelSourceMatches(targetType, portValue.type))
      .map((portValue) => ({
        key: `workflow:${node.id}:${portValue.id}`,
        kind: "workflow_output" as const,
        label: sourceLabelWithCustomType(`${node.data.title} / ${portValue.label}`, portValue.valueType, typeDefinitions),
        nodeId: node.id,
        portId: portValue.id,
      })),
  );
  const dataSourceOptions = dataSources
    .filter((dataSource) => resultPanelSourceMatches(targetType, workflowTypeToPortType(dataSource.type, "data_value")))
    .map((dataSource) => ({
      key: `data-source:${dataSource.id}`,
      kind: "workspace_data_source" as const,
      label: sourceLabelWithCustomType(`${dataSource.name} (${dataSource.id})`, dataSource.type, typeDefinitions),
      dataSourceId: dataSource.id,
    }));
  return [
    { key: "completed-report", kind: "completed_report", label: "Completed run report path" },
    ...workflowOptions,
    ...dataSourceOptions,
  ];
}

function resultPanelSourceMatches(targetType: PortType, sourceType: PortType): boolean {
  return targetType === sourceType || targetType === "json_report" || sourceType === "json_report" || sourceType === "data_value";
}

export function resultPanelBindingKey(binding: ResultPanelSourceBinding): string {
  switch (binding.sourceKind) {
    case "workflow_output":
      return binding.nodeId && binding.portId ? `workflow:${binding.nodeId}:${binding.portId}` : "completed-report";
    case "workspace_data_source":
      return binding.dataSourceId ? `data-source:${binding.dataSourceId}` : "completed-report";
    case "completed_report":
      return "completed-report";
  }
}

export function resultPanelBindingFromSource(
  componentId: DashboardWidgetId,
  dataKind: DashboardDataKind,
  source: ResultPanelSourceOption,
  reportPath: string,
): ResultPanelSourceBinding {
  switch (source.kind) {
    case "workflow_output":
      return {
        componentId,
        dataKind,
        sourceKind: "workflow_output",
        ...(source.nodeId ? { nodeId: source.nodeId } : {}),
        ...(source.portId ? { portId: source.portId } : {}),
      };
    case "workspace_data_source":
      return {
        componentId,
        dataKind,
        sourceKind: "workspace_data_source",
        ...(source.dataSourceId ? { dataSourceId: source.dataSourceId } : {}),
      };
    case "completed_report":
      return {
        componentId,
        dataKind,
        sourceKind: "completed_report",
        reportPath: reportPath || defaultReportPathForDataKind(dataKind),
      };
  }
}

export function resultPanelBindingSummaries(
  panel: WorkflowResultPanel | undefined,
  nodes: WorkflowNodeModel[],
  dataSources: DataSourceEntry[],
  typeDefinitions: TypeDefinition[] = [],
): DashboardWidgetBindingSummary[] {
  if (!panel) {
    return [];
  }
  return panel.bindings.map((binding) => ({
    widgetId: binding.componentId,
    dataKind: binding.dataKind,
    sourceLabel: resultPanelBindingSourceLabel(binding, nodes, dataSources, typeDefinitions),
  }));
}

function resultPanelBindingSourceLabel(
  binding: ResultPanelSourceBinding,
  nodes: WorkflowNodeModel[],
  dataSources: DataSourceEntry[],
  typeDefinitions: TypeDefinition[] = [],
): string {
  switch (binding.sourceKind) {
    case "workflow_output": {
      const node = nodes.find((candidate) => candidate.id === binding.nodeId);
      const portValue = node?.data.outputs.find((output) => output.id === binding.portId);
      return node && portValue
        ? sourceLabelWithCustomType(`${node.data.title} / ${portValue.label}`, portValue.valueType, typeDefinitions)
        : "Workflow output";
    }
    case "workspace_data_source": {
      const dataSource = dataSources.find((candidate) => candidate.id === binding.dataSourceId);
      return dataSource ? sourceLabelWithCustomType(dataSource.name, dataSource.type, typeDefinitions) : "Workspace data source";
    }
    case "completed_report":
      return binding.reportPath || defaultReportPathForDataKind(binding.dataKind);
  }
}

function sourceLabelWithCustomType(label: string, spec: WorkflowTypeSpec, typeDefinitions: TypeDefinition[]): string {
  const customType = customTypeForSpec(spec, typeDefinitions);
  return customType ? `${label} [${customType.name}]` : label;
}

export function customTypeForSpec(spec: WorkflowTypeSpec, typeDefinitions: TypeDefinition[]): TypeDefinition | null {
  const signature = workflowTypeSignature(spec);
  return typeDefinitions.find((definition) => workflowTypeSignature(definition.spec) === signature) ?? null;
}
