import { Panel, StatCard } from "../shared/primitives";
import { formatSeconds } from "../shared/utils";

export interface MediaMetadata {
  input: string;
  mode?: "Recorded" | "Live" | string;
  width?: number | null;
  height?: number | null;
  frame_rate?: string | null;
  duration_seconds?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
}

export function MediaMetadataPanel({ metadata }: { metadata: MediaMetadata }) {
  return (
    <Panel title="Media Metadata" description={metadata.input}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Mode" value={metadata.mode ?? "n/a"} tone="sky" />
        <StatCard
          label="Video"
          value={metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : "n/a"}
          detail={metadata.frame_rate ?? undefined}
          tone="emerald"
        />
        <StatCard label="Duration" value={formatSeconds(metadata.duration_seconds)} tone="amber" />
        <StatCard
          label="Audio"
          value={metadata.sample_rate ? `${metadata.sample_rate} Hz` : "n/a"}
          detail={metadata.channels ? `${metadata.channels} channels` : undefined}
          tone="violet"
        />
      </div>
    </Panel>
  );
}
