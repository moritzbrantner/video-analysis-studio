import { useEffect, useMemo, useState } from "react";

import type { WorkflowTypeSpec } from "../api/client";
import { formatWorkflowTypeSpec, formatWorkflowTypeSpecJson, isWorkflowTypeSpec } from "../workflowTypeSpec";
import { cn } from "../shared/utils";

export function WorkflowTypeEditor({
  value,
  onChange,
}: {
  value: WorkflowTypeSpec;
  onChange: (value: WorkflowTypeSpec, jsonError: string | null) => void;
}) {
  const [text, setText] = useState(() => formatWorkflowTypeSpecJson(value));
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => formatWorkflowTypeSpec(value), [value]);

  useEffect(() => {
    setText(formatWorkflowTypeSpecJson(value));
    setError(null);
  }, [value]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-950">Type Contract</div>
          <div className="mt-1 text-xs text-zinc-600">{summary}</div>
        </div>
        {error ? <div className="text-xs text-rose-700">{error}</div> : null}
      </div>
      <textarea
        className={cn(
          "min-h-[220px] w-full rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2",
          error
            ? "border-rose-300 bg-rose-50 text-rose-950 focus:border-rose-500 focus:ring-rose-500/10"
            : "border-zinc-300 bg-white text-zinc-700 focus:border-zinc-950 focus:ring-zinc-950/10",
        )}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          try {
            const nextValue = JSON.parse(nextText) as unknown;
            if (!isWorkflowTypeSpec(nextValue)) {
              throw new Error("Type JSON does not match WorkflowTypeSpec");
            }
            setError(null);
            onChange(nextValue, null);
          } catch (nextError) {
            const message = nextError instanceof Error ? nextError.message : String(nextError);
            setError(message);
            onChange(value, message);
          }
        }}
      />
    </div>
  );
}
