import { describe, expect, test } from "bun:test";

import { isLikelyAudioOnly, mediaCandidatesForReport } from ".";
import type { YoutubeVideoReport } from "../types";

describe("media helpers", () => {
  test("isLikelyAudioOnly detects common audio extensions", () => {
    expect(isLikelyAudioOnly("/tmp/source.wav")).toBe(true);
    expect(isLikelyAudioOnly("/tmp/source.mp4")).toBe(false);
  });

  test("mediaCandidatesForReport returns source video and extracted audio", () => {
    const report: YoutubeVideoReport = {
      workflow: "youtube_video_analysis",
      source: { url: null, local_video: "/tmp/video.mp4" },
      assets: { work_dir: "/tmp", report_path: "/tmp/report.json", audio_wav: "/tmp/audio.wav" },
      capabilities: { completed: [], skipped: [] },
      video: {
        width: 1920,
        height: 1080,
        frame_rate: "30/1",
        duration_seconds: 10,
        frames_processed: 300,
        scenes: [],
        observations: [],
      },
      transcription: { status: "skipped", text: null, segments: [], message: null },
      audio: { status: "skipped", frames_processed: 0, events: [], message: null },
      text: { status: "skipped", segments_processed: 0, events: [], message: null },
      data_buckets: [],
    };

    expect(mediaCandidatesForReport(report)).toEqual([
      { path: "/tmp/video.mp4", label: "Source video", kind: "video" },
      { path: "/tmp/audio.wav", label: "Extracted audio", kind: "audio" },
    ]);
  });
});
