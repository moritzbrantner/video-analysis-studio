use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use video_analysis_core::{
    AnalysisEvent, AudioAnalyzer, AudioBuffer, AudioFrame, BoundingBox, Observation,
    ObservationKind, RealtimeVideoPipeline, TextAnalyzer, TextSegment, Timestamp, VideoAnalyzer,
    VideoFrame,
};
use video_analysis_data::{
    BucketAggregator, BucketConfig, DataBucket, DataRecord, DataStreamKind, StreamSummary,
};
use video_analysis_detectors::ContentDetector;
use video_analysis_ffmpeg::{FfmpegAudioSource, FfmpegAudioSourceOptions, FfmpegVideoSource};
use video_analysis_ingest::{AudioFrameSource, VideoFrameSource};
use video_analysis_models::{
    DownloadedModel, ExternalCommandModel, HuggingFaceModelSpec, ModelTask, ModelTextAnalyzer,
    ModelVideoAnalyzer,
};

use crate::error::{Result, StudioError};
use crate::report::{
    AssetReport, AudioReport, CapabilityReport, DataBucketReport, EventReport, ObservationReport,
    RegionReport, SceneReport, SourceReport, StreamBucketReport, TextReport,
    TranscriptSegmentReport, TranscriptionReport, VideoReport, YoutubeVideoReport,
};
use crate::system::resolve_command;

pub const DEFAULT_SCENE_THRESHOLD: f32 = 27.0;
pub const DEFAULT_MIN_SCENE_LEN: u64 = 15;
pub const DEFAULT_VISUAL_SAMPLE_EVERY: u64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceSpec {
    YoutubeUrl { url: String },
    LocalFile { path: PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalCommandConfig {
    pub command: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscriptionConfig {
    pub enabled: bool,
    pub command: Option<ExternalCommandConfig>,
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            command: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelCommandConfig {
    pub object: Option<ExternalCommandConfig>,
    pub ocr: Option<ExternalCommandConfig>,
    pub text: Option<ExternalCommandConfig>,
}

impl ModelCommandConfig {
    pub fn optional_commands(&self) -> Vec<ExternalCommandConfig> {
        [&self.object, &self.ocr, &self.text]
            .into_iter()
            .filter_map(|value| value.clone())
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct YoutubeRunRequest {
    pub source: SourceSpec,
    pub work_dir: Option<PathBuf>,
    #[serde(default = "default_scene_threshold")]
    pub scene_threshold: f32,
    #[serde(default = "default_min_scene_len")]
    pub min_scene_len: u64,
    pub max_frames: Option<u64>,
    #[serde(default = "default_visual_sample_every")]
    pub visual_sample_every: u64,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default)]
    pub models: ModelCommandConfig,
}

impl YoutubeRunRequest {
    pub fn local_file(path: impl Into<PathBuf>) -> Self {
        Self {
            source: SourceSpec::LocalFile { path: path.into() },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        }
    }

    pub fn youtube_url(url: impl Into<String>) -> Self {
        Self {
            source: SourceSpec::YoutubeUrl { url: url.into() },
            work_dir: None,
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: None,
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        }
    }

    pub fn validate(&self) -> Result<()> {
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
        match &self.source {
            SourceSpec::YoutubeUrl { url } => validate_youtube_url(url),
            SourceSpec::LocalFile { path } => validate_local_file(path),
        }
    }

    pub fn resolved_work_dir(&self, data_dir: &Path, run_id: uuid::Uuid) -> PathBuf {
        self.work_dir
            .clone()
            .unwrap_or_else(|| data_dir.join("runs").join(run_id.to_string()))
    }
}

pub fn run_youtube_video_workflow(
    request: YoutubeRunRequest,
    work_dir: PathBuf,
    report_path: PathBuf,
) -> Result<YoutubeVideoReport> {
    request.validate()?;
    fs::create_dir_all(&work_dir)?;

    let mut completed = Vec::new();
    let mut skipped = Vec::new();

    let (source_url, video_path) = match &request.source {
        SourceSpec::LocalFile { path } => (None, path.clone()),
        SourceSpec::YoutubeUrl { url } => {
            let path = download_youtube_video(url, &work_dir)?;
            completed.push("youtube_download".to_string());
            (Some(url.clone()), path)
        }
    };

    let mut data_buckets = Vec::new();
    let mut aggregator = BucketAggregator::new(BucketConfig::record_count(1_000)?)?;
    let (video_report, observations) =
        analyze_video(&request, &video_path, &mut aggregator, &mut data_buckets)?;
    completed.push("scene_detection".to_string());
    if request.models.object.is_some() {
        completed.push("object/person_detection".to_string());
    } else {
        skipped.push("object/person detection: configure object command".to_string());
    }
    if request.models.ocr.is_some() {
        completed.push("ocr".to_string());
    } else {
        skipped.push("on-screen text OCR: configure OCR command".to_string());
    }

    let (transcription, audio_wav) = transcribe_video(&request, &video_path, &work_dir);
    match transcription.status.as_str() {
        "completed" => completed.push("transcription".to_string()),
        _ => skipped.push(format!(
            "transcription: {}",
            transcription.message.as_deref().unwrap_or("not available")
        )),
    }

    let audio_report = match analyze_audio(&video_path, &mut aggregator, &mut data_buckets) {
        Ok(report) => {
            completed.push("audio_analysis".to_string());
            report
        }
        Err(err) => AudioReport {
            status: "skipped".to_string(),
            frames_processed: 0,
            events: Vec::new(),
            message: Some(err.to_string()),
        },
    };
    if audio_report.status != "completed" {
        skipped.push(format!(
            "audio analysis: {}",
            audio_report.message.as_deref().unwrap_or("not available")
        ));
    }

    let text_report =
        match analyze_transcript_text(&request, &transcription, &mut aggregator, &mut data_buckets)
        {
            Ok(report) => {
                if report.status == "completed" {
                    completed.push("transcript_text_analysis".to_string());
                }
                report
            }
            Err(err) => TextReport {
                status: "skipped".to_string(),
                segments_processed: 0,
                events: Vec::new(),
                message: Some(err.to_string()),
            },
        };
    if text_report.status != "completed" {
        skipped.push(format!(
            "transcript text analysis: {}",
            text_report.message.as_deref().unwrap_or("not available")
        ));
    }

    if let Some(bucket) = aggregator.finish() {
        data_buckets.push(bucket_report(&bucket));
    }

    let report = YoutubeVideoReport {
        use_case: "youtube_video_analysis".to_string(),
        source: SourceReport {
            url: source_url,
            local_video: display_path(&video_path),
        },
        assets: AssetReport {
            work_dir: display_path(&work_dir),
            report_path: display_path(&report_path),
            audio_wav: audio_wav.as_ref().map(|path| display_path(path)),
        },
        capabilities: CapabilityReport { completed, skipped },
        video: video_report_with_observations(video_report, observations),
        transcription,
        audio: audio_report,
        text: text_report,
        data_buckets,
    };

    write_json_report(&report_path, &report)?;
    Ok(report)
}

fn validate_youtube_url(url: &str) -> Result<()> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(StudioError::InvalidRequest(
            "YouTube URL is required".to_string(),
        ));
    }
    let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
    else {
        return Err(StudioError::InvalidRequest(
            "YouTube URL must use http or https".to_string(),
        ));
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .split('@')
        .last()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let allowed = host == "youtu.be"
        || host == "youtube.com"
        || host == "www.youtube.com"
        || host == "m.youtube.com"
        || host.ends_with(".youtube.com");
    if !allowed {
        return Err(StudioError::InvalidRequest(format!(
            "unsupported YouTube URL host: {host}"
        )));
    }
    Ok(())
}

fn validate_local_file(path: &Path) -> Result<()> {
    if path.as_os_str().is_empty() {
        return Err(StudioError::InvalidRequest(
            "local file path is required".to_string(),
        ));
    }
    Ok(())
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

fn analyze_video(
    request: &YoutubeRunRequest,
    video_path: &Path,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<(VideoReport, Vec<ObservationReport>)> {
    let mut source = FfmpegVideoSource::open(video_path)?;
    let metadata = source.metadata().clone();
    let mut pipeline = build_video_pipeline(request)?;

    while let Some(frame) = source.next_video_frame()? {
        let frame_ref = frame.as_frame();
        let record = DataRecord::video_frame("video", frame.position.frame_index, &frame_ref);
        push_record(aggregator, record, data_buckets)?;
        pipeline.process_frame(frame)?;
        if request
            .max_frames
            .map(|limit| pipeline.frames_processed() >= limit)
            .unwrap_or(false)
        {
            break;
        }
    }

    let result = pipeline.finish_analysis()?;
    let observations = result
        .observations
        .iter()
        .map(observation_report)
        .collect::<Vec<_>>();
    let scenes = result
        .detection
        .scenes
        .iter()
        .enumerate()
        .map(|(index, scene)| {
            let scene_observations = observations
                .iter()
                .filter(|observation| observation.scene_index == Some(index as u64))
                .cloned()
                .collect();
            SceneReport {
                index: index as u64,
                start_frame: scene.start.frame_index,
                end_frame: scene.end.frame_index,
                start_seconds: scene.start.timestamp.seconds(),
                end_seconds: scene.end.timestamp.seconds(),
                observations: scene_observations,
            }
        })
        .collect::<Vec<_>>();

    Ok((
        VideoReport {
            width: metadata.width,
            height: metadata.height,
            frame_rate: format!(
                "{}/{}",
                metadata.frame_rate.numer(),
                metadata.frame_rate.denom()
            ),
            duration_seconds: metadata.duration_seconds,
            frames_processed: result.frames_processed,
            scenes,
            observations: Vec::new(),
        },
        observations,
    ))
}

fn build_video_pipeline(request: &YoutubeRunRequest) -> Result<RealtimeVideoPipeline> {
    let mut builder = RealtimeVideoPipeline::builder()
        .scene_detector(ContentDetector::new(
            request.scene_threshold,
            request.min_scene_len,
        ))
        .start_in_scene(true);

    if let Some(config) = &request.models.object {
        let backend = ExternalCommandModel::new(
            &config.command,
            downloaded_external_model("object-command", ModelTask::ObjectDetection),
        )
        .args(config.args.clone());
        builder = builder.video_analyzer(SampledVideoAnalyzer::new(
            ModelVideoAnalyzer::new("object_person_detector", backend),
            request.visual_sample_every,
        ));
    }

    if let Some(config) = &request.models.ocr {
        let backend = ExternalCommandModel::new(
            &config.command,
            downloaded_external_model("ocr-command", ModelTask::Custom("ocr".to_string())),
        )
        .args(config.args.clone());
        builder = builder.video_analyzer(SampledVideoAnalyzer::new(
            ModelVideoAnalyzer::new("ocr", backend),
            request.visual_sample_every,
        ));
    }

    Ok(builder.build()?)
}

fn transcribe_video(
    request: &YoutubeRunRequest,
    video_path: &Path,
    work_dir: &Path,
) -> (TranscriptionReport, Option<PathBuf>) {
    if !request.transcription.enabled {
        return (
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some("disabled".to_string()),
            },
            None,
        );
    }

    let command = match &request.transcription.command {
        Some(config) => config.clone(),
        None => {
            let default = PathBuf::from("whisper");
            if resolve_command(&default).is_none() {
                return (
                    TranscriptionReport {
                        status: "skipped".to_string(),
                        text: None,
                        segments: Vec::new(),
                        message: Some("install whisper or configure a transcriber".to_string()),
                    },
                    None,
                );
            }
            ExternalCommandConfig {
                command: default,
                args: Vec::new(),
            }
        }
    };

    match extract_audio_wav(video_path, work_dir)
        .and_then(|audio_path| run_whisper_command(&command, &audio_path))
    {
        Ok((report, audio_path)) => (report, Some(audio_path)),
        Err(err) => (
            TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: Some(err.to_string()),
            },
            None,
        ),
    }
}

fn extract_audio_wav(video_path: &Path, work_dir: &Path) -> Result<PathBuf> {
    let path = work_dir.join("audio.wav");
    let status = Command::new("ffmpeg")
        .arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(video_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("wav")
        .arg(&path)
        .status()?;
    if !status.success() {
        return Err(StudioError::Workflow(
            "ffmpeg failed to extract transcription audio".to_string(),
        ));
    }
    Ok(path)
}

fn run_whisper_command(
    config: &ExternalCommandConfig,
    audio_path: &Path,
) -> Result<(TranscriptionReport, PathBuf)> {
    let output_dir = audio_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("transcript");
    fs::create_dir_all(&output_dir)?;

    let status = Command::new(&config.command)
        .arg(audio_path)
        .args(&config.args)
        .arg("--output_format")
        .arg("json")
        .arg("--output_dir")
        .arg(&output_dir)
        .stdin(Stdio::null())
        .status()?;
    if !status.success() {
        return Err(StudioError::Workflow(format!(
            "transcriber command `{}` failed",
            config.command.display()
        )));
    }

    let transcript_path = find_transcript_json(&output_dir).ok_or_else(|| {
        StudioError::Workflow("transcriber completed but no JSON transcript was found".to_string())
    })?;
    let bytes = fs::read(&transcript_path)?;
    let parsed: WhisperOutput = serde_json::from_slice(&bytes)?;
    let segments = parsed
        .segments
        .into_iter()
        .enumerate()
        .map(|(index, segment)| TranscriptSegmentReport {
            index: index as u64,
            start_seconds: segment.start,
            end_seconds: segment.end,
            text: segment.text.trim().to_string(),
        })
        .collect::<Vec<_>>();
    Ok((
        TranscriptionReport {
            status: "completed".to_string(),
            text: parsed.text.map(|text| text.trim().to_string()),
            segments,
            message: Some(display_path(&transcript_path)),
        },
        audio_path.to_path_buf(),
    ))
}

#[derive(Debug, Deserialize)]
struct WhisperOutput {
    text: Option<String>,
    #[serde(default)]
    segments: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperSegment {
    start: Option<f64>,
    end: Option<f64>,
    text: String,
}

fn find_transcript_json(output_dir: &Path) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(output_dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
}

fn analyze_audio(
    video_path: &Path,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<AudioReport> {
    let mut source = FfmpegAudioSource::open_path_with_options(
        video_path,
        FfmpegAudioSourceOptions::recorded().samples_per_chunk(16_384),
    )?;
    let mut pipeline = video_analysis_core::AudioPipeline::builder()
        .analyzer(AudioEnergyAnalyzer::default())
        .build()?;
    while let Some(frame) = source.next_audio_frame()? {
        let frame_ref = frame.as_frame()?;
        let record = DataRecord::audio_frame("audio", pipeline.frames_processed(), &frame_ref);
        push_record(aggregator, record, data_buckets)?;
        pipeline.process_frame(frame)?;
    }

    let result = pipeline.finish_analysis()?;
    Ok(AudioReport {
        status: "completed".to_string(),
        frames_processed: result.frames_processed,
        events: result.events.iter().map(event_report).collect(),
        message: None,
    })
}

fn analyze_transcript_text(
    request: &YoutubeRunRequest,
    transcription: &TranscriptionReport,
    aggregator: &mut BucketAggregator,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<TextReport> {
    if transcription.status != "completed" {
        return Ok(TextReport {
            status: "skipped".to_string(),
            segments_processed: 0,
            events: Vec::new(),
            message: Some("no transcript available".to_string()),
        });
    }

    let mut builder =
        video_analysis_core::TextPipeline::builder().analyzer(TranscriptHeuristicAnalyzer);
    if let Some(config) = &request.models.text {
        let backend = ExternalCommandModel::new(
            &config.command,
            downloaded_external_model(
                "text-command",
                ModelTask::Custom("text_classification".to_string()),
            ),
        )
        .args(config.args.clone());
        builder = builder.analyzer(ModelTextAnalyzer::new("transcript_text_model", backend));
    }
    let mut pipeline = builder.build()?;

    for segment in &transcription.segments {
        let mut owned = video_analysis_core::OwnedTextSegment::new(segment.index, &segment.text);
        if let Some(seconds) = segment.start_seconds {
            owned = owned.timestamp(Timestamp::new(
                (seconds * 1_000.0).round() as i64,
                video_analysis_core::Timebase::new(1, 1_000),
            ));
        }
        let segment_ref = owned.as_segment();
        push_record(
            aggregator,
            DataRecord::text_segment("transcript", &segment_ref),
            data_buckets,
        )?;
        pipeline.process_segment(owned)?;
    }

    let result = pipeline.finish_analysis()?;
    Ok(TextReport {
        status: "completed".to_string(),
        segments_processed: result.segments_processed,
        events: result.events.iter().map(event_report).collect(),
        message: None,
    })
}

#[derive(Default)]
struct AudioEnergyAnalyzer {
    current_label: Option<String>,
}

impl AudioAnalyzer for AudioEnergyAnalyzer {
    fn name(&self) -> &str {
        "audio_energy"
    }

    fn process_frame(
        &mut self,
        frame: &AudioFrame<'_>,
    ) -> video_analysis_core::Result<Vec<AnalysisEvent>> {
        let rms = rms(frame.data);
        let label = if rms < 0.01 {
            "audio:silence"
        } else if rms > 0.2 {
            "audio:loud"
        } else {
            "audio:active"
        };
        if self.current_label.as_deref() == Some(label) {
            return Ok(Vec::new());
        }
        self.current_label = Some(label.to_string());
        Ok(vec![AnalysisEvent::new(self.name(), label)
            .at_timestamp(frame.timestamp)
            .score(rms)])
    }
}

fn rms(buffer: &AudioBuffer) -> f32 {
    let (sum, count) = match buffer {
        AudioBuffer::U8(values) => values.iter().fold((0.0, 0_usize), |(sum, count), value| {
            let sample = (*value as f32 - 128.0) / 128.0;
            (sum + sample * sample, count + 1)
        }),
        AudioBuffer::I16(values) => values.iter().fold((0.0, 0_usize), |(sum, count), value| {
            let sample = *value as f32 / i16::MAX as f32;
            (sum + sample * sample, count + 1)
        }),
        AudioBuffer::I32(values) => values.iter().fold((0.0, 0_usize), |(sum, count), value| {
            let sample = *value as f32 / i32::MAX as f32;
            (sum + sample * sample, count + 1)
        }),
        AudioBuffer::F32(values) => values.iter().fold((0.0, 0_usize), |(sum, count), value| {
            (sum + value * value, count + 1)
        }),
    };
    if count == 0 {
        0.0
    } else {
        (sum / count as f32).sqrt()
    }
}

#[derive(Default)]
struct TranscriptHeuristicAnalyzer;

impl TextAnalyzer for TranscriptHeuristicAnalyzer {
    fn name(&self) -> &str {
        "transcript_heuristics"
    }

    fn process_segment(
        &mut self,
        segment: &TextSegment<'_>,
    ) -> video_analysis_core::Result<Vec<AnalysisEvent>> {
        let mut events = Vec::new();
        let text = segment.text.trim();
        if text.ends_with('?') {
            events.push(text_event(
                self.name(),
                "speech:question",
                segment.timestamp,
            ));
        }
        if text.contains("http://") || text.contains("https://") || text.contains("www.") {
            events.push(text_event(self.name(), "speech:url", segment.timestamp));
        }
        if text
            .split_whitespace()
            .any(|word| word.chars().any(|character| character.is_ascii_digit()))
        {
            events.push(text_event(self.name(), "speech:number", segment.timestamp));
        }
        if text.split_whitespace().count() >= 30 {
            events.push(text_event(
                self.name(),
                "speech:long_segment",
                segment.timestamp,
            ));
        }
        Ok(events)
    }
}

fn text_event(analyzer: &str, label: &str, timestamp: Option<Timestamp>) -> AnalysisEvent {
    let event = AnalysisEvent::new(analyzer, label);
    if let Some(timestamp) = timestamp {
        event.at_timestamp(timestamp)
    } else {
        event
    }
}

struct SampledVideoAnalyzer<A> {
    inner: A,
    every: u64,
}

impl<A> SampledVideoAnalyzer<A> {
    fn new(inner: A, every: u64) -> Self {
        Self {
            inner,
            every: every.max(1),
        }
    }
}

impl<A: VideoAnalyzer> VideoAnalyzer for SampledVideoAnalyzer<A> {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn process_frame(
        &mut self,
        frame: &VideoFrame<'_>,
    ) -> video_analysis_core::Result<Vec<Observation>> {
        if frame.position.frame_index % self.every == 0 {
            self.inner.process_frame(frame)
        } else {
            Ok(Vec::new())
        }
    }

    fn finish(
        &mut self,
        last_position: Option<video_analysis_core::FramePosition>,
    ) -> video_analysis_core::Result<Vec<Observation>> {
        self.inner.finish(last_position)
    }
}

fn downloaded_external_model(name: &str, task: ModelTask) -> DownloadedModel {
    DownloadedModel {
        spec: HuggingFaceModelSpec::new(name, task).name(name),
        files: BTreeMap::new(),
    }
}

fn observation_report(observation: &Observation) -> ObservationReport {
    ObservationReport {
        timestamp_seconds: observation.timestamp.map(|timestamp| timestamp.seconds()),
        frame_index: observation.frame.map(|position| position.frame_index),
        scene_index: observation.scene_index,
        analyzer: observation.analyzer.clone(),
        kind: observation_kind_name(&observation.kind),
        label: observation.label.clone(),
        text: observation.text.clone(),
        score: observation.score,
        region: observation.region.map(region_report),
        track_id: observation.track_id.clone(),
        attributes: observation.attributes.clone(),
    }
}

fn observation_kind_name(kind: &ObservationKind) -> String {
    match kind {
        ObservationKind::Text => "text".to_string(),
        ObservationKind::Face => "face".to_string(),
        ObservationKind::Object => "object".to_string(),
        ObservationKind::Scene => "scene".to_string(),
        ObservationKind::Custom(value) => value.clone(),
    }
}

fn region_report(region: BoundingBox) -> RegionReport {
    RegionReport {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
    }
}

fn event_report(event: &AnalysisEvent) -> EventReport {
    EventReport {
        timestamp_seconds: event.timestamp.map(|timestamp| timestamp.seconds()),
        analyzer: event.analyzer.clone(),
        label: event.label.clone(),
        score: event.score,
    }
}

fn bucket_report(bucket: &DataBucket) -> DataBucketReport {
    DataBucketReport {
        bucket_index: bucket.bucket_index,
        records: bucket.records,
        estimated_bytes: bucket.estimated_bytes,
        streams: bucket
            .streams
            .iter()
            .map(|(stream_id, summary)| stream_bucket_report(stream_id, summary))
            .collect(),
    }
}

fn push_record(
    aggregator: &mut BucketAggregator,
    record: DataRecord<'_>,
    data_buckets: &mut Vec<DataBucketReport>,
) -> Result<()> {
    for bucket in aggregator.push(record)? {
        data_buckets.push(bucket_report(&bucket));
    }
    Ok(())
}

fn stream_bucket_report(stream_id: &str, summary: &StreamSummary) -> StreamBucketReport {
    StreamBucketReport {
        stream_id: stream_id.to_string(),
        records: summary.records,
        estimated_bytes: summary.estimated_bytes,
        payload_counts: summary
            .payload_counts
            .iter()
            .map(|(kind, count)| (data_stream_kind_name(*kind), *count))
            .collect(),
        video_frames: summary.video.frames,
        audio_frames: summary.audio.frames,
        text_segments: summary.text.segments,
    }
}

fn data_stream_kind_name(kind: DataStreamKind) -> String {
    match kind {
        DataStreamKind::Video => "video".to_string(),
        DataStreamKind::Audio => "audio".to_string(),
        DataStreamKind::Text => "text".to_string(),
        DataStreamKind::Number => "number".to_string(),
        DataStreamKind::Vector => "vector".to_string(),
        DataStreamKind::Custom => "custom".to_string(),
    }
}

fn video_report_with_observations(
    mut video_report: VideoReport,
    observations: Vec<ObservationReport>,
) -> VideoReport {
    video_report.observations = observations;
    video_report
}

fn write_json_report(path: &Path, value: &YoutubeVideoReport) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(path, bytes)?;
    Ok(())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_youtube_url_host_and_protocol() {
        assert!(validate_youtube_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert!(validate_youtube_url("https://youtu.be/abc").is_ok());
        assert!(validate_youtube_url("ftp://youtube.com/watch?v=abc").is_err());
        assert!(validate_youtube_url("https://example.com/watch?v=abc").is_err());
    }

    #[test]
    fn rejects_empty_local_file_path() {
        let request = YoutubeRunRequest::local_file(PathBuf::new());
        assert!(request.validate().is_err());
    }

    #[test]
    fn resolves_default_work_dir() {
        let request = YoutubeRunRequest::youtube_url("https://youtu.be/abc");
        let run_id = uuid::Uuid::nil();
        assert_eq!(
            request.resolved_work_dir(Path::new("/tmp/studio"), run_id),
            Path::new("/tmp/studio")
                .join("runs")
                .join(run_id.to_string())
        );
    }

    #[test]
    fn serializes_youtube_run_request() {
        let request = YoutubeRunRequest {
            source: SourceSpec::YoutubeUrl {
                url: "https://youtu.be/abc".to_string(),
            },
            work_dir: Some(PathBuf::from("work")),
            scene_threshold: DEFAULT_SCENE_THRESHOLD,
            min_scene_len: DEFAULT_MIN_SCENE_LEN,
            max_frames: Some(1),
            visual_sample_every: DEFAULT_VISUAL_SAMPLE_EVERY,
            transcription: TranscriptionConfig::default(),
            models: ModelCommandConfig::default(),
        };
        let json = serde_json::to_string(&request).unwrap();
        let parsed: YoutubeRunRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, request);
    }

    #[test]
    fn serializes_report_shape_for_ui() {
        let report = YoutubeVideoReport {
            use_case: "youtube_video_analysis".to_string(),
            source: SourceReport {
                url: None,
                local_video: "video.mp4".to_string(),
            },
            assets: AssetReport {
                work_dir: "work".to_string(),
                report_path: "work/analysis.json".to_string(),
                audio_wav: None,
            },
            capabilities: CapabilityReport {
                completed: vec!["scene_detection".to_string()],
                skipped: Vec::new(),
            },
            video: VideoReport {
                width: 64,
                height: 64,
                frame_rate: "10/1".to_string(),
                duration_seconds: Some(1.0),
                frames_processed: 1,
                scenes: Vec::new(),
                observations: Vec::new(),
            },
            transcription: TranscriptionReport {
                status: "skipped".to_string(),
                text: None,
                segments: Vec::new(),
                message: None,
            },
            audio: AudioReport {
                status: "skipped".to_string(),
                frames_processed: 0,
                events: Vec::new(),
                message: None,
            },
            text: TextReport {
                status: "skipped".to_string(),
                segments_processed: 0,
                events: Vec::new(),
                message: None,
            },
            data_buckets: Vec::new(),
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"data_buckets\""));
    }

    #[test]
    fn builds_command_configs_without_shell_parsing() {
        let config = ExternalCommandConfig {
            command: PathBuf::from("/bin/echo"),
            args: vec!["hello world".to_string(), "$(not-shell)".to_string()],
        };
        assert_eq!(config.args.len(), 2);
        assert_eq!(config.args[0], "hello world");
    }

    #[test]
    fn parses_whisper_json_segments() {
        let parsed: WhisperOutput = serde_json::from_str(
            r#"{"text":"hello world","segments":[{"start":0.0,"end":1.5,"text":" hello"}]}"#,
        )
        .unwrap();

        assert_eq!(parsed.text.as_deref(), Some("hello world"));
        assert_eq!(parsed.segments.len(), 1);
        assert_eq!(parsed.segments[0].start, Some(0.0));
    }
}
