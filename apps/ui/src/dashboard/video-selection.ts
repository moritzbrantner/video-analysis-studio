import { useEffect, useRef, useState, type RefObject } from "react";

import type { MediaPreviewHandle, MediaTimelineItem } from "../media";
import type {
  AnalysisEvent,
  AnalysisObservation,
  SceneReport,
  TimelineScene,
  TranscriptSegmentReport,
  YoutubeVideoReport,
} from "../types";
import { sceneEndSeconds, sceneIndex, sceneStartSeconds } from "../shared/utils";

export interface VideoSelectionControls {
  mediaPreviewRef: RefObject<MediaPreviewHandle | null>;
  activeSceneIndex: number | null;
  activeObservationIndex: number | null;
  activeTranscriptSegmentIndex: number | null;
  activeAudioEventIndex: number | null;
  activeTextEventIndex: number | null;
  activeTimelineItemId: string | null;
  selectScene: (scene: SceneReport, index: number) => void;
  selectTimelineScene: (scene: TimelineScene, index: number) => void;
  selectObservation: (observation: AnalysisObservation, index: number) => void;
  selectTranscriptSegment: (segment: TranscriptSegmentReport) => void;
  selectAudioEvent: (event: AnalysisEvent, index: number) => void;
  selectTextEvent: (event: AnalysisEvent, index: number) => void;
  selectTimelineItem: (item: MediaTimelineItem) => void;
}

export function useVideoSelectionState(
  report: YoutubeVideoReport | null,
  initialSceneIndex: number | null,
): VideoSelectionControls {
  const mediaPreviewRef = useRef<MediaPreviewHandle | null>(null);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(initialSceneIndex);
  const [activeObservationIndex, setActiveObservationIndex] = useState<number | null>(null);
  const [activeTranscriptSegmentIndex, setActiveTranscriptSegmentIndex] = useState<number | null>(null);
  const [activeAudioEventIndex, setActiveAudioEventIndex] = useState<number | null>(null);
  const [activeTextEventIndex, setActiveTextEventIndex] = useState<number | null>(null);
  const [activeTimelineItemId, setActiveTimelineItemId] = useState<string | null>(
    initialSceneIndex != null ? `scene:${initialSceneIndex}` : null,
  );

  useEffect(() => {
    setActiveSceneIndex(initialSceneIndex);
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
    setActiveTimelineItemId(initialSceneIndex != null ? `scene:${initialSceneIndex}` : null);
  }, [report, initialSceneIndex]);

  function seekTo(seconds?: number | null) {
    mediaPreviewRef.current?.seekTo(seconds);
  }

  function clearSignalSelections() {
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
  }

  function setRelatedScene(seconds?: number | null, preferredSceneIndex?: number | null) {
    if (preferredSceneIndex != null) {
      setActiveSceneIndex(preferredSceneIndex);
      return;
    }
    setActiveSceneIndex(report ? sceneIndexForTimestamp(report.video.scenes, seconds) : null);
  }

  function selectScene(scene: SceneReport, index: number) {
    setActiveSceneIndex(scene.index);
    setActiveTimelineItemId(`scene:${scene.index}`);
    clearSignalSelections();
    seekTo(scene.start_seconds ?? report?.video.scenes[index]?.start_seconds);
  }

  function selectTimelineScene(scene: TimelineScene, index: number) {
    const nextSceneIndex = sceneIndex(scene, index + 1);
    setActiveSceneIndex(nextSceneIndex);
    setActiveTimelineItemId(`scene:${nextSceneIndex}`);
    clearSignalSelections();
    seekTo(sceneStartSeconds(scene));
  }

  function selectObservation(observation: AnalysisObservation, index: number) {
    setActiveObservationIndex(index);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
    setActiveTimelineItemId(`observation:${index}`);
    setRelatedScene(observation.timestamp_seconds, observation.scene_index);
    seekTo(observation.timestamp_seconds);
  }

  function selectTranscriptSegment(segment: TranscriptSegmentReport) {
    setActiveTranscriptSegmentIndex(segment.index);
    setActiveObservationIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
    setActiveTimelineItemId(`transcript:${segment.index}`);
    setRelatedScene(segment.start_seconds);
    seekTo(segment.start_seconds);
  }

  function selectAudioEvent(event: AnalysisEvent, index: number) {
    setActiveAudioEventIndex(index);
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveTextEventIndex(null);
    setActiveTimelineItemId(`audio:${index}`);
    setRelatedScene(event.timestamp_seconds);
    seekTo(event.timestamp_seconds);
  }

  function selectTextEvent(event: AnalysisEvent, index: number) {
    setActiveTextEventIndex(index);
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTimelineItemId(`text:${index}`);
    setRelatedScene(event.timestamp_seconds);
    seekTo(event.timestamp_seconds);
  }

  function selectTimelineItem(item: MediaTimelineItem) {
    switch (item.kind) {
      case "scene":
        selectScene(item.scene, item.originalIndex);
        break;
      case "transcript":
        selectTranscriptSegment(item.segment);
        break;
      case "observation":
        selectObservation(item.observation, item.originalIndex);
        break;
      case "audio-event":
        selectAudioEvent(item.event, item.originalIndex);
        break;
      case "text-event":
        selectTextEvent(item.event, item.originalIndex);
        break;
      case "music":
        setActiveTimelineItemId(item.id);
        seekTo(item.segment.start_seconds);
        break;
    }
  }

  return {
    mediaPreviewRef,
    activeSceneIndex,
    activeObservationIndex,
    activeTranscriptSegmentIndex,
    activeAudioEventIndex,
    activeTextEventIndex,
    activeTimelineItemId,
    selectScene,
    selectTimelineScene,
    selectObservation,
    selectTranscriptSegment,
    selectAudioEvent,
    selectTextEvent,
    selectTimelineItem,
  };
}

function sceneIndexForTimestamp(scenes: SceneReport[], seconds?: number | null): number | null {
  if (seconds == null || !Number.isFinite(seconds)) {
    return null;
  }

  let nearest: number | null = null;
  for (const scene of scenes) {
    if (seconds < scene.start_seconds) {
      break;
    }
    nearest = scene.index;
    if (seconds <= sceneEndSeconds(scene)) {
      return scene.index;
    }
  }

  return nearest;
}
