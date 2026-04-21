import { useState, type ReactNode } from "react";

import { Panel } from "../shared/primitives";

export function ReportShell({
  title = "Analysis Results",
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </main>
  );
}

export function JsonReportLoader<T>({
  onLoad,
  label = "Load JSON report",
}: {
  onLoad: (report: T) => void;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel title={label}>
      <input
        className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          file
            .text()
            .then((text) => {
              onLoad(JSON.parse(text) as T);
              setError(null);
            })
            .catch((nextError: unknown) => {
              setError(nextError instanceof Error ? nextError.message : "Invalid JSON report");
            });
        }}
      />
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </Panel>
  );
}
