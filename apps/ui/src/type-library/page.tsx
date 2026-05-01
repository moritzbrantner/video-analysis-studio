import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { WorkflowTypeSpec } from "../api/client";
import { Badge, EmptyState, Panel, StatCard } from "../shared/primitives";
import { cn } from "../shared/utils";
import {
  formatWorkflowTypeSpec,
  formatWorkflowTypeSpecJson,
  workflowTypeSignature,
} from "../workflowTypeSpec";
import { formatWorkflowTypeScriptType, parseWorkflowTypeScriptType } from "../workflowTypeScript";

export const typeLibraryStorageKey = "video-analysis.typeLibrary.v1";

export interface StoredTypeDefinition {
  id: string;
  name: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface TypeDefinition extends StoredTypeDefinition {
  spec: WorkflowTypeSpec;
}

interface TypeUsage {
  workflowId: string;
  workflowName: string;
  nodeId: string;
  nodeTitle: string;
  direction: "input" | "output";
  portId: string;
  portLabel: string;
}

interface TypeLibraryWorkflowPort {
  id: string;
  label: string;
  valueType: WorkflowTypeSpec;
}

interface TypeLibraryWorkflowNode {
  id: string;
  data: {
    title: string;
    inputs: TypeLibraryWorkflowPort[];
    outputs: TypeLibraryWorkflowPort[];
  };
}

interface TypeLibraryWorkflow {
  id: string;
  name: string;
  nodes: TypeLibraryWorkflowNode[];
}

export interface TypeLibraryWorkflowLibrary {
  workflows: TypeLibraryWorkflow[];
}

interface TypeLibraryPageProps {
  workflowLibrary: TypeLibraryWorkflowLibrary;
  definitions: TypeDefinition[];
  onDefinitionsChange: Dispatch<SetStateAction<TypeDefinition[]>>;
}

const primitiveSnippets = [
  { label: "String", value: "string" },
  { label: "Number", value: "number" },
  { label: "Boolean", value: "boolean" },
  { label: "Array", value: "string[]" },
  { label: "Object", value: "{\n  id: string;\n}" },
  { label: "Binary", value: 'WorkflowBinary<"video/*", "video_file">' },
];

export function TypeLibraryPage({ workflowLibrary, definitions, onDefinitionsChange }: TypeLibraryPageProps) {
  const [activeId, setActiveId] = useState<string | null>(() => definitions[0]?.id ?? null);
  const [draftName, setDraftName] = useState(() => definitions[0]?.name ?? nextTypeName(definitions));
  const [draftSource, setDraftSource] = useState(() => definitions[0]?.source ?? "{\n  id: string;\n}");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeDefinition = useMemo(
    () => definitions.find((definition) => definition.id === activeId) ?? null,
    [activeId, definitions],
  );

  const definitionNames = useMemo(() => definitions.map((definition) => definition.name), [definitions]);
  const usageIndex = useMemo(() => collectDefinitionUsage(definitions), [definitions]);
  const workflowUsageIndex = useMemo(
    () => collectWorkflowUsage(definitions, workflowLibrary),
    [definitions, workflowLibrary],
  );

  const filteredDefinitions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return definitions;
    }
    return definitions.filter((definition) => {
      const uses = usageIndex.uses.get(definition.name) ?? [];
      const usedBy = usageIndex.usedBy.get(definition.name) ?? [];
      return [definition.name, formatWorkflowTypeSpec(definition.spec), ...uses, ...usedBy]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [definitions, query, usageIndex]);

  const draftValidation = useMemo(() => {
    const name = draftName.trim();
    const nameError = validateTypeName(name);
    if (nameError) {
      return { spec: null, error: nameError };
    }
    const duplicate = definitions.find((definition) => definition.name === name && definition.id !== activeId);
    if (duplicate) {
      return { spec: null, error: `Type "${name}" already exists.` };
    }
    try {
      const peers = definitions.filter((definition) => definition.id !== activeId);
      return {
        spec: parseNamedTypeDefinition(peers, name, draftSource),
        error: null,
      };
    } catch (error) {
      return { spec: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [activeId, definitions, draftName, draftSource]);

  const openDefinition = (definition: TypeDefinition) => {
    setActiveId(definition.id);
    setDraftName(definition.name);
    setDraftSource(definition.source);
    setMessage(null);
  };

  const startNewDefinition = () => {
    setActiveId(null);
    setDraftName(nextTypeName(definitions));
    setDraftSource("{\n  id: string;\n}");
    setMessage(null);
  };

  const saveDefinition = () => {
    const name = draftName.trim();
    if (!draftValidation.spec) {
      setMessage(draftValidation.error ?? "Type definition is invalid.");
      return;
    }
    const now = new Date().toISOString();
    if (activeDefinition) {
      const nextDefinition: TypeDefinition = {
        ...activeDefinition,
        name,
        source: draftSource.trim(),
        spec: draftValidation.spec,
        updatedAt: now,
      };
      onDefinitionsChange((current) =>
        current.map((definition) => (definition.id === activeDefinition.id ? nextDefinition : definition)),
      );
      setActiveId(nextDefinition.id);
      setMessage(`Saved ${name}.`);
      return;
    }
    const nextDefinition: TypeDefinition = {
      id: nextDefinitionId(),
      name,
      source: draftSource.trim(),
      spec: draftValidation.spec,
      createdAt: now,
      updatedAt: now,
    };
    onDefinitionsChange((current) => [...current, nextDefinition]);
    setActiveId(nextDefinition.id);
    setMessage(`Created ${name}.`);
  };

  const deleteDefinition = () => {
    if (!activeDefinition) {
      return;
    }
    const blockers = usageIndex.usedBy.get(activeDefinition.name) ?? [];
    if (blockers.length > 0) {
      setMessage(`Remove references from ${blockers.join(", ")} before deleting ${activeDefinition.name}.`);
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`Delete type "${activeDefinition.name}"?`)) {
      return;
    }
    const remaining = definitions.filter((definition) => definition.id !== activeDefinition.id);
    onDefinitionsChange(remaining);
    const nextActive = remaining[0] ?? null;
    if (nextActive) {
      openDefinition(nextActive);
    } else {
      setActiveId(null);
      setDraftName(nextTypeName(remaining));
      setDraftSource("{\n  id: string;\n}");
      setMessage(`Deleted ${activeDefinition.name}.`);
    }
  };

  const insertSnippet = (snippet: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraftSource(snippet);
      return;
    }
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextSource = `${draftSource.slice(0, selectionStart)}${snippet}${draftSource.slice(selectionEnd)}`;
    setDraftSource(nextSource);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart + snippet.length, selectionStart + snippet.length);
    });
  };

  const activeUses = activeDefinition ? usageIndex.uses.get(activeDefinition.name) ?? [] : [];
  const activeUsedBy = activeDefinition ? usageIndex.usedBy.get(activeDefinition.name) ?? [] : [];
  const activeWorkflowUsages = activeDefinition ? workflowUsageIndex.get(activeDefinition.name) ?? [] : [];
  const unusedCount = definitions.filter(
    (definition) =>
      (usageIndex.usedBy.get(definition.name)?.length ?? 0) === 0 &&
      (workflowUsageIndex.get(definition.name)?.length ?? 0) === 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Defined" value={definitions.length} detail="Custom contracts" tone="neutral" />
        <StatCard
          label="Referenced"
          value={definitions.length - unusedCount}
          detail="Used by another type or workflow port"
          tone="emerald"
        />
        <StatCard label="Unused" value={unusedCount} detail="No inbound usage found" tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Panel
          title="Defined Types"
          description="Reusable contracts available to later type definitions."
          actions={
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={startNewDefinition}
            >
              New
            </button>
          }
        >
          <div className="space-y-3">
            <input
              className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              placeholder="Search types"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="space-y-2">
              {filteredDefinitions.length === 0 ? (
                <EmptyState>No types defined</EmptyState>
              ) : (
                filteredDefinitions.map((definition) => {
                  const usedBy = usageIndex.usedBy.get(definition.name) ?? [];
                  const workflowUsages = workflowUsageIndex.get(definition.name) ?? [];
                  return (
                    <button
                      key={definition.id}
                      type="button"
                      className={cn(
                        "w-full rounded-lg border px-3 py-3 text-left transition",
                        activeId === definition.id
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                      )}
                      onClick={() => openDefinition(definition)}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{definition.name}</span>
                          <span className={cn("mt-1 block truncate text-xs", activeId === definition.id ? "text-zinc-300" : "text-zinc-500")}>
                            {formatWorkflowTypeSpec(definition.spec)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                            activeId === definition.id
                              ? "border-white/20 text-white"
                              : usedBy.length + workflowUsages.length > 0
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : "border-amber-200 bg-amber-50 text-amber-800",
                          )}
                        >
                          {usedBy.length + workflowUsages.length}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Panel>

        <section className="space-y-4">
          <Panel
            title={activeDefinition ? `Edit ${activeDefinition.name}` : "Create Type"}
            description="Define the type with TypeScript syntax, primitive snippets, and names from previously saved types."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {activeDefinition && (
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-800 hover:bg-rose-100"
                    onClick={deleteDefinition}
                  >
                    Delete
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!draftValidation.spec}
                  onClick={saveDefinition}
                >
                  Save
                </button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
                <label className="space-y-1">
                  <span className="text-xs font-medium text-zinc-700">Name</span>
                  <input
                    className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    spellCheck={false}
                  />
                </label>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700">Primitives</div>
                  <div className="flex flex-wrap gap-2">
                    {primitiveSnippets.map((snippet) => (
                      <button
                        key={snippet.label}
                        type="button"
                        className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-700 hover:bg-zinc-50"
                        onClick={() => insertSnippet(snippet.value)}
                      >
                        {snippet.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {definitionNames.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-zinc-700">Defined Types</div>
                  <div className="flex flex-wrap gap-2">
                    {definitionNames
                      .filter((name) => name !== activeDefinition?.name)
                      .map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-2 font-mono text-xs text-zinc-700 hover:bg-zinc-50"
                          onClick={() => insertSnippet(name)}
                        >
                          {name}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <textarea
                ref={textareaRef}
                className={cn(
                  "min-h-[260px] w-full rounded-lg border px-3 py-2 font-mono text-xs leading-5 outline-none focus:ring-2",
                  draftValidation.error
                    ? "border-rose-300 bg-rose-50 text-rose-950 focus:border-rose-500 focus:ring-rose-500/10"
                    : "border-zinc-300 bg-white text-zinc-700 focus:border-zinc-950 focus:ring-zinc-950/10",
                )}
                value={draftSource}
                onChange={(event) => setDraftSource(event.target.value)}
                spellCheck={false}
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  {draftValidation.spec ? (
                    <span className="font-medium text-zinc-900">{formatWorkflowTypeSpec(draftValidation.spec)}</span>
                  ) : (
                    <span className="text-rose-700">{draftValidation.error}</span>
                  )}
                </div>
                {message && <div className="text-xs text-zinc-500">{message}</div>}
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Usage" description={activeDefinition ? activeDefinition.name : "No active type"}>
              {activeDefinition ? (
                <div className="space-y-4">
                  <UsageGroup label="Uses" values={activeUses} empty="No custom type references" />
                  <UsageGroup label="Used By" values={activeUsedBy} empty="No other type references this type" />
                  <div>
                    <div className="text-xs font-semibold uppercase text-zinc-500">Workflow Ports</div>
                    <div className="mt-2 space-y-2">
                      {activeWorkflowUsages.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                          No exact workflow port matches
                        </div>
                      ) : (
                        activeWorkflowUsages.map((usage) => (
                          <div key={`${usage.workflowId}:${usage.nodeId}:${usage.direction}:${usage.portId}`} className="rounded-lg border border-zinc-200 px-3 py-2">
                            <div className="text-sm font-medium text-zinc-900">{usage.workflowName}</div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {usage.nodeTitle} / {usage.direction} / {usage.portLabel}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState>Select or create a type</EmptyState>
              )}
            </Panel>

            <Panel title="Resolved Shape" description="Canonical workflow type contract.">
              {draftValidation.spec ? (
                <div className="space-y-3">
                  <pre className="max-h-[280px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-700">
                    {formatWorkflowTypeSpecJson(draftValidation.spec)}
                  </pre>
                  <pre className="max-h-[220px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-700">
                    {formatWorkflowTypeScriptType(draftValidation.spec)}
                  </pre>
                </div>
              ) : (
                <EmptyState>Fix the type definition to preview the resolved shape</EmptyState>
              )}
            </Panel>
          </div>
        </section>
      </div>
    </div>
  );
}

function UsageGroup({ label, values, empty }: { label: string; values: string[]; empty: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.length === 0 ? (
          <span className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            {empty}
          </span>
        ) : (
          values.map((value) => (
            <Badge key={value} tone="neutral" className="font-mono">
              {value}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

export function loadTypeDefinitions(): TypeDefinition[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(typeLibraryStorageKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { definitions?: StoredTypeDefinition[] };
    const storedDefinitions = Array.isArray(parsed.definitions) ? parsed.definitions.filter(isStoredTypeDefinition) : [];
    return hydrateTypeDefinitions(storedDefinitions);
  } catch {
    return [];
  }
}

function hydrateTypeDefinitions(storedDefinitions: StoredTypeDefinition[]): TypeDefinition[] {
  const allSource = storedDefinitions
    .map((definition) => sourceForDefinition(definition.name, definition.source))
    .join("\n\n");
  const hydrated: TypeDefinition[] = [];
  for (const definition of storedDefinitions) {
    try {
      hydrated.push({
        ...definition,
        spec: parseWorkflowTypeScriptType(allSource, definition.name),
      });
    } catch {
      hydrated.push({
        ...definition,
        spec: { type: "any" },
      });
    }
  }
  return hydrated;
}

export function persistTypeDefinitions(definitions: TypeDefinition[]) {
  if (typeof window === "undefined") {
    return;
  }
  const storedDefinitions: StoredTypeDefinition[] = definitions.map(({ id, name, source, createdAt, updatedAt }) => ({
    id,
    name,
    source,
    createdAt,
    updatedAt,
  }));
  window.localStorage.setItem(
    typeLibraryStorageKey,
    JSON.stringify({ format: "video-analysis.type-library", version: 1, definitions: storedDefinitions }),
  );
}

function isStoredTypeDefinition(value: unknown): value is StoredTypeDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.source === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function combinedDefinitionSource(peers: TypeDefinition[], name: string, source: string): string {
  return [...peers.map((definition) => sourceForDefinition(definition.name, definition.source)), sourceForDefinition(name, source)].join(
    "\n\n",
  );
}

export function parseNamedTypeDefinition(definitions: TypeDefinition[], name: string, source: string): WorkflowTypeSpec {
  return parseWorkflowTypeScriptType(combinedDefinitionSource(definitions, name, source), name);
}

export function parseWorkflowTypeSourceWithDefinitions(source: string, definitions: TypeDefinition[]): WorkflowTypeSpec {
  const localName = declaredTypeName(source) ?? "__DataSourceType";
  const localSource = sourceForDefinition(localName, source);
  return parseWorkflowTypeScriptType(
    [...definitions.map((definition) => sourceForDefinition(definition.name, definition.source)), localSource].join(
      "\n\n",
    ),
    localName,
  );
}

export function createTypeDefinitionFromSource(
  definitions: TypeDefinition[],
  name: string,
  source: string,
): TypeDefinition {
  const trimmedName = name.trim();
  const nameError = validateTypeName(trimmedName);
  if (nameError) {
    throw new Error(nameError);
  }
  if (definitions.some((definition) => definition.name === trimmedName)) {
    throw new Error(`Type "${trimmedName}" already exists.`);
  }
  const spec = parseNamedTypeDefinition(definitions, trimmedName, source);
  const now = new Date().toISOString();
  return {
    id: nextDefinitionId(),
    name: trimmedName,
    source: source.trim(),
    spec,
    createdAt: now,
    updatedAt: now,
  };
}

export function nextAvailableTypeName(definitions: TypeDefinition[], base = "DataSourceType"): string {
  const existing = new Set(definitions.map((definition) => definition.name));
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base}${Date.now()}`;
}

function sourceForDefinition(name: string, source: string): string {
  const trimmed = source.trim() || "unknown";
  if (/^(export\s+)?(type|interface)\s/.test(trimmed)) {
    return trimmed;
  }
  return `type ${name} = ${trimmed};`;
}

function declaredTypeName(source: string): string | null {
  const match = /^(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/.exec(source.trim());
  return match?.[1] ?? null;
}

function validateTypeName(value: string): string | null {
  if (!value) {
    return "Type name is required.";
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return "Type name must be a valid TypeScript identifier.";
  }
  return null;
}

function nextTypeName(definitions: TypeDefinition[]): string {
  const existing = new Set(definitions.map((definition) => definition.name));
  for (let index = definitions.length + 1; index < definitions.length + 100; index += 1) {
    const candidate = `Type${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `Type${Date.now()}`;
}

function nextDefinitionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `type-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function collectDefinitionUsage(definitions: TypeDefinition[]): {
  uses: Map<string, string[]>;
  usedBy: Map<string, string[]>;
} {
  const names = definitions.map((definition) => definition.name);
  const uses = new Map<string, string[]>();
  const usedBy = new Map<string, string[]>();

  for (const definition of definitions) {
    const references = names.filter((name) => name !== definition.name && sourceReferencesName(definition.source, name));
    uses.set(definition.name, references);
    for (const reference of references) {
      const current = usedBy.get(reference) ?? [];
      usedBy.set(reference, [...current, definition.name]);
    }
  }

  for (const name of names) {
    if (!usedBy.has(name)) {
      usedBy.set(name, []);
    }
  }

  return { uses, usedBy };
}

function sourceReferencesName(source: string, name: string): boolean {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectWorkflowUsage(
  definitions: TypeDefinition[],
  workflowLibrary: TypeLibraryWorkflowLibrary,
): Map<string, TypeUsage[]> {
  const bySignature = new Map<string, string[]>();
  for (const definition of definitions) {
    const signature = workflowTypeSignature(definition.spec);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), definition.name]);
  }

  const usages = new Map<string, TypeUsage[]>();
  for (const workflow of workflowLibrary.workflows) {
    for (const node of workflow.nodes) {
      const ports = [
        ...node.data.inputs.map((port) => ({ port, direction: "input" as const })),
        ...node.data.outputs.map((port) => ({ port, direction: "output" as const })),
      ];
      for (const { port, direction } of ports) {
        const names = bySignature.get(workflowTypeSignature(port.valueType)) ?? [];
        for (const name of names) {
          usages.set(name, [
            ...(usages.get(name) ?? []),
            {
              workflowId: workflow.id,
              workflowName: workflow.name,
              nodeId: node.id,
              nodeTitle: node.data.title,
              direction,
              portId: port.id,
              portLabel: port.label,
            },
          ]);
        }
      }
    }
  }
  return usages;
}
