import { expect, type Page, type Route } from "@playwright/test";

const graphSummaryPattern = /(\d+)\s+components\s+\D+\s+(\d+)\s+connections/;
const savedVersionsPattern = /(\d+)\s+saved/;

type WorkflowExampleName =
  | "YouTube Video Quick Review"
  | "YouTube Collection Spot Check"
  | "Song Analysis Quick Match"
  | "Subtitle SRT Starter";

type MockWorkflowKind = "youtube-video" | "youtube-collection" | "song-analysis" | "subtitle-generation";

interface MockRunState {
  record: Record<string, unknown>;
  report: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}

export const exampleWorkflowNames: WorkflowExampleName[] = [
  "YouTube Video Quick Review",
  "YouTube Collection Spot Check",
  "Song Analysis Quick Match",
  "Subtitle SRT Starter",
];

export async function openWorkflowBuilder(page: Page) {
  await page.goto("/workflow");
  await expect(page).toHaveURL(/\/workflow$/);
  await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();
}

export async function openRunPage(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "New Run" }).click();
  await expect(page.getByRole("heading", { name: "New Run" })).toBeVisible();
}

export async function graphCounts(page: Page): Promise<{ components: number; connections: number }> {
  const summary = page.locator("p").filter({ hasText: /\d+\s+components.*\d+\s+connections/ }).first();
  await expect(summary).toBeVisible();
  const text = (await summary.textContent()) ?? "";
  const match = text.match(graphSummaryPattern);
  expect(match, `Could not parse graph counts from: "${text}"`).not.toBeNull();
  return {
    components: Number(match?.[1] ?? "0"),
    connections: Number(match?.[2] ?? "0"),
  };
}

export async function savedVersionCount(page: Page): Promise<number> {
  const badge = page.locator("span").filter({ hasText: /\d+\s+saved/ }).first();
  await expect(badge).toBeVisible();
  const text = (await badge.textContent()) ?? "";
  const match = text.match(savedVersionsPattern);
  expect(match, `Could not parse saved version count from: "${text}"`).not.toBeNull();
  return Number(match?.[1] ?? "0");
}

export async function deselectWorkflowNodes(page: Page) {
  const pane = page.locator(".react-flow__pane").first();
  await pane.click({ position: { x: 16, y: 16 } });
}

export async function addComponentFromLibrary(page: Page, title: string, search = title) {
  await page.getByPlaceholder("Search components").fill(search);
  await page.getByTitle(`Add ${title}`).first().click();
  await expect(page.getByTitle("Delete selected component")).toBeVisible();
}

export async function workflowPickerOptions(page: Page): Promise<string[]> {
  return workflowPicker(page).locator("option").allTextContents();
}

export async function selectRunWorkflow(page: Page, name: WorkflowExampleName) {
  await workflowPicker(page).selectOption({ label: name });
  await expect(page.getByText(name).first()).toBeVisible();
}

export async function chooseFileSource(page: Page) {
  await runInputSection(page).getByRole("button", { name: "File", exact: true }).click();
}

export async function createRun(page: Page) {
  await runInputSection(page).getByRole("button", { name: "Create run", exact: true }).click();
}

export async function waitForSuccessfulRun(page: Page) {
  await expect(page.getByRole("button", { name: "Open result" })).toBeVisible({ timeout: 15_000 });
}

export async function mockWorkflowBackend(page: Page) {
  const runs = new Map<string, MockRunState>();
  let nextRunId = 0;

  await page.route("http://127.0.0.1:5179/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "GET" && path === "/api/system/dependencies") {
      return json(route, {
        dependencies: [{ name: "mock-backend", required: false, available: true, resolved_path: "playwright" }],
      });
    }

    if (request.method() === "GET" && path === "/api/workflow/catalog") {
      return json(route, { version: 1, port_kinds: [], nodes: [], compatibility: [] });
    }

    if (request.method() === "POST" && path === "/api/youtube/collection-manifests") {
      const payload = parseJson(request.postData());
      const sourceUrl = String(payload?.source?.url ?? "https://www.youtube.com/playlist?list=demo");
      return json(route, {
        collection_id: "collection-demo",
        source: { kind: "playlist_url", url: sourceUrl },
        title: "Mock Collection",
        items: [
          {
            item_id: "item-1",
            youtube_id: "demo-1",
            playlist_index: 1,
            title: "Quick review clip",
            source_url: "https://youtu.be/demo-1",
            duration_seconds: 42,
          },
        ],
      });
    }

    const workflowKind = workflowKindForStartPath(path);
    if (request.method() === "POST" && workflowKind) {
      const payload = parseJson(request.postData());
      const runId = `mock-run-${++nextRunId}`;
      const now = new Date().toISOString();
      const workDir = workDirForWorkflow(workflowKind, payload);
      const reportPath = reportPathForWorkflow(workflowKind, workDir);
      const report = buildWorkflowReport(workflowKind, payload, workDir, reportPath);
      const record = {
        run_id: runId,
        workflow: workflowApiName(workflowKind),
        status: "running",
        work_dir: workDir,
        report_path: reportPath,
        created_at: now,
        updated_at: now,
        started_at: now,
        finished_at: null,
        message: `${workflowKind} started`,
      };
      runs.set(runId, {
        record,
        report,
        events: [
          {
            run_id: runId,
            status: "running",
            message: `${workflowKind} started`,
            timestamp: now,
            stdout: `mock runner accepted ${workflowKind}`,
          },
        ],
      });
      return json(route, record);
    }

    const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
    if (request.method() === "GET" && runMatch) {
      const state = runs.get(runMatch[1]);
      if (!state) {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "missing run" }) });
      }
      const now = new Date().toISOString();
      const record = {
        ...state.record,
        status: "succeeded",
        updated_at: now,
        finished_at: now,
        message: "completed",
      };
      state.record = record;
      state.events.push({
        run_id: runMatch[1],
        status: "succeeded",
        message: "completed",
        timestamp: now,
        stdout: "mock runner finished successfully",
      });
      return json(route, record);
    }

    const reportMatch = path.match(/^\/api\/runs\/([^/]+)\/report$/);
    if (request.method() === "GET" && reportMatch) {
      const state = runs.get(reportMatch[1]);
      return state
        ? json(route, state.report)
        : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "missing report" }) });
    }

    const historyMatch = path.match(/^\/api\/runs\/([^/]+)\/events\/history$/);
    if (request.method() === "GET" && historyMatch) {
      const state = runs.get(historyMatch[1]);
      return json(route, state?.events ?? []);
    }

    const eventsMatch = path.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (request.method() === "GET" && eventsMatch) {
      const state = runs.get(eventsMatch[1]);
      const latestEvent = state?.events.at(-1) ?? {
        run_id: eventsMatch[1],
        status: "running",
        message: "started",
        timestamp: new Date().toISOString(),
      };
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: `event: run-event\ndata: ${JSON.stringify(latestEvent)}\n\n`,
      });
    }

    const mediaMatch = path.match(/^\/api\/runs\/([^/]+)\/media$/);
    if (request.method() === "GET" && mediaMatch) {
      return route.fulfill({ status: 204, body: "" });
    }

    const cancelMatch = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (request.method() === "POST" && cancelMatch) {
      runs.delete(cancelMatch[1]);
      return route.fulfill({ status: 204, body: "" });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unhandled route" }) });
  });
}

function workflowPicker(page: Page) {
  return page.getByRole("combobox").first();
}

function runInputSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Run Input" }) }).first();
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function parseJson(body: string | null): Record<string, any> {
  if (!body) {
    return {};
  }
  return JSON.parse(body) as Record<string, any>;
}

function workflowKindForStartPath(path: string): MockWorkflowKind | null {
  if (path === "/api/workflows/youtube-video/runs") {
    return "youtube-video";
  }
  if (path === "/api/workflows/youtube-collection/runs") {
    return "youtube-collection";
  }
  if (path === "/api/workflows/song-analysis/runs") {
    return "song-analysis";
  }
  if (path === "/api/workflows/subtitle-generation/runs") {
    return "subtitle-generation";
  }
  return null;
}

function workflowApiName(kind: MockWorkflowKind) {
  switch (kind) {
    case "youtube-video":
      return "youtube_video";
    case "youtube-collection":
      return "youtube_collection";
    case "song-analysis":
      return "song_analysis";
    case "subtitle-generation":
      return "subtitle_generation";
  }
}

function workDirForWorkflow(kind: MockWorkflowKind, request: Record<string, any>) {
  return typeof request.work_dir === "string" && request.work_dir.trim()
    ? request.work_dir
    : kind === "youtube-collection"
      ? "workflow-output/youtube-collection"
      : kind === "song-analysis"
        ? "workflow-output/song-analysis"
        : kind === "subtitle-generation"
          ? "workflow-output/subtitle-generation"
          : "workflow-output/youtube-video";
}

function reportPathForWorkflow(kind: MockWorkflowKind, workDir: string) {
  switch (kind) {
    case "youtube-collection":
      return `${workDir}/collection-analysis.json`;
    case "song-analysis":
      return `${workDir}/song-analysis.json`;
    case "subtitle-generation":
      return `${workDir}/subtitle-generation.json`;
    case "youtube-video":
      return `${workDir}/analysis.json`;
  }
}

function buildWorkflowReport(
  kind: MockWorkflowKind,
  request: Record<string, any>,
  workDir: string,
  reportPath: string,
): Record<string, unknown> {
  switch (kind) {
    case "youtube-collection":
      return collectionReportFixture(request, workDir, reportPath);
    case "song-analysis":
      return songReportFixture(request, workDir, reportPath);
    case "subtitle-generation":
      return subtitleReportFixture(request, workDir, reportPath);
    case "youtube-video":
      return videoReportFixture(request, workDir, reportPath, "quick-review-video.mp4");
  }
}

function videoReportFixture(
  request: Record<string, any>,
  workDir: string,
  reportPath: string,
  localVideoName: string,
) {
  const source = request.source ?? {};
  const sourceUrl = source.kind === "youtube_url" ? source.url : null;
  const localVideo = source.kind === "local_file" ? source.path : `${workDir}/${localVideoName}`;
  return {
    workflow: "youtube_video_analysis",
    source: {
      url: sourceUrl,
      local_video: localVideo,
    },
    assets: {
      work_dir: workDir,
      report_path: reportPath,
      audio_wav: `${workDir}/audio.wav`,
    },
    capabilities: {
      completed: ["download", "scene-detection", "audio", "transcript"],
      skipped: ["object-model", "ocr-model", "text-model"],
    },
    video: {
      width: 1920,
      height: 1080,
      frame_rate: "30/1",
      duration_seconds: 48.2,
      frames_processed: 1446,
      scenes: [
        {
          index: 1,
          start_frame: 0,
          end_frame: 722,
          start_seconds: 0,
          end_seconds: 24.1,
          observations: [],
        },
        {
          index: 2,
          start_frame: 722,
          end_frame: 1446,
          start_seconds: 24.1,
          end_seconds: 48.2,
          observations: [],
        },
      ],
      observations: [
        {
          timestamp_seconds: 12.4,
          frame_index: 372,
          scene_index: 1,
          analyzer: "mock-object",
          kind: "Object",
          label: "speaker",
          score: 0.94,
          region: { x: 320, y: 120, width: 240, height: 480 },
          attributes: { model: "mock" },
        },
      ],
    },
    transcription: {
      status: "completed",
      text: "Quick review transcript.",
      message: null,
      segments: [
        {
          index: 0,
          start_seconds: 0.5,
          end_seconds: 3.2,
          text: "A compact workflow run for Playwright.",
        },
      ],
    },
    audio: {
      status: "completed",
      frames_processed: 2400,
      message: null,
      events: [{ timestamp_seconds: 2.1, analyzer: "mock-audio", label: "speech", score: 0.8 }],
    },
    text: {
      status: "completed",
      segments_processed: 1,
      message: null,
      events: [{ timestamp_seconds: 0.5, analyzer: "mock-text", label: "intro", score: 0.71 }],
    },
    data_buckets: [],
  };
}

function collectionReportFixture(request: Record<string, any>, workDir: string, reportPath: string) {
  const source = request.source ?? {};
  const sourceUrl = String(source.url ?? "https://www.youtube.com/playlist?list=demo");
  return {
    workflow: "youtube_collection_analysis",
    collection: {
      collection_id: "mock-collection",
      title: "Mock Collection",
      source_url: sourceUrl,
      discovered_items: 1,
      selected_items: 1,
      analyzed_items: 1,
      failed_items: 0,
      filtered_items: 0,
      skipped_items: 0,
      downloaded_items: 1,
      total_duration_seconds: 48.2,
    },
    source: {
      kind: source.kind ?? "playlist_url",
      url: sourceUrl,
      title: "Mock Collection",
    },
    filters: {
      metadata: [],
      local_file: [],
    },
    items: [
      {
        item_id: "item-1",
        youtube_id: "demo-1",
        playlist_index: 1,
        title: "Quick review clip",
        source_url: "https://youtu.be/demo-1",
        local_video: `${workDir}/quick-review-clip.mp4`,
        status: "analyzed",
        report: videoReportFixture(
          { source: { kind: "youtube_url", url: "https://youtu.be/demo-1" } },
          `${workDir}/item-1`,
          `${workDir}/item-1/analysis.json`,
          "collection-item-video.mp4",
        ),
      },
    ],
    assets: {
      work_dir: workDir,
      report_path: reportPath,
      manifest_path: `${workDir}/collection-manifest.json`,
    },
    capabilities: {
      completed: ["collection-discovery", "download", "analysis"],
      skipped: ["text-model"],
    },
  };
}

function songReportFixture(request: Record<string, any>, workDir: string, reportPath: string) {
  const source = request.source ?? {};
  return {
    workflow: "song_analysis",
    source: {
      url: source.kind === "youtube_url" ? source.url : null,
      local_media: source.kind === "local_file" ? source.path : `${workDir}/quick-match.mp3`,
    },
    assets: {
      work_dir: workDir,
      report_path: reportPath,
      transcription_wav: `${workDir}/lyrics.wav`,
      music_analysis_wav: `${workDir}/music.wav`,
    },
    capabilities: {
      completed: ["fingerprint", "lyrics", "music"],
      skipped: [],
    },
    identification: {
      status: "completed",
      query: {
        duration_seconds: 24,
        fingerprint: "mock-fingerprint",
        chunk_count: 4,
      },
      catalog_path: request.catalog?.db_path ?? `${workDir}/catalog.sqlite`,
      top_match: {
        track_id: "track-1",
        title: "Mock Anthem",
        artist: "Playwright",
        album: "Fixtures",
        isrc: null,
        source_uri: null,
        duration_seconds: 204,
        score: 0.97,
        matched_segment: {
          query_start_seconds: 0,
          catalog_start_seconds: 18,
          duration_seconds: 12,
        },
      },
      candidates: [
        {
          track_id: "track-1",
          title: "Mock Anthem",
          artist: "Playwright",
          album: "Fixtures",
          isrc: null,
          source_uri: null,
          duration_seconds: 204,
          score: 0.97,
          matched_segment: {
            query_start_seconds: 0,
            catalog_start_seconds: 18,
            duration_seconds: 12,
          },
        },
      ],
      message: null,
    },
    lyrics: {
      status: "completed",
      text: "Mock anthem lyrics.",
      message: null,
      segments: [
        {
          index: 0,
          start_seconds: 0,
          end_seconds: 5,
          text: "Mock anthem lyrics.",
        },
      ],
    },
    music: {
      status: "completed",
      global: {
        bpm: 124.5,
        bpm_confidence: 0.92,
        key: "D",
        mode: "major",
        key_confidence: 0.88,
      },
      segments: [
        {
          index: 0,
          start_seconds: 0,
          end_seconds: 12,
          bpm: 124.5,
          bpm_confidence: 0.92,
          key: "D",
          mode: "major",
          key_confidence: 0.88,
        },
      ],
      message: null,
    },
    data_buckets: [],
  };
}

function subtitleReportFixture(request: Record<string, any>, workDir: string, reportPath: string) {
  const source = request.source ?? {};
  const localVideo = source.kind === "local_file" ? source.path : `${workDir}/subtitle-source.mp4`;
  return {
    workflow: "subtitle_generation",
    source: {
      url: source.kind === "youtube_url" ? source.url : null,
      local_video: localVideo,
    },
    assets: {
      work_dir: workDir,
      report_path: reportPath,
      audio_wav: `${workDir}/audio.wav`,
      subtitle_path: `${workDir}/subtitle-demo.srt`,
    },
    capabilities: {
      completed: ["transcription", "subtitle-write"],
      skipped: [],
    },
    transcription: {
      status: "completed",
      text: "A subtitle fixture.",
      message: null,
      segments: [
        {
          index: 0,
          start_seconds: 0,
          end_seconds: 2.5,
          text: "A subtitle fixture.",
        },
        {
          index: 1,
          start_seconds: 2.5,
          end_seconds: 5,
          text: "Generated by Playwright.",
        },
      ],
    },
    subtitle: {
      format: "srt",
      path: `${workDir}/subtitle-demo.srt`,
      segments: 2,
      message: null,
    },
  };
}
