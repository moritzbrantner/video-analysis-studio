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
  use_case: "youtube-video" | string;
  source: SourceReport;
  assets: AssetReport;
  capabilities: CapabilityReport;
  video: VideoReport;
  transcription: TranscriptionReport;
  audio: AudioReport;
  text: TextReport;
  data_buckets: DataBucketReport[];
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
  transcription: {
    enabled: boolean;
    command?: { command: string; args: string[] } | null;
  };
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
  use_case: "youtube_collection_analysis" | string;
  collection: CollectionSummary;
  source: YoutubeCollectionSourceReport;
  filters: AppliedCollectionFilters;
  items: CollectionItemReport[];
  assets: CollectionAssetReport;
  capabilities: CapabilityReport;
}

export type StudioReport = YoutubeVideoReport | YoutubeCollectionReport;

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
