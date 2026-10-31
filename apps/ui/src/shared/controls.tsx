import type React from "react";
import { classNames } from "./utils";

export function OutputBlock({ label, value, tone }: { label: string; value: string; tone: "rose" | "zinc" }) {
  return (
    <div>
      <div className={classNames("mb-2 text-xs font-medium uppercase", tone === "rose" ? "text-rose-600" : "text-zinc-500")}>
        {label}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
        {value}
      </pre>
    </div>
  );
}

export function Field({
  label,
  action,
  children,
}: {
  label: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <span className="block min-w-0 break-words text-xs font-medium uppercase text-zinc-500">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-grid w-full grid-flow-col rounded-lg border border-zinc-200 bg-zinc-100 p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={classNames(
            "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
            optionValue === value
              ? "bg-white text-zinc-950 shadow-sm"
              : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950",
          )}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2">
      <div className="text-[11px] uppercase text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-950">{value}</div>
    </div>
  );
}
