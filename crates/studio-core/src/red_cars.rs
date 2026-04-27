use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use video_analysis_use_cases as package;
use video_analysis_use_cases::video_red_cars::{
    run_video_red_cars_workflow as run_package_video_red_cars_workflow,
    VideoRedCarsRunRequest as PackageVideoRedCarsRunRequest,
};

use crate::error::{Result, StudioError};
use crate::report::{
    AssetReport, CapabilityReport, ObservationReport, RegionReport, SourceReport,
    VideoRedCarsReport, VideoRedCarsSceneReport, VideoRedCarsVideoReport,
};
use crate::run_manager::WorkflowProgress;
use crate::system::resolve_command;
use crate::youtube::{
    ExternalCommandConfig, SourceSpec, DEFAULT_MIN_SCENE_LEN, DEFAULT_SCENE_THRESHOLD,
    DEFAULT_VISUAL_SAMPLE_EVERY,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoRedCarsRunRequest {
    pub source: SourceSpec,
    pub work_dir: Option<PathBuf>,
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f32,
    #[serde(default = "default_min_scene_len")]
    pub min_scene_len: u64,
    pub max_frames: Option<u64>,
    #[serde(default = "default_visual_sample_every")]
    pub visual_sample_every: u64,
    pub vehicle_detector: ExternalCommandConfig,
}

impl VideoRedCarsRunRequest {
    pub fn validate(&self) -> Result<()> {
        match &self.source {
            SourceSpec::YoutubeUrl { url } => crate::media::validate_youtube_url(url),
            SourceSpec::LocalFile { path } => crate::media::validate_local_file(path),
        }?;
        if !self.scene_threshold.is_finite() || self.scene_threshold <= 0.0 {
            return Err(StudioError::InvalidRequest(
                "scene_threshold must be finite and positive".to_string(),
            ));
        }
        if self.min_scene_len == 0 {
            return Err(StudioError::InvalidRequest(
                "min_scene_len must be positive".to_string(),
            ));
        }
        if self.visual_sample_every == 0 {
            return Err(StudioError::InvalidRequest(
                "visual_sample_every must be positive".to_string(),
            ));
        }
        if self.vehicle_detector.command.as_os_str().is_empty() {
            return Err(StudioError::InvalidRequest(
                "vehicle_detector.command is required".to_string(),
            ));
        }
        Ok(())
    }

    pub fn resolved_work_dir(&self, data_dir: &Path, run_id: uuid::Uuid) -> PathBuf {
        self.work_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("runs").join(run_id.to_string()))
    }
}

pub fn run_video_red_cars_workflow(
    request: VideoRedCarsRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
    progress: &mut dyn FnMut(WorkflowProgress),
) -> Result<VideoRedCarsReport> {
    request.validate()?;
    fs::create_dir_all(&work_dir)?;

    let (source_url, local_video) = match request.source {
        SourceSpec::YoutubeUrl { url } => {
            progress(WorkflowProgress::message(
                "download",
                "downloading YouTube video",
            ));
            let local_video = download_youtube_video(&url, &work_dir)?;
            (Some(url), local_video)
        }
        SourceSpec::LocalFile { path } => (None, path),
    };

    progress(WorkflowProgress::message(
        "video-red-cars",
        "cutting scenes and counting red cars",
    ));

    let package_report = run_package_video_red_cars_workflow(
        PackageVideoRedCarsRunRequest {
            input: local_video.clone(),
            work_dir: Some(work_dir.clone()),
            scene_threshold: request.scene_threshold,
            min_scene_len: request.min_scene_len,
            max_frames: request.max_frames,
            visual_sample_every: request.visual_sample_every,
            vehicle_detector: package::ExternalCommandConfig {
                command: request.vehicle_detector.command,
                args: request.vehicle_detector.args,
            },
        },
        work_dir.clone(),
        report_path.clone(),
    )?;

    let scene_reports = package_report
        .video
        .scenes
        .into_iter()
        .map(|scene| VideoRedCarsSceneReport {
            index: scene.index,
            start_frame: scene.start_frame,
            end_frame: scene.end_frame,
            start_seconds: scene.start_seconds,
            end_seconds: scene.end_seconds,
            observations: scene
                .red_car_observations
                .into_iter()
                .map(convert_observation)
                .collect(),
            red_car_count: scene.red_car_count,
            peak_visible_red_cars: scene.peak_visible_red_cars,
            sampled_frames: scene.sampled_frames,
        })
        .collect::<Vec<_>>();
    let observations = scene_reports
        .iter()
        .flat_map(|scene| scene.observations.clone())
        .collect();

    Ok(VideoRedCarsReport {
        workflow: package_report.workflow,
        source: SourceReport {
            url: source_url,
            local_video: package_report.source.local_video,
        },
        assets: AssetReport {
            work_dir: package_report.assets.work_dir,
            report_path: package_report.assets.report_path,
            audio_wav: None,
        },
        capabilities: CapabilityReport {
            completed: package_report.capabilities.completed,
            skipped: package_report.capabilities.skipped,
        },
        video: VideoRedCarsVideoReport {
            width: package_report.video.width,
            height: package_report.video.height,
            frame_rate: package_report.video.frame_rate,
            duration_seconds: package_report.video.duration_seconds,
            frames_processed: package_report.video.frames_processed,
            observations,
            scenes: scene_reports,
        },
    })
}

fn convert_observation(observation: package::youtube::ObservationReport) -> ObservationReport {
    ObservationReport {
        timestamp_seconds: observation.timestamp_seconds,
        frame_index: observation.frame_index,
        scene_index: observation.scene_index,
        analyzer: observation.analyzer,
        kind: observation.kind,
        label: observation.label,
        text: observation.text,
        score: observation.score,
        region: observation.region.map(|region| RegionReport {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
        }),
        track_id: observation.track_id,
        attributes: observation.attributes,
    }
}

fn default_scene_threshold() -> f32 {
    DEFAULT_SCENE_THRESHOLD
}

fn default_min_scene_len() -> u64 {
    DEFAULT_MIN_SCENE_LEN
}

fn default_visual_sample_every() -> u64 {
    DEFAULT_VISUAL_SAMPLE_EVERY
}

fn download_youtube_video(url: &str, work_dir: &Path) -> Result<PathBuf> {
    let command = PathBuf::from("yt-dlp");
    if resolve_command(&command).is_none() {
        return Err(StudioError::MissingDependency(
            "yt-dlp is required for YouTube downloads".to_string(),
        ));
    }

    let output_template = work_dir.join("youtube-video.%(ext)s");
    let output = Command::new("yt-dlp")
        .arg("--no-playlist")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(url)
        .output()?;

    if !output.status.success() {
        return Err(StudioError::Workflow(format!(
            "yt-dlp failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    for line in String::from_utf8_lossy(&output.stdout).lines().rev() {
        let path = PathBuf::from(line.trim());
        if path.exists() {
            return Ok(path);
        }
    }

    find_downloaded_video(work_dir).ok_or_else(|| {
        StudioError::Workflow("yt-dlp completed but no downloaded video was found".to_string())
    })
}

fn find_downloaded_video(work_dir: &Path) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(work_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .map(|stem| stem == "youtube-video")
                .unwrap_or(false)
        })
        .filter(|path| {
            matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("mp4" | "mkv" | "webm" | "mov")
            )
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
}
