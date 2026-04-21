import type { Cut, DetectionResult } from "../types";
import { EmptyState, Panel, StatCard } from "../shared/primitives";
import { formatNumber, formatScore, formatSeconds, timestampSeconds } from "../shared/utils";

export function DetectionSummary({
  result,
  detector,
}: {
  result: DetectionResult;
  detector?: string;
}) {
  return (
    <Panel title="Detection" description={detector}>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Scenes" value={formatNumber(result.scenes.length)} tone="sky" />
        <StatCard label="Cuts" value={formatNumber(result.cuts?.length ?? 0)} tone="emerald" />
        <StatCard label="Frames" value={formatNumber(result.frames_processed)} tone="amber" />
      </div>
      {result.cuts && result.cuts.length > 0 && (
        <div className="mt-4">
          <CutTable cuts={result.cuts} />
        </div>
      )}
    </Panel>
  );
}

export function CutTable({ cuts }: { cuts: Cut[] }) {
  if (cuts.length === 0) {
    return <EmptyState>No cuts</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Frame</th>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Detector</th>
            <th className="px-3 py-2 font-medium">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {cuts.map((cut, index) => (
            <tr key={`${cut.position.frame_index}-${cut.detector}-${index}`}>
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatNumber(cut.position.frame_index)}
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-700">
                {formatSeconds(timestampSeconds(cut.position.timestamp))}
              </td>
              <td className="px-3 py-2 font-medium text-zinc-950">{cut.detector}</td>
              <td className="px-3 py-2 text-zinc-700">{formatScore(cut.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
