import { useEffect, useMemo, useState } from "react";

import type { WorkflowTypeSpec } from "../api/client";
import { formatWorkflowTypeSpec, formatWorkflowTypeSpecJson, isWorkflowTypeSpec } from "../workflowTypeSpec";
import { formatWorkflowTypeScriptType, parseWorkflowTypeScriptType } from "../workflowTypeScript";
import { cn } from "../shared/utils";
import {
  parseWorkflowTypeSourceWithDefinitions,
  type TypeDefinition,
} from "../type-library/page";

type WorkflowTypeEditorMode = "typescript" | "json";

export function WorkflowTypeEditor({
  value,
  onChange,
  onSourceChange,
  typeDefinitions = [],
}: {
  value: WorkflowTypeSpec;
  onChange: (value: WorkflowTypeSpec, jsonError: string | null) => void;
  onSourceChange?: (source: string) => void;
  typeDefinitions?: TypeDefinition[];
}) {
  const [mode, setMode] = useState<WorkflowTypeEditorMode>("typescript");
  const [text, setText] = useState(() => formatWorkflowTypeScriptType(value));
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => formatWorkflowTypeSpec(value), [value]);

  useEffect(() => {
    setText(mode === "typescript" ? formatWorkflowTypeScriptType(value) : formatWorkflowTypeSpecJson(value));
    setError(null);
  }, [mode, value]);

  const changeMode = (nextMode: WorkflowTypeEditorMode) => {
    setMode(nextMode);
    setText(nextMode === "typescript" ? formatWorkflowTypeScriptType(value) : formatWorkflowTypeSpecJson(value));
    setError(null);
  };

  const parseText = (nextText: string): WorkflowTypeSpec => {
    if (mode === "typescript") {
      return typeDefinitions.length > 0
        ? parseWorkflowTypeSourceWithDefinitions(nextText, typeDefinitions)
        : parseWorkflowTypeScriptType(nextText);
    }
    const nextValue = JSON.parse(nextText) as unknown;
    if (!isWorkflowTypeSpec(nextValue)) {
      throw new Error("Type JSON does not match WorkflowTypeSpec");
    }
    return nextValue;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-zinc-950">Type Contract</div>
          <div className="mt-1 text-xs text-zinc-600">{summary}</div>
        </div>
        {error ? <div className="text-xs text-rose-700">{error}</div> : null}
      </div>
      <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-1">
        {(["typescript", "json"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium",
              mode === candidate ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-950",
            )}
            onClick={() => changeMode(candidate)}
          >
            {candidate === "typescript" ? "TypeScript" : "JSON"}
          </button>
        ))}
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
          onSourceChange?.(nextText);
          try {
            const nextValue = parseText(nextText);
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
