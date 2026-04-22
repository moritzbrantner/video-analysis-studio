use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::youtube::ExternalCommandConfig;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SystemDependencyReport {
    pub dependencies: Vec<DependencyStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DependencyStatus {
    pub name: String,
    pub required: bool,
    pub available: bool,
    pub resolved_path: Option<PathBuf>,
    pub message: Option<String>,
}

pub fn check_system_dependencies(
    optional_commands: &[ExternalCommandConfig],
) -> SystemDependencyReport {
    let mut dependencies = ["ffmpeg", "ffprobe", "yt-dlp", "fpcalc", "python3"]
        .into_iter()
        .map(|name| dependency_status(name, true))
        .collect::<Vec<_>>();

    dependencies.push(dependency_status("whisper", false));
    for command in optional_commands {
        dependencies.push(dependency_status_for_path(&command.command, false));
    }

    SystemDependencyReport { dependencies }
}

pub(crate) fn resolve_command(command: &Path) -> Option<PathBuf> {
    if command.components().count() > 1 {
        return command.exists().then(|| command.to_path_buf());
    }

    let name = command.to_str()?;
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|dir| dir.join(name))
            .find(|path| path.is_file())
    })
}

fn dependency_status(name: &str, required: bool) -> DependencyStatus {
    dependency_status_for_path(Path::new(name), required)
}

fn dependency_status_for_path(command: &Path, required: bool) -> DependencyStatus {
    let resolved_path = resolve_command(command);
    let name = command.to_string_lossy().into_owned();
    let version_arg = if name.ends_with("yt-dlp") {
        "--version"
    } else {
        "-version"
    };
    let available = resolved_path
        .as_ref()
        .map(|path| {
            Command::new(path)
                .arg(version_arg)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(true)
        })
        .unwrap_or(false);
    let message = if available {
        dependency_warning_message(command, &name)
    } else if required {
        Some(format!("{name} is required"))
    } else {
        Some(format!("{name} is optional"))
    };
    DependencyStatus {
        name: name.clone(),
        required,
        available,
        resolved_path,
        message,
    }
}

fn dependency_warning_message(command: &Path, name: &str) -> Option<String> {
    if !name.ends_with("yt-dlp") {
        return None;
    }
    let output = Command::new(command)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.as_str() < "2026.03.17" {
        Some(format!(
            "yt-dlp {version} is installed; 2026.03.17 or newer is recommended for collection discovery"
        ))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_command_is_reported() {
        let report = check_system_dependencies(&[ExternalCommandConfig {
            command: PathBuf::from("__missing_video_analysis_studio_command__"),
            args: Vec::new(),
        }]);
        let missing = report
            .dependencies
            .iter()
            .find(|item| item.name == "__missing_video_analysis_studio_command__")
            .unwrap();
        assert!(!missing.available);
        assert!(!missing.required);
    }
}
