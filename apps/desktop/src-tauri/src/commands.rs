use studio_core::{
    check_system_dependencies, discover_youtube_collection_manifest, RunEvent, RunId, RunManager,
    RunRecord, RunStatus, SongAnalysisRunRequest, SongCatalogImportRequest,
    SongCatalogImportResponse, StudioReport, SubtitleGenerationRunRequest, SystemDependencyReport,
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
