import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { type TypeDefinition } from "../type-library/page";
import type { WorkflowKindId } from "../run/types";
import { workflowKindName, workflowKinds } from "../run/workflowKinds";
import { Field, Metric } from "../shared/controls";
import {
  CloseIcon,
  ComponentsIcon,
  DownloadIcon,
  PlayIcon,
  SaveIcon,
  UploadIcon,
  WorkflowIcon,
} from "../shared/icons";
import { classNames } from "../shared/utils";
import {
  filterSavedWorkflowBlocks,
  groupSavedWorkflowBlocksByCategory,
  savedWorkflowBlockExposedOutputs,
  savedWorkflowBlockOpenInputs,
  workflowComponentCategoryOrder,
  workflowKindForSavedWorkflowBlock,
} from "./componentCatalog";
import { WorkflowComponentCategoryGroup } from "./ComponentLibrary";
import { normalizeWorkflowTags } from "./componentMetadata";
import {
  downloadSavedWorkflowBlocksJson,
  mergeSavedWorkflowBlocks,
  normalizeSavedWorkflowBlock,
  parseSavedWorkflowBlocksJson,
} from "./savedBlocks";
import type { SavedWorkflowBlock, WorkflowComponentCategory } from "./types";
import { WorkflowTypeDetails } from "./WorkflowDetailsPanel";

export function ComponentsPage({
  savedBlocks,
  typeDefinitions,
  onSavedBlocksChange,
  onEditComponent,
  onTestComponent,
}: {
  savedBlocks: SavedWorkflowBlock[];
  typeDefinitions: TypeDefinition[];
  onSavedBlocksChange: React.Dispatch<React.SetStateAction<SavedWorkflowBlock[]>>;
  onEditComponent: (block: SavedWorkflowBlock) => void;
  onTestComponent: (block: SavedWorkflowBlock) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(savedBlocks[0]?.id ?? null);
  const [nameDraft, setNameDraft] = useState("");
  const [kindDraft, setKindDraft] = useState<WorkflowKindId>("youtube-video");
  const [categoryDraft, setCategoryDraft] = useState<WorkflowComponentCategory>("Reusable");
  const [tagsDraft, setTagsDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredBlocks = useMemo(() => filterSavedWorkflowBlocks(savedBlocks, search), [savedBlocks, search]);
  const groupedBlocks = useMemo(() => groupSavedWorkflowBlocksByCategory(filteredBlocks), [filteredBlocks]);
  const selectedBlock = useMemo(
    () => savedBlocks.find((block) => block.id === selectedBlockId) ?? null,
    [savedBlocks, selectedBlockId],
  );
  const selectedBlockInputs = useMemo(
    () => (selectedBlock ? savedWorkflowBlockOpenInputs(selectedBlock) : []),
    [selectedBlock],
  );
  const selectedBlockOutputs = useMemo(
    () => (selectedBlock ? savedWorkflowBlockExposedOutputs(selectedBlock) : []),
    [selectedBlock],
  );

  useEffect(() => {
    if (!selectedBlockId || !savedBlocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(savedBlocks[0]?.id ?? null);
    }
  }, [savedBlocks, selectedBlockId]);

  useEffect(() => {
    if (!selectedBlock) {
      setNameDraft("");
      setKindDraft("youtube-video");
      setCategoryDraft("Reusable");
      setTagsDraft("");
      return;
    }
    setNameDraft(selectedBlock.name);
    setKindDraft(workflowKindForSavedWorkflowBlock(selectedBlock));
    setCategoryDraft(selectedBlock.category ?? "Reusable");
    setTagsDraft((selectedBlock.tags ?? []).join(", "));
  }, [selectedBlock]);

  const metadataDirty = selectedBlock
    ? nameDraft.trim() !== selectedBlock.name ||
      kindDraft !== workflowKindForSavedWorkflowBlock(selectedBlock) ||
      categoryDraft !== (selectedBlock.category ?? "Reusable") ||
      normalizeWorkflowTags(tagsDraft).join("|") !== (selectedBlock.tags ?? []).join("|")
    : false;

  const saveMetadata = useCallback(() => {
    if (!selectedBlock) {
      return;
    }
    const nextName = nameDraft.trim() || selectedBlock.name;
    onSavedBlocksChange((currentBlocks) =>
      currentBlocks.map((block) =>
        block.id === selectedBlock.id
          ? normalizeSavedWorkflowBlock({
              ...block,
              name: nextName,
              kind: kindDraft,
              category: categoryDraft,
              tags: normalizeWorkflowTags(tagsDraft),
            })
          : block,
      ),
    );
    setMessage(`Updated component "${nextName}"`);
  }, [categoryDraft, kindDraft, nameDraft, onSavedBlocksChange, selectedBlock, tagsDraft]);

  const deleteSelected = useCallback(() => {
    if (!selectedBlock) {
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`Delete component "${selectedBlock.name}"?`)) {
      return;
    }
    onSavedBlocksChange((currentBlocks) => currentBlocks.filter((block) => block.id !== selectedBlock.id));
    setMessage(`Deleted component "${selectedBlock.name}"`);
  }, [onSavedBlocksChange, selectedBlock]);

  const exportAll = useCallback(() => {
    if (savedBlocks.length === 0) {
      return;
    }
    downloadSavedWorkflowBlocksJson(savedBlocks);
    setMessage(`Exported ${savedBlocks.length} component${savedBlocks.length === 1 ? "" : "s"}`);
  }, [savedBlocks]);

  const exportSelected = useCallback(() => {
    if (!selectedBlock) {
      return;
    }
    downloadSavedWorkflowBlocksJson([selectedBlock]);
    setMessage(`Exported component "${selectedBlock.name}"`);
  }, [selectedBlock]);

  const importBlocks = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const importedBlocks = parseSavedWorkflowBlocksJson(await file.text());
      onSavedBlocksChange((currentBlocks) => mergeSavedWorkflowBlocks(importedBlocks, currentBlocks));
      setSelectedBlockId(importedBlocks[0]?.id ?? null);
      setMessage(`Loaded ${importedBlocks.length} component${importedBlocks.length === 1 ? "" : "s"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load components");
    }
  }, [onSavedBlocksChange]);

  return (
    <section className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-950">Library</h2>
            <span className="rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
              {savedBlocks.length} saved
            </span>
          </div>
          <input
            className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={search}
            placeholder="Search saved components"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={classNames(
                "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50",
                savedBlocks.length === 0 && "cursor-not-allowed opacity-50",
              )}
              onClick={exportAll}
              disabled={savedBlocks.length === 0}
              title="Export all saved components"
            >
              <DownloadIcon className="h-4 w-4" />
              Export
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={() => fileInputRef.current?.click()}
              title="Import components from JSON"
            >
              <UploadIcon className="h-4 w-4" />
              Import
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={importBlocks}
          />
          {message && <div className="mt-2 text-[11px] text-zinc-500">{message}</div>}
        </div>
        <div className="max-h-[720px] space-y-4 overflow-auto p-4">
          {groupedBlocks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
              No saved components yet. Save a selection from the workflow builder or import a component JSON file.
            </div>
          ) : (
            groupedBlocks.map((group) => (
              <WorkflowComponentCategoryGroup key={group.category} category={group.category} count={group.items.length}>
                {group.items.map((block) => {
                  const active = selectedBlock?.id === block.id;
                  return (
                    <button
                      key={block.id}
                      type="button"
                      className={classNames(
                        "w-full rounded-lg border px-3 py-3 text-left transition",
                        active
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300 hover:bg-white",
                      )}
                      onClick={() => setSelectedBlockId(block.id)}
                      title={block.name}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{block.name}</div>
                          <div className={classNames("mt-1 text-[11px]", active ? "text-zinc-200" : "text-zinc-500")}>
                            {workflowKindName(workflowKindForSavedWorkflowBlock(block))} · {block.nodes.length} components
                          </div>
                        </div>
                        <ComponentsIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      </div>
                    </button>
                  );
                })}
              </WorkflowComponentCategoryGroup>
            ))
          )}
        </div>
      </aside>

      <div className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-950">
            {selectedBlock ? selectedBlock.name : "Select a component"}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {selectedBlock
              ? "Update metadata here, then open a workflow draft to modify or test the graph."
              : "Choose a saved component from the library to inspect or edit it."}
          </p>
        </div>
        {selectedBlock ? (
          <div className="space-y-5 p-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Component name">
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={nameDraft}
                  placeholder="Component name"
                  onChange={(event) => setNameDraft(event.target.value)}
                />
              </Field>
              <Field label="Workflow type">
                <select
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={kindDraft}
                  onChange={(event) => setKindDraft(event.target.value as WorkflowKindId)}
                >
                  {workflowKinds.map((workflowKind) => (
                    <option key={workflowKind.id} value={workflowKind.id}>
                      {workflowKind.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={categoryDraft}
                  onChange={(event) => setCategoryDraft(event.target.value as WorkflowComponentCategory)}
                >
                  {workflowComponentCategoryOrder.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tags">
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={tagsDraft}
                  placeholder="video, ingest, report"
                  onChange={(event) => setTagsDraft(event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Components" value={String(selectedBlock.nodes.length)} />
              <Metric label="Connections" value={String(selectedBlock.edges.length)} />
              <Metric label="Open Inputs" value={String(selectedBlockInputs.length)} />
              <Metric label="Open Outputs" value={String(selectedBlockOutputs.length)} />
            </div>

            <div className="grid gap-2 lg:grid-cols-5">
              <button
                type="button"
                className={classNames(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800",
                  !metadataDirty && "opacity-80",
                )}
                onClick={saveMetadata}
                title={`Save metadata for ${selectedBlock.name}`}
              >
                <SaveIcon className="h-4 w-4" />
                Save
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => onEditComponent(selectedBlock)}
                title={`Modify ${selectedBlock.name}`}
              >
                <WorkflowIcon className="h-4 w-4" />
                Modify
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => onTestComponent(selectedBlock)}
                title={`Test ${selectedBlock.name}`}
              >
                <PlayIcon className="h-4 w-4" />
                Test
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={exportSelected}
                title={`Export ${selectedBlock.name}`}
              >
                <DownloadIcon className="h-4 w-4" />
                Export
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-rose-700 shadow-sm hover:bg-rose-50"
                onClick={deleteSelected}
                title={`Delete ${selectedBlock.name}`}
              >
                <CloseIcon className="h-4 w-4" />
                Delete
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Open Inputs</div>
                <div className="mt-3 space-y-3">
                  {selectedBlockInputs.length === 0 ? (
                    <div className="rounded-md border border-dashed border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500">
                      No exposed inputs
                    </div>
                  ) : (
                    selectedBlockInputs.map((input) => (
                      <div key={`${input.nodeId}-${input.port.id}`} className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                        <div className="text-xs font-semibold text-zinc-900">{input.nodeTitle}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">{input.port.label}</div>
                        <WorkflowTypeDetails spec={input.port.valueType} typeDefinitions={typeDefinitions} />
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Open Outputs</div>
                <div className="mt-3 space-y-3">
                  {selectedBlockOutputs.length === 0 ? (
                    <div className="rounded-md border border-dashed border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500">
                      No exposed outputs
                    </div>
                  ) : (
                    selectedBlockOutputs.map((output) => (
                      <div key={`${output.nodeId}-${output.port.id}`} className="rounded-md border border-zinc-200 bg-white px-3 py-2">
                        <div className="text-xs font-semibold text-zinc-900">{output.nodeTitle}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">{output.port.label}</div>
                        <WorkflowTypeDetails spec={output.port.valueType} typeDefinitions={typeDefinitions} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6">
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              No component selected.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
