use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::Stream;
use serde::Serialize;
use studio_core::{
    check_system_dependencies, discover_youtube_collection_manifest, RunEvent, RunId, RunManager,
    SongAnalysisRunRequest, SongCatalogImportRequest, StudioError, SubtitleGenerationRunRequest,
    WorkflowKind, YoutubeCollectionManifestRequest, YoutubeCollectionRunRequest, YoutubeRunRequest,
};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

#[derive(Clone)]
struct AppState {
    manager: RunManager,
}

pub fn build_app(manager: RunManager) -> Router {
    let state = AppState { manager };
    Router::new()
        .route("/health", get(health))
        .route("/api/system/dependencies", get(system_dependencies))
        .route("/api/workflows", get(workflows))
        .route(
            "/api/youtube/collection-manifests",
            post(discover_collection_manifest),
        )
        .route(
            "/api/workflows/youtube-video/runs",
            post(start_youtube_video_run),
        )
        .route(
            "/api/workflows/youtube-collection/runs",
            post(start_youtube_collection_run),
        )
        .route(
            "/api/workflows/song-analysis/runs",
            post(start_song_analysis_run),
        )
        .route(
            "/api/workflows/subtitle-generation/runs",
            post(start_subtitle_generation_run),
        )
        .route("/api/song-catalog/imports", post(import_song_catalog_items))
        .route("/api/runs/{run_id}", get(get_run))
        .route("/api/runs/{run_id}/events", get(get_events))
        .route("/api/runs/{run_id}/report", get(get_report))
        .route("/api/runs/{run_id}/cancel", post(cancel_run))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

async fn system_dependencies() -> Json<studio_core::SystemDependencyReport> {
    Json(check_system_dependencies(&[]))
}

async fn workflows() -> Json<Vec<WorkflowDescriptor>> {
    Json(vec![
        WorkflowDescriptor {
            id: "youtube-video",
            name: "YouTube Video",
            kind: WorkflowKind::YoutubeVideo,
        },
        WorkflowDescriptor {
            id: "youtube-collection",
            name: "YouTube Collection",
            kind: WorkflowKind::YoutubeCollection,
        },
        WorkflowDescriptor {
            id: "song-analysis",
            name: "Song Analysis",
            kind: WorkflowKind::SongAnalysis,
        },
        WorkflowDescriptor {
            id: "subtitle-generation",
            name: "Subtitle Generation",
            kind: WorkflowKind::SubtitleGeneration,
        },
    ])
}

async fn discover_collection_manifest(
    Json(request): Json<YoutubeCollectionManifestRequest>,
) -> Result<Json<studio_core::YoutubeCollectionManifest>, ApiError> {
    Ok(Json(discover_youtube_collection_manifest(request)?))
}

async fn start_youtube_video_run(
    State(state): State<AppState>,
    Json(request): Json<YoutubeRunRequest>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(state.manager.start_youtube_video(request).await?))
}

async fn start_youtube_collection_run(
    State(state): State<AppState>,
    Json(request): Json<YoutubeCollectionRunRequest>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(state.manager.start_youtube_collection(request).await?))
}

async fn start_song_analysis_run(
    State(state): State<AppState>,
    Json(request): Json<SongAnalysisRunRequest>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(state.manager.start_song_analysis(request).await?))
}

async fn start_subtitle_generation_run(
    State(state): State<AppState>,
    Json(request): Json<SubtitleGenerationRunRequest>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(
        state.manager.start_subtitle_generation(request).await?,
    ))
}

async fn import_song_catalog_items(
    State(state): State<AppState>,
    Json(request): Json<SongCatalogImportRequest>,
) -> Result<Json<studio_core::SongCatalogImportResponse>, ApiError> {
    Ok(Json(state.manager.import_song_catalog_items(request)?))
}

async fn get_run(
    State(state): State<AppState>,
    Path(run_id): Path<RunId>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(state.manager.get_run(run_id).await?))
}

async fn get_report(
    State(state): State<AppState>,
    Path(run_id): Path<RunId>,
) -> Result<Json<studio_core::StudioReport>, ApiError> {
    Ok(Json(state.manager.get_report(run_id).await?))
}

async fn cancel_run(
    State(state): State<AppState>,
    Path(run_id): Path<RunId>,
) -> Result<StatusCode, ApiError> {
    state.manager.cancel_run(run_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_events(
    State(state): State<AppState>,
    Path(run_id): Path<RunId>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let receiver = state.manager.subscribe_events(run_id).await?;
    let stream = BroadcastStream::new(receiver).filter_map(|event| match event {
        Ok(event) => Some(Ok(sse_event(event))),
        Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(_)) => None,
    });
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(10))
            .text("keep-alive"),
    ))
}

fn sse_event(event: RunEvent) -> Event {
    Event::default()
        .event("run-event")
        .json_data(event)
        .unwrap_or_else(|_| Event::default().event("run-event"))
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
}

#[derive(Debug, Serialize)]
struct WorkflowDescriptor {
    id: &'static str,
    name: &'static str,
    kind: WorkflowKind,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
}

struct ApiError(StudioError);

impl From<StudioError> for ApiError {
    fn from(value: StudioError) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            StudioError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            StudioError::RunNotFound(_) | StudioError::ReportNotFound(_) => StatusCode::NOT_FOUND,
            StudioError::MissingDependency(_) => StatusCode::FAILED_DEPENDENCY,
            StudioError::Workflow(_)
            | StudioError::Io(_)
            | StudioError::Json(_)
            | StudioError::Sqlite(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                error: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::json;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn health_returns_ok() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn invalid_url_request_returns_400() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::post("/api/workflows/youtube-video/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "youtube_url", "url": "https://example.com/video" },
                            "scene_threshold": 27,
                            "min_scene_len": 15,
                            "visual_sample_every": 30
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn invalid_collection_manifest_request_returns_400() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::post("/api/youtube/collection-manifests")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "playlist_url", "url": "https://example.com/playlist" },
                            "metadata_filter": {},
                            "metadata_depth": "fast",
                            "max_items": 25
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn invalid_collection_run_request_returns_400() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::post("/api/workflows/youtube-collection/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": null,
                            "manifest": null,
                            "metadata_filter": {},
                            "local_file_filter": {},
                            "analysis": {
                                "scene_threshold": 27,
                                "min_scene_len": 15,
                                "visual_sample_every": 30,
                                "transcription": { "enabled": true },
                                "models": {}
                            },
                            "delete_filtered_downloads": false
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn workflows_include_song_analysis() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(Request::get("/api/workflows").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(value
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == "song-analysis" && item["kind"] == "song_analysis"));
    }

    #[tokio::test]
    async fn workflows_include_subtitle_generation() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(Request::get("/api/workflows").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(value.as_array().unwrap().iter().any(|item| {
            item["id"] == "subtitle-generation" && item["kind"] == "subtitle_generation"
        }));
    }

    #[tokio::test]
    async fn invalid_subtitle_generation_request_returns_400() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::post("/api/workflows/subtitle-generation/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "local_file", "path": "" },
                            "transcription": { "enabled": true },
                            "overwrite": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn invalid_song_analysis_request_returns_400() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::post("/api/workflows/song-analysis/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "local_file", "path": "" },
                            "catalog": {},
                            "identification": { "enabled": true, "min_score": 0.82, "ambiguous_margin": 0.03, "max_candidates": 5 },
                            "transcription": { "enabled": true },
                            "music": { "enabled": true, "window_seconds": 30, "hop_seconds": 15, "min_bpm": 60, "max_bpm": 200 }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn song_run_creation_returns_run_id_and_missing_report_404() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/workflows/song-analysis/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "local_file", "path": dir.path().join("missing.mp3") },
                            "work_dir": dir.path().join("song-work"),
                            "catalog": {},
                            "identification": { "enabled": true, "min_score": 0.82, "ambiguous_margin": 0.03, "max_candidates": 5 },
                            "transcription": { "enabled": true },
                            "music": { "enabled": true, "window_seconds": 30, "hop_seconds": 15, "min_bpm": 60, "max_bpm": 200 }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let record: studio_core::RunRecord = serde_json::from_slice(&bytes).unwrap();
        let report_response = app
            .oneshot(
                Request::get(format!("/api/runs/{}/report", record.run_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(report_response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn run_creation_returns_run_id_and_missing_report_404() {
        let dir = tempfile::tempdir().unwrap();
        let app = build_app(RunManager::new(dir.path().to_path_buf()));
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/workflows/youtube-video/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "source": { "kind": "local_file", "path": dir.path().join("missing.mp4") },
                            "scene_threshold": 27,
                            "min_scene_len": 15,
                            "visual_sample_every": 30
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let record: studio_core::RunRecord = serde_json::from_slice(&bytes).unwrap();
        let report_response = app
            .oneshot(
                Request::get(format!("/api/runs/{}/report", record.run_id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(report_response.status(), StatusCode::NOT_FOUND);
    }
}
