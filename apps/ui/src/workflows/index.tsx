import type { TranscriptionReport, TranscriptSegmentReport, YoutubeVideoReport } from "../types";
import { VideoSummaryCards, ScenePanel, ObservationList, EventList } from "../core";
import { DataBucketOverview } from "../data";
import { SourceSummary, AssetSummary } from "../ingest";
import { CapabilityPanel, ModelObservationGrid } from "../models";
import { ReportShell } from "../output";
import { SplitPlanTable } from "../split";
import { Panel, EmptyState } from "../shared/primitives";
import { cn, formatNumber, formatSeconds } from "../shared/utils";

export function YoutubeVideoReportView({ report }: { report: YoutubeVideoReport }) {
  return (
    <ReportShell title="Video Analysis" subtitle={report.source.local_video}>
      <VideoSummaryCards video={report.video} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceSummary source={report.source} />
        <AssetSummary assets={report.assets} />
      </div>
      <CapabilityPanel capabilities={report.capabilities} />
      <ScenePanel scenes={report.video.scenes} />
      <div className="grid gap-4 xl:grid-cols-2">
        <ObservationList observations={report.video.observations} title="Video Observations" />
        <ModelObservationGrid observations={report.video.observations} />
      </div>
      <TranscriptPanel transcription={report.transcription} />
      <div className="grid gap-4 xl:grid-cols-2">
        <EventList events={report.audio.events} title={`Audio Events (${report.audio.status})`} />
        <EventList events={report.text.events} title={`Text Events (${report.text.status})`} />
      </div>
      <DataBucketOverview buckets={report.data_buckets} />
      <SplitPlanTable scenes={report.video.scenes} videoName={basename(report.source.local_video)} />
    </ReportShell>
  );
}

export const AnalysisDashboard = YoutubeVideoReportView;

export function TranscriptPanel({
  transcription,
  activeSegmentIndex,
  onSelectSegment,
}: {
  transcription: TranscriptionReport;
  activeSegmentIndex?: number | null;
  onSelectSegment?: (segment: TranscriptSegmentReport) => void;
}) {
  return (
    <Panel
      title={`Transcript (${transcription.status})`}
      description={`${formatNumber(transcription.segments.length)} segments`}
    >
      {transcription.segments.length === 0 ? (
        <EmptyState>{transcription.message ?? "No transcript segments"}</EmptyState>
      ) : (
        <div className="space-y-3">
          {transcription.segments.map((segment) => {
            const active = activeSegmentIndex === segment.index;
            const Component = onSelectSegment ? "button" : "div";
            return (
              <Component
                key={segment.index}
                type={onSelectSegment ? "button" : undefined}
                className={cn(
                  "w-full rounded-lg border border-zinc-200 p-3 text-left",
                  onSelectSegment && "cursor-pointer hover:bg-zinc-50",
                  active && "border-sky-200 bg-sky-50",
                )}
                onClick={() => onSelectSegment?.(segment)}
              >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>#{segment.index}</span>
                <span>
                  {formatSeconds(segment.start_seconds)}-{formatSeconds(segment.end_seconds)}
                </span>
              </div>
              <p className="text-sm leading-6 text-zinc-800">{segment.text}</p>
              </Component>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}
