use studio_core::{
    check_system_dependencies, discover_youtube_collection_manifest, DataSourceDerivationInput,
    DataSourceRecord, DataSourceUpsert, RunEvent, RunId, RunManager, RunRecord, RunStatus,
    SongAnalysisRunRequest, SongCatalogImportRequest, SongCatalogImportResponse, StudioReport,
    SubtitleGenerationRunRequest, SystemDependencyReport, WorkflowCatalog,
    YoutubeCollectionManifest, YoutubeCollectionManifestRequest, YoutubeCollectionRunRequest,
    YoutubeRunRequest,
};
use tauri::{AppHandle, Emitter, State};

pub struct StudioState {
    pub manager: RunManager,
}

#[tauri::command]
pub async fn check_dependencies() -> Result<SystemDependencyReport, String> {
    Ok(check_system_dependencies(&[]))
}

#[tauri::command]
pub async fn get_workflow_catalog() -> Result<WorkflowCatalog, String> {
    Ok(studio_core::default_workflow_catalog())
}

#[tauri::command]
pub async fn list_data_sources(state: State<'_, StudioState>) -> Result<Vec<DataSourceRecord>, String> {
    state.manager.list_data_sources().await.map_err(error_string)
}

#[tauri::command]
pub async fn create_data_source(
    state: State<'_, StudioState>,
    request: DataSourceUpsert,
) -> Result<DataSourceRecord, String> {
    state
        .manager
        .create_data_source(request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn update_data_source(
    state: State<'_, StudioState>,
    id: String,
    request: DataSourceUpsert,
) -> Result<DataSourceRecord, String> {
    state
        .manager
        .update_data_source(&id, request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn delete_data_source(
    state: State<'_, StudioState>,
    id: String,
) -> Result<(), String> {
    state
        .manager
        .delete_data_source(&id)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn create_data_source_derivation(
    state: State<'_, StudioState>,
    parent_id: String,
    request: DataSourceDerivationInput,
) -> Result<DataSourceRecord, String> {
    state
        .manager
        .create_data_source_derivation(&parent_id, request)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn start_youtube_video_run(
    app: AppHandle,
    state: State<'_, StudioState>,
    request: YoutubeRunRequest,
) -> Result<RunRecord, String> {
    let record = state
        .manager
        .start_youtube_video(request)
        .await
        .map_err(error_string)?;
    attach_run_event_forwarder(app, state.manager.clone(), record.run_id).await;
    Ok(record)
}

#[tauri::command]
pub async fn discover_youtube_collection_manifest_command(
    request: YoutubeCollectionManifestRequest,
) -> Result<YoutubeCollectionManifest, String> {
    discover_youtube_collection_manifest(request).map_err(error_string)
}

#[tauri::command]
pub async fn start_youtube_collection_run(
    app: AppHandle,
    state: State<'_, StudioState>,
    request: YoutubeCollectionRunRequest,
) -> Result<RunRecord, String> {
    let record = state
        .manager
        .start_youtube_collection(request)
        .await
        .map_err(error_string)?;
    attach_run_event_forwarder(app, state.manager.clone(), record.run_id).await;
    Ok(record)
}

#[tauri::command]
pub async fn start_song_analysis_run(
    app: AppHandle,
    state: State<'_, StudioState>,
    request: SongAnalysisRunRequest,
) -> Result<RunRecord, String> {
    let record = state
        .manager
        .start_song_analysis(request)
        .await
        .map_err(error_string)?;
    attach_run_event_forwarder(app, state.manager.clone(), record.run_id).await;
    Ok(record)
}

#[tauri::command]
pub async fn start_subtitle_generation_run(
    app: AppHandle,
    state: State<'_, StudioState>,
    request: SubtitleGenerationRunRequest,
) -> Result<RunRecord, String> {
    let record = state
        .manager
        .start_subtitle_generation(request)
        .await
        .map_err(error_string)?;
    attach_run_event_forwarder(app, state.manager.clone(), record.run_id).await;
    Ok(record)
}

#[tauri::command]
pub async fn import_song_catalog_items(
    state: State<'_, StudioState>,
    request: SongCatalogImportRequest,
) -> Result<SongCatalogImportResponse, String> {
    state
        .manager
        .import_song_catalog_items(request)
        .map_err(error_string)
}

#[tauri::command]
pub async fn get_run(state: State<'_, StudioState>, run_id: String) -> Result<RunRecord, String> {
    state
        .manager
        .get_run(parse_run_id(&run_id)?)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn get_report(
    state: State<'_, StudioState>,
    run_id: String,
) -> Result<StudioReport, String> {
    state
        .manager
        .get_report(parse_run_id(&run_id)?)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn get_run_events(
    state: State<'_, StudioState>,
    run_id: String,
) -> Result<Vec<RunEvent>, String> {
    state
        .manager
        .list_events(parse_run_id(&run_id)?)
        .await
        .map_err(error_string)
}

#[tauri::command]
pub async fn cancel_run(state: State<'_, StudioState>, run_id: String) -> Result<(), String> {
    state
        .manager
        .cancel_run(parse_run_id(&run_id)?)
        .await
        .map_err(error_string)
}

async fn attach_run_event_forwarder(app: AppHandle, manager: RunManager, run_id: RunId) {
    let Ok(mut receiver) = manager.subscribe_events(run_id).await else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        while let Ok(event) = receiver.recv().await {
            let terminal = matches!(
                event.status,
                RunStatus::Succeeded | RunStatus::Failed | RunStatus::Canceled
            );
            emit_run_event(&app, event);
            if terminal {
                break;
            }
        }
    });
}

fn emit_run_event(app: &AppHandle, event: RunEvent) {
    let _ = app.emit("workflow://run-event", event);
}

fn parse_run_id(value: &str) -> Result<RunId, String> {
    uuid::Uuid::parse_str(value).map_err(|error| error.to_string())
}

fn error_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
