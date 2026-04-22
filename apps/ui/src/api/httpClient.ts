import type {
  RunEvent,
  RunRecord,
  SystemDependencyReport,
  WorkflowClient,
  YoutubeRunRequest,
} from "./client";
import type { StudioReport, YoutubeCollectionManifest } from "../types";
import { isYoutubeCollectionReport as collectionReport, isYoutubeVideoReport as videoReport } from "./client";

const defaultBaseUrl = "http://127.0.0.1:5179";

export function createHttpClient(baseUrl = import.meta.env.VITE_STUDIO_API_URL ?? defaultBaseUrl): WorkflowClient {
  return {
    label: "HTTP API",
    checkDependencies: () => request<SystemDependencyReport>(baseUrl, "/api/system/dependencies"),
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
    startYoutubeCollectionRun: (payload) =>
      request<RunRecord>(baseUrl, "/api/workflows/youtube-collection/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    getRun: (runId) => request<RunRecord>(baseUrl, `/api/runs/${runId}`),
    getReport: (runId) => request<StudioReport>(baseUrl, `/api/runs/${runId}/report`),
    getYoutubeVideoReport: async (runId) => {
      const report = await request<StudioReport>(baseUrl, `/api/runs/${runId}/report`);
      if (!videoReport(report)) {
        throw new Error("Run report is not a YouTube video report");
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
    cancelRun: (runId) =>
      request<void>(baseUrl, `/api/runs/${runId}/cancel`, {
        method: "POST",
      }),
    subscribeRunEvents: async (runId, onEvent) => {
      const source = new EventSource(`${baseUrl}/api/runs/${runId}/events`);
      source.addEventListener("run-event", (event) => {
        onEvent(JSON.parse((event as MessageEvent).data) as RunEvent);
      });
      return () => source.close();
    },
  };
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
