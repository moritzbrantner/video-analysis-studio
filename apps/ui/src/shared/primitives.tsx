import type { ReactNode } from "react";

import { cn } from "./utils";

export type Tone = "neutral" | "sky" | "emerald" | "amber" | "rose" | "violet";

const toneClasses: Record<Tone, string> = {
  neutral: "border-zinc-200 bg-white text-zinc-700",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
};

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-zinc-200 bg-white shadow-sm", className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>}
            {description && <p className="mt-1 text-sm text-zinc-600">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={cn("rounded-lg border p-3", toneClasses[tone])}>
      <div className="text-xs font-medium uppercase tracking-normal opacity-75">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-950">{value}</div>
      {detail && <div className="mt-1 text-xs opacity-75">{detail}</div>}
    </div>
  );
}

export function EmptyState({ children = "No results" }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
      {children}
    </div>
  );
}

export function ScoreMeter({ value }: { value?: number | null }) {
  const normalized = value == null ? 0 : value <= 1 ? value * 100 : Math.min(value, 100);
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${normalized}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-zinc-600">
        {value == null ? "n/a" : value <= 1 ? `${Math.round(value * 100)}%` : value.toFixed(1)}
      </span>
    </div>
  );
}
