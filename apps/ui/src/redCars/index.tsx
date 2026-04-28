import { useMemo } from "react";

import {
  ObservationList,
  ScenePanel,
  VideoSummaryCards,
} from "../core";
import { useVideoSelectionState } from "../dashboard/video-selection";
import { SourceSummary, AssetSummary } from "../ingest";
import { MediaPreviewPanel } from "../media";
import { CapabilityPanel, ModelObservationGrid } from "../models";
import { Panel, StatCard } from "../shared/primitives";
import { formatNumber } from "../shared/utils";
import type {
  VideoRedCarsReport,
  YoutubeVideoReport,
} from "../types";

export function VideoRedCarsOverviewDashboard({
  report,
  runId,
}: {
  report: VideoRedCarsReport;
  runId?: string | null;
}) {
  const adapted = useAdaptedVideoReport(report);
  const controls = useVideoSelectionState(adapted, null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={adapted}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        activeObservationIndex={controls.activeObservationIndex}
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
      />
      <VideoSummaryCards video={adapted.video} />
      <RedCarSummaryCards report={report} />
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

export function VideoRedCarsScenesDashboard({
  report,
  runId,
}: {
  report: VideoRedCarsReport;
  runId?: string | null;
}) {
  const adapted = useAdaptedVideoReport(report);
  const controls = useVideoSelectionState(adapted, report.video.scenes[0]?.index ?? null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={adapted}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        activeObservationIndex={controls.activeObservationIndex}
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
      />
      <ScenePanel
        scenes={report.video.scenes}
        activeSceneIndex={controls.activeSceneIndex}
        onSelectScene={controls.selectTimelineScene}
      />
      <RedCarSceneMetrics report={report} />
    </>
  );
}

export function VideoRedCarsSignalsDashboard({
  report,
  runId,
}: {
  report: VideoRedCarsReport;
  runId?: string | null;
}) {
  const adapted = useAdaptedVideoReport(report);
  const controls = useVideoSelectionState(adapted, null);
  return (
    <>
      <MediaPreviewPanel
        ref={controls.mediaPreviewRef}
        report={adapted}
        runId={runId}
        activeSceneIndex={controls.activeSceneIndex}
        activeObservationIndex={controls.activeObservationIndex}
        activeTimelineItemId={controls.activeTimelineItemId}
        onSelectTimelineItem={controls.selectTimelineItem}
      />
      <ObservationList
        observations={report.video.observations}
        title={`${targetObjectTitle(report)} Observations`}
        activeObservationIndex={controls.activeObservationIndex}
        onSelectObservation={controls.selectObservation}
      />
      <ModelObservationGrid
        observations={report.video.observations}
        activeObservationIndex={controls.activeObservationIndex}
        onSelectObservation={controls.selectObservation}
      />
    </>
  );
}

function useAdaptedVideoReport(report: VideoRedCarsReport): YoutubeVideoReport {
  return useMemo(
    () => ({
      workflow: report.workflow,
      use_case: report.use_case,
      source: report.source,
      assets: report.assets,
      capabilities: report.capabilities,
      video: {
        ...report.video,
      },
      transcription: {
        status: "skipped",
        text: null,
        segments: [],
        message: "Not part of this workflow",
      },
      audio: {
        status: "skipped",
        frames_processed: 0,
        events: [],
        message: "Not part of this workflow",
      },
      text: {
        status: "skipped",
        segments_processed: 0,
        events: [],
        message: "Not part of this workflow",
      },
      data_buckets: [],
    }),
    [report],
  );
}

function RedCarSummaryCards({ report }: { report: VideoRedCarsReport }) {
  const totalDistinctRedCars = report.video.scenes.reduce((sum, scene) => sum + scene.red_car_count, 0);
  const peakVisibleRedCars = report.video.scenes.reduce(
    (max, scene) => Math.max(max, scene.peak_visible_red_cars),
    0,
  );
  const targetTitle = targetObjectTitle(report);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label={`Distinct ${targetTitle}`} value={formatNumber(totalDistinctRedCars)} tone="rose" />
      <StatCard label="Peak Visible" value={formatNumber(peakVisibleRedCars)} tone="amber" />
      <StatCard label="Samples" value={formatNumber(report.video.observations.length)} tone="sky" />
    </div>
  );
}

function RedCarSceneMetrics({ report }: { report: VideoRedCarsReport }) {
  const targetTitle = targetObjectTitle(report);
  return (
    <Panel
      title="Scene Metrics"
      description={`${formatNumber(report.video.scenes.length)} scenes · target ${targetObjectLabel(report)}`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Scene</th>
              <th className="px-3 py-2 font-medium">{targetTitle}</th>
              <th className="px-3 py-2 font-medium">Peak Visible</th>
              <th className="px-3 py-2 font-medium">Sampled Frames</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {report.video.scenes.map((scene) => (
              <tr key={scene.index}>
                <td className="px-3 py-2 font-medium text-zinc-950">{scene.index}</td>
                <td className="px-3 py-2 text-zinc-700">{formatNumber(scene.red_car_count)}</td>
                <td className="px-3 py-2 text-zinc-700">{formatNumber(scene.peak_visible_red_cars)}</td>
                <td className="px-3 py-2 text-zinc-700">{formatNumber(scene.sampled_frames)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function targetObjectValue(report: VideoRedCarsReport): string {
  return report.target_object?.trim() || "car";
}

function targetObjectLabel(report: VideoRedCarsReport): string {
  return `red ${targetObjectValue(report)}`;
}

function targetObjectTitle(report: VideoRedCarsReport): string {
  return targetObjectLabel(report).replace(/\b\w/g, (value) => value.toUpperCase());
}
