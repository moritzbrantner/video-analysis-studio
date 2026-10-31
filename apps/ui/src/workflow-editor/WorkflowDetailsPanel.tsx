import { useMemo } from "react";
import { type Edge } from "@xyflow/react";
import { type TypeDefinition } from "../type-library/page";
import { type WorkflowTypeSpec } from "../api/client";
import { formatWorkflowTypeSpecJson } from "../workflowTypeSpec";
import { formatWorkflowTypeScriptType } from "../workflowTypeScript";
import type { DataSourceEntry, WorkflowKindId } from "../run/types";
import { workflowKindName, workflowKinds } from "../run/workflowKinds";
import { Field, Metric } from "../shared/controls";
import {
  CloneIcon,
  CloseIcon,
  GroupIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  UngroupIcon,
} from "../shared/icons";
import { classNames, formatWorkflowTimestamp, hexToRgba } from "../shared/utils";
import { workflowComponentCategoryOrder } from "./componentCatalog";
import { AdapterNodeSettings, DataSourceNodeSettings } from "./NodeSettings";
import { portTypeBadgeTextColor, portTypeColor, usePortTypeColors } from "./portColors";
import { findPort, formatFlowPortType, handleId, portIsStream } from "./ports";
import { WorkflowResultPanelEditor } from "./ResultPanelEditor";
import { customTypeForSpec, normalizeWorkflowResultPanel } from "./resultPanels";
import type {
  AdapterTransformStep,
  DataSourceSchema,
  FlowPort,
  PortDirection,
  SavedWorkflow,
  SavedWorkflowLibrary,
  SavedWorkflowVersion,
  WorkflowBlockCategoryDraft,
  WorkflowNodeData,
  WorkflowNodeModel,
  WorkflowResultPanel,
} from "./types";

export function WorkflowDetailsPanel({
  workflowLibrary,
  activeWorkflow,
  nodes,
  edges,
  dataSources,
  typeDefinitions,
  selectedNodes,
  selectedInternalEdgeCount,
  blockName,
  blockCategory,
  blockTags,
  workflowNameDraft,
  onBlockNameChange,
  onBlockCategoryChange,
  onBlockTagsChange,
  onSelectWorkflow,
  onCreateWorkflow,
  onCloneWorkflow,
  onDeleteWorkflow,
  onWorkflowNameDraftChange,
  onCommitWorkflowName,
  onWorkflowKindChange,
  onResultPanelChange,
  onSaveSelectedBlock,
  onGroupSelected,
  onDeleteSelected,
  onUpdateSelectedGroup,
  onUpdateSelectedDataSource,
  onUpdateSelectedAdapter,
  onToggleSelectedGroupOpen,
  onUngroupSelected,
  onSaveWorkflowVersion,
  onUpdateDraftComponent,
  onRestoreWorkflowVersion,
  onFocusNode,
  collapsed,
  onToggleCollapsed,
  onOpenRunWorkspace,
}: {
  workflowLibrary: SavedWorkflowLibrary;
  activeWorkflow: SavedWorkflow;
  nodes: WorkflowNodeModel[];
  edges: Edge[];
  dataSources: DataSourceEntry[];
  typeDefinitions: TypeDefinition[];
  selectedNodes: WorkflowNodeModel[];
  selectedInternalEdgeCount: number;
  blockName: string;
  blockCategory: WorkflowBlockCategoryDraft;
  blockTags: string;
  workflowNameDraft: string;
  onBlockNameChange: (value: string) => void;
  onBlockCategoryChange: (value: WorkflowBlockCategoryDraft) => void;
  onBlockTagsChange: (value: string) => void;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onCloneWorkflow: () => void;
  onDeleteWorkflow: () => void;
  onWorkflowNameDraftChange: (value: string) => void;
  onCommitWorkflowName: () => void;
  onWorkflowKindChange: (kind: WorkflowKindId) => void;
  onResultPanelChange: (panel: WorkflowResultPanel) => void;
  onSaveSelectedBlock: () => void;
  onGroupSelected: () => void;
  onDeleteSelected: () => void;
  onUpdateSelectedGroup: (nodeId: string, updates: Pick<WorkflowNodeData, "title" | "description">) => void;
  onUpdateSelectedDataSource: (nodeId: string, dataSourceId: string | null) => void;
  onUpdateSelectedAdapter: (
    nodeId: string,
    inputSchema: DataSourceSchema,
    outputSchema: DataSourceSchema,
    steps: AdapterTransformStep[],
  ) => void;
  onToggleSelectedGroupOpen: () => void;
  onUngroupSelected: () => void;
  onSaveWorkflowVersion: () => void;
  onUpdateDraftComponent: () => void;
  onRestoreWorkflowVersion: (version: SavedWorkflowVersion) => void;
  onFocusNode: (nodeId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenRunWorkspace: () => void;
}) {
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedGroupNode = selectedNode?.data.group ? selectedNode : null;
  const selectedInputConnections = useMemo(
    () => (selectedNode ? workflowNodePortConnections(selectedNode, nodes, edges, "in") : []),
    [edges, nodes, selectedNode],
  );
  const selectedOutputConnections = useMemo(
    () => (selectedNode ? workflowNodePortConnections(selectedNode, nodes, edges, "out") : []),
    [edges, nodes, selectedNode],
  );

  if (collapsed) {
    return (
      <aside className="min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex h-full min-h-[160px] flex-row items-center justify-between gap-3 px-3 py-3 xl:min-h-0 xl:flex-col xl:justify-start xl:px-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
            onClick={onToggleCollapsed}
            title="Expand details"
            aria-label="Expand details"
          >
            <PanelExpandIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 xl:flex xl:flex-1 xl:items-center xl:justify-center">
            <div
              className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 xl:rotate-180"
              style={{ writingMode: "vertical-rl" }}
            >
              Details
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
            onClick={onOpenRunWorkspace}
            title="Open run controls"
            aria-label="Open run controls"
          >
            <PlayIcon className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-950">
              {selectedNode ? selectedNode.data.title : selectedNodes.length > 1 ? "Selection" : "Workflow Details"}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {selectedNode
                ? selectedNode.data.packageName
                : selectedNodes.length > 1
                  ? `${selectedNodes.length} components selected`
                  : activeWorkflow.name}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
            onClick={onToggleCollapsed}
            title="Collapse details"
            aria-label="Collapse details"
          >
            <PanelCollapseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="max-h-[682px] space-y-5 overflow-auto p-4">
        {selectedNode ? (
          <>
            <div>
              {selectedGroupNode ? (
                <div className="space-y-3">
                  <Field label="Group name">
                    <input
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={selectedGroupNode.data.title}
                      placeholder="Group name"
                      onChange={(event) =>
                        onUpdateSelectedGroup(selectedGroupNode.id, {
                          title: event.target.value,
                          description: selectedGroupNode.data.description,
                        })
                      }
                    />
                  </Field>
                  <Field label="Description">
                    <textarea
                      className="min-h-24 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={selectedGroupNode.data.description}
                      placeholder="Group description"
                      onChange={(event) =>
                        onUpdateSelectedGroup(selectedGroupNode.id, {
                          title: selectedGroupNode.data.title,
                          description: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
              ) : (
                <p className="text-sm leading-6 text-zinc-700">{selectedNode.data.description}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded bg-zinc-950 px-2 py-1 text-[10px] font-semibold uppercase text-white">
                  {selectedNode.data.category ?? "Reusable"}
                </span>
                {(selectedNode.data.tags ?? []).slice(0, 5).map((tag) => (
                  <span key={tag} className="rounded bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-600">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {selectedNode.data.dataSourceNode && (
              <DataSourceNodeSettings
                node={selectedNode}
                nodes={nodes}
                edges={edges}
                dataSources={dataSources}
                onSelectDataSource={onUpdateSelectedDataSource}
              />
            )}
            {selectedNode.data.adapterNode && (
              <AdapterNodeSettings
                node={selectedNode}
                typeDefinitions={typeDefinitions}
                onChange={onUpdateSelectedAdapter}
              />
            )}
            <WorkflowPortConnectionsList
              title="Inputs"
              groups={selectedInputConnections}
              typeDefinitions={typeDefinitions}
              onFocusNode={onFocusNode}
            />
            <WorkflowPortConnectionsList
              title="Outputs"
              groups={selectedOutputConnections}
              typeDefinitions={typeDefinitions}
              onFocusNode={onFocusNode}
            />
            {selectedGroupNode?.data.group && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Group</div>
                <div className="mt-2 text-sm font-medium text-zinc-900">
                  {selectedGroupNode.data.group.memberCount} components
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {selectedGroupNode.data.group.edges.length} internal connections
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {selectedGroupNode && (
                <button
                  className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800"
                  onClick={onToggleSelectedGroupOpen}
                  title={selectedGroupNode.data.groupOpen ? "Close selected group" : "Open selected group"}
                >
                  {selectedGroupNode.data.groupOpen ? <PanelCollapseIcon className="h-4 w-4" /> : <PanelExpandIcon className="h-4 w-4" />}
                  {selectedGroupNode.data.groupOpen ? "Close Group" : "Open Group"}
                </button>
              )}
              <button
                className={classNames(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-rose-700 shadow-sm hover:bg-rose-50",
                  !selectedGroupNode && "col-span-2",
                )}
                onClick={onDeleteSelected}
                title="Delete selected component"
              >
                <CloseIcon className="h-4 w-4" />
                Delete
              </button>
              {selectedGroupNode && (
                <button
                  className="col-span-2 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                  onClick={onUngroupSelected}
                  title="Ungroup selected component"
                >
                  <UngroupIcon className="h-4 w-4" />
                  Ungroup
                </button>
              )}
            </div>
          </>
        ) : selectedNodes.length > 1 ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Selected" value={String(selectedNodes.length)} />
              <Metric label="Internal" value={String(selectedInternalEdgeCount)} />
            </div>
            <Field label="Component name">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={blockName}
                placeholder="Component name"
                onChange={(event) => onBlockNameChange(event.target.value)}
              />
            </Field>
            <Field label="Category">
              <select
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={blockCategory}
                onChange={(event) => onBlockCategoryChange(event.target.value as WorkflowBlockCategoryDraft)}
              >
                <option value="Auto">Auto</option>
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
                value={blockTags}
                placeholder="video, ingest, report"
                onChange={(event) => onBlockTagsChange(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800"
                onClick={onSaveSelectedBlock}
                title="Save selected components"
              >
                <SaveIcon className="h-4 w-4" />
                Save
              </button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800"
                onClick={onGroupSelected}
                title="Group selected components"
              >
                <GroupIcon className="h-4 w-4" />
                Group
              </button>
            </div>
          </>
        ) : (
          <>
            <Field label="Workflow name">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={workflowNameDraft}
                placeholder="Workflow name"
                onChange={(event) => onWorkflowNameDraftChange(event.target.value)}
                onBlur={onCommitWorkflowName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </Field>
            <Field label="Workflow type">
              <select
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={activeWorkflow.kind}
                onChange={(event) => onWorkflowKindChange(event.target.value as WorkflowKindId)}
              >
                {workflowKinds.map((workflowKind) => (
                  <option key={workflowKind.id} value={workflowKind.id}>
                    {workflowKind.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Version" value={`v${activeWorkflow.version}`} />
              <Metric label="Type" value={workflowKindName(activeWorkflow.kind)} />
              <Metric label="Updated" value={formatWorkflowTimestamp(activeWorkflow.updatedAt)} />
              <Metric label="Components" value={String(nodes.length)} />
              <Metric label="Connections" value={String(edges.length)} />
            </div>
            <WorkflowResultPanelEditor
              workflowKind={activeWorkflow.kind}
              panel={normalizeWorkflowResultPanel(activeWorkflow.resultPanel, activeWorkflow.kind, activeWorkflow.name)}
              nodes={nodes}
              dataSources={dataSources}
              typeDefinitions={typeDefinitions}
              onChange={onResultPanelChange}
            />
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-emerald-500"
                onClick={onOpenRunWorkspace}
                title="Open run controls for this workflow"
              >
                <PlayIcon className="h-4 w-4" />
                Run
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={onCreateWorkflow}
                title="New blank workflow"
              >
                <PlusIcon className="h-4 w-4" />
                New
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={onCloneWorkflow}
                title="Clone active workflow"
              >
                <CloneIcon className="h-4 w-4" />
                Clone
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-rose-700 shadow-sm hover:bg-rose-50"
                onClick={onDeleteWorkflow}
                title="Delete active workflow"
              >
                <CloseIcon className="h-4 w-4" />
                Delete
              </button>
            </div>
            {activeWorkflow.componentDraft && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <div className="text-xs font-semibold uppercase text-sky-800">Component Draft</div>
                <div className="mt-1 text-sm font-medium text-sky-950">{activeWorkflow.componentDraft.blockName}</div>
                <p className="mt-1 text-xs leading-5 text-sky-900">
                  This workflow was opened from the reusable component library. Save your graph back to update the
                  original component.
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-sky-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-sky-900"
                  onClick={onUpdateDraftComponent}
                  title={`Update component ${activeWorkflow.componentDraft.blockName}`}
                >
                  <SaveIcon className="h-4 w-4" />
                  Update Component
                </button>
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">Workflows</div>
              <div className="max-h-36 space-y-1 overflow-auto pr-1">
                {workflowLibrary.workflows.map((workflow) => (
                  <button
                    key={workflow.id}
                    type="button"
                    className={classNames(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition",
                      workflow.id === activeWorkflow.id
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300 hover:bg-white",
                    )}
                    onClick={() => onSelectWorkflow(workflow.id)}
                    title={workflow.name}
                  >
                    <span className="min-w-0 truncate font-semibold">{workflow.name}</span>
                    <span className="shrink-0 text-[10px] opacity-70">
                      v{workflow.version} · {workflow.nodes.length} / {workflow.edges.length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-zinc-200 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Versions</div>
                <span className="shrink-0 rounded bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600">
                  {activeWorkflow.versions.length} saved
                </span>
              </div>
              <button
                type="button"
                className="mt-2 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
                onClick={onSaveWorkflowVersion}
                title="Save workflow version"
              >
                <SaveIcon className="h-4 w-4" />
                Save Version
              </button>
              <div className="mt-2 max-h-36 space-y-1 overflow-auto pr-1">
                {activeWorkflow.versions.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">
                    No saved versions
                  </div>
                ) : (
                  activeWorkflow.versions.map((version) => (
                    <div key={version.id} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-zinc-900">v{version.version}</div>
                          <div className="mt-1 truncate text-[11px] text-zinc-500">
                            {formatWorkflowTimestamp(version.createdAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100"
                          onClick={() => onRestoreWorkflowVersion(version)}
                          title={`Restore ${version.name} v${version.version}`}
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

interface WorkflowPortConnection {
  nodeId: string;
  nodeTitle: string;
  portLabel: string;
}

interface WorkflowPortConnectionGroup {
  port: FlowPort;
  connections: WorkflowPortConnection[];
}

function workflowNodePortConnections(
  node: WorkflowNodeModel,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  direction: PortDirection,
): WorkflowPortConnectionGroup[] {
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const ports = direction === "in" ? node.data.inputs : node.data.outputs;

  return ports.map((portValue) => {
    const ownHandle = handleId(direction, portValue);
    const matchingEdges = edges.filter((edge) =>
      direction === "in"
        ? edge.target === node.id && edge.targetHandle === ownHandle
        : edge.source === node.id && edge.sourceHandle === ownHandle,
    );

    const connections: WorkflowPortConnection[] = [];
    const seen = new Set<string>();
    for (const edge of matchingEdges) {
      const connectedNodeId = direction === "in" ? edge.source : edge.target;
      const connectedHandle = direction === "in" ? edge.sourceHandle : edge.targetHandle;
      const connectedDirection: PortDirection = direction === "in" ? "out" : "in";
      const connectedNode = nodeById.get(connectedNodeId);
      if (!connectedNode) {
        continue;
      }

      const connectedPort = findPort(nodes, connectedNodeId, connectedHandle, connectedDirection);
      const key = `${connectedNodeId}|${connectedPort?.id ?? connectedHandle ?? ""}|${connectedPort?.type ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      connections.push({
        nodeId: connectedNodeId,
        nodeTitle: connectedNode.data.title,
        portLabel: connectedPort?.label ?? (connectedDirection === "out" ? "output" : "input"),
      });
    }

    connections.sort((left, right) => left.nodeTitle.localeCompare(right.nodeTitle));
    return { port: portValue, connections };
  });
}

function WorkflowPortConnectionsList({
  title,
  groups,
  typeDefinitions,
  onFocusNode,
}: {
  title: string;
  groups: WorkflowPortConnectionGroup[];
  typeDefinitions: TypeDefinition[];
  onFocusNode: (nodeId: string) => void;
}) {
  const colors = usePortTypeColors();
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">{title}</div>
      <div className="space-y-2">
        {groups.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">none</div>
        ) : (
          groups.map(({ port: portValue, connections }) => {
            const color = portTypeColor(portValue.type, colors);
            return (
              <div
                key={`${title}-${portValue.id}-${portValue.type}-${portIsStream(portValue) ? "stream" : "value"}`}
                className="rounded-md border px-3 py-2 text-xs"
                style={{
                  backgroundColor: hexToRgba(color, 0.08),
                  borderColor: hexToRgba(color, 0.32),
                }}
              >
                <div className="font-medium text-zinc-900">{portValue.label}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase">
                  <span style={{ color: portTypeBadgeTextColor(color) }}>{formatFlowPortType(portValue)}</span>
                  {portIsStream(portValue) && <span className="text-zinc-900">stream</span>}
                  {portValue.optional && <span className="text-zinc-500">optional</span>}
                </div>
                <WorkflowTypeDetails spec={portValue.valueType} typeDefinitions={typeDefinitions} />
                {connections.length === 0 ? (
                  <div className="mt-2 text-[11px] text-zinc-500">No connected components</div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {connections.map((connection) => (
                      <button
                        key={`${portValue.id}-${connection.nodeId}-${connection.portLabel}`}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1.5 text-left text-[11px] hover:border-zinc-300 hover:bg-zinc-50"
                        onClick={() => onFocusNode(connection.nodeId)}
                        title={`Focus ${connection.nodeTitle}`}
                      >
                        <span className="truncate font-medium text-zinc-800">{connection.nodeTitle}</span>
                        <span className="shrink-0 text-[10px] text-zinc-500">{connection.portLabel}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function WorkflowTypeDetails({
  spec,
  typeDefinitions = [],
}: {
  spec: WorkflowTypeSpec;
  typeDefinitions?: TypeDefinition[];
}) {
  const customType = customTypeForSpec(spec, typeDefinitions);
  return (
    <div className="mt-2 space-y-2">
      {customType && (
        <div className="inline-flex max-w-full rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-800">
          {customType.name}
        </div>
      )}
      <pre className="overflow-auto rounded-md bg-white/80 px-2 py-2 font-mono text-[10px] leading-4 text-zinc-600">
        {customType ? `type ${customType.name} = ${customType.source.trim()};\n` : formatWorkflowTypeScriptType(spec)}
      </pre>
      <details className="rounded-md bg-white/60 px-2 py-2 text-[10px] text-zinc-500">
        <summary className="cursor-pointer font-semibold uppercase">JSON</summary>
        <pre className="mt-2 overflow-auto font-mono leading-4">{formatWorkflowTypeSpecJson(spec)}</pre>
      </details>
    </div>
  );
}
