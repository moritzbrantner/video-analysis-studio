import { CapabilityPanel } from "../models";
import { DataBucketOverview } from "../data";
import { MediaPreviewPanel } from "../media";
import { Panel, StatCard } from "../shared/primitives";
import { formatNumber } from "../shared/utils";
import { TranscriptPanel } from "../workflows";
import type { SongAnalysisReport } from "../types";

export function SongDashboard({ report, runId }: { report: SongAnalysisReport; runId?: string | null }) {
  return (
    <>
      <MediaPreviewPanel report={report} runId={runId} />
      <SongSummaryCards report={report} />
      <SongIdentificationPanel report={report} />
      <SongMusicPanel report={report} />
      <CapabilityPanel capabilities={report.capabilities} />
    </>
  );
}

export function SongSignals({ report, runId }: { report: SongAnalysisReport; runId?: string | null }) {
  return (
    <>
      <MediaPreviewPanel report={report} runId={runId} />
      <TranscriptPanel transcription={report.lyrics} />
      <SongMusicPanel report={report} />
    </>
  );
}

export function SongSummaryCards({ report }: { report: SongAnalysisReport }) {
  const top = report.identification.top_match;
  const global = report.music.global;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Identification" value={report.identification.status} detail={top?.title ?? "No match"} tone="sky" />
      <StatCard
        label="BPM"
        value={global?.bpm != null ? global.bpm.toFixed(1) : "n/a"}
        detail={songScoreLabel(global?.bpm_confidence)}
        tone="emerald"
      />
      <StatCard
        label="Key"
        value={global?.key ? `${global.key} ${global.mode ?? ""}`.trim() : "n/a"}
        detail={songScoreLabel(global?.key_confidence)}
        tone="amber"
      />
      <StatCard label="Lyrics" value={report.lyrics.status} detail={`${report.lyrics.segments.length} segments`} tone="violet" />
    </div>
  );
}

export function SongIdentificationPanel({ report }: { report: SongAnalysisReport }) {
  const candidates = report.identification.candidates;
  return (
    <Panel
      title="Song Identification"
      description={`${report.identification.catalog_path} | ${report.identification.query?.chunk_count ?? 0} chunks`}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-zinc-500">{report.identification.message ?? "No candidates"}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Artist</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Segment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {candidates.map((candidate) => (
                <tr key={candidate.track_id}>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">{songScoreLabel(candidate.score)}</td>
                  <td className="px-3 py-2 font-medium text-zinc-950">{candidate.title}</td>
                  <td className="px-3 py-2 text-zinc-700">{candidate.artist ?? "n/a"}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">{songDurationLabel(candidate.duration_seconds)}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">
                    {candidate.matched_segment ? songDurationLabel(candidate.matched_segment.catalog_start_seconds) : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function SongMusicPanel({ report }: { report: SongAnalysisReport }) {
  const segments = report.music.segments;
  return (
    <Panel title="BPM and Key" description={report.music.status}>
      {segments.length === 0 ? (
        <p className="text-sm text-zinc-500">{report.music.message ?? "No segment estimates"}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Window</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">BPM</th>
                <th className="px-3 py-2 font-medium">BPM Conf.</th>
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Key Conf.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {segments.map((segment) => (
                <tr key={segment.index}>
                  <td className="px-3 py-2 font-medium text-zinc-950">{segment.index + 1}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">
                    {songDurationLabel(segment.start_seconds)}-{songDurationLabel(segment.end_seconds)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">{segment.bpm != null ? segment.bpm.toFixed(1) : "n/a"}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">{songScoreLabel(segment.bpm_confidence)}</td>
                  <td className="px-3 py-2 text-zinc-700">{segment.key ? `${segment.key} ${segment.mode ?? ""}`.trim() : "n/a"}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">{songScoreLabel(segment.key_confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function SongSourceAssetPanel({ report }: { report: SongAnalysisReport }) {
  const rows = [
    ["Source URL", report.source.url],
    ["Local media", report.source.local_media],
    ["Work dir", report.assets.work_dir],
    ["Report path", report.assets.report_path],
    ["Transcription WAV", report.assets.transcription_wav],
    ["Music analysis WAV", report.assets.music_analysis_wav],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <Panel title="Source + Assets" description={songBasename(report.source.local_media)}>
      <div className="divide-y divide-zinc-100">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-2 py-3 text-sm sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="font-medium text-zinc-700">{label}</div>
            <div className="break-all text-zinc-950">{value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function SongDiagnosticsPanel({ report }: { report: SongAnalysisReport }) {
  const recordCount = report.data_buckets.reduce((sum, bucket) => sum + bucket.records, 0);
  const rows = [
    ["Identification", report.identification.status, report.identification.message ?? "fingerprint query"],
    ["Candidates", formatNumber(report.identification.candidates.length), report.identification.catalog_path],
    ["Query duration", songDurationLabel(report.identification.query?.duration_seconds), "fingerprint input"],
    ["Query chunks", formatNumber(report.identification.query?.chunk_count ?? 0), "fingerprint chunks"],
    ["Lyrics", report.lyrics.status, `${formatNumber(report.lyrics.segments.length)} segments`],
    ["Music", report.music.status, `${formatNumber(report.music.segments.length)} segments`],
    ["Data buckets", formatNumber(report.data_buckets.length), `${formatNumber(recordCount)} records`],
  ];

  return (
    <Panel title="Diagnostics">
      <div className="divide-y divide-zinc-100">
        {rows.map(([label, value, detail]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 py-3 text-sm">
            <div>
              <div className="font-medium text-zinc-900">{label}</div>
              <div className="mt-0.5 break-all text-xs text-zinc-500">{detail}</div>
            </div>
            <div className="truncate text-right font-semibold tabular-nums text-zinc-950">{value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function songDurationLabel(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.max(0, Math.round(value - minutes * 60));
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function songScoreLabel(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "n/a" : `${Math.round(value * 100)}%`;
}

function songBasename(path?: string | null): string {
  if (!path) {
    return "";
  }
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || last;
}
