use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{Result, StudioError};
use crate::media::{prepare_transcription_config, validate_local_file, validate_youtube_url};
use crate::report::{
    CapabilityReport, MusicAnalysisReport, MusicFeatureReport, MusicSegmentReport,
    SongAnalysisReport, SongAssetReport, SongFingerprintQueryReport, SongIdentificationReport,
    SongMatchCandidateReport, SongMatchedSegmentReport, SongSourceReport,
};
use crate::run_manager::WorkflowProgress;
use crate::youtube::{
    package_external_command_config, package_source_spec, package_transcription_config,
    ExternalCommandConfig, SourceSpec, TranscriptionConfig,
};

const DEFAULT_IDENTIFICATION_MIN_SCORE: f32 = 0.82;
const DEFAULT_IDENTIFICATION_AMBIGUOUS_MARGIN: f32 = 0.03;
const DEFAULT_IDENTIFICATION_MAX_CANDIDATES: usize = 5;
const DEFAULT_WINDOW_SECONDS: f64 = 30.0;
const DEFAULT_HOP_SECONDS: f64 = 15.0;
const DEFAULT_MIN_BPM: f32 = 60.0;
const DEFAULT_MAX_BPM: f32 = 200.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongAnalysisRunRequest {
    pub source: SongSourceSpec,
    pub work_dir: Option<PathBuf>,
    #[serde(default)]
    pub catalog: SongCatalogConfig,
    #[serde(default)]
    pub identification: SongIdentificationConfig,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default)]
    pub music: MusicAnalysisConfig,
}

impl SongAnalysisRunRequest {
    pub fn validate(&self) -> Result<()> {
        match &self.source {
            SongSourceSpec::YoutubeUrl { url } => validate_youtube_url(url),
            SongSourceSpec::LocalFile { path } => validate_local_file(path),
        }?;
        self.identification.validate()?;
        self.music.validate()?;
        Ok(())
    }

    pub fn resolved_work_dir(&self, data_dir: &Path, run_id: Uuid) -> PathBuf {
        self.work_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("runs").join(run_id.to_string()))
    }

    pub fn resolved_catalog_path(&self, data_dir: &Path) -> PathBuf {
        self.catalog.resolved_path(data_dir)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SongSourceSpec {
    YoutubeUrl { url: String },
    LocalFile { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongCatalogConfig {
    pub db_path: Option<PathBuf>,
}

impl Default for SongCatalogConfig {
    fn default() -> Self {
        Self { db_path: None }
    }
}

impl SongCatalogConfig {
    pub fn resolved_path(&self, data_dir: &Path) -> PathBuf {
        self.db_path
            .clone()
            .unwrap_or_else(|| data_dir.join("song-catalog").join("catalog.sqlite3"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongIdentificationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_identification_min_score")]
    pub min_score: f32,
    #[serde(default = "default_identification_ambiguous_margin")]
    pub ambiguous_margin: f32,
    #[serde(default = "default_identification_max_candidates")]
    pub max_candidates: usize,
}

impl Default for SongIdentificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_score: DEFAULT_IDENTIFICATION_MIN_SCORE,
            ambiguous_margin: DEFAULT_IDENTIFICATION_AMBIGUOUS_MARGIN,
            max_candidates: DEFAULT_IDENTIFICATION_MAX_CANDIDATES,
        }
    }
}

impl SongIdentificationConfig {
    pub fn validate(&self) -> Result<()> {
        if !self.min_score.is_finite() || !(0.0..=1.0).contains(&self.min_score) {
            return Err(StudioError::InvalidRequest(
                "identification.min_score must be between 0 and 1".to_string(),
            ));
        }
        if !self.ambiguous_margin.is_finite() || self.ambiguous_margin < 0.0 {
            return Err(StudioError::InvalidRequest(
                "identification.ambiguous_margin must be non-negative".to_string(),
            ));
        }
        if self.max_candidates == 0 {
            return Err(StudioError::InvalidRequest(
                "identification.max_candidates must be positive".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MusicAnalysisConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub command: Option<ExternalCommandConfig>,
    #[serde(default = "default_window_seconds")]
    pub window_seconds: f64,
    #[serde(default = "default_hop_seconds")]
    pub hop_seconds: f64,
    #[serde(default = "default_min_bpm")]
    pub min_bpm: f32,
    #[serde(default = "default_max_bpm")]
    pub max_bpm: f32,
}

impl Default for MusicAnalysisConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            command: None,
            window_seconds: DEFAULT_WINDOW_SECONDS,
            hop_seconds: DEFAULT_HOP_SECONDS,
            min_bpm: DEFAULT_MIN_BPM,
            max_bpm: DEFAULT_MAX_BPM,
        }
    }
}

impl MusicAnalysisConfig {
    pub fn validate(&self) -> Result<()> {
        if !self.window_seconds.is_finite() || self.window_seconds <= 0.0 {
            return Err(StudioError::InvalidRequest(
                "music.window_seconds must be positive".to_string(),
            ));
        }
        if !self.hop_seconds.is_finite() || self.hop_seconds <= 0.0 {
            return Err(StudioError::InvalidRequest(
                "music.hop_seconds must be positive".to_string(),
            ));
        }
        if !self.min_bpm.is_finite() || !self.max_bpm.is_finite() || self.min_bpm >= self.max_bpm {
            return Err(StudioError::InvalidRequest(
                "music.min_bpm must be lower than music.max_bpm".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongCatalogImportRequest {
    pub catalog_db_path: Option<PathBuf>,
    pub items: Vec<SongCatalogImportItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongCatalogImportItem {
    pub source: SongSourceSpec,
    pub metadata: SongCatalogMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongCatalogMetadata {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub isrc: Option<String>,
    pub source_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongCatalogImportResponse {
    pub catalog_path: String,
    pub imported: u64,
    pub failed: u64,
    pub results: Vec<SongCatalogImportResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SongCatalogImportResult {
    pub index: u64,
    pub track_id: Option<String>,
    pub title: String,
    pub status: String,
    pub message: Option<String>,
}

pub fn run_song_analysis_workflow(
    mut request: SongAnalysisRunRequest,
    data_dir: PathBuf,
    work_dir: PathBuf,
    report_path: PathBuf,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<SongAnalysisReport> {
    request.validate()?;
    request.transcription = prepare_transcription_config(&request.transcription);
    if request.music.command.is_none() {
        request.music.command = Some(default_music_command());
    }
    let report = video_analysis_use_cases::song::run_song_analysis_workflow(
        package_song_analysis_request(&request),
        data_dir,
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

pub fn import_song_catalog_items(
    request: SongCatalogImportRequest,
    data_dir: PathBuf,
) -> Result<SongCatalogImportResponse> {
    let response = video_analysis_use_cases::song::import_song_catalog_items(
        package_song_catalog_import_request(&request),
        data_dir,
    )?;
    Ok(response.into())
}

fn default_music_command() -> ExternalCommandConfig {
    ExternalCommandConfig {
        command: PathBuf::from("python3"),
        args: vec!["scripts/song_music_analyzer.py".to_string()],
    }
}

fn package_song_source_spec(
    value: &SongSourceSpec,
) -> video_analysis_use_cases::youtube::SourceSpec {
    match value {
        SongSourceSpec::YoutubeUrl { url } => {
            package_source_spec(&SourceSpec::YoutubeUrl { url: url.clone() })
        }
        SongSourceSpec::LocalFile { path } => {
            package_source_spec(&SourceSpec::LocalFile { path: path.clone() })
        }
    }
}

fn package_song_catalog_config(
    value: &SongCatalogConfig,
) -> video_analysis_use_cases::song::SongCatalogConfig {
    video_analysis_use_cases::song::SongCatalogConfig {
        db_path: value.db_path.clone(),
    }
}

fn package_song_identification_config(
    value: &SongIdentificationConfig,
) -> video_analysis_use_cases::song::SongIdentificationConfig {
    video_analysis_use_cases::song::SongIdentificationConfig {
        enabled: value.enabled,
        min_score: value.min_score,
        ambiguous_margin: value.ambiguous_margin,
        max_candidates: value.max_candidates,
    }
}

fn package_music_analysis_config(
    value: &MusicAnalysisConfig,
) -> video_analysis_use_cases::song::MusicAnalysisConfig {
    video_analysis_use_cases::song::MusicAnalysisConfig {
        enabled: value.enabled,
        command: value.command.as_ref().map(package_external_command_config),
        window_seconds: value.window_seconds,
        hop_seconds: value.hop_seconds,
        min_bpm: value.min_bpm,
        max_bpm: value.max_bpm,
    }
}

fn package_song_analysis_request(
    value: &SongAnalysisRunRequest,
) -> video_analysis_use_cases::song::SongAnalysisRunRequest {
    video_analysis_use_cases::song::SongAnalysisRunRequest {
        source: package_song_source_spec(&value.source),
        work_dir: value.work_dir.clone(),
        catalog: package_song_catalog_config(&value.catalog),
        identification: package_song_identification_config(&value.identification),
        transcription: package_transcription_config(&value.transcription),
        music: package_music_analysis_config(&value.music),
    }
}

fn package_song_catalog_import_item(
    value: &SongCatalogImportItem,
) -> video_analysis_use_cases::song::SongCatalogImportItem {
    video_analysis_use_cases::song::SongCatalogImportItem {
        source: package_song_source_spec(&value.source),
        metadata: video_analysis_use_cases::song::SongCatalogMetadata {
            title: value.metadata.title.clone(),
            artist: value.metadata.artist.clone(),
            album: value.metadata.album.clone(),
            isrc: value.metadata.isrc.clone(),
            source_uri: value.metadata.source_uri.clone(),
        },
    }
}

fn package_song_catalog_import_request(
    value: &SongCatalogImportRequest,
) -> video_analysis_use_cases::song::SongCatalogImportRequest {
    video_analysis_use_cases::song::SongCatalogImportRequest {
        catalog_db_path: value.catalog_db_path.clone(),
        items: value
            .items
            .iter()
            .map(package_song_catalog_import_item)
            .collect(),
    }
}

impl From<video_analysis_use_cases::song::MusicFeatureReport> for MusicFeatureReport {
    fn from(value: video_analysis_use_cases::song::MusicFeatureReport) -> Self {
        Self {
            bpm: value.bpm,
            bpm_confidence: value.bpm_confidence,
            key: value.key,
            mode: value.mode,
            key_confidence: value.key_confidence,
        }
    }
}

impl From<video_analysis_use_cases::song::MusicSegmentReport> for MusicSegmentReport {
    fn from(value: video_analysis_use_cases::song::MusicSegmentReport) -> Self {
        Self {
            index: value.index,
            start_seconds: value.start_seconds,
            end_seconds: value.end_seconds,
            bpm: value.bpm,
            bpm_confidence: value.bpm_confidence,
            key: value.key,
            mode: value.mode,
            key_confidence: value.key_confidence,
        }
    }
}

impl From<video_analysis_use_cases::song::MusicAnalysisReport> for MusicAnalysisReport {
    fn from(value: video_analysis_use_cases::song::MusicAnalysisReport) -> Self {
        Self {
            status: value.status,
            global: value.global.map(Into::into),
            segments: value.segments.into_iter().map(Into::into).collect(),
            message: value.message,
        }
    }
}

impl From<video_analysis_use_cases::song::SongMatchedSegmentReport> for SongMatchedSegmentReport {
    fn from(value: video_analysis_use_cases::song::SongMatchedSegmentReport) -> Self {
        Self {
            query_start_seconds: value.query_start_seconds,
            catalog_start_seconds: value.catalog_start_seconds,
            duration_seconds: value.duration_seconds,
        }
    }
}

impl From<video_analysis_use_cases::song::SongMatchCandidateReport> for SongMatchCandidateReport {
    fn from(value: video_analysis_use_cases::song::SongMatchCandidateReport) -> Self {
        Self {
            track_id: value.track_id,
            title: value.title,
            artist: value.artist,
            album: value.album,
            isrc: value.isrc,
            source_uri: value.source_uri,
            duration_seconds: value.duration_seconds,
            score: value.score,
            matched_segment: value.matched_segment.map(Into::into),
        }
    }
}

impl From<video_analysis_use_cases::song::SongFingerprintQueryReport>
    for SongFingerprintQueryReport
{
    fn from(value: video_analysis_use_cases::song::SongFingerprintQueryReport) -> Self {
        Self {
            duration_seconds: value.duration_seconds,
            fingerprint: value.fingerprint,
            chunk_count: value.chunk_count,
        }
    }
}

impl From<video_analysis_use_cases::song::SongIdentificationReport> for SongIdentificationReport {
    fn from(value: video_analysis_use_cases::song::SongIdentificationReport) -> Self {
        Self {
            status: value.status,
            query: value.query.map(Into::into),
            catalog_path: value.catalog_path,
            top_match: value.top_match.map(Into::into),
            candidates: value.candidates.into_iter().map(Into::into).collect(),
            message: value.message,
        }
    }
}

impl From<video_analysis_use_cases::song::SongAnalysisReport> for SongAnalysisReport {
    fn from(value: video_analysis_use_cases::song::SongAnalysisReport) -> Self {
        Self {
            workflow: value.workflow,
            source: SongSourceReport {
                url: value.source.url,
                local_media: value.source.local_media,
            },
            assets: SongAssetReport {
                work_dir: value.assets.work_dir,
                report_path: value.assets.report_path,
                transcription_wav: value.assets.transcription_wav,
                music_analysis_wav: value.assets.music_analysis_wav,
            },
            capabilities: CapabilityReport {
                completed: value.capabilities.completed,
                skipped: value.capabilities.skipped,
            },
            identification: value.identification.into(),
            lyrics: value.lyrics.into(),
            music: value.music.into(),
            data_buckets: value.data_buckets.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<video_analysis_use_cases::song::SongCatalogImportResponse> for SongCatalogImportResponse {
    fn from(value: video_analysis_use_cases::song::SongCatalogImportResponse) -> Self {
        Self {
            catalog_path: value.catalog_path,
            imported: value.imported,
            failed: value.failed,
            results: value
                .results
                .into_iter()
                .map(|result| SongCatalogImportResult {
                    index: result.index,
                    track_id: result.track_id,
                    title: result.title,
                    status: result.status,
                    message: result.message,
                })
                .collect(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_identification_min_score() -> f32 {
    DEFAULT_IDENTIFICATION_MIN_SCORE
}

fn default_identification_ambiguous_margin() -> f32 {
    DEFAULT_IDENTIFICATION_AMBIGUOUS_MARGIN
}

fn default_identification_max_candidates() -> usize {
    DEFAULT_IDENTIFICATION_MAX_CANDIDATES
}

fn default_window_seconds() -> f64 {
    DEFAULT_WINDOW_SECONDS
}

fn default_hop_seconds() -> f64 {
    DEFAULT_HOP_SECONDS
}

fn default_min_bpm() -> f32 {
    DEFAULT_MIN_BPM
}

fn default_max_bpm() -> f32 {
    DEFAULT_MAX_BPM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_song_analysis_request() {
        let request = SongAnalysisRunRequest {
            source: SongSourceSpec::LocalFile {
                path: PathBuf::from("song.mp3"),
            },
            work_dir: Some(PathBuf::from("work")),
            catalog: SongCatalogConfig {
                db_path: Some(PathBuf::from("catalog.sqlite3")),
            },
            identification: SongIdentificationConfig::default(),
            transcription: TranscriptionConfig::default(),
            music: MusicAnalysisConfig::default(),
        };
        let json = serde_json::to_string(&request).unwrap();
        let parsed: SongAnalysisRunRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, request);
    }
}
