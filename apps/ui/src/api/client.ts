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
import type {
  DataSourceDerivationInput,
  DataSourceRecord,
  DataSourceUpsert,
  RunEvent,
  RunRecord,
  RunStatus,
  SystemDependencyReport,
  TranscriptionCatalog,
  WorkflowCatalog,
} from "./generated";
export type {
  DataSourceDerivationInput,
  DataSourceKind,
  DataSourceOrigin,
  DataSourceRecord,
  DataSourceUpsert,
  DependencyStatus,
  NodeSpec,
  PortCompatibility,
  PortKind,
  PortSpec,
  RunEvent,
  RunRecord,
  RunStatus,
  SystemDependencyReport,
  TranscriptionCatalog,
  TranscriptionEngineStatus,
  WhisperCppModelStatus,
  WorkflowCatalog,
  WorkflowInputSurface,
  WorkflowObjectProperty,
  WorkflowRuntimeValidation,
  WorkflowSemanticKind,
  WorkflowTypeSpec,
} from "./generated";

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
  listRuns(params?: RunListParams): Promise<RunRecord[]>;
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

export interface RunListParams {
  limit?: number;
  workflow?: RunRecord["workflow"];
  status?: RunStatus;
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
