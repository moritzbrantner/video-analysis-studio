import { CollectionDashboard } from "../collection";
import { DataBucketOverview } from "../data";
import { ResultPageEditor, type DashboardLayout, type DashboardWidgetBindingSummary } from "../ResultPageEditor";
import { Panel } from "../shared/primitives";
import {
  isSongAnalysisReport,
  isSubtitleGenerationReport,
  isImageSimilarityReport,
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
import type { ImageSimilarityReport, StudioReport } from "../types";
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
  bindingSummaries?: DashboardWidgetBindingSummary[];
  onLayoutChange: (layout: DashboardLayout) => void;
}

export function ReportDashboard({ report, mode, runId, layout, bindingSummaries = [], onLayoutChange }: ReportDashboardProps) {
  const songReport = isSongAnalysisReport(report) ? report : null;
  const subtitleReport = isSubtitleGenerationReport(report) ? report : null;
  const redCarsReport = isVideoRedCarsReport(report) ? report : null;
  const collectionReport = isYoutubeCollectionReport(report) ? report : null;
  const videoReport = isYoutubeVideoReport(report) ? report : null;
  const imageSimilarityReport = isImageSimilarityReport(report) ? report : null;

  if (!songReport && !subtitleReport && !redCarsReport && !collectionReport && !videoReport && !imageSimilarityReport) {
    return (
      <section className="min-w-0 space-y-4">
        <Panel title="Unsupported report">
          <p className="text-sm text-zinc-500">This report shape is not supported by the dashboard.</p>
        </Panel>
      </section>
    );
  }

  if (mode === "result") {
    if (imageSimilarityReport) {
      return (
        <section className="min-w-0 space-y-4">
          <ImageSimilarityDashboard report={imageSimilarityReport} />
        </section>
      );
    }
    return (
      <section className="min-w-0 space-y-4">
        <ResultPageEditor
          report={report}
          runId={runId}
          layout={layout}
          bindingSummaries={bindingSummaries}
          onLayoutChange={onLayoutChange}
        />
      </section>
    );
  }

  if (imageSimilarityReport) {
    return <ImageSimilarityDashboard report={imageSimilarityReport} />;
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
        {mode === "overview" && <VideoRedCarsOverviewDashboard report={redCarsReport} runId={runId} />}
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

function ImageSimilarityDashboard({ report }: { report: ImageSimilarityReport }) {
  return (
    <section className="min-w-0 space-y-4">
      <Panel
        title="Image Similarity"
        description={`${report.source.candidates} candidates from ${report.source.data_source_name}`}
      >
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
              <img src={report.query.data_url} alt={report.query.name} className="aspect-square w-full object-contain" />
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              {report.query.name} · {report.query.width}x{report.query.height}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {report.matches.map((match) => (
              <article key={`${match.rank}-${match.id}`} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
                  <img src={match.image_url} alt={match.title} className="aspect-square w-full object-contain" />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-zinc-950">{match.title}</h3>
                  <span className="shrink-0 rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white">
                    {(match.score * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">Rank {match.rank}</div>
              </article>
            ))}
          </div>
        </div>
      </Panel>
    </section>
  );
}
