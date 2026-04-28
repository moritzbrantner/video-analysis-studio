use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use text_analysis_transcription::TranscriptSegment;

use crate::error::Result;
use crate::media::{prepare_transcription_config, validate_local_file, validate_youtube_url};
use crate::report::{
    CapabilityReport, SourceReport, SubtitleAssetReport, SubtitleGenerationReport, SubtitleReport,
};
use crate::run_manager::WorkflowProgress;
use crate::workflow_support::{
    display_path, download_youtube_video, transcribe_media, write_json_report,
};
use crate::youtube::{SourceSpec, TranscriptionConfig};

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
    std::fs::create_dir_all(&work_dir)?;

    let mut completed = Vec::new();
    let mut skipped = Vec::new();

    let (source_url, video_path) = match &request.source {
        SourceSpec::LocalFile { path } => (None, path.clone()),
        SourceSpec::YoutubeUrl { url } => {
            let path = download_youtube_video(url, &work_dir)?;
            completed.push("youtube_download".to_string());
            (Some(url.clone()), path)
        }
    };

    let subtitle_path = video_path.with_extension("srt");
    if subtitle_path.exists() && !request.overwrite {
        return Err(crate::error::StudioError::Workflow(format!(
            "subtitle file already exists: {}",
            subtitle_path.display()
        )));
    }

    let (transcription, audio_wav) = transcribe_media(
        &request.transcription,
        &video_path,
        &work_dir,
        &mut |event| {
            progress(WorkflowProgress::phase(
                "transcriber",
                event.phase.as_str(),
                event.message,
                event.progress,
            ));
        },
    );
    if transcription.status != "completed" {
        return Err(crate::error::StudioError::Workflow(format!(
            "subtitle generation requires completed transcription: {}",
            transcription.message.as_deref().unwrap_or("not available")
        )));
    }
    completed.push("transcription".to_string());

    write_srt_file(&subtitle_path, &transcription.segments)?;
    completed.push("subtitle_srt".to_string());
    if transcription.segments.is_empty() {
        skipped.push("subtitle content: transcript contained no segments".to_string());
    }

    let report = SubtitleGenerationReport {
        workflow: "subtitle_generation".to_string(),
        source: SourceReport {
            url: source_url,
            local_video: display_path(&video_path),
        },
        assets: SubtitleAssetReport {
            work_dir: display_path(&work_dir),
            report_path: display_path(&report_path),
            audio_wav: audio_wav.as_ref().map(|path| display_path(path)),
            subtitle_path: display_path(&subtitle_path),
        },
        capabilities: CapabilityReport { completed, skipped },
        subtitle: SubtitleReport {
            format: "srt".to_string(),
            path: display_path(&subtitle_path),
            segments: transcription.segments.len() as u64,
            message: Some("written next to source video".to_string()),
        },
        transcription,
    };

    write_json_report(&report_path, &report)?;
    Ok(report)
}

fn default_overwrite() -> bool {
    true
}

fn write_srt_file(path: &Path, segments: &[crate::report::TranscriptSegmentReport]) -> Result<()> {
    let segments = segments
        .iter()
        .map(|segment| TranscriptSegment {
            index: segment.index,
            start_seconds: segment.start_seconds,
            end_seconds: segment.end_seconds,
            text: segment.text.clone(),
            language: None,
            speaker: None,
            confidence: None,
            is_final: true,
        })
        .collect::<Vec<_>>();
    text_analysis_transcription::write_srt(path, &segments)
        .map_err(|err| crate::error::StudioError::Workflow(err.to_string()))
}
