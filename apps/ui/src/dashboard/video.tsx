import { DataBucketOverview } from "../data";
import {
  EventList,
  ObservationList,
  ScenePanel,
  VideoSummaryCards,
} from "../core";
import { SourceSummary, AssetSummary } from "../ingest";
import { CapabilityPanel, ModelObservationGrid } from "../models";
import { MediaPreviewPanel } from "../media";
import { SplitPlanTable } from "../split";
import { TranscriptPanel } from "../workflows";
import type { YoutubeVideoReport } from "../types";
import { useVideoSelectionState } from "./video-selection";

export function VideoOverviewDashboard({ report, runId }: { report: YoutubeVideoReport; runId?: string | null }) {
  const controls = useVideoSeekState(report, null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={report}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
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
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
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
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={report}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
      />
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
  return useVideoSelectionState(report, initialSceneIndex);
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}
