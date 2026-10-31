import {
  type VideoRedCarsRunRequest,
  type YoutubeCollectionRunRequest,
  filterYoutubeCollectionManifest,
  type SongAnalysisRunRequest,
  type SubtitleGenerationRunRequest,
  type TranscriptionEngine,
  type WhisperCppModel,
  type CliRun,
  type StudioReport,
} from "../index";
import {
  type YoutubeRunRequest,
  type TranscriptionCatalog,
  type WorkflowTypeSpec,
  type RunRecord,
} from "../api/client";
import { validateWorkflowValue } from "../workflowTypeSpec";
import { initialForm } from "./runForm";
import {
  isImageSimilarityRunRequest,
  isSongAnalysisRunRequest,
  isSubtitleGenerationRunRequest,
  isVideoRedCarsRunRequest,
  isYoutubeCollectionRunRequest,
} from "./runGuards";
import type {
  CollectionManifestPreviewState,
  ImageSimilarityRunRequest,
  WorkflowKindId,
  WorkflowRunForm,
} from "./types";
import { defaultOutputForWorkflowKind, defaultWorkDirForWorkflowKind } from "./workflowKinds";
import { effectiveSourceMode } from "./workflowRunInputs";
import type { FlowPort, SavedWorkflowRun, WorkflowRunInputModel } from "../workflow-editor/types";

export function buildCommand(
  form: WorkflowRunForm,
  inputModel?: WorkflowRunInputModel,
  workflowKind: WorkflowKindId = "youtube-video",
): string[] {
  if (workflowKind === "image-similarity") {
    return ["studio-ui", "image-similarity", "--data-source", form.imageDataSourceId || "auto", "--top-k", "3"];
  }
  if (workflowKind === "youtube-collection" || form.sourceMode === "collection") {
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/youtube-collection/runs",
      "--url",
      form.url,
      "--work-dir",
      form.workDir,
      "--max-items",
      form.collectionMaxItems || "all",
    ];
    if (form.collectionTitleContains.trim()) {
      command.push("--title-contains", form.collectionTitleContains.trim());
    }
    if (form.collectionDurationMin.trim()) {
      command.push("--metadata-duration-min", form.collectionDurationMin.trim());
    }
    if (form.collectionDurationMax.trim()) {
      command.push("--metadata-duration-max", form.collectionDurationMax.trim());
    }
    if (form.localDurationMin.trim()) {
      command.push("--local-duration-min", form.localDurationMin.trim());
    }
    if (form.localDurationMax.trim()) {
      command.push("--local-duration-max", form.localDurationMax.trim());
    }
    command.push("--already-downloaded", form.alreadyDownloaded);
    return command;
  }
  if (workflowKind === "song-analysis") {
    const sourceMode = form.sourceMode === "file" ? "file" : "url";
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/song-analysis/runs",
      "--work-dir",
      form.workDir,
      "--catalog",
      form.songCatalogPath || "default",
      "--window-seconds",
      String(form.songWindowSeconds),
      "--hop-seconds",
      String(form.songHopSeconds),
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    if (form.skipTranscription) {
      command.push("--skip-transcription");
    }
    command.push("--transcription-engine", form.transcriptionEngine);
    if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
      command.push("--transcriber-command", form.transcriptionCommand.trim());
    }
    if (form.musicCommand.trim()) {
      command.push("--music-command", form.musicCommand.trim());
    }
    return command;
  }
  if (workflowKind === "subtitle-generation") {
    const sourceMode = effectiveSourceMode(form, inputModel);
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/subtitle-generation/runs",
      "--work-dir",
      form.workDir,
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    command.push("--transcription-engine", form.transcriptionEngine);
    if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
      command.push("--transcriber-command", form.transcriptionCommand.trim());
    }
    command.push("--write-to-video-folder");
    return command;
  }
  if (workflowKind === "video-red-cars") {
    const sourceMode = effectiveSourceMode(form, inputModel);
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/video-red-cars/runs",
      "--work-dir",
      form.workDir,
      "--scene-threshold",
      String(form.sceneThreshold),
      "--min-scene-len",
      String(form.minSceneLen),
      "--visual-sample-every",
      String(form.visualSampleEvery),
      "--target-object",
      form.targetObject.trim() || "car",
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    if (form.maxFrames.trim()) {
      command.push("--max-frames", form.maxFrames.trim());
    }
    if (form.objectCommand.trim()) {
      command.push("--vehicle-detector", form.objectCommand.trim());
    }
    return command;
  }
  const sourceMode = effectiveSourceMode(form, inputModel);
  const command = [
    "studio-api",
    "POST",
    "/api/workflows/youtube-video/runs",
    "--work-dir",
    form.workDir,
    "--scene-threshold",
    String(form.sceneThreshold),
    "--min-scene-len",
    String(form.minSceneLen),
    "--visual-sample-every",
    String(form.visualSampleEvery),
  ];

  if (sourceMode === "url") {
    command.push("--url", form.url);
  } else {
    command.push("--input", form.input);
  }
  if (form.maxFrames.trim()) {
    command.push("--max-frames", form.maxFrames.trim());
  }
  if (form.skipTranscription) {
    command.push("--skip-transcription");
  }
  command.push("--transcription-engine", form.transcriptionEngine);
  if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
    command.push("--transcriber-command", form.transcriptionCommand.trim());
  }
  if (form.objectCommand.trim()) {
    command.push("--object-command", form.objectCommand.trim());
  }
  if (form.ocrCommand.trim()) {
    command.push("--ocr-command", form.ocrCommand.trim());
  }
  if (form.textCommand.trim()) {
    command.push("--text-command", form.textCommand.trim());
  }

  return command;
}

export function buildYoutubeRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): YoutubeRunRequest {
  const sourceMode = effectiveSourceMode(form, inputModel);
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    scene_threshold: form.sceneThreshold,
    min_scene_len: form.minSceneLen,
    max_frames: form.maxFrames.trim() ? Number(form.maxFrames.trim()) : null,
    visual_sample_every: form.visualSampleEvery,
    transcription: {
      ...buildTranscriptionRequest(form, !form.skipTranscription),
    },
    models: {
      object: commandConfig(form.objectCommand),
      ocr: commandConfig(form.ocrCommand),
      text: commandConfig(form.textCommand),
    },
  };
}

export function buildVideoRedCarsRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): VideoRedCarsRunRequest {
  const sourceMode = effectiveSourceMode(form, inputModel);
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    scene_threshold: form.sceneThreshold,
    min_scene_len: form.minSceneLen,
    max_frames: form.maxFrames.trim() ? Number(form.maxFrames.trim()) : null,
    visual_sample_every: form.visualSampleEvery,
    target_object: form.targetObject.trim() || "car",
    vehicle_detector: {
      command: form.objectCommand.trim(),
      args: [],
    },
  };
}

export function buildYoutubeCollectionRunRequest(
  form: WorkflowRunForm,
  manifestPreview?: CollectionManifestPreviewState,
): YoutubeCollectionRunRequest {
  const previewManifest =
    manifestPreview?.status === "ready" && manifestPreview.manifest && !manifestPreview.stale
      ? filterYoutubeCollectionManifest(manifestPreview.manifest, manifestPreview.selectedItemIds)
      : null;
  return {
    source: { kind: youtubeCollectionSourceKind(form.url), url: form.url.trim() },
    manifest: previewManifest && previewManifest.items.length > 0 ? previewManifest : null,
    metadata_filter: {
      title_contains: form.collectionTitleContains.trim() || null,
      title_excludes: [],
      duration_seconds_min: optionalNumber(form.collectionDurationMin),
      duration_seconds_max: optionalNumber(form.collectionDurationMax),
      already_downloaded: form.alreadyDownloaded,
    },
    local_file_filter: {
      duration_seconds_min: optionalNumber(form.localDurationMin),
      duration_seconds_max: optionalNumber(form.localDurationMax),
      extension_allowlist: parseCsv(form.localExtensions),
      failed_probe_behavior: "failed",
    },
    analysis: {
      scene_threshold: form.sceneThreshold,
      min_scene_len: form.minSceneLen,
      max_frames: form.maxFrames.trim() ? Number(form.maxFrames.trim()) : null,
      visual_sample_every: form.visualSampleEvery,
      transcription: buildTranscriptionRequest(form, !form.skipTranscription),
      models: {
        object: commandConfig(form.objectCommand),
        ocr: commandConfig(form.ocrCommand),
        text: commandConfig(form.textCommand),
      },
    },
    delete_filtered_downloads: false,
    work_dir: form.workDir.trim() || null,
    max_items: optionalInteger(form.collectionMaxItems),
  };
}

export function buildSongAnalysisRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SongAnalysisRunRequest {
  const sourceMode = form.sourceMode === "file" ? "file" : effectiveSourceMode(form, inputModel) === "file" ? "file" : "url";
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    catalog: {
      db_path: form.songCatalogPath.trim() || null,
    },
    identification: {
      enabled: true,
      min_score: form.songMinScore,
      ambiguous_margin: form.songAmbiguousMargin,
      max_candidates: form.songMaxCandidates,
    },
    transcription: buildTranscriptionRequest(form, !form.skipTranscription),
    music: {
      enabled: true,
      command: commandConfig(form.musicCommand),
      window_seconds: form.songWindowSeconds,
      hop_seconds: form.songHopSeconds,
      min_bpm: form.songMinBpm,
      max_bpm: form.songMaxBpm,
    },
  };
}

export function buildSubtitleGenerationRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SubtitleGenerationRunRequest {
  const sourceMode = effectiveSourceMode(form, inputModel);
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    transcription: buildTranscriptionRequest(form, true),
    overwrite: true,
  };
}

export function buildImageSimilarityRunRequest(form: WorkflowRunForm): ImageSimilarityRunRequest {
  return {
    source: {
      kind: "pasted_image",
      name: form.imageSourceName || "query image",
      data_url: form.imageDataUrl,
    },
    data_source_id: form.imageDataSourceId,
    top_k: 3,
    work_dir: form.workDir.trim() || null,
  };
}

export function formFromYoutubeRunRequest(request: YoutubeRunRequest, catalog?: TranscriptionCatalog | null): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? initialForm.workDir,
    sceneThreshold: request.scene_threshold,
    minSceneLen: request.min_scene_len,
    maxFrames: request.max_frames ? String(request.max_frames) : "",
    visualSampleEvery: request.visual_sample_every,
    skipTranscription: !request.transcription.enabled,
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
    objectCommand: commandConfigToInput(request.models.object),
    ocrCommand: commandConfigToInput(request.models.ocr),
    textCommand: commandConfigToInput(request.models.text),
  };
}

export function formFromVideoRedCarsRunRequest(request: VideoRedCarsRunRequest): WorkflowRunForm {
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/video-red-cars",
    output: request.work_dir
      ? `${request.work_dir.replace(/\/$/, "")}/video-red-cars.json`
      : "workflow-output/video-red-cars/video-red-cars.json",
    sceneThreshold: request.scene_threshold,
    minSceneLen: request.min_scene_len,
    maxFrames: request.max_frames ? String(request.max_frames) : "",
    visualSampleEvery: request.visual_sample_every,
    skipTranscription: true,
    targetObject: request.target_object ?? "car",
    objectCommand: request.vehicle_detector.command,
  };
}

export function formFromYoutubeCollectionRunRequest(
  request: YoutubeCollectionRunRequest,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(
    request.analysis.transcription.engine,
    request.analysis.transcription.command,
  );
  return {
    ...initialForm,
    sourceMode: "collection",
    url: request.source?.url ?? "",
    workDir: request.work_dir ?? "workflow-output/youtube-collection",
    sceneThreshold: request.analysis.scene_threshold,
    minSceneLen: request.analysis.min_scene_len,
    maxFrames: request.analysis.max_frames ? String(request.analysis.max_frames) : "",
    visualSampleEvery: request.analysis.visual_sample_every,
    skipTranscription: !request.analysis.transcription.enabled,
    transcriptionEngine,
    transcriptionModel: request.analysis.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.analysis.transcription.command),
    objectCommand: commandConfigToInput(request.analysis.models.object),
    ocrCommand: commandConfigToInput(request.analysis.models.ocr),
    textCommand: commandConfigToInput(request.analysis.models.text),
    collectionMaxItems: request.max_items ? String(request.max_items) : "",
    collectionTitleContains: request.metadata_filter.title_contains ?? "",
    collectionDurationMin: request.metadata_filter.duration_seconds_min ? String(request.metadata_filter.duration_seconds_min) : "",
    collectionDurationMax: request.metadata_filter.duration_seconds_max ? String(request.metadata_filter.duration_seconds_max) : "",
    localDurationMin: request.local_file_filter.duration_seconds_min ? String(request.local_file_filter.duration_seconds_min) : "",
    localDurationMax: request.local_file_filter.duration_seconds_max ? String(request.local_file_filter.duration_seconds_max) : "",
    localExtensions: request.local_file_filter.extension_allowlist?.join(",") ?? initialForm.localExtensions,
    alreadyDownloaded: request.metadata_filter.already_downloaded ?? "reuse",
  };
}

export function formFromSongAnalysisRunRequest(request: SongAnalysisRunRequest, catalog?: TranscriptionCatalog | null): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/song-analysis",
    output: request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/song-analysis.json` : "workflow-output/song-analysis/song-analysis.json",
    songCatalogPath: request.catalog.db_path ?? "",
    songMinScore: request.identification.min_score,
    songAmbiguousMargin: request.identification.ambiguous_margin,
    songMaxCandidates: request.identification.max_candidates,
    skipTranscription: !request.transcription.enabled,
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
    songWindowSeconds: request.music.window_seconds,
    songHopSeconds: request.music.hop_seconds,
    songMinBpm: request.music.min_bpm,
    songMaxBpm: request.music.max_bpm,
    musicCommand: commandConfigToInput(request.music.command),
  };
}

export function formFromSubtitleGenerationRunRequest(
  request: SubtitleGenerationRunRequest,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/subtitle-generation",
    output: request.work_dir
      ? `${request.work_dir.replace(/\/$/, "")}/subtitle-generation.json`
      : "workflow-output/subtitle-generation/subtitle-generation.json",
    skipTranscription: false,
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
  };
}

export function formFromImageSimilarityRunRequest(request: ImageSimilarityRunRequest): WorkflowRunForm {
  return {
    ...initialForm,
    sourceMode: "file",
    workDir: request.work_dir ?? "workflow-output/image-similarity",
    output: "workflow-output/image-similarity/image-similarity.json",
    imageDataUrl: request.source.data_url,
    imageSourceName: request.source.name,
    imageDataSourceId: request.data_source_id,
  };
}

export function workflowInputSummaryFromForm(
  form: WorkflowRunForm,
  inputModel?: WorkflowRunInputModel,
  workflowKind?: WorkflowKindId,
): string {
  if (workflowKind === "image-similarity" && form.imageDataUrl.trim()) {
    return form.imageSourceName || "Query image";
  }
  if (form.sourceMode === "collection") {
    return form.url.trim() || "YouTube collection";
  }
  if (effectiveSourceMode(form, inputModel) === "url") {
    return form.url.trim() || "YouTube URL";
  }
  return form.input.trim() || "Local file";
}

function commandConfig(command: string) {
  const trimmed = command.trim();
  return trimmed ? { command: trimmed, args: [] } : null;
}

function commandConfigToInput(config: { command: string; args: string[] } | null | undefined): string {
  if (!config) {
    return "";
  }
  return [config.command, ...config.args].filter(Boolean).join(" ");
}

function buildTranscriptionRequest(form: WorkflowRunForm, enabled: boolean) {
  const usesNativeWhisperCpp = form.transcriptionEngine === "whisper_cpp";
  return {
    enabled,
    engine: form.transcriptionEngine,
    command: usesNativeWhisperCpp ? null : commandConfig(form.transcriptionCommand),
    whisper_cpp: usesNativeWhisperCpp
      ? {
          model: form.transcriptionModel,
          language: null,
          translate: false,
          threads: null,
        }
      : undefined,
  };
}

function normalizedTranscriptionEngine(
  value: TranscriptionEngine | undefined,
  command?: { command: string; args: string[] } | null,
): Exclude<TranscriptionEngine, "fast_whisper"> {
  if (value === "whisperx") {
    return "whisperx";
  }
  if (value === "faster_whisper" || value === "fast_whisper") {
    return "faster_whisper";
  }
  if (value === "whisper_cpp" || value == null) {
    return "whisper_cpp";
  }
  return command ? "whisper" : "whisper_cpp";
}

export function defaultTranscriptionEngine(catalog?: TranscriptionCatalog | null): Exclude<TranscriptionEngine, "fast_whisper"> {
  return normalizedTranscriptionEngine(catalog?.default_engine);
}

export function defaultWhisperCppModel(catalog?: TranscriptionCatalog | null): WhisperCppModel {
  return catalog?.whisper_cpp.default_model ?? initialForm.transcriptionModel;
}

export function createDefaultRunForm(
  workflowKind: WorkflowKindId,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  return {
    ...initialForm,
    sourceMode: workflowKind === "youtube-collection" ? "collection" : "url",
    workDir: defaultWorkDirForWorkflowKind(workflowKind),
    output: defaultOutputForWorkflowKind(workflowKind),
    transcriptionEngine: defaultTranscriptionEngine(catalog),
    transcriptionModel: defaultWhisperCppModel(catalog),
  };
}

export function defaultTranscriptionCommand(engine: Exclude<TranscriptionEngine, "fast_whisper">): string {
  switch (engine) {
    case "whisper_cpp":
      return "";
    case "faster_whisper":
      return "whisper-ctranslate2";
    case "whisperx":
      return "whisperx";
    case "whisper":
      return "whisper";
  }
}

function youtubeCollectionSourceKind(url: string): "playlist_url" | "channel_url" | "youtube_url" {
  const normalized = url.toLowerCase();
  if (normalized.includes("/channel/") || normalized.includes("/@") || normalized.includes("/c/") || normalized.includes("/user/")) {
    return "channel_url";
  }
  if (normalized.includes("list=") || normalized.includes("/playlist")) {
    return "playlist_url";
  }
  return "youtube_url";
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInteger(value: string): number | null {
  const parsed = optionalNumber(value);
  return parsed == null ? null : Math.max(1, Math.floor(parsed));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseWorkflowInputValue(raw: string, spec: WorkflowTypeSpec): unknown {
  const trimmed = raw.trim();
  switch (spec.type) {
    case "string":
    case "binary":
      return raw;
    case "number": {
      const parsed = Number(trimmed);
      if (!trimmed || !Number.isFinite(parsed)) {
        throw new Error("Expected a number.");
      }
      return parsed;
    }
    case "boolean":
      if (trimmed === "true") {
        return true;
      }
      if (trimmed === "false") {
        return false;
      }
      throw new Error("Expected true or false.");
    case "null":
      if (trimmed === "null") {
        return null;
      }
      throw new Error("Expected null.");
    case "any":
      return trimmed ? JSON.parse(trimmed) : null;
    case "array":
    case "object":
    case "union":
      if (!trimmed) {
        throw new Error("Expected JSON.");
      }
      return JSON.parse(trimmed);
  }
}

function validateWorkflowInputValue(portValue: FlowPort, raw: string): string | null {
  if (!raw.trim()) {
    return portValue.optional ? null : `${portValue.label} is required.`;
  }
  let parsed: unknown;
  try {
    parsed = parseWorkflowInputValue(raw, portValue.valueType);
  } catch (error) {
    return `${portValue.label}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const issue = validateWorkflowValue(portValue.valueType, parsed);
  if (!issue) {
    return null;
  }
  return `${portValue.label}: expected ${issue.expected} at ${issue.path}, got ${issue.actual}.`;
}

export function collectionManifestFormKey(form: WorkflowRunForm): string {
  return JSON.stringify({
    url: form.url.trim(),
    collectionMaxItems: form.collectionMaxItems.trim(),
    collectionTitleContains: form.collectionTitleContains.trim(),
    collectionDurationMin: form.collectionDurationMin.trim(),
    collectionDurationMax: form.collectionDurationMax.trim(),
    alreadyDownloaded: form.alreadyDownloaded,
  });
}

export function runRecordToCliRun(run: RunRecord, clientLabel: string, workflowName: string): CliRun {
  return {
    command: clientLabel,
    args: [workflowName, run.run_id],
    status: run.status,
    exit_code: run.status === "succeeded" ? 0 : run.status === "failed" ? 1 : null,
    output_files: [run.report_path],
    message: run.message,
  };
}

export function workflowRunToCliRun(run: SavedWorkflowRun): CliRun {
  return {
    command: "studio-api",
    args: [run.workflowName, run.backendRunId ?? run.id],
    status: run.status,
    exit_code: run.status === "succeeded" ? 0 : run.status === "failed" ? 1 : null,
    output_files: [run.reportPath ?? reportPathForRequest(run.request)],
    message: run.message ?? null,
  };
}

function reportPathForRequest(
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest | ImageSimilarityRunRequest,
): string {
  if (isYoutubeCollectionRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/collection-analysis.json` : "collection-analysis.json";
  }
  if (isSubtitleGenerationRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/subtitle-generation.json` : "subtitle-generation.json";
  }
  if (isSongAnalysisRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/song-analysis.json` : "song-analysis.json";
  }
  if (isImageSimilarityRunRequest(request)) {
    return "browser:image-similarity";
  }
  if (isVideoRedCarsRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/video-red-cars.json` : "video-red-cars.json";
  }
  return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/analysis.json` : initialForm.output;
}

export function downloadReport(report: StudioReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "video-analysis-report.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getRunValidation(
  form: WorkflowRunForm,
  inputModel?: WorkflowRunInputModel,
  workflowKind: WorkflowKindId = "youtube-video",
): string | null {
  const isRedCars = workflowKind === "video-red-cars";
  const isSong = workflowKind === "song-analysis";
  const isSubtitle = workflowKind === "subtitle-generation";
  if (workflowKind === "image-similarity") {
    if (!form.imageDataUrl.trim()) {
      return "Paste or upload a query image.";
    }
    return null;
  }
  if (workflowKind === "youtube-collection" && form.sourceMode === "collection") {
    const url = form.url.trim();
    if (!url) {
      return "Enter a YouTube playlist or channel URL.";
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) {
        return "Use a youtube.com or youtu.be URL.";
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "Use an http or https URL.";
      }
    } catch {
      return "Enter a valid YouTube URL.";
    }
    for (const [label, value] of [
      ["Max items", form.collectionMaxItems],
      ["Metadata duration min", form.collectionDurationMin],
      ["Metadata duration max", form.collectionDurationMax],
      ["Local duration min", form.localDurationMin],
      ["Local duration max", form.localDurationMax],
    ] as const) {
      if (value.trim() && Number(value) < 0) {
        return `${label} must be non-negative.`;
      }
    }
    return null;
  }
  const sourceMode = isSong || isSubtitle ? (form.sourceMode === "file" ? "file" : "url") : effectiveSourceMode(form, inputModel);
  if (sourceMode === "url") {
    const url = form.url.trim();
    if (!url) {
      return "Enter a YouTube URL.";
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) {
        return "Use a youtube.com or youtu.be URL.";
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "Use an http or https URL.";
      }
    } catch {
      return "Enter a valid YouTube URL.";
    }
  }
  if (sourceMode === "file" && !form.input.trim()) {
    return "Enter a local video file path.";
  }
  if (!form.output.trim()) {
    return "Enter an output JSON path.";
  }
  if (!form.workDir.trim()) {
    return "Enter a work directory.";
  }
  if (isSong) {
    if (!Number.isFinite(form.songMinScore) || form.songMinScore < 0 || form.songMinScore > 1) {
      return "Song match score must be between 0 and 1.";
    }
    if (!Number.isFinite(form.songAmbiguousMargin) || form.songAmbiguousMargin < 0) {
      return "Song ambiguous margin must be non-negative.";
    }
    if (!Number.isFinite(form.songMaxCandidates) || form.songMaxCandidates < 1) {
      return "Song candidates must be at least 1.";
    }
    if (!Number.isFinite(form.songWindowSeconds) || form.songWindowSeconds <= 0) {
      return "Window seconds must be positive.";
    }
    if (!Number.isFinite(form.songHopSeconds) || form.songHopSeconds <= 0) {
      return "Hop seconds must be positive.";
    }
    if (!Number.isFinite(form.songMinBpm) || !Number.isFinite(form.songMaxBpm) || form.songMinBpm >= form.songMaxBpm) {
      return "Minimum BPM must be lower than maximum BPM.";
    }
    return null;
  }
  if (isSubtitle) {
    return null;
  }
  if (!Number.isFinite(form.sceneThreshold) || form.sceneThreshold < 0) {
    return "Scene threshold must be zero or greater.";
  }
  if (!Number.isFinite(form.minSceneLen) || form.minSceneLen < 1) {
    return "Minimum scene frames must be at least 1.";
  }
  if (!Number.isFinite(form.visualSampleEvery) || form.visualSampleEvery < 1) {
    return "Visual sample step must be at least 1.";
  }
  if (form.maxFrames.trim() && !/^[1-9]\d*$/.test(form.maxFrames.trim())) {
    return "Max frames must be a positive integer.";
  }
  if (inputModel) {
    for (const input of inputModel.genericInputs) {
      const message = validateWorkflowInputValue(input.port, form.workflowInputs[input.key] ?? "");
      if (message) {
        return message;
      }
    }
  }
  return null;
}
