import { useState } from "react";
import {
  type CliRun,
  type StudioReport,
  CollectionManifestPreviewPanel,
  JsonReportLoader,
  CliRunPanel,
} from "../index";
import {
  type RunRecord,
  type RunEvent,
  type DataSourceRecord,
  type TranscriptionCatalog,
  getWorkflowClient,
  type WorkflowClient,
} from "../api/client";
import { useSystemDependenciesQuery } from "../api/queries";
import { RunEventTimeline, RunNodeStatusPanel } from "./RunStatus";
import type { CollectionManifestPreviewState, WorkflowKindId, WorkflowRunForm } from "./types";
import { workflowKindName } from "./workflowKinds";
import { WorkflowRunControls } from "./WorkflowRunControls";
import { Field, Metric } from "../shared/controls";
import { PlusIcon, RefreshIcon, RunIcon, SpinnerIcon, WorkflowIcon } from "../shared/icons";
import { classNames } from "../shared/utils";
import type {
  SavedWorkflow,
  SavedWorkflowLibrary,
  WorkflowRunInput,
  WorkflowRunInputModel,
} from "../workflow-editor/types";

export function RunWorkspace({
  form,
  onFormChange,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
  cliRun,
  runOutput,
  activeRunId,
  activeRunRecord,
  runEvents,
  collectionManifestPreview,
  dataSources,
  workflowLibrary,
  activeWorkflow,
  activeWorkflowInputModel,
  transcriptionCatalog,
  selectedWorkflowKind,
  onSelectWorkflow,
  onCreateWorkflow,
  onEditWorkflow,
  onFocusWorkflowInput,
  onCancelRun,
  onRetryRun,
  onOpenReport,
  onPreviewCollectionManifest,
  onCollectionManifestSelectionChange,
  onLoadReport,
}: {
  form: WorkflowRunForm;
  onFormChange: (form: WorkflowRunForm) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
  cliRun: CliRun | null;
  runOutput: { stdout?: string; stderr?: string };
  activeRunId: string | null;
  activeRunRecord: RunRecord | null;
  runEvents: RunEvent[];
  collectionManifestPreview: CollectionManifestPreviewState;
  dataSources: DataSourceRecord[];
  workflowLibrary: SavedWorkflowLibrary;
  activeWorkflow: SavedWorkflow;
  activeWorkflowInputModel: WorkflowRunInputModel;
  transcriptionCatalog: TranscriptionCatalog | null;
  selectedWorkflowKind: WorkflowKindId;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onEditWorkflow: () => void;
  onFocusWorkflowInput: (input: WorkflowRunInput) => void;
  onCancelRun: () => void;
  onRetryRun: () => void;
  onOpenReport: () => void;
  onPreviewCollectionManifest: () => void;
  onCollectionManifestSelectionChange: (selectedItemIds: string[]) => void;
  onLoadReport: (report: StudioReport) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <section className="space-y-4">
        <section className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white">
              <RunIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">New Run</h2>
              <p className="mt-1 text-xs text-zinc-500">{activeWorkflow.name}</p>
            </div>
          </div>
        </section>
        <RunWorkflowPicker
          workflowLibrary={workflowLibrary}
          activeWorkflow={activeWorkflow}
          onSelectWorkflow={onSelectWorkflow}
          onCreateWorkflow={onCreateWorkflow}
          onEditWorkflow={onEditWorkflow}
        />
        <DependencyStatusPanel />
        <WorkflowRunControls
          form={form}
          inputModel={activeWorkflowInputModel}
          transcriptionCatalog={transcriptionCatalog}
          dataSources={dataSources}
          selectedWorkflowKind={selectedWorkflowKind}
          onChange={onFormChange}
          onFocusWorkflowInput={onFocusWorkflowInput}
          onRun={onRun}
          isRunning={isRunning}
          runDisabled={runDisabled}
          validationMessage={validationMessage}
          activeRunId={activeRunId}
          activeRunRecord={activeRunRecord}
          onCancelRun={onCancelRun}
          onRetryRun={onRetryRun}
          onOpenReport={onOpenReport}
        />
        {selectedWorkflowKind === "youtube-collection" && (
          <CollectionManifestPreviewPanel
            preview={collectionManifestPreview}
            onPreview={onPreviewCollectionManifest}
            onSelectionChange={onCollectionManifestSelectionChange}
            disabled={isRunning || validationMessage !== null}
          />
        )}
        {selectedWorkflowKind === "song-analysis" && <SongCatalogImportPanel form={form} />}
        <JsonReportLoader<StudioReport> label="Load report JSON" onLoad={onLoadReport} />
      </section>
      <section className="min-w-0 space-y-4">
        <CliRunPanel run={cliRun} />
        <RunNodeStatusPanel events={runEvents} />
        <RunEventTimeline events={runEvents} stdout={runOutput.stdout} stderr={runOutput.stderr} />
      </section>
    </div>
  );
}

export function AnalysisHomePage({
  activeWorkflow,
  onStartRun,
  onEditWorkflow,
  onLoadSample,
  onLoadReport,
}: {
  activeWorkflow: SavedWorkflow;
  onStartRun: () => void;
  onEditWorkflow: () => void;
  onLoadSample: () => void;
  onLoadReport: (report: StudioReport) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-zinc-600">
          Home
        </span>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950">Start from a real run or a real report.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
          The analysis workspace stays empty until you start a workflow, load report JSON, or open a saved run. Nothing on this page represents an executed command yet.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
            onClick={onStartRun}
          >
            <RunIcon className="h-4 w-4" />
            New Run
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onEditWorkflow}
          >
            <WorkflowIcon className="h-4 w-4" />
            Edit Workflow
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onLoadSample}
          >
            <RefreshIcon className="h-4 w-4" />
            Load Sample
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Selected Workflow</div>
            <div className="mt-2 text-lg font-semibold text-zinc-950">{activeWorkflow.name}</div>
            <div className="mt-1 text-sm text-zinc-500">
              {workflowKindName(activeWorkflow.kind)} · v{activeWorkflow.version}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Saved Runs</div>
            <div className="mt-2 text-sm leading-6 text-zinc-600">
              Open any run from the left sidebar to restore its inputs, status, and backend events.
            </div>
          </div>
        </div>
      </section>
      <section className="space-y-4">
        <JsonReportLoader<StudioReport> label="Load report JSON" onLoad={onLoadReport} />
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-950">What appears here</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            CLI output only appears after you run a workflow. Report dashboards only appear after a report is loaded or generated.
          </p>
        </section>
      </section>
    </div>
  );
}

function SongCatalogImportPanel({ form }: { form: WorkflowRunForm }) {
  const [path, setPath] = useState(form.input);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function importSong() {
    if (!path.trim() || !title.trim()) {
      setMessage("Enter a local file and title.");
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      const client = getWorkflowClient();
      const result = await client.importSongCatalogItems({
        catalog_db_path: form.songCatalogPath.trim() || null,
        items: [
          {
            source: { kind: "local_file", path: path.trim() },
            metadata: {
              title: title.trim(),
              artist: artist.trim() || null,
              album: null,
              isrc: null,
              source_uri: null,
            },
          },
        ],
      });
      const first = result.results[0];
      setMessage(first?.status === "imported" ? `Imported ${first.title}` : first?.message ?? "Import failed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Catalog Import</h2>
      </div>
      <div className="space-y-3 p-4">
        <Field label="Local song file">
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Artist">
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
            />
          </Field>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          disabled={importing}
          onClick={importSong}
        >
          {importing ? <SpinnerIcon className="h-4 w-4" /> : <WorkflowIcon className="h-4 w-4" />}
          {importing ? "Importing" : "Import Song"}
        </button>
        {message && <p className="text-sm text-zinc-600">{message}</p>}
      </div>
    </section>
  );
}

function RunWorkflowPicker({
  workflowLibrary,
  activeWorkflow,
  onSelectWorkflow,
  onCreateWorkflow,
  onEditWorkflow,
}: {
  workflowLibrary: SavedWorkflowLibrary;
  activeWorkflow: SavedWorkflow;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onEditWorkflow: () => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Workflow</h2>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onCreateWorkflow}
            title="Create workflow"
          >
            <PlusIcon className="h-4 w-4" />
            New Workflow
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onEditWorkflow}
            title="Edit workflow"
          >
            <WorkflowIcon className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <Field label="Selected workflow">
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={activeWorkflow.id}
            onChange={(event) => onSelectWorkflow(event.target.value)}
          >
            {workflowLibrary.workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600">
          <Metric label="Version" value={`v${activeWorkflow.version}`} />
          <Metric label="Components" value={String(activeWorkflow.nodes.length)} />
        </div>
      </div>
    </section>
  );
}

export function fetchWorkflowReport(
  client: WorkflowClient,
  runId: string,
  workflowKind: WorkflowKindId,
): Promise<StudioReport> {
  if (workflowKind === "youtube-collection") {
    return client.getYoutubeCollectionReport(runId);
  }
  if (workflowKind === "video-red-cars") {
    return client.getVideoRedCarsReport(runId);
  }
  if (workflowKind === "subtitle-generation") {
    return client.getSubtitleGenerationReport(runId);
  }
  if (workflowKind === "song-analysis") {
    return client.getSongAnalysisReport(runId);
  }
  return client.getYoutubeVideoReport(runId);
}

function DependencyStatusPanel() {
  const { data: report, error } = useSystemDependenciesQuery();
  const message = error ? error.message : null;

  const dependencies = report?.dependencies ?? [];
  const requiredMissing = dependencies.filter((dependency) => dependency.required && !dependency.available).length;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Dependencies</h2>
        <span
          className={classNames(
            "rounded-md border px-2 py-1 text-xs font-medium",
            requiredMissing > 0
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {requiredMissing > 0 ? `${requiredMissing} missing` : "ready"}
        </span>
      </div>
      <div className="space-y-2 p-4">
        {message && <p className="text-sm text-rose-700">{message}</p>}
        {!message && dependencies.length === 0 && <p className="text-sm text-zinc-500">Checking...</p>}
        {dependencies.map((dependency) => (
          <div key={dependency.name} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <div className="font-medium text-zinc-900">{dependency.name}</div>
              <div className="mt-0.5 break-all text-xs text-zinc-500">
                {dependency.resolved_path ?? dependency.message ?? "not found"}
              </div>
            </div>
            <span
              className={classNames(
                "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                dependency.available
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : dependency.required
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-amber-200 bg-amber-50 text-amber-800",
              )}
            >
              {dependency.available ? "found" : dependency.required ? "required" : "optional"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
