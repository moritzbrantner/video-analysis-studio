import { describe, expect, test } from "bun:test";

import {
  dashboardDataKindsForWidgets,
  dashboardWidgetOptionsForReportKind,
  defaultDashboardLayout,
  defaultDashboardLayoutForReportKind,
  sanitizeDashboardLayout,
  type DashboardLayout,
  type DashboardWidgetId,
  type ReportKind,
} from "./ResultPageEditor";

describe("dashboard layout helpers", () => {
  test("song report options include song-compatible widgets", () => {
    expect(optionIds("song-analysis")).toEqual([
      "summary",
      "source-assets",
      "transcript",
      "data-buckets",
      "song-identification",
      "song-music",
      "result-delivery",
      "diagnostics",
    ]);
  });

  test("song report options exclude video-only widgets", () => {
    const ids = optionIds("song-analysis");
    expect(ids).not.toContain("scenes");
    expect(ids).not.toContain("observations");
    expect(ids).not.toContain("audio-events");
    expect(ids).not.toContain("text-events");
    expect(ids).not.toContain("split-plan");
  });

  test("video report options exclude song-only widgets", () => {
    const ids = optionIds("youtube-video");
    expect(ids).toContain("media-preview");
    expect(ids).not.toContain("song-identification");
    expect(ids).not.toContain("song-music");
  });

  test("collection report options exclude generic data buckets", () => {
    expect(optionIds("youtube-collection")).not.toContain("data-buckets");
  });

  test("song default layout contains only song-compatible widgets", () => {
    const available = new Set(optionIds("song-analysis"));
    const layoutIds = widgetIds(defaultDashboardLayoutForReportKind("song-analysis"));
    expect(layoutIds.length).toBeGreaterThan(0);
    expect(layoutIds.every((id) => available.has(id))).toBe(true);
  });

  test("sanitizing video default for song removes video-only widgets and keeps compatible widgets", () => {
    const sanitized = sanitizeDashboardLayout(defaultDashboardLayout, "song-analysis");
    const ids = widgetIds(sanitized);
    expect(ids).toContain("summary");
    expect(ids).toContain("transcript");
    expect(ids).toContain("data-buckets");
    expect(ids).not.toContain("scenes");
    expect(ids).not.toContain("observations");
    expect(ids).not.toContain("audio-events");
  });

  test("sanitizing an incompatible widget returns the song default layout", () => {
    expect(sanitizeDashboardLayout({ type: "widget", id: "scenes" }, "song-analysis")).toEqual(
      defaultDashboardLayoutForReportKind("song-analysis"),
    );
  });

  test("song default layout data kinds include song, transcript, and report outputs", () => {
    expect(dashboardDataKindsForWidgets(defaultDashboardLayoutForReportKind("song-analysis"))).toEqual(
      expect.arrayContaining(["song_match", "music_feature", "transcript_segment", "json_report"]),
    );
  });
});

function optionIds(kind: ReportKind): DashboardWidgetId[] {
  return dashboardWidgetOptionsForReportKind(kind).map((option) => option.id);
}

function widgetIds(layout: DashboardLayout): DashboardWidgetId[] {
  return layout.type === "widget" ? [layout.id] : layout.children.flatMap(widgetIds);
}
