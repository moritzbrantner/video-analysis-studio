import {
  type VideoRedCarsRunRequest,
  type YoutubeCollectionRunRequest,
  type SongAnalysisRunRequest,
  type SubtitleGenerationRunRequest,
} from "../index";
import { type YoutubeRunRequest, type RunRecord } from "../api/client";
import { initialForm } from "./runForm";
import {
  isImageSimilarityRunRequest,
  isRunStatus,
  isSongAnalysisRunRequest,
  isSubtitleGenerationRunRequest,
  isVideoRedCarsRunRequest,
  isYoutubeCollectionRunRequest,
  isYoutubeRunRequest,
} from "./runGuards";
import type { ImageSimilarityRunRequest, WorkflowKindId } from "./types";
import { isWorkflowKindId, workflowKindName } from "./workflowKinds";
import { isRecord } from "../shared/utils";
import { savedWorkflowRunsStorageKey } from "../workflow-editor/constants";
import { createWorkflowRunId } from "../workflow-editor/ids";
import type { SavedWorkflow, SavedWorkflowRun } from "../workflow-editor/types";

export function loadSavedWorkflowRuns(): SavedWorkflowRun[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(savedWorkflowRunsStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSavedWorkflowRun).slice(0, 50);
  } catch {
    return [];
  }
}

export function persistSavedWorkflowRuns(runs: SavedWorkflowRun[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowRunsStorageKey, JSON.stringify(runs.slice(0, 50)));
}

export function createSavedWorkflowRun(
  workflow: SavedWorkflow,
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest | ImageSimilarityRunRequest,
  inputSummary: string,
): SavedWorkflowRun {
  const createdAt = new Date().toISOString();
  return {
    id: createWorkflowRunId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowKind: workflow.kind,
    workflowVersion: workflow.version,
    createdAt,
    updatedAt: createdAt,
    status: "running",
    inputSummary,
    request,
    message: "Starting local analysis",
  };
}

export function workflowRunFromRunRecord(run: SavedWorkflowRun, record: RunRecord): SavedWorkflowRun {
  return {
    ...run,
    backendRunId: record.run_id,
    reportPath: record.report_path,
    status: record.status,
    updatedAt: record.updated_at,
    message: record.message,
  };
}

export function mergeBackendWorkflowRuns(
  localRuns: SavedWorkflowRun[],
  records: RunRecord[],
  workflows: SavedWorkflow[],
): SavedWorkflowRun[] {
  const localByBackendId = new Map(localRuns.flatMap((run) => (run.backendRunId ? [[run.backendRunId, run]] : [])));
  const backendRuns = records.map((record) => {
    const existing = localByBackendId.get(record.run_id);
    return existing
      ? workflowRunFromRunRecord(existing, record)
      : savedWorkflowRunFromBackendRecord(record, workflows);
  });
  const backendIds = new Set(records.map((record) => record.run_id));
  const legacyLocalRuns = localRuns.filter((run) => !run.backendRunId || !backendIds.has(run.backendRunId));
  return [...backendRuns, ...legacyLocalRuns].slice(0, 50);
}

function savedWorkflowRunFromBackendRecord(record: RunRecord, workflows: SavedWorkflow[]): SavedWorkflowRun {
  const workflowKind = workflowKindIdFromRunRecord(record);
  const workflow = workflows.find((candidate) => candidate.kind === workflowKind);
  return {
    id: `backend-${record.run_id}`,
    workflowId: workflow?.id ?? workflowKind,
    workflowName: workflow?.name ?? workflowKindName(workflowKind),
    workflowKind,
    workflowVersion: workflow?.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    status: record.status,
    inputSummary: record.report_path,
    request: placeholderRunRequest(workflowKind, record.work_dir),
    backendRunId: record.run_id,
    reportPath: record.report_path,
    message: record.message,
  };
}

function workflowKindIdFromRunRecord(record: RunRecord): WorkflowKindId {
  switch (record.workflow) {
    case "video_red_cars":
      return "video-red-cars";
    case "youtube_collection":
      return "youtube-collection";
    case "song_analysis":
      return "song-analysis";
    case "subtitle_generation":
      return "subtitle-generation";
    case "youtube_video":
    default:
      return "youtube-video";
  }
}

function placeholderRunRequest(
  kind: WorkflowKindId,
  workDir: string,
): YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest | ImageSimilarityRunRequest {
  const source = { kind: "local_file" as const, path: "" };
  switch (kind) {
    case "video-red-cars":
      return {
        source,
        work_dir: workDir,
        scene_threshold: initialForm.sceneThreshold,
        min_scene_len: initialForm.minSceneLen,
        visual_sample_every: initialForm.visualSampleEvery,
        target_object: initialForm.targetObject,
        vehicle_detector: { command: "", args: [] },
      } as VideoRedCarsRunRequest;
    case "youtube-collection":
      return {
        source: null,
        manifest: null,
        max_items: null,
        metadata_filter: {},
        local_file_filter: {},
        analysis: {},
        work_dir: workDir,
        delete_filtered_downloads: false,
      } as unknown as YoutubeCollectionRunRequest;
    case "song-analysis":
      return {
        source,
        work_dir: workDir,
        catalog: {},
        identification: {},
        transcription: { enabled: true },
        music: {},
      } as SongAnalysisRunRequest;
    case "subtitle-generation":
      return {
        source,
        work_dir: workDir,
        transcription: { enabled: true },
        overwrite: true,
      } as SubtitleGenerationRunRequest;
    case "image-similarity":
      return {
        source: { kind: "pasted_image", name: "query image", data_url: "" },
        data_source_id: "",
        top_k: 3,
        work_dir: workDir,
      };
    case "youtube-video":
    default:
      return {
        source,
        work_dir: workDir,
        scene_threshold: initialForm.sceneThreshold,
        min_scene_len: initialForm.minSceneLen,
        visual_sample_every: initialForm.visualSampleEvery,
        transcription: { enabled: true },
        models: {},
      } as YoutubeRunRequest;
  }
}

function isSavedWorkflowRun(value: unknown): value is SavedWorkflowRun {
  if (!isRecord(value)) {
    return false;
  }
  const backendRunIdValid = value.backendRunId === undefined || typeof value.backendRunId === "string";
  const reportPathValid = value.reportPath === undefined || typeof value.reportPath === "string";
  const messageValid = value.message === undefined || value.message === null || typeof value.message === "string";
  const workflowKindValid = value.workflowKind === undefined || isWorkflowKindId(value.workflowKind);
  const workflowVersionValid = value.workflowVersion === undefined || typeof value.workflowVersion === "number";
  return (
    typeof value.id === "string" &&
    typeof value.workflowId === "string" &&
    typeof value.workflowName === "string" &&
    workflowKindValid &&
    workflowVersionValid &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isRunStatus(value.status) &&
    typeof value.inputSummary === "string" &&
    (isYoutubeRunRequest(value.request) ||
      isVideoRedCarsRunRequest(value.request) ||
      isYoutubeCollectionRunRequest(value.request) ||
      isSongAnalysisRunRequest(value.request) ||
      isSubtitleGenerationRunRequest(value.request) ||
      isImageSimilarityRunRequest(value.request)) &&
    backendRunIdValid &&
    reportPathValid &&
    messageValid
  );
}
