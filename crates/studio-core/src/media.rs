use std::path::{Path, PathBuf};

use crate::error::{Result, StudioError};
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

pub(crate) fn prepare_transcription_config(config: &TranscriptionConfig) -> TranscriptionConfig {
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
