use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::media::{prepare_transcription_config, validate_local_file, validate_youtube_url};
use crate::report::{
    CapabilityReport, SourceReport, SubtitleAssetReport, SubtitleGenerationReport, SubtitleReport,
};
use crate::run_manager::WorkflowProgress;
use crate::youtube::{
    package_source_spec, package_transcription_config, SourceSpec, TranscriptionConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubtitleGenerationRunRequest {
    pub source: SourceSpec,
    pub work_dir: Option<PathBuf>,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default = "default_overwrite")]
    pub overwrite: bool,
}

impl SubtitleGenerationRunRequest {
    pub fn local_file(path: impl Into<PathBuf>) -> Self {
        Self {
            source: SourceSpec::LocalFile { path: path.into() },
            work_dir: None,
            transcription: TranscriptionConfig::default(),
            overwrite: true,
        }
    }

    pub fn validate(&self) -> Result<()> {
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

pub fn run_subtitle_generation_workflow(
    mut request: SubtitleGenerationRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<SubtitleGenerationReport> {
    request.validate()?;
    request.transcription = prepare_transcription_config(&request.transcription);
    let report = video_analysis_use_cases::subtitle::run_subtitle_generation_workflow(
        package_subtitle_generation_request(&request),
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

fn package_subtitle_generation_request(
    value: &SubtitleGenerationRunRequest,
) -> video_analysis_use_cases::subtitle::SubtitleGenerationRunRequest {
    video_analysis_use_cases::subtitle::SubtitleGenerationRunRequest {
        source: package_source_spec(&value.source),
        work_dir: value.work_dir.clone(),
        transcription: package_transcription_config(&value.transcription),
        overwrite: value.overwrite,
    }
}

impl From<video_analysis_use_cases::subtitle::SubtitleGenerationReport>
    for SubtitleGenerationReport
{
    fn from(value: video_analysis_use_cases::subtitle::SubtitleGenerationReport) -> Self {
        Self {
            workflow: value.workflow,
            source: SourceReport {
                url: value.source.url,
                local_video: value.source.local_video,
            },
            assets: SubtitleAssetReport {
                work_dir: value.assets.work_dir,
                report_path: value.assets.report_path,
                audio_wav: value.assets.audio_wav,
                subtitle_path: value.assets.subtitle_path,
            },
            capabilities: CapabilityReport {
                completed: value.capabilities.completed,
                skipped: value.capabilities.skipped,
            },
            transcription: value.transcription.into(),
            subtitle: SubtitleReport {
                format: value.subtitle.format,
                path: value.subtitle.path,
                segments: value.subtitle.segments,
                message: value.subtitle.message,
            },
        }
    }
}

fn default_overwrite() -> bool {
    true
}
