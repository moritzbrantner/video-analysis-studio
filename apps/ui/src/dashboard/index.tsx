import { CollectionDashboard } from "../collection";
import { DataBucketOverview } from "../data";
import { ResultPageEditor, type DashboardLayout } from "../ResultPageEditor";
import { Panel } from "../shared/primitives";
import {
  isSongAnalysisReport,
  isSubtitleGenerationReport,
  isVideoRedCarsReport,
  isYoutubeCollectionReport,
  isYoutubeVideoReport,
} from "../api/client";
import {
  VideoRedCarsOverviewDashboard,
  VideoRedCarsScenesDashboard,
  VideoRedCarsSignalsDashboard,
} from "../redCars";
import { SongDashboard, SongMusicPanel, SongSignals } from "../song";
import type { StudioReport } from "../types";
import { SubtitleDashboard } from "./subtitle";
import {
  VideoDataDashboard,
  VideoOverviewDashboard,
  VideoScenesDashboard,
  VideoSignalsDashboard,
} from "./video";

export type ReportDashboardMode = "overview" | "result" | "scenes" | "signals" | "data";

export interface ReportDashboardProps {
  report: StudioReport;
  mode: ReportDashboardMode;
  runId?: string | null;
  layout: DashboardLayout;
  onLayoutChange: (layout: DashboardLayout) => void;
}

export function ReportDashboard({ report, mode, runId, layout, onLayoutChange }: ReportDashboardProps) {
  const songReport = isSongAnalysisReport(report) ? report : null;
  const subtitleReport = isSubtitleGenerationReport(report) ? report : null;
  const redCarsReport = isVideoRedCarsReport(report) ? report : null;
  const collectionReport = isYoutubeCollectionReport(report) ? report : null;
  const videoReport = isYoutubeVideoReport(report) ? report : null;

  if (!songReport && !subtitleReport && !redCarsReport && !collectionReport && !videoReport) {
    return (
      <section className="min-w-0 space-y-4">
        <Panel title="Unsupported report">
          <p className="text-sm text-zinc-500">This report shape is not supported by the dashboard.</p>
        </Panel>
      </section>
    );
  }

  if (mode === "result" && !redCarsReport) {
    return (
      <section className="min-w-0 space-y-4">
        <ResultPageEditor report={report} runId={runId} layout={layout} onLayoutChange={onLayoutChange} />
      </section>
    );
  }

  if (songReport) {
    return (
      <section className="min-w-0 space-y-4">
        {mode === "overview" && <SongDashboard report={songReport} runId={runId} />}
        {mode === "scenes" && <SongMusicPanel report={songReport} />}
        {mode === "signals" && <SongSignals report={songReport} runId={runId} />}
        {mode === "data" && <DataBucketOverview buckets={songReport.data_buckets} />}
      </section>
    );
  }

  if (subtitleReport) {
    return (
      <section className="min-w-0 space-y-4">
        <SubtitleDashboard report={subtitleReport} runId={runId} />
      </section>
    );
  }

  if (redCarsReport) {
    return (
      <section className="min-w-0 space-y-4">
        {(mode === "overview" || mode === "result") && <VideoRedCarsOverviewDashboard report={redCarsReport} runId={runId} />}
        {mode === "scenes" && <VideoRedCarsScenesDashboard report={redCarsReport} runId={runId} />}
        {mode === "signals" && <VideoRedCarsSignalsDashboard report={redCarsReport} runId={runId} />}
      </section>
    );
  }

  if (collectionReport) {
    return (
      <section className="min-w-0 space-y-4">
        <CollectionDashboard report={collectionReport} runId={runId} />
      </section>
    );
  }

  if (videoReport) {
    return (
      <section className="min-w-0 space-y-4">
        {mode === "overview" && <VideoOverviewDashboard report={videoReport} runId={runId} />}
        {mode === "scenes" && <VideoScenesDashboard report={videoReport} runId={runId} />}
        {mode === "signals" && <VideoSignalsDashboard report={videoReport} runId={runId} />}
        {mode === "data" && <VideoDataDashboard report={videoReport} />}
      </section>
    );
  }

  return null;
}
