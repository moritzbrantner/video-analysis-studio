use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use crate::data_sources::{
    data_source_catalog_path, DataSourceCatalog, DataSourceDerivationInput, DataSourceRecord,
    DataSourceUpsert,
};
use crate::error::{Result, StudioError};
use crate::report::StudioReport;
use crate::song::{
    import_song_catalog_items, run_song_analysis_workflow, SongAnalysisRunRequest,
    SongCatalogImportRequest, SongCatalogImportResponse,
};
use crate::subtitles::{run_subtitle_generation_workflow, SubtitleGenerationRunRequest};
use crate::youtube::{
    run_youtube_collection_workflow, run_youtube_video_workflow, YoutubeCollectionRunRequest,
    YoutubeRunRequest,
};

pub type RunId = Uuid;
const MAX_RUN_EVENT_HISTORY: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowKind {
    YoutubeVideo,
    YoutubeCollection,
    SongAnalysis,
    SubtitleGeneration,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunRecord {
    pub run_id: RunId,
    pub workflow: WorkflowKind,
    pub status: RunStatus,
    pub work_dir: PathBuf,
    pub report_path: PathBuf,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RunEvent {
    pub run_id: RunId,
    pub status: RunStatus,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Clone)]
pub struct RunManager {
    data_dir: PathBuf,
    inner: Arc<RunManagerInner>,
}

struct RunManagerInner {
    runs: Mutex<HashMap<RunId, RunState>>,
    data_sources: Mutex<()>,
}

struct RunState {
    record: RunRecord,
    events: broadcast::Sender<RunEvent>,
    history: VecDeque<RunEvent>,
}

impl RunManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            inner: Arc::new(RunManagerInner {
                runs: Mutex::new(HashMap::new()),
                data_sources: Mutex::new(()),
            }),
        }
    }

    pub async fn start_youtube_video(&self, request: YoutubeRunRequest) -> Result<RunRecord> {
        request.validate()?;
        let run_id = Uuid::new_v4();
        let work_dir = request.resolved_work_dir(&self.data_dir, run_id);
        let report_path = work_dir.join("analysis.json");
        let now = Utc::now();
        let record = RunRecord {
            run_id,
            workflow: WorkflowKind::YoutubeVideo,
            status: RunStatus::Pending,
            work_dir: work_dir.clone(),
            report_path: report_path.clone(),
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            message: Some("queued".to_string()),
        };
        let (events, _) = broadcast::channel(128);
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                },
            );
        }
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            handle.block_on(async {
                manager
                    .update_run(
                        run_id,
                        RunStatus::Running,
                        Some("running".to_string()),
                        false,
                    )
                    .await;
                manager.emit(run_id, RunStatus::Running, "running").await;
            });

            let result = run_youtube_video_workflow(request, work_dir, report_path);
            handle.block_on(async {
                match result {
                    Ok(_) => {
                        manager
                            .update_run(
                                run_id,
                                RunStatus::Succeeded,
                                Some("analysis completed".to_string()),
                                true,
                            )
                            .await;
                        manager
                            .emit(run_id, RunStatus::Succeeded, "analysis completed")
                            .await;
                    }
                    Err(error) => {
                        let message = error.to_string();
                        manager
                            .update_run(run_id, RunStatus::Failed, Some(message.clone()), true)
                            .await;
                        manager.emit(run_id, RunStatus::Failed, message).await;
                    }
                }
            });
        });

        Ok(record)
    }

    pub async fn start_youtube_collection(
        &self,
        request: YoutubeCollectionRunRequest,
    ) -> Result<RunRecord> {
        request.validate()?;
        let run_id = Uuid::new_v4();
        let work_dir = request.resolved_work_dir(&self.data_dir, run_id);
        let report_path = work_dir.join("collection-analysis.json");
        let now = Utc::now();
        let record = RunRecord {
            run_id,
            workflow: WorkflowKind::YoutubeCollection,
            status: RunStatus::Pending,
            work_dir: work_dir.clone(),
            report_path: report_path.clone(),
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            message: Some("queued".to_string()),
        };
        let (events, _) = broadcast::channel(128);
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                },
            );
        }
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            handle.block_on(async {
                manager
                    .update_run(
                        run_id,
                        RunStatus::Running,
                        Some("running collection workflow".to_string()),
                        false,
                    )
                    .await;
                manager
                    .emit(run_id, RunStatus::Running, "running collection workflow")
                    .await;
            });

            let result = run_youtube_collection_workflow(request, work_dir, report_path);
            handle.block_on(async {
                match result {
                    Ok(_) => {
                        manager
                            .update_run(
                                run_id,
                                RunStatus::Succeeded,
                                Some("collection analysis completed".to_string()),
                                true,
                            )
                            .await;
                        manager
                            .emit(
                                run_id,
                                RunStatus::Succeeded,
                                "collection analysis completed",
                            )
                            .await;
                    }
                    Err(error) => {
                        let message = error.to_string();
                        manager
                            .update_run(run_id, RunStatus::Failed, Some(message.clone()), true)
                            .await;
                        manager.emit(run_id, RunStatus::Failed, message).await;
                    }
                }
            });
        });

        Ok(record)
    }

    pub async fn start_song_analysis(&self, request: SongAnalysisRunRequest) -> Result<RunRecord> {
        request.validate()?;
        let run_id = Uuid::new_v4();
        let work_dir = request.resolved_work_dir(&self.data_dir, run_id);
        let report_path = work_dir.join("song-analysis.json");
        let data_dir = self.data_dir.clone();
        let now = Utc::now();
        let record = RunRecord {
            run_id,
            workflow: WorkflowKind::SongAnalysis,
            status: RunStatus::Pending,
            work_dir: work_dir.clone(),
            report_path: report_path.clone(),
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            message: Some("queued".to_string()),
        };
        let (events, _) = broadcast::channel(128);
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                },
            );
        }
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            handle.block_on(async {
                manager
                    .update_run(
                        run_id,
                        RunStatus::Running,
                        Some("running song analysis workflow".to_string()),
                        false,
                    )
                    .await;
                manager
                    .emit(run_id, RunStatus::Running, "running song analysis workflow")
                    .await;
            });

            let result = run_song_analysis_workflow(request, data_dir, work_dir, report_path);
            handle.block_on(async {
                match result {
                    Ok(_) => {
                        manager
                            .update_run(
                                run_id,
                                RunStatus::Succeeded,
                                Some("song analysis completed".to_string()),
                                true,
                            )
                            .await;
                        manager
                            .emit(run_id, RunStatus::Succeeded, "song analysis completed")
                            .await;
                    }
                    Err(error) => {
                        let message = error.to_string();
                        manager
                            .update_run(run_id, RunStatus::Failed, Some(message.clone()), true)
                            .await;
                        manager.emit(run_id, RunStatus::Failed, message).await;
                    }
                }
            });
        });

        Ok(record)
    }

    pub async fn start_subtitle_generation(
        &self,
        request: SubtitleGenerationRunRequest,
    ) -> Result<RunRecord> {
        request.validate()?;
        let run_id = Uuid::new_v4();
        let work_dir = request.resolved_work_dir(&self.data_dir, run_id);
        let report_path = work_dir.join("subtitle-generation.json");
        let now = Utc::now();
        let record = RunRecord {
            run_id,
            workflow: WorkflowKind::SubtitleGeneration,
            status: RunStatus::Pending,
            work_dir: work_dir.clone(),
            report_path: report_path.clone(),
            created_at: now,
            updated_at: now,
            started_at: None,
            finished_at: None,
            message: Some("queued".to_string()),
        };
        let (events, _) = broadcast::channel(128);
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                },
            );
        }
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            handle.block_on(async {
                manager
                    .update_run(
                        run_id,
                        RunStatus::Running,
                        Some("running subtitle generation workflow".to_string()),
                        false,
                    )
                    .await;
                manager
                    .emit(
                        run_id,
                        RunStatus::Running,
                        "running subtitle generation workflow",
                    )
                    .await;
            });

            let result = run_subtitle_generation_workflow(request, work_dir, report_path);
            handle.block_on(async {
                match result {
                    Ok(_) => {
                        manager
                            .update_run(
                                run_id,
                                RunStatus::Succeeded,
                                Some("subtitle generation completed".to_string()),
                                true,
                            )
                            .await;
                        manager
                            .emit(
                                run_id,
                                RunStatus::Succeeded,
                                "subtitle generation completed",
                            )
                            .await;
                    }
                    Err(error) => {
                        let message = error.to_string();
                        manager
                            .update_run(run_id, RunStatus::Failed, Some(message.clone()), true)
                            .await;
                        manager.emit(run_id, RunStatus::Failed, message).await;
                    }
                }
            });
        });

        Ok(record)
    }

    pub fn import_song_catalog_items(
        &self,
        request: SongCatalogImportRequest,
    ) -> Result<SongCatalogImportResponse> {
        import_song_catalog_items(request, self.data_dir.clone())
    }

    pub async fn get_run(&self, run_id: RunId) -> Result<RunRecord> {
        let runs = self.inner.runs.lock().await;
        runs.get(&run_id)
            .map(|state| state.record.clone())
            .ok_or_else(|| StudioError::RunNotFound(run_id.to_string()))
    }

    pub async fn get_report(&self, run_id: RunId) -> Result<StudioReport> {
        let run = self.get_run(run_id).await?;
        if !run.report_path.exists() {
            return Err(StudioError::ReportNotFound(run_id.to_string()));
        }
        let bytes = tokio::fs::read(&run.report_path).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub async fn cancel_run(&self, run_id: RunId) -> Result<()> {
        let mut runs = self.inner.runs.lock().await;
        let Some(state) = runs.get_mut(&run_id) else {
            return Err(StudioError::RunNotFound(run_id.to_string()));
        };
        if matches!(
            state.record.status,
            RunStatus::Succeeded | RunStatus::Failed
        ) {
            return Ok(());
        }
        let now = Utc::now();
        state.record.status = RunStatus::Canceled;
        state.record.updated_at = now;
        state.record.finished_at = Some(now);
        state.record.message = Some("canceled".to_string());
        let event = RunEvent {
            run_id,
            status: RunStatus::Canceled,
            message: "canceled".to_string(),
            timestamp: now,
        };
        push_event_history(&mut state.history, event.clone());
        let _ = state.events.send(event);
        Ok(())
    }

    pub async fn list_events(&self, run_id: RunId) -> Result<Vec<RunEvent>> {
        let runs = self.inner.runs.lock().await;
        runs.get(&run_id)
            .map(|state| state.history.iter().cloned().collect())
            .ok_or_else(|| StudioError::RunNotFound(run_id.to_string()))
    }

    pub async fn subscribe_events(&self, run_id: RunId) -> Result<broadcast::Receiver<RunEvent>> {
        let runs = self.inner.runs.lock().await;
        runs.get(&run_id)
            .map(|state| state.events.subscribe())
            .ok_or_else(|| StudioError::RunNotFound(run_id.to_string()))
    }

    pub async fn list_data_sources(&self) -> Result<Vec<DataSourceRecord>> {
        let _guard = self.inner.data_sources.lock().await;
        Ok(self.load_data_source_catalog()?.data_sources)
    }

    pub async fn create_data_source(&self, input: DataSourceUpsert) -> Result<DataSourceRecord> {
        let _guard = self.inner.data_sources.lock().await;
        let mut catalog = self.load_data_source_catalog()?;
        let record = catalog.create(input)?;
        self.save_data_source_catalog(&catalog)?;
        Ok(record)
    }

    pub async fn update_data_source(
        &self,
        current_id: &str,
        input: DataSourceUpsert,
    ) -> Result<DataSourceRecord> {
        let _guard = self.inner.data_sources.lock().await;
        let mut catalog = self.load_data_source_catalog()?;
        let record = catalog.update(current_id, input)?;
        self.save_data_source_catalog(&catalog)?;
        Ok(record)
    }

    pub async fn delete_data_source(&self, id: &str) -> Result<()> {
        let _guard = self.inner.data_sources.lock().await;
        let mut catalog = self.load_data_source_catalog()?;
        catalog.delete(id)?;
        self.save_data_source_catalog(&catalog)?;
        Ok(())
    }

    pub async fn create_data_source_derivation(
        &self,
        parent_id: &str,
        input: DataSourceDerivationInput,
    ) -> Result<DataSourceRecord> {
        let _guard = self.inner.data_sources.lock().await;
        let mut catalog = self.load_data_source_catalog()?;
        let record = catalog.create_derivation(parent_id, input)?;
        self.save_data_source_catalog(&catalog)?;
        Ok(record)
    }

    async fn update_run(
        &self,
        run_id: RunId,
        status: RunStatus,
        message: Option<String>,
        finished: bool,
    ) {
        let mut runs = self.inner.runs.lock().await;
        let Some(state) = runs.get_mut(&run_id) else {
            return;
        };
        if state.record.status == RunStatus::Canceled {
            return;
        }
        let now = Utc::now();
        state.record.status = status;
        state.record.updated_at = now;
        state.record.message = message;
        if status == RunStatus::Running && state.record.started_at.is_none() {
            state.record.started_at = Some(now);
        }
        if finished {
            state.record.finished_at = Some(now);
        }
    }

    async fn emit(&self, run_id: RunId, status: RunStatus, message: impl Into<String>) {
        let mut runs = self.inner.runs.lock().await;
        if let Some(state) = runs.get_mut(&run_id) {
            if state.record.status == RunStatus::Canceled
                && matches!(status, RunStatus::Succeeded | RunStatus::Failed)
            {
                return;
            }
            let event = RunEvent {
                run_id,
                status,
                message: message.into(),
                timestamp: Utc::now(),
            };
            push_event_history(&mut state.history, event.clone());
            let _ = state.events.send(event);
        }
    }

    fn load_data_source_catalog(&self) -> Result<DataSourceCatalog> {
        DataSourceCatalog::load(&data_source_catalog_path(&self.data_dir))
    }

    fn save_data_source_catalog(&self, catalog: &DataSourceCatalog) -> Result<()> {
        catalog.save(&data_source_catalog_path(&self.data_dir))
    }
}

fn push_event_history(history: &mut VecDeque<RunEvent>, event: RunEvent) {
    if history.len() == MAX_RUN_EVENT_HISTORY {
        history.pop_front();
    }
    history.push_back(event);
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn missing_report_returns_not_found() {
        let dir = tempdir().unwrap();
        let manager = RunManager::new(dir.path().to_path_buf());
        let run = manager
            .start_youtube_video(YoutubeRunRequest::local_file(
                dir.path().join("missing.mp4"),
            ))
            .await
            .unwrap();

        let error = manager.get_report(run.run_id).await.unwrap_err();
        assert!(matches!(error, StudioError::ReportNotFound(_)));
    }

    #[tokio::test]
    async fn cancel_run_stores_status_and_event() {
        let dir = tempdir().unwrap();
        let manager = RunManager::new(dir.path().to_path_buf());
        let run = manager
            .start_youtube_video(YoutubeRunRequest::local_file(
                dir.path().join("missing.mp4"),
            ))
            .await
            .unwrap();

        manager.cancel_run(run.run_id).await.unwrap();

        let record = manager.get_run(run.run_id).await.unwrap();
        assert_eq!(record.status, RunStatus::Canceled);
        let events = manager.list_events(run.run_id).await.unwrap();
        assert!(events
            .iter()
            .any(|event| event.status == RunStatus::Canceled && event.message == "canceled"));
    }

    #[tokio::test]
    async fn terminal_worker_update_does_not_overwrite_canceled_record() {
        let dir = tempdir().unwrap();
        let manager = RunManager::new(dir.path().to_path_buf());
        let run = manager
            .start_youtube_video(YoutubeRunRequest::local_file(
                dir.path().join("missing.mp4"),
            ))
            .await
            .unwrap();

        manager.cancel_run(run.run_id).await.unwrap();
        manager
            .update_run(
                run.run_id,
                RunStatus::Succeeded,
                Some("analysis completed".to_string()),
                true,
            )
            .await;
        manager
            .emit(run.run_id, RunStatus::Succeeded, "analysis completed")
            .await;

        let record = manager.get_run(run.run_id).await.unwrap();
        assert_eq!(record.status, RunStatus::Canceled);
        let events = manager.list_events(run.run_id).await.unwrap();
        assert!(!events
            .iter()
            .any(|event| event.status == RunStatus::Succeeded));
    }
}
