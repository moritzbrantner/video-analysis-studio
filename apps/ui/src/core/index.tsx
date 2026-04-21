import type {
  AnalysisEvent,
  AnalysisObservation,
  SceneReport,
  TimelineScene,
  VideoReport,
} from "../types";
import { Badge, EmptyState, Panel, ScoreMeter, StatCard } from "../shared/primitives";
import {
  cn,
  formatNumber,
  formatScore,
  formatSeconds,
  sceneEndFrame,
  sceneEndSeconds,
  sceneIndex,
  sceneStartFrame,
  sceneStartSeconds,
} from "../shared/utils";

export function VideoSummaryCards({ video }: { video: VideoReport }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Resolution" value={`${video.width}x${video.height}`} detail={video.frame_rate} tone="sky" />
      <StatCard label="Duration" value={formatSeconds(video.duration_seconds)} tone="emerald" />
      <StatCard label="Frames" value={formatNumber(video.frames_processed)} tone="amber" />
      <StatCard label="Scenes" value={formatNumber(video.scenes.length)} tone="violet" />
    </div>
  );
}

export function SceneTimeline({
  scenes,
  durationSeconds,
  activeSceneIndex,
  onSelectScene,
  className,
}: {
  scenes: TimelineScene[];
  durationSeconds?: number | null;
  activeSceneIndex?: number | null;
  onSelectScene?: (scene: TimelineScene, index: number) => void;
  className?: string;
}) {
  if (scenes.length === 0) {
    return <EmptyState>No scenes detected</EmptyState>;
  }

  const computedDuration =
    durationSeconds ?? Math.max(...scenes.map((scene) => sceneEndSeconds(scene)), 0);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex h-16 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
        {scenes.map((scene, index) => {
          const start = sceneStartSeconds(scene);
          const end = sceneEndSeconds(scene);
          const width = Math.max(end - start, computedDuration / 200, 0.01);
          const selected = activeSceneIndex === sceneIndex(scene, index + 1);
          const Component = onSelectScene ? "button" : "div";
          return (
            <Component
              key={`${sceneStartFrame(scene)}-${sceneEndFrame(scene)}-${index}`}
              className={cn(
                "group relative min-w-4 border-r border-white/70 bg-sky-500 text-left outline-none transition-colors last:border-r-0 hover:bg-sky-600 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2",
                index % 2 === 1 && "bg-emerald-500 hover:bg-emerald-600",
                selected && "bg-zinc-950 hover:bg-zinc-900",
              )}
              style={{ flexGrow: width, flexBasis: 0 }}
              title={`Scene ${sceneIndex(scene, index + 1)} ${formatSeconds(start)}-${formatSeconds(end)}`}
              onClick={() => onSelectScene?.(scene, index)}
            >
              <span className="absolute inset-x-1 bottom-1 truncate text-[11px] font-medium text-white">
                {sceneIndex(scene, index + 1)}
              </span>
            </Component>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{formatSeconds(0)}</span>
        <span>{formatSeconds(computedDuration)}</span>
      </div>
    </div>
  );
}

export function SceneTable({
  scenes,
  onSelectScene,
}: {
  scenes: TimelineScene[];
  onSelectScene?: (scene: TimelineScene, index: number) => void;
}) {
  if (scenes.length === 0) {
    return <EmptyState>No scene rows</EmptyState>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Scene</th>
            <th className="px-3 py-2 font-medium">Start</th>
            <th className="px-3 py-2 font-medium">End</th>
            <th className="px-3 py-2 font-medium">Frames</th>
            <th className="px-3 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {scenes.map((scene, index) => {
            const start = sceneStartSeconds(scene);
            const end = sceneEndSeconds(scene);
            return (
              <tr
                key={`${sceneStartFrame(scene)}-${sceneEndFrame(scene)}-${index}`}
                className={cn(onSelectScene && "cursor-pointer hover:bg-zinc-50")}
                onClick={() => onSelectScene?.(scene, index)}
              >
                <td className="px-3 py-2 font-medium text-zinc-950">
                  {sceneIndex(scene, index + 1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-700">{formatSeconds(start)}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-700">{formatSeconds(end)}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-700">
                  {formatNumber(sceneStartFrame(scene))}-{formatNumber(sceneEndFrame(scene))}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-700">
                  {formatSeconds(end - start)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ObservationList({
  observations,
  title = "Observations",
}: {
  observations: AnalysisObservation[];
  title?: string;
}) {
  return (
    <Panel title={title} description={`${formatNumber(observations.length)} results`}>
      {observations.length === 0 ? (
        <EmptyState>No observations</EmptyState>
      ) : (
        <div className="space-y-3">
          {observations.map((observation, index) => (
            <div
              key={`${observation.analyzer}-${observation.kind}-${observation.frame_index ?? index}-${index}`}
              className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneForKind(observation.kind)}>{observation.kind}</Badge>
                  <span className="text-sm font-medium text-zinc-950">
                    {observation.label ?? observation.text ?? "Unlabeled"}
                  </span>
                  <span className="text-xs text-zinc-500">{observation.analyzer}</span>
                </div>
                {observation.text && observation.text !== observation.label && (
                  <p className="mt-2 line-clamp-3 text-sm text-zinc-700">{observation.text}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span>{formatSeconds(observation.timestamp_seconds)}</span>
                  {observation.frame_index != null && <span>frame {formatNumber(observation.frame_index)}</span>}
                  {observation.scene_index != null && <span>scene {formatNumber(observation.scene_index)}</span>}
                  {observation.region && (
                    <span>
                      box {observation.region.x},{observation.region.y} {observation.region.width}x{observation.region.height}
                    </span>
                  )}
                </div>
              </div>
              <ScoreMeter value={observation.score} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function EventList({
  events,
  title = "Events",
  empty = "No events",
}: {
  events: AnalysisEvent[];
  title?: string;
  empty?: string;
}) {
  return (
    <Panel title={title} description={`${formatNumber(events.length)} results`}>
      {events.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Analyzer</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {events.map((event, index) => (
                <tr key={`${event.analyzer}-${event.label}-${event.timestamp_seconds ?? index}-${index}`}>
                  <td className="px-3 py-2 tabular-nums text-zinc-700">
                    {formatSeconds(event.timestamp_seconds)}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">{event.analyzer}</td>
                  <td className="px-3 py-2 font-medium text-zinc-950">{event.label}</td>
                  <td className="px-3 py-2 text-zinc-700">{formatScore(event.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function ScenePanel({ scenes }: { scenes: SceneReport[] | TimelineScene[] }) {
  return (
    <Panel title="Scenes" description={`${formatNumber(scenes.length)} detected`}>
      <SceneTimeline scenes={scenes} />
      <div className="mt-4">
        <SceneTable scenes={scenes} />
      </div>
    </Panel>
  );
}

function toneForKind(kind: string): "neutral" | "sky" | "emerald" | "amber" | "rose" | "violet" {
  const normalized = kind.toLowerCase();
  if (normalized.includes("object")) return "sky";
  if (normalized.includes("text")) return "emerald";
  if (normalized.includes("face")) return "amber";
  if (normalized.includes("scene")) return "violet";
  return "neutral";
}
