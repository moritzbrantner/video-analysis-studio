import type React from "react";
import { formatWorkflowTypeSpecJson } from "../workflowTypeSpec";
import {
  CloseIcon,
  GroupIcon,
  MinimizeIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PlusIcon,
  SaveIcon,
  UngroupIcon,
} from "../shared/icons";
import { clampedFixedPosition, classNames } from "../shared/utils";
import { portTypeColor, usePortTypeColors } from "./portColors";
import { formatFlowPortType } from "./ports";
import { flowToneClass } from "./tones";
import type {
  FlowPort,
  FlowTone,
  SavedWorkflowBlock,
  WorkflowBlockOpenInput,
  WorkflowNodeModel,
  WorkflowPrimitiveConnectorTarget,
  WorkflowSavedBlockConnectorTarget,
} from "./types";

export function WorkflowContextMenu({
  x,
  y,
  nodeCount,
  canGroup,
  canSave,
  canUngroup,
  canOpenGroup,
  groupOpen,
  groupOpenLabel,
  minimizeLabel,
  onGroup,
  onSave,
  onToggleGroupOpen,
  onUngroup,
  onToggleMinimized,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  nodeCount: number;
  canGroup: boolean;
  canSave: boolean;
  canUngroup: boolean;
  canOpenGroup: boolean;
  groupOpen: boolean;
  groupOpenLabel: string;
  minimizeLabel: string;
  onGroup: () => void;
  onSave: () => void;
  onToggleGroupOpen: () => void;
  onUngroup: () => void;
  onToggleMinimized: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed z-50 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-xl"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="border-b border-zinc-100 px-3 py-2 text-[11px] font-semibold uppercase text-zinc-500">
        {nodeCount} selected
      </div>
      <ContextMenuButton icon={<GroupIcon className="h-4 w-4" />} disabled={!canGroup} onClick={onGroup}>
        Group selected
      </ContextMenuButton>
      <ContextMenuButton icon={<SaveIcon className="h-4 w-4" />} disabled={!canSave} onClick={onSave}>
        Save as component
      </ContextMenuButton>
      <ContextMenuButton
        icon={groupOpen ? <PanelCollapseIcon className="h-4 w-4" /> : <PanelExpandIcon className="h-4 w-4" />}
        disabled={!canOpenGroup}
        onClick={onToggleGroupOpen}
      >
        {groupOpenLabel}
      </ContextMenuButton>
      <ContextMenuButton icon={<MinimizeIcon className="h-4 w-4" />} onClick={onToggleMinimized}>
        {minimizeLabel}
      </ContextMenuButton>
      <ContextMenuButton icon={<UngroupIcon className="h-4 w-4" />} disabled={!canUngroup} onClick={onUngroup}>
        Ungroup
      </ContextMenuButton>
      <div className="border-t border-zinc-100">
        <ContextMenuButton icon={<CloseIcon className="h-4 w-4" />} onClick={onDelete} tone="danger">
          Delete
        </ContextMenuButton>
        <ContextMenuButton onClick={onClose}>Close</ContextMenuButton>
      </div>
    </div>
  );
}

export function WorkflowOutputConnectorMenu({
  x,
  y,
  sourcePort,
  primitiveTargets,
  savedBlockTargets,
  onSelectPrimitive,
  onSelectSavedBlock,
  onClose,
}: {
  x: number;
  y: number;
  sourcePort: FlowPort;
  primitiveTargets: WorkflowPrimitiveConnectorTarget[];
  savedBlockTargets: WorkflowSavedBlockConnectorTarget[];
  onSelectPrimitive: (template: WorkflowNodeModel, input: FlowPort) => void;
  onSelectSavedBlock: (block: SavedWorkflowBlock, input: WorkflowBlockOpenInput) => void;
  onClose: () => void;
}) {
  const colors = usePortTypeColors();
  const color = portTypeColor(sourcePort.type, colors);
  const hasTargets = primitiveTargets.length > 0 || savedBlockTargets.length > 0;

  return (
    <div
      className="fixed z-50 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-xl"
      style={clampedFixedPosition(x, y, 288, 420)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase text-zinc-500">Connect output</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="min-w-0 truncate text-xs font-semibold text-zinc-900">
              {sourcePort.label} · {formatFlowPortType(sourcePort)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <pre className="max-h-28 overflow-auto border-b border-zinc-100 bg-zinc-50 px-3 py-2 font-mono text-[10px] leading-4 text-zinc-600">
        {formatWorkflowTypeSpecJson(sourcePort.valueType)}
      </pre>
      <div className="max-h-96 overflow-auto py-1">
        {!hasTargets && <div className="px-3 py-3 text-xs text-zinc-400">No compatible components</div>}
        {primitiveTargets.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[11px] font-semibold uppercase text-zinc-500">Library</div>
            {primitiveTargets.map(({ template, input }) => (
              <ConnectorMenuButton
                key={`primitive-${template.id}-${input.id}`}
                title={template.data.title}
                subtitle={template.data.packageName}
                detail={input.label}
                tone={template.data.tone}
                onClick={() => onSelectPrimitive(template, input)}
              />
            ))}
          </div>
        )}
        {savedBlockTargets.length > 0 && (
          <div className={classNames(primitiveTargets.length > 0 && "border-t border-zinc-100")}>
            <div className="px-3 py-2 text-[11px] font-semibold uppercase text-zinc-500">Reusable</div>
            {savedBlockTargets.map(({ block, input }) => (
              <ConnectorMenuButton
                key={`block-${block.id}-${input.nodeId}-${input.port.id}`}
                title={block.name}
                subtitle={`${block.nodes.length} components`}
                detail={`${input.nodeTitle}: ${input.port.label}`}
                onClick={() => onSelectSavedBlock(block, input)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorMenuButton({
  title,
  subtitle,
  detail,
  tone = "zinc",
  onClick,
}: {
  title: string;
  subtitle: string;
  detail: string;
  tone?: FlowTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-50"
      onClick={onClick}
      title={`${title} - ${detail}`}
    >
      <span className={classNames("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", flowToneClass(tone))} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-zinc-900">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{subtitle}</span>
        <span className="mt-1 block truncate text-[11px] font-medium text-zinc-700">{detail}</span>
      </span>
      <PlusIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
    </button>
  );
}

function ContextMenuButton({
  children,
  icon,
  disabled = false,
  tone = "default",
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      className={classNames(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium",
        disabled
          ? "cursor-not-allowed text-zinc-300"
          : tone === "danger"
            ? "text-rose-700 hover:bg-rose-50"
            : "text-zinc-800 hover:bg-zinc-50",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}
