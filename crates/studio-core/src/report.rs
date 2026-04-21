use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeVideoReport {
    pub use_case: String,
    pub source: SourceReport,
    pub assets: AssetReport,
    pub capabilities: CapabilityReport,
    pub video: VideoReport,
    pub transcription: TranscriptionReport,
    pub audio: AudioReport,
    pub text: TextReport,
    pub data_buckets: Vec<DataBucketReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceReport {
    pub url: Option<String>,
    pub local_video: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AssetReport {
    pub work_dir: String,
    pub report_path: String,
    pub audio_wav: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilityReport {
    pub completed: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoReport {
    pub width: u32,
    pub height: u32,
    pub frame_rate: String,
    pub duration_seconds: Option<f64>,
    pub frames_processed: u64,
    pub scenes: Vec<SceneReport>,
    pub observations: Vec<ObservationReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SceneReport {
    pub index: u64,
    pub start_frame: u64,
    pub end_frame: u64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub observations: Vec<ObservationReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObservationReport {
    pub timestamp_seconds: Option<f64>,
    pub frame_index: Option<u64>,
    pub scene_index: Option<u64>,
    pub analyzer: String,
    pub kind: String,
    pub label: Option<String>,
    pub text: Option<String>,
    pub score: Option<f32>,
    pub region: Option<RegionReport>,
    pub track_id: Option<String>,
    #[serde(default)]
    pub attributes: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegionReport {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptionReport {
    pub status: String,
    pub text: Option<String>,
    pub segments: Vec<TranscriptSegmentReport>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptSegmentReport {
    pub index: u64,
    pub start_seconds: Option<f64>,
    pub end_seconds: Option<f64>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioReport {
    pub status: String,
    pub frames_processed: u64,
    pub events: Vec<EventReport>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextReport {
    pub status: String,
    pub segments_processed: u64,
    pub events: Vec<EventReport>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventReport {
    pub timestamp_seconds: Option<f64>,
    pub analyzer: String,
    pub label: String,
    pub score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataBucketReport {
    pub bucket_index: u64,
    pub records: u64,
    pub estimated_bytes: u64,
    pub streams: Vec<StreamBucketReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StreamBucketReport {
    pub stream_id: String,
    pub records: u64,
    pub estimated_bytes: u64,
    pub payload_counts: BTreeMap<String, u64>,
    pub video_frames: u64,
    pub audio_frames: u64,
    pub text_segments: u64,
}
