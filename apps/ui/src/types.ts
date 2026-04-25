export interface Timebase {
  num: number;
  den: number;
}

export interface Timestamp {
  pts: number;
  timebase: Timebase;
  seconds?: number;
}

export interface FramePosition {
  frame_index: number;
  timestamp: Timestamp;
}

export interface Scene {
  start: FramePosition;
  end: FramePosition;
}

export interface Cut {
  position: FramePosition;
  detector: string;
  score?: number | null;
}

export interface MetricsStoreSnapshot {
  keys?: string[];
  rows?: Record<string, Record<string, number>>;
}

export interface DetectionResult {
  scenes: Scene[];
  cuts?: Cut[];
  metrics?: MetricsStoreSnapshot;
  frames_processed?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnalysisObservation {
  timestamp_seconds?: number | null;
  frame_index?: number | null;
  scene_index?: number | null;
  analyzer: string;
  kind: string;
  label?: string | null;
  text?: string | null;
  score?: number | null;
  region?: BoundingBox | null;
  track_id?: string | null;
  attributes?: Record<string, string>;
}

export interface AnalysisEvent {
  timestamp_seconds?: number | null;
  analyzer: string;
  label: string;
  score?: number | null;
}

export interface SceneReport {
  index: number;
  start_frame: number;
  end_frame: number;
  start_seconds: number;
  end_seconds: number;
  observations: AnalysisObservation[];
}

export interface SourceReport {
  url?: string | null;
  local_video: string;
}

export interface AssetReport {
  work_dir: string;
  report_path: string;
  audio_wav?: string | null;
}

export interface CapabilityReport {
  completed: string[];
  skipped: string[];
}

export interface VideoReport {
  width: number;
  height: number;
  frame_rate: string;
  duration_seconds?: number | null;
  frames_processed: number;
  scenes: SceneReport[];
  observations: AnalysisObservation[];
}

export interface TranscriptSegmentReport {
  index: number;
  start_seconds?: number | null;
  end_seconds?: number | null;
  text: string;
}

export interface TranscriptionReport {
  status: string;
  text?: string | null;
  segments: TranscriptSegmentReport[];
  message?: string | null;
}

export interface AudioReport {
  status: string;
  frames_processed: number;
  events: AnalysisEvent[];
  message?: string | null;
}

export interface TextReport {
  status: string;
  segments_processed: number;
  events: AnalysisEvent[];
  message?: string | null;
}

export interface StreamBucketReport {
  stream_id: string;
  records: number;
  estimated_bytes: number;
  payload_counts: Record<string, number>;
  video_frames: number;
  audio_frames: number;
  text_segments: number;
}

export interface DataBucketReport {
  bucket_index: number;
  records: number;
  estimated_bytes: number;
  streams: StreamBucketReport[];
}

export interface YoutubeVideoReport {
  workflow?: "youtube_video_analysis" | "youtube-video" | string;
  use_case?: "youtube-video" | string;
  source: SourceReport;
  assets: AssetReport;
  capabilities: CapabilityReport;
  video: VideoReport;
  transcription: TranscriptionReport;
  audio: AudioReport;
  text: TextReport;
  data_buckets: DataBucketReport[];
}

export type TranscriptionEngine =
  | "whisper_cpp"
  | "whisper"
  | "faster_whisper"
  | "fast_whisper"
  | "whisperx";

export type WhisperCppModel =
  | "tiny.en"
  | "tiny"
  | "base.en"
  | "base"
  | "small.en"
  | "small"
  | "medium.en"
  | "medium"
  | "large-v1"
  | "large-v2"
  | "large-v3"
  | "large-v3-turbo";

export interface WhisperCppConfig {
  model?: WhisperCppModel;
  language?: string | null;
  translate?: boolean;
  threads?: number | null;
}

export interface TranscriptionConfig {
  enabled: boolean;
  engine?: TranscriptionEngine;
  command?: { command: string; args: string[] } | null;
  whisper_cpp?: WhisperCppConfig;
}

export type YoutubeCollectionSource =
  | { kind: "playlist_url"; url: string }
  | { kind: "channel_url"; url: string }
  | { kind: "youtube_url"; url: string };

export type MetadataDepth = "fast" | "enriched_when_needed" | "full";
export type AlreadyDownloadedPolicy = "include" | "skip" | "reuse";
export type FailedProbeBehavior = "failed" | "include" | "filtered";

export interface ManifestFilterSpec {
  title_contains?: string | null;
  title_excludes?: string[];
  playlist_index_min?: number | null;
  playlist_index_max?: number | null;
  upload_date_from?: string | null;
  upload_date_to?: string | null;
  duration_seconds_min?: number | null;
  duration_seconds_max?: number | null;
  already_downloaded?: AlreadyDownloadedPolicy;
}

export interface LocalFileFilterSpec {
  duration_seconds_min?: number | null;
  duration_seconds_max?: number | null;
  file_size_bytes_min?: number | null;
  file_size_bytes_max?: number | null;
  extension_allowlist?: string[];
  failed_probe_behavior?: FailedProbeBehavior;
}

export interface YoutubeCollectionManifestRequest {
  source: YoutubeCollectionSource;
  metadata_filter: ManifestFilterSpec;
  metadata_depth: MetadataDepth;
  max_items?: number | null;
}

export interface YoutubeCollectionManifestItem {
  item_id: string;
  youtube_id?: string | null;
  playlist_index?: number | null;
  title?: string | null;
  source_url: string;
  duration_seconds?: number | null;
  upload_date?: string | null;
}

export interface YoutubeCollectionManifest {
  collection_id: string;
  source: YoutubeCollectionSource;
  title?: string | null;
  items: YoutubeCollectionManifestItem[];
}

export interface YoutubeRunOptions {
  scene_threshold: number;
  min_scene_len: number;
  max_frames?: number | null;
  visual_sample_every: number;
  transcription: TranscriptionConfig;
  models: {
    object?: { command: string; args: string[] } | null;
    ocr?: { command: string; args: string[] } | null;
    text?: { command: string; args: string[] } | null;
  };
}

export interface YoutubeCollectionRunRequest {
  source?: YoutubeCollectionSource | null;
  manifest?: YoutubeCollectionManifest | null;
  metadata_filter: ManifestFilterSpec;
  local_file_filter: LocalFileFilterSpec;
  analysis: YoutubeRunOptions;
  delete_filtered_downloads: boolean;
  work_dir?: string | null;
  max_items?: number | null;
}

export type CollectionItemStatus =
  | "discovered"
  | "metadata_filtered"
  | "downloaded"
  | "file_filtered"
  | "analyzed"
  | "failed"
  | "skipped_existing";

export interface CollectionSummary {
  collection_id: string;
  title?: string | null;
  source_url: string;
  discovered_items: number;
  selected_items: number;
  analyzed_items: number;
  failed_items: number;
  filtered_items: number;
  skipped_items: number;
  downloaded_items: number;
  total_duration_seconds?: number | null;
}

export interface YoutubeCollectionSourceReport {
  kind: string;
  url: string;
  title?: string | null;
}

export interface AppliedCollectionFilters {
  metadata: string[];
  local_file: string[];
}

export interface CollectionAssetReport {
  work_dir: string;
  report_path: string;
  manifest_path: string;
}

export interface CollectionItemReport {
  item_id: string;
  youtube_id?: string | null;
  playlist_index?: number | null;
  title?: string | null;
  source_url: string;
  local_video?: string | null;
  status: CollectionItemStatus;
  error?: string | null;
  report?: YoutubeVideoReport | null;
}

export interface YoutubeCollectionReport {
  workflow?: "youtube_collection_analysis" | string;
  use_case?: "youtube_collection_analysis" | string;
  collection: CollectionSummary;
  source: YoutubeCollectionSourceReport;
  filters: AppliedCollectionFilters;
  items: CollectionItemReport[];
  assets: CollectionAssetReport;
  capabilities: CapabilityReport;
}

export type SongSourceSpec =
  | { kind: "youtube_url"; url: string }
  | { kind: "local_file"; path: string };

export interface MusicAnalysisConfig {
  enabled: boolean;
  command?: { command: string; args: string[] } | null;
  window_seconds: number;
  hop_seconds: number;
  min_bpm: number;
  max_bpm: number;
}

export interface SongAnalysisRunRequest {
  source: SongSourceSpec;
  work_dir?: string | null;
  catalog: {
    db_path?: string | null;
  };
  identification: {
    enabled: boolean;
    min_score: number;
    ambiguous_margin: number;
    max_candidates: number;
  };
  transcription: TranscriptionConfig;
  music: MusicAnalysisConfig;
}

export interface SongCatalogImportRequest {
  catalog_db_path?: string | null;
  items: SongCatalogImportItem[];
}

export interface SongCatalogImportItem {
  source: SongSourceSpec;
  metadata: {
    title: string;
    artist?: string | null;
    album?: string | null;
    isrc?: string | null;
    source_uri?: string | null;
  };
}

export interface SongCatalogImportResult {
  index: number;
  track_id?: string | null;
  title: string;
  status: string;
  message?: string | null;
}

export interface SongCatalogImportResponse {
  catalog_path: string;
  imported: number;
  failed: number;
  results: SongCatalogImportResult[];
}

export interface SongSourceReport {
  url?: string | null;
  local_media: string;
}

export interface SongAssetReport {
  work_dir: string;
  report_path: string;
  transcription_wav?: string | null;
  music_analysis_wav?: string | null;
}

export interface SongFingerprintQueryReport {
  duration_seconds: number;
  fingerprint: string;
  chunk_count: number;
}

export interface SongMatchedSegmentReport {
  query_start_seconds?: number | null;
  catalog_start_seconds?: number | null;
  duration_seconds: number;
}

export interface SongMatchCandidateReport {
  track_id: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  isrc?: string | null;
  source_uri?: string | null;
  duration_seconds: number;
  score: number;
  matched_segment?: SongMatchedSegmentReport | null;
}

export interface SongIdentificationReport {
  status: string;
  query?: SongFingerprintQueryReport | null;
  catalog_path: string;
  top_match?: SongMatchCandidateReport | null;
  candidates: SongMatchCandidateReport[];
  message?: string | null;
}

export interface MusicFeatureReport {
  bpm?: number | null;
  bpm_confidence?: number | null;
  key?: string | null;
  mode?: string | null;
  key_confidence?: number | null;
}

export interface MusicSegmentReport {
  index: number;
  start_seconds: number;
  end_seconds: number;
  bpm?: number | null;
  bpm_confidence?: number | null;
  key?: string | null;
  mode?: string | null;
  key_confidence?: number | null;
}

export interface MusicAnalysisReport {
  status: string;
  global?: MusicFeatureReport | null;
  segments: MusicSegmentReport[];
  message?: string | null;
}

export interface SongAnalysisReport {
  workflow?: "song_analysis" | string;
  use_case?: "song_analysis" | string;
  source: SongSourceReport;
  assets: SongAssetReport;
  capabilities: CapabilityReport;
  identification: SongIdentificationReport;
  lyrics: TranscriptionReport;
  music: MusicAnalysisReport;
  data_buckets: DataBucketReport[];
}

export interface SubtitleGenerationRunRequest {
  source: SongSourceSpec;
  work_dir?: string | null;
  transcription: TranscriptionConfig;
  overwrite: boolean;
}

export interface SubtitleAssetReport {
  work_dir: string;
  report_path: string;
  audio_wav?: string | null;
  subtitle_path: string;
}

export interface SubtitleReport {
  format: string;
  path: string;
  segments: number;
  message?: string | null;
}

export interface SubtitleGenerationReport {
  workflow?: "subtitle_generation" | string;
  use_case?: "subtitle_generation" | string;
  source: SourceReport;
  assets: SubtitleAssetReport;
  capabilities: CapabilityReport;
  transcription: TranscriptionReport;
  subtitle: SubtitleReport;
}

export type StudioReport = YoutubeVideoReport | YoutubeCollectionReport | SongAnalysisReport | SubtitleGenerationReport;

export interface CollectionTableRow {
  id: string;
  collection_id: string;
  item_id: string;
  youtube_id?: string | null;
  title?: string | null;
  kind: string;
  [key: string]: string | number | boolean | null | undefined;
}

export type TimelineScene = Scene | SceneReport;
