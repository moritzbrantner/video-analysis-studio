import type { DataBucketReport, StreamBucketReport } from "../types";
import { EmptyState, Panel, StatCard } from "../shared/primitives";
import { formatBytes, formatNumber, ratioPercent } from "../shared/utils";

export function DataBucketOverview({ buckets }: { buckets: DataBucketReport[] }) {
  const totalRecords = buckets.reduce((sum, bucket) => sum + bucket.records, 0);
  const totalBytes = buckets.reduce((sum, bucket) => sum + bucket.estimated_bytes, 0);
  const maxRecords = Math.max(...buckets.map((bucket) => bucket.records), 0);

  return (
    <Panel title="Data Buckets" description={`${formatNumber(buckets.length)} summaries`}>
      {buckets.length === 0 ? (
        <EmptyState>No data buckets</EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Buckets" value={formatNumber(buckets.length)} tone="sky" />
            <StatCard label="Records" value={formatNumber(totalRecords)} tone="emerald" />
            <StatCard label="Estimated bytes" value={formatBytes(totalBytes)} tone="amber" />
          </div>
          <div className="space-y-2">
            {buckets.map((bucket) => (
              <div key={bucket.bucket_index} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-zinc-950">Bucket {bucket.bucket_index}</div>
                  <div className="text-sm text-zinc-500">
                    {formatNumber(bucket.records)} records, {formatBytes(bucket.estimated_bytes)}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${ratioPercent(bucket.records, maxRecords)}%` }}
                  />
                </div>
                <div className="mt-3">
                  <StreamSummaryTable streams={bucket.streams} compact />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function StreamSummaryTable({
  streams,
  compact = false,
}: {
  streams: StreamBucketReport[];
  compact?: boolean;
}) {
  if (streams.length === 0) {
    return <EmptyState>No streams</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Stream</th>
            <th className="px-3 py-2 font-medium">Records</th>
            <th className="px-3 py-2 font-medium">Bytes</th>
            {!compact && <th className="px-3 py-2 font-medium">Payloads</th>}
            <th className="px-3 py-2 font-medium">Video</th>
            <th className="px-3 py-2 font-medium">Audio</th>
            <th className="px-3 py-2 font-medium">Text</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {streams.map((stream) => (
            <tr key={stream.stream_id}>
              <td className="px-3 py-2 font-medium text-zinc-950">{stream.stream_id}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-700">{formatNumber(stream.records)}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatBytes(stream.estimated_bytes)}
              </td>
              {!compact && (
                <td className="px-3 py-2 text-zinc-700">{payloadSummary(stream.payload_counts)}</td>
              )}
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatNumber(stream.video_frames)}
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatNumber(stream.audio_frames)}
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatNumber(stream.text_segments)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function payloadSummary(payloads: Record<string, number>): string {
  const entries = Object.entries(payloads);
  if (entries.length === 0) {
    return "n/a";
  }
  return entries.map(([key, value]) => `${key}: ${formatNumber(value)}`).join(", ");
}
