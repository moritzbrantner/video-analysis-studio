import type {
  StudioReport,
  YoutubeCollectionManifest,
  YoutubeCollectionManifestRequest,
  YoutubeCollectionReport,
  YoutubeCollectionRunRequest,
  YoutubeVideoReport,
} from "../types";
import { createHttpClient } from "./httpClient";
import { createTauriClient, isTauriRuntime } from "./tauriClient";

export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export interface RunRecord {
  run_id: string;
  workflow: "youtube_video" | "youtube_collection";
  status: RunStatus;
  work_dir: string;
  report_path: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  message?: string | null;
}

export interface RunEvent {
  run_id: string;
  status: RunStatus;
  message: string;
  timestamp: string;
}

export interface DependencyStatus {
  name: string;
  required: boolean;
  available: boolean;
  resolved_path?: string | null;
  message?: string | null;
}

export interface SystemDependencyReport {
  dependencies: DependencyStatus[];
}

export interface ExternalCommandConfig {
  command: string;
  args: string[];
}

export interface YoutubeRunRequest {
  source:
    | { kind: "youtube_url"; url: string }
    | { kind: "local_file"; path: string };
  work_dir?: string | null;
  scene_threshold: number;
  min_scene_len: number;
  max_frames?: number | null;
  visual_sample_every: number;
  transcription: {
    enabled: boolean;
    command?: ExternalCommandConfig | null;
  };
  models: {
    object?: ExternalCommandConfig | null;
    ocr?: ExternalCommandConfig | null;
    text?: ExternalCommandConfig | null;
  };
}

export interface WorkflowClient {
  label: string;
  checkDependencies(): Promise<SystemDependencyReport>;
  discoverYoutubeCollectionManifest(request: YoutubeCollectionManifestRequest): Promise<YoutubeCollectionManifest>;
  startYoutubeVideoRun(request: YoutubeRunRequest): Promise<RunRecord>;
  startYoutubeCollectionRun(request: YoutubeCollectionRunRequest): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord>;
  getReport(runId: string): Promise<StudioReport>;
  getYoutubeVideoReport(runId: string): Promise<YoutubeVideoReport>;
  getYoutubeCollectionReport(runId: string): Promise<YoutubeCollectionReport>;
  cancelRun(runId: string): Promise<void>;
  subscribeRunEvents?(runId: string, onEvent: (event: RunEvent) => void): Promise<() => void>;
}

export function getWorkflowClient(): WorkflowClient {
  return isTauriRuntime() ? createTauriClient() : createHttpClient();
}

export function isYoutubeCollectionReport(report: StudioReport): report is YoutubeCollectionReport {
  return report.use_case === "youtube_collection_analysis" && "items" in report && "collection" in report;
}

export function isYoutubeVideoReport(report: StudioReport): report is YoutubeVideoReport {
  return "video" in report && "source" in report && "data_buckets" in report;
}

export async function waitForRunCompletion(
  client: WorkflowClient,
  runId: string,
  onRun: (run: RunRecord) => void,
  onEvent?: (event: RunEvent) => void,
): Promise<RunRecord> {
  const unsubscribe = client.subscribeRunEvents
    ? await client.subscribeRunEvents(runId, (event) => {
        onEvent?.(event);
      })
    : undefined;

  try {
    for (;;) {
      const run = await client.getRun(runId);
      onRun(run);
      if (["succeeded", "failed", "canceled"].includes(run.status)) {
        return run;
      }
      await delay(1000);
    }
  } finally {
    unsubscribe?.();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
