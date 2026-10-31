import {
  type TranscriptionEngine,
  type WhisperCppModel,
  type YoutubeCollectionManifest,
} from "../index";
import { type ReportDashboardMode } from "../dashboard";
import { type DataSourceRecord } from "../api/client";

export type WorkflowKindId =
  | "youtube-video"
  | "video-red-cars"
  | "youtube-collection"
  | "song-analysis"
  | "subtitle-generation"
  | "image-similarity";

export type SourceMode = "url" | "file" | "collection";

export type ViewMode = "home" | ReportDashboardMode;

export interface WorkflowRunForm {
  sourceMode: SourceMode;
  url: string;
  input: string;
  output: string;
  workDir: string;
  sceneThreshold: number;
  minSceneLen: number;
  maxFrames: string;
  visualSampleEvery: number;
  skipTranscription: boolean;
  transcriptionEngine: Exclude<TranscriptionEngine, "fast_whisper">;
  transcriptionModel: WhisperCppModel;
  transcriptionCommand: string;
  targetObject: string;
  objectCommand: string;
  ocrCommand: string;
  textCommand: string;
  collectionMaxItems: string;
  collectionTitleContains: string;
  collectionDurationMin: string;
  collectionDurationMax: string;
  localDurationMin: string;
  localDurationMax: string;
  localExtensions: string;
  alreadyDownloaded: "include" | "skip" | "reuse";
  songCatalogPath: string;
  songMinScore: number;
  songAmbiguousMargin: number;
  songMaxCandidates: number;
  songWindowSeconds: number;
  songHopSeconds: number;
  songMinBpm: number;
  songMaxBpm: number;
  musicCommand: string;
  imageDataUrl: string;
  imageSourceName: string;
  imageDataSourceId: string;
  workflowInputs: Record<string, string>;
}

export interface CollectionManifestPreviewState {
  status: "idle" | "loading" | "ready" | "error";
  manifest: YoutubeCollectionManifest | null;
  selectedItemIds: string[];
  stale: boolean;
  error: string | null;
}

export type DataSourceEntry = DataSourceRecord;

export interface ImageSimilarityRunRequest {
  source: { kind: "pasted_image"; name: string; data_url: string };
  data_source_id: string;
  top_k: number;
  work_dir?: string | null;
}
