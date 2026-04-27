import type {
  StudioReport,
  SongAnalysisReport,
  SongAnalysisRunRequest,
  SongCatalogImportRequest,
  SongCatalogImportResponse,
  TranscriptionEngine,
  VideoRedCarsReport,
  VideoRedCarsRunRequest,
  WhisperCppModel,
  SubtitleGenerationReport,
  SubtitleGenerationRunRequest,
  YoutubeCollectionManifest,
  YoutubeCollectionManifestRequest,
  YoutubeCollectionReport,
  YoutubeCollectionRunRequest,
  YoutubeVideoReport,
} from "../types";
import { createHttpClient } from "./httpClient";
import { createTauriClient, isTauriRuntime } from "./tauriClient";

export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export interface RunRecord {
  run_id: string;
  workflow: "youtube_video" | "video_red_cars" | "youtube_collection" | "song_analysis" | "subtitle_generation";
  status: RunStatus;
  work_dir: string;
  report_path: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  message?: string | null;
}

export interface RunEvent {
  run_id: string;
  status: RunStatus;
  message: string;
  timestamp: string;
  node?: string | null;
  phase?: "preparing" | "downloading_model" | "loading_model" | "transcribing" | null;
  progress?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}

export interface DependencyStatus {
  name: string;
  required: boolean;
  available: boolean;
  resolved_path?: string | null;
  message?: string | null;
}

export interface SystemDependencyReport {
  dependencies: DependencyStatus[];
}

export interface WhisperCppModelStatus {
  model: WhisperCppModel;
  cached: boolean;
}

export interface TranscriptionEngineStatus {
  id: TranscriptionEngine;
  label: string;
  available: boolean;
  native: boolean;
}

export interface TranscriptionCatalog {
  default_engine: TranscriptionEngine;
  engines: TranscriptionEngineStatus[];
  whisper_cpp: {
    default_model: WhisperCppModel;
    models: WhisperCppModelStatus[];
  };
}

export type PortKind =
  | "run_trigger"
  | "run_config"
  | "youtube_url"
  | "youtube_collection_url"
  | "video_file"
  | "audio_file"
  | "media_file"
  | "transcript"
  | "subtitle_file"
  | "scene_list"
  | "observation_list"
  | "audio_events"
  | "text_events"
  | "data_buckets"
  | "json_report"
  | "collection_manifest"
  | "collection_items"
  | "song_fingerprint"
  | "song_catalog"
  | "song_matches"
  | "music_features"
  | "template_string"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "http_request"
  | "http_response";

export type WorkflowSemanticKind =
  | "run_request"
  | "run_config"
  | "template_string"
  | "youtube_url"
  | "youtube_collection_url"
  | "video_file"
  | "audio_file"
  | "audio_wav"
  | "media_file"
  | "transcript"
  | "subtitle_file"
  | "video_metadata"
  | "scene_result"
  | "video_observation"
  | "model_request"
  | "model_prediction"
  | "transcript_segment"
  | "audio_event"
  | "text_event"
  | "collection_manifest"
  | "collection_item"
  | "collection_report"
  | "collection_table"
  | "song_fingerprint"
  | "song_catalog"
  | "song_match"
  | "music_feature"
  | "http_request"
  | "http_response"
  | "json_report"
  | "dashboard_view"
  | "data_record"
  | "data_bucket";

export interface WorkflowObjectProperty {
  name: string;
  value: WorkflowTypeSpec;
  required?: boolean;
}

export type WorkflowInputSurface = "source_url" | "collection_url" | "file" | "config" | "generic";

export type WorkflowRuntimeValidation = "strict" | "unsafe" | "external_input";

export type WorkflowTypeSpec =
  | { type: "any" }
  | { type: "null" }
  | { type: "boolean" }
  | { type: "number" }
  | { type: "string"; semantic?: WorkflowSemanticKind }
  | { type: "binary"; media_type?: string; semantic?: WorkflowSemanticKind }
  | { type: "array"; items: WorkflowTypeSpec; min_items?: number; max_items?: number }
  | {
      type: "object";
      properties?: WorkflowObjectProperty[];
      additional_properties?: boolean;
      semantic?: WorkflowSemanticKind;
    }
  | { type: "union"; variants: WorkflowTypeSpec[] };

export type DataSourceKind = "sqlite" | "json" | "csv" | "txt" | "folder" | "api" | "other";
export type DataSourceDerivationKind = "alias" | "subset_view";

export type DataSourceOrigin =
  | { mode: "root" }
  | {
      mode: "derived_view";
      parent_id: string;
      derivation_kind: DataSourceDerivationKind;
      summary?: string;
    };

export interface DataSourceRecord {
  id: string;
  name: string;
  kind: DataSourceKind;
  type: WorkflowTypeSpec;
  location: string;
  description: string;
  tags: string[];
  body: string;
  origin: DataSourceOrigin;
  created_at: string;
  updated_at: string;
}

export interface DataSourceUpsert {
  id: string;
  name: string;
  kind: DataSourceKind;
  type: WorkflowTypeSpec;
  location: string;
  description: string;
  tags: string[];
  body: string;
}

export interface DataSourceDerivationInput {
  id: string;
  name: string;
  type: WorkflowTypeSpec;
  description: string;
  tags: string[];
  derivation_kind?: DataSourceDerivationKind;
  summary?: string;
}

export interface PortSpec {
  id: string;
  label: string;
  kind: PortKind;
  value_type: WorkflowTypeSpec;
  optional?: boolean;
  stream?: boolean;
  exposable_input?: boolean;
  input_surface?: WorkflowInputSurface;
  suggested_adapters?: string[];
  runtime_validation?: WorkflowRuntimeValidation;
}

export interface NodeSpec {
  id: string;
  title: string;
  package_name: string;
  category: string;
  ui_owned?: boolean;
  inputs: PortSpec[];
  outputs: PortSpec[];
}

export interface PortCompatibility {
  source: PortKind;
  target: PortKind;
}

export interface WorkflowCatalog {
  version: number;
  port_kinds: PortKind[];
  nodes: NodeSpec[];
  compatibility: PortCompatibility[];
}

export interface ExternalCommandConfig {
  command: string;
  args: string[];
}

export interface YoutubeRunRequest {
  source:
    | { kind: "youtube_url"; url: string }
    | { kind: "local_file"; path: string };
  work_dir?: string | null;
  scene_threshold: number;
  min_scene_len: number;
  max_frames?: number | null;
  visual_sample_every: number;
  transcription: {
    enabled: boolean;
    engine?: TranscriptionEngine;
    command?: ExternalCommandConfig | null;
    whisper_cpp?: {
      model?: WhisperCppModel;
      language?: string | null;
      translate?: boolean;
      threads?: number | null;
    };
  };
  models: {
    object?: ExternalCommandConfig | null;
    ocr?: ExternalCommandConfig | null;
    text?: ExternalCommandConfig | null;
  };
}

export interface WorkflowClient {
  label: string;
  checkDependencies(): Promise<SystemDependencyReport>;
  getTranscriptionCatalog(): Promise<TranscriptionCatalog>;
  getWorkflowCatalog(): Promise<WorkflowCatalog>;
  listDataSources(): Promise<DataSourceRecord[]>;
  createDataSource(request: DataSourceUpsert): Promise<DataSourceRecord>;
  updateDataSource(id: string, request: DataSourceUpsert): Promise<DataSourceRecord>;
  deleteDataSource(id: string): Promise<void>;
  createDataSourceDerivation(parentId: string, request: DataSourceDerivationInput): Promise<DataSourceRecord>;
  discoverYoutubeCollectionManifest(request: YoutubeCollectionManifestRequest): Promise<YoutubeCollectionManifest>;
  startYoutubeVideoRun(request: YoutubeRunRequest): Promise<RunRecord>;
  startVideoRedCarsRun(request: VideoRedCarsRunRequest): Promise<RunRecord>;
  startYoutubeCollectionRun(request: YoutubeCollectionRunRequest): Promise<RunRecord>;
  startSongAnalysisRun(request: SongAnalysisRunRequest): Promise<RunRecord>;
  startSubtitleGenerationRun(request: SubtitleGenerationRunRequest): Promise<RunRecord>;
  importSongCatalogItems(request: SongCatalogImportRequest): Promise<SongCatalogImportResponse>;
  getRun(runId: string): Promise<RunRecord>;
  getRunEvents(runId: string): Promise<RunEvent[]>;
  getReport(runId: string): Promise<StudioReport>;
  getYoutubeVideoReport(runId: string): Promise<YoutubeVideoReport>;
  getVideoRedCarsReport(runId: string): Promise<VideoRedCarsReport>;
  getYoutubeCollectionReport(runId: string): Promise<YoutubeCollectionReport>;
  getSongAnalysisReport(runId: string): Promise<SongAnalysisReport>;
  getSubtitleGenerationReport(runId: string): Promise<SubtitleGenerationReport>;
  mediaUrl(runId: string | null, path: string): Promise<string | null>;
  cancelRun(runId: string): Promise<void>;
  subscribeRunEvents?(runId: string, onEvent: (event: RunEvent) => void): Promise<() => void>;
}

export function getWorkflowClient(): WorkflowClient {
  return isTauriRuntime() ? createTauriClient() : createHttpClient();
}

export function isYoutubeCollectionReport(report: StudioReport): report is YoutubeCollectionReport {
  return reportWorkflow(report) === "youtube_collection_analysis" && "items" in report && "collection" in report;
}

export function isYoutubeVideoReport(report: StudioReport): report is YoutubeVideoReport {
  return "video" in report && "source" in report && "data_buckets" in report;
}

export function isVideoRedCarsReport(report: StudioReport): report is VideoRedCarsReport {
  return reportWorkflow(report) === "video-red-cars" && "video" in report && "capabilities" in report && !("data_buckets" in report);
}

export function isSongAnalysisReport(report: StudioReport): report is SongAnalysisReport {
  return reportWorkflow(report) === "song_analysis" && "identification" in report && "music" in report;
}

export function isSubtitleGenerationReport(report: StudioReport): report is SubtitleGenerationReport {
  return reportWorkflow(report) === "subtitle_generation" && "subtitle" in report && "transcription" in report;
}

function reportWorkflow(report: StudioReport): string | undefined {
  return report.workflow ?? report.use_case;
}

export async function waitForRunCompletion(
  client: WorkflowClient,
  runId: string,
  onRun: (run: RunRecord) => void,
  onEvent?: (event: RunEvent) => void,
): Promise<RunRecord> {
  const unsubscribe = client.subscribeRunEvents
    ? await client.subscribeRunEvents(runId, (event) => {
        onEvent?.(event);
      })
    : undefined;

  try {
    for (;;) {
      const run = await client.getRun(runId);
      onRun(run);
      if (["succeeded", "failed", "canceled"].includes(run.status)) {
        return run;
      }
      await delay(1000);
    }
  } finally {
    unsubscribe?.();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
