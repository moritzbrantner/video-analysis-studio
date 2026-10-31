import React, { useEffect, useMemo } from "react";
import {
  type NodeProps,
  useReactFlow,
  type Edge,
  useUpdateNodeInternals,
  NodeResizer,
  Handle,
  Position,
} from "@xyflow/react";
import { formatWorkflowTypeSpecJson } from "../workflowTypeSpec";
import { ExpandIcon, MinimizeIcon, PanelCollapseIcon, PanelExpandIcon } from "../shared/icons";
import { classNames, hexToRgba } from "../shared/utils";
import {
  defaultWorkflowGroupHeight,
  defaultWorkflowNodeWidth,
  minWorkflowGroupHeight,
  minWorkflowGroupWidth,
} from "./constants";
import { WorkflowFocusContext, WorkflowOutputConnectorContext } from "./contexts";
import {
  normalizedWorkflowNodeSize,
  workflowGroupOpenViewLayout,
  workflowGroupPreviewNodeHeight,
  workflowGroupPreviewNodeWidth,
  workflowNodeDataUsesInlineLayout,
} from "./nodeSizing";
import { portTypeBadgeTextColor, portTypeColor, usePortTypeColors } from "./portColors";
import { formatFlowPortType, handleId, portIsStream } from "./ports";
import { flowToneClass, workflowHeaderClass } from "./tones";
import type {
  FlowPort,
  PortDirection,
  WorkflowGroupMetadata,
  WorkflowNodeData,
  WorkflowNodeModel,
} from "./types";

export function WorkflowNode({ id, data, selected, isConnectable }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const minimized = nodeData.minimized === true;
  const inlineLayout = workflowNodeDataUsesInlineLayout(nodeData);
  const { updateNodeData } = useReactFlow<WorkflowNodeModel, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const isGroup = nodeData.kind === "group";
  const groupOpen = isGroup && nodeData.groupOpen === true;
  const groupSize = isGroup ? normalizedWorkflowNodeSize(nodeData.size) : null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [
    groupOpen,
    groupSize?.height,
    groupSize?.width,
    id,
    inlineLayout,
    minimized,
    nodeData.inputs.length,
    nodeData.outputs.length,
    updateNodeInternals,
  ]);

  const toggleMinimized = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    updateNodeData(id, { minimized: !minimized });
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  const toggleGroupOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    updateNodeData(id, {
      groupOpen: !groupOpen,
      minimized: groupOpen ? minimized : false,
    });
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  const updateGroupSize = (_event: unknown, params: { width: number; height: number }) => {
    updateNodeData(id, {
      size: {
        width: Math.round(params.width),
        height: Math.round(params.height),
      },
    });
    requestAnimationFrame(() => updateNodeInternals(id));
  };

  return (
    <div
      data-testid="workflow-node"
      data-node-title={nodeData.title}
      className={classNames(
        inlineLayout
          ? "w-[240px]"
          : minimized
          ? "w-[230px]"
          : isGroup
            ? "min-w-[260px]"
            : "w-[310px]",
        "rounded-lg border bg-white text-left shadow-sm",
        isGroup && "border-dashed",
        selected ? "border-zinc-950 ring-2 ring-zinc-950/10" : "border-zinc-200",
      )}
      style={
        isGroup && !minimized
          ? {
              width: groupSize?.width ?? defaultWorkflowNodeWidth,
              minHeight: groupSize?.height ?? defaultWorkflowGroupHeight,
            }
          : undefined
      }
    >
      {isGroup && !minimized && (
        <NodeResizer
          isVisible={selected}
          minWidth={minWorkflowGroupWidth}
          minHeight={minWorkflowGroupHeight}
          color="#18181b"
          onResize={updateGroupSize}
          onResizeEnd={updateGroupSize}
        />
      )}
      {inlineLayout ? (
        <InlineWorkflowNode
          nodeId={id}
          data={nodeData}
          isConnectable={isConnectable}
          onExpand={toggleMinimized}
        />
      ) : (
        <>
          <div className={classNames(!minimized && "border-b", "px-3 py-2", workflowHeaderClass(nodeData.tone))}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-950">{nodeData.title}</div>
                <div className="mt-0.5 text-[11px] font-medium text-zinc-600">{nodeData.packageName}</div>
              </div>
              <div className="mt-0.5 flex shrink-0 items-center gap-2">
                {nodeData.group && (
                  <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600">
                    {nodeData.group.memberCount}
                  </span>
                )}
                <span className={classNames("h-2.5 w-2.5 rounded-full", flowToneClass(nodeData.tone))} />
                {isGroup && !minimized && (
                  <button
                    type="button"
                    className="nodrag nopan inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white/80 text-zinc-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-1"
                    onClick={toggleGroupOpen}
                    title={groupOpen ? "Close group" : "Open group"}
                    aria-label={groupOpen ? "Close group" : "Open group"}
                  >
                    {groupOpen ? <PanelCollapseIcon className="h-3.5 w-3.5" /> : <PanelExpandIcon className="h-3.5 w-3.5" />}
                  </button>
                )}
                <button
                  type="button"
                  className="nodrag nopan inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white/80 text-zinc-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-1"
                  onClick={toggleMinimized}
                  title={minimized ? "Expand component" : "Minimize component"}
                  aria-label={minimized ? "Expand component" : "Minimize component"}
                >
                  {minimized ? <ExpandIcon className="h-3.5 w-3.5" /> : <MinimizeIcon className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            {!minimized && <p className="mt-2 text-xs leading-5 text-zinc-600">{nodeData.description}</p>}
          </div>
          {minimized ? (
            <MinimizedPortHandles
              nodeId={id}
              inputs={nodeData.inputs}
              outputs={nodeData.outputs}
              isConnectable={isConnectable}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 p-3">
                <PortColumn
                  nodeId={id}
                  title="Inputs"
                  direction="in"
                  ports={nodeData.inputs}
                  isConnectable={isConnectable}
                />
                <PortColumn
                  nodeId={id}
                  title="Outputs"
                  direction="out"
                  ports={nodeData.outputs}
                  isConnectable={isConnectable}
                />
              </div>
              {isGroup && groupOpen && nodeData.group && <WorkflowGroupOpenView group={nodeData.group} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function InlineWorkflowNode({
  nodeId,
  data,
  isConnectable,
  onExpand,
}: {
  nodeId: string;
  data: WorkflowNodeData;
  isConnectable: boolean;
  onExpand: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const input = data.inputs[0];
  const output = data.outputs[0];
  const colors = usePortTypeColors();
  const { onOutputDoubleClick } = React.useContext(WorkflowOutputConnectorContext);
  const inputColor = input ? portTypeColor(input.type, colors) : null;
  const outputColor = output ? portTypeColor(output.type, colors) : null;

  return (
    <div
      data-testid="workflow-inline-node"
      data-node-title={data.title}
      className={classNames(
        "relative flex h-12 items-center gap-2 rounded-lg px-3",
        workflowHeaderClass(data.tone),
      )}
      title={inlineWorkflowNodeTitle(data)}
    >
      {input && inputColor && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id={handleId("in", input)}
            isConnectable={isConnectable}
            className="!h-3 !w-3 !border-2 !border-white"
            style={{
              backgroundColor: inputColor,
              left: -7,
              top: "50%",
            }}
          />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: inputColor }} />
        </>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-zinc-950">{data.title}</div>
        <div className="truncate text-[10px] font-medium text-zinc-600">{inlineWorkflowNodePortSummary(data)}</div>
      </div>
      {output && outputColor && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: outputColor }} />}
      <button
        type="button"
        className="nodrag nopan inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white/80 text-zinc-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-1"
        onClick={onExpand}
        title="Expand component"
        aria-label="Expand component"
      >
        <ExpandIcon className="h-3.5 w-3.5" />
      </button>
      {output && outputColor && (
        <Handle
          type="source"
          position={Position.Right}
          id={handleId("out", output)}
          isConnectable={isConnectable}
          onDoubleClick={(event) => {
            onOutputDoubleClick(event, nodeId, output);
          }}
          className="!h-3 !w-3 !border-2 !border-white"
          style={{
            backgroundColor: outputColor,
            right: -7,
            top: "50%",
          }}
        />
      )}
    </div>
  );
}

function inlineWorkflowNodeTitle(data: WorkflowNodeData): string {
  const input = data.inputs[0];
  const output = data.outputs[0];
  if (input && output) {
    return `${data.title} - ${input.label} to ${output.label}`;
  }
  return `${data.title} - ${(input ?? output)?.label ?? "port"}`;
}

function inlineWorkflowNodePortSummary(data: WorkflowNodeData): string {
  const input = data.inputs[0];
  const output = data.outputs[0];
  if (input && output) {
    return `${formatFlowPortType(input)} -> ${formatFlowPortType(output)}`;
  }
  if (input) {
    return formatFlowPortType(input);
  }
  if (output) {
    return formatFlowPortType(output);
  }
  return "port";
}

function WorkflowGroupOpenView({ group }: { group: WorkflowGroupMetadata }) {
  const colors = usePortTypeColors();
  const layout = useMemo(() => workflowGroupOpenViewLayout(group), [group]);

  return (
    <div className="border-t border-zinc-100 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase text-zinc-500">
        <span>Members</span>
        <span className="shrink-0">
          {group.nodes.length} / {group.edges.length}
        </span>
      </div>
      <div className="nodrag nopan max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${layout.width} ${layout.height}`}>
            {layout.edges.map((edge) => {
              const color = portTypeColor(edge.type, colors);
              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeWidth={2}
                  opacity={0.82}
                />
              );
            })}
          </svg>
          {layout.nodes.map((member) => (
            <div
              key={member.node.id}
              className="absolute overflow-hidden rounded-md border border-zinc-200 bg-white text-left shadow-sm"
              style={{
                left: member.x,
                top: member.y,
                width: workflowGroupPreviewNodeWidth,
                height: workflowGroupPreviewNodeHeight,
              }}
              title={member.node.data.title}
            >
              <div className={classNames("h-1.5", flowToneClass(member.node.data.tone))} />
              <div className="p-2">
                <div className="flex items-center gap-1.5">
                  <span className={classNames("h-2 w-2 shrink-0 rounded-full", flowToneClass(member.node.data.tone))} />
                  <span className="min-w-0 truncate text-[11px] font-semibold text-zinc-900">
                    {member.node.data.title}
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-zinc-500">{member.node.data.packageName}</div>
                <div className="mt-1 text-[10px] font-medium text-zinc-500">
                  {member.node.data.inputs.length} in · {member.node.data.outputs.length} out
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MinimizedPortHandles({
  nodeId,
  inputs,
  outputs,
  isConnectable,
}: {
  nodeId: string;
  inputs: FlowPort[];
  outputs: FlowPort[];
  isConnectable: boolean;
}) {
  const rowCount = Math.max(inputs.length, outputs.length, 1);
  const height = Math.max(40, rowCount * 16 + 16);

  return (
    <div data-testid="workflow-minimized-ports" className="relative border-t border-zinc-100 bg-white" style={{ height }}>
      <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-between text-[10px] font-semibold uppercase text-zinc-500">
        <span>{inputs.length} in</span>
        <span>{outputs.length} out</span>
      </div>
      <MinimizedPortHandleStack nodeId={nodeId} direction="in" ports={inputs} isConnectable={isConnectable} />
      <MinimizedPortHandleStack nodeId={nodeId} direction="out" ports={outputs} isConnectable={isConnectable} />
    </div>
  );
}

function MinimizedPortHandleStack({
  nodeId,
  direction,
  ports,
  isConnectable,
}: {
  nodeId: string;
  direction: PortDirection;
  ports: FlowPort[];
  isConnectable: boolean;
}) {
  const isInput = direction === "in";
  const colors = usePortTypeColors();
  const { onOutputDoubleClick } = React.useContext(WorkflowOutputConnectorContext);

  return (
    <>
      {ports.map((port, index) => {
        const color = portTypeColor(port.type, colors);
        return (
          <Handle
            key={`${direction}-${port.id}`}
            type={isInput ? "target" : "source"}
            position={isInput ? Position.Left : Position.Right}
            id={handleId(direction, port)}
            isConnectable={isConnectable}
            onDoubleClick={
              isInput
                ? undefined
                : (event) => {
                    onOutputDoubleClick(event, nodeId, port);
                  }
            }
            className="!h-3 !w-3 !border-2 !border-white"
            style={{
              backgroundColor: color,
              left: isInput ? -7 : undefined,
              right: isInput ? undefined : -7,
              top: `${((index + 1) / (ports.length + 1)) * 100}%`,
            }}
            title={`${port.label} ${formatFlowPortType(port)}`}
          />
        );
      })}
    </>
  );
}

function PortColumn({
  nodeId,
  title,
  direction,
  ports,
  isConnectable,
}: {
  nodeId: string;
  title: string;
  direction: PortDirection;
  ports: FlowPort[];
  isConnectable: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase text-zinc-500">{title}</div>
      {ports.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-200 px-2 py-1.5 text-xs text-zinc-400">none</div>
      ) : (
        <div className="space-y-2">
          {ports.map((port) => (
            <PortRow
              key={`${nodeId}-${direction}-${port.id}`}
              nodeId={nodeId}
              direction={direction}
              port={port}
              isConnectable={isConnectable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PortRow({
  nodeId,
  direction,
  port,
  isConnectable,
}: {
  nodeId: string;
  direction: PortDirection;
  port: FlowPort;
  isConnectable: boolean;
}) {
  const isInput = direction === "in";
  const colors = usePortTypeColors();
  const { onOutputDoubleClick } = React.useContext(WorkflowOutputConnectorContext);
  const focusTarget = React.useContext(WorkflowFocusContext);
  const color = portTypeColor(port.type, colors);
  const isFocused =
    focusTarget?.nodeId === nodeId &&
    focusTarget.direction === direction &&
    focusTarget.portId === port.id &&
    focusTarget.portType === port.type;

  return (
    <div
      data-testid="workflow-port"
      data-port-direction={direction}
      data-port-label={port.label}
      className={classNames(
        "relative rounded-md border px-2 py-1.5",
        isInput ? "pl-3" : "pr-3",
        isFocused && "ring-2 ring-zinc-950 ring-offset-2",
      )}
      title={`${port.label}\n${formatWorkflowTypeSpecJson(port.valueType)}`}
      style={{
        backgroundColor: hexToRgba(color, 0.08),
        borderColor: hexToRgba(color, 0.32),
        boxShadow: `inset ${isInput ? "3px" : "-3px"} 0 0 ${color}`,
      }}
    >
      <Handle
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        id={handleId(direction, port)}
        isConnectable={isConnectable}
        onDoubleClick={
          isInput
            ? undefined
            : (event) => {
                onOutputDoubleClick(event, nodeId, port);
              }
        }
        className="!h-3 !w-3 !border-2 !border-white"
        style={{
          backgroundColor: color,
          left: isInput ? -7 : undefined,
          right: isInput ? undefined : -7,
          top: "50%",
        }}
      />
      <div className={classNames("flex flex-col gap-1", isInput ? "items-start" : "items-end text-right")}>
        <span className="text-xs font-medium text-zinc-800">{port.label}</span>
        <span className={classNames("flex flex-wrap gap-1", isInput ? "justify-start" : "justify-end")}>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{
              backgroundColor: hexToRgba(color, 0.16),
              color: portTypeBadgeTextColor(color),
            }}
          >
            {formatFlowPortType(port)}
          </span>
          {portIsStream(port) && (
            <span className="rounded bg-zinc-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
              stream
            </span>
          )}
          {port.optional && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
              optional
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
