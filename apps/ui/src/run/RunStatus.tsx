import { type RunEvent, type RunStatus } from "../api/client";
import { OutputBlock } from "../shared/controls";
import { classNames } from "../shared/utils";

export function RunEventTimeline({
  events,
  stdout,
  stderr,
}: {
  events: RunEvent[];
  stdout?: string;
  stderr?: string;
}) {
  if (events.length === 0 && !stdout && !stderr) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Event Log</h2>
      </div>
      <div className="space-y-3 p-4">
        {events.length > 0 && (
          <div className="space-y-2">
            {events.map((event, index) => (
              <div key={`${event.run_id}-${event.timestamp}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={classNames("rounded-md px-2 py-0.5 text-xs font-medium", runStatusPillClass(event.status))}>
                    {event.status}
                  </span>
                  {event.node ? (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                      {formatRunNodeLabel(event.node)}
                    </span>
                  ) : null}
                  {event.phase ? (
                    <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {formatRunPhaseLabel(event.phase)}
                    </span>
                  ) : null}
                  {typeof event.progress === "number" ? (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                      {formatRunProgress(event.progress)}
                    </span>
                  ) : null}
                  <span className="text-xs tabular-nums text-zinc-500">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-800">{event.message}</p>
                {event.stderr && <OutputBlock label="stderr" value={event.stderr} tone="rose" />}
                {event.stdout && <OutputBlock label="stdout" value={event.stdout} tone="zinc" />}
              </div>
            ))}
          </div>
        )}
        {stderr && <OutputBlock label="stderr" value={stderr} tone="rose" />}
        {stdout && <OutputBlock label="stdout" value={stdout} tone="zinc" />}
      </div>
    </section>
  );
}

export function RunNodeStatusPanel({ events }: { events: RunEvent[] }) {
  const nodeEvents = events.filter((event) => Boolean(event.node));
  if (nodeEvents.length === 0) {
    return null;
  }

  const byNode = new Map<string, RunEvent>();
  for (const event of nodeEvents) {
    if (event.node) {
      byNode.set(event.node, event);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Nodes</h2>
      </div>
      <div className="space-y-3 p-4">
        {[...byNode.entries()].map(([node, event]) => (
          <div key={`${node}-${event.timestamp}`} className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">{formatRunNodeLabel(node)}</span>
              <span className={classNames("rounded-md px-2 py-0.5 text-xs font-medium", runStatusPillClass(event.status))}>
                {event.status}
              </span>
              {event.phase ? (
                <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                  {formatRunPhaseLabel(event.phase)}
                </span>
              ) : null}
              {typeof event.progress === "number" ? (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {formatRunProgress(event.progress)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-zinc-700">{event.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function runStatusPillClass(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-50 text-emerald-800";
    case "failed":
      return "bg-rose-50 text-rose-800";
    case "canceled":
      return "bg-amber-50 text-amber-800";
    case "running":
      return "bg-sky-50 text-sky-800";
    case "pending":
      return "bg-zinc-100 text-zinc-700";
  }
}

function formatRunNodeLabel(node: string): string {
  return node
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatRunPhaseLabel(phase: NonNullable<RunEvent["phase"]>): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "downloading_model":
      return "Downloading Model";
    case "loading_model":
      return "Loading Model";
    case "transcribing":
      return "Transcribing";
  }
}

function formatRunProgress(progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.round(clamped * 100)}%`;
}

export function runStatusClass(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600";
    case "failed":
    case "canceled":
      return "text-rose-600";
    case "running":
      return "text-sky-600";
    case "pending":
      return "text-amber-600";
  }
}
