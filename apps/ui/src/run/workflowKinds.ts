import {
  type VideoRedCarsRunRequest,
  type YoutubeCollectionRunRequest,
  type SongAnalysisRunRequest,
  type SubtitleGenerationRunRequest,
} from "../index";
import { type YoutubeRunRequest } from "../api/client";
import {
  isImageSimilarityRunRequest,
  isSongAnalysisRunRequest,
  isSubtitleGenerationRunRequest,
  isVideoRedCarsRunRequest,
  isYoutubeCollectionRunRequest,
} from "./runGuards";
import type { ImageSimilarityRunRequest, WorkflowKindId } from "./types";

export const workflowKinds: Array<{
  id: WorkflowKindId;
  name: string;
  defaultWorkflowName: string;
  packageName: string;
  status: string;
}> = [
  {
    id: "youtube-video",
    name: "YouTube Video",
    defaultWorkflowName: "YouTube Video Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "video-red-cars",
    name: "Video Red Cars",
    defaultWorkflowName: "Video Red Cars Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "youtube-collection",
    name: "YouTube Collection",
    defaultWorkflowName: "YouTube Collection Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "song-analysis",
    name: "Song Analysis",
    defaultWorkflowName: "Song Analysis Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "subtitle-generation",
    name: "Subtitle Generation",
    defaultWorkflowName: "Subtitle Generation Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "image-similarity",
    name: "Image Similarity",
    defaultWorkflowName: "Image Similarity Workflow",
    packageName: "@video-analysis-studio/ui",
    status: "Ready",
  },
];

function currentWorkflowKind(id: WorkflowKindId) {
  return workflowKinds.find((workflowKind) => workflowKind.id === id) ?? workflowKinds[0];
}

export function workflowKindName(id: WorkflowKindId): string {
  return currentWorkflowKind(id).name;
}

export function workflowKindId(value: unknown): WorkflowKindId | null {
  return isWorkflowKindId(value) ? value : null;
}

export function isWorkflowKindId(value: unknown): value is WorkflowKindId {
  return typeof value === "string" && workflowKinds.some((workflowKind) => workflowKind.id === value);
}

export function inferWorkflowKindFromName(name: string): WorkflowKindId {
  const normalized = name.toLowerCase();
  if (normalized.includes("collection") || normalized.includes("playlist") || normalized.includes("channel")) {
    return "youtube-collection";
  }
  if (normalized.includes("song") || normalized.includes("music")) {
    return "song-analysis";
  }
  if (normalized.includes("red car")) {
    return "video-red-cars";
  }
  if (normalized.includes("subtitle") || normalized.includes("srt")) {
    return "subtitle-generation";
  }
  if (normalized.includes("image") || normalized.includes("similar")) {
    return "image-similarity";
  }
  return "youtube-video";
}

export function workflowKindFromRunRequest(
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest | ImageSimilarityRunRequest,
): WorkflowKindId {
  if (isYoutubeCollectionRunRequest(request)) {
    return "youtube-collection";
  }
  if (isVideoRedCarsRunRequest(request)) {
    return "video-red-cars";
  }
  if (isSubtitleGenerationRunRequest(request)) {
    return "subtitle-generation";
  }
  if (isSongAnalysisRunRequest(request)) {
    return "song-analysis";
  }
  if (isImageSimilarityRunRequest(request)) {
    return "image-similarity";
  }
  return "youtube-video";
}

export function defaultWorkDirForWorkflowKind(id: WorkflowKindId): string {
  switch (id) {
    case "video-red-cars":
      return "workflow-output/video-red-cars";
    case "youtube-collection":
      return "workflow-output/youtube-collection";
    case "song-analysis":
      return "workflow-output/song-analysis";
    case "subtitle-generation":
      return "workflow-output/subtitle-generation";
    case "image-similarity":
      return "workflow-output/image-similarity";
    case "youtube-video":
      return "workflow-output/youtube-video";
  }
}

export function defaultOutputForWorkflowKind(id: WorkflowKindId): string {
  switch (id) {
    case "video-red-cars":
      return "workflow-output/video-red-cars/video-red-cars.json";
    case "youtube-collection":
      return "workflow-output/youtube-collection/collection-analysis.json";
    case "song-analysis":
      return "workflow-output/song-analysis/song-analysis.json";
    case "subtitle-generation":
      return "workflow-output/subtitle-generation/subtitle-generation.json";
    case "image-similarity":
      return "workflow-output/image-similarity/image-similarity.json";
    case "youtube-video":
      return "workflow-output/youtube-video/analysis.json";
  }
}
