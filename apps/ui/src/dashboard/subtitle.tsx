import { CapabilityPanel } from "../models";
import { MediaPreviewPanel } from "../media";
import { SourceSummary, AssetSummary } from "../ingest";
import { StatCard } from "../shared/primitives";
import { TranscriptPanel } from "../workflows";
import type { SubtitleGenerationReport } from "../types";

export function SubtitleDashboard({ report, runId }: { report: SubtitleGenerationReport; runId?: string | null }) {
  return (
    <>
      <MediaPreviewPanel report={report} runId={runId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Subtitle" value={report.subtitle.format.toUpperCase()} detail={`${report.subtitle.segments} segments`} tone="sky" />
        <StatCard label="Transcription" value={report.transcription.status} detail={report.transcription.message ?? "Transcript generated"} tone="emerald" />
        <StatCard label="Output" value={basename(report.subtitle.path)} detail={report.subtitle.path} tone="amber" />
        <StatCard label="Source" value={basename(report.source.local_video)} detail={report.source.local_video} tone="violet" />
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <SourceSummary source={report.source} />
        <AssetSummary assets={report.assets} />
      </div>
      <TranscriptPanel transcription={report.transcription} />
      <CapabilityPanel capabilities={report.capabilities} />
    </>
  );
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}
