import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { getWorkflowClient } from "../api/client";
import type {
  AnalysisEvent,
  AnalysisObservation,
  MusicSegmentReport,
  SceneReport,
  StudioReport,
  TranscriptSegmentReport,
  YoutubeVideoReport,
} from "../types";
import { Badge, EmptyState, Panel } from "../shared/primitives";
import { cn, formatSeconds } from "../shared/utils";

export interface MediaCandidate {
  path: string;
  label: string;
  kind: "video" | "audio" | "text";
}

export function mediaCandidatesForReport(report: StudioReport): MediaCandidate[] {
  if ("video" in report && "source" in report && "local_video" in report.source) {
    return compactCandidates([
      { path: report.source.local_video, label: "Source video", kind: mediaKindForPath(report.source.local_video) },
      report.assets.audio_wav ? { path: report.assets.audio_wav, label: "Extracted audio", kind: "audio" } : null,
    ]);
  }
  if ("collection" in report && "items" in report) {
    return compactCandidates(
      report.items.flatMap((item) => [
        item.local_video
          ? { path: item.local_video, label: item.title ?? item.item_id, kind: mediaKindForPath(item.local_video) }
          : null,
        ...(item.report ? mediaCandidatesForReport(item.report) : []),
      ]),
    );
  }
  if ("identification" in report && "music" in report) {
    return compactCandidates([
      { path: report.source.local_media, label: "Source media", kind: mediaKindForPath(report.source.local_media) },
      report.assets.transcription_wav ? { path: report.assets.transcription_wav, label: "Lyrics audio", kind: "audio" } : null,
      report.assets.music_analysis_wav ? { path: report.assets.music_analysis_wav, label: "Music audio", kind: "audio" } : null,
    ]);
  }
  if ("subtitle" in report && "transcription" in report) {
    return compactCandidates([
      { path: report.source.local_video, label: "Source video", kind: mediaKindForPath(report.source.local_video) },
      report.assets.audio_wav ? { path: report.assets.audio_wav, label: "Extracted audio", kind: "audio" } : null,
    ]);
  }
  return [];
}

export function isLikelyAudioOnly(path: string): boolean {
  return /\.(aac|aiff?|flac|m4a|mp3|ogg|opus|wav|wma)$/i.test(path);
}

export interface MediaPreviewHandle {
  seekTo(seconds?: number | null): void;
}

export interface MediaPreviewPanelProps {
  report: StudioReport;
  runId?: string | null;
  activeSceneIndex?: number | null;
  activeTimelineItemId?: string | null;
  onSelectTimelineItem?: (item: MediaTimelineItem) => void;
  className?: string;
}

export const MediaPreviewPanel = forwardRef<MediaPreviewHandle, MediaPreviewPanelProps>(function MediaPreviewPanel({
  report,
  runId,
  activeSceneIndex,
  activeTimelineItemId,
  onSelectTimelineItem,
  className,
}, ref) {
  const candidates = useMemo(() => mediaCandidatesForReport(report), [report]);
  const [selectedPath, setSelectedPath] = useState(candidates[0]?.path ?? "");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    setSelectedPath(candidates[0]?.path ?? "");
  }, [candidates]);

  useEffect(() => {
    let canceled = false;
    setError(null);
    setMediaUrl(null);
    if (!selectedPath) {
      return;
    }
    getWorkflowClient()
      .mediaUrl(runId ?? null, selectedPath)
      .then((url) => {
        if (!canceled) {
          setMediaUrl(url);
        }
      })
      .catch((errorValue) => {
        if (!canceled) {
          setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        }
      });
    return () => {
      canceled = true;
    };
  }, [runId, selectedPath]);

  const timeline = timelineItemsForReport(report);
  const selectedCandidate = candidates.find((candidate) => candidate.path === selectedPath) ?? candidates[0] ?? null;

  const seek = useCallback((seconds?: number | null) => {
    if (seconds == null || !Number.isFinite(seconds) || !mediaRef.current) {
      return;
    }
    mediaRef.current.currentTime = Math.max(0, seconds);
    void mediaRef.current.play().catch(() => undefined);
  }, []);

  useImperativeHandle(ref, () => ({ seekTo: seek }), [seek]);

  return (
    <Panel
      title="Media Preview"
      description={selectedCandidate?.path ?? "No safe media URL available"}
      className={className}
      actions={
        candidates.length > 1 ? (
          <select
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800"
            value={selectedPath}
            onChange={(event) => setSelectedPath(event.target.value)}
          >
            {candidates.map((candidate) => (
              <option key={`${candidate.kind}:${candidate.path}`} value={candidate.path}>
                {candidate.label}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {!selectedCandidate ? (
            <EmptyState>No media referenced by this report</EmptyState>
          ) : !mediaUrl ? (
            <EmptyState>{error ?? (runId ? "Resolving media" : "Media playback is unavailable for loaded JSON reports")}</EmptyState>
          ) : selectedCandidate.kind === "audio" ? (
            <audio ref={(node) => { mediaRef.current = node; }} src={mediaUrl} className="w-full" controls preload="metadata" />
          ) : (
            <video
              ref={(node) => { mediaRef.current = node; }}
              src={mediaUrl}
              className="aspect-video w-full rounded-lg bg-black"
              controls
              preload="metadata"
            />
          )}
        </div>
        <MediaTimelineList
          items={timeline}
          activeSceneIndex={activeSceneIndex}
          activeTimelineItemId={activeTimelineItemId}
          onSeek={seek}
          onSelectTimelineItem={onSelectTimelineItem}
        />
      </div>
    </Panel>
  );
});

export function MediaTimelineList({
  items,
  activeSceneIndex,
  activeTimelineItemId,
  onSeek,
  onSelectTimelineItem,
}: {
  items: MediaTimelineItem[];
  activeSceneIndex?: number | null;
  activeTimelineItemId?: string | null;
  onSeek: (seconds?: number | null) => void;
  onSelectTimelineItem?: (item: MediaTimelineItem) => void;
}) {
  if (items.length === 0) {
    return <EmptyState>No timed report entries</EmptyState>;
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-zinc-200">
      {items.map((item) => {
        const active = activeTimelineItemId === item.id;
        const relatedSceneActive = item.kind === "scene" && activeSceneIndex === item.scene.index;
        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              "block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 hover:bg-zinc-50",
              relatedSceneActive && "bg-sky-50",
              active && "bg-zinc-100 ring-1 ring-inset ring-zinc-300",
            )}
            onClick={() => {
              if (onSelectTimelineItem) {
                onSelectTimelineItem(item);
              } else {
                onSeek(item.seconds);
              }
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge tone={toneForTimelineKind(item.kind)}>{item.kind}</Badge>
              <span className="text-xs tabular-nums text-zinc-500">{formatSeconds(item.seconds)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm text-zinc-800">{item.label}</div>
          </button>
        );
      })}
    </div>
  );
}

export type MediaTimelineItem =
  | { id: string; kind: "scene"; seconds: number; label: string; scene: SceneReport; originalIndex: number }
  | { id: string; kind: "transcript"; seconds?: number | null; label: string; segment: TranscriptSegmentReport }
  | { id: string; kind: "observation"; seconds?: number | null; label: string; observation: AnalysisObservation; originalIndex: number }
  | { id: string; kind: "audio-event"; seconds?: number | null; label: string; event: AnalysisEvent; originalIndex: number }
  | { id: string; kind: "text-event"; seconds?: number | null; label: string; event: AnalysisEvent; originalIndex: number }
  | { id: string; kind: "music"; seconds: number; label: string; segment: MusicSegmentReport };

function timelineItemsForReport(report: StudioReport): MediaTimelineItem[] {
  if ("video" in report && "transcription" in report) {
    return [
      ...sceneItems(report.video.scenes),
      ...transcriptItems(report.transcription.segments),
      ...observationItems(report.video.observations),
      ...eventItems(report.audio.events, "audio"),
      ...eventItems(report.text.events, "text"),
    ].sort(compareTimelineItems);
  }
  if ("identification" in report && "music" in report) {
    return [
      ...transcriptItems(report.lyrics.segments),
      ...musicItems(report.music.segments),
    ].sort(compareTimelineItems);
  }
  if ("subtitle" in report && "transcription" in report) {
    return transcriptItems(report.transcription.segments).sort(compareTimelineItems);
  }
  return [];
}

function sceneItems(scenes: SceneReport[]): MediaTimelineItem[] {
  return scenes.map((scene, index) => ({
    id: `scene:${scene.index}`,
    kind: "scene",
    seconds: scene.start_seconds,
    label: `Scene ${scene.index} ${formatSeconds(scene.start_seconds)}-${formatSeconds(scene.end_seconds)}`,
    scene,
    originalIndex: index,
  }));
}

function transcriptItems(segments: TranscriptSegmentReport[]): MediaTimelineItem[] {
  return segments.map((segment) => ({
    id: `transcript:${segment.index}`,
    kind: "transcript",
    seconds: segment.start_seconds,
    label: segment.text,
    segment,
  }));
}

function observationItems(observations: AnalysisObservation[]): MediaTimelineItem[] {
  return observations.map((observation, index) => ({
    id: `observation:${index}`,
    kind: "observation",
    seconds: observation.timestamp_seconds,
    label: observation.label ?? observation.text ?? observation.kind,
    observation,
    originalIndex: index,
  }));
}

function eventItems(events: AnalysisEvent[], prefix: string): MediaTimelineItem[] {
  return events.map((event, index) => ({
    id: `${prefix}:${index}`,
    kind: prefix === "audio" ? "audio-event" : "text-event",
    seconds: event.timestamp_seconds,
    label: `${event.analyzer}: ${event.label}`,
    event,
    originalIndex: index,
  }));
}

function musicItems(segments: MusicSegmentReport[]): MediaTimelineItem[] {
  return segments.map((segment) => ({
    id: `music:${segment.index}`,
    kind: "music",
    seconds: segment.start_seconds,
    label: `${segment.bpm != null ? `${segment.bpm.toFixed(1)} BPM` : "BPM n/a"} ${segment.key ?? ""} ${segment.mode ?? ""}`.trim(),
    segment,
  }));
}

function compareTimelineItems(left: MediaTimelineItem, right: MediaTimelineItem): number {
  return (left.seconds ?? Number.MAX_SAFE_INTEGER) - (right.seconds ?? Number.MAX_SAFE_INTEGER);
}

function compactCandidates(values: Array<MediaCandidate | null>): MediaCandidate[] {
  const seen = new Set<string>();
  return values.filter((value): value is MediaCandidate => {
    if (!value?.path || seen.has(value.path)) {
      return false;
    }
    seen.add(value.path);
    return true;
  });
}

function mediaKindForPath(path: string): "video" | "audio" {
  return isLikelyAudioOnly(path) ? "audio" : "video";
}

function toneForTimelineKind(kind: MediaTimelineItem["kind"]): "neutral" | "sky" | "emerald" | "amber" | "rose" | "violet" {
  switch (kind) {
    case "scene":
      return "sky";
    case "transcript":
      return "emerald";
    case "observation":
      return "violet";
    case "audio-event":
      return "amber";
    case "text-event":
      return "rose";
    case "music":
      return "rose";
  }
}
