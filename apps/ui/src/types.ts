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

export type TimelineScene = Scene | SceneReport;
