import type { AnalysisObservation, CapabilityReport } from "../types";
import { Badge, EmptyState, Panel, ScoreMeter } from "../shared/primitives";
import { formatNumber } from "../shared/utils";

export function CapabilityPanel({ capabilities }: { capabilities: CapabilityReport }) {
  return (
    <Panel title="Capabilities">
      <div className="grid gap-4 sm:grid-cols-2">
        <CapabilityList title="Completed" items={capabilities.completed} tone="emerald" />
        <CapabilityList title="Skipped" items={capabilities.skipped} tone="amber" />
      </div>
    </Panel>
  );
}

export function ModelObservationGrid({ observations }: { observations: AnalysisObservation[] }) {
  const modelObservations = observations.filter((observation) => observation.score != null);
  return (
    <Panel title="Model Observations" description={`${formatNumber(modelObservations.length)} scored`}>
      {modelObservations.length === 0 ? (
        <EmptyState>No scored model observations</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {modelObservations.map((observation, index) => (
            <div key={`${observation.analyzer}-${observation.label ?? index}-${index}`} className="rounded-lg border border-zinc-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-950">
                    {observation.label ?? observation.text ?? observation.kind}
                  </div>
                  <div className="mt-1 text-sm text-zinc-500">{observation.analyzer}</div>
                </div>
                <Badge tone="violet">{observation.kind}</Badge>
              </div>
              <div className="mt-3">
                <ScoreMeter value={observation.score} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CapabilityList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "emerald" | "amber";
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase text-zinc-500">{title}</div>
      {items.length === 0 ? (
        <EmptyState>None</EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <Badge key={item} tone={tone}>
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
