use std::io;

use thiserror::Error;

pub type Result<T> = std::result::Result<T, StudioError>;

#[derive(Debug, Error)]
pub enum StudioError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("dependency missing: {0}")]
    MissingDependency(String),
    #[error("run not found: {0}")]
    RunNotFound(String),
    #[error("report not found for run: {0}")]
    ReportNotFound(String),
    #[error("workflow failed: {0}")]
    Workflow(String),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

impl From<video_analysis_core::DetectError> for StudioError {
    fn from(value: video_analysis_core::DetectError) -> Self {
        match value {
            video_analysis_core::DetectError::InvalidArgument(message) => {
                Self::InvalidRequest(message)
            }
            other => Self::Workflow(other.to_string()),
        }
    }
}
