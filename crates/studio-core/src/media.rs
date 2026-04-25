use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::Value;
use text_analysis_transcription::{WhisperCppProgressEvent, WhisperCppTranscriber};

use crate::error::{Result, StudioError};
use crate::report::{TranscriptSegmentReport, TranscriptionReport};
use crate::run_manager::WorkflowProgress;
use crate::system::resolve_command;
use crate::youtube::{ExternalCommandConfig, TranscriptionConfig, TranscriptionEngine};

pub(crate) fn validate_youtube_url(url: &str) -> Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(StudioError::InvalidRequest(
            "YouTube URL is required".to_string(),
        ));
    }
    let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
    else {
        return Err(StudioError::InvalidRequest(
            "YouTube URL must use http or https".to_string(),
        ));
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split('@')
        .last()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let allowed = host == "youtu.be"
        || host == "youtube.com"
        || host == "www.youtube.com"
        || host == "m.youtube.com"
        || host.ends_with(".youtube.com");
    if !allowed {
        return Err(StudioError::InvalidRequest(format!(
            "unsupported YouTube URL host: {host}"
        )));
    }
    Ok(())
}

pub(crate) fn validate_local_file(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Err(StudioError::InvalidRequest(
            "local file path is required".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn download_youtube_video(url: &str, work_dir: &Path) -> Result<PathBuf> {
    download_youtube_video_to_dir(url, work_dir, "youtube-video")
}

pub(crate) fn download_youtube_video_to_dir(
    url: &str,
    media_dir: &Path,
    output_stem: &str,
) -> Result<PathBuf> {
    let command = PathBuf::from("yt-dlp");
    if resolve_command(&command).is_none() {
        return Err(StudioError::MissingDependency(
            "yt-dlp is required for YouTube downloads".to_string(),
        ));
    }
    fs::create_dir_all(media_dir)?;

    let output_template = media_dir.join(format!("{output_stem}.%(ext)s"));
    let output = Command::new("yt-dlp")
        .arg("--no-playlist")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(url)
        .output()?;

    if !output.status.success() {
        return Err(StudioError::Workflow(format!(
            "yt-dlp failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    for line in String::from_utf8_lossy(&output.stdout).lines().rev() {
        let path = PathBuf::from(line.trim());
        if path.exists() {
            return Ok(path);
        }
    }

    Err(StudioError::Workflow(
        "yt-dlp completed but no output file was found".to_string(),
    ))
}

pub(crate) fn extract_transcription_wav(media_path: &Path, work_dir: &Path) -> Result<PathBuf> {
    extract_wav(media_path, &work_dir.join("audio.wav"), 16_000)
}

pub(crate) fn extract_music_analysis_wav(media_path: &Path, work_dir: &Path) -> Result<PathBuf> {
    extract_wav(media_path, &work_dir.join("music-analysis.wav"), 22_050)
}

fn extract_wav(media_path: &Path, output_path: &Path, sample_rate: u32) -> Result<PathBuf> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(media_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg(sample_rate.to_string())
        .arg("-f")
        .arg("wav")
        .arg(output_path)
        .status()?;
    if !status.success() {
        return Err(StudioError::Workflow(format!(
            "ffmpeg failed to extract {} Hz audio",
            sample_rate
        )));
    }
    Ok(output_path.to_path_buf())
}

pub(crate) fn transcribe_media(
    config: &TranscriptionConfig,
    media_path: &Path,
    work_dir: &Path,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> (TranscriptionReport, Option<PathBuf>) {
    if !config.enabled {
        return (
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some("disabled".to_string()),
            },
            None,
        );
    }

    let prepared = prepare_transcription_config(config);
    match extract_transcription_wav(media_path, work_dir).and_then(|audio_path| {
        if prepared.engine == TranscriptionEngine::WhisperCpp {
            run_whisper_cpp_transcriber(&prepared, &audio_path, progress)
        } else {
            let command = prepared.command.clone().ok_or_else(|| {
                StudioError::MissingDependency(default_transcriber_message(prepared.engine))
            })?;
            progress(WorkflowProgress::message(
                "transcriber",
                format!(
                    "running {} transcription",
                    transcription_engine_label(prepared.engine)
                ),
            ));
            run_transcriber_command(
                prepared.engine,
                &command,
                &audio_path,
                &work_dir.join("transcript"),
            )
        }
    }) {
        Ok((report, audio_path)) => (report, Some(audio_path)),
        Err(err) => (
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some(err.to_string()),
            },
            None,
        ),
    }
}

pub(crate) fn prepare_transcription_config(
    config: &TranscriptionConfig,
) -> TranscriptionConfig {
    let mut prepared = config.clone().normalized();
    if !prepared.enabled || prepared.command.is_some() {
        return prepared;
    }

    prepared.command = default_transcriber_command(prepared.engine);
    prepared
}

fn default_transcriber_command(engine: TranscriptionEngine) -> Option<ExternalCommandConfig> {
    for default in default_transcriber_commands(engine) {
        if let Some(resolved) = resolve_command(&default) {
            return Some(ExternalCommandConfig {
                command: resolved,
                args: Vec::new(),
            });
        }
    }
    None
}

fn default_transcriber_commands(engine: TranscriptionEngine) -> Vec<PathBuf> {
    match engine {
        TranscriptionEngine::WhisperCpp => Vec::new(),
        TranscriptionEngine::Whisper => vec![PathBuf::from("whisper")],
        TranscriptionEngine::FasterWhisper => {
            vec![
                PathBuf::from("whisper-ctranslate2"),
                PathBuf::from("faster-whisper"),
            ]
        }
        TranscriptionEngine::WhisperX => vec![PathBuf::from("whisperx")],
    }
}

fn default_transcriber_message(engine: TranscriptionEngine) -> String {
    match engine {
        TranscriptionEngine::WhisperCpp => {
            "native whisper.cpp transcription is unavailable".to_string()
        }
        TranscriptionEngine::Whisper => "install whisper or configure a transcriber".to_string(),
        TranscriptionEngine::FasterWhisper => {
            "install whisper-ctranslate2/faster-whisper or configure a transcriber".to_string()
        }
        TranscriptionEngine::WhisperX => "install whisperx or configure a transcriber".to_string(),
    }
}

fn run_transcriber_command(
    engine: TranscriptionEngine,
    config: &ExternalCommandConfig,
    audio_path: &Path,
    output_dir: &Path,
) -> Result<(TranscriptionReport, PathBuf)> {
    fs::create_dir_all(output_dir)?;

    let status = Command::new(&config.command)
        .args(&config.args)
        .arg(audio_path)
        .arg("--output_format")
        .arg("json")
        .arg("--output_dir")
        .arg(output_dir)
        .stdin(Stdio::null())
        .status()?;
    if !status.success() {
        return Err(StudioError::Workflow(format!(
            "{} transcriber command `{}` failed",
            transcription_engine_label(engine),
            config.command.display()
        )));
    }

    let transcript_path = find_transcript_json(output_dir).ok_or_else(|| {
        StudioError::Workflow("transcriber completed but no JSON transcript was found".to_string())
    })?;
    let bytes = fs::read(&transcript_path)?;
    let mut report = parse_transcription_json(&bytes)?;
    report.message = Some(format!(
        "{}: {}",
        transcription_engine_label(engine),
        display_path(&transcript_path)
    ));
    Ok((report, audio_path.to_path_buf()))
}

fn run_whisper_cpp_transcriber(
    config: &TranscriptionConfig,
    audio_path: &Path,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<(TranscriptionReport, PathBuf)> {
    let mut transcriber = WhisperCppTranscriber::new(config.whisper_cpp.clone());
    let parsed = transcriber
        .transcribe_with_progress(audio_path, &mut |event| {
            progress(whisper_cpp_progress_event(event));
        })
        .map_err(|error| StudioError::Workflow(error.to_string()))?;
    Ok((
        TranscriptionReport {
            status: "completed".to_string(),
            text: parsed.text.map(|text| text.trim().to_string()),
            segments: parsed
                .segments
                .into_iter()
                .map(|segment| TranscriptSegmentReport {
                    index: segment.index,
                    start_seconds: segment.start_seconds,
                    end_seconds: segment.end_seconds,
                    text: segment.text.trim().to_string(),
                })
                .collect(),
            message: parsed.source,
        },
        audio_path.to_path_buf(),
    ))
}

fn whisper_cpp_progress_event(event: WhisperCppProgressEvent) -> WorkflowProgress {
    WorkflowProgress::phase(
        "transcriber",
        event.phase.as_str(),
        event.message,
        event.progress,
    )
}

fn transcription_engine_label(engine: TranscriptionEngine) -> &'static str {
    match engine {
        TranscriptionEngine::WhisperCpp => "whisper.cpp",
        TranscriptionEngine::Whisper => "whisper",
        TranscriptionEngine::FasterWhisper => "faster-whisper",
        TranscriptionEngine::WhisperX => "whisperx",
    }
}

fn find_transcript_json(output_dir: &Path) -> Option<PathBuf> {
    let mut entries = fs::read_dir(output_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    entries.sort();
    entries.pop()
}

fn parse_transcription_json(bytes: &[u8]) -> Result<TranscriptionReport> {
    let value: Value = serde_json::from_slice(bytes)?;
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .map(|text| text.trim().to_string());
    let segments_value = if value.is_array() {
        value.as_array()
    } else {
        value
            .get("segments")
            .and_then(Value::as_array)
            .or_else(|| value.get("transcription")?.get("segments")?.as_array())
    };
    let segments = segments_value
        .into_iter()
        .flatten()
        .filter_map(read_transcript_segment)
        .enumerate()
        .map(|(index, mut segment)| {
            segment.index = index as u64;
            segment
        })
        .collect::<Vec<_>>();
    let text = text.or_else(|| {
        let joined = segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        (!joined.is_empty()).then_some(joined)
    });
    Ok(TranscriptionReport {
        status: "completed".to_string(),
        text,
        segments,
        message: None,
    })
}

fn read_transcript_segment(value: &Value) -> Option<TranscriptSegmentReport> {
    let text = value.get("text")?.as_str()?.trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(TranscriptSegmentReport {
        index: 0,
        start_seconds: value.get("start").and_then(Value::as_f64),
        end_seconds: value.get("end").and_then(Value::as_f64),
        text,
    })
}

pub(crate) fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_json_segments() {
        let parsed = parse_transcription_json(
            br#"{"text":"hello world","segments":[{"start":0.0,"end":1.5,"text":" hello"}]}"#,
        )
        .unwrap();

        assert_eq!(parsed.text.as_deref(), Some("hello world"));
        assert_eq!(parsed.segments.len(), 1);
        assert_eq!(parsed.segments[0].start_seconds, Some(0.0));
    }

    #[test]
    fn parses_root_segment_array() {
        let parsed = parse_transcription_json(
            br#"[{"start":2.0,"end":4.0,"text":" first "},{"text":"second"}]"#,
        )
        .unwrap();

        assert_eq!(parsed.text.as_deref(), Some("first second"));
        assert_eq!(parsed.segments.len(), 2);
        assert_eq!(parsed.segments[0].end_seconds, Some(4.0));
    }
}
