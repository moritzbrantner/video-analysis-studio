import type {
  RunEvent,
  RunRecord,
  SystemDependencyReport,
  WorkflowClient,
  YoutubeRunRequest,
} from "./client";
import { isYoutubeCollectionReport, isYoutubeVideoReport } from "./client";
import type { StudioReport, YoutubeCollectionManifest } from "../types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

export function createTauriClient(): WorkflowClient {
  return {
    label: "Tauri",
    checkDependencies: async () => invoke<SystemDependencyReport>("check_dependencies"),
    discoverYoutubeCollectionManifest: async (request) =>
      invoke<YoutubeCollectionManifest>("discover_youtube_collection_manifest_command", { request }),
    startYoutubeVideoRun: async (request) =>
      invoke<RunRecord>("start_youtube_video_run", { request }),
    startYoutubeCollectionRun: async (request) =>
      invoke<RunRecord>("start_youtube_collection_run", { request }),
    getRun: async (runId) => invoke<RunRecord>("get_run", { runId }),
    getReport: async (runId) => invoke<StudioReport>("get_report", { runId }),
    getYoutubeVideoReport: async (runId) => {
      const report = await invoke<StudioReport>("get_report", { runId });
      if (!isYoutubeVideoReport(report)) {
        throw new Error("Run report is not a YouTube video report");
      }
      return report;
    },
    getYoutubeCollectionReport: async (runId) => {
      const report = await invoke<StudioReport>("get_report", { runId });
      if (!isYoutubeCollectionReport(report)) {
        throw new Error("Run report is not a YouTube collection report");
      }
      return report;
    },
    cancelRun: async (runId) => invoke<void>("cancel_run", { runId }),
    subscribeRunEvents: async (runId, onEvent) => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<RunEvent>("workflow://run-event", (event) => {
        if (event.payload.run_id === runId) {
          onEvent(event.payload);
        }
      });
    },
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}
