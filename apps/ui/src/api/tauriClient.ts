import type {
  RunEvent,
  RunRecord,
  SystemDependencyReport,
  WorkflowClient,
  YoutubeRunRequest,
} from "./client";
import type { YoutubeVideoReport } from "../types";

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
    startYoutubeVideoRun: async (request) =>
      invoke<RunRecord>("start_youtube_video_run", { request }),
    getRun: async (runId) => invoke<RunRecord>("get_run", { runId }),
    getReport: async (runId) => invoke<YoutubeVideoReport>("get_report", { runId }),
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
