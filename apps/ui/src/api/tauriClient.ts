import type {
  RunEvent,
  RunRecord,
  SystemDependencyReport,
  WorkflowClient,
  YoutubeRunRequest,
} from "./client";
import { isSongAnalysisReport, isSubtitleGenerationReport, isYoutubeCollectionReport, isYoutubeVideoReport } from "./client";
import type {
  SongAnalysisRunRequest,
  SongCatalogImportRequest,
  SongCatalogImportResponse,
  StudioReport,
  SubtitleGenerationRunRequest,
  YoutubeCollectionManifest,
} from "../types";

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
    startSongAnalysisRun: async (request: SongAnalysisRunRequest) =>
      invoke<RunRecord>("start_song_analysis_run", { request }),
    startSubtitleGenerationRun: async (request: SubtitleGenerationRunRequest) =>
      invoke<RunRecord>("start_subtitle_generation_run", { request }),
    importSongCatalogItems: async (request: SongCatalogImportRequest) =>
      invoke<SongCatalogImportResponse>("import_song_catalog_items", { request }),
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
    getSongAnalysisReport: async (runId) => {
      const report = await invoke<StudioReport>("get_report", { runId });
      if (!isSongAnalysisReport(report)) {
        throw new Error("Run report is not a song analysis report");
      }
      return report;
    },
    getSubtitleGenerationReport: async (runId) => {
      const report = await invoke<StudioReport>("get_report", { runId });
      if (!isSubtitleGenerationReport(report)) {
        throw new Error("Run report is not a subtitle generation report");
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
