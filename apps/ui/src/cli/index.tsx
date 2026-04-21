import { Badge, EmptyState, Panel } from "../shared/primitives";

export interface CliRun {
  command: string;
  args?: string[];
  status?: "pending" | "running" | "succeeded" | "failed" | string;
  exit_code?: number | null;
  output_files?: string[];
  message?: string | null;
}

export function CliRunPanel({ run }: { run: CliRun }) {
  return (
    <Panel
      title="CLI Run"
      description={
        <span className="font-mono text-xs">
          {run.command} {(run.args ?? []).join(" ")}
        </span>
      }
      actions={<Badge tone={toneForStatus(run.status, run.exit_code)}>{labelForStatus(run)}</Badge>}
    >
      <div className="space-y-4">
        {run.message && <p className="text-sm text-zinc-700">{run.message}</p>}
        <div>
          <div className="mb-2 text-xs font-medium uppercase text-zinc-500">Arguments</div>
          {run.args && run.args.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {run.args.map((arg, index) => (
                <code key={`${arg}-${index}`} className="rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-800">
                  {arg}
                </code>
              ))}
            </div>
          ) : (
            <EmptyState>No arguments</EmptyState>
          )}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase text-zinc-500">Output files</div>
          {run.output_files && run.output_files.length > 0 ? (
            <ul className="space-y-2">
              {run.output_files.map((file) => (
                <li key={file} className="break-all rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
                  {file}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No output files</EmptyState>
          )}
        </div>
      </div>
    </Panel>
  );
}

function labelForStatus(run: CliRun): string {
  if (run.exit_code != null) {
    return `exit ${run.exit_code}`;
  }
  return run.status ?? "unknown";
}

function toneForStatus(
  status?: string,
  exitCode?: number | null,
): "neutral" | "sky" | "emerald" | "amber" | "rose" | "violet" {
  if (exitCode === 0 || status === "succeeded") {
    return "emerald";
  }
  if (typeof exitCode === "number" && exitCode !== 0) {
    return "rose";
  }
  if (status === "running") {
    return "sky";
  }
  if (status === "pending") {
    return "amber";
  }
  return "neutral";
}
