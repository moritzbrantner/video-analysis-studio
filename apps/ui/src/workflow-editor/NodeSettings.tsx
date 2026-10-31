import { type Edge } from "@xyflow/react";
import { dataSourceKindLabel } from "../data-sources/types";
import { type TypeDefinition } from "../type-library/page";
import { formatWorkflowTypeSpec } from "../workflowTypeSpec";
import type { DataSourceEntry } from "../run/types";
import { Field, Metric } from "../shared/controls";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PlusIcon } from "../shared/icons";
import { classNames } from "../shared/utils";
import {
  adapterOperationDefinitions,
  adapterOperationTemplate,
  createAdapterTransformStep,
  moveAdapterTransformStep,
  normalizeAdapterTransformSteps,
} from "./adapterTransforms";
import { dataSourceOutputPort } from "./dataSourceNodes";
import {
  normalizeDataSourceSchema,
  workflowTypeForPortType,
  workflowTypeToPortType,
} from "./dataSourceSchema";
import { DataSourceSchemaEditor } from "./DataSourceSchemaEditor";
import { findPort, formatFlowPortType, portsCompatible } from "./ports";
import { formatPortType } from "./portTypes";
import type {
  AdapterOperationKind,
  AdapterTransformStep,
  DataSourceSchema,
  FlowPort,
  WorkflowNodeModel,
} from "./types";

export function DataSourceNodeSettings({
  node,
  nodes,
  edges,
  dataSources,
  onSelectDataSource,
}: {
  node: WorkflowNodeModel;
  nodes: WorkflowNodeModel[];
  edges: Edge[];
  dataSources: DataSourceEntry[];
  onSelectDataSource: (nodeId: string, dataSourceId: string | null) => void;
}) {
  const selectedDataSource =
    typeof node.data.dataSourceId === "string"
      ? dataSources.find((entry) => entry.id === node.data.dataSourceId) ?? null
      : null;
  const selectedTypeSpec = selectedDataSource?.type ?? workflowTypeForPortType(node.data.dataSourceType ?? "data_value");
  const selectedType = workflowTypeToPortType(selectedTypeSpec, node.data.dataSourceType ?? "data_value");
  const sortedDataSources = [...dataSources].sort((left, right) => left.id.localeCompare(right.id));
  const previewOutput = dataSourceOutputPort(selectedDataSource, selectedType);
  const downstreamPorts = edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => findPort(nodes, edge.target, edge.targetHandle, "in"))
    .filter((portValue): portValue is FlowPort => Boolean(portValue));
  const downstreamCompatible = downstreamPorts.every((targetPort) => portsCompatible(previewOutput, targetPort));

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <Field label="Data source ID">
        <select
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={selectedDataSource?.id ?? ""}
          onChange={(event) => onSelectDataSource(node.id, event.target.value || null)}
        >
          <option value="">Unselected</option>
          {sortedDataSources.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.id}
            </option>
          ))}
        </select>
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Type" value={formatWorkflowTypeSpec(selectedTypeSpec)} />
        <Metric label="Output" value={formatPortType(selectedType)} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2">
        <Metric label="Kind" value={selectedDataSource ? dataSourceKindLabel(selectedDataSource.kind) : "none"} />
      </div>
      {downstreamPorts.length > 0 && (
        <div
          className={classNames(
            "mt-3 rounded-md border px-3 py-2 text-xs font-medium",
            downstreamCompatible
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          Downstream compatibility: {downstreamCompatible ? "compatible" : "incompatible"}
        </div>
      )}
      {selectedDataSource && (
        <div className="mt-3 space-y-1 text-xs text-zinc-600">
          <div className="truncate font-medium text-zinc-900" title={selectedDataSource.name}>
            {selectedDataSource.name}
          </div>
          <div className="truncate" title={selectedDataSource.location}>
            {selectedDataSource.location || "No location set"}
          </div>
          <div>
            {selectedDataSource.body.length} body chars · {selectedDataSource.tags.length} tags
          </div>
          <a className="inline-flex text-xs font-medium text-zinc-900 underline" href="/data-sources">
            Open in data sources
          </a>
        </div>
      )}
    </div>
  );
}

export function AdapterNodeSettings({
  node,
  typeDefinitions,
  onChange,
}: {
  node: WorkflowNodeModel;
  typeDefinitions: TypeDefinition[];
  onChange: (
    nodeId: string,
    inputSchema: DataSourceSchema,
    outputSchema: DataSourceSchema,
    steps: AdapterTransformStep[],
  ) => void;
}) {
  const inputSchema = normalizeDataSourceSchema(node.data.adapterInputSchema, { type: "any" });
  const outputSchema = normalizeDataSourceSchema(node.data.adapterOutputSchema, { type: "any" });
  const steps = normalizeAdapterTransformSteps(node.data.adapterSteps);
  const inputPort = node.data.inputs[0];
  const outputPort = node.data.outputs[0];
  const updateSteps = (nextSteps: AdapterTransformStep[]) => onChange(node.id, inputSchema, outputSchema, nextSteps);

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div>
        <div className="text-xs font-semibold uppercase text-zinc-500">Adapter</div>
        <p className="mt-1 text-xs leading-5 text-zinc-600">
          Define the contract this node accepts and the contract it emits after rearranging the payload.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Input port" value={inputPort ? formatFlowPortType(inputPort) : "none"} />
        <Metric label="Output port" value={outputPort ? formatFlowPortType(outputPort) : "none"} />
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase text-zinc-500">Input contract</div>
        <DataSourceSchemaEditor
          schema={inputSchema}
          typeDefinitions={typeDefinitions}
          onChange={(nextInputSchema) => onChange(node.id, nextInputSchema, outputSchema, steps)}
        />
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase text-zinc-500">Output contract</div>
        <DataSourceSchemaEditor
          schema={outputSchema}
          typeDefinitions={typeDefinitions}
          onChange={(nextOutputSchema) => onChange(node.id, inputSchema, nextOutputSchema, steps)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase text-zinc-500">Conversion pipeline</div>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => updateSteps([...steps, createAdapterTransformStep("map")])}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Add Step
          </button>
        </div>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <AdapterTransformStepEditor
              key={step.id}
              step={step}
              index={index}
              canMoveUp={index > 0}
              canMoveDown={index < steps.length - 1}
              canRemove={steps.length > 1}
              onChange={(nextStep) =>
                updateSteps(steps.map((candidate) => (candidate.id === step.id ? nextStep : candidate)))
              }
              onMoveUp={() => updateSteps(moveAdapterTransformStep(steps, index, index - 1))}
              onMoveDown={() => updateSteps(moveAdapterTransformStep(steps, index, index + 1))}
              onRemove={() => updateSteps(steps.filter((candidate) => candidate.id !== step.id))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AdapterTransformStepEditor({
  step,
  index,
  canMoveUp,
  canMoveDown,
  canRemove,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: AdapterTransformStep;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onChange: (step: AdapterTransformStep) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const operation = adapterOperationDefinitions.find((definition) => definition.kind === step.operation) ?? adapterOperationDefinitions[0];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label={`Step ${index + 1}`}>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={step.operation}
            onChange={(event) => {
              const nextOperation = event.target.value as AdapterOperationKind;
              onChange({ ...step, operation: nextOperation, expression: adapterOperationTemplate(nextOperation) });
            }}
          >
            {adapterOperationDefinitions.map((definition) => (
              <option key={definition.kind} value={definition.kind}>
                {definition.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-1">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Move step up"
            aria-label="Move step up"
          >
            <ChevronUpIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Move step down"
            aria-label="Move step down"
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            onClick={onRemove}
            disabled={!canRemove}
            title="Remove step"
            aria-label="Remove step"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{operation.detail}</p>
      <textarea
        className="mt-3 min-h-24 w-full resize-y rounded-lg border border-zinc-300 bg-zinc-950 px-3 py-2 font-mono text-xs leading-5 text-zinc-50 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        value={step.expression}
        spellCheck={false}
        onChange={(event) => onChange({ ...step, expression: event.target.value })}
      />
    </div>
  );
}
