import type { AssetReport, SourceReport } from "../types";
import { Badge, Panel } from "../shared/primitives";

export function SourceSummary({ source }: { source: SourceReport }) {
  return (
    <Panel title="Source">
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase text-zinc-500">Input</dt>
          <dd className="mt-1 break-all font-medium text-zinc-950">{source.local_video}</dd>
        </div>
        {source.url && (
          <div>
            <dt className="text-xs uppercase text-zinc-500">URL</dt>
            <dd className="mt-1 break-all text-zinc-700">{source.url}</dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}

export function AssetSummary({ assets }: { assets: AssetReport }) {
  return (
    <Panel title="Assets">
      <div className="space-y-3 text-sm">
        <AssetRow label="Work dir" value={assets.work_dir} />
        <AssetRow label="Report" value={assets.report_path} />
        <AssetRow label="Audio" value={assets.audio_wav ?? "not generated"} muted={!assets.audio_wav} />
      </div>
    </Panel>
  );
}

function AssetRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <Badge tone={muted ? "neutral" : "sky"}>{label}</Badge>
      <span className={muted ? "text-zinc-500" : "break-all text-zinc-700"}>{value}</span>
    </div>
  );
}
