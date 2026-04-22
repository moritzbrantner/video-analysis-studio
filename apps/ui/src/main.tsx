import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeResizer,
  Panel as FlowPanel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  AssetSummary,
  CapabilityPanel,
  CliRunPanel,
  DataBucketOverview,
  EventList,
  JsonReportLoader,
  ModelObservationGrid,
  ObservationList,
  ScenePanel,
  SourceSummary,
  SplitPlanTable,
  TranscriptPanel,
  VideoSummaryCards,
  type CliRun,
  type YoutubeVideoReport,
} from "./index";

import "./index.css";
import "@xyflow/react/dist/style.css";
import { sampleReport } from "./sampleReport";
import {
  ResultPageEditor,
  defaultDashboardLayout,
  type DashboardLayout,
} from "./ResultPageEditor";
import {
  getWorkflowClient,
  waitForRunCompletion,
  type RunRecord,
  type RunStatus,
  type SystemDependencyReport,
  type YoutubeRunRequest,
} from "./api/client";

type UseCaseId = "youtube-video";
type SourceMode = "url" | "file";
type AppPage = "analysis" | "workflow" | "settings";
type ViewMode = "overview" | "run" | "result" | "scenes" | "signals" | "data";

interface UseCaseForm {
  sourceMode: SourceMode;
  url: string;
  input: string;
  output: string;
  workDir: string;
  sceneThreshold: number;
  minSceneLen: number;
  maxFrames: string;
  visualSampleEvery: number;
  skipTranscription: boolean;
  objectCommand: string;
  ocrCommand: string;
  textCommand: string;
  workflowInputs: Record<string, string>;
}

const useCases: Array<{
  id: UseCaseId;
  name: string;
  packageName: string;
  status: string;
}> = [
  {
    id: "youtube-video",
    name: "YouTube Video",
    packageName: "studio-core",
    status: "Ready",
  },
];

const initialForm: UseCaseForm = {
  sourceMode: "url",
  url: "",
  input: "./video.mp4",
  output: "use-case-output/youtube-video/analysis.json",
  workDir: "use-case-output/youtube-video",
  sceneThreshold: 27,
  minSceneLen: 15,
  maxFrames: "",
  visualSampleEvery: 30,
  skipTranscription: false,
  objectCommand: "",
  ocrCommand: "",
  textCommand: "",
  workflowInputs: {},
};

const mainSidebarCollapsedStorageKey = "video-analysis.mainSidebarCollapsed.v1";

function App() {
  const [selectedUseCase, setSelectedUseCase] = useState<UseCaseId>("youtube-video");
  const [form, setForm] = useState<UseCaseForm>(initialForm);
  const [report, setReport] = useState<YoutubeVideoReport>(sampleReport);
  const [page, setPage] = useState<AppPage>(() =>
    typeof window === "undefined" ? "analysis" : appPageFromPath(window.location.pathname),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [runStatus, setRunStatus] = useState<CliRun["status"]>("pending");
  const [lastRun, setLastRun] = useState<CliRun | null>(null);
  const [runOutput, setRunOutput] = useState<{ stdout?: string; stderr?: string }>({});
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(defaultDashboardLayout);
  const [workflowLibrary, setWorkflowLibrary] = useState<SavedWorkflowLibrary>(loadSavedWorkflowLibrary);
  const [workflowRuns, setWorkflowRuns] = useState<SavedWorkflowRun[]>(loadSavedWorkflowRuns);
  const [portTypeColors, setPortTypeColors] = useState<PortTypeColors>(loadPortTypeColors);
  const [hotkeyBindings, setHotkeyBindings] = useState<HotkeyBindings>(loadHotkeyBindings);
  const [mainSidebarCollapsed, setMainSidebarCollapsed] = useState(() =>
    loadStoredBoolean(mainSidebarCollapsedStorageKey, false),
  );

  const activeWorkflow = useMemo(() => activeSavedWorkflow(workflowLibrary), [workflowLibrary]);
  const activeWorkflowInputModel = useMemo(() => deriveWorkflowRunInputModel(activeWorkflow), [activeWorkflow]);
  const command = useMemo(() => buildCommand(form, activeWorkflowInputModel), [form, activeWorkflowInputModel]);
  const validationMessage = getRunValidation(form, activeWorkflowInputModel);
  const cliRun: CliRun =
    lastRun ?? {
      command: "studio-api",
      args: [activeWorkflow.name, "youtube-video"],
      status: runStatus,
      exit_code: runStatus === "succeeded" ? 0 : null,
      output_files: [form.output],
      message:
        runStatus === "running"
          ? `Running ${activeWorkflow.name}`
          : selectedUseCase === "youtube-video"
            ? activeWorkflow.name
            : null,
    };

  useEffect(() => {
    persistStoredBoolean(mainSidebarCollapsedStorageKey, mainSidebarCollapsed);
  }, [mainSidebarCollapsed]);

  useEffect(() => {
    persistPortTypeColors(portTypeColors);
  }, [portTypeColors]);

  useEffect(() => {
    persistHotkeyBindings(hotkeyBindings);
  }, [hotkeyBindings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onPopState = () => setPage(appPageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToPage = useCallback((nextPage: AppPage) => {
    setPage(nextPage);
    if (typeof window === "undefined") {
      return;
    }
    const nextPath = pathForAppPage(nextPage);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
  }, []);

  const commitWorkflowLibrary = useCallback((library: SavedWorkflowLibrary) => {
    persistSavedWorkflowLibrary(library);
    setWorkflowLibrary(library);
  }, []);

  const activateWorkflowDefinition = useCallback(
    (workflowId: string) => {
      if (!workflowLibrary.workflows.some((workflow) => workflow.id === workflowId)) {
        return;
      }
      commitWorkflowLibrary({ ...workflowLibrary, activeWorkflowId: workflowId });
    },
    [commitWorkflowLibrary, workflowLibrary],
  );

  const selectWorkflowDefinition = useCallback(
    (workflowId: string) => {
      activateWorkflowDefinition(workflowId);
      navigateToPage("workflow");
    },
    [activateWorkflowDefinition, navigateToPage],
  );

  const createWorkflowDefinition = useCallback(() => {
    const workflow = createBlankSavedWorkflow();
    commitWorkflowLibrary({
      ...workflowLibrary,
      activeWorkflowId: workflow.id,
      workflows: [workflow, ...workflowLibrary.workflows],
    });
    navigateToPage("workflow");
  }, [commitWorkflowLibrary, navigateToPage, workflowLibrary]);

  const startNewWorkflowRun = useCallback(() => {
    setForm(initialForm);
    setRunStatus("pending");
    setLastRun(null);
    setRunOutput({});
    navigateToPage("analysis");
    setViewMode("run");
  }, [navigateToPage]);

  const deleteWorkflowDefinition = useCallback(
    (workflowId: string) => {
      const workflow = workflowLibrary.workflows.find((candidate) => candidate.id === workflowId);
      if (!workflow) {
        return;
      }
      if (typeof window !== "undefined" && !window.confirm(`Delete workflow "${workflow.name}"?`)) {
        return;
      }

      const remainingWorkflows = workflowLibrary.workflows.filter((candidate) => candidate.id !== workflowId);
      const nextActiveWorkflow =
        workflowLibrary.activeWorkflowId === workflowId
          ? (remainingWorkflows[0] ?? createBlankSavedWorkflow())
          : activeWorkflow;
      const nextWorkflows = remainingWorkflows.length === 0 ? [nextActiveWorkflow] : remainingWorkflows;
      commitWorkflowLibrary({
        ...workflowLibrary,
        activeWorkflowId: nextActiveWorkflow.id,
        workflows: nextWorkflows,
      });
      navigateToPage("workflow");
    },
    [activeWorkflow, commitWorkflowLibrary, navigateToPage, workflowLibrary],
  );

  const commitWorkflowRuns = useCallback((runs: SavedWorkflowRun[]) => {
    const nextRuns = runs.slice(0, 50);
    persistSavedWorkflowRuns(nextRuns);
    setWorkflowRuns(nextRuns);
  }, []);

  const addWorkflowRun = useCallback(
    (run: SavedWorkflowRun) => {
      commitWorkflowRuns([run, ...workflowRuns]);
    },
    [commitWorkflowRuns, workflowRuns],
  );

  const updateWorkflowRun = useCallback(
    (runId: string, update: (run: SavedWorkflowRun) => SavedWorkflowRun) => {
      setWorkflowRuns((currentRuns) => {
        const nextRuns = currentRuns.map((run) => (run.id === runId ? update(run) : run)).slice(0, 50);
        persistSavedWorkflowRuns(nextRuns);
        return nextRuns;
      });
    },
    [],
  );

  const openWorkflowRun = useCallback(
    (run: SavedWorkflowRun) => {
      activateWorkflowDefinition(run.workflowId);
      setForm(formFromYoutubeRunRequest(run.request));
      setRunStatus(run.status);
      setLastRun(workflowRunToCliRun(run));
      setRunOutput({});
      navigateToPage("analysis");
      setViewMode("run");
    },
    [activateWorkflowDefinition, navigateToPage],
  );

  async function runAnalysis() {
    const message = getRunValidation(form, activeWorkflowInputModel);
    if (message) {
      setRunStatus("failed");
      setLastRun({
        command: "studio-api",
        args: [activeWorkflow.name, "youtube-video"],
        status: "failed",
        exit_code: null,
        output_files: [form.output],
        message,
      });
      return;
    }

    setRunStatus("running");
    const request = buildYoutubeRunRequest(form, activeWorkflowInputModel);
    const localRun = createSavedWorkflowRun(activeWorkflow, request, workflowInputSummaryFromForm(form, activeWorkflowInputModel));
    addWorkflowRun(localRun);
    setLastRun({
      command: "studio-api",
      args: [activeWorkflow.name, "youtube-video"],
      status: "running",
      exit_code: null,
      output_files: [form.output],
      message: `Starting ${activeWorkflow.name}`,
    });
    setRunOutput({});

    try {
      const client = getWorkflowClient();
      const started = await client.startYoutubeVideoRun(request);
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, started));
      setLastRun(runRecordToCliRun(started, client.label, activeWorkflow.name));

      const finalRun = await waitForRunCompletion(
        client,
        started.run_id,
        (run) => {
          setRunStatus(run.status);
          updateWorkflowRun(localRun.id, (currentRun) => workflowRunFromRunRecord(currentRun, run));
          setLastRun(runRecordToCliRun(run, client.label, activeWorkflow.name));
        },
        (event) => setRunOutput({ stdout: event.message }),
      );

      if (finalRun.status !== "succeeded") {
        setRunStatus("failed");
        updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
        setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
        return;
      }

      setReport(await client.getReport(finalRun.run_id));
      setRunStatus("succeeded");
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
      setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
      setViewMode("overview");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunStatus("failed");
      updateWorkflowRun(localRun.id, (run) => ({
        ...run,
        status: "failed",
        updatedAt: new Date().toISOString(),
        message,
      }));
      setLastRun({
        command: "studio-api",
        args: [activeWorkflow.name, "youtube-video"],
        status: "failed",
        exit_code: null,
        output_files: [form.output],
        message,
      });
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div
        className={classNames(
          "grid min-h-screen",
          mainSidebarCollapsed ? "lg:grid-cols-[64px_1fr]" : "lg:grid-cols-[280px_1fr]",
        )}
      >
        <aside className="border-b border-zinc-200 bg-white lg:border-b-0 lg:border-r">
          <div className={classNames("sticky top-0 flex flex-col gap-5 p-4", mainSidebarCollapsed && "items-center px-2")}>
            <div className={classNames("flex w-full items-start justify-between gap-3", mainSidebarCollapsed && "justify-center")}>
              {!mainSidebarCollapsed && (
                <div>
                  <div className="text-lg font-semibold tracking-normal">Video Analysis Studio</div>
                  <div className="mt-1 text-sm text-zinc-500">Use cases and reports</div>
                </div>
              )}
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
                onClick={() => setMainSidebarCollapsed((collapsed) => !collapsed)}
                title={mainSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={mainSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {mainSidebarCollapsed ? (
                  <PanelExpandIcon className="h-4 w-4" />
                ) : (
                  <PanelCollapseIcon className="h-4 w-4" />
                )}
              </button>
            </div>
            <nav className="space-y-2">
              <button
                type="button"
                className={classNames(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                  mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                  page === "analysis"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("analysis")}
                title="Analysis"
                aria-label="Analysis"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Analysis</span>
                    <span className="block text-xs opacity-70">Reports and runs</span>
                  </span>
                )}
                <RunIcon className="h-4 w-4 shrink-0" />
              </button>
              <button
                type="button"
                className={classNames(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                  mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                  page === "workflow"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("workflow")}
                title="Workflow"
                aria-label="Workflow"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Workflow</span>
                    <span className="block text-xs opacity-70">Builder</span>
                  </span>
                )}
                <WorkflowIcon className="h-4 w-4 shrink-0" />
              </button>
              <button
                type="button"
                className={classNames(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                  mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                  page === "settings"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("settings")}
                title="Settings"
                aria-label="Settings"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Settings</span>
                    <span className="block text-xs opacity-70">Hotkeys and colors</span>
                  </span>
                )}
                <SettingsIcon className="h-4 w-4 shrink-0" />
              </button>
              {useCases.map((useCase) => (
                <button
                  key={useCase.id}
                  className={classNames(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                    mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                    page === "analysis" && selectedUseCase === useCase.id
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                  )}
                  onClick={() => {
                    setSelectedUseCase(useCase.id);
                    navigateToPage("analysis");
                  }}
                  title={useCase.name}
                  aria-label={useCase.name}
                >
                  {!mainSidebarCollapsed && (
                    <span>
                      <span className="block text-sm font-medium">{useCase.name}</span>
                      <span className="block text-xs opacity-70">{useCase.packageName}</span>
                    </span>
                  )}
                  <PlayIcon className="h-4 w-4 shrink-0" />
                </button>
              ))}
            </nav>
            <div className="space-y-3">
              <div className={classNames("flex items-center justify-between gap-2", mainSidebarCollapsed && "justify-center")}>
                {!mainSidebarCollapsed && (
                  <div className="text-xs font-semibold uppercase text-zinc-500">Workflows</div>
                )}
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  onClick={createWorkflowDefinition}
                  title="Create workflow"
                  aria-label="Create workflow"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                {workflowLibrary.workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    className={classNames(
                      "group flex items-center rounded-lg border transition",
                      workflow.id === activeWorkflow.id && page === "workflow"
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                    )}
                  >
                    <button
                      type="button"
                      className={classNames(
                        "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left",
                        mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                      )}
                      onClick={() => selectWorkflowDefinition(workflow.id)}
                      title={workflow.name}
                      aria-label={`Edit ${workflow.name}`}
                    >
                      <WorkflowIcon className="h-4 w-4 shrink-0" />
                      {!mainSidebarCollapsed && (
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">{workflow.name}</span>
                          <span className="block text-[10px] opacity-70">
                            v{workflow.version} · {workflow.nodes.length} components, {workflow.edges.length} connections
                          </span>
                        </span>
                      )}
                    </button>
                    {!mainSidebarCollapsed && (
                      <button
                        type="button"
                        className={classNames(
                          "mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-75 hover:opacity-100",
                          workflow.id === activeWorkflow.id && page === "workflow"
                            ? "text-white hover:bg-white/10"
                            : "text-rose-700 hover:bg-rose-50",
                        )}
                        onClick={() => deleteWorkflowDefinition(workflow.id)}
                        title={`Delete ${workflow.name}`}
                        aria-label={`Delete ${workflow.name}`}
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className={classNames("flex items-center justify-between gap-2", mainSidebarCollapsed && "justify-center")}>
                {!mainSidebarCollapsed && <div className="text-xs font-semibold uppercase text-zinc-500">Runs</div>}
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                  onClick={startNewWorkflowRun}
                  title="Create run"
                  aria-label="Create run"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                {workflowRuns.length === 0 ? (
                  !mainSidebarCollapsed && (
                    <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">
                      No workflow runs
                    </div>
                  )
                ) : (
                  workflowRuns.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={classNames(
                        "flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                        mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                      )}
                      onClick={() => {
                        openWorkflowRun(run);
                      }}
                      title={`${run.workflowName}: ${run.inputSummary}`}
                      aria-label={`${run.workflowName} run ${run.status}`}
                    >
                      <RunIcon className={classNames("h-4 w-4 shrink-0", runStatusClass(run.status))} />
                      {!mainSidebarCollapsed && (
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">{run.workflowName}</span>
                          <span className="block truncate text-[10px] text-zinc-500">
                            {run.status} · {run.workflowVersion ? `v${run.workflowVersion} · ` : ""}{run.inputSummary}
                          </span>
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
            {!mainSidebarCollapsed && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <img
                  src="/goldeneye-stats.png"
                  alt="Scene metrics preview"
                  className="aspect-[16/9] w-full rounded-md object-cover"
                />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600">
                  <Metric label="Scenes" value={String(report.video.scenes.length)} />
                  <Metric label="Frames" value={String(report.video.frames_processed)} />
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <header className="border-b border-zinc-200 bg-white">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 xl:px-8">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">
                    {page === "workflow"
                      ? "Workflow Builder"
                      : page === "settings"
                        ? "Settings"
                        : currentUseCase(selectedUseCase).name}
                  </h1>
                  <p className="mt-1 text-sm text-zinc-500">
                    {page === "workflow"
                      ? activeWorkflow.name
                      : page === "settings"
                        ? "Hotkeys and workflow type colors"
                        : report.source.local_video}
                  </p>
                </div>
                {page === "analysis" && (
                  <div className="flex flex-wrap gap-2">
                    <IconButton
                      icon={<RefreshIcon className="h-4 w-4" />}
                      label="Sample"
                      onClick={() => {
                        setReport(sampleReport);
                        setRunStatus("succeeded");
                        setLastRun({
                          command: "cargo",
                          args: command.slice(1),
                          status: "succeeded",
                          exit_code: 0,
                          output_files: [form.output],
                          message: "sample report loaded",
                        });
                        setRunOutput({});
                      }}
                    />
                    <IconButton
                      icon={<DownloadIcon className="h-4 w-4" />}
                      label="JSON"
                      onClick={() => downloadReport(report)}
                    />
                  </div>
                )}
              </div>
              {page === "analysis" && (
                <SegmentedControl<ViewMode>
                  value={viewMode}
                  options={[
                    ["overview", "Overview"],
                    ["run", "New Run"],
                    ["result", "Result"],
                    ["scenes", "Scenes"],
                    ["signals", "Signals"],
                    ["data", "Data"],
                  ]}
                  onChange={setViewMode}
                />
              )}
            </div>
          </header>

          <div className={classNames("mx-auto px-4 py-5 sm:px-6 xl:px-8", page === "workflow" ? "max-w-none" : "max-w-7xl")}>
            {page === "workflow" ? (
              <WorkflowBuilder
                workflowLibrary={workflowLibrary}
                onWorkflowLibraryChange={setWorkflowLibrary}
                portTypeColors={portTypeColors}
                hotkeyBindings={hotkeyBindings}
              />
            ) : page === "settings" ? (
              <SettingsPage
                portTypeColors={portTypeColors}
                onPortTypeColorChange={(type, color) =>
                  setPortTypeColors((currentColors) => ({
                    ...currentColors,
                    [type]: color,
                  }))
                }
                onResetPortTypeColors={() => setPortTypeColors(defaultPortTypeColors)}
                hotkeyBindings={hotkeyBindings}
                onHotkeyChange={(actionId, binding) =>
                  setHotkeyBindings((currentBindings) => ({
                    ...currentBindings,
                    [actionId]: binding,
                  }))
                }
                onResetHotkeys={() => setHotkeyBindings(defaultHotkeyBindings)}
              />
            ) : viewMode === "run" ? (
              <RunWorkspace
                form={form}
                onFormChange={(next) => {
                  setForm(next);
                  setRunStatus("pending");
                  setLastRun(null);
                  setRunOutput({});
                }}
                onRun={runAnalysis}
                isRunning={runStatus === "running"}
                runDisabled={runStatus === "running" || validationMessage !== null}
                validationMessage={validationMessage}
                cliRun={cliRun}
                runOutput={runOutput}
                workflowLibrary={workflowLibrary}
                activeWorkflow={activeWorkflow}
                activeWorkflowInputModel={activeWorkflowInputModel}
                onSelectWorkflow={activateWorkflowDefinition}
                onCreateWorkflow={createWorkflowDefinition}
                onEditWorkflow={() => navigateToPage("workflow")}
                onLoadReport={(nextReport) => {
                  setReport(nextReport);
                  setRunStatus("succeeded");
                  setLastRun({
                    command: "cargo",
                    args: command.slice(1),
                    status: "succeeded",
                    exit_code: 0,
                    output_files: [form.output],
                    message: "report JSON loaded",
                  });
                  setRunOutput({});
                }}
              />
            ) : (
              <section className="min-w-0 space-y-4">
                {viewMode === "overview" && <Overview report={report} />}
                {viewMode === "result" && (
                  <ResultPageEditor report={report} layout={dashboardLayout} onLayoutChange={setDashboardLayout} />
                )}
                {viewMode === "scenes" && <Scenes report={report} />}
                {viewMode === "signals" && <Signals report={report} />}
                {viewMode === "data" && <Data report={report} />}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Overview({ report }: { report: YoutubeVideoReport }) {
  return (
    <>
      <VideoSummaryCards video={report.video} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <SourceSummary source={report.source} />
        <AssetSummary assets={report.assets} />
      </div>
      <CapabilityPanel capabilities={report.capabilities} />
      <ScenePanel scenes={report.video.scenes} />
    </>
  );
}

function Scenes({ report }: { report: YoutubeVideoReport }) {
  return (
    <>
      <ScenePanel scenes={report.video.scenes} />
      <SplitPlanTable scenes={report.video.scenes} videoName={basename(report.source.local_video)} />
    </>
  );
}

function Signals({ report }: { report: YoutubeVideoReport }) {
  return (
    <>
      <ObservationList observations={report.video.observations} title="Video Observations" />
      <ModelObservationGrid observations={report.video.observations} />
      <TranscriptPanel transcription={report.transcription} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <EventList events={report.audio.events} title={`Audio Events (${report.audio.status})`} />
        <EventList events={report.text.events} title={`Text Events (${report.text.status})`} />
      </div>
    </>
  );
}

function Data({ report }: { report: YoutubeVideoReport }) {
  return <DataBucketOverview buckets={report.data_buckets} />;
}

function RunWorkspace({
  form,
  onFormChange,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
  cliRun,
  runOutput,
  workflowLibrary,
  activeWorkflow,
  activeWorkflowInputModel,
  onSelectWorkflow,
  onCreateWorkflow,
  onEditWorkflow,
  onLoadReport,
}: {
  form: UseCaseForm;
  onFormChange: (form: UseCaseForm) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
  cliRun: CliRun;
  runOutput: { stdout?: string; stderr?: string };
  workflowLibrary: SavedWorkflowLibrary;
  activeWorkflow: SavedWorkflow;
  activeWorkflowInputModel: WorkflowRunInputModel;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onEditWorkflow: () => void;
  onLoadReport: (report: YoutubeVideoReport) => void;
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
        <UseCaseControls
          form={form}
          inputModel={activeWorkflowInputModel}
          onChange={onFormChange}
          onRun={onRun}
          isRunning={isRunning}
          runDisabled={runDisabled}
          validationMessage={validationMessage}
        />
        <JsonReportLoader<YoutubeVideoReport> label="Load report JSON" onLoad={onLoadReport} />
      </section>
      <section className="min-w-0 space-y-4">
        <CliRunPanel run={cliRun} />
        <RunOutputPanel stdout={runOutput.stdout} stderr={runOutput.stderr} />
      </section>
    </div>
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

function DependencyStatusPanel() {
  const [report, setReport] = useState<SystemDependencyReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getWorkflowClient()
      .checkDependencies()
      .then((nextReport) => {
        if (active) {
          setReport(nextReport);
          setMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
    };
  }, []);

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

type PortDirection = "in" | "out";
type FlowTone = "sky" | "rose" | "amber" | "emerald" | "violet" | "cyan" | "indigo" | "fuchsia" | "slate" | "zinc";
type PortType =
  | "run_request"
  | "run_config"
  | "template_string"
  | "youtube_url"
  | "video_file"
  | "video_metadata"
  | "video_frame"
  | "audio_frame"
  | "audio_wav"
  | "scene_result"
  | "video_observation"
  | "model_request"
  | "model_prediction"
  | "transcript_segment"
  | "audio_event"
  | "text_event"
  | "object_value"
  | "data_value"
  | "data_record"
  | "data_bucket"
  | "json_report"
  | "dashboard_view";

interface FlowPort {
  id: string;
  label: string;
  type: PortType;
  optional?: boolean;
}

interface WorkflowNodeSize {
  width: number;
  height: number;
}

interface WorkflowRunInput {
  key: string;
  nodeId: string;
  nodeTitle: string;
  port: FlowPort;
  source: "open" | "provider";
}

interface WorkflowRunInputModel {
  sourceModes: SourceMode[];
  showRunConfig: boolean;
  openInputs: WorkflowRunInput[];
  genericInputs: WorkflowRunInput[];
}

interface WorkflowNodeData extends Record<string, unknown> {
  title: string;
  packageName: string;
  description: string;
  tone: FlowTone;
  inputs: FlowPort[];
  outputs: FlowPort[];
  tags?: string[];
  size?: WorkflowNodeSize;
  kind?: "step" | "group";
  group?: WorkflowGroupMetadata;
  minimized?: boolean;
}

type WorkflowNodeModel = Node<WorkflowNodeData, "workflow">;

interface SavedWorkflowBlockNode {
  id: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

interface SavedWorkflowBlockEdge {
  source: string;
  target: string;
  sourceHandle: string | null | undefined;
  targetHandle: string | null | undefined;
}

interface SavedWorkflowBlock {
  id: string;
  name: string;
  createdAt: string;
  tags?: string[];
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowFile {
  format: string;
  version: number;
  lastUpdated: string;
  workflowName?: string;
  workflowVersion?: number;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowVersion {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  versions: SavedWorkflowVersion[];
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion?: number;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  inputSummary: string;
  request: YoutubeRunRequest;
  backendRunId?: string;
  reportPath?: string;
  message?: string | null;
}

interface SavedWorkflowLibrary {
  format: "video-analysis.workflows";
  version: 1;
  activeWorkflowId: string;
  workflows: SavedWorkflow[];
}

interface WorkflowGroupBoundary {
  wrapperPortId: string;
  nodeId: string;
  handle: string | null | undefined;
  type: PortType;
}

interface WorkflowGroupMetadata {
  memberCount: number;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
  inputBoundaries: WorkflowGroupBoundary[];
  outputBoundaries: WorkflowGroupBoundary[];
}

interface WorkflowContextMenuState {
  x: number;
  y: number;
  nodeIds: string[];
}

interface WorkflowOutputConnectorMenuState {
  x: number;
  y: number;
  sourceNodeId: string;
  sourceHandle: string;
  sourcePort: FlowPort;
}

interface WorkflowBlockOpenInput {
  nodeId: string;
  nodeTitle: string;
  port: FlowPort;
}

interface WorkflowPrimitiveConnectorTarget {
  template: WorkflowNodeModel;
  input: FlowPort;
}

interface WorkflowSavedBlockConnectorTarget {
  block: SavedWorkflowBlock;
  input: WorkflowBlockOpenInput;
}

interface WorkflowOutputConnectorContextValue {
  onOutputDoubleClick: (event: React.MouseEvent, nodeId: string, portValue: FlowPort) => void;
}

type WorkflowComponentDragPayload =
  | { type: "primitive"; id: string }
  | { type: "block"; id: string };

type PortTypeColors = Record<PortType, string>;
type PortTypeColorStyle = React.CSSProperties & Record<`--workflow-port-color-${PortType}`, string>;
type HotkeyActionId =
  | "copySelection"
  | "pasteSelection"
  | "deleteSelection"
  | "saveWorkflowVersion"
  | "groupSelection"
  | "ungroupSelection";

interface HotkeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

type HotkeyBindings = Record<HotkeyActionId, HotkeyBinding>;

interface WorkflowClipboardState {
  block: SavedWorkflowBlock;
  anchor: { x: number; y: number };
  pasteCount: number;
}

const workflowNodeTypes = { workflow: WorkflowNode };
const workflowComponentDragDataType = "application/x-video-analysis-workflow-component";
const savedWorkflowJsonFormat = "video-analysis.workflow";
const savedWorkflowJsonVersion = 1;
const savedWorkflowsJsonFormat = "video-analysis.workflows";
const savedWorkflowsJsonVersion = 1;
const savedWorkflowsStorageKey = "video-analysis.workflows.v1";
const savedWorkflowRunsStorageKey = "video-analysis.workflowRuns.v1";
const savedWorkflowBlocksStorageKey = "video-analysis.workflowBlocks.v1";
const savedWorkflowBlocksJsonFormat = "video-analysis.workflowBlocks";
const portTypeColorsStorageKey = "video-analysis.portTypeColors.v1";
const hotkeyBindingsStorageKey = "video-analysis.hotkeys.v1";
const defaultSeedWorkflowName = "Default Analysis Pipeline";
const legacySeedWorkflowName = "YouTube Analysis Workflow";
const maxSavedWorkflowVersions = 25;
const defaultWorkflowNodeWidth = 310;
const defaultWorkflowGroupHeight = 190;
const minWorkflowGroupWidth = 260;
const minWorkflowGroupHeight = 140;

const portTypes: PortType[] = [
  "run_request",
  "run_config",
  "template_string",
  "youtube_url",
  "video_file",
  "video_metadata",
  "video_frame",
  "audio_frame",
  "audio_wav",
  "scene_result",
  "video_observation",
  "model_request",
  "model_prediction",
  "transcript_segment",
  "audio_event",
  "text_event",
  "object_value",
  "data_value",
  "data_record",
  "data_bucket",
  "json_report",
  "dashboard_view",
];

const defaultPortTypeColors: PortTypeColors = {
  run_request: "#52525b",
  run_config: "#71717a",
  template_string: "#14b8a6",
  youtube_url: "#0ea5e9",
  video_file: "#f59e0b",
  video_metadata: "#d97706",
  video_frame: "#10b981",
  audio_frame: "#06b6d4",
  audio_wav: "#0891b2",
  scene_result: "#22c55e",
  video_observation: "#8b5cf6",
  model_request: "#a855f7",
  model_prediction: "#7c3aed",
  transcript_segment: "#6366f1",
  audio_event: "#0e7490",
  text_event: "#d946ef",
  object_value: "#db2777",
  data_value: "#334155",
  data_record: "#64748b",
  data_bucket: "#475569",
  json_report: "#0284c7",
  dashboard_view: "#2563eb",
};

const dataValueCompatibleSourceTypes: PortType[] = [
  "data_value",
  "data_record",
  "data_bucket",
  "json_report",
  "video_metadata",
  "scene_result",
  "video_observation",
  "model_prediction",
  "transcript_segment",
  "audio_event",
  "text_event",
];

const hotkeyActions: Array<{
  id: HotkeyActionId;
  label: string;
  scope: string;
}> = [
  { id: "copySelection", label: "Copy selection", scope: "Workflow" },
  { id: "pasteSelection", label: "Paste selection", scope: "Workflow" },
  { id: "deleteSelection", label: "Delete selection", scope: "Workflow" },
  { id: "saveWorkflowVersion", label: "Save version", scope: "Workflow" },
  { id: "groupSelection", label: "Group selection", scope: "Workflow" },
  { id: "ungroupSelection", label: "Ungroup selection", scope: "Workflow" },
];

const defaultHotkeyBindings: HotkeyBindings = {
  copySelection: { key: "C", ctrl: true },
  pasteSelection: { key: "V", ctrl: true },
  deleteSelection: { key: "Delete" },
  saveWorkflowVersion: { key: "S", ctrl: true },
  groupSelection: { key: "G", ctrl: true, shift: true },
  ungroupSelection: { key: "G", ctrl: true, alt: true },
};

const PortTypeColorContext = React.createContext<PortTypeColors>(defaultPortTypeColors);
const WorkflowOutputConnectorContext = React.createContext<WorkflowOutputConnectorContextValue>({
  onOutputDoubleClick: () => undefined,
});

const initialWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("react-page", 0, 180, {
    title: "User Story Page",
    packageName: "@video-analysis/web",
    description: "Form state, report state, and dashboard tabs.",
    tone: "sky",
    inputs: [port("report", "report", "json_report")],
    outputs: [
      port("run", "run", "run_request"),
      port("config", "config", "run_config"),
      port("dashboard", "dashboard", "dashboard_view"),
    ],
  }),
  workflowNode("source", 0, 500, {
    title: "Source Picker",
    packageName: "Input",
    description: "YouTube URL mode or local file mode.",
    tone: "sky",
    inputs: [],
    outputs: [
      port("url", "youtube url", "youtube_url"),
      port("file", "local file", "video_file"),
    ],
  }),
  workflowNode("vite-api", 360, 190, {
    title: "Local Analysis API",
    packageName: "studio-api",
    description: "Validates input and starts the Rust workflow run manager.",
    tone: "rose",
    inputs: [
      port("run", "run request", "run_request"),
      port("config", "run config", "run_config"),
    ],
    outputs: [port("args", "cargo args", "run_config")],
  }),
  workflowNode("use-case", 720, 190, {
    title: "YouTube Use Case",
    packageName: "studio-core",
    description: "Coordinates download, ingest, analysis, buckets, and report JSON.",
    tone: "amber",
    inputs: [
      port("args", "cargo args", "run_config"),
      port("url", "youtube url", "youtube_url"),
      port("file", "local file", "video_file"),
    ],
    outputs: [
      port("url", "youtube url", "youtube_url"),
      port("file", "video file", "video_file"),
      port("config", "pipeline config", "run_config"),
    ],
  }),
  workflowNode("download", 1080, 30, {
    title: "YouTube Downloader",
    packageName: "yt-dlp",
    description: "Downloads a single video and emits the local media path.",
    tone: "rose",
    inputs: [port("url", "url", "youtube_url")],
    outputs: [port("file", "mp4/webm/mkv", "video_file")],
  }),
  workflowNode("ffmpeg", 1080, 360, {
    title: "FFmpeg Ingest",
    packageName: "video-analysis-ffmpeg",
    description: "Probes metadata and decodes video and audio samples.",
    tone: "amber",
    inputs: [port("file", "video file", "video_file")],
    outputs: [
      port("metadata", "metadata", "video_metadata"),
      port("frames", "video frames", "video_frame"),
      port("audio", "audio frames", "audio_frame"),
      port("wav", "audio wav", "audio_wav"),
    ],
  }),
  workflowNode("video-pipeline", 1440, 170, {
    title: "Realtime Video Pipeline",
    packageName: "video-analysis-core",
    description: "Feeds frames through scene detection and sampled visual analyzers.",
    tone: "emerald",
    inputs: [
      port("frames", "frames", "video_frame"),
      port("config", "config", "run_config"),
    ],
    outputs: [
      port("scenes", "scenes", "scene_result"),
      port("observations", "observations", "video_observation"),
      port("records", "frame records", "data_record"),
    ],
  }),
  workflowNode("content-detector", 1810, 40, {
    title: "Content Detector",
    packageName: "video-analysis-detectors",
    description: "Detects scene changes from frame deltas.",
    tone: "emerald",
    inputs: [
      port("frames", "frames", "video_frame"),
      port("config", "thresholds", "run_config"),
    ],
    outputs: [port("scenes", "scene cuts", "scene_result")],
  }),
  workflowNode("model-sampler", 1810, 260, {
    title: "Sampled Visual Models",
    packageName: "video-analysis-models",
    description: "Builds model requests for object detection and OCR commands.",
    tone: "violet",
    inputs: [
      port("frames", "sampled frames", "video_frame"),
      port("config", "model config", "run_config"),
    ],
    outputs: [port("requests", "model requests", "model_request")],
  }),
  workflowNode("external-models", 2180, 260, {
    title: "External Commands",
    packageName: "object / ocr / text command",
    description: "Receives JSON requests on stdin and returns predictions.",
    tone: "violet",
    inputs: [port("requests", "requests", "model_request")],
    outputs: [port("predictions", "predictions", "model_prediction")],
  }),
  workflowNode("observations", 2550, 260, {
    title: "Observation Normalizer",
    packageName: "video-analysis-core",
    description: "Maps predictions into typed observations with frame and scene context.",
    tone: "violet",
    inputs: [
      port("predictions", "predictions", "model_prediction"),
      port("scenes", "scene context", "scene_result"),
    ],
    outputs: [port("observations", "observations", "video_observation")],
  }),
  workflowNode("audio-pipeline", 1440, 520, {
    title: "Audio Pipeline",
    packageName: "video-analysis-core",
    description: "Classifies audio activity from decoded samples.",
    tone: "cyan",
    inputs: [port("audio", "audio frames", "audio_frame")],
    outputs: [
      port("events", "audio events", "audio_event"),
      port("records", "audio records", "data_record"),
    ],
  }),
  workflowNode("transcriber", 1440, 790, {
    title: "Transcriber",
    packageName: "whisper cli",
    description: "Creates transcript segments when transcription is enabled.",
    tone: "indigo",
    inputs: [port("wav", "audio wav", "audio_wav")],
    outputs: [port("segments", "segments", "transcript_segment")],
  }),
  workflowNode("text-pipeline", 1810, 790, {
    title: "Text Pipeline",
    packageName: "video-analysis-core",
    description: "Runs transcript heuristics and optional text model analysis.",
    tone: "fuchsia",
    inputs: [
      port("segments", "segments", "transcript_segment"),
      port("config", "model config", "run_config"),
    ],
    outputs: [
      port("events", "text events", "text_event"),
      port("records", "text records", "data_record"),
    ],
  }),
  workflowNode("buckets", 2180, 560, {
    title: "Bucket Aggregator",
    packageName: "video-analysis-data",
    description: "Rolls frame, audio, and transcript records into bounded buckets.",
    tone: "slate",
    inputs: [port("records", "records", "data_record")],
    outputs: [port("buckets", "buckets", "data_bucket")],
  }),
  workflowNode("report-writer", 2920, 420, {
    title: "Report Writer",
    packageName: "serde_json",
    description: "Writes source, assets, capabilities, video, audio, text, and bucket reports.",
    tone: "zinc",
    inputs: [
      port("metadata", "metadata", "video_metadata"),
      port("scenes", "scenes", "scene_result"),
      port("observations", "observations", "video_observation"),
      port("audio", "audio events", "audio_event"),
      port("text", "text events", "text_event"),
      port("segments", "transcript", "transcript_segment"),
      port("buckets", "buckets", "data_bucket"),
    ],
    outputs: [port("report", "analysis.json", "json_report")],
  }),
  workflowNode("dashboard", 3280, 420, {
    title: "Report Dashboard",
    packageName: "@video-analysis-studio/ui",
    description: "Renders summary, scenes, signals, data buckets, and split plans.",
    tone: "sky",
    inputs: [port("report", "report json", "json_report")],
    outputs: [port("view", "visible panels", "dashboard_view")],
  }),
  workflowNode("templated-data-save", 3640, -180, {
    title: "Templated Data Save",
    packageName: "fs / mustache",
    description: "Serializes incoming data to a path resolved from a template string. Use {{field}} values from the optional context object.",
    tone: "emerald",
    inputs: [
      port("data", "data", "data_value"),
      port("location", "location template", "template_string"),
      port("context", "context object", "object_value", { optional: true }),
    ],
    outputs: [],
  }),
  workflowNode("disk-result-sink", 3640, 120, {
    title: "Disk Result Sink",
    packageName: "fs / browser download",
    description: "Persists the final JSON report to a configured file path or browser download.",
    tone: "emerald",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  }),
  workflowNode("database-result-sink", 3640, 420, {
    title: "Database Result Sink",
    packageName: "IndexedDB / database adapter",
    description: "Stores the final JSON report as a durable record for later retrieval or indexing.",
    tone: "cyan",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  }),
  workflowNode("http-result-sink", 3640, 720, {
    title: "HTTP Result Sink",
    packageName: "fetch / webhook",
    description: "Sends the final JSON report to an HTTP endpoint such as a webhook or API route.",
    tone: "rose",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  }),
];

const initialWorkflowEdges: Edge[] = [
  workflowEdge("react-page", "run", "vite-api", "run"),
  workflowEdge("react-page", "config", "vite-api", "config"),
  workflowEdge("source", "url", "use-case", "url"),
  workflowEdge("source", "file", "use-case", "file"),
  workflowEdge("vite-api", "args", "use-case", "args"),
  workflowEdge("use-case", "url", "download", "url"),
  workflowEdge("use-case", "file", "ffmpeg", "file"),
  workflowEdge("download", "file", "ffmpeg", "file"),
  workflowEdge("use-case", "config", "video-pipeline", "config"),
  workflowEdge("use-case", "config", "content-detector", "config"),
  workflowEdge("use-case", "config", "model-sampler", "config"),
  workflowEdge("use-case", "config", "text-pipeline", "config"),
  workflowEdge("ffmpeg", "metadata", "report-writer", "metadata"),
  workflowEdge("ffmpeg", "frames", "video-pipeline", "frames"),
  workflowEdge("ffmpeg", "frames", "content-detector", "frames"),
  workflowEdge("ffmpeg", "frames", "model-sampler", "frames"),
  workflowEdge("ffmpeg", "audio", "audio-pipeline", "audio"),
  workflowEdge("ffmpeg", "wav", "transcriber", "wav"),
  workflowEdge("video-pipeline", "scenes", "report-writer", "scenes"),
  workflowEdge("content-detector", "scenes", "observations", "scenes"),
  workflowEdge("model-sampler", "requests", "external-models", "requests"),
  workflowEdge("external-models", "predictions", "observations", "predictions"),
  workflowEdge("observations", "observations", "report-writer", "observations"),
  workflowEdge("audio-pipeline", "events", "report-writer", "audio"),
  workflowEdge("transcriber", "segments", "text-pipeline", "segments"),
  workflowEdge("transcriber", "segments", "report-writer", "segments"),
  workflowEdge("text-pipeline", "events", "report-writer", "text"),
  workflowEdge("video-pipeline", "records", "buckets", "records"),
  workflowEdge("audio-pipeline", "records", "buckets", "records"),
  workflowEdge("text-pipeline", "records", "buckets", "records"),
  workflowEdge("buckets", "buckets", "report-writer", "buckets"),
  workflowEdge("report-writer", "report", "dashboard", "report"),
  workflowEdge("report-writer", "report", "react-page", "report"),
  workflowEdge("report-writer", "report", "templated-data-save", "data"),
  workflowEdge("report-writer", "report", "disk-result-sink", "report"),
  workflowEdge("report-writer", "report", "database-result-sink", "report"),
  workflowEdge("report-writer", "report", "http-result-sink", "report"),
];

function WorkflowBuilder({
  workflowLibrary,
  onWorkflowLibraryChange,
  portTypeColors,
  hotkeyBindings,
}: {
  workflowLibrary: SavedWorkflowLibrary;
  onWorkflowLibraryChange: React.Dispatch<React.SetStateAction<SavedWorkflowLibrary>>;
  portTypeColors: PortTypeColors;
  hotkeyBindings: HotkeyBindings;
}) {
  const activeWorkflow = useMemo(() => activeSavedWorkflow(workflowLibrary), [workflowLibrary]);
  const initialWorkflowState = useMemo(
    () => workflowStateFromSavedWorkflow(activeWorkflow),
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeModel>(initialWorkflowState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialWorkflowState.edges);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [savedBlocks, setSavedBlocks] = useState<SavedWorkflowBlock[]>(loadSavedWorkflowBlocks);
  const [blockName, setBlockName] = useState("");
  const [blockTags, setBlockTags] = useState("");
  const [blockLibraryMessage, setBlockLibraryMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenuState | null>(null);
  const [outputConnectorMenu, setOutputConnectorMenu] = useState<WorkflowOutputConnectorMenuState | null>(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<WorkflowNodeModel, Edge> | null>(null);
  const [workflowNameDraft, setWorkflowNameDraft] = useState(activeWorkflow.name);
  const workflowAutosaveReadyRef = useRef(false);
  const workflowSelectionLoadingRef = useRef(false);
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const blockFileInputRef = useRef<HTMLInputElement | null>(null);
  const workflowClipboardRef = useRef<WorkflowClipboardState | null>(null);
  const portTypeColorStyle = useMemo(() => portTypeColorsStyle(portTypeColors), [portTypeColors]);

  useEffect(() => {
    setWorkflowNameDraft(activeWorkflow.name);
  }, [activeWorkflow.id, activeWorkflow.name]);

  useEffect(() => {
    const nextState = workflowStateFromSavedWorkflow(activeWorkflow);
    workflowSelectionLoadingRef.current = true;
    setNodes(nextState.nodes);
    setEdges(nextState.edges);
    setSelectedNodeIds([]);
    setContextMenu(null);
    setOutputConnectorMenu(null);
  }, [activeWorkflow.id, setEdges, setNodes]);

  useEffect(() => {
    if (!workflowAutosaveReadyRef.current) {
      workflowAutosaveReadyRef.current = true;
      return;
    }
    if (workflowSelectionLoadingRef.current) {
      workflowSelectionLoadingRef.current = false;
      return;
    }

    onWorkflowLibraryChange((currentLibrary) => {
      const updatedAt = new Date().toISOString();
      const nextLibrary: SavedWorkflowLibrary = {
        ...currentLibrary,
        workflows: currentLibrary.workflows.map((workflow) =>
          workflow.id === currentLibrary.activeWorkflowId
            ? {
                ...workflow,
                updatedAt,
                nodes: nodes.map(serializeWorkflowNode),
                edges: edges.map(serializeWorkflowEdge),
              }
            : workflow,
        ),
      };
      persistSavedWorkflowLibrary(nextLibrary);
      return nextLibrary;
    });
  }, [edges, nodes, onWorkflowLibraryChange, workflowLibrary.activeWorkflowId]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => compatibleConnection(nodes, connection),
    [nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourcePort = findPort(nodes, connection.source, connection.sourceHandle, "out");
      const targetPort = findPort(nodes, connection.target, connection.targetHandle, "in");
      if (!sourcePort || !targetPort || !portTypesCompatible(sourcePort.type, targetPort.type)) {
        return;
      }
      setEdges((currentEdges) =>
        addEdge(
          workflowEdgeFromConnection(connection, sourcePort.type),
          currentEdges,
        ),
      );
    },
    [nodes, setEdges],
  );

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: WorkflowNodeModel[] }) => {
    setSelectedNodeIds(selectedNodes.map((node) => node.id));
  }, []);

  const selectedNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIds.includes(node.id)),
    [nodes, selectedNodeIds],
  );

  const selectedInternalEdgeCount = useMemo(() => {
    const selectedIds = new Set(selectedNodeIds);
    return edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)).length;
  }, [edges, selectedNodeIds]);

  const commitWorkflowLibrary = useCallback((library: SavedWorkflowLibrary) => {
    persistSavedWorkflowLibrary(library);
    onWorkflowLibraryChange(library);
  }, [onWorkflowLibraryChange]);

  const selectWorkflow = useCallback(
    (workflowId: string) => {
      const workflow = workflowLibrary.workflows.find((candidate) => candidate.id === workflowId);
      if (!workflow) {
        return;
      }

      const nextLibrary = { ...workflowLibrary, activeWorkflowId: workflow.id };
      const nextState = workflowStateFromSavedWorkflow(workflow);
      commitWorkflowLibrary(nextLibrary);
      workflowSelectionLoadingRef.current = true;
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setSelectedNodeIds([]);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [commitWorkflowLibrary, setEdges, setNodes, workflowLibrary],
  );

  const createBlankWorkflow = useCallback(() => {
    const workflow = createBlankSavedWorkflow();
    const nextLibrary: SavedWorkflowLibrary = {
      ...workflowLibrary,
      activeWorkflowId: workflow.id,
      workflows: [workflow, ...workflowLibrary.workflows],
    };
    commitWorkflowLibrary(nextLibrary);
    setNodes([]);
    setEdges([]);
    setSelectedNodeIds([]);
    setContextMenu(null);
    setOutputConnectorMenu(null);
    setBlockLibraryMessage("Created blank workflow");
  }, [commitWorkflowLibrary, setEdges, setNodes, workflowLibrary]);

  const cloneActiveWorkflow = useCallback(() => {
    const workflow = createSavedWorkflow(`${activeWorkflow.name} Copy`, nodes, edges);
    const nextLibrary: SavedWorkflowLibrary = {
      ...workflowLibrary,
      activeWorkflowId: workflow.id,
      workflows: [workflow, ...workflowLibrary.workflows],
    };
    const nextState = workflowStateFromSavedWorkflow(workflow);
    commitWorkflowLibrary(nextLibrary);
    setNodes(nextState.nodes);
    setEdges(nextState.edges);
    setSelectedNodeIds([]);
    setContextMenu(null);
    setOutputConnectorMenu(null);
    setBlockLibraryMessage("Cloned workflow");
  }, [activeWorkflow.name, commitWorkflowLibrary, edges, nodes, setEdges, setNodes, workflowLibrary]);

  const deleteWorkflow = useCallback(
    (workflowId: string) => {
      const workflow = workflowLibrary.workflows.find((candidate) => candidate.id === workflowId);
      if (!workflow) {
        return;
      }
      if (typeof window !== "undefined" && !window.confirm(`Delete workflow "${workflow.name}"?`)) {
        return;
      }

      const remainingWorkflows = workflowLibrary.workflows.filter((candidate) => candidate.id !== workflowId);
      const activeWasDeleted = workflowLibrary.activeWorkflowId === workflowId;
      const nextActiveWorkflow = activeWasDeleted
        ? (remainingWorkflows[0] ?? createBlankSavedWorkflow())
        : activeWorkflow;
      const nextWorkflows = remainingWorkflows.length === 0 ? [nextActiveWorkflow] : remainingWorkflows;
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        activeWorkflowId: nextActiveWorkflow.id,
        workflows: nextWorkflows,
      };

      commitWorkflowLibrary(nextLibrary);
      if (activeWasDeleted) {
        const nextState = workflowStateFromSavedWorkflow(nextActiveWorkflow);
        setNodes(nextState.nodes);
        setEdges(nextState.edges);
        setSelectedNodeIds([]);
        setContextMenu(null);
        setOutputConnectorMenu(null);
      }
      setBlockLibraryMessage("Deleted workflow");
    },
    [activeWorkflow, commitWorkflowLibrary, setEdges, setNodes, workflowLibrary],
  );

  const renameWorkflow = useCallback(
    (workflowId: string, name: string) => {
      const nextName = name.trim() || "Untitled Workflow";
      const updatedAt = new Date().toISOString();
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        workflows: workflowLibrary.workflows.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, name: nextName, updatedAt } : workflow,
        ),
      };
      commitWorkflowLibrary(nextLibrary);
      if (workflowLibrary.activeWorkflowId === workflowId) {
        setWorkflowNameDraft(nextName);
      }
    },
    [commitWorkflowLibrary, workflowLibrary],
  );

  const commitActiveWorkflowName = useCallback(() => {
    renameWorkflow(activeWorkflow.id, workflowNameDraft);
  }, [activeWorkflow.id, renameWorkflow, workflowNameDraft]);

  const saveActiveWorkflowVersion = useCallback(() => {
    const name = workflowNameDraft.trim() || activeWorkflow.name || "Untitled Workflow";
    if (!workflowHasChangesSinceLatestVersion(activeWorkflow, name, nodes, edges)) {
      setBlockLibraryMessage("No workflow changes since the latest saved version");
      setWorkflowNameDraft(name);
      return;
    }
    const version = createSavedWorkflowVersion(activeWorkflow, name, nodes, edges);
    const nextLibrary: SavedWorkflowLibrary = {
      ...workflowLibrary,
      workflows: workflowLibrary.workflows.map((workflow) =>
        workflow.id === activeWorkflow.id
          ? {
              ...workflow,
              name,
              updatedAt: version.createdAt,
              version: version.version,
              nodes: version.nodes,
              edges: version.edges,
              versions: [version, ...(Array.isArray(workflow.versions) ? workflow.versions : [])].slice(0, maxSavedWorkflowVersions),
            }
          : workflow,
      ),
    };
    commitWorkflowLibrary(nextLibrary);
    setWorkflowNameDraft(name);
    setBlockLibraryMessage(`Saved ${name} v${version.version}`);
  }, [activeWorkflow, commitWorkflowLibrary, edges, nodes, workflowLibrary, workflowNameDraft]);

  const restoreWorkflowVersion = useCallback(
    (version: SavedWorkflowVersion) => {
      const restoredWorkflow: SavedWorkflow = {
        ...activeWorkflow,
        name: version.name,
        updatedAt: new Date().toISOString(),
        nodes: version.nodes.map((node) => ({
          id: node.id,
          position: { ...node.position },
          data: cloneWorkflowNodeData(node.data),
        })),
        edges: version.edges.map((edge) => ({ ...edge })),
      };
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        workflows: workflowLibrary.workflows.map((workflow) =>
          workflow.id === activeWorkflow.id ? restoredWorkflow : workflow,
        ),
      };
      const nextState = workflowStateFromSavedWorkflow(restoredWorkflow);
      commitWorkflowLibrary(nextLibrary);
      workflowSelectionLoadingRef.current = true;
      setNodes(nextState.nodes);
      setEdges(nextState.edges);
      setSelectedNodeIds([]);
      setContextMenu(null);
      setOutputConnectorMenu(null);
      setWorkflowNameDraft(version.name);
      setBlockLibraryMessage(`Restored ${version.name} v${version.version}`);
    },
    [activeWorkflow, commitWorkflowLibrary, setEdges, setNodes, workflowLibrary],
  );

  const saveNodesAsBlock = useCallback((nodesToSave: WorkflowNodeModel[]) => {
    const block = createSavedWorkflowBlock(nodesToSave, edges, blockName, blockTags);
    if (!block) {
      return;
    }
    setSavedBlocks((currentBlocks) => {
      const nextBlocks = [block, ...currentBlocks].slice(0, 24);
      persistSavedWorkflowBlocks(nextBlocks);
      return nextBlocks;
    });
    setBlockName("");
    setBlockTags("");
    setBlockLibraryMessage("Saved component");
    setContextMenu(null);
    setOutputConnectorMenu(null);
  }, [blockName, blockTags, edges]);

  const saveSelectedBlock = useCallback(() => {
    saveNodesAsBlock(selectedNodes);
  }, [saveNodesAsBlock, selectedNodes]);

  const groupNodes = useCallback(
    (nodeIds: string[]) => {
      const grouped = createWorkflowGroup(nodes.filter((node) => nodeIds.includes(node.id)), edges, blockName);
      if (!grouped) {
        return;
      }
      const groupedIds = new Set(nodeIds);
      setNodes((currentNodes) =>
        currentNodes
          .filter((node) => !groupedIds.has(node.id))
          .map((node) => ({ ...node, selected: false }))
          .concat({ ...grouped.node, selected: true }),
      );
      setEdges(grouped.edges);
      setSelectedNodeIds([grouped.node.id]);
      setBlockName("");
      setBlockTags("");
      setBlockLibraryMessage(`Grouped ${grouped.groupedNodeCount} components`);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [blockName, edges, nodes, setEdges, setNodes],
  );

  const updateGroupDetails = useCallback(
    (nodeId: string, updates: Pick<WorkflowNodeData, "title" | "description">) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId || !node.data.group) {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              title: updates.title,
              description: updates.description,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const ungroupNode = useCallback(
    (nodeId: string) => {
      const groupNode = nodes.find((node) => node.id === nodeId);
      if (!groupNode?.data.group) {
        return;
      }
      const restored = restoreWorkflowGroup(groupNode, nodes, edges);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setSelectedNodeIds(restored.restoredNodeIds);
      setBlockLibraryMessage(`Ungrouped ${restored.restoredNodeIds.length} components`);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [edges, nodes, setEdges, setNodes],
  );

  const deleteWorkflowNodes = useCallback(
    (nodeIds: string[]) => {
      const ids = new Set(nodeIds);
      setNodes((currentNodes) => currentNodes.filter((node) => !ids.has(node.id)));
      setEdges((currentEdges) => currentEdges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
      setSelectedNodeIds([]);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [setEdges, setNodes],
  );

  const setWorkflowNodesMinimized = useCallback(
    (nodeIds: string[], minimized: boolean) => {
      const ids = new Set(nodeIds);
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          ids.has(node.id)
            ? {
                ...node,
                data: {
                  ...node.data,
                  minimized,
                },
              }
            : node,
        ),
      );
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [setNodes],
  );

  const addPrimitiveNode = useCallback(
    (template: WorkflowNodeModel, position?: { x: number; y: number }) => {
      const nodeId = createWorkflowNodeInstanceId(template.id);
      setNodes((currentNodes) =>
        currentNodes
          .map((node) => ({ ...node, selected: false }))
          .concat({
            id: nodeId,
            type: "workflow",
            position: position ?? nextBlockAnchor(currentNodes),
            data: cloneWorkflowNodeData(template.data),
            selected: true,
          }),
      );
      setSelectedNodeIds([nodeId]);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [setNodes],
  );

  const addSavedBlock = useCallback(
    (block: SavedWorkflowBlock, position?: { x: number; y: number }) => {
      const anchor = position ?? nextBlockAnchor(nodes);
      const instance = instantiateSavedWorkflowBlock(block, anchor);
      setNodes((currentNodes) => {
        const nextNodes: WorkflowNodeModel[] = currentNodes.map((node) => ({ ...node, selected: false }));
        return nextNodes.concat(instance.nodes.map((node) => ({ ...node, selected: true })));
      });
      setEdges((currentEdges) => currentEdges.concat(instance.edges));
      setSelectedNodeIds(instance.nodes.map((node) => node.id));
      setOutputConnectorMenu(null);
    },
    [nodes, setEdges, setNodes],
  );

  const copySelectedWorkflowNodes = useCallback((): boolean => {
    const clipboard = createWorkflowClipboardState(selectedNodes, edges);
    if (!clipboard) {
      return false;
    }
    workflowClipboardRef.current = clipboard;
    setBlockLibraryMessage(`Copied ${selectedNodes.length} component${selectedNodes.length === 1 ? "" : "s"}`);
    setContextMenu(null);
    setOutputConnectorMenu(null);
    return true;
  }, [edges, selectedNodes]);

  const pasteWorkflowClipboard = useCallback((): boolean => {
    const clipboard = workflowClipboardRef.current;
    if (!clipboard) {
      return false;
    }
    const pasteCount = clipboard.pasteCount + 1;
    const anchor = {
      x: clipboard.anchor.x + 56 * pasteCount,
      y: clipboard.anchor.y + 56 * pasteCount,
    };
    const instance = instantiateSavedWorkflowBlock(clipboard.block, anchor);
    workflowClipboardRef.current = { ...clipboard, pasteCount };
    setNodes((currentNodes) =>
      currentNodes
        .map((node) => ({ ...node, selected: false }))
        .concat(instance.nodes.map((node) => ({ ...node, selected: true }))),
    );
    setEdges((currentEdges) => dedupeEdges(currentEdges.concat(instance.edges)));
    setSelectedNodeIds(instance.nodes.map((node) => node.id));
    setBlockLibraryMessage(`Pasted ${instance.nodes.length} component${instance.nodes.length === 1 ? "" : "s"}`);
    setContextMenu(null);
    setOutputConnectorMenu(null);
    return instance.nodes.length > 0;
  }, [setEdges, setNodes]);

  const deleteSavedBlock = useCallback((blockId: string) => {
    setSavedBlocks((currentBlocks) => {
      const nextBlocks = currentBlocks.filter((block) => block.id !== blockId);
      persistSavedWorkflowBlocks(nextBlocks);
      return nextBlocks;
    });
    setBlockLibraryMessage("Deleted component");
  }, []);

  const exportSavedBlocks = useCallback(() => {
    if (savedBlocks.length === 0) {
      return;
    }
    downloadSavedWorkflowBlocksJson(savedBlocks);
    setBlockLibraryMessage(`Exported ${savedBlocks.length} component${savedBlocks.length === 1 ? "" : "s"}`);
  }, [savedBlocks]);

  const importSavedBlocks = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const importedBlocks = parseSavedWorkflowBlocksJson(await file.text());
      setSavedBlocks((currentBlocks) => {
        const nextBlocks = mergeSavedWorkflowBlocks(importedBlocks, currentBlocks);
        persistSavedWorkflowBlocks(nextBlocks);
        return nextBlocks;
      });
      setBlockLibraryMessage(`Loaded ${importedBlocks.length} component${importedBlocks.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBlockLibraryMessage(error instanceof Error ? error.message : "Could not load components");
    }
  }, []);

  const exportWorkflow = useCallback(() => {
    downloadWorkflowJson(activeWorkflow, nodes, edges);
    setBlockLibraryMessage(`Exported workflow with ${nodes.length} component${nodes.length === 1 ? "" : "s"}`);
  }, [activeWorkflow, edges, nodes]);

  const importWorkflow = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }

      try {
        const workflow = parseWorkflowJson(await file.text());
        setNodes(workflow.nodes);
        setEdges(workflow.edges);
        setSelectedNodeIds([]);
        setContextMenu(null);
        setOutputConnectorMenu(null);
        setBlockLibraryMessage(`Loaded workflow updated ${formatWorkflowTimestamp(workflow.lastUpdated)}`);
      } catch (error) {
        setBlockLibraryMessage(error instanceof Error ? error.message : "Could not load workflow");
      }
    },
    [setEdges, setNodes],
  );

  const contextNodes = useMemo(
    () => (contextMenu ? nodes.filter((node) => contextMenu.nodeIds.includes(node.id)) : []),
    [contextMenu, nodes],
  );
  const contextGroupNode = contextNodes.length === 1 && contextNodes[0].data.group ? contextNodes[0] : null;
  const contextNodesAllMinimized = contextNodes.length > 0 && contextNodes.every((node) => node.data.minimized);
  const filteredPrimitiveNodes = useMemo(
    () => filterWorkflowNodeTemplates(initialWorkflowNodes, componentSearch),
    [componentSearch],
  );
  const filteredSavedBlocks = useMemo(
    () => filterSavedWorkflowBlocks(savedBlocks, componentSearch),
    [componentSearch, savedBlocks],
  );
  const outputConnectorPrimitiveTargets = useMemo(
    () =>
      outputConnectorMenu
        ? workflowPrimitiveConnectorTargets(initialWorkflowNodes, outputConnectorMenu.sourcePort.type)
        : [],
    [outputConnectorMenu?.sourcePort.type],
  );
  const outputConnectorSavedBlockTargets = useMemo(
    () =>
      outputConnectorMenu
        ? workflowSavedBlockConnectorTargets(savedBlocks, outputConnectorMenu.sourcePort.type)
        : [],
    [outputConnectorMenu?.sourcePort.type, savedBlocks],
  );
  const openOutputConnectorMenu = useCallback(
    (event: React.MouseEvent, nodeId: string, portValue: FlowPort) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu(null);
      setOutputConnectorMenu({
        x: event.clientX,
        y: event.clientY,
        sourceNodeId: nodeId,
        sourceHandle: handleId("out", portValue),
        sourcePort: { ...portValue },
      });
    },
    [],
  );
  const outputConnectorContextValue = useMemo<WorkflowOutputConnectorContextValue>(
    () => ({ onOutputDoubleClick: openOutputConnectorMenu }),
    [openOutputConnectorMenu],
  );
  const connectOutputToPrimitive = useCallback(
    (template: WorkflowNodeModel, targetPort: FlowPort) => {
      if (!outputConnectorMenu) {
        return;
      }
      const sourceNode = nodes.find((node) => node.id === outputConnectorMenu.sourceNodeId);
      if (!sourceNode) {
        setOutputConnectorMenu(null);
        return;
      }

      const nodeId = createWorkflowNodeInstanceId(template.id);
      const position = connectedWorkflowNodePosition(sourceNode, nodes);
      const nextNode: WorkflowNodeModel = {
        id: nodeId,
        type: "workflow",
        position,
        data: cloneWorkflowNodeData(template.data),
        selected: true,
      };
      const edge = workflowEdgeFromConnection(
        {
          source: outputConnectorMenu.sourceNodeId,
          sourceHandle: outputConnectorMenu.sourceHandle,
          target: nodeId,
          targetHandle: handleId("in", targetPort),
        },
        outputConnectorMenu.sourcePort.type,
      );

      setNodes((currentNodes) => {
        const nextNodes: WorkflowNodeModel[] = currentNodes.map((node) => ({ ...node, selected: false }));
        return nextNodes.concat(nextNode);
      });
      setEdges((currentEdges) => dedupeEdges(currentEdges.concat(edge)));
      setSelectedNodeIds([nodeId]);
      setOutputConnectorMenu(null);
      setContextMenu(null);
    },
    [nodes, outputConnectorMenu, setEdges, setNodes],
  );
  const connectOutputToSavedBlock = useCallback(
    (block: SavedWorkflowBlock, targetInput: WorkflowBlockOpenInput) => {
      if (!outputConnectorMenu) {
        return;
      }
      const sourceNode = nodes.find((node) => node.id === outputConnectorMenu.sourceNodeId);
      if (!sourceNode) {
        setOutputConnectorMenu(null);
        return;
      }

      const instance = instantiateSavedWorkflowBlock(block, connectedWorkflowNodePosition(sourceNode, nodes));
      const targetNodeId = instance.idByOriginalId.get(targetInput.nodeId);
      const targetNode = targetNodeId ? instance.nodes.find((node) => node.id === targetNodeId) : null;
      const targetPort = targetNode?.data.inputs.find(
        (input) => input.id === targetInput.port.id && input.type === targetInput.port.type,
      );
      if (!targetNode || !targetPort) {
        setOutputConnectorMenu(null);
        return;
      }

      const edge = workflowEdgeFromConnection(
        {
          source: outputConnectorMenu.sourceNodeId,
          sourceHandle: outputConnectorMenu.sourceHandle,
          target: targetNode.id,
          targetHandle: handleId("in", targetPort),
        },
        outputConnectorMenu.sourcePort.type,
      );

      setNodes((currentNodes) =>
        currentNodes
          .map((node) => ({ ...node, selected: false }))
          .concat(instance.nodes.map((node) => ({ ...node, selected: true }))),
      );
      setEdges((currentEdges) => dedupeEdges(currentEdges.concat(instance.edges, edge)));
      setSelectedNodeIds(instance.nodes.map((node) => node.id));
      setOutputConnectorMenu(null);
      setContextMenu(null);
    },
    [nodes, outputConnectorMenu, setEdges, setNodes],
  );
  const dropComponent = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const payload = parseWorkflowComponentDragPayload(event.dataTransfer.getData(workflowComponentDragDataType));
      if (!payload) {
        return;
      }
      const position = flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (payload.type === "primitive") {
        const template = initialWorkflowNodes.find((node) => node.id === payload.id);
        if (template) {
          addPrimitiveNode(template, position);
        }
        return;
      }
      const block = savedBlocks.find((candidate) => candidate.id === payload.id);
      if (block) {
        addSavedBlock(block, position);
      }
    },
    [addPrimitiveNode, addSavedBlock, flowInstance, savedBlocks],
  );

  const runWorkflowHotkeyAction = useCallback(
    (actionId: HotkeyActionId): boolean => {
      switch (actionId) {
        case "copySelection":
          return copySelectedWorkflowNodes();
        case "pasteSelection":
          return pasteWorkflowClipboard();
        case "deleteSelection":
          if (selectedNodeIds.length === 0) {
            return false;
          }
          deleteWorkflowNodes(selectedNodeIds);
          return true;
        case "saveWorkflowVersion":
          saveActiveWorkflowVersion();
          return true;
        case "groupSelection":
          if (selectedNodeIds.length < 2) {
            return false;
          }
          groupNodes(selectedNodeIds);
          return true;
        case "ungroupSelection": {
          const groupNode = selectedNodes.length === 1 && selectedNodes[0].data.group ? selectedNodes[0] : null;
          if (!groupNode) {
            return false;
          }
          ungroupNode(groupNode.id);
          return true;
        }
      }
      return false;
    },
    [
      copySelectedWorkflowNodes,
      deleteWorkflowNodes,
      groupNodes,
      pasteWorkflowClipboard,
      saveActiveWorkflowVersion,
      selectedNodeIds,
      selectedNodes,
      ungroupNode,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreHotkeyEvent(event)) {
        return;
      }
      for (const action of hotkeyActions) {
        if (!matchesHotkeyBinding(event, hotkeyBindings[action.id])) {
          continue;
        }
        if (runWorkflowHotkeyAction(action.id)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hotkeyBindings, runWorkflowHotkeyAction]);

  return (
    <PortTypeColorContext.Provider value={portTypeColors}>
      <WorkflowOutputConnectorContext.Provider value={outputConnectorContextValue}>
        <section className="grid min-h-[760px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]" style={portTypeColorStyle}>
        <WorkflowComponentSelector
          search={componentSearch}
          onSearchChange={setComponentSearch}
          primitiveNodes={filteredPrimitiveNodes}
          savedBlocks={filteredSavedBlocks}
          selectedNodeCount={selectedNodes.length}
          blockLibraryMessage={blockLibraryMessage}
          onAddPrimitive={addPrimitiveNode}
          onAddSavedBlock={addSavedBlock}
          onDeleteSavedBlock={deleteSavedBlock}
          onExportSavedBlocks={exportSavedBlocks}
          onImportSavedBlocks={() => blockFileInputRef.current?.click()}
          savedBlockExportDisabled={savedBlocks.length === 0}
        />
        <input
          ref={blockFileInputRef}
          className="hidden"
          type="file"
          accept="application/json,.json"
          onChange={importSavedBlocks}
        />
        <section className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-950">{activeWorkflow.name}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                v{activeWorkflow.version} · {nodes.length} components · {edges.length} connections
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
                onClick={saveActiveWorkflowVersion}
                title="Save workflow version"
              >
                <SaveIcon className="h-4 w-4" />
                Save Version
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={exportWorkflow}
                title="Export workflow as JSON"
              >
                <DownloadIcon className="h-4 w-4" />
                Export
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => workflowFileInputRef.current?.click()}
                title="Load workflow from JSON"
              >
                <UploadIcon className="h-4 w-4" />
                Load
              </button>
              <input
                ref={workflowFileInputRef}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={importWorkflow}
              />
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => {
                  setNodes(initialWorkflowNodes);
                  setEdges(initialWorkflowEdges);
                  setSelectedNodeIds([]);
                  setContextMenu(null);
                  setOutputConnectorMenu(null);
                }}
                title="Reset workflow"
              >
                <RefreshIcon className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>
          <div className="h-[720px] min-h-[560px] w-full">
            <ReactFlow<WorkflowNodeModel, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={workflowNodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={onSelectionChange}
              onPaneClick={() => {
                setContextMenu(null);
                setOutputConnectorMenu(null);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                const nodeIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
                setOutputConnectorMenu(null);
                setContextMenu({ x: event.clientX, y: event.clientY, nodeIds });
              }}
              onInit={setFlowInstance}
              onDrop={dropComponent}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              fitView
              minZoom={0.18}
              maxZoom={1.35}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              selectionOnDrag
              edgesReconnectable
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#d4d4d8" gap={18} />
              <Controls showInteractive={false} />
              {contextMenu && (
                <WorkflowContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  nodeCount={contextNodes.length}
                  canGroup={contextNodes.length >= 2}
                  canSave={contextNodes.length >= 2}
                  canUngroup={Boolean(contextGroupNode)}
                  minimizeLabel={contextNodesAllMinimized ? "Expand selected" : "Minimize selected"}
                  onGroup={() => groupNodes(contextMenu.nodeIds)}
                  onSave={() => saveNodesAsBlock(contextNodes)}
                  onUngroup={() => {
                    if (contextGroupNode) {
                      ungroupNode(contextGroupNode.id);
                    }
                  }}
                  onToggleMinimized={() => setWorkflowNodesMinimized(contextMenu.nodeIds, !contextNodesAllMinimized)}
                  onDelete={() => deleteWorkflowNodes(contextMenu.nodeIds)}
                  onClose={() => setContextMenu(null)}
                />
              )}
              {outputConnectorMenu && (
                <WorkflowOutputConnectorMenu
                  x={outputConnectorMenu.x}
                  y={outputConnectorMenu.y}
                  sourcePort={outputConnectorMenu.sourcePort}
                  primitiveTargets={outputConnectorPrimitiveTargets}
                  savedBlockTargets={outputConnectorSavedBlockTargets}
                  onSelectPrimitive={connectOutputToPrimitive}
                  onSelectSavedBlock={connectOutputToSavedBlock}
                  onClose={() => setOutputConnectorMenu(null)}
                />
              )}
            </ReactFlow>
          </div>
        </section>
        <WorkflowDetailsPanel
          workflowLibrary={workflowLibrary}
          activeWorkflow={activeWorkflow}
          nodes={nodes}
          edges={edges}
          selectedNodes={selectedNodes}
          selectedInternalEdgeCount={selectedInternalEdgeCount}
          blockName={blockName}
          blockTags={blockTags}
          onBlockNameChange={setBlockName}
          onBlockTagsChange={setBlockTags}
          onSelectWorkflow={selectWorkflow}
          onCreateWorkflow={createBlankWorkflow}
          onCloneWorkflow={cloneActiveWorkflow}
          onDeleteWorkflow={() => deleteWorkflow(activeWorkflow.id)}
          workflowNameDraft={workflowNameDraft}
          onWorkflowNameDraftChange={setWorkflowNameDraft}
          onCommitWorkflowName={commitActiveWorkflowName}
          onSaveSelectedBlock={saveSelectedBlock}
          onGroupSelected={() => groupNodes(selectedNodeIds)}
          onDeleteSelected={() => deleteWorkflowNodes(selectedNodeIds)}
          onUpdateSelectedGroup={updateGroupDetails}
          onToggleSelectedMinimized={() => setWorkflowNodesMinimized(selectedNodeIds, !selectedNodes.every((node) => node.data.minimized))}
          onUngroupSelected={() => {
            const groupNode = selectedNodes.length === 1 && selectedNodes[0].data.group ? selectedNodes[0] : null;
            if (groupNode) {
              ungroupNode(groupNode.id);
            }
          }}
          onSaveWorkflowVersion={saveActiveWorkflowVersion}
          onRestoreWorkflowVersion={restoreWorkflowVersion}
        />
        </section>
      </WorkflowOutputConnectorContext.Provider>
    </PortTypeColorContext.Provider>
  );
}

function WorkflowComponentSelector({
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
}) {
  return (
    <aside className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Components</h2>
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
              primitiveNodes.map((node) => (
                <WorkflowComponentTile
                  key={node.id}
                  title={node.data.title}
                  subtitle={node.data.packageName}
                  tone={node.data.tone}
                  portSummary={`${node.data.inputs.length} in · ${node.data.outputs.length} out`}
                  tags={node.data.tags ?? []}
                  dragPayload={{ type: "primitive", id: node.id }}
                  onAdd={() => onAddPrimitive(node)}
                />
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
              savedBlocks.map((block) => (
                <WorkflowComponentTile
                  key={block.id}
                  title={block.name}
                  subtitle={`${block.nodes.length} components`}
                  portSummary={`${block.edges.length} connections`}
                  tags={block.tags ?? []}
                  dragPayload={{ type: "block", id: block.id }}
                  onAdd={() => onAddSavedBlock(block)}
                  onDelete={() => onDeleteSavedBlock(block.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function WorkflowComponentTile({
  title,
  subtitle,
  portSummary,
  tags,
  tone = "zinc",
  dragPayload,
  onAdd,
  onDelete,
}: {
  title: string;
  subtitle: string;
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

function WorkflowDetailsPanel({
  workflowLibrary,
  activeWorkflow,
  nodes,
  edges,
  selectedNodes,
  selectedInternalEdgeCount,
  blockName,
  blockTags,
  workflowNameDraft,
  onBlockNameChange,
  onBlockTagsChange,
  onSelectWorkflow,
  onCreateWorkflow,
  onCloneWorkflow,
  onDeleteWorkflow,
  onWorkflowNameDraftChange,
  onCommitWorkflowName,
  onSaveSelectedBlock,
  onGroupSelected,
  onDeleteSelected,
  onUpdateSelectedGroup,
  onToggleSelectedMinimized,
  onUngroupSelected,
  onSaveWorkflowVersion,
  onRestoreWorkflowVersion,
}: {
  workflowLibrary: SavedWorkflowLibrary;
  activeWorkflow: SavedWorkflow;
  nodes: WorkflowNodeModel[];
  edges: Edge[];
  selectedNodes: WorkflowNodeModel[];
  selectedInternalEdgeCount: number;
  blockName: string;
  blockTags: string;
  workflowNameDraft: string;
  onBlockNameChange: (value: string) => void;
  onBlockTagsChange: (value: string) => void;
  onSelectWorkflow: (workflowId: string) => void;
  onCreateWorkflow: () => void;
  onCloneWorkflow: () => void;
  onDeleteWorkflow: () => void;
  onWorkflowNameDraftChange: (value: string) => void;
  onCommitWorkflowName: () => void;
  onSaveSelectedBlock: () => void;
  onGroupSelected: () => void;
  onDeleteSelected: () => void;
  onUpdateSelectedGroup: (nodeId: string, updates: Pick<WorkflowNodeData, "title" | "description">) => void;
  onToggleSelectedMinimized: () => void;
  onUngroupSelected: () => void;
  onSaveWorkflowVersion: () => void;
  onRestoreWorkflowVersion: (version: SavedWorkflowVersion) => void;
}) {
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedGroupNode = selectedNode?.data.group ? selectedNode : null;

  return (
    <aside className="min-h-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
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
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="Inputs" value={String(selectedNode.data.inputs.length)} />
                <Metric label="Outputs" value={String(selectedNode.data.outputs.length)} />
              </div>
            </div>
            <WorkflowPortList title="Inputs" ports={selectedNode.data.inputs} />
            <WorkflowPortList title="Outputs" ports={selectedNode.data.outputs} />
            {selectedGroupNode?.data.group && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs font-semibold uppercase text-zinc-500">Group</div>
                <div className="mt-2 text-sm font-medium text-zinc-900">
                  {selectedGroupNode.data.group.memberCount} components
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={onToggleSelectedMinimized}
                title="Toggle selected component"
              >
                <MinimizeIcon className="h-4 w-4" />
                Toggle
              </button>
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-rose-700 shadow-sm hover:bg-rose-50"
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
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Version" value={`v${activeWorkflow.version}`} />
              <Metric label="Updated" value={formatWorkflowTimestamp(activeWorkflow.updatedAt)} />
              <Metric label="Components" value={String(nodes.length)} />
              <Metric label="Connections" value={String(edges.length)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
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

function WorkflowPortList({ title, ports }: { title: string; ports: FlowPort[] }) {
  const colors = usePortTypeColors();
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">{title}</div>
      <div className="space-y-2">
        {ports.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-xs text-zinc-400">none</div>
        ) : (
          ports.map((portValue) => {
            const color = portTypeColor(portValue.type, colors);
            return (
              <div
                key={`${title}-${portValue.id}-${portValue.type}`}
                className="rounded-md border px-3 py-2 text-xs"
                style={{
                  backgroundColor: hexToRgba(color, 0.08),
                  borderColor: hexToRgba(color, 0.32),
                }}
              >
                <div className="font-medium text-zinc-900">{portValue.label}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase">
                  <span style={{ color: portTypeBadgeTextColor(color) }}>{formatPortType(portValue.type)}</span>
                  {portValue.optional && <span className="text-zinc-500">optional</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SettingsPage({
  portTypeColors,
  onPortTypeColorChange,
  onResetPortTypeColors,
  hotkeyBindings,
  onHotkeyChange,
  onResetHotkeys,
}: {
  portTypeColors: PortTypeColors;
  onPortTypeColorChange: (type: PortType, color: string) => void;
  onResetPortTypeColors: () => void;
  hotkeyBindings: HotkeyBindings;
  onHotkeyChange: (actionId: HotkeyActionId, binding: HotkeyBinding) => void;
  onResetHotkeys: () => void;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <HotkeySettings bindings={hotkeyBindings} onChange={onHotkeyChange} onReset={onResetHotkeys} />
        <PortTypeColorSettings
          colors={portTypeColors}
          onChange={onPortTypeColorChange}
          onReset={onResetPortTypeColors}
        />
      </section>
      <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-950">Active Hotkeys</h2>
        <div className="mt-3 space-y-2">
          {hotkeyActions.map((action) => (
            <div
              key={action.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
            >
              <span className="min-w-0 truncate font-medium text-zinc-900">{action.label}</span>
              <kbd className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700">
                {formatHotkeyBinding(hotkeyBindings[action.id])}
              </kbd>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-zinc-200 pt-4">
          <h2 className="text-sm font-semibold text-zinc-950">Type Preview</h2>
          <div className="mt-3 space-y-2">
            {portTypes.slice(0, 8).map((type) => {
              const color = portTypeColor(type, portTypeColors);
              return (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                  style={{ borderColor: hexToRgba(color, 0.32), backgroundColor: hexToRgba(color, 0.08) }}
                >
                  <span className="font-medium text-zinc-900">{formatPortType(type)}</span>
                  <span className="h-4 w-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: color }} />
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}

function HotkeySettings({
  bindings,
  onChange,
  onReset,
}: {
  bindings: HotkeyBindings;
  onChange: (actionId: HotkeyActionId, binding: HotkeyBinding) => void;
  onReset: () => void;
}) {
  const [recordingActionId, setRecordingActionId] = useState<HotkeyActionId | null>(null);
  const conflicts = hotkeyBindingConflicts(bindings);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">Hotkeys</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          onClick={onReset}
          title="Reset hotkeys"
          aria-label="Reset hotkeys"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 overflow-hidden rounded-md border border-zinc-200">
        {hotkeyActions.map((action, index) => {
          const recording = recordingActionId === action.id;
          const conflict = conflicts.has(action.id);
          return (
            <div
              key={action.id}
              className={classNames(
                "grid min-h-12 grid-cols-[minmax(0,1fr)_128px] items-center gap-3 px-3 py-2 text-xs",
                index > 0 && "border-t border-zinc-200",
                conflict ? "bg-amber-50" : "bg-white",
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-zinc-900">{action.label}</div>
                <div className={classNames("mt-0.5 text-[11px]", conflict ? "text-amber-700" : "text-zinc-500")}>
                  {conflict ? "Conflict" : action.scope}
                </div>
              </div>
              <button
                type="button"
                className={classNames(
                  "inline-flex h-8 items-center justify-center rounded-md border px-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
                  recording
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-zinc-50 text-zinc-800 hover:bg-white",
                )}
                onClick={() => setRecordingActionId(action.id)}
                onBlur={() => {
                  if (recording) {
                    setRecordingActionId(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (!recording) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    setRecordingActionId(null);
                    return;
                  }
                  const binding = hotkeyBindingFromKeyboardEvent(event);
                  if (!binding) {
                    return;
                  }
                  onChange(action.id, binding);
                  setRecordingActionId(null);
                }}
                title={`${action.label} hotkey`}
                aria-label={`${action.label} hotkey`}
              >
                {recording ? "Recording" : formatHotkeyBinding(bindings[action.id])}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PortTypeColorSettings({
  colors,
  onChange,
  onReset,
}: {
  colors: PortTypeColors;
  onChange: (type: PortType, color: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 border-t border-zinc-200 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">Type Colors</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
          onClick={onReset}
          title="Reset type colors"
          aria-label="Reset type colors"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 max-h-56 space-y-1 overflow-auto pr-1">
        {portTypes.map((type) => {
          const color = colors[type];
          return (
            <label
              key={type}
              className="flex h-9 items-center gap-2 rounded-md border px-2 text-xs"
              style={{
                borderColor: hexToRgba(color, 0.28),
                backgroundColor: hexToRgba(color, 0.08),
              }}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-white shadow-sm"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{formatPortType(type)}</span>
              <input
                type="color"
                className="h-7 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                value={color}
                onChange={(event) => onChange(type, event.target.value)}
                title={`${formatPortType(type)} color`}
                aria-label={`${formatPortType(type)} color`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function createSavedWorkflowBlock(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  requestedName: string,
  requestedTags = "",
): SavedWorkflowBlock | null {
  if (selectedNodes.length < 2) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = requestedName.trim() || defaultWorkflowBlockName(selectedNodes);
  const tags = parseWorkflowTags(requestedTags);

  return {
    id: createWorkflowBlockId(),
    name,
    createdAt: new Date().toISOString(),
    tags: tags.length > 0 ? tags : tagsForWorkflowNodes(selectedNodes),
    nodes: selectedNodes.map((node) => ({
      id: node.id,
      position: {
        x: node.position.x - minX,
        y: node.position.y - minY,
      },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
    })),
  };
}

function createWorkflowClipboardState(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
): WorkflowClipboardState | null {
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = selectedNodes.length === 1 ? selectedNodes[0].data.title : defaultWorkflowBlockName(selectedNodes);

  return {
    block: {
      id: createWorkflowBlockId(),
      name,
      createdAt: new Date().toISOString(),
      tags: tagsForWorkflowNodes(selectedNodes),
      nodes: selectedNodes.map((node) => ({
        id: node.id,
        position: {
          x: node.position.x - minX,
          y: node.position.y - minY,
        },
        data: cloneWorkflowNodeData(node.data),
      })),
      edges: edges
        .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
    },
    anchor: { x: minX, y: minY },
    pasteCount: 0,
  };
}

function createWorkflowGroup(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  requestedName: string,
): { node: WorkflowNodeModel; edges: Edge[]; groupedNodeCount: number } | null {
  if (selectedNodes.length < 2) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = requestedName.trim() || defaultWorkflowBlockName(selectedNodes);
  const groupId = createWorkflowBlockId();
  const internalEdges = edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const incomingEdges = edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoingEdges = edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const inputPorts: FlowPort[] = [];
  const outputPorts: FlowPort[] = [];
  const inputBoundaries: WorkflowGroupBoundary[] = [];
  const outputBoundaries: WorkflowGroupBoundary[] = [];

  for (const node of selectedNodes) {
    for (const input of node.data.inputs) {
      const handle = handleId("in", input);
      const hasInternalEdge = internalEdges.some((edge) => edge.target === node.id && edge.targetHandle === handle);
      const hasIncomingEdge = incomingEdges.some((edge) => edge.target === node.id && edge.targetHandle === handle);
      if (!hasInternalEdge || hasIncomingEdge) {
        const wrapperPort = groupBoundaryPort("in", node, input);
        inputPorts.push(wrapperPort);
        inputBoundaries.push({ wrapperPortId: wrapperPort.id, nodeId: node.id, handle, type: input.type });
      }
    }

    for (const output of node.data.outputs) {
      const handle = handleId("out", output);
      const hasInternalEdge = internalEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      const hasOutgoingEdge = outgoingEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      if (!hasInternalEdge || hasOutgoingEdge) {
        const wrapperPort = groupBoundaryPort("out", node, output);
        outputPorts.push(wrapperPort);
        outputBoundaries.push({ wrapperPortId: wrapperPort.id, nodeId: node.id, handle, type: output.type });
      }
    }
  }

  const inputBoundaryByHandle = new Map(inputBoundaries.map((boundary) => [boundaryKey(boundary.nodeId, boundary.handle), boundary]));
  const outputBoundaryByHandle = new Map(outputBoundaries.map((boundary) => [boundaryKey(boundary.nodeId, boundary.handle), boundary]));
  const groupNode: WorkflowNodeModel = {
    id: groupId,
    type: "workflow",
    position: { x: Math.max(0, minX), y: Math.max(0, minY) },
    data: {
      title: name,
      packageName: "Component Group",
      description: `${selectedNodes.length} components abstracted behind boundary ports.`,
      tone: "zinc",
      inputs: dedupePorts(inputPorts),
      outputs: dedupePorts(outputPorts),
      tags: tagsForWorkflowNodes(selectedNodes),
      size: { width: defaultWorkflowNodeWidth, height: defaultWorkflowGroupHeight },
      kind: "group",
      group: {
        memberCount: selectedNodes.length,
        nodes: selectedNodes.map((node) => ({
          id: node.id,
          position: {
            x: node.position.x - minX,
            y: node.position.y - minY,
          },
          data: cloneWorkflowNodeData(node.data),
        })),
        edges: internalEdges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        })),
        inputBoundaries,
        outputBoundaries,
      },
    },
  };

  const visibleEdges = edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const reroutedIncomingEdges = incomingEdges.flatMap((edge) => {
    const boundary = inputBoundaryByHandle.get(boundaryKey(edge.target, edge.targetHandle));
    if (!boundary) {
      return [];
    }
    const wrapperPort = groupNode.data.inputs.find((candidate) => candidate.id === boundary.wrapperPortId);
    if (!wrapperPort) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? null,
          target: groupId,
          targetHandle: handleId("in", wrapperPort),
        },
        boundary.type,
      ),
    ];
  });
  const reroutedOutgoingEdges = outgoingEdges.flatMap((edge) => {
    const boundary = outputBoundaryByHandle.get(boundaryKey(edge.source, edge.sourceHandle));
    if (!boundary) {
      return [];
    }
    const wrapperPort = groupNode.data.outputs.find((candidate) => candidate.id === boundary.wrapperPortId);
    if (!wrapperPort) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source: groupId,
          sourceHandle: handleId("out", wrapperPort),
          target: edge.target,
          targetHandle: edge.targetHandle ?? null,
        },
        boundary.type,
      ),
    ];
  });

  return {
    node: groupNode,
    edges: dedupeEdges(visibleEdges.concat(reroutedIncomingEdges, reroutedOutgoingEdges)),
    groupedNodeCount: selectedNodes.length,
  };
}

function restoreWorkflowGroup(
  groupNode: WorkflowNodeModel,
  currentNodes: WorkflowNodeModel[],
  currentEdges: Edge[],
): { nodes: WorkflowNodeModel[]; edges: Edge[]; restoredNodeIds: string[] } {
  const group = groupNode.data.group;
  if (!group) {
    return { nodes: currentNodes, edges: currentEdges, restoredNodeIds: [] };
  }

  const occupiedIds = new Set(currentNodes.filter((node) => node.id !== groupNode.id).map((node) => node.id));
  const idByOriginalId = new Map<string, string>();
  for (const node of group.nodes) {
    const restoredId = occupiedIds.has(node.id) ? `${groupNode.id}-${safeFlowId(node.id)}` : node.id;
    occupiedIds.add(restoredId);
    idByOriginalId.set(node.id, restoredId);
  }

  const restoredNodes: WorkflowNodeModel[] = group.nodes.map((node) => ({
    id: idByOriginalId.get(node.id)!,
    type: "workflow",
    position: {
      x: groupNode.position.x + node.position.x,
      y: groupNode.position.y + node.position.y,
    },
    data: cloneWorkflowNodeData(node.data),
    selected: true,
  }));
  const restoredNodeIds = restoredNodes.map((node) => node.id);
  const inputBoundaryByPort = new Map(group.inputBoundaries.map((boundary) => [boundary.wrapperPortId, boundary]));
  const outputBoundaryByPort = new Map(group.outputBoundaries.map((boundary) => [boundary.wrapperPortId, boundary]));
  const edgesWithoutGroup = currentEdges.filter((edge) => edge.source !== groupNode.id && edge.target !== groupNode.id);
  const restoredInternalEdges = group.edges.flatMap((edge) => {
    const source = idByOriginalId.get(edge.source);
    const target = idByOriginalId.get(edge.target);
    if (!source || !target) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source,
          sourceHandle: edge.sourceHandle ?? null,
          target,
          targetHandle: edge.targetHandle ?? null,
        },
        parseHandleId(edge.sourceHandle ?? "")?.type ?? parseHandleId(edge.targetHandle ?? "")?.type ?? "run_config",
      ),
    ];
  });
  const restoredExternalEdges = currentEdges.flatMap((edge) => {
    if (edge.target === groupNode.id && edge.targetHandle) {
      const parsed = parseHandleId(edge.targetHandle);
      const boundary = parsed ? inputBoundaryByPort.get(parsed.portId) : null;
      const target = boundary ? idByOriginalId.get(boundary.nodeId) : null;
      if (!boundary || !target) {
        return [];
      }
      return [
        workflowEdgeFromConnection(
          {
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? null,
            target,
            targetHandle: boundary.handle ?? null,
          },
          boundary.type,
        ),
      ];
    }
    if (edge.source === groupNode.id && edge.sourceHandle) {
      const parsed = parseHandleId(edge.sourceHandle);
      const boundary = parsed ? outputBoundaryByPort.get(parsed.portId) : null;
      const source = boundary ? idByOriginalId.get(boundary.nodeId) : null;
      if (!boundary || !source) {
        return [];
      }
      return [
        workflowEdgeFromConnection(
          {
            source,
            sourceHandle: boundary.handle ?? null,
            target: edge.target,
            targetHandle: edge.targetHandle ?? null,
          },
          boundary.type,
        ),
      ];
    }
    return [];
  });

  const remainingNodes: WorkflowNodeModel[] = currentNodes
    .filter((node) => node.id !== groupNode.id)
    .map((node) => ({ ...node, selected: false }));

  return {
    nodes: remainingNodes.concat(restoredNodes),
    edges: dedupeEdges(edgesWithoutGroup.concat(restoredInternalEdges, restoredExternalEdges)),
    restoredNodeIds,
  };
}

function instantiateSavedWorkflowBlock(
  block: SavedWorkflowBlock,
  anchor: { x: number; y: number },
): { nodes: WorkflowNodeModel[]; edges: Edge[]; idByOriginalId: Map<string, string> } {
  const instanceId = createWorkflowBlockId();
  const idByOriginalId = new Map(block.nodes.map((node) => [node.id, `${instanceId}-${safeFlowId(node.id)}`]));
  const nodes = block.nodes.map((node) => ({
    id: idByOriginalId.get(node.id)!,
    type: "workflow" as const,
    position: {
      x: anchor.x + node.position.x,
      y: anchor.y + node.position.y,
    },
    data: cloneWorkflowNodeData(node.data),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = block.edges.flatMap((edge) => {
    const source = idByOriginalId.get(edge.source);
    const target = idByOriginalId.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourcePort = findPort(nodes, source, edge.sourceHandle, "out");
    const targetPort = findPort(nodes, target, edge.targetHandle, "in");
    const edgeType = sourcePort?.type ?? targetPort?.type ?? "run_config";
    if (!nodeById.has(source) || !nodeById.has(target)) {
      return [];
    }
    return [
      workflowEdgeFromConnection(
        {
          source,
          target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        },
        edgeType,
      ),
    ];
  });

  return { nodes, edges, idByOriginalId };
}

function cloneWorkflowNodeData(data: WorkflowNodeData): WorkflowNodeData {
  const cloned: WorkflowNodeData = {
    title: data.title,
    packageName: data.packageName,
    description: data.description,
    tone: data.tone,
    inputs: data.inputs.map(cloneFlowPort),
    outputs: data.outputs.map(cloneFlowPort),
  };
  if (data.tags) {
    cloned.tags = normalizeWorkflowTags(data.tags);
  }
  if (data.size) {
    cloned.size = { ...data.size };
  }
  if (data.kind) {
    cloned.kind = data.kind;
  }
  if (data.group) {
    cloned.group = cloneWorkflowGroupMetadata(data.group);
  }
  if (data.minimized) {
    cloned.minimized = true;
  }
  return cloned;
}

function cloneFlowPort(portValue: FlowPort): FlowPort {
  return portValue.optional ? { ...portValue, optional: true } : { ...portValue };
}

function cloneWorkflowGroupMetadata(group: WorkflowGroupMetadata): WorkflowGroupMetadata {
  return {
    memberCount: group.memberCount,
    nodes: group.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: group.edges.map((edge) => ({ ...edge })),
    inputBoundaries: group.inputBoundaries.map((boundary) => ({ ...boundary })),
    outputBoundaries: group.outputBoundaries.map((boundary) => ({ ...boundary })),
  };
}

function groupBoundaryPort(direction: PortDirection, node: WorkflowNodeModel, portValue: FlowPort): FlowPort {
  return {
    id: `${direction}-${safeFlowId(node.id)}-${safeFlowId(portValue.id)}`,
    label: `${node.data.title}: ${portValue.label}`,
    type: portValue.type,
    optional: portValue.optional,
  };
}

function boundaryKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}|${handle ?? ""}`;
}

function dedupePorts(ports: FlowPort[]): FlowPort[] {
  const seen = new Set<string>();
  return ports.filter((portValue) => {
    const key = `${portValue.id}|${portValue.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

function nextBlockAnchor(nodes: WorkflowNodeModel[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 80, y: 80 };
  }
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 420, y: Math.max(40, minY) };
}

function connectedWorkflowNodePosition(sourceNode: WorkflowNodeModel, nodes: WorkflowNodeModel[]): { x: number; y: number } {
  const sourceSize = normalizedWorkflowNodeSize(sourceNode.data.size);
  const sourceWidth = sourceNode.data.minimized ? 230 : sourceSize?.width ?? defaultWorkflowNodeWidth;
  const basePosition = {
    x: sourceNode.position.x + sourceWidth + 140,
    y: sourceNode.position.y,
  };
  return avoidOccupiedWorkflowPosition(basePosition, nodes);
}

function avoidOccupiedWorkflowPosition(position: { x: number; y: number }, nodes: WorkflowNodeModel[]): { x: number; y: number } {
  let y = position.y;
  for (let attempts = 0; attempts < 12; attempts += 1) {
    const occupied = nodes.some(
      (node) => Math.abs(node.position.x - position.x) < 90 && Math.abs(node.position.y - y) < 90,
    );
    if (!occupied) {
      return { x: position.x, y };
    }
    y += 96;
  }
  return { x: position.x, y };
}

function defaultWorkflowBlockName(nodes: WorkflowNodeModel[]): string {
  const [firstNode, secondNode] = nodes;
  if (!firstNode || !secondNode) {
    return "Saved Component";
  }
  if (nodes.length === 2) {
    return `${firstNode.data.title} + ${secondNode.data.title}`;
  }
  return `${firstNode.data.title} + ${nodes.length - 1} more`;
}

function workflowHasChangesSinceLatestVersion(
  workflow: SavedWorkflow,
  name: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
): boolean {
  const latestVersion = latestSavedWorkflowVersion(workflow);
  if (!latestVersion) {
    return true;
  }
  return workflowVersionSnapshot(name, nodes, edges) !== savedWorkflowVersionSnapshot(latestVersion);
}

function latestSavedWorkflowVersion(workflow: SavedWorkflow): SavedWorkflowVersion | null {
  const versions = Array.isArray(workflow.versions) ? workflow.versions : [];
  return versions.reduce<SavedWorkflowVersion | null>(
    (latest, version) => (!latest || version.version > latest.version ? version : latest),
    null,
  );
}

function workflowVersionSnapshot(name: string, nodes: WorkflowNodeModel[], edges: Edge[]): string {
  return JSON.stringify({
    name,
    nodes: nodes
      .map(serializeWorkflowNode)
      .map(comparableWorkflowNode)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(serializeWorkflowEdge)
      .map(comparableWorkflowEdge)
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle ?? ""}|${a.target}|${a.targetHandle ?? ""}`.localeCompare(
          `${b.source}|${b.sourceHandle ?? ""}|${b.target}|${b.targetHandle ?? ""}`,
        ),
      ),
  });
}

function savedWorkflowVersionSnapshot(version: SavedWorkflowVersion): string {
  return JSON.stringify({
    name: version.name,
    nodes: version.nodes.map(comparableWorkflowNode).sort((a, b) => a.id.localeCompare(b.id)),
    edges: version.edges
      .map(comparableWorkflowEdge)
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle ?? ""}|${a.target}|${a.targetHandle ?? ""}`.localeCompare(
          `${b.source}|${b.sourceHandle ?? ""}|${b.target}|${b.targetHandle ?? ""}`,
        ),
      ),
  });
}

function comparableWorkflowNode(node: SavedWorkflowBlockNode): SavedWorkflowBlockNode {
  return {
    id: node.id,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
  };
}

function comparableWorkflowEdge(edge: SavedWorkflowBlockEdge): SavedWorkflowBlockEdge {
  return {
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  };
}

function downloadWorkflowJson(workflow: SavedWorkflow, nodes: WorkflowNodeModel[], edges: Edge[]) {
  if (typeof document === "undefined") {
    return;
  }

  const lastUpdated = new Date().toISOString();
  const payload: SavedWorkflowFile = {
    format: savedWorkflowJsonFormat,
    version: savedWorkflowJsonVersion,
    lastUpdated,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `video-analysis-workflow-${safeFlowId(workflow.name).toLowerCase()}-v${workflow.version}-${fileDateStamp(lastUpdated)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseWorkflowJson(text: string): { lastUpdated: string; nodes: WorkflowNodeModel[]; edges: Edge[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (!isSavedWorkflowFile(parsed)) {
    throw new Error("JSON does not match the workflow format");
  }
  if (parsed.format !== savedWorkflowJsonFormat) {
    throw new Error("JSON is not a workflow file");
  }
  if (parsed.version !== savedWorkflowJsonVersion) {
    throw new Error(`Unsupported workflow version ${parsed.version}`);
  }

  const nodes = parsed.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  if (!hasUniqueWorkflowNodeIds(nodes)) {
    throw new Error("Workflow contains duplicate component IDs");
  }

  const edges = parsed.edges.map((edge) => restoreSavedWorkflowEdge(edge, nodes));
  if (edges.some((edge) => edge === null)) {
    throw new Error("Workflow contains invalid connections");
  }

  return {
    lastUpdated: parsed.lastUpdated,
    nodes,
    edges: dedupeEdges(edges.filter((edge): edge is Edge => edge !== null)),
  };
}

function serializeWorkflowNode(node: WorkflowNodeModel): SavedWorkflowBlockNode {
  return {
    id: node.id,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
  };
}

function serializeWorkflowEdge(edge: Edge): SavedWorkflowBlockEdge {
  return {
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

function restoreSavedWorkflowEdge(edge: SavedWorkflowBlockEdge, nodes: WorkflowNodeModel[]): Edge | null {
  const sourcePort = findPort(nodes, edge.source, edge.sourceHandle, "out");
  const targetPort = findPort(nodes, edge.target, edge.targetHandle, "in");
  if (!sourcePort || !targetPort || !portTypesCompatible(sourcePort.type, targetPort.type)) {
    return null;
  }

  return workflowEdgeFromConnection(
    {
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    },
    sourcePort.type,
  );
}

function hasUniqueWorkflowNodeIds(nodes: WorkflowNodeModel[]): boolean {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) {
      return false;
    }
    ids.add(node.id);
  }
  return true;
}

function formatWorkflowTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function loadSavedWorkflowLibrary(): SavedWorkflowLibrary {
  const fallback = seedSavedWorkflowLibrary();
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(savedWorkflowsStorageKey);
    if (!raw) {
      persistSavedWorkflowLibrary(fallback);
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!isSavedWorkflowLibrary(parsed)) {
      persistSavedWorkflowLibrary(fallback);
      return fallback;
    }

    const workflows = parsed.workflows.filter(savedWorkflowHasValidGraph).map(normalizeSavedWorkflow);
    if (workflows.length === 0) {
      persistSavedWorkflowLibrary(fallback);
      return fallback;
    }

    const activeWorkflowId = workflows.some((workflow) => workflow.id === parsed.activeWorkflowId)
      ? parsed.activeWorkflowId
      : workflows[0].id;
    const library: SavedWorkflowLibrary = {
      format: savedWorkflowsJsonFormat,
      version: savedWorkflowsJsonVersion,
      activeWorkflowId,
      workflows,
    };
    persistSavedWorkflowLibrary(library);
    return library;
  } catch {
    persistSavedWorkflowLibrary(fallback);
    return fallback;
  }
}

function persistSavedWorkflowLibrary(library: SavedWorkflowLibrary) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowsStorageKey, JSON.stringify(library));
}

function seedSavedWorkflowLibrary(): SavedWorkflowLibrary {
  const workflow = createSavedWorkflow(defaultSeedWorkflowName, initialWorkflowNodes, initialWorkflowEdges);
  return {
    format: savedWorkflowsJsonFormat,
    version: savedWorkflowsJsonVersion,
    activeWorkflowId: workflow.id,
    workflows: [workflow],
  };
}

function normalizeSavedWorkflow(workflow: SavedWorkflow): SavedWorkflow {
  const name = workflow.name === legacySeedWorkflowName ? defaultSeedWorkflowName : workflow.name;
  const savedVersions = Array.isArray(workflow.versions) ? workflow.versions : [];
  const currentVersion = typeof workflow.version === "number" ? workflow.version : 1;
  const version = Math.max(
    1,
    currentVersion,
    ...savedVersions.map((savedVersion) => savedVersion.version),
  );
  const validVersions = savedVersions
    .filter(savedWorkflowVersionHasValidGraph)
    .sort((a, b) => b.version - a.version)
    .slice(0, maxSavedWorkflowVersions);
  const versions =
    validVersions.length > 0
      ? validVersions
      : [
          {
            id: createWorkflowVersionId(),
            version,
            name,
            createdAt: workflow.updatedAt,
            nodes: workflow.nodes.map((node) => ({
              id: node.id,
              position: { ...node.position },
              data: cloneWorkflowNodeData(node.data),
            })),
            edges: workflow.edges.map((edge) => ({ ...edge })),
          },
        ];
  return {
    ...workflow,
    name,
    version: Math.max(version, ...versions.map((savedVersion) => savedVersion.version)),
    versions,
    updatedAt: workflow.name === legacySeedWorkflowName ? new Date().toISOString() : workflow.updatedAt,
  };
}

function createSavedWorkflow(name: string, nodes: WorkflowNodeModel[], edges: Edge[]): SavedWorkflow {
  const createdAt = new Date().toISOString();
  const workflow: SavedWorkflow = {
    id: createWorkflowId(),
    name,
    createdAt,
    updatedAt: createdAt,
    version: 1,
    versions: [],
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
  const version = createSavedWorkflowVersion(workflow, name, nodes, edges, 1, createdAt);
  return {
    ...workflow,
    versions: [version],
  };
}

function createSavedWorkflowVersion(
  workflow: SavedWorkflow,
  name: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  versionNumber = nextSavedWorkflowVersionNumber(workflow),
  createdAt = new Date().toISOString(),
): SavedWorkflowVersion {
  return {
    id: createWorkflowVersionId(),
    version: versionNumber,
    name,
    createdAt,
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
}

function nextSavedWorkflowVersionNumber(workflow: SavedWorkflow): number {
  const savedVersions = Array.isArray(workflow.versions) ? workflow.versions : [];
  const currentVersion = typeof workflow.version === "number" ? workflow.version : 0;
  return Math.max(0, currentVersion, ...savedVersions.map((version) => version.version)) + 1;
}

function createBlankSavedWorkflow(name = "Untitled Workflow"): SavedWorkflow {
  return createSavedWorkflow(name, [], []);
}

function activeSavedWorkflow(library: SavedWorkflowLibrary): SavedWorkflow {
  return library.workflows.find((workflow) => workflow.id === library.activeWorkflowId) ?? library.workflows[0];
}

function workflowStateFromSavedWorkflow(workflow: SavedWorkflow): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
  const nodes: WorkflowNodeModel[] = workflow.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  const edges = workflow.edges
    .map((edge) => restoreSavedWorkflowEdge(edge, nodes))
    .filter((edge): edge is Edge => edge !== null);
  return { nodes, edges: dedupeEdges(edges) };
}

function savedWorkflowHasValidGraph(workflow: SavedWorkflow): boolean {
  const nodes = workflow.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  return hasUniqueWorkflowNodeIds(nodes) && workflow.edges.every((edge) => restoreSavedWorkflowEdge(edge, nodes) !== null);
}

function savedWorkflowVersionHasValidGraph(version: SavedWorkflowVersion): boolean {
  const nodes = version.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  return hasUniqueWorkflowNodeIds(nodes) && version.edges.every((edge) => restoreSavedWorkflowEdge(edge, nodes) !== null);
}

function loadSavedWorkflowRuns(): SavedWorkflowRun[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(savedWorkflowRunsStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSavedWorkflowRun).slice(0, 50);
  } catch {
    return [];
  }
}

function persistSavedWorkflowRuns(runs: SavedWorkflowRun[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowRunsStorageKey, JSON.stringify(runs.slice(0, 50)));
}

function createSavedWorkflowRun(
  workflow: SavedWorkflow,
  request: YoutubeRunRequest,
  inputSummary: string,
): SavedWorkflowRun {
  const createdAt = new Date().toISOString();
  return {
    id: createWorkflowRunId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    createdAt,
    updatedAt: createdAt,
    status: "running",
    inputSummary,
    request,
    message: "Starting local analysis",
  };
}

function workflowRunFromRunRecord(run: SavedWorkflowRun, record: RunRecord): SavedWorkflowRun {
  return {
    ...run,
    backendRunId: record.run_id,
    reportPath: record.report_path,
    status: record.status,
    updatedAt: record.updated_at,
    message: record.message,
  };
}

function loadSavedWorkflowBlocks(): SavedWorkflowBlock[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(savedWorkflowBlocksStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSavedWorkflowBlock).map(normalizeSavedWorkflowBlock);
  } catch {
    return [];
  }
}

function persistSavedWorkflowBlocks(blocks: SavedWorkflowBlock[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowBlocksStorageKey, JSON.stringify(blocks));
}

function downloadSavedWorkflowBlocksJson(blocks: SavedWorkflowBlock[]) {
  if (typeof document === "undefined") {
    return;
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    format: savedWorkflowBlocksJsonFormat,
    version: 1,
    exportedAt,
    blocks,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `video-analysis-components-${fileDateStamp(exportedAt)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseSavedWorkflowBlocksJson(text: string): SavedWorkflowBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  const candidates = savedWorkflowBlockJsonCandidates(parsed);
  if (!candidates || candidates.length === 0) {
    throw new Error("No components found in JSON");
  }
  if (!candidates.every(isSavedWorkflowBlock)) {
    throw new Error("JSON does not match the component format");
  }
  return candidates.map(cloneImportedSavedWorkflowBlock);
}

function savedWorkflowBlockJsonCandidates(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  if (Array.isArray(value.blocks)) {
    return value.blocks;
  }
  if (isSavedWorkflowBlock(value)) {
    return [value];
  }
  return null;
}

function cloneImportedSavedWorkflowBlock(block: SavedWorkflowBlock): SavedWorkflowBlock {
  return {
    id: createWorkflowBlockId(),
    name: block.name,
    createdAt: new Date().toISOString(),
    tags: normalizeWorkflowTags(block.tags ?? tagsForSavedWorkflowBlock(block)),
    nodes: block.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: block.edges.map((edge) => ({ ...edge })),
  };
}

function normalizeSavedWorkflowBlock(block: SavedWorkflowBlock): SavedWorkflowBlock {
  return {
    ...block,
    tags: normalizeWorkflowTags(block.tags ?? tagsForSavedWorkflowBlock(block)),
    nodes: block.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: block.edges.map((edge) => ({ ...edge })),
  };
}

function mergeSavedWorkflowBlocks(
  importedBlocks: SavedWorkflowBlock[],
  currentBlocks: SavedWorkflowBlock[],
): SavedWorkflowBlock[] {
  return importedBlocks.concat(currentBlocks).slice(0, 24);
}

function fileDateStamp(isoDate: string): string {
  return isoDate.slice(0, 19).replace(/[:T]/g, "-");
}

function isSavedWorkflowBlock(value: unknown): value is SavedWorkflowBlock {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    (value.tags === undefined || isWorkflowTags(value.tags)) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflow(value: unknown): value is SavedWorkflow {
  if (!isRecord(value)) {
    return false;
  }
  const versionValid = value.version === undefined || typeof value.version === "number";
  const versionsValid =
    value.versions === undefined ||
    (Array.isArray(value.versions) && value.versions.every(isSavedWorkflowVersion));
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    versionValid &&
    versionsValid &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflowVersion(value: unknown): value is SavedWorkflowVersion {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.version === "number" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflowRun(value: unknown): value is SavedWorkflowRun {
  if (!isRecord(value)) {
    return false;
  }
  const backendRunIdValid = value.backendRunId === undefined || typeof value.backendRunId === "string";
  const reportPathValid = value.reportPath === undefined || typeof value.reportPath === "string";
  const messageValid = value.message === undefined || value.message === null || typeof value.message === "string";
  const workflowVersionValid = value.workflowVersion === undefined || typeof value.workflowVersion === "number";
  return (
    typeof value.id === "string" &&
    typeof value.workflowId === "string" &&
    typeof value.workflowName === "string" &&
    workflowVersionValid &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isRunStatus(value.status) &&
    typeof value.inputSummary === "string" &&
    isYoutubeRunRequest(value.request) &&
    backendRunIdValid &&
    reportPathValid &&
    messageValid
  );
}

function isSavedWorkflowLibrary(value: unknown): value is SavedWorkflowLibrary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.format === savedWorkflowsJsonFormat &&
    value.version === savedWorkflowsJsonVersion &&
    typeof value.activeWorkflowId === "string" &&
    Array.isArray(value.workflows) &&
    value.workflows.every(isSavedWorkflow)
  );
}

function isSavedWorkflowFile(value: unknown): value is SavedWorkflowFile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.format === "string" &&
    typeof value.version === "number" &&
    typeof value.lastUpdated === "string" &&
    (value.workflowName === undefined || typeof value.workflowName === "string") &&
    (value.workflowVersion === undefined || typeof value.workflowVersion === "number") &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge)
  );
}

function isSavedWorkflowBlockNode(value: unknown): value is SavedWorkflowBlockNode {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.position)) {
    return false;
  }
  return (
    typeof value.position.x === "number" &&
    typeof value.position.y === "number" &&
    isWorkflowNodeData(value.data)
  );
}

function isSavedWorkflowBlockEdge(value: unknown): value is SavedWorkflowBlockEdge {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.target !== "string") {
    return false;
  }
  const sourceHandleValid =
    value.sourceHandle === null || value.sourceHandle === undefined || typeof value.sourceHandle === "string";
  const targetHandleValid =
    value.targetHandle === null || value.targetHandle === undefined || typeof value.targetHandle === "string";
  return sourceHandleValid && targetHandleValid;
}

function isWorkflowNodeData(value: unknown): value is WorkflowNodeData {
  if (!isRecord(value)) {
    return false;
  }
  const kindValid = value.kind === undefined || value.kind === "step" || value.kind === "group";
  const groupValid = value.group === undefined || isWorkflowGroupMetadata(value.group);
  const minimizedValid = value.minimized === undefined || typeof value.minimized === "boolean";
  const tagsValid = value.tags === undefined || isWorkflowTags(value.tags);
  const sizeValid = value.size === undefined || isWorkflowNodeSize(value.size);
  return (
    typeof value.title === "string" &&
    typeof value.packageName === "string" &&
    typeof value.description === "string" &&
    isFlowTone(value.tone) &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isFlowPort) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isFlowPort) &&
    tagsValid &&
    sizeValid &&
    kindValid &&
    groupValid &&
    minimizedValid
  );
}

function isWorkflowGroupMetadata(value: unknown): value is WorkflowGroupMetadata {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.memberCount === "number" &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isSavedWorkflowBlockNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isSavedWorkflowBlockEdge) &&
    Array.isArray(value.inputBoundaries) &&
    value.inputBoundaries.every(isWorkflowGroupBoundary) &&
    Array.isArray(value.outputBoundaries) &&
    value.outputBoundaries.every(isWorkflowGroupBoundary)
  );
}

function isWorkflowGroupBoundary(value: unknown): value is WorkflowGroupBoundary {
  if (!isRecord(value)) {
    return false;
  }
  const handleValid = value.handle === null || value.handle === undefined || typeof value.handle === "string";
  return (
    typeof value.wrapperPortId === "string" &&
    typeof value.nodeId === "string" &&
    handleValid &&
    typeof value.type === "string" &&
    isPortType(value.type)
  );
}

function isFlowPort(value: unknown): value is FlowPort {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.type === "string" &&
    isPortType(value.type) &&
    (value.optional === undefined || typeof value.optional === "boolean")
  );
}

function isWorkflowTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === "string");
}

function isWorkflowNodeSize(value: unknown): value is WorkflowNodeSize {
  return (
    isRecord(value) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height)
  );
}

function isFlowTone(value: unknown): value is FlowTone {
  return (
    value === "sky" ||
    value === "rose" ||
    value === "amber" ||
    value === "emerald" ||
    value === "violet" ||
    value === "cyan" ||
    value === "indigo" ||
    value === "fuchsia" ||
    value === "slate" ||
    value === "zinc"
  );
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "canceled";
}

function isYoutubeRunRequest(value: unknown): value is YoutubeRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.transcription) || !isRecord(value.models)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    typeof value.scene_threshold === "number" &&
    typeof value.min_scene_len === "number" &&
    (value.max_frames === undefined || value.max_frames === null || typeof value.max_frames === "number") &&
    typeof value.visual_sample_every === "number" &&
    typeof value.transcription.enabled === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createWorkflowBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `block-${crypto.randomUUID()}`;
  }
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createWorkflowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-${crypto.randomUUID()}`;
  }
  return `workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createWorkflowVersionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-version-${crypto.randomUUID()}`;
  }
  return `workflow-version-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createWorkflowRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-run-${crypto.randomUUID()}`;
  }
  return `workflow-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function createWorkflowNodeInstanceId(baseId: string): string {
  const safeBaseId = safeFlowId(baseId) || "node";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${safeBaseId}-${crypto.randomUUID()}`;
  }
  return `${safeBaseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeFlowId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function WorkflowNode({ id, data, selected, isConnectable }: NodeProps) {
  const nodeData = data as unknown as WorkflowNodeData;
  const minimized = nodeData.minimized === true;
  const { updateNodeData } = useReactFlow<WorkflowNodeModel, Edge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const isGroup = nodeData.kind === "group";
  const groupSize = isGroup ? normalizedWorkflowNodeSize(nodeData.size) : null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [groupSize?.height, groupSize?.width, id, minimized, nodeData.inputs.length, nodeData.outputs.length, updateNodeInternals]);

  const toggleMinimized = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    updateNodeData(id, { minimized: !minimized });
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
      className={classNames(
        minimized
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
      )}
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
    <div className="relative border-t border-zinc-100 bg-white" style={{ height }}>
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
            title={`${port.label} ${formatPortType(port.type)}`}
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
  const color = portTypeColor(port.type, colors);

  return (
    <div
      className={classNames("relative rounded-md border px-2 py-1.5", isInput ? "pl-3" : "pr-3")}
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
            {formatPortType(port.type)}
          </span>
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

function WorkflowContextMenu({
  x,
  y,
  nodeCount,
  canGroup,
  canSave,
  canUngroup,
  minimizeLabel,
  onGroup,
  onSave,
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
  minimizeLabel: string;
  onGroup: () => void;
  onSave: () => void;
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

function WorkflowOutputConnectorMenu({
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
              {sourcePort.label} · {formatPortType(sourcePort.type)}
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

function workflowNode(id: string, x: number, y: number, data: WorkflowNodeData): WorkflowNodeModel {
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      ...data,
      tags: normalizeWorkflowTags(data.tags ?? tagsForWorkflowNodeData(data)),
    },
  };
}

function port(id: string, label: string, type: PortType, options: Pick<FlowPort, "optional"> = {}): FlowPort {
  return options.optional ? { id, label, type, optional: true } : { id, label, type };
}

function workflowEdge(source: string, sourcePortId: string, target: string, targetPortId: string): Edge {
  const sourceNode = initialWorkflowNodes.find((node) => node.id === source);
  const targetNode = initialWorkflowNodes.find((node) => node.id === target);
  const sourcePort = sourceNode?.data.outputs.find((candidate) => candidate.id === sourcePortId);
  const targetPort = targetNode?.data.inputs.find((candidate) => candidate.id === targetPortId);
  const type = sourcePort?.type ?? targetPort?.type ?? "run_config";

  return workflowEdgeFromConnection(
    {
      source,
      target,
      sourceHandle: sourcePort ? handleId("out", sourcePort) : null,
      targetHandle: targetPort ? handleId("in", targetPort) : null,
    },
    type,
  );
}

function workflowEdgeFromConnection(connection: Connection | Edge, type: PortType): Edge {
  return {
    id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
    source: connection.source ?? "",
    target: connection.target ?? "",
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    label: formatPortType(type),
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: portTypeColorVar(type) },
    style: { stroke: portTypeColorVar(type), strokeWidth: 1.7 },
    labelStyle: { fill: "#3f3f46", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
  };
}

function compatibleConnection(nodes: WorkflowNodeModel[], connection: Connection | Edge): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return false;
  }
  const sourcePort = findPort(nodes, connection.source, connection.sourceHandle, "out");
  const targetPort = findPort(nodes, connection.target, connection.targetHandle, "in");
  return Boolean(sourcePort && targetPort && portTypesCompatible(sourcePort.type, targetPort.type));
}

function portTypesCompatible(sourceType: PortType, targetType: PortType): boolean {
  return sourceType === targetType || (targetType === "data_value" && dataValueCompatibleSourceTypes.includes(sourceType));
}

function findPort(
  nodes: WorkflowNodeModel[],
  nodeId: string | null,
  handle: string | null | undefined,
  direction: PortDirection,
): FlowPort | null {
  if (!nodeId || !handle) {
    return null;
  }
  const parsed = parseHandleId(handle);
  if (!parsed || parsed.direction !== direction) {
    return null;
  }
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const ports = direction === "in" ? node?.data.inputs : node?.data.outputs;
  return ports?.find((portCandidate) => portCandidate.id === parsed.portId && portCandidate.type === parsed.type) ?? null;
}

function handleId(direction: PortDirection, portValue: FlowPort): string {
  return `${direction}|${portValue.id}|${portValue.type}`;
}

function parseHandleId(handle: string): { direction: PortDirection; portId: string; type: PortType } | null {
  const [direction, portId, type] = handle.split("|");
  if ((direction !== "in" && direction !== "out") || !portId || !isPortType(type)) {
    return null;
  }
  return { direction, portId, type };
}

function isPortType(value: string | undefined): value is PortType {
  return portTypes.includes((value ?? "") as PortType);
}

function formatPortType(type: PortType): string {
  return type.replace(/_/g, " ");
}

function usePortTypeColors(): PortTypeColors {
  return React.useContext(PortTypeColorContext);
}

function portTypeColor(type: PortType, colors: PortTypeColors): string {
  return colors[type] ?? defaultPortTypeColors[type];
}

function portTypeColorVar(type: PortType): string {
  return `var(${portTypeColorVariableName(type)}, ${defaultPortTypeColors[type]})`;
}

function portTypeColorVariableName(type: PortType): `--workflow-port-color-${PortType}` {
  return `--workflow-port-color-${type}`;
}

function portTypeColorsStyle(colors: PortTypeColors): PortTypeColorStyle {
  return portTypes.reduce((style, type) => {
    style[portTypeColorVariableName(type)] = portTypeColor(type, colors);
    return style;
  }, {} as PortTypeColorStyle);
}

function portTypeBadgeTextColor(color: string): string {
  return mixHexColors(normalizeHexColor(color) ?? "#52525b", "#18181b", 0.35);
}

function workflowHeaderClass(tone: FlowTone): string {
  switch (tone) {
    case "sky":
      return "border-sky-100 bg-sky-50";
    case "rose":
      return "border-rose-100 bg-rose-50";
    case "amber":
      return "border-amber-100 bg-amber-50";
    case "emerald":
      return "border-emerald-100 bg-emerald-50";
    case "violet":
      return "border-violet-100 bg-violet-50";
    case "cyan":
      return "border-cyan-100 bg-cyan-50";
    case "indigo":
      return "border-indigo-100 bg-indigo-50";
    case "fuchsia":
      return "border-fuchsia-100 bg-fuchsia-50";
    case "slate":
      return "border-slate-100 bg-slate-50";
    case "zinc":
      return "border-zinc-100 bg-zinc-50";
  }
}

function flowToneClass(tone: FlowTone): string {
  switch (tone) {
    case "sky":
      return "bg-sky-500";
    case "rose":
      return "bg-rose-500";
    case "amber":
      return "bg-amber-500";
    case "emerald":
      return "bg-emerald-500";
    case "violet":
      return "bg-violet-500";
    case "cyan":
      return "bg-cyan-500";
    case "indigo":
      return "bg-indigo-500";
    case "fuchsia":
      return "bg-fuchsia-500";
    case "slate":
      return "bg-slate-500";
    case "zinc":
      return "bg-zinc-700";
  }
}

function deriveWorkflowRunInputModel(workflow: SavedWorkflow): WorkflowRunInputModel {
  const incomingHandles = new Set(
    workflow.edges
      .filter((edge) => edge.targetHandle)
      .map((edge) => `${edge.target}:${edge.targetHandle}`),
  );
  const incomingNodes = new Set(workflow.edges.map((edge) => edge.target));
  const inputs: WorkflowRunInput[] = [];
  const seen = new Set<string>();

  const addInput = (
    node: SavedWorkflowBlockNode,
    portValue: FlowPort,
    source: WorkflowRunInput["source"],
  ) => {
    const key = `${node.id}:${handleId(source === "open" ? "in" : "out", portValue)}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    inputs.push({
      key,
      nodeId: node.id,
      nodeTitle: node.data.title,
      port: portValue,
      source,
    });
  };

  for (const node of workflow.nodes) {
    for (const input of node.data.inputs) {
      if (!incomingHandles.has(`${node.id}:${handleId("in", input)}`)) {
        addInput(node, input, "open");
      }
    }
  }

  for (const node of workflow.nodes) {
    if (!isWorkflowInputProviderNode(node, incomingNodes)) {
      continue;
    }
    for (const output of node.data.outputs) {
      if (isExecutableWorkflowInputType(output.type)) {
        addInput(node, output, "provider");
      }
    }
  }

  const sourceModes: SourceMode[] = [];
  if (inputs.some((input) => input.port.type === "youtube_url")) {
    sourceModes.push("url");
  }
  if (inputs.some((input) => input.port.type === "video_file")) {
    sourceModes.push("file");
  }

  return {
    sourceModes,
    showRunConfig: inputs.some((input) => input.port.type === "run_config"),
    openInputs: inputs.filter((input) => input.source === "open"),
    genericInputs: inputs.filter((input) => input.source === "open" && !isExecutableWorkflowInputType(input.port.type)),
  };
}

function isWorkflowInputProviderNode(node: SavedWorkflowBlockNode, incomingNodes: Set<string>): boolean {
  const title = node.data.title.toLowerCase();
  const packageName = node.data.packageName.toLowerCase();
  if (
    packageName === "input" ||
    packageName.includes("@video-analysis/web") ||
    title.includes("source picker") ||
    title.includes("run input") ||
    title.includes("user story page")
  ) {
    return true;
  }
  return !incomingNodes.has(node.id) && node.data.outputs.some((output) => isExecutableWorkflowInputType(output.type));
}

function isExecutableWorkflowInputType(type: PortType): boolean {
  return type === "youtube_url" || type === "video_file" || type === "run_config";
}

function effectiveSourceMode(form: UseCaseForm, inputModel?: WorkflowRunInputModel): SourceMode {
  const sourceModes = inputModel?.sourceModes.length ? inputModel.sourceModes : (["url", "file"] as SourceMode[]);
  return sourceModes.includes(form.sourceMode) ? form.sourceMode : sourceModes[0] ?? form.sourceMode;
}

function UseCaseControls({
  form,
  inputModel,
  onChange,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
}: {
  form: UseCaseForm;
  inputModel: WorkflowRunInputModel;
  onChange: (form: UseCaseForm) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
}) {
  const set = <K extends keyof UseCaseForm>(key: K, value: UseCaseForm[K]) =>
    onChange({ ...form, [key]: value });
  const setWorkflowInput = (key: string, value: string) =>
    onChange({ ...form, workflowInputs: { ...form.workflowInputs, [key]: value } });
  const sourceModes = inputModel.sourceModes.length > 0 ? inputModel.sourceModes : (["url", "file"] as SourceMode[]);
  const selectedSourceMode = effectiveSourceMode(form, inputModel);
  const showSourceSelector = sourceModes.length > 1;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Input</h2>
      </div>
      <div className="space-y-4 p-4">
        {showSourceSelector && (
          <SegmentedControl<SourceMode>
            value={selectedSourceMode}
            options={sourceModes.map((mode): [SourceMode, string] => [mode, mode === "url" ? "URL" : "File"])}
            onChange={(value) => set("sourceMode", value)}
          />
        )}

        {selectedSourceMode === "url" ? (
          <Field label="YouTube URL">
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.url}
              placeholder="https://www.youtube.com/watch?v=..."
              onChange={(event) => onChange({ ...form, sourceMode: "url", url: event.target.value })}
            />
          </Field>
        ) : (
          <Field label="Input file">
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.input}
              onChange={(event) => onChange({ ...form, sourceMode: "file", input: event.target.value })}
            />
          </Field>
        )}

        {inputModel.showRunConfig && (
          <>
            <Field label="Work directory">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.workDir}
                onChange={(event) => set("workDir", event.target.value)}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Scene threshold">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.sceneThreshold}
                  onChange={(event) => set("sceneThreshold", Number(event.target.value))}
                />
              </Field>
              <Field label="Minimum scene frames">
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.minSceneLen}
                  onChange={(event) => set("minSceneLen", Number(event.target.value))}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max frames">
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="all"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.maxFrames}
                  onChange={(event) => set("maxFrames", event.target.value)}
                />
              </Field>
              <Field label="Visual sample step">
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.visualSampleEvery}
                  onChange={(event) => set("visualSampleEvery", Number(event.target.value))}
                />
              </Field>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                checked={form.skipTranscription}
                onChange={(event) => set("skipTranscription", event.target.checked)}
              />
              <span>Skip transcription</span>
            </label>

            <Field label="Object command">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.objectCommand}
                placeholder="optional"
                onChange={(event) => set("objectCommand", event.target.value)}
              />
            </Field>
            <Field label="OCR command">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.ocrCommand}
                placeholder="optional"
                onChange={(event) => set("ocrCommand", event.target.value)}
              />
            </Field>
            <Field label="Text command">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.textCommand}
                placeholder="optional"
                onChange={(event) => set("textCommand", event.target.value)}
              />
            </Field>

            <Field label="Output JSON">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.output}
                onChange={(event) => set("output", event.target.value)}
              />
            </Field>
          </>
        )}

        {inputModel.genericInputs.map((input) => (
          <Field key={input.key} label={`${input.nodeTitle} ${input.port.label}${input.port.optional ? " (optional)" : ""}`}>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.workflowInputs[input.key] ?? ""}
              placeholder={input.port.type === "template_string" ? "output/{{id}}.json" : formatPortType(input.port.type)}
              title={formatPortType(input.port.type)}
              onChange={(event) => setWorkflowInput(input.key, event.target.value)}
            />
          </Field>
        ))}

        <div className="rounded-lg bg-zinc-950 p-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-100">
            {buildCommand(form, inputModel).map(shellQuote).join(" ")}
          </pre>
        </div>

        <button
          className={classNames(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
            runDisabled ? "cursor-not-allowed bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800",
          )}
          onClick={onRun}
          disabled={runDisabled}
        >
          {isRunning ? <SpinnerIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {isRunning ? "Creating run" : "Create run"}
        </button>
        {validationMessage && <p className="text-sm text-amber-700">{validationMessage}</p>}
      </div>
    </section>
  );
}

function RunOutputPanel({ stdout, stderr }: { stdout?: string; stderr?: string }) {
  if (!stdout && !stderr) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Output</h2>
      </div>
      <div className="space-y-3 p-4">
        {stderr && <OutputBlock label="stderr" value={stderr} tone="rose" />}
        {stdout && <OutputBlock label="stdout" value={stdout} tone="zinc" />}
      </div>
    </section>
  );
}

function OutputBlock({ label, value, tone }: { label: string; value: string; tone: "rose" | "zinc" }) {
  return (
    <div>
      <div className={classNames("mb-2 text-xs font-medium uppercase", tone === "rose" ? "text-rose-600" : "text-zinc-500")}>
        {label}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 p-3 text-xs leading-5 text-zinc-100">
        {value}
      </pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-grid w-full grid-flow-col rounded-lg border border-zinc-200 bg-zinc-100 p-1">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          className={classNames(
            "rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
            optionValue === value
              ? "bg-white text-zinc-950 shadow-sm"
              : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950",
          )}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2">
      <div className="text-[11px] uppercase text-zinc-500">{label}</div>
      <div className="font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function buildCommand(form: UseCaseForm, inputModel?: WorkflowRunInputModel): string[] {
  const sourceMode = effectiveSourceMode(form, inputModel);
  const command = [
    "studio-api",
    "POST",
    "/api/workflows/youtube-video/runs",
    "--work-dir",
    form.workDir,
    "--scene-threshold",
    String(form.sceneThreshold),
    "--min-scene-len",
    String(form.minSceneLen),
    "--visual-sample-every",
    String(form.visualSampleEvery),
  ];

  if (sourceMode === "url") {
    command.push("--url", form.url);
  } else {
    command.push("--input", form.input);
  }
  if (form.maxFrames.trim()) {
    command.push("--max-frames", form.maxFrames.trim());
  }
  if (form.skipTranscription) {
    command.push("--skip-transcription");
  }
  if (form.objectCommand.trim()) {
    command.push("--object-command", form.objectCommand.trim());
  }
  if (form.ocrCommand.trim()) {
    command.push("--ocr-command", form.ocrCommand.trim());
  }
  if (form.textCommand.trim()) {
    command.push("--text-command", form.textCommand.trim());
  }

  return command;
}

function buildYoutubeRunRequest(form: UseCaseForm, inputModel?: WorkflowRunInputModel): YoutubeRunRequest {
  const sourceMode = effectiveSourceMode(form, inputModel);
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    scene_threshold: form.sceneThreshold,
    min_scene_len: form.minSceneLen,
    max_frames: form.maxFrames.trim() ? Number(form.maxFrames.trim()) : null,
    visual_sample_every: form.visualSampleEvery,
    transcription: {
      enabled: !form.skipTranscription,
      command: null,
    },
    models: {
      object: commandConfig(form.objectCommand),
      ocr: commandConfig(form.ocrCommand),
      text: commandConfig(form.textCommand),
    },
  };
}

function formFromYoutubeRunRequest(request: YoutubeRunRequest): UseCaseForm {
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? initialForm.workDir,
    sceneThreshold: request.scene_threshold,
    minSceneLen: request.min_scene_len,
    maxFrames: request.max_frames ? String(request.max_frames) : "",
    visualSampleEvery: request.visual_sample_every,
    skipTranscription: !request.transcription.enabled,
    objectCommand: commandConfigToInput(request.models.object),
    ocrCommand: commandConfigToInput(request.models.ocr),
    textCommand: commandConfigToInput(request.models.text),
  };
}

function workflowInputSummaryFromForm(form: UseCaseForm, inputModel?: WorkflowRunInputModel): string {
  if (effectiveSourceMode(form, inputModel) === "url") {
    return form.url.trim() || "YouTube URL";
  }
  return form.input.trim() || "Local file";
}

function commandConfig(command: string) {
  const trimmed = command.trim();
  return trimmed ? { command: trimmed, args: [] } : null;
}

function commandConfigToInput(config: YoutubeRunRequest["models"]["object"]): string {
  if (!config) {
    return "";
  }
  return [config.command, ...config.args].filter(Boolean).join(" ");
}

function runRecordToCliRun(run: RunRecord, clientLabel: string, workflowName: string): CliRun {
  return {
    command: clientLabel,
    args: [workflowName, run.run_id],
    status: run.status,
    exit_code: run.status === "succeeded" ? 0 : run.status === "failed" ? 1 : null,
    output_files: [run.report_path],
    message: run.message,
  };
}

function workflowRunToCliRun(run: SavedWorkflowRun): CliRun {
  return {
    command: "studio-api",
    args: [run.workflowName, run.backendRunId ?? run.id],
    status: run.status,
    exit_code: run.status === "succeeded" ? 0 : run.status === "failed" ? 1 : null,
    output_files: [run.reportPath ?? reportPathForRequest(run.request)],
    message: run.message ?? null,
  };
}

function reportPathForRequest(request: YoutubeRunRequest): string {
  return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/analysis.json` : initialForm.output;
}

function downloadReport(report: YoutubeVideoReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "video-analysis-report.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function getRunValidation(form: UseCaseForm, inputModel?: WorkflowRunInputModel): string | null {
  const sourceMode = effectiveSourceMode(form, inputModel);
  if (sourceMode === "url") {
    const url = form.url.trim();
    if (!url) {
      return "Enter a YouTube URL.";
    }
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) {
        return "Use a youtube.com or youtu.be URL.";
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "Use an http or https URL.";
      }
    } catch {
      return "Enter a valid YouTube URL.";
    }
  }
  if (sourceMode === "file" && !form.input.trim()) {
    return "Enter a local video file path.";
  }
  if (!form.output.trim()) {
    return "Enter an output JSON path.";
  }
  if (!form.workDir.trim()) {
    return "Enter a work directory.";
  }
  if (!Number.isFinite(form.sceneThreshold) || form.sceneThreshold < 0) {
    return "Scene threshold must be zero or greater.";
  }
  if (!Number.isFinite(form.minSceneLen) || form.minSceneLen < 1) {
    return "Minimum scene frames must be at least 1.";
  }
  if (!Number.isFinite(form.visualSampleEvery) || form.visualSampleEvery < 1) {
    return "Visual sample step must be at least 1.";
  }
  if (form.maxFrames.trim() && !/^[1-9]\d*$/.test(form.maxFrames.trim())) {
    return "Max frames must be a positive integer.";
  }
  return null;
}

function currentUseCase(id: UseCaseId) {
  return useCases.find((useCase) => useCase.id === id) ?? useCases[0];
}

function appPageFromPath(pathname: string): AppPage {
  if (pathname === "/workflow" || pathname === "/workflows") {
    return "workflow";
  }
  if (pathname === "/settings") {
    return "settings";
  }
  return "analysis";
}

function pathForAppPage(page: AppPage): string {
  switch (page) {
    case "workflow":
      return "/workflow";
    case "settings":
      return "/settings";
    case "analysis":
      return "/";
  }
}

function clampedFixedPosition(x: number, y: number, width: number, height: number): React.CSSProperties {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

function filterWorkflowNodeTemplates(nodes: WorkflowNodeModel[], query: string): WorkflowNodeModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return nodes;
  }
  return nodes.filter((node) =>
    [
      node.data.title,
      node.data.packageName,
      node.data.description,
      ...(node.data.tags ?? []),
      ...node.data.inputs.map((portValue) => portValue.label),
      ...node.data.outputs.map((portValue) => portValue.label),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function workflowPrimitiveConnectorTargets(
  nodes: WorkflowNodeModel[],
  type: PortType,
): WorkflowPrimitiveConnectorTarget[] {
  return nodes.flatMap((template) => {
    const input = template.data.inputs.find((portValue) => portTypesCompatible(type, portValue.type));
    return input ? [{ template, input }] : [];
  });
}

function workflowSavedBlockConnectorTargets(
  blocks: SavedWorkflowBlock[],
  type: PortType,
): WorkflowSavedBlockConnectorTarget[] {
  return blocks.flatMap((block) => {
    const input = savedWorkflowBlockOpenInputs(block).find((candidate) => portTypesCompatible(type, candidate.port.type));
    return input ? [{ block, input }] : [];
  });
}

function savedWorkflowBlockOpenInputs(block: SavedWorkflowBlock): WorkflowBlockOpenInput[] {
  const incomingHandles = new Set(
    block.edges
      .filter((edge) => edge.targetHandle)
      .map((edge) => `${edge.target}:${edge.targetHandle}`),
  );

  return block.nodes.flatMap((node) =>
    node.data.inputs
      .filter((input) => !incomingHandles.has(`${node.id}:${handleId("in", input)}`))
      .map((input) => ({
        nodeId: node.id,
        nodeTitle: node.data.title,
        port: input,
      })),
  );
}

function filterSavedWorkflowBlocks(blocks: SavedWorkflowBlock[], query: string): SavedWorkflowBlock[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return blocks;
  }
  return blocks.filter((block) =>
    [
      block.name,
      ...(block.tags ?? []),
      ...block.nodes.flatMap((node) => [
        node.data.title,
        node.data.packageName,
        node.data.description,
        ...(node.data.tags ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function parseWorkflowTags(value: string): string[] {
  return normalizeWorkflowTags(value.split(/[\s,]+/));
}

function normalizeWorkflowTags(value: unknown): string[] {
  const candidates =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value)
        ? value
        : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const tag = candidate.trim().toLowerCase().replace(/[^a-z0-9@/_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (tag.length < 2 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags.slice(0, 12);
}

function tagsForWorkflowNodes(nodes: WorkflowNodeModel[]): string[] {
  return normalizeWorkflowTags(nodes.flatMap((node) => node.data.tags ?? tagsForWorkflowNodeData(node.data)));
}

function tagsForSavedWorkflowBlock(block: SavedWorkflowBlock): string[] {
  return normalizeWorkflowTags(block.nodes.flatMap((node) => node.data.tags ?? tagsForWorkflowNodeData(node.data)));
}

function tagsForWorkflowNodeData(data: WorkflowNodeData): string[] {
  return normalizeWorkflowTags([
    data.title,
    data.packageName,
    data.tone,
    ...data.inputs.map((portValue) => portValue.type),
    ...data.outputs.map((portValue) => portValue.type),
  ].flatMap(tokenizeWorkflowTagText));
}

function tokenizeWorkflowTagText(value: string): string[] {
  const ignoredTags = new Set(["and", "the", "for", "with", "from", "into", "json", "cli", "web"]);
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9@/_-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 1 && !ignoredTags.has(token));
}

function normalizedWorkflowNodeSize(size: WorkflowNodeSize | undefined): WorkflowNodeSize | null {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    return null;
  }
  return {
    width: Math.max(minWorkflowGroupWidth, Math.round(size.width)),
    height: Math.max(minWorkflowGroupHeight, Math.round(size.height)),
  };
}

function matchesHotkeyBinding(event: KeyboardEvent, binding: HotkeyBinding): boolean {
  return (
    normalizeHotkeyKey(event.key) === binding.key &&
    event.ctrlKey === Boolean(binding.ctrl) &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt) &&
    event.metaKey === Boolean(binding.meta)
  );
}

function hotkeyBindingFromKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent<HTMLElement>): HotkeyBinding | null {
  const key = normalizeHotkeyKey(event.key);
  if (!key || ["Control", "Shift", "Alt", "Meta"].includes(key)) {
    return null;
  }
  return normalizeHotkeyBinding({
    key,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  });
}

function normalizeHotkeyKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  switch (key) {
    case "Esc":
      return "Escape";
    case "Del":
      return "Delete";
    default:
      return key;
  }
}

function normalizeHotkeyBinding(value: unknown): HotkeyBinding | null {
  if (!isRecord(value) || typeof value.key !== "string") {
    return null;
  }
  const key = normalizeHotkeyKey(value.key.trim());
  if (!key) {
    return null;
  }
  return {
    key,
    ctrl: value.ctrl === true || undefined,
    shift: value.shift === true || undefined,
    alt: value.alt === true || undefined,
    meta: value.meta === true || undefined,
  };
}

function formatHotkeyBinding(binding: HotkeyBinding): string {
  return [
    binding.ctrl ? "Ctrl" : null,
    binding.meta ? "Meta" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    formatHotkeyKey(binding.key),
  ]
    .filter((part): part is string => Boolean(part))
    .join("+");
}

function formatHotkeyKey(key: string): string {
  switch (key) {
    case " ":
      return "Space";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    default:
      return key;
  }
}

function hotkeyBindingSignature(binding: HotkeyBinding): string {
  return [
    binding.ctrl ? "ctrl" : "",
    binding.meta ? "meta" : "",
    binding.alt ? "alt" : "",
    binding.shift ? "shift" : "",
    binding.key.toLowerCase(),
  ].join("+");
}

function hotkeyBindingConflicts(bindings: HotkeyBindings): Set<HotkeyActionId> {
  const actionIdsByBinding = new Map<string, HotkeyActionId[]>();
  for (const action of hotkeyActions) {
    const signature = hotkeyBindingSignature(bindings[action.id]);
    actionIdsByBinding.set(signature, [...(actionIdsByBinding.get(signature) ?? []), action.id]);
  }
  const conflicts = new Set<HotkeyActionId>();
  for (const actionIds of actionIdsByBinding.values()) {
    if (actionIds.length > 1) {
      actionIds.forEach((actionId) => conflicts.add(actionId));
    }
  }
  return conflicts;
}

function shouldIgnoreHotkeyEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) {
    return true;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function parseWorkflowComponentDragPayload(value: string): WorkflowComponentDragPayload | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.id !== "string") {
      return null;
    }
    if (parsed.type === "primitive" || parsed.type === "block") {
      return { type: parsed.type, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function loadPortTypeColors(): PortTypeColors {
  if (typeof window === "undefined") {
    return defaultPortTypeColors;
  }

  try {
    const raw = window.localStorage.getItem(portTypeColorsStorageKey);
    if (!raw) {
      return defaultPortTypeColors;
    }
    return normalizePortTypeColors(JSON.parse(raw));
  } catch {
    return defaultPortTypeColors;
  }
}

function persistPortTypeColors(colors: PortTypeColors) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(portTypeColorsStorageKey, JSON.stringify(normalizePortTypeColors(colors)));
}

function loadHotkeyBindings(): HotkeyBindings {
  if (typeof window === "undefined") {
    return defaultHotkeyBindings;
  }

  try {
    const raw = window.localStorage.getItem(hotkeyBindingsStorageKey);
    if (!raw) {
      return defaultHotkeyBindings;
    }
    return normalizeHotkeyBindings(JSON.parse(raw));
  } catch {
    return defaultHotkeyBindings;
  }
}

function persistHotkeyBindings(bindings: HotkeyBindings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(hotkeyBindingsStorageKey, JSON.stringify(normalizeHotkeyBindings(bindings)));
}

function normalizeHotkeyBindings(value: unknown): HotkeyBindings {
  const record = isRecord(value) ? value : {};
  return hotkeyActions.reduce<HotkeyBindings>(
    (bindings, action) => {
      const binding = normalizeHotkeyBinding(record[action.id]);
      bindings[action.id] = binding ?? defaultHotkeyBindings[action.id];
      return bindings;
    },
    { ...defaultHotkeyBindings },
  );
}

function normalizePortTypeColors(value: unknown): PortTypeColors {
  const record = isRecord(value) ? value : {};
  return portTypes.reduce<PortTypeColors>((colors, type) => {
    const color = record[type];
    colors[type] = typeof color === "string" ? normalizeHexColor(color) ?? defaultPortTypeColors[type] : defaultPortTypeColors[type];
    return colors;
  }, { ...defaultPortTypeColors });
}

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return null;
}

function hexToRgba(color: string, alpha: number): string {
  const normalized = normalizeHexColor(color) ?? "#52525b";
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function mixHexColors(color: string, target: string, amount: number): string {
  const sourceColor = normalizeHexColor(color) ?? "#52525b";
  const targetColor = normalizeHexColor(target) ?? "#18181b";
  const source = hexToRgb(sourceColor);
  const destination = hexToRgb(targetColor);
  const mixChannel = (sourceChannel: number, targetChannel: number) =>
    Math.round(sourceChannel + (targetChannel - sourceChannel) * amount);
  return rgbToHex(
    mixChannel(source.red, destination.red),
    mixChannel(source.green, destination.green),
    mixChannel(source.blue, destination.blue),
  );
}

function hexToRgb(color: string): { red: number; green: number; blue: number } {
  const normalized = normalizeHexColor(color) ?? "#52525b";
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number): string {
  const channelToHex = (channel: number) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

function loadStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const stored = window.localStorage.getItem(key);
  if (stored === "true") {
    return true;
  }
  if (stored === "false") {
    return false;
  }
  return fallback;
}

function persistStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function runStatusClass(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600";
    case "failed":
    case "canceled":
      return "text-rose-600";
    case "running":
      return "text-sky-600";
    case "pending":
      return "text-amber-600";
  }
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6.5 4.9v10.2c0 .6.7 1 1.2.6l7.4-5.1c.4-.3.4-.9 0-1.2L7.7 4.3c-.5-.4-1.2 0-1.2.6Z" />
    </svg>
  );
}

function WorkflowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <circle cx="5" cy="5.5" r="2" />
      <circle cx="15" cy="5.5" r="2" />
      <circle cx="10" cy="14.5" r="2" />
      <path d="M7 5.5h6" strokeLinecap="round" />
      <path d="m6.3 7.2 2.6 5.1" strokeLinecap="round" />
      <path d="m13.7 7.2-2.6 5.1" strokeLinecap="round" />
    </svg>
  );
}

function RunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M5 4.5v11l9-5.5-9-5.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 5v10" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />
      <path
        d="M15.6 11.4c.1-.5.1-.9 0-1.4l1.5-1.1-1.5-2.6-1.8.7a6 6 0 0 0-1.2-.7L12.4 4H7.6l-.3 2.3c-.4.2-.8.4-1.2.7l-1.8-.7-1.5 2.6L4.4 10a5.6 5.6 0 0 0 0 1.4l-1.5 1.1 1.5 2.6 1.8-.7c.4.3.8.5 1.2.7l.3 2.3h4.8l.3-2.3c.4-.2.8-.4 1.2-.7l1.8.7 1.5-2.6-1.7-1.1Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M16 6v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.1 10A5.5 5.5 0 1 1 13.7 6.3L16 8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 3v9" strokeLinecap="round" />
      <path d="m6.5 8.5 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.5h12" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 17V8" strokeLinecap="round" />
      <path d="m6.5 11.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 4.5h12" strokeLinecap="round" />
    </svg>
  );
}

function SaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M5 3.5h8l2 2v11H5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 3.5v4h5v-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13.5h5" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 4.5v11" strokeLinecap="round" />
      <path d="M4.5 10h11" strokeLinecap="round" />
    </svg>
  );
}

function CloneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="7" y="6.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M4.5 12.5V5.8c0-.7.6-1.3 1.3-1.3h6.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="10.5" width="5" height="5" rx="1" />
      <path d="M8.5 7h3" strokeLinecap="round" />
      <path d="M8.5 12.5h3" strokeLinecap="round" />
    </svg>
  );
}

function UngroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4.5" width="5" height="5" rx="1" />
      <rect x="11.5" y="10.5" width="5" height="5" rx="1" />
      <path d="M9.5 7h2" strokeLinecap="round" />
      <path d="M8.5 12.5h2" strokeLinecap="round" />
      <path d="M10.5 5.5 13 3" strokeLinecap="round" />
      <path d="m10.5 14.5 2.5 2.5" strokeLinecap="round" />
    </svg>
  );
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="M7 10h6" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="M7 8h6" strokeLinecap="round" />
      <path d="M7 12h6" strokeLinecap="round" />
    </svg>
  );
}

function PanelCollapseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M8 4v12" strokeLinecap="round" />
      <path d="m13 7-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M8 4v12" strokeLinecap="round" />
      <path d="m10.5 7 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="m5 5 10 10" strokeLinecap="round" />
      <path d="m15 5-10 10" strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={classNames("animate-spin", className)}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
