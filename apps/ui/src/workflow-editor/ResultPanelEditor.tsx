import { useState, useEffect } from "react";
import {
  dashboardWidgetOptionsForReportKind,
  dashboardWidgetIdsForLayout,
  type DashboardWidgetId,
  type DashboardDataKind,
  dashboardWidgetLabel,
} from "../ResultPageEditor";
import { type TypeDefinition } from "../type-library/page";
import type { DataSourceEntry, WorkflowKindId } from "../run/types";
import { Field } from "../shared/controls";
import { CloseIcon, RefreshIcon } from "../shared/icons";
import { formatPortType } from "./portTypes";
import {
  defaultReportPathForDataKind,
  defaultResultPanelBinding,
  defaultWorkflowResultPanel,
  normalizeWorkflowResultPanel,
  resultDataKindPortType,
  resultPanelBindingFromSource,
  resultPanelBindingKey,
  resultPanelBindingSummaries,
  resultPanelLayoutFromWidgetIds,
  resultPanelSourceOptions,
  workflowReportKind,
} from "./resultPanels";
import type { ResultPanelSourceBinding, WorkflowNodeModel, WorkflowResultPanel } from "./types";

export function WorkflowResultPanelEditor({
  workflowKind,
  panel,
  nodes,
  dataSources,
  typeDefinitions,
  onChange,
}: {
  workflowKind: WorkflowKindId;
  panel: WorkflowResultPanel;
  nodes: WorkflowNodeModel[];
  dataSources: DataSourceEntry[];
  typeDefinitions: TypeDefinition[];
  onChange: (panel: WorkflowResultPanel) => void;
}) {
  const reportKind = workflowReportKind(workflowKind);
  const options = dashboardWidgetOptionsForReportKind(reportKind);
  const componentIds = dashboardWidgetIdsForLayout(panel.layout);
  const availableOptions = options.filter((option) => !componentIds.includes(option.id));
  const [componentDraft, setComponentDraft] = useState<DashboardWidgetId>(availableOptions[0]?.id ?? options[0]?.id ?? "summary");
  const bindingSummaries = resultPanelBindingSummaries(panel, nodes, dataSources, typeDefinitions);

  useEffect(() => {
    const nextOption = availableOptions[0]?.id ?? options[0]?.id;
    if (nextOption && !availableOptions.some((option) => option.id === componentDraft)) {
      setComponentDraft(nextOption);
    }
  }, [availableOptions, componentDraft, options]);

  const updatePanel = (updates: Partial<WorkflowResultPanel>) => {
    onChange(normalizeWorkflowResultPanel({ ...panel, ...updates }, workflowKind, panel.name));
  };

  const addComponent = () => {
    if (!availableOptions.some((option) => option.id === componentDraft)) {
      return;
    }
    updatePanel({ layout: resultPanelLayoutFromWidgetIds(componentIds.concat(componentDraft)) });
  };

  const removeComponent = (componentId: DashboardWidgetId) => {
    const nextIds = componentIds.filter((id) => id !== componentId);
    if (nextIds.length === 0) {
      return;
    }
    updatePanel({
      layout: resultPanelLayoutFromWidgetIds(nextIds),
      bindings: panel.bindings.filter((binding) => binding.componentId !== componentId),
    });
  };

  const setBinding = (
    componentId: DashboardWidgetId,
    dataKind: DashboardDataKind,
    binding: ResultPanelSourceBinding,
  ) => {
    updatePanel({
      bindings: panel.bindings
        .filter((candidate) => candidate.componentId !== componentId || candidate.dataKind !== dataKind)
        .concat(binding),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-zinc-500">Result Panel</div>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Attached to this workflow and opened after completed runs.
          </p>
        </div>
        <span className="shrink-0 rounded bg-white px-2 py-1 text-[11px] font-medium text-zinc-600">
          {componentIds.length} components
        </span>
      </div>
      <Field label="Panel name">
        <input
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={panel.name}
          onChange={(event) => updatePanel({ name: event.target.value })}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <select
          className="min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={componentDraft}
          onChange={(event) => setComponentDraft(event.target.value as DashboardWidgetId)}
          disabled={availableOptions.length === 0}
        >
          {availableOptions.length === 0 ? (
            <option value={componentDraft}>All components placed</option>
          ) : (
            availableOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          onClick={addComponent}
          disabled={availableOptions.length === 0}
          title="Add result component"
        >
          Add
        </button>
      </div>
      <div className="space-y-2">
        {componentIds.map((componentId) => {
          const option = options.find((candidate) => candidate.id === componentId);
          if (!option) {
            return null;
          }
          return (
            <div key={componentId} className="rounded-md border border-zinc-200 bg-white p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-xs font-semibold text-zinc-900">
                  {dashboardWidgetLabel(componentId)}
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                  onClick={() => removeComponent(componentId)}
                  disabled={componentIds.length <= 1}
                  title="Remove component"
                  aria-label="Remove component"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {option.dataKinds.map((dataKind) => (
                  <ResultPanelBindingEditor
                    key={`${componentId}-${dataKind}`}
                    componentId={componentId}
                    dataKind={dataKind}
                    binding={
                      panel.bindings.find(
                        (candidate) => candidate.componentId === componentId && candidate.dataKind === dataKind,
                      ) ?? defaultResultPanelBinding(componentId, dataKind)
                    }
                    nodes={nodes}
                    dataSources={dataSources}
                    typeDefinitions={typeDefinitions}
                    onChange={(binding) => setBinding(componentId, dataKind, binding)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {bindingSummaries.length > 0 && (
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] leading-5 text-zinc-600">
          {bindingSummaries.length} data mapping{bindingSummaries.length === 1 ? "" : "s"} defined
        </div>
      )}
      <button
        type="button"
        className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
        onClick={() => onChange(defaultWorkflowResultPanel(workflowKind, panel.name))}
        title="Reset attached result panel"
      >
        <RefreshIcon className="h-4 w-4" />
        Reset Panel
      </button>
    </div>
  );
}

function ResultPanelBindingEditor({
  componentId,
  dataKind,
  binding,
  nodes,
  dataSources,
  typeDefinitions,
  onChange,
}: {
  componentId: DashboardWidgetId;
  dataKind: DashboardDataKind;
  binding: ResultPanelSourceBinding;
  nodes: WorkflowNodeModel[];
  dataSources: DataSourceEntry[];
  typeDefinitions: TypeDefinition[];
  onChange: (binding: ResultPanelSourceBinding) => void;
}) {
  const sourceOptions = resultPanelSourceOptions(dataKind, nodes, dataSources, typeDefinitions);
  const selectedKey = resultPanelBindingKey(binding);
  const selectedSource = sourceOptions.find((option) => option.key === selectedKey) ?? sourceOptions[0];
  const reportPath = binding.reportPath ?? defaultReportPathForDataKind(dataKind);

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase text-zinc-500">{formatPortType(resultDataKindPortType(dataKind))}</div>
      <select
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        value={selectedSource.key}
        onChange={(event) => {
          const nextSource = sourceOptions.find((option) => option.key === event.target.value) ?? sourceOptions[0];
          onChange(resultPanelBindingFromSource(componentId, dataKind, nextSource, reportPath));
        }}
      >
        {sourceOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      {(selectedSource.kind === "completed_report" || binding.sourceKind === "completed_report") && (
        <input
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={reportPath}
          placeholder={defaultReportPathForDataKind(dataKind)}
          onChange={(event) =>
            onChange({
              componentId,
              dataKind,
              sourceKind: "completed_report",
              reportPath: event.target.value,
            })
          }
        />
      )}
    </div>
  );
}
