import type { AnalysisObservation, CapabilityReport } from "../types";
import { Badge, EmptyState, Panel, ScoreMeter } from "../shared/primitives";
import { cn, formatNumber } from "../shared/utils";

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

export function ModelObservationGrid({
  observations,
  activeObservationIndex,
  onSelectObservation,
}: {
  observations: AnalysisObservation[];
  activeObservationIndex?: number | null;
  onSelectObservation?: (observation: AnalysisObservation, originalIndex: number) => void;
}) {
  const modelObservations = observations
    .map((observation, originalIndex) => ({ observation, originalIndex }))
    .filter(({ observation }) => observation.score != null);
  return (
    <Panel title="Model Observations" description={`${formatNumber(modelObservations.length)} scored`}>
      {modelObservations.length === 0 ? (
        <EmptyState>No scored model observations</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {modelObservations.map(({ observation, originalIndex }) => {
            const active = activeObservationIndex === originalIndex;
            const Component = onSelectObservation ? "button" : "div";
            return (
              <Component
                key={`${observation.analyzer}-${observation.label ?? originalIndex}-${originalIndex}`}
                type={onSelectObservation ? "button" : undefined}
                className={cn(
                  "w-full rounded-lg border border-zinc-200 p-3 text-left",
                  onSelectObservation && "cursor-pointer hover:bg-zinc-50",
                  active && "border-sky-200 bg-sky-50",
                )}
                onClick={() => onSelectObservation?.(observation, originalIndex)}
              >
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
              </Component>
            );
          })}
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
