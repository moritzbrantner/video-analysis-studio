use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
use crate::red_cars::{run_video_red_cars_workflow, VideoRedCarsRunRequest};
use crate::report::StudioReport;
use crate::run_store::{RunListFilter, RunStore};
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
pub(crate) const MAX_RUN_EVENT_HISTORY: usize = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowKind {
    YoutubeVideo,
    VideoRedCars,
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
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub progress: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowProgress {
    pub node: String,
    pub message: String,
    pub phase: Option<String>,
    pub progress: Option<f32>,
}

impl WorkflowProgress {
    pub fn message(node: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            node: node.into(),
            message: message.into(),
            phase: None,
            progress: None,
        }
    }

    pub fn phase(
        node: impl Into<String>,
        phase: impl Into<String>,
        message: impl Into<String>,
        progress: Option<f32>,
    ) -> Self {
        Self {
            node: node.into(),
            message: message.into(),
            phase: Some(phase.into()),
            progress,
        }
    }
}

#[derive(Clone)]
pub struct RunCancellationToken {
    inner: Arc<AtomicBool>,
}

impl RunCancellationToken {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.inner.store(true, Ordering::SeqCst);
    }

    pub fn is_canceled(&self) -> bool {
        self.inner.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<()> {
        if self.is_canceled() {
            return Err(StudioError::Canceled("run canceled".to_string()));
        }
        Ok(())
    }
}

impl Default for RunCancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct RunManager {
    data_dir: PathBuf,
    inner: Arc<RunManagerInner>,
}

struct RunManagerInner {
    runs: Mutex<HashMap<RunId, RunState>>,
    data_sources: Mutex<()>,
    run_store: RunStore,
}

struct RunState {
    record: RunRecord,
    events: broadcast::Sender<RunEvent>,
    history: VecDeque<RunEvent>,
    cancellation: RunCancellationToken,
}

impl RunManager {
    pub fn new(data_dir: PathBuf) -> Self {
        let run_store = RunStore::new(&data_dir);
        let runs = hydrate_run_states(&run_store);
        Self {
            data_dir,
            inner: Arc::new(RunManagerInner {
                runs: Mutex::new(runs),
                data_sources: Mutex::new(()),
                run_store,
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
        let cancellation = RunCancellationToken::new();
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        self.persist_run(&record);
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        let worker_cancellation = cancellation.clone();
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

            let mut progress = |event: WorkflowProgress| {
                handle.block_on(async {
                    manager
                        .emit_workflow_progress(run_id, RunStatus::Running, event)
                        .await;
                });
            };
            let result = run_youtube_video_workflow(
                request,
                work_dir,
                report_path,
                worker_cancellation,
                &mut progress,
            );
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
                    Err(StudioError::Canceled(message)) => {
                        manager.mark_canceled_if_needed(run_id, message).await;
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

    pub async fn start_video_red_cars(&self, request: VideoRedCarsRunRequest) -> Result<RunRecord> {
        request.validate()?;
        let target_object = request.target_object.trim().to_string();
        let target_object = if target_object.is_empty() {
            "car".to_string()
        } else {
            target_object
        };
        let running_message = format!("running red {} workflow", target_object);
        let completed_message = format!("red {} analysis completed", target_object);
        let run_id = Uuid::new_v4();
        let work_dir = request.resolved_work_dir(&self.data_dir, run_id);
        let report_path = work_dir.join("video-red-cars.json");
        let now = Utc::now();
        let record = RunRecord {
            run_id,
            workflow: WorkflowKind::VideoRedCars,
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
        let cancellation = RunCancellationToken::new();
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        self.persist_run(&record);
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        let worker_cancellation = cancellation.clone();
        tokio::task::spawn_blocking(move || {
            let handle = tokio::runtime::Handle::current();
            handle.block_on(async {
                manager
                    .update_run(
                        run_id,
                        RunStatus::Running,
                        Some(running_message.clone()),
                        false,
                    )
                    .await;
                manager
                    .emit(run_id, RunStatus::Running, &running_message)
                    .await;
            });

            let mut progress = |event: WorkflowProgress| {
                handle.block_on(async {
                    manager
                        .emit_workflow_progress(run_id, RunStatus::Running, event)
                        .await;
                });
            };
            let result = run_video_red_cars_workflow(
                request,
                work_dir,
                report_path,
                worker_cancellation,
                &mut progress,
            );
            handle.block_on(async {
                match result {
                    Ok(_) => {
                        manager
                            .update_run(
                                run_id,
                                RunStatus::Succeeded,
                                Some(completed_message.clone()),
                                true,
                            )
                            .await;
                        manager
                            .emit(run_id, RunStatus::Succeeded, &completed_message)
                            .await;
                    }
                    Err(StudioError::Canceled(message)) => {
                        manager.mark_canceled_if_needed(run_id, message).await;
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
        let cancellation = RunCancellationToken::new();
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        self.persist_run(&record);
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        let worker_cancellation = cancellation.clone();
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

            let mut progress = |event: WorkflowProgress| {
                handle.block_on(async {
                    manager
                        .emit_workflow_progress(run_id, RunStatus::Running, event)
                        .await;
                });
            };
            let result = run_youtube_collection_workflow(
                request,
                work_dir,
                report_path,
                worker_cancellation,
                &mut progress,
            );
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
                    Err(StudioError::Canceled(message)) => {
                        manager.mark_canceled_if_needed(run_id, message).await;
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
        let cancellation = RunCancellationToken::new();
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        self.persist_run(&record);
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        let worker_cancellation = cancellation.clone();
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

            let mut progress = |event: WorkflowProgress| {
                handle.block_on(async {
                    manager
                        .emit_workflow_progress(run_id, RunStatus::Running, event)
                        .await;
                });
            };
            let result = run_song_analysis_workflow(
                request,
                data_dir,
                work_dir,
                report_path,
                worker_cancellation,
                &mut progress,
            );
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
                    Err(StudioError::Canceled(message)) => {
                        manager.mark_canceled_if_needed(run_id, message).await;
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
        let cancellation = RunCancellationToken::new();
        {
            let mut runs = self.inner.runs.lock().await;
            runs.insert(
                run_id,
                RunState {
                    record: record.clone(),
                    events: events.clone(),
                    history: VecDeque::new(),
                    cancellation: cancellation.clone(),
                },
            );
        }
        self.persist_run(&record);
        self.emit(run_id, RunStatus::Pending, "queued").await;

        let manager = self.clone();
        let worker_cancellation = cancellation.clone();
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

            let mut progress = |event: WorkflowProgress| {
                handle.block_on(async {
                    manager
                        .emit_workflow_progress(run_id, RunStatus::Running, event)
                        .await;
                });
            };
            let result = run_subtitle_generation_workflow(
                request,
                work_dir,
                report_path,
                worker_cancellation,
                &mut progress,
            );
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
                    Err(StudioError::Canceled(message)) => {
                        manager.mark_canceled_if_needed(run_id, message).await;
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

    pub async fn list_runs(
        &self,
        limit: usize,
        workflow: Option<WorkflowKind>,
        status: Option<RunStatus>,
    ) -> Result<Vec<RunRecord>> {
        self.inner.run_store.list_runs(RunListFilter {
            limit: limit.clamp(1, 200),
            workflow,
            status,
        })
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
        state.cancellation.cancel();
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
            node: None,
            phase: None,
            progress: None,
        };
        push_event_history(&mut state.history, event.clone());
        let _ = state.events.send(event.clone());
        let record = state.record.clone();
        drop(runs);
        self.persist_run(&record);
        self.persist_event(&event);
        Ok(())
    }

    pub async fn list_events(&self, run_id: RunId) -> Result<Vec<RunEvent>> {
        self.get_run(run_id).await?;
        self.inner.run_store.list_events(run_id)
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
        let record = state.record.clone();
        drop(runs);
        self.persist_run(&record);
    }

    async fn mark_canceled_if_needed(&self, run_id: RunId, message: String) {
        let mut runs = self.inner.runs.lock().await;
        let Some(state) = runs.get_mut(&run_id) else {
            return;
        };
        if state.record.status == RunStatus::Canceled {
            return;
        }
        let now = Utc::now();
        state.record.status = RunStatus::Canceled;
        state.record.updated_at = now;
        state.record.finished_at = Some(now);
        state.record.message = Some(message.clone());
        let event = RunEvent {
            run_id,
            status: RunStatus::Canceled,
            message,
            timestamp: now,
            node: None,
            phase: None,
            progress: None,
        };
        push_event_history(&mut state.history, event.clone());
        let _ = state.events.send(event.clone());
        let record = state.record.clone();
        drop(runs);
        self.persist_run(&record);
        self.persist_event(&event);
    }

    async fn emit(&self, run_id: RunId, status: RunStatus, message: impl Into<String>) {
        self.emit_with_node(run_id, status, message, None).await;
    }

    async fn emit_with_node(
        &self,
        run_id: RunId,
        status: RunStatus,
        message: impl Into<String>,
        node: Option<String>,
    ) {
        self.emit_with_details(run_id, status, message, node, None, None)
            .await;
    }

    async fn emit_workflow_progress(
        &self,
        run_id: RunId,
        status: RunStatus,
        event: WorkflowProgress,
    ) {
        self.emit_with_details(
            run_id,
            status,
            event.message,
            Some(event.node),
            event.phase,
            event.progress,
        )
        .await;
    }

    async fn emit_with_details(
        &self,
        run_id: RunId,
        status: RunStatus,
        message: impl Into<String>,
        node: Option<String>,
        phase: Option<String>,
        progress: Option<f32>,
    ) {
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
                node,
                phase,
                progress,
            };
            push_event_history(&mut state.history, event.clone());
            let _ = state.events.send(event.clone());
            drop(runs);
            self.persist_event(&event);
        }
    }

    fn load_data_source_catalog(&self) -> Result<DataSourceCatalog> {
        DataSourceCatalog::load(&data_source_catalog_path(&self.data_dir))
    }

    fn save_data_source_catalog(&self, catalog: &DataSourceCatalog) -> Result<()> {
        catalog.save(&data_source_catalog_path(&self.data_dir))
    }

    fn persist_run(&self, record: &RunRecord) {
        if let Err(error) = self.inner.run_store.save_run(record) {
            tracing::warn!(%error, run_id = %record.run_id, "failed to persist run record");
        }
    }

    fn persist_event(&self, event: &RunEvent) {
        if let Err(error) = self.inner.run_store.save_event(event) {
            tracing::warn!(%error, run_id = %event.run_id, "failed to persist run event");
        }
    }
}

fn hydrate_run_states(run_store: &RunStore) -> HashMap<RunId, RunState> {
    let Ok(states) = run_store.load_states() else {
        return HashMap::new();
    };
    let mut runs = HashMap::new();
    for (mut record, mut history) in states {
        let (events, _) = broadcast::channel(128);
        if matches!(record.status, RunStatus::Pending | RunStatus::Running) {
            let now = Utc::now();
            record.status = RunStatus::Failed;
            record.updated_at = now;
            record.finished_at = Some(now);
            record.message = Some("interrupted by Studio restart".to_string());
            let event = RunEvent {
                run_id: record.run_id,
                status: RunStatus::Failed,
                message: "interrupted by Studio restart".to_string(),
                timestamp: now,
                node: None,
                phase: None,
                progress: None,
            };
            push_event_history(&mut history, event.clone());
            let _ = run_store.save_run(&record);
            let _ = run_store.save_event(&event);
        }
        runs.insert(
            record.run_id,
            RunState {
                record,
                events,
                history,
                cancellation: RunCancellationToken::new(),
            },
        );
    }
    runs
}

fn push_event_history(history: &mut VecDeque<RunEvent>, event: RunEvent) {
    if let Some(previous) = history.back_mut() {
        if should_replace_progress_event(previous, &event) {
            *previous = event;
            return;
        }
    }
    if history.len() == MAX_RUN_EVENT_HISTORY {
        history.pop_front();
    }
    history.push_back(event);
}

fn should_replace_progress_event(previous: &RunEvent, next: &RunEvent) -> bool {
    previous.progress.is_some()
        && next.progress.is_some()
        && previous.run_id == next.run_id
        && previous.status == next.status
        && previous.message == next.message
        && previous.node == next.node
        && previous.phase == next.phase
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
    async fn run_records_and_events_survive_manager_restart() {
        let dir = tempdir().unwrap();
        let manager = RunManager::new(dir.path().to_path_buf());
        let run = manager
            .start_youtube_video(YoutubeRunRequest::local_file(
                dir.path().join("missing.mp4"),
            ))
            .await
            .unwrap();
        manager.cancel_run(run.run_id).await.unwrap();

        let restarted = RunManager::new(dir.path().to_path_buf());
        let record = restarted.get_run(run.run_id).await.unwrap();
        assert_eq!(record.status, RunStatus::Canceled);
        let events = restarted.list_events(run.run_id).await.unwrap();
        assert!(events
            .iter()
            .any(|event| event.status == RunStatus::Canceled && event.message == "canceled"));
    }

    #[tokio::test]
    async fn running_run_is_marked_failed_after_restart() {
        let dir = tempdir().unwrap();
        let run_id = Uuid::new_v4();
        let now = Utc::now();
        let store = RunStore::new(dir.path());
        store
            .save_run(&RunRecord {
                run_id,
                workflow: WorkflowKind::YoutubeVideo,
                status: RunStatus::Running,
                work_dir: dir.path().join("run"),
                report_path: dir.path().join("run").join("analysis.json"),
                created_at: now,
                updated_at: now,
                started_at: Some(now),
                finished_at: None,
                message: Some("running".to_string()),
            })
            .unwrap();

        let restarted = RunManager::new(dir.path().to_path_buf());
        let record = restarted.get_run(run_id).await.unwrap();
        assert_eq!(record.status, RunStatus::Failed);
        assert_eq!(
            record.message.as_deref(),
            Some("interrupted by Studio restart")
        );
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

    #[test]
    fn matching_progress_events_replace_the_latest_history_entry() {
        let mut history = VecDeque::new();
        let run_id = Uuid::new_v4();
        push_event_history(
            &mut history,
            RunEvent {
                run_id,
                status: RunStatus::Running,
                message: "downloading whisper.cpp model `base.en`".to_string(),
                timestamp: Utc::now(),
                node: Some("transcription".to_string()),
                phase: Some("downloading_model".to_string()),
                progress: Some(0.12),
            },
        );
        push_event_history(
            &mut history,
            RunEvent {
                run_id,
                status: RunStatus::Running,
                message: "downloading whisper.cpp model `base.en`".to_string(),
                timestamp: Utc::now(),
                node: Some("transcription".to_string()),
                phase: Some("downloading_model".to_string()),
                progress: Some(0.38),
            },
        );

        assert_eq!(history.len(), 1);
        assert_eq!(history.back().and_then(|event| event.progress), Some(0.38));
    }
}
