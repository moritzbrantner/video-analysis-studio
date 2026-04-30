use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Output, Stdio};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use text_analysis_transcription::{
    WhisperCppPhase, WhisperCppProgressEvent, WhisperCppTranscriber,
};
use video_analysis_ffmpeg::extract_wav;

use crate::error::{Result, StudioError};
use crate::media::prepare_transcription_config;
use crate::report::{TranscriptSegmentReport, TranscriptionReport};
use crate::run_manager::RunCancellationToken;
use crate::system::resolve_command;
use crate::youtube::{ExternalCommandConfig, TranscriptionConfig, TranscriptionEngine};

pub(crate) fn download_youtube_video(
    url: &str,
    work_dir: &Path,
    cancellation: &RunCancellationToken,
) -> Result<PathBuf> {
    download_youtube_video_to_dir(url, work_dir, "youtube-video", cancellation)
}

pub(crate) fn download_youtube_video_to_dir(
    url: &str,
    media_dir: &Path,
    output_stem: &str,
    cancellation: &RunCancellationToken,
) -> Result<PathBuf> {
    cancellation.check()?;
    let command = PathBuf::from("yt-dlp");
    if resolve_command(&command).is_none() {
        return Err(StudioError::Workflow(
            "yt-dlp is required for YouTube downloads".to_string(),
        ));
    }
    fs::create_dir_all(media_dir)?;

    let output_template = media_dir.join(format!("{output_stem}.%(ext)s"));
    let mut command = Command::new("yt-dlp");
    command
        .arg("--no-playlist")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(url);
    let output = run_output_with_cancel(command, cancellation)?;

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
    extract_wav(media_path, work_dir.join("audio.wav"), 16_000).map_err(Into::into)
}

pub(crate) fn extract_music_analysis_wav(media_path: &Path, work_dir: &Path) -> Result<PathBuf> {
    extract_wav(media_path, work_dir.join("music-analysis.wav"), 22_050).map_err(Into::into)
}

pub(crate) fn transcribe_media(
    config: &TranscriptionConfig,
    media_path: &Path,
    work_dir: &Path,
    cancellation: &RunCancellationToken,
    progress: &mut dyn FnMut(WhisperCppProgressEvent),
) -> Result<(TranscriptionReport, Option<PathBuf>)> {
    if !config.enabled {
        return Ok((
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some("disabled".to_string()),
            },
            None,
        ));
    }

    cancellation.check()?;
    let prepared = prepare_transcription_config(config);
    match extract_transcription_wav(media_path, work_dir).and_then(|audio_path| {
        cancellation.check()?;
        if prepared.engine == TranscriptionEngine::WhisperCpp {
            run_whisper_cpp_transcriber(&prepared, &audio_path, cancellation, progress)
        } else {
            let command = prepared.command.clone().ok_or_else(|| {
                StudioError::Workflow(default_transcriber_message(prepared.engine))
            })?;
            progress(WhisperCppProgressEvent {
                phase: WhisperCppPhase::Preparing,
                message: format!(
                    "running {} transcription",
                    transcription_engine_label(prepared.engine)
                ),
                progress: None,
            });
            run_transcriber_command(
                prepared.engine,
                &command,
                &audio_path,
                &work_dir.join("transcript"),
                cancellation,
            )
        }
    }) {
        Ok((report, audio_path)) => Ok((report, Some(audio_path))),
        Err(StudioError::Canceled(message)) => Err(StudioError::Canceled(message)),
        Err(err) => Ok((
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some(err.to_string()),
            },
            None,
        )),
    }
}

pub(crate) fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn write_json_report<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|err| StudioError::Workflow(format!("failed to encode report JSON: {err}")))?;
    fs::write(path, bytes)?;
    Ok(())
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
    cancellation: &RunCancellationToken,
) -> Result<(TranscriptionReport, PathBuf)> {
    fs::create_dir_all(output_dir)?;

    let mut command = Command::new(&config.command);
    command
        .args(&config.args)
        .arg(audio_path)
        .arg("--output_format")
        .arg("json")
        .arg("--output_dir")
        .arg(output_dir)
        .stdin(Stdio::null());
    let status = run_status_with_cancel(command, cancellation)?;
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
    cancellation: &RunCancellationToken,
    progress: &mut dyn FnMut(WhisperCppProgressEvent),
) -> Result<(TranscriptionReport, PathBuf)> {
    cancellation.check()?;
    let mut transcriber = WhisperCppTranscriber::new(config.whisper_cpp.clone());
    let parsed = transcriber
        .transcribe_with_progress(audio_path, progress)
        .map_err(|error| StudioError::Workflow(error.to_string()))?;
    cancellation.check()?;
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

pub(crate) fn run_output_with_cancel(
    mut command: Command,
    cancellation: &RunCancellationToken,
) -> Result<Output> {
    cancellation.check()?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    loop {
        cancellation.check().inspect_err(|_| {
            let _ = child.kill();
            let _ = child.wait();
        })?;
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map_err(Into::into);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub(crate) fn run_status_with_cancel(
    mut command: Command,
    cancellation: &RunCancellationToken,
) -> Result<ExitStatus> {
    cancellation.check()?;
    command.stdin(Stdio::null());
    let mut child = command.spawn()?;
    loop {
        cancellation.check().inspect_err(|_| {
            let _ = child.kill();
            let _ = child.wait();
        })?;
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
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
    let value: Value =
        serde_json::from_slice(bytes).map_err(|err| StudioError::Workflow(err.to_string()))?;
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
