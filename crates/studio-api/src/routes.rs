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
    check_system_dependencies, RunEvent, RunId, RunManager, StudioError, WorkflowKind,
    YoutubeRunRequest,
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
            "/api/workflows/youtube-video/runs",
            post(start_youtube_video_run),
        )
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
    Json(vec![WorkflowDescriptor {
        id: "youtube-video",
        name: "YouTube Video",
        kind: WorkflowKind::YoutubeVideo,
    }])
}

async fn start_youtube_video_run(
    State(state): State<AppState>,
    Json(request): Json<YoutubeRunRequest>,
) -> Result<Json<studio_core::RunRecord>, ApiError> {
    Ok(Json(state.manager.start_youtube_video(request).await?))
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
) -> Result<Json<studio_core::YoutubeVideoReport>, ApiError> {
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
            StudioError::Workflow(_) | StudioError::Io(_) | StudioError::Json(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
