use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use audio_analysis_processing::AudioEnergyAnalyzer;
use serde::{Deserialize, Serialize};
use text_analysis_features::TranscriptHeuristicAnalyzer;
use text_analysis_transcription::{segment_to_owned_text_segment, TranscriptSegment};
use video_analysis_core::{
    AnalysisEvent, BoundingBox, Observation, ObservationKind, RealtimeVideoPipeline,
    SampledVideoAnalyzer,
};
use video_analysis_data::{
    BucketAggregator, BucketConfig, DataBucket, DataRecord, DataStreamKind, StreamSummary,
};
use video_analysis_detectors::ContentDetector;
use video_analysis_ffmpeg::{FfmpegAudioSource, FfmpegAudioSourceOptions, FfmpegVideoSource};
use video_analysis_ingest::{AudioFrameSource, VideoFrameSource};
use video_analysis_models::{
    DownloadedModel, ExternalCommandModel, HuggingFaceModelSpec, ModelTask, ModelTextAnalyzer,
    ModelVideoAnalyzer,
};

use crate::error::{Result, StudioError};
use crate::media::{validate_local_file, validate_youtube_url};
use crate::report::{
    AppliedCollectionFilters, AssetReport, AudioReport, CapabilityReport, CollectionAssetReport,
    CollectionItemReport, CollectionItemStatus, CollectionSummary, DataBucketReport, EventReport,
    ObservationReport, RegionReport, SceneReport, SourceReport, StreamBucketReport, TextReport,
    TranscriptionReport, VideoReport, YoutubeCollectionReport, YoutubeCollectionSourceReport,
    YoutubeVideoReport,
};
use crate::run_manager::{RunCancellationToken, WorkflowProgress};
use crate::system::resolve_command;
use crate::workflow_support::{
    display_path, download_youtube_video, download_youtube_video_to_dir, transcribe_media,
    write_json_report,
};
pub use text_analysis_transcription::{WhisperCppConfig, WhisperCppModel};

pub const DEFAULT_SCENE_THRESHOLD: f32 = 27.0;
pub const DEFAULT_MIN_SCENE_LEN: u64 = 15;
pub const DEFAULT_VISUAL_SAMPLE_EVERY: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceSpec {
    YoutubeUrl { url: String },
    LocalFile { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalCommandConfig {
    pub command: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscriptionConfig {
    pub enabled: bool,
    #[serde(default)]
    pub engine: TranscriptionEngine,
    pub command: Option<ExternalCommandConfig>,
    #[serde(default)]
    pub whisper_cpp: WhisperCppConfig,
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            engine: TranscriptionEngine::default(),
            command: None,
            whisper_cpp: WhisperCppConfig::default(),
        }
    }
}

impl TranscriptionConfig {
    pub fn normalized(mut self) -> Self {
        if self.engine == TranscriptionEngine::Whisper && self.command.is_none() {
            self.engine = TranscriptionEngine::WhisperCpp;
        }
        self
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionEngine {
    WhisperCpp,
    Whisper,
    #[serde(alias = "fast_whisper")]
    FasterWhisper,
    WhisperX,
}

impl Default for TranscriptionEngine {
    fn default() -> Self {
        Self::WhisperCpp
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelCommandConfig {
    pub object: Option<ExternalCommandConfig>,
    pub ocr: Option<ExternalCommandConfig>,
    pub text: Option<ExternalCommandConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeRunRequest {
    pub source: SourceSpec,
    pub work_dir: Option<PathBuf>,
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f32,
    #[serde(default = "default_min_scene_len")]
    pub min_scene_len: u64,
    pub max_frames: Option<u64>,
    #[serde(default = "default_visual_sample_every")]
    pub visual_sample_every: u64,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default)]
    pub models: ModelCommandConfig,
}

impl YoutubeRunRequest {
    pub fn local_file(path: impl Into<PathBuf>) -> Self {
        Self {
            source: SourceSpec::LocalFile { path: path.into() },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        }
    }

    pub fn youtube_url(url: impl Into<String>) -> Self {
        Self {
            source: SourceSpec::YoutubeUrl { url: url.into() },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if !self.scene_threshold.is_finite() || self.scene_threshold <= 0.0 {
            return Err(StudioError::InvalidRequest(
                "scene_threshold must be finite and positive".to_string(),
            ));
        }
        if self.min_scene_len == 0 {
            return Err(StudioError::InvalidRequest(
                "min_scene_len must be positive".to_string(),
            ));
        }
        if self.visual_sample_every == 0 {
            return Err(StudioError::InvalidRequest(
                "visual_sample_every must be positive".to_string(),
            ));
        }
        match &self.source {
            SourceSpec::YoutubeUrl { url } => validate_youtube_url(url),
            SourceSpec::LocalFile { path } => validate_local_file(path),
        }
    }

    pub fn resolved_work_dir(&self, data_dir: &Path, run_id: uuid::Uuid) -> PathBuf {
        self.work_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("runs").join(run_id.to_string()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum YoutubeCollectionSource {
    PlaylistUrl { url: String },
    ChannelUrl { url: String },
    YoutubeUrl { url: String },
}

impl YoutubeCollectionSource {
    pub fn url(&self) -> &str {
        match self {
            Self::PlaylistUrl { url } | Self::ChannelUrl { url } | Self::YoutubeUrl { url } => url,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        match self {
            Self::PlaylistUrl { .. } => "playlist_url",
            Self::ChannelUrl { .. } => "channel_url",
            Self::YoutubeUrl { .. } => "youtube_url",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetadataDepth {
    Fast,
    EnrichedWhenNeeded,
    Full,
}

impl Default for MetadataDepth {
    fn default() -> Self {
        Self::EnrichedWhenNeeded
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlreadyDownloadedPolicy {
    Include,
    Skip,
    Reuse,
}

impl Default for AlreadyDownloadedPolicy {
    fn default() -> Self {
        Self::Reuse
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ManifestFilterSpec {
    pub title_contains: Option<String>,
    #[serde(default)]
    pub title_excludes: Vec<String>,
    pub playlist_index_min: Option<u64>,
    pub playlist_index_max: Option<u64>,
    pub upload_date_from: Option<String>,
    pub upload_date_to: Option<String>,
    pub duration_seconds_min: Option<f64>,
    pub duration_seconds_max: Option<f64>,
    #[serde(default)]
    pub already_downloaded: AlreadyDownloadedPolicy,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailedProbeBehavior {
    Failed,
    Include,
    Filtered,
}

impl Default for FailedProbeBehavior {
    fn default() -> Self {
        Self::Failed
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct LocalFileFilterSpec {
    pub duration_seconds_min: Option<f64>,
    pub duration_seconds_max: Option<f64>,
    pub file_size_bytes_min: Option<u64>,
    pub file_size_bytes_max: Option<u64>,
    #[serde(default)]
    pub extension_allowlist: Vec<String>,
    #[serde(default)]
    pub failed_probe_behavior: FailedProbeBehavior,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeRunOptions {
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f32,
    #[serde(default = "default_min_scene_len")]
    pub min_scene_len: u64,
    pub max_frames: Option<u64>,
    #[serde(default = "default_visual_sample_every")]
    pub visual_sample_every: u64,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default)]
    pub models: ModelCommandConfig,
}

impl Default for YoutubeRunOptions {
    fn default() -> Self {
        Self {
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        }
    }
}

impl YoutubeRunOptions {
    pub fn validate(&self) -> Result<()> {
        if !self.scene_threshold.is_finite() || self.scene_threshold <= 0.0 {
            return Err(StudioError::InvalidRequest(
                "scene_threshold must be finite and positive".to_string(),
            ));
        }
        if self.min_scene_len == 0 {
            return Err(StudioError::InvalidRequest(
                "min_scene_len must be positive".to_string(),
            ));
        }
        if self.visual_sample_every == 0 {
            return Err(StudioError::InvalidRequest(
                "visual_sample_every must be positive".to_string(),
            ));
        }
        Ok(())
    }

    fn to_request(&self, source: SourceSpec, work_dir: PathBuf) -> YoutubeRunRequest {
        YoutubeRunRequest {
            source,
            work_dir: Some(work_dir),
            scene_threshold: self.scene_threshold,
            min_scene_len: self.min_scene_len,
            max_frames: self.max_frames,
            visual_sample_every: self.visual_sample_every,
            transcription: self.transcription.clone(),
            models: self.models.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionManifestRequest {
    pub source: YoutubeCollectionSource,
    #[serde(default)]
    pub metadata_filter: ManifestFilterSpec,
    #[serde(default)]
    pub metadata_depth: MetadataDepth,
    pub max_items: Option<u64>,
}

impl YoutubeCollectionManifestRequest {
    pub fn validate(&self) -> Result<()> {
        validate_youtube_url(self.source.url())?;
        validate_manifest_filter(&self.metadata_filter)?;
        if self.max_items == Some(0) {
            return Err(StudioError::InvalidRequest(
                "max_items must be positive when provided".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionRunRequest {
    pub source: Option<YoutubeCollectionSource>,
    pub manifest: Option<YoutubeCollectionManifest>,
    #[serde(default)]
    pub metadata_filter: ManifestFilterSpec,
    #[serde(default)]
    pub local_file_filter: LocalFileFilterSpec,
    #[serde(default)]
    pub analysis: YoutubeRunOptions,
    #[serde(default)]
    pub delete_filtered_downloads: bool,
    pub work_dir: Option<PathBuf>,
    pub max_items: Option<u64>,
}

impl YoutubeCollectionRunRequest {
    pub fn validate(&self) -> Result<()> {
        if self.source.is_none() && self.manifest.is_none() {
            return Err(StudioError::InvalidRequest(
                "source or manifest is required".to_string(),
            ));
        }
        if let Some(source) = &self.source {
            validate_youtube_url(source.url())?;
        }
        validate_manifest_filter(&self.metadata_filter)?;
        validate_local_file_filter(&self.local_file_filter)?;
        self.analysis.validate()?;
        if self.max_items == Some(0) {
            return Err(StudioError::InvalidRequest(
                "max_items must be positive when provided".to_string(),
            ));
        }
        Ok(())
    }

    pub fn resolved_work_dir(&self, data_dir: &Path, run_id: uuid::Uuid) -> PathBuf {
        self.work_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("runs").join(run_id.to_string()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionManifest {
    pub collection_id: String,
    pub source: YoutubeCollectionSource,
    pub title: Option<String>,
    pub items: Vec<YoutubeCollectionManifestItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeCollectionManifestItem {
    pub item_id: String,
    pub youtube_id: Option<String>,
    pub playlist_index: Option<u64>,
    pub title: Option<String>,
    pub source_url: String,
    pub duration_seconds: Option<f64>,
    pub upload_date: Option<String>,
}

pub fn run_youtube_video_workflow(
    request: YoutubeRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    cancellation: RunCancellationToken,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<YoutubeVideoReport> {
    request.validate()?;
    cancellation.check()?;
    fs::create_dir_all(&work_dir)?;

    let mut completed = Vec::new();
    let mut skipped = Vec::new();

    let (source_url, video_path) = match &request.source {
        SourceSpec::LocalFile { path } => (None, path.clone()),
        SourceSpec::YoutubeUrl { url } => {
            let path = download_youtube_video(url, &work_dir, &cancellation)?;
            completed.push("youtube_download".to_string());
            (Some(url.clone()), path)
        }
    };
    cancellation.check()?;

    let mut data_buckets = Vec::new();
    let mut aggregator = BucketAggregator::new(BucketConfig::record_count(1_000)?)?;
    let (video, observations) = analyze_video(
        &request,
        &video_path,
        &mut aggregator,
        &mut data_buckets,
        &cancellation,
    )?;
    completed.push("scene_detection".to_string());
    if request.models.object.is_some() {
        completed.push("object_person_detection".to_string());
    } else {
        skipped.push("object/person detection: configure models.object".to_string());
    }
    if request.models.ocr.is_some() {
        completed.push("ocr".to_string());
    } else {
        skipped.push("on-screen text OCR: configure models.ocr".to_string());
    }

    let (transcription, audio_wav) = transcribe_media(
        &request.transcription,
        &video_path,
        &work_dir,
        &cancellation,
        &mut |event| {
            progress(WorkflowProgress::phase(
                "transcriber",
                event.phase.as_str(),
                event.message,
                event.progress,
            ));
        },
    )?;
    match transcription.status.as_str() {
        "completed" => completed.push("transcription".to_string()),
        _ => skipped.push(format!(
            "transcription: {}",
            transcription.message.as_deref().unwrap_or("not available")
        )),
    }

    let audio = match analyze_audio(
        &video_path,
        &mut aggregator,
        &mut data_buckets,
        &cancellation,
    ) {
        Ok(report) => {
            completed.push("audio_analysis".to_string());
            report
        }
        Err(err) => AudioReport {
            status: "skipped".to_string(),
            frames_processed: 0,
            events: Vec::new(),
            message: Some(err.to_string()),
        },
    };
    if audio.status != "completed" {
        skipped.push(format!(
            "audio analysis: {}",
            audio.message.as_deref().unwrap_or("not available")
        ));
    }

    let text =
        match analyze_transcript_text(&request, &transcription, &mut aggregator, &mut data_buckets)
        {
            Ok(report) => {
                if report.status == "completed" {
                    completed.push("transcript_text_analysis".to_string());
                }
                report
            }
            Err(err) => TextReport {
                status: "skipped".to_string(),
                segments_processed: 0,
                events: Vec::new(),
                message: Some(err.to_string()),
            },
        };
    if text.status != "completed" {
        skipped.push(format!(
            "transcript text analysis: {}",
            text.message.as_deref().unwrap_or("not available")
        ));
    }

    if let Some(bucket) = aggregator.finish() {
        data_buckets.push(bucket_report(&bucket));
    }
    cancellation.check()?;

    let report = YoutubeVideoReport {
        workflow: "youtube-video".to_string(),
        source: SourceReport {
            url: source_url,
            local_video: display_path(&video_path),
        },
        assets: AssetReport {
            work_dir: display_path(&work_dir),
            report_path: display_path(&report_path),
            audio_wav: audio_wav.as_ref().map(|path| display_path(path)),
        },
        capabilities: CapabilityReport { completed, skipped },
        video: video_report_with_observations(video, observations),
        transcription,
        audio,
        text,
        data_buckets,
    };

    write_json_report(&report_path, &report)?;
    Ok(report)
}

pub fn discover_youtube_collection_manifest(
    request: YoutubeCollectionManifestRequest,
) -> Result<YoutubeCollectionManifest> {
    request.validate()?;
    let mut manifest = discover_collection_manifest(&request.source, request.max_items)?;
    let needs_enrichment = request.metadata_depth == MetadataDepth::Full
        || (request.metadata_depth == MetadataDepth::EnrichedWhenNeeded
            && manifest_filter_needs_enrichment(&request.metadata_filter));
    if needs_enrichment {
        enrich_manifest_items(&mut manifest)?;
    }
    manifest
        .items
        .retain(|item| metadata_filter_matches(item, &request.metadata_filter));
    Ok(manifest)
}

pub fn run_youtube_collection_workflow(
    request: YoutubeCollectionRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    cancellation: RunCancellationToken,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<YoutubeCollectionReport> {
    request.validate()?;
    cancellation.check()?;
    fs::create_dir_all(&work_dir)?;

    let mut manifest = match request.manifest.clone() {
        Some(manifest) => manifest,
        None => {
            let source = request.source.clone().ok_or_else(|| {
                StudioError::InvalidRequest("source or manifest is required".to_string())
            })?;
            discover_collection_manifest(&source, request.max_items)?
        }
    };
    if manifest_filter_needs_enrichment(&request.metadata_filter) {
        enrich_manifest_items(&mut manifest)?;
    }

    let manifest_path = work_dir.join("manifest.json");
    write_json_report(&manifest_path, &manifest)?;

    let mut completed = vec!["collection_discovery".to_string()];
    let mut skipped = Vec::new();
    let mut item_reports = Vec::new();
    let mut selected_items = 0_u64;
    let mut downloaded_items = 0_u64;

    for item in &manifest.items {
        cancellation.check()?;
        if !metadata_filter_matches(item, &request.metadata_filter) {
            item_reports.push(collection_item_report(
                item,
                None,
                CollectionItemStatus::MetadataFiltered,
                Some("filtered by metadata".to_string()),
                None,
            ));
            continue;
        }

        let item_dir = work_dir.join("items").join(&item.item_id);
        let media_dir = item_dir.join("media");
        let existing = find_existing_item_video(&media_dir);
        if existing.is_some()
            && request.metadata_filter.already_downloaded == AlreadyDownloadedPolicy::Skip
        {
            item_reports.push(collection_item_report(
                item,
                existing.as_ref(),
                CollectionItemStatus::SkippedExisting,
                Some("already downloaded".to_string()),
                None,
            ));
            continue;
        }

        selected_items += 1;
        let mut local_video = existing;
        if local_video.is_none() {
            match download_youtube_video_to_dir(
                &item.source_url,
                &media_dir,
                &item.item_id,
                &cancellation,
            ) {
                Ok(path) => {
                    downloaded_items += 1;
                    local_video = Some(path);
                }
                Err(error) => {
                    item_reports.push(collection_item_report(
                        item,
                        None,
                        CollectionItemStatus::Failed,
                        Some(error.to_string()),
                        None,
                    ));
                    continue;
                }
            }
        }

        let Some(local_video_path) = local_video.clone() else {
            item_reports.push(collection_item_report(
                item,
                None,
                CollectionItemStatus::Failed,
                Some("download did not produce a local video".to_string()),
                None,
            ));
            continue;
        };

        match local_file_filter_matches(&local_video_path, &request.local_file_filter) {
            Ok(true) => {}
            Ok(false) => {
                if request.delete_filtered_downloads {
                    let _ = fs::remove_file(&local_video_path);
                }
                item_reports.push(collection_item_report(
                    item,
                    Some(&local_video_path),
                    CollectionItemStatus::FileFiltered,
                    Some("filtered by local file metadata".to_string()),
                    None,
                ));
                continue;
            }
            Err(error) => match request.local_file_filter.failed_probe_behavior {
                FailedProbeBehavior::Include => {}
                FailedProbeBehavior::Filtered => {
                    item_reports.push(collection_item_report(
                        item,
                        Some(&local_video_path),
                        CollectionItemStatus::FileFiltered,
                        Some(error.to_string()),
                        None,
                    ));
                    continue;
                }
                FailedProbeBehavior::Failed => {
                    item_reports.push(collection_item_report(
                        item,
                        Some(&local_video_path),
                        CollectionItemStatus::Failed,
                        Some(error.to_string()),
                        None,
                    ));
                    continue;
                }
            },
        }

        let analysis_work_dir = item_dir.join("analysis-work");
        let item_report_path = item_dir.join("analysis.json");
        let item_request = request.analysis.to_request(
            SourceSpec::LocalFile {
                path: local_video_path.clone(),
            },
            analysis_work_dir.clone(),
        );
        match run_youtube_video_workflow(
            item_request,
            analysis_work_dir,
            item_report_path,
            cancellation.clone(),
            progress,
        ) {
            Ok(report) => item_reports.push(collection_item_report(
                item,
                Some(&local_video_path),
                CollectionItemStatus::Analyzed,
                None,
                Some(report),
            )),
            Err(error) => item_reports.push(collection_item_report(
                item,
                Some(&local_video_path),
                CollectionItemStatus::Failed,
                Some(error.to_string()),
                None,
            )),
        }
    }

    let analyzed_items = item_reports
        .iter()
        .filter(|item| item.status == CollectionItemStatus::Analyzed)
        .count() as u64;
    let failed_items = item_reports
        .iter()
        .filter(|item| item.status == CollectionItemStatus::Failed)
        .count() as u64;
    let filtered_items = item_reports
        .iter()
        .filter(|item| {
            matches!(
                item.status,
                CollectionItemStatus::MetadataFiltered | CollectionItemStatus::FileFiltered
            )
        })
        .count() as u64;
    let skipped_items = item_reports
        .iter()
        .filter(|item| item.status == CollectionItemStatus::SkippedExisting)
        .count() as u64;

    if analyzed_items > 0 {
        completed.push("collection_analysis".to_string());
    }
    if failed_items > 0 {
        skipped.push(format!("{failed_items} collection items failed"));
    }
    if filtered_items > 0 {
        skipped.push(format!("{filtered_items} collection items filtered"));
    }
    if skipped_items > 0 {
        skipped.push(format!("{skipped_items} existing collection items skipped"));
    }

    let total_duration_seconds = item_reports
        .iter()
        .filter_map(|item| item.report.as_ref()?.video.duration_seconds)
        .reduce(|left, right| left + right);

    let report = YoutubeCollectionReport {
        workflow: "youtube_collection_analysis".to_string(),
        collection: CollectionSummary {
            collection_id: manifest.collection_id.clone(),
            title: manifest.title.clone(),
            source_url: manifest.source.url().to_string(),
            discovered_items: manifest.items.len() as u64,
            selected_items,
            analyzed_items,
            failed_items,
            filtered_items,
            skipped_items,
            downloaded_items,
            total_duration_seconds,
        },
        source: YoutubeCollectionSourceReport {
            kind: manifest.source.kind_name().to_string(),
            url: manifest.source.url().to_string(),
            title: manifest.title.clone(),
        },
        filters: AppliedCollectionFilters {
            metadata: describe_manifest_filter(&request.metadata_filter),
            local_file: describe_local_file_filter(&request.local_file_filter),
        },
        items: item_reports,
        assets: CollectionAssetReport {
            work_dir: display_path(&work_dir),
            report_path: display_path(&report_path),
            manifest_path: display_path(&manifest_path),
        },
        capabilities: CapabilityReport { completed, skipped },
    };

    cancellation.check()?;
    write_json_report(&report_path, &report)?;

    if analyzed_items == 0 && failed_items > 0 {
        return Err(StudioError::Workflow(
            "collection analysis failed for every selected item".to_string(),
        ));
    }

    Ok(report)
}

#[derive(Debug, Deserialize)]
struct YtDlpCollectionJson {
    id: Option<String>,
    title: Option<String>,
    webpage_url: Option<String>,
    entries: Option<Vec<Option<YtDlpEntryJson>>>,
}

#[derive(Debug, Deserialize)]
struct YtDlpEntryJson {
    id: Option<String>,
    title: Option<String>,
    url: Option<String>,
    webpage_url: Option<String>,
    original_url: Option<String>,
    playlist_index: Option<u64>,
    duration: Option<f64>,
    upload_date: Option<String>,
}

fn discover_collection_manifest(
    source: &YoutubeCollectionSource,
    max_items: Option<u64>,
) -> Result<YoutubeCollectionManifest> {
    let command = PathBuf::from("yt-dlp");
    if resolve_command(&command).is_none() {
        return Err(StudioError::Workflow(
            "yt-dlp is required for YouTube collection discovery".to_string(),
        ));
    }

    let output = Command::new("yt-dlp")
        .arg("--flat-playlist")
        .arg("-J")
        .arg(source.url())
        .output()?;
    if !output.status.success() {
        return Err(StudioError::Workflow(format!(
            "yt-dlp collection discovery failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let parsed: YtDlpCollectionJson = serde_json::from_slice(&output.stdout)
        .map_err(|err| StudioError::Workflow(err.to_string()))?;
    collection_manifest_from_yt_dlp(source.clone(), parsed, max_items)
}

fn collection_manifest_from_yt_dlp(
    source: YoutubeCollectionSource,
    parsed: YtDlpCollectionJson,
    max_items: Option<u64>,
) -> Result<YoutubeCollectionManifest> {
    let collection_id = sanitize_item_id(
        parsed
            .id
            .as_deref()
            .or(parsed.webpage_url.as_deref())
            .unwrap_or_else(|| source.url()),
    );
    let mut seen = BTreeMap::<String, u64>::new();
    let limit = max_items.unwrap_or(u64::MAX) as usize;
    let items = parsed
        .entries
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .take(limit)
        .enumerate()
        .map(|(index, entry)| {
            let mut item_id = entry
                .id
                .as_deref()
                .map(sanitize_item_id)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| format!("item-{}", index + 1));
            let count = seen.entry(item_id.clone()).or_insert(0);
            if *count > 0 {
                item_id = format!("{item_id}-{}", *count + 1);
            }
            *count += 1;
            YoutubeCollectionManifestItem {
                item_id,
                youtube_id: entry.id.clone(),
                playlist_index: entry.playlist_index.or(Some((index + 1) as u64)),
                title: entry.title.clone(),
                source_url: source_url_from_entry(&entry),
                duration_seconds: entry.duration,
                upload_date: entry.upload_date.clone(),
            }
        })
        .collect();

    Ok(YoutubeCollectionManifest {
        collection_id,
        source,
        title: parsed.title,
        items,
    })
}

fn enrich_manifest_items(manifest: &mut YoutubeCollectionManifest) -> Result<()> {
    let command = PathBuf::from("yt-dlp");
    if resolve_command(&command).is_none() {
        return Err(StudioError::Workflow(
            "yt-dlp is required for YouTube collection metadata enrichment".to_string(),
        ));
    }

    for item in &mut manifest.items {
        if item.duration_seconds.is_some() && item.upload_date.is_some() && item.title.is_some() {
            continue;
        }
        let output = Command::new("yt-dlp")
            .arg("--skip-download")
            .arg("--no-playlist")
            .arg("-J")
            .arg(&item.source_url)
            .output()?;
        if !output.status.success() {
            continue;
        }
        let Ok(entry) = serde_json::from_slice::<YtDlpEntryJson>(&output.stdout) else {
            continue;
        };
        if item.youtube_id.is_none() {
            item.youtube_id = entry.id;
        }
        if item.title.is_none() {
            item.title = entry.title;
        }
        if item.duration_seconds.is_none() {
            item.duration_seconds = entry.duration;
        }
        if item.upload_date.is_none() {
            item.upload_date = entry.upload_date;
        }
    }
    Ok(())
}

fn source_url_from_entry(entry: &YtDlpEntryJson) -> String {
    for value in [&entry.webpage_url, &entry.original_url, &entry.url]
        .into_iter()
        .flatten()
    {
        if value.starts_with("http://") || value.starts_with("https://") {
            return value.clone();
        }
    }
    if let Some(id) = entry.id.as_deref().or(entry.url.as_deref()) {
        return format!("https://www.youtube.com/watch?v={id}");
    }
    "https://www.youtube.com/".to_string()
}

fn find_existing_item_video(media_dir: &Path) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(media_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| is_video_file(path))
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
}

fn is_video_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "mp4" | "mkv" | "webm" | "mov")
    )
}

fn metadata_filter_matches(
    item: &YoutubeCollectionManifestItem,
    filter: &ManifestFilterSpec,
) -> bool {
    if let Some(needle) = filter.title_contains.as_deref().map(normalize_text_filter) {
        let title = item
            .title
            .as_deref()
            .map(normalize_text_filter)
            .unwrap_or_default();
        if !title.contains(&needle) {
            return false;
        }
    }
    let title = item
        .title
        .as_deref()
        .map(normalize_text_filter)
        .unwrap_or_default();
    for excluded in &filter.title_excludes {
        if !excluded.trim().is_empty() && title.contains(&normalize_text_filter(excluded)) {
            return false;
        }
    }
    if let Some(min) = filter.playlist_index_min {
        if item.playlist_index.unwrap_or(0) < min {
            return false;
        }
    }
    if let Some(max) = filter.playlist_index_max {
        if item.playlist_index.unwrap_or(u64::MAX) > max {
            return false;
        }
    }
    if let Some(min) = filter.duration_seconds_min {
        if item
            .duration_seconds
            .map(|duration| duration < min)
            .unwrap_or(true)
        {
            return false;
        }
    }
    if let Some(max) = filter.duration_seconds_max {
        if item
            .duration_seconds
            .map(|duration| duration > max)
            .unwrap_or(true)
        {
            return false;
        }
    }
    if let Some(from) = normalize_upload_date_filter(filter.upload_date_from.as_deref()) {
        if item
            .upload_date
            .as_deref()
            .and_then(|value| normalize_upload_date_filter(Some(value)))
            .map(|value| value < from)
            .unwrap_or(true)
        {
            return false;
        }
    }
    if let Some(to) = normalize_upload_date_filter(filter.upload_date_to.as_deref()) {
        if item
            .upload_date
            .as_deref()
            .and_then(|value| normalize_upload_date_filter(Some(value)))
            .map(|value| value > to)
            .unwrap_or(true)
        {
            return false;
        }
    }
    true
}

fn local_file_filter_matches(path: &Path, filter: &LocalFileFilterSpec) -> Result<bool> {
    let metadata = fs::metadata(path)?;
    if let Some(min) = filter.file_size_bytes_min {
        if metadata.len() < min {
            return Ok(false);
        }
    }
    if let Some(max) = filter.file_size_bytes_max {
        if metadata.len() > max {
            return Ok(false);
        }
    }
    if !filter.extension_allowlist.is_empty() {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
            .unwrap_or_default();
        let allowed = filter.extension_allowlist.iter().any(|allowed| {
            allowed
                .trim()
                .trim_start_matches('.')
                .eq_ignore_ascii_case(&extension)
        });
        if !allowed {
            return Ok(false);
        }
    }

    if filter.duration_seconds_min.is_some() || filter.duration_seconds_max.is_some() {
        let duration = probe_local_video_duration(path)?.ok_or_else(|| {
            StudioError::Workflow(format!(
                "could not read local video duration: {}",
                display_path(path)
            ))
        })?;
        if let Some(min) = filter.duration_seconds_min {
            if duration < min {
                return Ok(false);
            }
        }
        if let Some(max) = filter.duration_seconds_max {
            if duration > max {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

fn probe_local_video_duration(path: &Path) -> Result<Option<f64>> {
    let source = FfmpegVideoSource::open(path)?;
    Ok(source.metadata().duration_seconds)
}

fn collection_item_report(
    item: &YoutubeCollectionManifestItem,
    local_video: Option<&PathBuf>,
    status: CollectionItemStatus,
    error: Option<String>,
    report: Option<YoutubeVideoReport>,
) -> CollectionItemReport {
    CollectionItemReport {
        item_id: item.item_id.clone(),
        youtube_id: item.youtube_id.clone(),
        playlist_index: item.playlist_index,
        title: item.title.clone(),
        source_url: item.source_url.clone(),
        local_video: local_video.map(|path| display_path(path)),
        status,
        error,
        report,
    }
}

fn validate_manifest_filter(filter: &ManifestFilterSpec) -> Result<()> {
    validate_optional_nonnegative_f64(filter.duration_seconds_min, "duration_seconds_min")?;
    validate_optional_nonnegative_f64(filter.duration_seconds_max, "duration_seconds_max")?;
    if let (Some(min), Some(max)) = (filter.duration_seconds_min, filter.duration_seconds_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "duration_seconds_min must be less than or equal to duration_seconds_max"
                    .to_string(),
            ));
        }
    }
    if let (Some(min), Some(max)) = (filter.playlist_index_min, filter.playlist_index_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "playlist_index_min must be less than or equal to playlist_index_max".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_local_file_filter(filter: &LocalFileFilterSpec) -> Result<()> {
    validate_optional_nonnegative_f64(filter.duration_seconds_min, "duration_seconds_min")?;
    validate_optional_nonnegative_f64(filter.duration_seconds_max, "duration_seconds_max")?;
    if let (Some(min), Some(max)) = (filter.duration_seconds_min, filter.duration_seconds_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "local duration_seconds_min must be less than or equal to local duration_seconds_max"
                    .to_string(),
            ));
        }
    }
    if let (Some(min), Some(max)) = (filter.file_size_bytes_min, filter.file_size_bytes_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "file_size_bytes_min must be less than or equal to file_size_bytes_max".to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_optional_nonnegative_f64(value: Option<f64>, name: &str) -> Result<()> {
    if let Some(value) = value {
        if !value.is_finite() || value < 0.0 {
            return Err(StudioError::InvalidRequest(format!(
                "{name} must be finite and non-negative"
            )));
        }
    }
    Ok(())
}

fn manifest_filter_needs_enrichment(filter: &ManifestFilterSpec) -> bool {
    filter.duration_seconds_min.is_some()
        || filter.duration_seconds_max.is_some()
        || filter.upload_date_from.is_some()
        || filter.upload_date_to.is_some()
}

fn describe_manifest_filter(filter: &ManifestFilterSpec) -> Vec<String> {
    let mut descriptions = Vec::new();
    if let Some(value) = filter
        .title_contains
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        descriptions.push(format!("title contains '{value}'"));
    }
    for value in &filter.title_excludes {
        if !value.trim().is_empty() {
            descriptions.push(format!("title excludes '{value}'"));
        }
    }
    if let Some(value) = filter.playlist_index_min {
        descriptions.push(format!("playlist index >= {value}"));
    }
    if let Some(value) = filter.playlist_index_max {
        descriptions.push(format!("playlist index <= {value}"));
    }
    if let Some(value) = filter.upload_date_from.as_deref() {
        descriptions.push(format!("upload date >= {value}"));
    }
    if let Some(value) = filter.upload_date_to.as_deref() {
        descriptions.push(format!("upload date <= {value}"));
    }
    if let Some(value) = filter.duration_seconds_min {
        descriptions.push(format!("duration >= {value}s"));
    }
    if let Some(value) = filter.duration_seconds_max {
        descriptions.push(format!("duration <= {value}s"));
    }
    descriptions.push(format!(
        "already downloaded: {:?}",
        filter.already_downloaded
    ));
    descriptions
}

fn describe_local_file_filter(filter: &LocalFileFilterSpec) -> Vec<String> {
    let mut descriptions = Vec::new();
    if let Some(value) = filter.duration_seconds_min {
        descriptions.push(format!("local duration >= {value}s"));
    }
    if let Some(value) = filter.duration_seconds_max {
        descriptions.push(format!("local duration <= {value}s"));
    }
    if let Some(value) = filter.file_size_bytes_min {
        descriptions.push(format!("file size >= {value} bytes"));
    }
    if let Some(value) = filter.file_size_bytes_max {
        descriptions.push(format!("file size <= {value} bytes"));
    }
    if !filter.extension_allowlist.is_empty() {
        descriptions.push(format!(
            "extensions: {}",
            filter.extension_allowlist.join(", ")
        ));
    }
    descriptions.push(format!("failed probe: {:?}", filter.failed_probe_behavior));
    descriptions
}

fn normalize_text_filter(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_upload_date_filter(value: Option<&str>) -> Option<String> {
    let normalized = value?
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if normalized.len() == 8 {
        Some(normalized)
    } else {
        None
    }
}

fn sanitize_item_id(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    while sanitized.contains("--") {
        sanitized = sanitized.replace("--", "-");
    }
    if sanitized.is_empty() {
        "collection".to_string()
    } else {
        sanitized
    }
}

fn analyze_video(
    request: &YoutubeRunRequest,
    video_path: &Path,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
    cancellation: &RunCancellationToken,
) -> Result<(VideoReport, Vec<ObservationReport>)> {
    let mut source = FfmpegVideoSource::open(video_path)?;
    let metadata = source.metadata().clone();
    let mut pipeline = build_video_pipeline(request)?;

    while let Some(frame) = source.next_video_frame()? {
        cancellation.check()?;
        let frame_ref = frame.as_frame();
        let record = DataRecord::video_frame("video", frame.position.frame_index, &frame_ref);
        push_record(aggregator, record, data_buckets)?;
        pipeline.process_frame(frame)?;
        if request
            .max_frames
            .map(|limit| pipeline.frames_processed() >= limit)
            .unwrap_or(false)
        {
            break;
        }
    }

    let result = pipeline.finish_analysis()?;
    let observations = result
        .observations
        .iter()
        .map(observation_report)
        .collect::<Vec<_>>();
    let scenes = result
        .detection
        .scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let scene_observations = observations
                .iter()
                .filter(|observation| observation.scene_index == Some(index as u64))
                .cloned()
                .collect();
            SceneReport {
                index: index as u64,
                start_frame: scene.start.frame_index,
                end_frame: scene.end.frame_index,
                start_seconds: scene.start.timestamp.seconds(),
                end_seconds: scene.end.timestamp.seconds(),
                observations: scene_observations,
            }
        })
        .collect::<Vec<_>>();

    Ok((
        VideoReport {
            width: metadata.width,
            height: metadata.height,
            frame_rate: format!(
                "{}/{}",
                metadata.frame_rate.numer(),
                metadata.frame_rate.denom()
            ),
            duration_seconds: metadata.duration_seconds,
            frames_processed: result.frames_processed,
            scenes,
            observations: Vec::new(),
        },
        observations,
    ))
}

fn build_video_pipeline(request: &YoutubeRunRequest) -> Result<RealtimeVideoPipeline> {
    let mut builder = RealtimeVideoPipeline::builder()
        .scene_detector(ContentDetector::new(
            request.scene_threshold,
            request.min_scene_len,
        ))
        .start_in_scene(true);

    if let Some(command) = &request.models.object {
        let backend = ExternalCommandModel::new(
            &command.command,
            downloaded_external_model("object-command", ModelTask::ObjectDetection),
        )
        .args(command.args.clone());
        builder = builder.video_analyzer(SampledVideoAnalyzer::new(
            ModelVideoAnalyzer::new("object_person_detector", backend),
            request.visual_sample_every,
        ));
    }

    if let Some(command) = &request.models.ocr {
        let backend = ExternalCommandModel::new(
            &command.command,
            downloaded_external_model("ocr-command", ModelTask::Custom("ocr".to_string())),
        )
        .args(command.args.clone());
        builder = builder.video_analyzer(SampledVideoAnalyzer::new(
            ModelVideoAnalyzer::new("ocr", backend),
            request.visual_sample_every,
        ));
    }

    builder.build().map_err(Into::into)
}

fn analyze_audio(
    video_path: &Path,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
    cancellation: &RunCancellationToken,
) -> Result<AudioReport> {
    let mut source = FfmpegAudioSource::open_path_with_options(
        video_path,
        FfmpegAudioSourceOptions::recorded().samples_per_chunk(16_384),
    )?;
    let mut pipeline = video_analysis_core::AudioPipeline::builder()
        .analyzer(AudioEnergyAnalyzer::default())
        .build()?;
    while let Some(frame) = source.next_audio_frame()? {
        cancellation.check()?;
        let frame_ref = frame.as_frame()?;
        let record = DataRecord::audio_frame("audio", pipeline.frames_processed(), &frame_ref);
        push_record(aggregator, record, data_buckets)?;
        pipeline.process_frame(frame)?;
    }

    let result = pipeline.finish_analysis()?;
    Ok(AudioReport {
        status: "completed".to_string(),
        frames_processed: result.frames_processed,
        events: result.events.iter().map(event_report).collect(),
        message: None,
    })
}

fn analyze_transcript_text(
    request: &YoutubeRunRequest,
    transcription: &TranscriptionReport,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<TextReport> {
    if transcription.status != "completed" {
        return Ok(TextReport {
            status: "skipped".to_string(),
            segments_processed: 0,
            events: Vec::new(),
            message: Some("no transcript available".to_string()),
        });
    }

    let mut builder =
        video_analysis_core::TextPipeline::builder().analyzer(TranscriptHeuristicAnalyzer);
    if let Some(command) = &request.models.text {
        let backend = ExternalCommandModel::new(
            &command.command,
            downloaded_external_model(
                "text-command",
                ModelTask::Custom("text_classification".to_string()),
            ),
        )
        .args(command.args.clone());
        builder = builder.analyzer(ModelTextAnalyzer::new("transcript_text_model", backend));
    }
    let mut pipeline = builder.build()?;

    for segment in &transcription.segments {
        let owned = segment_to_owned_text_segment(&TranscriptSegment {
            index: segment.index,
            start_seconds: segment.start_seconds,
            end_seconds: segment.end_seconds,
            text: segment.text.clone(),
            language: None,
            speaker: None,
            confidence: None,
            is_final: true,
        });
        let segment_ref = owned.as_segment();
        push_record(
            aggregator,
            DataRecord::text_segment("transcript", &segment_ref),
            data_buckets,
        )?;
        pipeline.process_segment(owned)?;
    }

    let result = pipeline.finish_analysis()?;
    Ok(TextReport {
        status: "completed".to_string(),
        segments_processed: result.segments_processed,
        events: result.events.iter().map(event_report).collect(),
        message: None,
    })
}

fn downloaded_external_model(name: &str, task: ModelTask) -> DownloadedModel {
    DownloadedModel {
        spec: HuggingFaceModelSpec::new(name, task).name(name),
        files: BTreeMap::new(),
    }
}

fn observation_report(observation: &Observation) -> ObservationReport {
    ObservationReport {
        timestamp_seconds: observation.timestamp.map(|timestamp| timestamp.seconds()),
        frame_index: observation.frame.map(|position| position.frame_index),
        scene_index: observation.scene_index,
        analyzer: observation.analyzer.clone(),
        kind: observation_kind_name(&observation.kind),
        label: observation.label.clone(),
        text: observation.text.clone(),
        score: observation.score,
        region: observation.region.map(region_report),
        track_id: observation.track_id.clone(),
        attributes: observation.attributes.clone(),
    }
}

fn observation_kind_name(kind: &ObservationKind) -> String {
    match kind {
        ObservationKind::Text => "text".to_string(),
        ObservationKind::Face => "face".to_string(),
        ObservationKind::Object => "object".to_string(),
        ObservationKind::Scene => "scene".to_string(),
        ObservationKind::Custom(value) => value.clone(),
    }
}

fn region_report(region: BoundingBox) -> RegionReport {
    RegionReport {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
    }
}

fn event_report(event: &AnalysisEvent) -> EventReport {
    EventReport {
        timestamp_seconds: event.timestamp.map(|timestamp| timestamp.seconds()),
        analyzer: event.analyzer.clone(),
        label: event.label.clone(),
        score: event.score,
    }
}

fn bucket_report(bucket: &DataBucket) -> DataBucketReport {
    DataBucketReport {
        bucket_index: bucket.bucket_index,
        records: bucket.records,
        estimated_bytes: bucket.estimated_bytes,
        streams: bucket
            .streams
            .iter()
            .map(|(stream_id, summary)| stream_bucket_report(stream_id, summary))
            .collect(),
    }
}

fn push_record(
    aggregator: &mut BucketAggregator,
    record: DataRecord<'_>,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<()> {
    for bucket in aggregator.push(record)? {
        data_buckets.push(bucket_report(&bucket));
    }
    Ok(())
}

fn stream_bucket_report(stream_id: &str, summary: &StreamSummary) -> StreamBucketReport {
    StreamBucketReport {
        stream_id: stream_id.to_string(),
        records: summary.records,
        estimated_bytes: summary.estimated_bytes,
        payload_counts: summary
            .payload_counts
            .iter()
            .map(|(kind, count)| (data_stream_kind_name(*kind), *count))
            .collect(),
        video_frames: summary.video.frames,
        audio_frames: summary.audio.frames,
        text_segments: summary.text.segments,
    }
}

fn data_stream_kind_name(kind: DataStreamKind) -> String {
    match kind {
        DataStreamKind::Video => "video".to_string(),
        DataStreamKind::Audio => "audio".to_string(),
        DataStreamKind::Text => "text".to_string(),
        DataStreamKind::Number => "number".to_string(),
        DataStreamKind::Vector => "vector".to_string(),
        DataStreamKind::Custom => "custom".to_string(),
    }
}

fn video_report_with_observations(
    mut video_report: VideoReport,
    observations: Vec<ObservationReport>,
) -> VideoReport {
    video_report.observations = observations;
    video_report
}

fn default_scene_threshold() -> f32 {
    DEFAULT_SCENE_THRESHOLD
}

fn default_min_scene_len() -> u64 {
    DEFAULT_MIN_SCENE_LEN
}

fn default_visual_sample_every() -> u64 {
    DEFAULT_VISUAL_SAMPLE_EVERY
}
