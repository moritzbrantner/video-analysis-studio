import {
  type YoutubeCollectionRunRequest,
  type VideoRedCarsRunRequest,
  type SongAnalysisRunRequest,
  type SubtitleGenerationRunRequest,
} from "../index";
import { type RunStatus, type YoutubeRunRequest } from "../api/client";
import type { ImageSimilarityRunRequest } from "./types";
import { isRecord } from "../shared/utils";

export function isRunStatus(value: unknown): value is RunStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled";
}

export function isYoutubeRunRequest(value: unknown): value is YoutubeRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.transcription) || !isRecord(value.models)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    typeof value.scene_threshold === "number" &&
    typeof value.min_scene_len === "number" &&
    (value.max_frames === undefined || value.max_frames === null || typeof value.max_frames === "number") &&
    typeof value.visual_sample_every === "number" &&
    typeof value.transcription.enabled === "boolean"
  );
}

export function isYoutubeCollectionRunRequest(value: unknown): value is YoutubeCollectionRunRequest {
  if (!isRecord(value) || !isRecord(value.metadata_filter) || !isRecord(value.local_file_filter) || !isRecord(value.analysis)) {
    return false;
  }
  const sourceValid = value.source === undefined || value.source === null || isYoutubeCollectionSource(value.source);
  return (
    sourceValid &&
    (value.manifest === undefined || value.manifest === null || isRecord(value.manifest)) &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    (value.max_items === undefined || value.max_items === null || typeof value.max_items === "number") &&
    typeof value.analysis.scene_threshold === "number" &&
    typeof value.analysis.min_scene_len === "number" &&
    typeof value.analysis.visual_sample_every === "number" &&
    isRecord(value.analysis.transcription) &&
    typeof value.analysis.transcription.enabled === "boolean" &&
    isRecord(value.analysis.models)
  );
}

export function isVideoRedCarsRunRequest(value: unknown): value is VideoRedCarsRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.vehicle_detector)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    typeof value.scene_threshold === "number" &&
    typeof value.min_scene_len === "number" &&
    (value.max_frames === undefined || value.max_frames === null || typeof value.max_frames === "number") &&
    typeof value.visual_sample_every === "number" &&
    (value.target_object === undefined || typeof value.target_object === "string") &&
    typeof value.vehicle_detector.command === "string" &&
    Array.isArray(value.vehicle_detector.args)
  );
}

export function isSongAnalysisRunRequest(value: unknown): value is SongAnalysisRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.catalog) || !isRecord(value.identification) || !isRecord(value.transcription) || !isRecord(value.music)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    (value.catalog.db_path === undefined || value.catalog.db_path === null || typeof value.catalog.db_path === "string") &&
    typeof value.identification.enabled === "boolean" &&
    typeof value.identification.min_score === "number" &&
    typeof value.identification.ambiguous_margin === "number" &&
    typeof value.identification.max_candidates === "number" &&
    typeof value.transcription.enabled === "boolean" &&
    typeof value.music.enabled === "boolean" &&
    typeof value.music.window_seconds === "number" &&
    typeof value.music.hop_seconds === "number" &&
    typeof value.music.min_bpm === "number" &&
    typeof value.music.max_bpm === "number"
  );
}

export function isSubtitleGenerationRunRequest(value: unknown): value is SubtitleGenerationRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.transcription)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    typeof value.transcription.enabled === "boolean" &&
    typeof value.overwrite === "boolean"
  );
}

export function isImageSimilarityRunRequest(value: unknown): value is ImageSimilarityRunRequest {
  return (
    isRecord(value) &&
    isRecord(value.source) &&
    value.source.kind === "pasted_image" &&
    typeof value.source.data_url === "string" &&
    typeof value.source.name === "string" &&
    typeof value.data_source_id === "string" &&
    typeof value.top_k === "number" &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string")
  );
}

function isYoutubeCollectionSource(value: unknown): value is YoutubeCollectionRunRequest["source"] {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    (value.kind === "playlist_url" || value.kind === "channel_url" || value.kind === "youtube_url")
  );
}
