use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use video_analysis_core::{BoundingBox, ObservationKind, RealtimeVideoPipeline, VideoFrame};
use video_analysis_detectors::ContentDetector;
use video_analysis_ffmpeg::FfmpegVideoSource;
use video_analysis_ingest::VideoFrameSource;
use video_analysis_models::{
    normalize_predictions, DownloadedModel, ExternalCommandModel, ModelBundle, ModelBundleStore,
    PredictionRepairOptions, VisionModelBackend,
};
use video_analysis_segmentation::default_sam2_model_spec;

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

const DEFAULT_TRACK_IOU: f32 = 0.5;
const DEFAULT_VEHICLE_DETECTOR_SCRIPT: &str =
    "../../../rust-packages/scripts/opencv_red_car_detector.py";
const DEFAULT_TARGET_OBJECT: &str = "car";

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
    #[serde(default = "default_target_object")]
    pub target_object: String,
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
        if self.target_object.trim().is_empty() {
            return Err(StudioError::InvalidRequest(
                "target_object must not be empty".to_string(),
            ));
        }
        if self.vehicle_detector.command.as_os_str().is_empty()
            && !default_detector_supports_target(&self.target_object)
        {
            return Err(StudioError::InvalidRequest(
                "the built-in detector only supports car, vehicle, or automobile; configure vehicle_detector.command for other targets".to_string(),
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

#[derive(Debug, Clone)]
struct RedCarObservation {
    frame_index: u64,
    observation: ObservationReport,
    region: BoundingBox,
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
        "preparing facebook/sam2.1-hiera-large",
    ));
    let target_object = normalized_target_object(&request.target_object);
    let downloaded_model = ensure_default_sam_model(progress)?;
    let detector_config = resolve_vehicle_detector(&request.vehicle_detector)?;

    progress(WorkflowProgress::message(
        "video-red-cars",
        &format!(
            "cutting scenes and counting {}",
            red_target_label(&target_object)
        ),
    ));

    let report = run_local_video_red_cars(
        &local_video,
        &work_dir,
        &report_path,
        request.scene_threshold,
        request.min_scene_len,
        request.max_frames,
        request.visual_sample_every,
        &target_object,
        detector_config,
        downloaded_model,
    )?;

    let bytes = serde_json::to_vec_pretty(&report)?;
    fs::write(
        &report_path,
        format!("{}\n", String::from_utf8_lossy(&bytes)),
    )?;

    Ok(VideoRedCarsReport {
        workflow: report.workflow,
        target_object,
        source: SourceReport {
            url: source_url,
            local_video: report.source.local_video,
        },
        assets: report.assets,
        capabilities: report.capabilities,
        video: report.video,
    })
}

fn run_local_video_red_cars(
    input: &Path,
    work_dir: &Path,
    report_path: &Path,
    scene_threshold: f32,
    min_scene_len: u64,
    max_frames: Option<u64>,
    visual_sample_every: u64,
    target_object: &str,
    detector_config: ExternalCommandConfig,
    downloaded_model: DownloadedModel,
) -> Result<VideoRedCarsReport> {
    let mut source = FfmpegVideoSource::open(input)?;
    let metadata = source.metadata().clone();
    let mut pipeline = RealtimeVideoPipeline::builder()
        .scene_detector(ContentDetector::new(scene_threshold, min_scene_len))
        .start_in_scene(true)
        .build()?;
    let mut detector = ExternalCommandModel::new(&detector_config.command, downloaded_model)
        .args(detector_config.args.clone());
    let accepted_labels = accepted_labels_for_target(target_object);
    let mut red_samples = Vec::new();
    let mut sampled_frame_indices = Vec::new();

    while let Some(frame) = source.next_video_frame()? {
        let frame_ref = frame.as_frame();
        let frame_index = frame.position.frame_index;
        if frame_index % visual_sample_every == 0 {
            sampled_frame_indices.push(frame_index);
            red_samples.extend(red_observations_for_frame(
                &mut detector,
                &frame_ref,
                &accepted_labels,
                target_object,
            )?);
        }
        pipeline.process_frame(frame)?;
        if max_frames
            .map(|limit| pipeline.frames_processed() >= limit)
            .unwrap_or(false)
        {
            break;
        }
    }

    let result = pipeline.finish_analysis()?;
    let scenes = result
        .detection
        .scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let red_car_observations = red_samples
                .iter()
                .filter(|sample| sample.frame_index >= scene.start.frame_index)
                .filter(|sample| sample.frame_index <= scene.end.frame_index)
                .map(|sample| {
                    let mut observation = sample.observation.clone();
                    observation.scene_index = Some(index as u64);
                    observation
                })
                .collect::<Vec<_>>();
            let sampled_frames = sampled_frame_indices
                .iter()
                .filter(|frame_index| **frame_index >= scene.start.frame_index)
                .filter(|frame_index| **frame_index <= scene.end.frame_index)
                .count() as u64;
            let grouped_observations = red_samples
                .iter()
                .filter(|sample| sample.frame_index >= scene.start.frame_index)
                .filter(|sample| sample.frame_index <= scene.end.frame_index)
                .cloned()
                .collect::<Vec<_>>();
            let peak_visible_red_cars = peak_visible_red_cars(&grouped_observations);
            VideoRedCarsSceneReport {
                index: index as u64,
                start_frame: scene.start.frame_index,
                end_frame: scene.end.frame_index,
                start_seconds: scene.start.timestamp.seconds(),
                end_seconds: scene.end.timestamp.seconds(),
                observations: red_car_observations,
                red_car_count: count_distinct_tracks(
                    &grouped_observations,
                    visual_sample_every,
                    DEFAULT_TRACK_IOU,
                ) as u64,
                peak_visible_red_cars,
                sampled_frames,
            }
        })
        .collect::<Vec<_>>();
    let observations = scenes
        .iter()
        .flat_map(|scene| scene.observations.clone())
        .collect::<Vec<_>>();

    Ok(VideoRedCarsReport {
        workflow: "video-red-cars".to_string(),
        target_object: target_object.to_string(),
        source: SourceReport {
            url: None,
            local_video: input.display().to_string(),
        },
        assets: AssetReport {
            work_dir: work_dir.display().to_string(),
            report_path: report_path.display().to_string(),
            audio_wav: None,
        },
        capabilities: CapabilityReport {
            completed: vec![
                "scene_detection".to_string(),
                "vehicle_detection".to_string(),
                "target_object_counting".to_string(),
                "red_color_filter".to_string(),
                "facebook_sam_model_bundle".to_string(),
            ],
            skipped: Vec::new(),
        },
        video: VideoRedCarsVideoReport {
            width: metadata.width,
            height: metadata.height,
            frame_rate: format!(
                "{}/{}",
                metadata.frame_rate.numer(),
                metadata.frame_rate.denom()
            ),
            duration_seconds: metadata.duration_seconds,
            frames_processed: result.frames_processed,
            observations,
            scenes,
        },
    })
}

fn ensure_default_sam_model(progress: &mut dyn FnMut(WorkflowProgress)) -> Result<DownloadedModel> {
    let spec = default_sam2_model_spec();
    let store = ModelBundleStore::new(default_model_bundle_root());
    let manifest_path = store.bundle_dir(&spec).join("manifest.json");
    let bundle = if manifest_path.exists() {
        progress(WorkflowProgress::message(
            "video-red-cars",
            "using cached facebook/sam2.1-hiera-large",
        ));
        ModelBundle::load(&manifest_path)?
    } else {
        progress(WorkflowProgress::message(
            "video-red-cars",
            "downloading facebook/sam2.1-hiera-large",
        ));
        store.download(&spec)?
    };
    Ok(bundle.to_downloaded_model())
}

fn default_model_bundle_root() -> PathBuf {
    if let Some(path) = env::var_os("VIDEO_ANALYSIS_MODEL_DIR") {
        return PathBuf::from(path);
    }
    if let Some(path) = env::var_os("XDG_CACHE_HOME") {
        return PathBuf::from(path).join("video-analysis").join("models");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".cache")
            .join("video-analysis")
            .join("models");
    }
    env::temp_dir().join("video-analysis-models")
}

fn resolve_vehicle_detector(config: &ExternalCommandConfig) -> Result<ExternalCommandConfig> {
    if !config.command.as_os_str().is_empty() {
        return Ok(config.clone());
    }

    let command = ["python3", "python"]
        .into_iter()
        .map(PathBuf::from)
        .find_map(|candidate| resolve_command(&candidate))
        .ok_or_else(|| {
            StudioError::MissingDependency(
                "python3 is required for the default red car detector".to_string(),
            )
        })?;
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(DEFAULT_VEHICLE_DETECTOR_SCRIPT);
    if !script.exists() {
        return Err(StudioError::MissingDependency(format!(
            "default red car detector script is missing: {}",
            script.display()
        )));
    }
    Ok(ExternalCommandConfig {
        command,
        args: vec![script.display().to_string()],
    })
}

fn accepted_labels_for_target(target_object: &str) -> BTreeSet<String> {
    let target_object = normalized_target_object(target_object);
    if default_detector_supports_target(&target_object) {
        ["car", "vehicle", "automobile"]
            .into_iter()
            .map(str::to_string)
            .collect()
    } else {
        [target_object].into_iter().collect()
    }
}

fn red_observations_for_frame(
    detector: &mut ExternalCommandModel,
    frame: &VideoFrame<'_>,
    accepted_labels: &BTreeSet<String>,
    target_object: &str,
) -> Result<Vec<RedCarObservation>> {
    let raw = detector.predict_frame(frame)?;
    Ok(normalize_predictions(
        raw,
        &detector.model().spec.task,
        Some((frame.width, frame.height)),
        PredictionRepairOptions::default(),
    )
    .into_iter()
    .filter(|prediction| prediction.kind == ObservationKind::Object)
    .filter_map(|prediction| {
        let label = prediction.label.clone()?;
        accepted_labels
            .contains(&label.to_ascii_lowercase())
            .then_some((label, prediction))
    })
    .filter_map(|(label, prediction)| {
        let region = prediction.region?;
        is_red_vehicle(frame, region, &prediction.attributes).then_some((label, prediction, region))
    })
    .map(|(label, prediction, region)| {
        let mut attributes = prediction.attributes;
        attributes
            .entry("base_label".to_string())
            .or_insert(label.clone());
        attributes
            .entry("color".to_string())
            .or_insert_with(|| "red".to_string());
        RedCarObservation {
            frame_index: frame.position.frame_index,
            observation: ObservationReport {
                timestamp_seconds: Some(frame.position.timestamp.seconds()),
                frame_index: Some(frame.position.frame_index),
                scene_index: None,
                analyzer: "red_target_detector".to_string(),
                kind: "object".to_string(),
                label: Some(red_target_label(target_object)),
                text: prediction.text,
                score: prediction.score,
                region: Some(region_report(region)),
                track_id: None,
                attributes,
            },
            region,
        }
    })
    .collect())
}

fn red_target_label(target_object: &str) -> String {
    format!("red {}", normalized_target_object(target_object))
}

fn default_detector_supports_target(target_object: &str) -> bool {
    matches!(
        normalized_target_object(target_object).as_str(),
        "car" | "vehicle" | "automobile"
    )
}

fn normalized_target_object(target_object: &str) -> String {
    target_object.trim().to_ascii_lowercase()
}

fn is_red_vehicle(
    frame: &VideoFrame<'_>,
    region: BoundingBox,
    attributes: &BTreeMap<String, String>,
) -> bool {
    if attributes
        .get("color")
        .is_some_and(|value| value.eq_ignore_ascii_case("red"))
    {
        return true;
    }
    if attributes
        .get("dominant_color")
        .is_some_and(|value| value.eq_ignore_ascii_case("red"))
    {
        return true;
    }

    let [r, g, b] = mean_rgb(frame, region);
    r >= 96.0 && r >= 1.35 * g && r >= 1.35 * b
}

fn mean_rgb(frame: &VideoFrame<'_>, region: BoundingBox) -> [f32; 3] {
    let mut sums = [0_u64; 3];
    let mut pixels = 0_u64;
    for y in region.y..region.y.saturating_add(region.height).min(frame.height) {
        for x in region.x..region.x.saturating_add(region.width).min(frame.width) {
            let pixel = frame.pixel_rgb(x, y);
            sums[0] += pixel[0] as u64;
            sums[1] += pixel[1] as u64;
            sums[2] += pixel[2] as u64;
            pixels += 1;
        }
    }
    if pixels == 0 {
        return [0.0, 0.0, 0.0];
    }
    [
        sums[0] as f32 / pixels as f32,
        sums[1] as f32 / pixels as f32,
        sums[2] as f32 / pixels as f32,
    ]
}

fn count_distinct_tracks(
    observations: &[RedCarObservation],
    visual_sample_every: u64,
    min_iou: f32,
) -> usize {
    let mut tracks: Vec<(u64, BoundingBox)> = Vec::new();
    let max_gap = visual_sample_every.max(1) * 2;
    for observation in observations {
        let mut best_index = None;
        let mut best_iou = 0.0_f32;
        for (index, (last_frame, last_region)) in tracks.iter().enumerate() {
            if observation.frame_index.saturating_sub(*last_frame) > max_gap {
                continue;
            }
            let iou = bbox_iou(*last_region, observation.region);
            if iou >= min_iou && iou > best_iou {
                best_iou = iou;
                best_index = Some(index);
            }
        }
        if let Some(index) = best_index {
            tracks[index] = (observation.frame_index, observation.region);
        } else {
            tracks.push((observation.frame_index, observation.region));
        }
    }
    tracks.len()
}

fn peak_visible_red_cars(observations: &[RedCarObservation]) -> u64 {
    let mut counts = BTreeMap::<u64, u64>::new();
    for observation in observations {
        *counts.entry(observation.frame_index).or_default() += 1;
    }
    counts.into_values().max().unwrap_or(0)
}

fn bbox_iou(left: BoundingBox, right: BoundingBox) -> f32 {
    let left_x1 = left.x + left.width;
    let left_y1 = left.y + left.height;
    let right_x1 = right.x + right.width;
    let right_y1 = right.y + right.height;

    let ix0 = left.x.max(right.x);
    let iy0 = left.y.max(right.y);
    let ix1 = left_x1.min(right_x1);
    let iy1 = left_y1.min(right_y1);
    if ix1 <= ix0 || iy1 <= iy0 {
        return 0.0;
    }
    let intersection = (ix1 - ix0) as f32 * (iy1 - iy0) as f32;
    let left_area = left.width as f32 * left.height as f32;
    let right_area = right.width as f32 * right.height as f32;
    intersection / (left_area + right_area - intersection)
}

fn region_report(region: BoundingBox) -> RegionReport {
    RegionReport {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
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

fn default_target_object() -> String {
    DEFAULT_TARGET_OBJECT.to_string()
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

#[cfg(test)]
mod tests {
    use super::*;
    use video_analysis_core::{FramePosition, OwnedVideoFrame, PixelFormat, Timebase, Timestamp};

    fn test_frame(rgb: [u8; 3]) -> OwnedVideoFrame {
        let mut data = Vec::new();
        for _ in 0..(8 * 8) {
            data.extend_from_slice(&rgb);
        }
        OwnedVideoFrame {
            position: FramePosition {
                frame_index: 0,
                timestamp: Timestamp::new(0, Timebase::new(1, 30)),
            },
            width: 8,
            height: 8,
            pixel_format: PixelFormat::Rgb24,
            data,
            stride: 8 * 3,
        }
    }

    #[test]
    fn request_validation_allows_default_detector() {
        let request = VideoRedCarsRunRequest {
            source: SourceSpec::LocalFile {
                path: PathBuf::from("traffic.mp4"),
            },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            target_object: DEFAULT_TARGET_OBJECT.to_string(),
            vehicle_detector: ExternalCommandConfig {
                command: PathBuf::new(),
                args: Vec::new(),
            },
        };

        assert!(request.validate().is_ok());
    }

    #[test]
    fn request_validation_rejects_unsupported_default_target() {
        let request = VideoRedCarsRunRequest {
            source: SourceSpec::LocalFile {
                path: PathBuf::from("traffic.mp4"),
            },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            target_object: "truck".to_string(),
            vehicle_detector: ExternalCommandConfig {
                command: PathBuf::new(),
                args: Vec::new(),
            },
        };

        assert!(request.validate().is_err());
    }

    #[test]
    fn red_pixel_regions_are_treated_as_red_vehicles() {
        let frame = test_frame([220, 20, 20]);
        let region = BoundingBox::new(0, 0, 8, 8).unwrap();
        assert!(is_red_vehicle(&frame.as_frame(), region, &BTreeMap::new()));
    }
}
