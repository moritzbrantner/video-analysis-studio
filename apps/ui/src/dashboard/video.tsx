import { useRef, useState } from "react";

import { DataBucketOverview } from "../data";
import {
  EventList,
  ObservationList,
  ScenePanel,
  VideoSummaryCards,
} from "../core";
import { SourceSummary, AssetSummary } from "../ingest";
import { CapabilityPanel, ModelObservationGrid } from "../models";
import { MediaPreviewPanel, type MediaPreviewHandle } from "../media";
import { SplitPlanTable } from "../split";
import { TranscriptPanel } from "../workflows";
import type {
  AnalysisEvent,
  AnalysisObservation,
  SceneReport,
  TimelineScene,
  TranscriptSegmentReport,
  YoutubeVideoReport,
} from "../types";
import { sceneIndex, sceneStartSeconds } from "../shared/utils";

export function VideoOverviewDashboard({ report, runId }: { report: YoutubeVideoReport; runId?: string | null }) {
  const controls = useVideoSeekState(report, null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={report}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        onSelectScene={controls.selectScene}
      />
      <VideoSummaryCards video={report.video} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <SourceSummary source={report.source} />
        <AssetSummary assets={report.assets} />
      </div>
      <CapabilityPanel capabilities={report.capabilities} />
      <ScenePanel
        scenes={report.video.scenes}
        activeSceneIndex={controls.activeSceneIndex}
        onSelectScene={controls.selectTimelineScene}
      />
    </>
  );
}

export function VideoScenesDashboard({ report, runId }: { report: YoutubeVideoReport; runId?: string | null }) {
  const controls = useVideoSeekState(report, report.video.scenes[0]?.index ?? null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={report}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        onSelectScene={controls.selectScene}
      />
      <ScenePanel
        scenes={report.video.scenes}
        activeSceneIndex={controls.activeSceneIndex}
        onSelectScene={controls.selectTimelineScene}
      />
      <SplitPlanTable scenes={report.video.scenes} videoName={basename(report.source.local_video)} />
    </>
  );
}

export function VideoSignalsDashboard({ report, runId }: { report: YoutubeVideoReport; runId?: string | null }) {
  const controls = useVideoSeekState(report, null);
  return (
    <>
      <MediaPreviewPanel ref={controls.mediaPreviewRef} report={report} runId={runId} />
      <ObservationList
        observations={report.video.observations}
        title="Video Observations"
        activeObservationIndex={controls.activeObservationIndex}
        onSelectObservation={controls.selectObservation}
      />
      <ModelObservationGrid
        observations={report.video.observations}
        activeObservationIndex={controls.activeObservationIndex}
        onSelectObservation={controls.selectObservation}
      />
      <TranscriptPanel
        transcription={report.transcription}
        activeSegmentIndex={controls.activeTranscriptSegmentIndex}
        onSelectSegment={controls.selectTranscriptSegment}
      />
      <div className="grid gap-4 2xl:grid-cols-2">
        <EventList
          events={report.audio.events}
          title={`Audio Events (${report.audio.status})`}
          activeEventIndex={controls.activeAudioEventIndex}
          onSelectEvent={controls.selectAudioEvent}
        />
        <EventList
          events={report.text.events}
          title={`Text Events (${report.text.status})`}
          activeEventIndex={controls.activeTextEventIndex}
          onSelectEvent={controls.selectTextEvent}
        />
      </div>
    </>
  );
}

export function VideoDataDashboard({ report }: { report: YoutubeVideoReport }) {
  return <DataBucketOverview buckets={report.data_buckets} />;
}

function useVideoSeekState(report: YoutubeVideoReport, initialSceneIndex: number | null) {
  const mediaPreviewRef = useRef<MediaPreviewHandle | null>(null);
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(initialSceneIndex);
  const [activeObservationIndex, setActiveObservationIndex] = useState<number | null>(null);
  const [activeTranscriptSegmentIndex, setActiveTranscriptSegmentIndex] = useState<number | null>(null);
  const [activeAudioEventIndex, setActiveAudioEventIndex] = useState<number | null>(null);
  const [activeTextEventIndex, setActiveTextEventIndex] = useState<number | null>(null);

  function seekTo(seconds?: number | null) {
    mediaPreviewRef.current?.seekTo(seconds);
  }

  function clearSignalSelections() {
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
  }

  function selectScene(scene: SceneReport, index: number) {
    setActiveSceneIndex(scene.index);
    clearSignalSelections();
    seekTo(scene.start_seconds ?? report.video.scenes[index]?.start_seconds);
  }

  function selectTimelineScene(scene: TimelineScene, index: number) {
    setActiveSceneIndex(sceneIndex(scene, index + 1));
    clearSignalSelections();
    seekTo(sceneStartSeconds(scene));
  }

  function selectObservation(observation: AnalysisObservation, index: number) {
    setActiveObservationIndex(index);
    if (observation.scene_index != null) {
      setActiveSceneIndex(observation.scene_index);
    }
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
    seekTo(observation.timestamp_seconds);
  }

  function selectTranscriptSegment(segment: TranscriptSegmentReport) {
    setActiveTranscriptSegmentIndex(segment.index);
    setActiveObservationIndex(null);
    setActiveAudioEventIndex(null);
    setActiveTextEventIndex(null);
    seekTo(segment.start_seconds);
  }

  function selectAudioEvent(event: AnalysisEvent, index: number) {
    setActiveAudioEventIndex(index);
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveTextEventIndex(null);
    seekTo(event.timestamp_seconds);
  }

  function selectTextEvent(event: AnalysisEvent, index: number) {
    setActiveTextEventIndex(index);
    setActiveObservationIndex(null);
    setActiveTranscriptSegmentIndex(null);
    setActiveAudioEventIndex(null);
    seekTo(event.timestamp_seconds);
  }

  return {
    mediaPreviewRef,
    activeSceneIndex,
    activeObservationIndex,
    activeTranscriptSegmentIndex,
    activeAudioEventIndex,
    activeTextEventIndex,
    selectScene,
    selectTimelineScene,
    selectObservation,
    selectTranscriptSegment,
    selectAudioEvent,
    selectTextEvent,
  };
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}
