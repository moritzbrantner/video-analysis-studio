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
    let mut dependencies = ["ffmpeg", "ffprobe", "yt-dlp"]
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
    let available = resolved_path
        .as_ref()
        .map(|path| {
            Command::new(path)
                .arg("-version")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(true)
        })
        .unwrap_or(false);
    let name = command.to_string_lossy().into_owned();
    DependencyStatus {
        name: name.clone(),
        required,
        available,
        resolved_path,
        message: if available {
            None
        } else if required {
            Some(format!("{name} is required"))
        } else {
            Some(format!("{name} is optional"))
        },
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
