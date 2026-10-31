import React, { useMemo } from "react";
import {
  CloseIcon,
  DownloadIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PlusIcon,
  UploadIcon,
} from "../shared/icons";
import { classNames } from "../shared/utils";
import {
  groupSavedWorkflowBlocksByCategory,
  groupWorkflowNodeTemplatesByCategory,
} from "./componentCatalog";
import { workflowComponentDragDataType } from "./constants";
import { flowToneClass } from "./tones";
import type {
  FlowTone,
  SavedWorkflowBlock,
  WorkflowComponentCategory,
  WorkflowComponentDragPayload,
  WorkflowNodeModel,
} from "./types";

export function WorkflowComponentSelector({
  search,
  onSearchChange,
  primitiveNodes,
  savedBlocks,
  selectedNodeCount,
  blockLibraryMessage,
  savedBlockExportDisabled,
  onAddPrimitive,
  onAddSavedBlock,
  onDeleteSavedBlock,
  onExportSavedBlocks,
  onImportSavedBlocks,
  collapsed,
  onToggleCollapsed,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  primitiveNodes: WorkflowNodeModel[];
  savedBlocks: SavedWorkflowBlock[];
  selectedNodeCount: number;
  blockLibraryMessage: string | null;
  savedBlockExportDisabled: boolean;
  onAddPrimitive: (template: WorkflowNodeModel) => void;
  onAddSavedBlock: (block: SavedWorkflowBlock) => void;
  onDeleteSavedBlock: (blockId: string) => void;
  onExportSavedBlocks: () => void;
  onImportSavedBlocks: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const primitiveGroups = useMemo(() => groupWorkflowNodeTemplatesByCategory(primitiveNodes), [primitiveNodes]);
  const savedBlockGroups = useMemo(() => groupSavedWorkflowBlocksByCategory(savedBlocks), [savedBlocks]);

  if (collapsed) {
    return (
      <aside className="min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex h-full min-h-[160px] flex-row items-center justify-between gap-3 px-3 py-3 xl:min-h-0 xl:flex-col xl:justify-start xl:px-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
            onClick={onToggleCollapsed}
            title="Expand components"
            aria-label="Expand components"
          >
            <PanelExpandIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 xl:flex xl:flex-1 xl:items-center xl:justify-center">
            <div
              className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 xl:rotate-180"
              style={{ writingMode: "vertical-rl" }}
            >
              Components
            </div>
          </div>
          <span className="shrink-0 rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
            {primitiveNodes.length + savedBlocks.length}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-950">Components</h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
            onClick={onToggleCollapsed}
            title="Collapse components"
            aria-label="Collapse components"
          >
            <PanelCollapseIcon className="h-4 w-4" />
          </button>
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={search}
          placeholder="Search components"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <div className="max-h-[682px] space-y-5 overflow-auto p-4">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">Library</div>
          <div className="space-y-2">
            {primitiveNodes.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">
                No components
              </div>
            ) : (
              primitiveGroups.map((group) => (
                <WorkflowComponentCategoryGroup
                  key={group.category}
                  category={group.category}
                  count={group.items.length}
                >
                  {group.items.map((node) => (
                    <WorkflowComponentTile
                      key={node.id}
                      title={node.data.title}
                      subtitle={node.data.packageName}
                      category={node.data.category ?? "Reusable"}
                      tone={node.data.tone}
                      portSummary={`${node.data.inputs.length} in · ${node.data.outputs.length} out`}
                      tags={node.data.tags ?? []}
                      dragPayload={{ type: "primitive", id: node.id }}
                      onAdd={() => onAddPrimitive(node)}
                    />
                  ))}
                </WorkflowComponentCategoryGroup>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase text-zinc-500">Reusable</div>
            <span className="shrink-0 rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
              {selectedNodeCount} selected
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className={classNames(
                "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50",
                savedBlockExportDisabled && "cursor-not-allowed opacity-50",
              )}
              onClick={onExportSavedBlocks}
              disabled={savedBlockExportDisabled}
              title="Export components as JSON"
            >
              <DownloadIcon className="h-4 w-4" />
              Export
            </button>
            <button
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={onImportSavedBlocks}
              title="Load components from JSON"
            >
              <UploadIcon className="h-4 w-4" />
              Load
            </button>
          </div>
          {blockLibraryMessage && <div className="mt-2 text-[11px] text-zinc-500">{blockLibraryMessage}</div>}
          <div className="mt-3 space-y-2">
            {savedBlocks.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">
                No saved components
              </div>
            ) : (
              savedBlockGroups.map((group) => (
                <WorkflowComponentCategoryGroup
                  key={group.category}
                  category={group.category}
                  count={group.items.length}
                >
                  {group.items.map((block) => (
                    <WorkflowComponentTile
                      key={block.id}
                      title={block.name}
                      subtitle={`${block.nodes.length} components`}
                      category={block.category ?? "Reusable"}
                      portSummary={`${block.edges.length} connections`}
                      tags={block.tags ?? []}
                      dragPayload={{ type: "block", id: block.id }}
                      onAdd={() => onAddSavedBlock(block)}
                      onDelete={() => onDeleteSavedBlock(block.id)}
                    />
                  ))}
                </WorkflowComponentCategoryGroup>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export function WorkflowComponentCategoryGroup({
  category,
  count,
  children,
}: {
  category: WorkflowComponentCategory;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-semibold uppercase text-zinc-500">
        <span className="truncate">{category}</span>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function WorkflowComponentTile({
  title,
  subtitle,
  category,
  portSummary,
  tags,
  tone = "zinc",
  dragPayload,
  onAdd,
  onDelete,
}: {
  title: string;
  subtitle: string;
  category: WorkflowComponentCategory;
  portSummary: string;
  tags: string[];
  tone?: FlowTone;
  dragPayload: WorkflowComponentDragPayload;
  onAdd: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      draggable
      className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 hover:border-zinc-300 hover:bg-white"
      onDragStart={(event) => {
        event.dataTransfer.setData(workflowComponentDragDataType, JSON.stringify(dragPayload));
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onAdd} title={`Add ${title}`}>
          <span className="flex items-center gap-2">
            <span className={classNames("h-2.5 w-2.5 shrink-0 rounded-full", flowToneClass(tone))} />
            <span className="min-w-0 truncate font-semibold">{title}</span>
          </span>
          <span className="mt-1 block truncate text-[10px] text-zinc-500">{subtitle}</span>
          <span className="mt-1 block truncate text-[10px] font-semibold uppercase text-zinc-500">{category}</span>
          <span className="mt-1 block text-[10px] text-zinc-500">{portSummary}</span>
          {tags.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1">
              {tags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                  {tag}
                </span>
              ))}
              {tags.length > 4 && <span className="text-[10px] text-zinc-500">+{tags.length - 4}</span>}
            </span>
          )}
        </button>
        <div className="flex shrink-0 gap-1">
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            onClick={onAdd}
            title={`Add ${title}`}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          {onDelete && (
            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
              onClick={onDelete}
              title={`Delete ${title}`}
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
