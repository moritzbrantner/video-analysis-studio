use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum StudioReport {
    YoutubeCollection(YoutubeCollectionReport),
    YoutubeVideo(YoutubeVideoReport),
    SongAnalysis(SongAnalysisReport),
    SubtitleGeneration(SubtitleGenerationReport),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeVideoReport {
    #[serde(alias = "use_case")]
    pub workflow: String,
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
pub struct SubtitleGenerationReport {
    #[serde(alias = "use_case")]
    pub workflow: String,
    pub source: SourceReport,
    pub assets: SubtitleAssetReport,
    pub capabilities: CapabilityReport,
    pub transcription: TranscriptionReport,
    pub subtitle: SubtitleReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubtitleAssetReport {
    pub work_dir: String,
    pub report_path: String,
    pub audio_wav: Option<String>,
    pub subtitle_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubtitleReport {
    pub format: String,
    pub path: String,
    pub segments: u64,
    pub message: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongAnalysisReport {
    #[serde(alias = "use_case")]
    pub workflow: String,
    pub source: SongSourceReport,
    pub assets: SongAssetReport,
    pub capabilities: CapabilityReport,
    pub identification: SongIdentificationReport,
    pub lyrics: TranscriptionReport,
    pub music: MusicAnalysisReport,
    pub data_buckets: Vec<DataBucketReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongSourceReport {
    pub url: Option<String>,
    pub local_media: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongAssetReport {
    pub work_dir: String,
    pub report_path: String,
    pub transcription_wav: Option<String>,
    pub music_analysis_wav: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongIdentificationReport {
    pub status: String,
    pub query: Option<SongFingerprintQueryReport>,
    pub catalog_path: String,
    pub top_match: Option<SongMatchCandidateReport>,
    pub candidates: Vec<SongMatchCandidateReport>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongFingerprintQueryReport {
    pub duration_seconds: f64,
    pub fingerprint: String,
    pub chunk_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongMatchCandidateReport {
    pub track_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub isrc: Option<String>,
    pub source_uri: Option<String>,
    pub duration_seconds: f64,
    pub score: f32,
    pub matched_segment: Option<SongMatchedSegmentReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongMatchedSegmentReport {
    pub query_start_seconds: Option<f64>,
    pub catalog_start_seconds: Option<f64>,
    pub duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MusicAnalysisReport {
    pub status: String,
    pub global: Option<MusicFeatureReport>,
    pub segments: Vec<MusicSegmentReport>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MusicFeatureReport {
    pub bpm: Option<f32>,
    pub bpm_confidence: Option<f32>,
    pub key: Option<String>,
    pub mode: Option<String>,
    pub key_confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MusicSegmentReport {
    pub index: u64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub bpm: Option<f32>,
    pub bpm_confidence: Option<f32>,
    pub key: Option<String>,
    pub mode: Option<String>,
    pub key_confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionReport {
    #[serde(alias = "use_case")]
    pub workflow: String,
    pub collection: CollectionSummary,
    pub source: YoutubeCollectionSourceReport,
    pub filters: AppliedCollectionFilters,
    pub items: Vec<CollectionItemReport>,
    pub assets: CollectionAssetReport,
    pub capabilities: CapabilityReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollectionSummary {
    pub collection_id: String,
    pub title: Option<String>,
    pub source_url: String,
    pub discovered_items: u64,
    pub selected_items: u64,
    pub analyzed_items: u64,
    pub failed_items: u64,
    pub filtered_items: u64,
    pub skipped_items: u64,
    pub downloaded_items: u64,
    pub total_duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionSourceReport {
    pub kind: String,
    pub url: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppliedCollectionFilters {
    pub metadata: Vec<String>,
    pub local_file: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollectionAssetReport {
    pub work_dir: String,
    pub report_path: String,
    pub manifest_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollectionItemReport {
    pub item_id: String,
    pub youtube_id: Option<String>,
    pub playlist_index: Option<u64>,
    pub title: Option<String>,
    pub source_url: String,
    pub local_video: Option<String>,
    pub status: CollectionItemStatus,
    pub error: Option<String>,
    pub report: Option<YoutubeVideoReport>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectionItemStatus {
    Discovered,
    MetadataFiltered,
    Downloaded,
    FileFiltered,
    Analyzed,
    Failed,
    SkippedExisting,
}
