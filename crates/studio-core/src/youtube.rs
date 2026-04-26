use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::media::{prepare_transcription_config, validate_local_file, validate_youtube_url};
use crate::report::{
    AppliedCollectionFilters, AssetReport, AudioReport, CapabilityReport, CollectionAssetReport,
    CollectionItemReport, CollectionItemStatus, CollectionSummary, DataBucketReport, EventReport,
    ObservationReport, RegionReport, SceneReport, SourceReport, StreamBucketReport, TextReport,
    TranscriptionReport, VideoReport, YoutubeCollectionReport, YoutubeCollectionSourceReport,
    YoutubeVideoReport,
};
use crate::run_manager::WorkflowProgress;
pub use video_analysis_use_cases::youtube::{WhisperCppConfig, WhisperCppModel};

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
    mut request: YoutubeRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<YoutubeVideoReport> {
    request.validate()?;
    request.transcription = prepare_transcription_config(&request.transcription);
    let report = video_analysis_use_cases::youtube::run_youtube_video_workflow_with_progress(
        package_youtube_run_request(&request),
        work_dir,
        report_path,
        &mut |event| {
            progress(WorkflowProgress::phase(
                "transcriber",
                event.phase.as_str(),
                event.message,
                event.progress,
            ));
        },
    )?;
    Ok(report.into())
}

pub fn discover_youtube_collection_manifest(
    request: YoutubeCollectionManifestRequest,
) -> Result<YoutubeCollectionManifest> {
    request.validate()?;
    let manifest = video_analysis_use_cases::youtube::discover_youtube_collection_manifest(
        package_youtube_collection_manifest_request(&request),
    )?;
    Ok(manifest.into())
}

pub fn run_youtube_collection_workflow(
    mut request: YoutubeCollectionRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<YoutubeCollectionReport> {
    request.validate()?;
    request.analysis.transcription = prepare_transcription_config(&request.analysis.transcription);
    let report = video_analysis_use_cases::youtube::run_youtube_collection_workflow_with_progress(
        package_youtube_collection_run_request(&request),
        work_dir,
        report_path,
        &mut |event| {
            progress(WorkflowProgress::phase(
                "transcriber",
                event.phase.as_str(),
                event.message,
                event.progress,
            ));
        },
    )?;
    Ok(report.into())
}

pub(crate) fn package_source_spec(
    value: &SourceSpec,
) -> video_analysis_use_cases::youtube::SourceSpec {
    match value {
        SourceSpec::YoutubeUrl { url } => {
            video_analysis_use_cases::youtube::SourceSpec::YoutubeUrl { url: url.clone() }
        }
        SourceSpec::LocalFile { path } => {
            video_analysis_use_cases::youtube::SourceSpec::LocalFile { path: path.clone() }
        }
    }
}

pub(crate) fn package_external_command_config(
    value: &ExternalCommandConfig,
) -> video_analysis_use_cases::youtube::ExternalCommandConfig {
    video_analysis_use_cases::youtube::ExternalCommandConfig {
        command: value.command.clone(),
        args: value.args.clone(),
    }
}

pub(crate) fn package_transcription_engine(
    value: TranscriptionEngine,
) -> video_analysis_use_cases::youtube::TranscriptionEngine {
    match value {
        TranscriptionEngine::WhisperCpp => {
            video_analysis_use_cases::youtube::TranscriptionEngine::WhisperCpp
        }
        TranscriptionEngine::Whisper => {
            video_analysis_use_cases::youtube::TranscriptionEngine::Whisper
        }
        TranscriptionEngine::FasterWhisper => {
            video_analysis_use_cases::youtube::TranscriptionEngine::FasterWhisper
        }
        TranscriptionEngine::WhisperX => {
            video_analysis_use_cases::youtube::TranscriptionEngine::WhisperX
        }
    }
}

pub(crate) fn package_transcription_config(
    value: &TranscriptionConfig,
) -> video_analysis_use_cases::youtube::TranscriptionConfig {
    video_analysis_use_cases::youtube::TranscriptionConfig {
        enabled: value.enabled,
        engine: package_transcription_engine(value.engine),
        command: value.command.as_ref().map(package_external_command_config),
        whisper_cpp: value.whisper_cpp.clone(),
    }
}

fn package_model_command_config(
    value: &ModelCommandConfig,
) -> video_analysis_use_cases::youtube::ModelCommandConfig {
    video_analysis_use_cases::youtube::ModelCommandConfig {
        object: value.object.as_ref().map(package_external_command_config),
        ocr: value.ocr.as_ref().map(package_external_command_config),
        text: value.text.as_ref().map(package_external_command_config),
    }
}

fn package_metadata_depth(
    value: MetadataDepth,
) -> video_analysis_use_cases::youtube::MetadataDepth {
    match value {
        MetadataDepth::Fast => video_analysis_use_cases::youtube::MetadataDepth::Fast,
        MetadataDepth::EnrichedWhenNeeded => {
            video_analysis_use_cases::youtube::MetadataDepth::EnrichedWhenNeeded
        }
        MetadataDepth::Full => video_analysis_use_cases::youtube::MetadataDepth::Full,
    }
}

fn package_already_downloaded_policy(
    value: AlreadyDownloadedPolicy,
) -> video_analysis_use_cases::youtube::AlreadyDownloadedPolicy {
    match value {
        AlreadyDownloadedPolicy::Include => {
            video_analysis_use_cases::youtube::AlreadyDownloadedPolicy::Include
        }
        AlreadyDownloadedPolicy::Skip => {
            video_analysis_use_cases::youtube::AlreadyDownloadedPolicy::Skip
        }
        AlreadyDownloadedPolicy::Reuse => {
            video_analysis_use_cases::youtube::AlreadyDownloadedPolicy::Reuse
        }
    }
}

fn package_manifest_filter_spec(
    value: &ManifestFilterSpec,
) -> video_analysis_use_cases::youtube::ManifestFilterSpec {
    video_analysis_use_cases::youtube::ManifestFilterSpec {
        title_contains: value.title_contains.clone(),
        title_excludes: value.title_excludes.clone(),
        playlist_index_min: value.playlist_index_min,
        playlist_index_max: value.playlist_index_max,
        upload_date_from: value.upload_date_from.clone(),
        upload_date_to: value.upload_date_to.clone(),
        duration_seconds_min: value.duration_seconds_min,
        duration_seconds_max: value.duration_seconds_max,
        already_downloaded: package_already_downloaded_policy(value.already_downloaded),
    }
}

fn package_failed_probe_behavior(
    value: FailedProbeBehavior,
) -> video_analysis_use_cases::youtube::FailedProbeBehavior {
    match value {
        FailedProbeBehavior::Failed => {
            video_analysis_use_cases::youtube::FailedProbeBehavior::Failed
        }
        FailedProbeBehavior::Include => {
            video_analysis_use_cases::youtube::FailedProbeBehavior::Include
        }
        FailedProbeBehavior::Filtered => {
            video_analysis_use_cases::youtube::FailedProbeBehavior::Filtered
        }
    }
}

fn package_local_file_filter_spec(
    value: &LocalFileFilterSpec,
) -> video_analysis_use_cases::youtube::LocalFileFilterSpec {
    video_analysis_use_cases::youtube::LocalFileFilterSpec {
        duration_seconds_min: value.duration_seconds_min,
        duration_seconds_max: value.duration_seconds_max,
        file_size_bytes_min: value.file_size_bytes_min,
        file_size_bytes_max: value.file_size_bytes_max,
        extension_allowlist: value.extension_allowlist.clone(),
        failed_probe_behavior: package_failed_probe_behavior(value.failed_probe_behavior),
    }
}

fn package_youtube_collection_source(
    value: &YoutubeCollectionSource,
) -> video_analysis_use_cases::youtube::YoutubeCollectionSource {
    match value {
        YoutubeCollectionSource::PlaylistUrl { url } => {
            video_analysis_use_cases::youtube::YoutubeCollectionSource::PlaylistUrl {
                url: url.clone(),
            }
        }
        YoutubeCollectionSource::ChannelUrl { url } => {
            video_analysis_use_cases::youtube::YoutubeCollectionSource::ChannelUrl {
                url: url.clone(),
            }
        }
        YoutubeCollectionSource::YoutubeUrl { url } => {
            video_analysis_use_cases::youtube::YoutubeCollectionSource::YoutubeUrl {
                url: url.clone(),
            }
        }
    }
}

fn package_youtube_run_options(
    value: &YoutubeRunOptions,
) -> video_analysis_use_cases::youtube::YoutubeRunOptions {
    video_analysis_use_cases::youtube::YoutubeRunOptions {
        scene_threshold: value.scene_threshold,
        min_scene_len: value.min_scene_len,
        max_frames: value.max_frames,
        visual_sample_every: value.visual_sample_every,
        transcription: package_transcription_config(&value.transcription),
        audio_separation: video_analysis_use_cases::youtube::AudioSeparationConfig::default(),
        models: package_model_command_config(&value.models),
    }
}

fn package_youtube_run_request(
    value: &YoutubeRunRequest,
) -> video_analysis_use_cases::youtube::YoutubeRunRequest {
    video_analysis_use_cases::youtube::YoutubeRunRequest {
        source: package_source_spec(&value.source),
        work_dir: value.work_dir.clone(),
        scene_threshold: value.scene_threshold,
        min_scene_len: value.min_scene_len,
        max_frames: value.max_frames,
        visual_sample_every: value.visual_sample_every,
        transcription: package_transcription_config(&value.transcription),
        audio_separation: video_analysis_use_cases::youtube::AudioSeparationConfig::default(),
        models: package_model_command_config(&value.models),
    }
}

fn package_youtube_collection_manifest_request(
    value: &YoutubeCollectionManifestRequest,
) -> video_analysis_use_cases::youtube::YoutubeCollectionManifestRequest {
    video_analysis_use_cases::youtube::YoutubeCollectionManifestRequest {
        source: package_youtube_collection_source(&value.source),
        metadata_filter: package_manifest_filter_spec(&value.metadata_filter),
        metadata_depth: package_metadata_depth(value.metadata_depth),
        max_items: value.max_items,
    }
}

fn package_youtube_collection_manifest(
    value: &YoutubeCollectionManifest,
) -> video_analysis_use_cases::youtube::YoutubeCollectionManifest {
    video_analysis_use_cases::youtube::YoutubeCollectionManifest {
        collection_id: value.collection_id.clone(),
        source: package_youtube_collection_source(&value.source),
        title: value.title.clone(),
        items: value
            .items
            .iter()
            .map(
                |item| video_analysis_use_cases::youtube::YoutubeCollectionManifestItem {
                    item_id: item.item_id.clone(),
                    youtube_id: item.youtube_id.clone(),
                    playlist_index: item.playlist_index,
                    title: item.title.clone(),
                    source_url: item.source_url.clone(),
                    duration_seconds: item.duration_seconds,
                    upload_date: item.upload_date.clone(),
                },
            )
            .collect(),
    }
}

fn package_youtube_collection_run_request(
    value: &YoutubeCollectionRunRequest,
) -> video_analysis_use_cases::youtube::YoutubeCollectionRunRequest {
    video_analysis_use_cases::youtube::YoutubeCollectionRunRequest {
        source: value.source.as_ref().map(package_youtube_collection_source),
        manifest: value
            .manifest
            .as_ref()
            .map(package_youtube_collection_manifest),
        metadata_filter: package_manifest_filter_spec(&value.metadata_filter),
        local_file_filter: package_local_file_filter_spec(&value.local_file_filter),
        analysis: package_youtube_run_options(&value.analysis),
        delete_filtered_downloads: value.delete_filtered_downloads,
        work_dir: value.work_dir.clone(),
        max_items: value.max_items,
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeCollectionSource> for YoutubeCollectionSource {
    fn from(value: video_analysis_use_cases::youtube::YoutubeCollectionSource) -> Self {
        match value {
            video_analysis_use_cases::youtube::YoutubeCollectionSource::PlaylistUrl { url } => {
                Self::PlaylistUrl { url }
            }
            video_analysis_use_cases::youtube::YoutubeCollectionSource::ChannelUrl { url } => {
                Self::ChannelUrl { url }
            }
            video_analysis_use_cases::youtube::YoutubeCollectionSource::YoutubeUrl { url } => {
                Self::YoutubeUrl { url }
            }
        }
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeCollectionManifestItem>
    for YoutubeCollectionManifestItem
{
    fn from(value: video_analysis_use_cases::youtube::YoutubeCollectionManifestItem) -> Self {
        Self {
            item_id: value.item_id,
            youtube_id: value.youtube_id,
            playlist_index: value.playlist_index,
            title: value.title,
            source_url: value.source_url,
            duration_seconds: value.duration_seconds,
            upload_date: value.upload_date,
        }
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeCollectionManifest>
    for YoutubeCollectionManifest
{
    fn from(value: video_analysis_use_cases::youtube::YoutubeCollectionManifest) -> Self {
        Self {
            collection_id: value.collection_id,
            source: value.source.into(),
            title: value.title,
            items: value.items.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::youtube::RegionReport> for RegionReport {
    fn from(value: video_analysis_use_cases::youtube::RegionReport) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

impl From<video_analysis_use_cases::youtube::ObservationReport> for ObservationReport {
    fn from(value: video_analysis_use_cases::youtube::ObservationReport) -> Self {
        Self {
            timestamp_seconds: value.timestamp_seconds,
            frame_index: value.frame_index,
            scene_index: value.scene_index,
            analyzer: value.analyzer,
            kind: value.kind,
            label: value.label,
            text: value.text,
            score: value.score,
            region: value.region.map(Into::into),
            track_id: value.track_id,
            attributes: value.attributes,
        }
    }
}

impl From<video_analysis_use_cases::youtube::SceneReport> for SceneReport {
    fn from(value: video_analysis_use_cases::youtube::SceneReport) -> Self {
        Self {
            index: value.index,
            start_frame: value.start_frame,
            end_frame: value.end_frame,
            start_seconds: value.start_seconds,
            end_seconds: value.end_seconds,
            observations: value.observations.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::youtube::EventReport> for EventReport {
    fn from(value: video_analysis_use_cases::youtube::EventReport) -> Self {
        Self {
            timestamp_seconds: value.timestamp_seconds,
            analyzer: value.analyzer,
            label: value.label,
            score: value.score,
        }
    }
}

impl From<video_analysis_use_cases::youtube::VideoReport> for VideoReport {
    fn from(value: video_analysis_use_cases::youtube::VideoReport) -> Self {
        Self {
            width: value.width,
            height: value.height,
            frame_rate: value.frame_rate,
            duration_seconds: value.duration_seconds,
            frames_processed: value.frames_processed,
            scenes: value.scenes.into_iter().map(Into::into).collect(),
            observations: value.observations.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::TranscriptSegmentReport>
    for crate::report::TranscriptSegmentReport
{
    fn from(value: video_analysis_use_cases::TranscriptSegmentReport) -> Self {
        Self {
            index: value.index,
            start_seconds: value.start_seconds,
            end_seconds: value.end_seconds,
            text: value.text,
        }
    }
}

impl From<video_analysis_use_cases::TranscriptionReport> for TranscriptionReport {
    fn from(value: video_analysis_use_cases::TranscriptionReport) -> Self {
        Self {
            status: value.status,
            text: value.text,
            segments: value.segments.into_iter().map(Into::into).collect(),
            message: value.message,
        }
    }
}

impl From<video_analysis_use_cases::youtube::AudioReport> for AudioReport {
    fn from(value: video_analysis_use_cases::youtube::AudioReport) -> Self {
        Self {
            status: value.status,
            frames_processed: value.frames_processed,
            events: value.events.into_iter().map(Into::into).collect(),
            message: value.message,
        }
    }
}

impl From<video_analysis_use_cases::youtube::TextReport> for TextReport {
    fn from(value: video_analysis_use_cases::youtube::TextReport) -> Self {
        Self {
            status: value.status,
            segments_processed: value.segments_processed,
            events: value.events.into_iter().map(Into::into).collect(),
            message: value.message,
        }
    }
}

impl From<video_analysis_use_cases::StreamBucketReport> for StreamBucketReport {
    fn from(value: video_analysis_use_cases::StreamBucketReport) -> Self {
        Self {
            stream_id: value.stream_id,
            records: value.records,
            estimated_bytes: value.estimated_bytes,
            payload_counts: value.payload_counts,
            video_frames: value.video_frames,
            audio_frames: value.audio_frames,
            text_segments: value.text_segments,
        }
    }
}

impl From<video_analysis_use_cases::DataBucketReport> for DataBucketReport {
    fn from(value: video_analysis_use_cases::DataBucketReport) -> Self {
        Self {
            bucket_index: value.bucket_index,
            records: value.records,
            estimated_bytes: value.estimated_bytes,
            streams: value.streams.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeVideoReport> for YoutubeVideoReport {
    fn from(value: video_analysis_use_cases::youtube::YoutubeVideoReport) -> Self {
        Self {
            workflow: value.use_case,
            source: SourceReport {
                url: value.source.url,
                local_video: value.source.local_video,
            },
            assets: AssetReport {
                work_dir: value.assets.work_dir,
                report_path: value.assets.report_path,
                audio_wav: value.assets.audio_wav,
            },
            capabilities: CapabilityReport {
                completed: value.capabilities.completed,
                skipped: value.capabilities.skipped,
            },
            video: value.video.into(),
            transcription: value.transcription.into(),
            audio: value.audio.into(),
            text: value.text.into(),
            data_buckets: value.data_buckets.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::youtube::CollectionSummary> for CollectionSummary {
    fn from(value: video_analysis_use_cases::youtube::CollectionSummary) -> Self {
        Self {
            collection_id: value.collection_id,
            title: value.title,
            source_url: value.source_url,
            discovered_items: value.discovered_items,
            selected_items: value.selected_items,
            analyzed_items: value.analyzed_items,
            failed_items: value.failed_items,
            filtered_items: value.filtered_items,
            skipped_items: value.skipped_items,
            downloaded_items: value.downloaded_items,
            total_duration_seconds: value.total_duration_seconds,
        }
    }
}

impl From<video_analysis_use_cases::youtube::AppliedCollectionFilters>
    for AppliedCollectionFilters
{
    fn from(value: video_analysis_use_cases::youtube::AppliedCollectionFilters) -> Self {
        Self {
            metadata: value.metadata,
            local_file: value.local_file,
        }
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeCollectionSourceReport>
    for YoutubeCollectionSourceReport
{
    fn from(value: video_analysis_use_cases::youtube::YoutubeCollectionSourceReport) -> Self {
        Self {
            kind: value.kind,
            url: value.url,
            title: value.title,
        }
    }
}

impl From<video_analysis_use_cases::youtube::CollectionItemStatus> for CollectionItemStatus {
    fn from(value: video_analysis_use_cases::youtube::CollectionItemStatus) -> Self {
        match value {
            video_analysis_use_cases::youtube::CollectionItemStatus::Discovered => Self::Discovered,
            video_analysis_use_cases::youtube::CollectionItemStatus::MetadataFiltered => {
                Self::MetadataFiltered
            }
            video_analysis_use_cases::youtube::CollectionItemStatus::Downloaded => Self::Downloaded,
            video_analysis_use_cases::youtube::CollectionItemStatus::FileFiltered => {
                Self::FileFiltered
            }
            video_analysis_use_cases::youtube::CollectionItemStatus::Analyzed => Self::Analyzed,
            video_analysis_use_cases::youtube::CollectionItemStatus::Failed => Self::Failed,
            video_analysis_use_cases::youtube::CollectionItemStatus::SkippedExisting => {
                Self::SkippedExisting
            }
        }
    }
}

impl From<video_analysis_use_cases::youtube::CollectionItemReport> for CollectionItemReport {
    fn from(value: video_analysis_use_cases::youtube::CollectionItemReport) -> Self {
        Self {
            item_id: value.item_id,
            youtube_id: value.youtube_id,
            playlist_index: value.playlist_index,
            title: value.title,
            source_url: value.source_url,
            local_video: value.local_video,
            status: value.status.into(),
            error: value.error,
            report: value.report.map(Into::into),
        }
    }
}

impl From<video_analysis_use_cases::youtube::YoutubeCollectionReport> for YoutubeCollectionReport {
    fn from(value: video_analysis_use_cases::youtube::YoutubeCollectionReport) -> Self {
        Self {
            workflow: value.workflow,
            collection: value.collection.into(),
            source: value.source.into(),
            filters: value.filters.into(),
            items: value.items.into_iter().map(Into::into).collect(),
            assets: CollectionAssetReport {
                work_dir: value.assets.work_dir,
                report_path: value.assets.report_path,
                manifest_path: value.assets.manifest_path,
            },
            capabilities: CapabilityReport {
                completed: value.capabilities.completed,
                skipped: value.capabilities.skipped,
            },
        }
    }
}

fn validate_manifest_filter(filter: &ManifestFilterSpec) -> Result<()> {
    if let (Some(min), Some(max)) = (filter.playlist_index_min, filter.playlist_index_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "metadata_filter.playlist_index_min must be less than or equal to playlist_index_max"
                    .to_string(),
            ));
        }
    }
    validate_optional_nonnegative_f64(
        filter.duration_seconds_min,
        "metadata_filter.duration_seconds_min",
    )?;
    validate_optional_nonnegative_f64(
        filter.duration_seconds_max,
        "metadata_filter.duration_seconds_max",
    )?;
    if let (Some(min), Some(max)) = (filter.duration_seconds_min, filter.duration_seconds_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "metadata_filter.duration_seconds_min must be less than or equal to duration_seconds_max"
                    .to_string(),
            ));
        }
    }
    Ok(())
}

fn validate_local_file_filter(filter: &LocalFileFilterSpec) -> Result<()> {
    validate_optional_nonnegative_f64(
        filter.duration_seconds_min,
        "local_file_filter.duration_seconds_min",
    )?;
    validate_optional_nonnegative_f64(
        filter.duration_seconds_max,
        "local_file_filter.duration_seconds_max",
    )?;
    if let (Some(min), Some(max)) = (filter.duration_seconds_min, filter.duration_seconds_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "local_file_filter.duration_seconds_min must be less than or equal to duration_seconds_max"
                    .to_string(),
            ));
        }
    }
    if let (Some(min), Some(max)) = (filter.file_size_bytes_min, filter.file_size_bytes_max) {
        if min > max {
            return Err(StudioError::InvalidRequest(
                "local_file_filter.file_size_bytes_min must be less than or equal to file_size_bytes_max"
                    .to_string(),
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

fn default_scene_threshold() -> f32 {
    DEFAULT_SCENE_THRESHOLD
}

fn default_min_scene_len() -> u64 {
    DEFAULT_MIN_SCENE_LEN
}

fn default_visual_sample_every() -> u64 {
    DEFAULT_VISUAL_SAMPLE_EVERY
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_youtube_urls() {
        assert!(validate_youtube_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert!(validate_youtube_url("https://youtu.be/abc").is_ok());
        assert!(validate_youtube_url("ftp://youtube.com/watch?v=abc").is_err());
        assert!(validate_youtube_url("https://example.com/watch?v=abc").is_err());
    }

    #[test]
    fn rejects_empty_local_file_request() {
        let request = YoutubeRunRequest::local_file(PathBuf::new());
        assert!(request.validate().is_err());
    }
}
