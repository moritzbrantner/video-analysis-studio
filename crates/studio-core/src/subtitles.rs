use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Result, StudioError};
use crate::media::{
    display_path, download_youtube_video, transcribe_media, validate_local_file,
    validate_youtube_url,
};
use crate::report::{
    CapabilityReport, SourceReport, SubtitleAssetReport, SubtitleGenerationReport, SubtitleReport,
    TranscriptSegmentReport,
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
    request: SubtitleGenerationRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
) -> Result<SubtitleGenerationReport> {
    request.validate()?;
    fs::create_dir_all(&work_dir)?;

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

    let subtitle_path = subtitle_path_for_video(&video_path);
    if subtitle_path.exists() && !request.overwrite {
        return Err(StudioError::Workflow(format!(
            "subtitle file already exists: {}",
            subtitle_path.display()
        )));
    }

    let (transcription, audio_wav) =
        transcribe_media(&request.transcription, &video_path, &work_dir);
    if transcription.status != "completed" {
        return Err(StudioError::Workflow(format!(
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
        use_case: "subtitle_generation".to_string(),
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

fn subtitle_path_for_video(video_path: &Path) -> PathBuf {
    video_path.with_extension("srt")
}

fn write_srt_file(path: &Path, segments: &[TranscriptSegmentReport]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, srt_text(segments))?;
    Ok(())
}

fn srt_text(segments: &[TranscriptSegmentReport]) -> String {
    let mut output = String::new();
    for (index, segment) in segments.iter().enumerate() {
        let start = segment.start_seconds.unwrap_or(0.0);
        let end = segment
            .end_seconds
            .unwrap_or_else(|| (start + 2.0).max(start));
        output.push_str(&(index + 1).to_string());
        output.push('\n');
        output.push_str(&format_srt_timestamp(start));
        output.push_str(" --> ");
        output.push_str(&format_srt_timestamp(end.max(start)));
        output.push('\n');
        output.push_str(segment.text.trim());
        output.push_str("\n\n");
    }
    output
}

fn format_srt_timestamp(seconds: f64) -> String {
    let total_millis = (seconds.max(0.0) * 1_000.0).round() as u64;
    let millis = total_millis % 1_000;
    let total_seconds = total_millis / 1_000;
    let secs = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let minutes = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{hours:02}:{minutes:02}:{secs:02},{millis:03}")
}

fn write_json_report<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtitle_path_reuses_video_folder_and_stem() {
        assert_eq!(
            subtitle_path_for_video(Path::new("/tmp/source/video.final.mp4")),
            PathBuf::from("/tmp/source/video.final.srt")
        );
    }

    #[test]
    fn srt_text_formats_whisper_segments() {
        let text = srt_text(&[
            TranscriptSegmentReport {
                index: 0,
                start_seconds: Some(1.25),
                end_seconds: Some(3.5),
                text: "Hello".to_string(),
            },
            TranscriptSegmentReport {
                index: 1,
                start_seconds: Some(63.0),
                end_seconds: Some(65.125),
                text: "World".to_string(),
            },
        ]);

        assert_eq!(
            text,
            "1\n00:00:01,250 --> 00:00:03,500\nHello\n\n2\n00:01:03,000 --> 00:01:05,125\nWorld\n\n"
        );
    }
}
