import type {
  DataSourceRecord,
  RunEvent,
  RunListParams,
  RunRecord,
  SystemDependencyReport,
  TranscriptionCatalog,
  WorkflowCatalog,
  WorkflowClient,
  YoutubeRunRequest,
} from "./client";
import type {
  SongAnalysisRunRequest,
  SongCatalogImportRequest,
  SongCatalogImportResponse,
  StudioReport,
  SubtitleGenerationReport,
  SubtitleGenerationRunRequest,
  VideoRedCarsReport,
  YoutubeCollectionManifest,
} from "../types";
import {
  isVideoRedCarsReport as redCarsReport,
  isSubtitleGenerationReport as subtitleReport,
  isSongAnalysisReport as songReport,
  isYoutubeCollectionReport as collectionReport,
  isYoutubeVideoReport as videoReport,
} from "./client";

const defaultBaseUrl = typeof __STUDIO_API_URL__ === "string" ? __STUDIO_API_URL__ : "";
const defaultApiToken = typeof __STUDIO_API_TOKEN__ === "string" ? __STUDIO_API_TOKEN__ : "";

export function createHttpClient(baseUrl = import.meta.env.VITE_STUDIO_API_URL ?? defaultBaseUrl): WorkflowClient {
  return {
    label: "HTTP API",
    checkDependencies: () => request<SystemDependencyReport>(baseUrl, "/api/system/dependencies"),
    getTranscriptionCatalog: () => request<TranscriptionCatalog>(baseUrl, "/api/transcription/catalog"),
    getWorkflowCatalog: () => request<WorkflowCatalog>(baseUrl, "/api/workflow/catalog"),
    listDataSources: () => request<DataSourceRecord[]>(baseUrl, "/api/data-sources"),
    createDataSource: (payload) =>
      request<DataSourceRecord>(baseUrl, "/api/data-sources", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    updateDataSource: (id, payload) =>
      request<DataSourceRecord>(baseUrl, `/api/data-sources/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    deleteDataSource: (id) =>
      request<void>(baseUrl, `/api/data-sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    createDataSourceDerivation: (parentId, payload) =>
      request<DataSourceRecord>(baseUrl, `/api/data-sources/${encodeURIComponent(parentId)}/derivations`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    discoverYoutubeCollectionManifest: (payload) =>
      request<YoutubeCollectionManifest>(baseUrl, "/api/youtube/collection-manifests", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    startYoutubeVideoRun: (payload) =>
      request<RunRecord>(baseUrl, "/api/workflows/youtube-video/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    startVideoRedCarsRun: (payload) =>
      request<RunRecord>(baseUrl, "/api/workflows/video-red-cars/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    startYoutubeCollectionRun: (payload) =>
      request<RunRecord>(baseUrl, "/api/workflows/youtube-collection/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    startSongAnalysisRun: (payload: SongAnalysisRunRequest) =>
      request<RunRecord>(baseUrl, "/api/workflows/song-analysis/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    startSubtitleGenerationRun: (payload: SubtitleGenerationRunRequest) =>
      request<RunRecord>(baseUrl, "/api/workflows/subtitle-generation/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    importSongCatalogItems: (payload: SongCatalogImportRequest) =>
      request<SongCatalogImportResponse>(baseUrl, "/api/song-catalog/imports", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    listRuns: (params) => request<RunRecord[]>(baseUrl, `/api/runs${runListQuery(params)}`),
    getRun: (runId) => request<RunRecord>(baseUrl, `/api/runs/${runId}`),
    getRunEvents: (runId) => request<RunEvent[]>(baseUrl, `/api/runs/${runId}/events/history`),
    getReport: (runId) => request<StudioReport>(baseUrl, `/api/runs/${runId}/report`),
    getYoutubeVideoReport: async (runId) => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!videoReport(report)) {
        throw new Error("Run report is not a YouTube video report");
      }
      return report;
    },
    getVideoRedCarsReport: async (runId): Promise<VideoRedCarsReport> => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!redCarsReport(report)) {
        throw new Error("Run report is not a red car report");
      }
      return report;
    },
    getYoutubeCollectionReport: async (runId) => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!collectionReport(report)) {
        throw new Error("Run report is not a YouTube collection report");
      }
      return report;
    },
    getSongAnalysisReport: async (runId) => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!songReport(report)) {
        throw new Error("Run report is not a song analysis report");
      }
      return report;
    },
    getSubtitleGenerationReport: async (runId): Promise<SubtitleGenerationReport> => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!subtitleReport(report)) {
        throw new Error("Run report is not a subtitle generation report");
      }
      return report;
    },
    cancelRun: (runId) =>
      request<void>(baseUrl, `/api/runs/${runId}/cancel`, {
        method: "POST",
      }),
    mediaUrl: async (runId, path) => {
      if (!runId || !path.trim()) {
        return null;
      }
      return `${baseUrl}/api/runs/${runId}/media?path=${encodeURIComponent(path)}`;
    },
    dataSourceMediaUrl: async (path) => {
      if (!path.trim()) {
        return null;
      }
      return `${baseUrl}/api/data-source-media?path=${encodeURIComponent(path)}`;
    },
    subscribeRunEvents: async (runId, onEvent) => {
      const source = new EventSource(`${baseUrl}/api/runs/${runId}/events`);
      source.addEventListener("run-event", (event) => {
        onEvent(JSON.parse((event as MessageEvent).data) as RunEvent);
      });
      return () => source.close();
    },
  };
}

function runListQuery(params: RunListParams | undefined): string {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params?.workflow) {
    query.set("workflow", params.workflow);
  }
  if (params?.status) {
    query.set("status", params.status);
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const method = init.method?.toUpperCase() ?? "GET";
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...apiTokenHeader(method),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw normalizeRequestError(baseUrl, error);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function apiTokenHeader(method: string): Record<string, string> {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || !defaultApiToken) {
    return {};
  }
  return { "X-Studio-Api-Token": defaultApiToken };
}

function normalizeRequestError(baseUrl: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TypeError) {
    return new Error(
      `Could not reach the Studio API at ${baseUrl}. Check config/runtime.json, start it with \`bun run api:dev\`, or set \`VITE_STUDIO_API_URL\`.`,
    );
  }
  return new Error(message);
}
