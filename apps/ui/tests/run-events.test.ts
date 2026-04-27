import { describe, expect, test } from "bun:test";

import type { RunEvent } from "../src/api/client";
import { appendRunEvent, normalizeRunEvents } from "../src/runEvents";

function progressEvent(progress: number, timestamp: string): RunEvent {
  return {
    run_id: "run-1",
    status: "running",
    message: "downloading whisper.cpp model `base.en`",
    timestamp,
    node: "transcription",
    phase: "downloading_model",
    progress,
  };
}

describe("run event helpers", () => {
  test("replaces the latest matching progress event instead of appending", () => {
    const initial = progressEvent(0.12, "2026-04-27T10:00:00.000Z");
    const updated = progressEvent(0.38, "2026-04-27T10:00:01.000Z");

    expect(appendRunEvent([initial], updated)).toEqual([updated]);
  });

  test("normalizes repeated progress updates into one continuous entry", () => {
    const first = progressEvent(0.12, "2026-04-27T10:00:00.000Z");
    const second = progressEvent(0.38, "2026-04-27T10:00:01.000Z");
    const complete: RunEvent = {
      run_id: "run-1",
      status: "running",
      message: "loading whisper.cpp model `base.en`",
      timestamp: "2026-04-27T10:00:02.000Z",
      node: "transcription",
      phase: "loading_model",
    };

    expect(normalizeRunEvents([first, second, complete])).toEqual([second, complete]);
  });
});
