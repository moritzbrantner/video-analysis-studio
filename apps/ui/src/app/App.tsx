import { useState, useEffect, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type StudioReport,
  type CliRun,
  buildYoutubeCollectionManifestRequest,
  type YoutubeCollectionRunRequest,
  type VideoRedCarsRunRequest,
  type SubtitleGenerationRunRequest,
  type SongAnalysisRunRequest,
} from "../index";
import { sampleReport } from "../sampleReport";
import {
  type DashboardLayout,
  defaultDashboardLayout,
  sanitizeDashboardLayout,
} from "../ResultPageEditor";
import { ReportDashboard } from "../dashboard";
import { loadLegacyLocalDataSources, clearLegacyLocalDataSources } from "../data-sources/types";
import { DataSourcesPage as WorkspaceDataSourcesPage } from "../data-sources/page";
import {
  type TypeDefinition,
  loadTypeDefinitions,
  persistTypeDefinitions,
  TypeLibraryPage,
} from "../type-library/page";
import { collectDataSourceReferences } from "../data-sources/references";
import {
  type RunRecord,
  type RunEvent,
  getWorkflowClient,
  isSongAnalysisReport,
  isSubtitleGenerationReport,
  isImageSimilarityReport,
  isYoutubeCollectionReport,
  isYoutubeVideoReport,
  type DataSourceUpsert,
  type DataSourceDerivationInput,
  type RunStatus,
  type YoutubeRunRequest,
  waitForRunCompletion,
  type DataSourceOrigin,
} from "../api/client";
import { normalizeRunEvents, appendRunEvent } from "../runEvents";
import {
  useWorkflowCatalogQuery,
  useTranscriptionCatalogQuery,
  useDataSourcesQuery,
  useDataSourceMutations,
  useDiscoverYoutubeCollectionManifestMutation,
  queryKeys,
  dataSourcesQueryOptions,
  runQueryOptions,
  runEventsQueryOptions,
  reportQueryOptions,
} from "../api/queries";
import { workflowShareTokenFromUrl, decodeWorkflowSharePayload } from "../workflowShare";
import {
  type AppPage,
  appLocationFromPath,
  pathForAppPage,
  pathForTypeDefinitionPage,
} from "./routing";
import { runImageSimilarityWorkflow } from "../run/imageSimilarity";
import { initialCollectionManifestPreview, initialForm } from "../run/runForm";
import {
  isImageSimilarityRunRequest,
  isSongAnalysisRunRequest,
  isSubtitleGenerationRunRequest,
  isVideoRedCarsRunRequest,
  isYoutubeCollectionRunRequest,
} from "../run/runGuards";
import {
  buildImageSimilarityRunRequest,
  buildSongAnalysisRunRequest,
  buildSubtitleGenerationRunRequest,
  buildVideoRedCarsRunRequest,
  buildYoutubeCollectionRunRequest,
  buildYoutubeRunRequest,
  collectionManifestFormKey,
  createDefaultRunForm,
  defaultTranscriptionEngine,
  defaultWhisperCppModel,
  downloadReport,
  formFromImageSimilarityRunRequest,
  formFromSongAnalysisRunRequest,
  formFromSubtitleGenerationRunRequest,
  formFromVideoRedCarsRunRequest,
  formFromYoutubeCollectionRunRequest,
  formFromYoutubeRunRequest,
  getRunValidation,
  runRecordToCliRun,
  workflowInputSummaryFromForm,
  workflowRunToCliRun,
} from "../run/runRequests";
import { runStatusClass } from "../run/RunStatus";
import { AnalysisHomePage, fetchWorkflowReport, RunWorkspace } from "../run/RunWorkspace";
import type { CollectionManifestPreviewState, ViewMode, WorkflowRunForm } from "../run/types";
import {
  defaultOutputForWorkflowKind,
  defaultWorkDirForWorkflowKind,
  workflowKindFromRunRequest,
  workflowKindName,
} from "../run/workflowKinds";
import { deriveWorkflowRunInputModel } from "../run/workflowRunInputs";
import {
  createSavedWorkflowRun,
  loadSavedWorkflowRuns,
  mergeBackendWorkflowRuns,
  persistSavedWorkflowRuns,
  workflowRunFromRunRecord,
} from "../run/workflowRuns";
import { SettingsPage } from "../settings/SettingsPage";
import { IconButton, Metric, SegmentedControl } from "../shared/controls";
import {
  CloseIcon,
  ComponentsIcon,
  DataSourceIcon,
  DownloadIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  RunIcon,
  SettingsIcon,
  TypeIcon,
  WorkflowIcon,
} from "../shared/icons";
import { classNames, loadStoredBoolean, persistStoredBoolean } from "../shared/utils";
import { ComponentsPage } from "../workflow-editor/ComponentsPage";
import {
  defaultHotkeyBindings,
  loadHotkeyBindings,
  persistHotkeyBindings,
} from "../workflow-editor/hotkeys";
import { loadPortTypeColors, persistPortTypeColors } from "../workflow-editor/portColors";
import { defaultPortTypeColors } from "../workflow-editor/portTypes";
import {
  normalizeWorkflowResultPanel,
  resultPanelBindingSummaries,
  workflowReportKind,
} from "../workflow-editor/resultPanels";
import {
  loadSavedWorkflowBlocks,
  persistSavedWorkflowBlocks,
} from "../workflow-editor/savedBlocks";
import type {
  HotkeyBindings,
  PortTypeColors,
  SavedWorkflowBlock,
  SavedWorkflowFile,
  SavedWorkflowLibrary,
  SavedWorkflowRun,
  WorkflowFocusTarget,
  WorkflowRunInput,
} from "../workflow-editor/types";
import { WorkflowBuilder } from "../workflow-editor/WorkflowBuilder";
import {
  activeSavedWorkflow,
  createBlankSavedWorkflow,
  createComponentDraftWorkflow,
  importSharedWorkflowFile,
  loadSavedWorkflowLibrary,
  persistSavedWorkflowLibrary,
  renameWorkflowLibraryDataSourceId,
  workflowStateFromSavedWorkflow,
} from "../workflow-editor/workflowLibrary";

const mainSidebarCollapsedStorageKey = "video-analysis.mainSidebarCollapsed.v1";

export function App() {
  const cache = useQueryClient();
  const workflowCatalogQuery = useWorkflowCatalogQuery();
  const transcriptionCatalogQuery = useTranscriptionCatalogQuery();
  const dataSourcesQuery = useDataSourcesQuery();
  const dataSourceMutations = useDataSourceMutations();
  const discoverManifestMutation = useDiscoverYoutubeCollectionManifestMutation();
  const [form, setForm] = useState<WorkflowRunForm>(initialForm);
  const [report, setReport] = useState<StudioReport>(sampleReport);
  const [hasLoadedReport, setHasLoadedReport] = useState(false);
  const [page, setPage] = useState<AppPage>(() =>
    typeof window === "undefined" ? "analysis" : appLocationFromPath(window.location.pathname).page,
  );
  const [activeTypeRouteId, setActiveTypeRouteId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : appLocationFromPath(window.location.pathname).typeId,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [runStatus, setRunStatus] = useState<CliRun["status"]>("pending");
  const [lastRun, setLastRun] = useState<CliRun | null>(null);
  const [runOutput, setRunOutput] = useState<{ stdout?: string; stderr?: string }>({});
  const [activeBackendRunId, setActiveBackendRunId] = useState<string | null>(null);
  const [activeRunRecord, setActiveRunRecord] = useState<RunRecord | null>(null);
  const [activeReportRunId, setActiveReportRunId] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [collectionManifestPreview, setCollectionManifestPreview] = useState<CollectionManifestPreviewState>(
    initialCollectionManifestPreview,
  );
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(defaultDashboardLayout);
  const [workflowLibrary, setWorkflowLibrary] = useState<SavedWorkflowLibrary>(loadSavedWorkflowLibrary);
  const [workflowRuns, setWorkflowRuns] = useState<SavedWorkflowRun[]>(loadSavedWorkflowRuns);
  const [savedBlocks, setSavedBlocks] = useState<SavedWorkflowBlock[]>(loadSavedWorkflowBlocks);
  const [typeDefinitions, setTypeDefinitions] = useState<TypeDefinition[]>(loadTypeDefinitions);
  const [legacyLocalDataSources, setLegacyLocalDataSources] = useState(() => loadLegacyLocalDataSources());
  const [portTypeColors, setPortTypeColors] = useState<PortTypeColors>(loadPortTypeColors);
  const [hotkeyBindings, setHotkeyBindings] = useState<HotkeyBindings>(loadHotkeyBindings);
  const [workflowFocusTarget, setWorkflowFocusTarget] = useState<WorkflowFocusTarget | null>(null);
  const [workflowBuilderMessage, setWorkflowBuilderMessage] = useState<string | null>(null);
  const [pendingWorkflowShareToken, setPendingWorkflowShareToken] = useState<string | null>(() =>
    typeof window === "undefined" ? null : workflowShareTokenFromUrl(window.location.href),
  );
  const [mainSidebarCollapsed, setMainSidebarCollapsed] = useState(() =>
    loadStoredBoolean(mainSidebarCollapsedStorageKey, false),
  );
  useEffect(() => {
    let canceled = false;
    getWorkflowClient()
      .listRuns({ limit: 50 })
      .then((records) => {
        if (canceled) {
          return;
        }
        setWorkflowRuns((currentRuns) => mergeBackendWorkflowRuns(currentRuns, records, workflowLibrary.workflows));
      })
      .catch(() => {
        // The local API can be unavailable when the UI is opened against static fixtures.
      });
    return () => {
      canceled = true;
    };
  }, [workflowLibrary.workflows]);

  const activeWorkflow = useMemo(() => activeSavedWorkflow(workflowLibrary), [workflowLibrary]);
  const activeWorkflowResultPanel = useMemo(
    () => normalizeWorkflowResultPanel(activeWorkflow.resultPanel, activeWorkflow.kind, activeWorkflow.name),
    [activeWorkflow],
  );
  const dataSources = dataSourcesQuery.data ?? [];
  const dataSourcesLoading = dataSourcesQuery.isLoading;
  const workflowCatalog = workflowCatalogQuery.data ?? null;
  const transcriptionCatalog = transcriptionCatalogQuery.data ?? null;
  const dataSourceReferences = useMemo(() => collectDataSourceReferences(workflowLibrary), [workflowLibrary]);
  const resultPanelBindingSummariesForActiveWorkflow = useMemo(
    () =>
      resultPanelBindingSummaries(
        activeWorkflowResultPanel,
        workflowStateFromSavedWorkflow(activeWorkflow).nodes,
        dataSources,
        typeDefinitions,
      ),
    [activeWorkflow, activeWorkflowResultPanel, dataSources, typeDefinitions],
  );
  const selectedWorkflowKind = activeWorkflow.kind;
  const activeWorkflowInputModel = useMemo(() => deriveWorkflowRunInputModel(activeWorkflow), [activeWorkflow]);
  const validationMessage = getRunValidation(form, activeWorkflowInputModel, selectedWorkflowKind);
  const activeReport = hasLoadedReport ? report : null;
  const songReport = activeReport && isSongAnalysisReport(activeReport) ? activeReport : null;
  const subtitleReport = activeReport && isSubtitleGenerationReport(activeReport) ? activeReport : null;
  const imageSimilarityReport = activeReport && isImageSimilarityReport(activeReport) ? activeReport : null;
  const collectionReport = activeReport && isYoutubeCollectionReport(activeReport) ? activeReport : null;
  const videoReport = activeReport && isYoutubeVideoReport(activeReport)
    ? activeReport
    : collectionReport?.items.find((item) => item.report)?.report ?? null;
  const reportTitle = collectionReport
    ? collectionReport.collection.title ?? collectionReport.collection.source_url
    : songReport
      ? songReport.identification.top_match?.title ?? songReport.source.local_media
    : subtitleReport
      ? subtitleReport.subtitle.path
    : imageSimilarityReport
      ? imageSimilarityReport.query.name
      : videoReport?.source.local_video ?? "No report loaded";
  const cliRun = lastRun;
  const analysisViewOptions: Array<[ViewMode, string]> = hasLoadedReport
    ? [
        ["home", "Home"],
        ["overview", "Overview"],
        ["result", "Result"],
        ["scenes", "Scenes"],
        ["signals", "Signals"],
        ["data", "Data"],
      ]
    : [
        ["home", "Home"],
      ];

  useEffect(() => {
    persistStoredBoolean(mainSidebarCollapsedStorageKey, mainSidebarCollapsed);
  }, [mainSidebarCollapsed]);

  useEffect(() => {
    persistPortTypeColors(portTypeColors);
  }, [portTypeColors]);

  useEffect(() => {
    if (!transcriptionCatalog) {
      return;
    }
    setForm((current) => {
      const nextEngine =
        current.transcriptionEngine === initialForm.transcriptionEngine
          ? defaultTranscriptionEngine(transcriptionCatalog)
          : current.transcriptionEngine;
      const nextModel =
        current.transcriptionModel === initialForm.transcriptionModel
          ? defaultWhisperCppModel(transcriptionCatalog)
          : current.transcriptionModel;
      return nextEngine === current.transcriptionEngine && nextModel === current.transcriptionModel
        ? current
        : { ...current, transcriptionEngine: nextEngine, transcriptionModel: nextModel };
    });
  }, [transcriptionCatalog]);

  useEffect(() => {
    persistHotkeyBindings(hotkeyBindings);
  }, [hotkeyBindings]);

  useEffect(() => {
    persistSavedWorkflowBlocks(savedBlocks);
  }, [savedBlocks]);

  useEffect(() => {
    persistTypeDefinitions(typeDefinitions);
  }, [typeDefinitions]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onPopState = () => {
      const nextLocation = appLocationFromPath(window.location.pathname);
      setPage(nextLocation.page);
      setActiveTypeRouteId(nextLocation.typeId);
      setPendingWorkflowShareToken(workflowShareTokenFromUrl(window.location.href));
      const nextWorkflowId = nextLocation.workflowId;
      if (!nextWorkflowId) {
        return;
      }
      setWorkflowLibrary((currentLibrary) => {
        if (!currentLibrary.workflows.some((workflow) => workflow.id === nextWorkflowId)) {
          return currentLibrary;
        }
        if (currentLibrary.activeWorkflowId === nextWorkflowId) {
          return currentLibrary;
        }
        const nextLibrary = {
          ...currentLibrary,
          activeWorkflowId: nextWorkflowId,
        };
        persistSavedWorkflowLibrary(nextLibrary);
        return nextLibrary;
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!pendingWorkflowShareToken) {
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const sharedWorkflowFile = await decodeWorkflowSharePayload<SavedWorkflowFile>(pendingWorkflowShareToken);
        if (canceled) {
          return;
        }
        let importedWorkflowId = workflowLibrary.activeWorkflowId;
        let message = "Imported shared workflow";
        setWorkflowLibrary((currentLibrary) => {
          const imported = importSharedWorkflowFile(currentLibrary, sharedWorkflowFile);
          importedWorkflowId = imported.workflowId;
          message = imported.message;
          persistSavedWorkflowLibrary(imported.library);
          return imported.library;
        });
        setPage("workflow");
        setWorkflowBuilderMessage(message);
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", pathForAppPage("workflow", importedWorkflowId));
        }
      } catch (error) {
        if (canceled) {
          return;
        }
        setPage("workflow");
        setWorkflowBuilderMessage(error instanceof Error ? error.message : "Could not open shared workflow link");
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", pathForAppPage("workflow", workflowLibrary.activeWorkflowId));
        }
      } finally {
        if (!canceled) {
          setPendingWorkflowShareToken(null);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [pendingWorkflowShareToken, workflowLibrary.activeWorkflowId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const expectedPath =
      page === "types" ? pathForTypeDefinitionPage(activeTypeRouteId) : pathForAppPage(page, activeWorkflow.id);
    if (window.location.pathname !== expectedPath) {
      window.history.replaceState({}, "", expectedPath);
    }
  }, [activeTypeRouteId, activeWorkflow.id, page]);

  const navigateToPage = useCallback((nextPage: AppPage, options?: { workflowId?: string | null; history?: "push" | "replace" }) => {
    setPage(nextPage);
    setActiveTypeRouteId(null);
    if (typeof window === "undefined") {
      return;
    }
    const nextPath = pathForAppPage(nextPage, options?.workflowId ?? activeWorkflow.id);
    if (window.location.pathname !== nextPath) {
      const method = options?.history === "replace" ? "replaceState" : "pushState";
      window.history[method]({}, "", nextPath);
    }
  }, [activeWorkflow.id]);

  const navigateToTypeDefinition = useCallback((typeId: string | null, options?: { history?: "push" | "replace" }) => {
    setPage("types");
    setActiveTypeRouteId(typeId);
    if (typeof window === "undefined") {
      return;
    }
    const nextPath = pathForTypeDefinitionPage(typeId);
    if (window.location.pathname !== nextPath) {
      const method = options?.history === "replace" ? "replaceState" : "pushState";
      window.history[method]({}, "", nextPath);
    }
  }, []);

  const loadSampleReport = useCallback(() => {
    setReport(sampleReport);
    setHasLoadedReport(true);
    setActiveReportRunId(null);
    setRunStatus("pending");
    setLastRun(null);
    setRunOutput({});
    setActiveBackendRunId(null);
    setActiveRunRecord(null);
    setRunEvents([]);
    navigateToPage("analysis");
    setViewMode("overview");
  }, [navigateToPage]);

  const loadReport = useCallback((nextReport: StudioReport) => {
    setReport(nextReport);
    setHasLoadedReport(true);
    setActiveReportRunId(null);
    setRunStatus("pending");
    setLastRun(null);
    setRunOutput({});
    setActiveBackendRunId(null);
    setActiveRunRecord(null);
    setRunEvents([]);
    navigateToPage("analysis");
    setViewMode("overview");
  }, [navigateToPage]);

  const commitWorkflowLibrary = useCallback((library: SavedWorkflowLibrary) => {
    persistSavedWorkflowLibrary(library);
    setWorkflowLibrary(library);
  }, []);

  const updateAttachedDashboardLayout = useCallback((layout: DashboardLayout) => {
    setDashboardLayout(layout);
    setWorkflowLibrary((currentLibrary) => {
      const currentWorkflow = activeSavedWorkflow(currentLibrary);
      const panel = normalizeWorkflowResultPanel(currentWorkflow.resultPanel, currentWorkflow.kind, currentWorkflow.name);
      const nextLibrary: SavedWorkflowLibrary = {
        ...currentLibrary,
        workflows: currentLibrary.workflows.map((workflow) =>
          workflow.id === currentWorkflow.id
            ? {
                ...workflow,
                updatedAt: new Date().toISOString(),
                resultPanel: {
                  ...panel,
                  layout: sanitizeDashboardLayout(layout, workflowReportKind(workflow.kind)),
                },
              }
            : workflow,
        ),
      };
      persistSavedWorkflowLibrary(nextLibrary);
      return nextLibrary;
    });
  }, []);

  const activateComponentDraft = useCallback(
    (block: SavedWorkflowBlock, targetPage: "workflow" | "runs") => {
      const workflow = createComponentDraftWorkflow(block);
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        activeWorkflowId: workflow.id,
        workflows: [workflow, ...workflowLibrary.workflows],
      };
      commitWorkflowLibrary(nextLibrary);
      setWorkflowBuilderMessage(
        targetPage === "runs"
          ? `Testing component "${block.name}" in a workflow draft`
          : `Editing component "${block.name}" in a workflow draft`,
      );
      setViewMode("home");
      navigateToPage(targetPage, {
        workflowId: workflow.id,
        history: targetPage === "runs" ? "replace" : undefined,
      });
    },
    [commitWorkflowLibrary, navigateToPage, workflowLibrary],
  );

  const reloadDataSources = useCallback(async () => {
    await cache.invalidateQueries({ queryKey: queryKeys.dataSources });
    const records = await cache.fetchQuery({
      ...dataSourcesQueryOptions(),
      staleTime: 0,
    });
    return records;
  }, [cache]);

  const createWorkspaceDataSource = useCallback(async (request: DataSourceUpsert) => {
    return dataSourceMutations.createDataSource.mutateAsync(request);
  }, [dataSourceMutations.createDataSource]);

  const updateWorkspaceDataSource = useCallback(async (currentId: string, request: DataSourceUpsert) => {
    const updated = await dataSourceMutations.updateDataSource.mutateAsync({ currentId, request });
    if (currentId !== updated.id) {
      setWorkflowLibrary((currentLibrary) => renameWorkflowLibraryDataSourceId(currentLibrary, currentId, updated.id));
    }
    return updated;
  }, [dataSourceMutations.updateDataSource]);

  const deleteWorkspaceDataSource = useCallback(async (id: string) => {
    await dataSourceMutations.deleteDataSource.mutateAsync(id);
  }, [dataSourceMutations.deleteDataSource]);

  const createWorkspaceDataSourceDerivation = useCallback(
    async (parentId: string, request: DataSourceDerivationInput) => {
      return dataSourceMutations.createDataSourceDerivation.mutateAsync({ parentId, request });
    },
    [dataSourceMutations.createDataSourceDerivation],
  );

  const importLegacyLocalDataSourcesToWorkspace = useCallback(async () => {
    if (legacyLocalDataSources.length === 0) {
      return;
    }
    const client = getWorkflowClient();
    const existingIds = new Set((await cache.fetchQuery(dataSourcesQueryOptions())).map((record) => record.id));
    const importedIdMap = new Map<string, string>();
    const roots = legacyLocalDataSources.filter((record) => record.origin.mode === "root");
    const derived = legacyLocalDataSources.filter(isDerivedOriginRecord);
    for (const record of roots) {
      let nextId = record.id;
      let duplicateIndex = 2;
      while (existingIds.has(nextId)) {
        nextId = `${record.id}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      const created = await client.createDataSource({
        id: nextId,
        name: record.name,
        kind: record.kind,
        type: record.type,
        location: record.location,
        description: record.description,
        tags: record.tags,
        body: record.body,
      });
      existingIds.add(created.id);
      importedIdMap.set(record.id, created.id);
    }
    const pending = [...derived];
    while (pending.length > 0) {
      let progressed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const record = pending[index];
        const parentId = importedIdMap.get(record.origin.parent_id) ?? record.origin.parent_id;
        if (!existingIds.has(parentId)) {
          continue;
        }
        let nextId = record.id;
        let duplicateIndex = 2;
        while (existingIds.has(nextId)) {
          nextId = `${record.id}-${duplicateIndex}`;
          duplicateIndex += 1;
        }
        const created = await client.createDataSourceDerivation(parentId, {
          id: nextId,
          name: record.name,
          type: record.type,
          description: record.description,
          tags: record.tags,
          derivation_kind: record.origin.derivation_kind,
          summary: record.origin.summary,
        });
        existingIds.add(created.id);
        importedIdMap.set(record.id, created.id);
        pending.splice(index, 1);
        index -= 1;
        progressed = true;
      }
      if (!progressed) {
        throw new Error("Legacy data sources include derivations with missing parents.");
      }
    }
    clearLegacyLocalDataSources();
    setLegacyLocalDataSources([]);
    await reloadDataSources();
  }, [cache, legacyLocalDataSources, reloadDataSources]);

  const activateWorkflowDefinition = useCallback(
    (workflowId: string) => {
      const workflow = workflowLibrary.workflows.find((candidate) => candidate.id === workflowId);
      if (!workflow) {
        return;
      }
      commitWorkflowLibrary({ ...workflowLibrary, activeWorkflowId: workflowId });
      setForm((current) => ({
        ...current,
        sourceMode: workflow.kind === "youtube-collection" ? "collection" : current.sourceMode === "collection" ? "url" : current.sourceMode,
        workDir: defaultWorkDirForWorkflowKind(workflow.kind),
        output: defaultOutputForWorkflowKind(workflow.kind),
      }));
      setCollectionManifestPreview(initialCollectionManifestPreview);
    },
    [commitWorkflowLibrary, workflowLibrary],
  );

  const selectWorkflowDefinition = useCallback(
    (workflowId: string) => {
      activateWorkflowDefinition(workflowId);
      navigateToPage("workflow", { workflowId });
    },
    [activateWorkflowDefinition, navigateToPage],
  );

  const createWorkflowDefinition = useCallback(() => {
    const workflow = createBlankSavedWorkflow("Untitled Workflow", activeWorkflow.kind);
    commitWorkflowLibrary({
      ...workflowLibrary,
      activeWorkflowId: workflow.id,
      workflows: [workflow, ...workflowLibrary.workflows],
    });
    navigateToPage("workflow", { workflowId: workflow.id });
  }, [activeWorkflow.kind, commitWorkflowLibrary, navigateToPage, workflowLibrary]);

  const startNewWorkflowRun = useCallback(() => {
    setForm({
      ...createDefaultRunForm(selectedWorkflowKind, transcriptionCatalog),
      sourceMode: selectedWorkflowKind === "youtube-collection" ? "collection" : "url",
    });
    setRunStatus("pending");
    setLastRun(null);
    setRunOutput({});
    setActiveBackendRunId(null);
    setActiveRunRecord(null);
    setRunEvents([]);
    setCollectionManifestPreview(initialCollectionManifestPreview);
    navigateToPage("runs", { workflowId: activeWorkflow.id });
  }, [activeWorkflow.id, navigateToPage, selectedWorkflowKind, transcriptionCatalog]);

  const openWorkflowRunWorkspace = useCallback(() => {
    navigateToPage("runs", { workflowId: activeWorkflow.id });
  }, [activeWorkflow.id, navigateToPage]);

  const focusWorkflowInput = useCallback(
    (input: WorkflowRunInput) => {
      setWorkflowFocusTarget({
        workflowId: activeWorkflow.id,
        nodeId: input.nodeId,
        direction: input.source === "open" ? "in" : "out",
        portId: input.port.id,
        portType: input.port.type,
      });
      navigateToPage("workflow", { workflowId: activeWorkflow.id });
    },
    [activeWorkflow.id, navigateToPage],
  );

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
      navigateToPage("workflow", { workflowId: nextActiveWorkflow.id, history: "replace" });
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
    async (run: SavedWorkflowRun) => {
      const workflowKind = workflowKindFromRunRequest(run.request);
      const runWorkflowId = workflowLibrary.workflows.some((workflow) => workflow.id === run.workflowId)
        ? run.workflowId
        : activeWorkflow.id;
      if (workflowLibrary.workflows.some((workflow) => workflow.id === run.workflowId)) {
        commitWorkflowLibrary({
          ...workflowLibrary,
          activeWorkflowId: run.workflowId,
          workflows: workflowLibrary.workflows.map((workflow) =>
            workflow.id === run.workflowId ? { ...workflow, kind: workflowKind } : workflow,
          ),
        });
      }
      setForm(
        isYoutubeCollectionRunRequest(run.request)
          ? formFromYoutubeCollectionRunRequest(run.request, transcriptionCatalog)
          : isVideoRedCarsRunRequest(run.request)
            ? formFromVideoRedCarsRunRequest(run.request)
          : isSubtitleGenerationRunRequest(run.request)
            ? formFromSubtitleGenerationRunRequest(run.request, transcriptionCatalog)
          : isSongAnalysisRunRequest(run.request)
            ? formFromSongAnalysisRunRequest(run.request, transcriptionCatalog)
          : isImageSimilarityRunRequest(run.request)
            ? formFromImageSimilarityRunRequest(run.request)
            : formFromYoutubeRunRequest(run.request, transcriptionCatalog),
      );
      setRunStatus(run.status);
      setLastRun(workflowRunToCliRun(run));
      setRunOutput({});
      setActiveBackendRunId(run.backendRunId ?? null);
      setActiveRunRecord(null);
      setRunEvents([]);
      if (isYoutubeCollectionRunRequest(run.request) && run.request.manifest) {
        setCollectionManifestPreview({
          status: "ready",
          manifest: run.request.manifest,
          selectedItemIds: run.request.manifest.items.map((item) => item.item_id),
          stale: false,
          error: null,
        });
      } else {
        setCollectionManifestPreview(initialCollectionManifestPreview);
      }
      navigateToPage("runs", { workflowId: runWorkflowId });
      if (run.backendRunId) {
        try {
          const client = getWorkflowClient();
          const [record, events] = await Promise.all([
            cache.fetchQuery(runQueryOptions(run.backendRunId)),
            cache.fetchQuery(runEventsQueryOptions(run.backendRunId)),
          ]);
          setActiveRunRecord(record);
          setRunStatus(record.status);
          setRunEvents(normalizeRunEvents(events));
          setLastRun(runRecordToCliRun(record, client.label, run.workflowName));
        } catch (error) {
          setRunEvents([
            {
              run_id: run.backendRunId,
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      }
    },
    [activeWorkflow.id, cache, commitWorkflowLibrary, navigateToPage, transcriptionCatalog, workflowLibrary],
  );

  const selectRunWorkflowDefinition = useCallback(
    (workflowId: string) => {
      activateWorkflowDefinition(workflowId);
      navigateToPage("runs", { workflowId });
    },
    [activateWorkflowDefinition, navigateToPage],
  );

  const handleRunFormChange = useCallback(
    (nextForm: WorkflowRunForm) => {
      const collectionKeyChanged = collectionManifestFormKey(form) !== collectionManifestFormKey(nextForm);
      setForm(nextForm);
      setRunStatus("pending");
      setLastRun(null);
      setRunOutput({});
      setActiveBackendRunId(null);
      setActiveRunRecord(null);
      setRunEvents([]);
      if (selectedWorkflowKind !== "youtube-collection") {
        setCollectionManifestPreview(initialCollectionManifestPreview);
      } else if (collectionKeyChanged) {
        setCollectionManifestPreview((current) =>
          current.manifest ? { ...current, stale: true, error: null } : current,
        );
      }
    },
    [form, selectedWorkflowKind],
  );

  const previewYoutubeCollectionManifest = useCallback(async () => {
    setCollectionManifestPreview((current) => ({ ...current, status: "loading", error: null }));
    try {
      const manifest = await discoverManifestMutation.mutateAsync(buildYoutubeCollectionManifestRequest(form));
      setCollectionManifestPreview({
        status: "ready",
        manifest,
        selectedItemIds: manifest.items.map((item) => item.item_id),
        stale: false,
        error: null,
      });
    } catch (error) {
      setCollectionManifestPreview((current) => ({
        ...current,
        status: "error",
        stale: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [discoverManifestMutation, form]);

  const cancelActiveRun = useCallback(async () => {
    if (!activeBackendRunId) {
      return;
    }
    const client = getWorkflowClient();
    await client.cancelRun(activeBackendRunId);
    const now = new Date().toISOString();
    const event: RunEvent = {
      run_id: activeBackendRunId,
      status: "canceled",
      message: "cancel requested",
      timestamp: now,
    };
    setRunEvents((events) => appendRunEvent(events, event));
    setRunStatus("canceled");
    setActiveRunRecord((record) =>
      {
        const nextRecord = record
          ? { ...record, status: "canceled" as const, updated_at: now, finished_at: now, message: "canceled" }
          : record;
        if (nextRecord) {
          cache.setQueryData(queryKeys.run(nextRecord.run_id), nextRecord);
        }
        return nextRecord;
      },
    );
    setLastRun((run) =>
      run ? { ...run, status: "canceled", exit_code: null, message: "canceled" } : run,
    );
    setWorkflowRuns((currentRuns) => {
      const nextRuns = currentRuns.map((run) =>
        run.backendRunId === activeBackendRunId
          ? { ...run, status: "canceled" as RunStatus, updatedAt: now, message: "canceled" }
          : run,
      );
      persistSavedWorkflowRuns(nextRuns);
      return nextRuns;
    });
  }, [activeBackendRunId, cache]);

  const openActiveReport = useCallback(async () => {
    if (!activeBackendRunId) {
      return;
    }
    const client = getWorkflowClient();
    const record = activeRunRecord ?? (await cache.fetchQuery(runQueryOptions(activeBackendRunId)));
    const workflowKind = workflowKindFromRunRequest(
      workflowRuns.find((run) => run.backendRunId === activeBackendRunId)?.request ??
        (selectedWorkflowKind === "youtube-collection"
          ? buildYoutubeCollectionRunRequest(form, collectionManifestPreview)
          : selectedWorkflowKind === "video-red-cars"
            ? buildVideoRedCarsRunRequest(form, activeWorkflowInputModel)
          : selectedWorkflowKind === "subtitle-generation"
            ? buildSubtitleGenerationRunRequest(form, activeWorkflowInputModel)
          : selectedWorkflowKind === "song-analysis"
            ? buildSongAnalysisRunRequest(form, activeWorkflowInputModel)
          : selectedWorkflowKind === "image-similarity"
            ? buildImageSimilarityRunRequest(form)
          : buildYoutubeRunRequest(form, activeWorkflowInputModel)),
    );
    const nextReport = await cache.fetchQuery(
      reportQueryOptions(record.run_id, workflowKind, () => fetchWorkflowReport(client, record.run_id, workflowKind)),
    );
    const reportWorkflow =
      workflowRuns.find((run) => run.backendRunId === activeBackendRunId && run.workflowId)?.workflowId ?? activeWorkflow.id;
    const attachedWorkflow = workflowLibrary.workflows.find((workflow) => workflow.id === reportWorkflow) ?? activeWorkflow;
    setDashboardLayout(normalizeWorkflowResultPanel(attachedWorkflow.resultPanel, attachedWorkflow.kind, attachedWorkflow.name).layout);
    setReport(nextReport);
    setHasLoadedReport(true);
    setActiveReportRunId(record.run_id);
    navigateToPage("analysis");
    setViewMode("result");
  }, [activeBackendRunId, activeRunRecord, activeWorkflow, activeWorkflowInputModel, cache, collectionManifestPreview, form, navigateToPage, selectedWorkflowKind, workflowLibrary.workflows, workflowRuns]);

  async function runAnalysis() {
    const message = getRunValidation(form, activeWorkflowInputModel, selectedWorkflowKind);
    const workflowKind = selectedWorkflowKind;
    if (message) {
      setRunStatus("failed");
      setLastRun({
        command: "studio-api",
        args: [activeWorkflow.name, workflowKind],
        status: "failed",
        exit_code: null,
        output_files: [form.output],
        message,
      });
      return;
    }

    setRunStatus("running");
    const request =
      workflowKind === "youtube-collection"
        ? buildYoutubeCollectionRunRequest(form, collectionManifestPreview)
        : workflowKind === "video-red-cars"
          ? buildVideoRedCarsRunRequest(form, activeWorkflowInputModel)
        : workflowKind === "subtitle-generation"
          ? buildSubtitleGenerationRunRequest(form, activeWorkflowInputModel)
        : workflowKind === "song-analysis"
          ? buildSongAnalysisRunRequest(form, activeWorkflowInputModel)
        : workflowKind === "image-similarity"
          ? buildImageSimilarityRunRequest(form)
        : buildYoutubeRunRequest(form, activeWorkflowInputModel);
    const localRun = createSavedWorkflowRun(activeWorkflow, request, workflowInputSummaryFromForm(form, activeWorkflowInputModel, workflowKind));
    addWorkflowRun(localRun);
    setLastRun({
      command: "studio-api",
      args: [activeWorkflow.name, workflowKind],
      status: "running",
      exit_code: null,
      output_files: [form.output],
      message: `Starting ${activeWorkflow.name}`,
    });
    setRunOutput({});
    setRunEvents([]);
    setActiveBackendRunId(null);
    setActiveRunRecord(null);

    try {
      if (workflowKind === "image-similarity") {
        const report = await runImageSimilarityWorkflow(form, dataSources);
        const now = new Date().toISOString();
        setReport(report);
        setHasLoadedReport(true);
        setActiveReportRunId(null);
        setDashboardLayout(normalizeWorkflowResultPanel(activeWorkflow.resultPanel, activeWorkflow.kind, activeWorkflow.name).layout);
        setRunStatus("succeeded");
        updateWorkflowRun(localRun.id, (run) => ({
          ...run,
          status: "succeeded",
          updatedAt: now,
          reportPath: "browser:image-similarity",
          message: "image similarity completed",
        }));
        setRunEvents((events) =>
          appendRunEvent(events, {
            run_id: localRun.id,
            status: "succeeded",
            message: "image similarity completed",
            timestamp: now,
            node: "image-similarity",
            progress: 1,
          }),
        );
        setLastRun({
          command: "studio-ui",
          args: [activeWorkflow.name, workflowKind],
          status: "succeeded",
          exit_code: 0,
          output_files: ["browser:image-similarity"],
          message: "image similarity completed",
        });
        navigateToPage("analysis");
        setViewMode("overview");
        return;
      }
      const client = getWorkflowClient();
      const started =
        workflowKind === "youtube-collection"
          ? await client.startYoutubeCollectionRun(request as YoutubeCollectionRunRequest)
          : workflowKind === "video-red-cars"
            ? await client.startVideoRedCarsRun(request as VideoRedCarsRunRequest)
          : workflowKind === "subtitle-generation"
            ? await client.startSubtitleGenerationRun(request as SubtitleGenerationRunRequest)
          : workflowKind === "song-analysis"
            ? await client.startSongAnalysisRun(request as SongAnalysisRunRequest)
          : await client.startYoutubeVideoRun(request as YoutubeRunRequest);
      setActiveBackendRunId(started.run_id);
      setActiveRunRecord(started);
      cache.setQueryData(queryKeys.run(started.run_id), started);
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, started));
      setLastRun(runRecordToCliRun(started, client.label, activeWorkflow.name));

      const finalRun = await waitForRunCompletion(
        client,
        started.run_id,
        (run) => {
          cache.setQueryData(queryKeys.run(run.run_id), run);
          setRunStatus(run.status);
          setActiveRunRecord(run);
          updateWorkflowRun(localRun.id, (currentRun) => workflowRunFromRunRecord(currentRun, run));
          setLastRun(runRecordToCliRun(run, client.label, activeWorkflow.name));
        },
        (event) => {
          setRunEvents((events) => appendRunEvent(events, event));
          setRunOutput({ stdout: event.stdout ?? event.message, stderr: event.stderr ?? undefined });
        },
      );

      if (finalRun.status !== "succeeded") {
        setRunStatus(finalRun.status);
        setActiveRunRecord(finalRun);
        cache.setQueryData(queryKeys.run(finalRun.run_id), finalRun);
        updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
        setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
        return;
      }

      const nextReport = await cache.fetchQuery(
        reportQueryOptions(finalRun.run_id, workflowKind, () => fetchWorkflowReport(client, finalRun.run_id, workflowKind)),
      );
      setReport(nextReport);
      setHasLoadedReport(true);
      setActiveReportRunId(finalRun.run_id);
      setDashboardLayout(normalizeWorkflowResultPanel(activeWorkflow.resultPanel, activeWorkflow.kind, activeWorkflow.name).layout);
      setRunStatus("succeeded");
      setActiveRunRecord(finalRun);
      cache.setQueryData(queryKeys.run(finalRun.run_id), finalRun);
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
      setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
      navigateToPage("analysis");
      setViewMode("result");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunStatus("failed");
      setRunEvents((events) =>
        appendRunEvent(events, {
          run_id: activeBackendRunId ?? localRun.id,
          status: "failed",
          message,
          timestamp: new Date().toISOString(),
        }),
      );
      updateWorkflowRun(localRun.id, (run) => ({
        ...run,
        status: "failed",
        updatedAt: new Date().toISOString(),
        message,
      }));
      setLastRun({
        command: "studio-api",
        args: [activeWorkflow.name, workflowKind],
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
                  <div className="mt-1 text-sm text-zinc-500">Workflows and reports</div>
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
                  page === "runs"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("runs", { workflowId: activeWorkflow.id })}
                title="Runs"
                aria-label="Runs"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Runs</span>
                    <span className="block text-xs opacity-70">Dependencies and inputs</span>
                  </span>
                )}
                <PlayIcon className="h-4 w-4 shrink-0" />
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
                  page === "components"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("components")}
                title="Components"
                aria-label="Components"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Components</span>
                    <span className="block text-xs opacity-70">Reusable graphs</span>
                  </span>
                )}
                <ComponentsIcon className="h-4 w-4 shrink-0" />
              </button>
              <button
                type="button"
                className={classNames(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                  mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                  page === "data-sources"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("data-sources")}
                title="Data Sources"
                aria-label="Data Sources"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Data Sources</span>
                    <span className="block text-xs opacity-70">Catalogs and libraries</span>
                  </span>
                )}
                <DataSourceIcon className="h-4 w-4 shrink-0" />
              </button>
              <button
                type="button"
                className={classNames(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                  mainSidebarCollapsed && "h-10 justify-center px-0 py-0",
                  page === "types"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => navigateToPage("types")}
                title="Types"
                aria-label="Types"
              >
                {!mainSidebarCollapsed && (
                  <span>
                    <span className="block text-sm font-medium">Types</span>
                    <span className="block text-xs opacity-70">Contracts and usage</span>
                  </span>
                )}
                <TypeIcon className="h-4 w-4 shrink-0" />
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
                            {workflowKindName(workflow.kind)} · v{workflow.version} · {workflow.nodes.length} components
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
                            {run.status} · {workflowKindName(run.workflowKind ?? workflowKindFromRunRequest(run.request))} · {run.workflowVersion ? `v${run.workflowVersion} · ` : ""}{run.inputSummary}
                          </span>
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
            {!mainSidebarCollapsed &&
              (hasLoadedReport && (songReport || collectionReport || videoReport) ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <img
                    src="/goldeneye-stats.png"
                    alt="Scene metrics preview"
                    className="aspect-[16/9] w-full rounded-md object-cover"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600">
                    <Metric
                      label={songReport ? "Segments" : collectionReport ? "Items" : "Scenes"}
                      value={String(songReport ? songReport.music.segments.length : collectionReport?.items.length ?? videoReport?.video.scenes.length ?? 0)}
                    />
                    <Metric
                      label={songReport ? "Matches" : collectionReport ? "Analyzed" : "Frames"}
                      value={String(songReport ? songReport.identification.candidates.length : collectionReport?.collection.analyzed_items ?? videoReport?.video.frames_processed ?? 0)}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-sm font-medium text-zinc-900">No active report</div>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Start a run, load a report JSON, or open a saved run from the sidebar.
                  </p>
                </div>
              ))}
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
                      : page === "runs"
                        ? "Runs Overview"
                      : page === "components"
                        ? "Components"
                      : page === "data-sources"
                        ? "Data Sources"
                      : page === "types"
                        ? "Types"
                      : page === "settings"
                        ? "Settings"
                        : viewMode === "home"
                          ? "Video Analysis Studio"
                          : activeWorkflow.name}
                  </h1>
                  <p className="mt-1 text-sm text-zinc-500">
                    {page === "workflow"
                      ? workflowKindName(activeWorkflow.kind)
                      : page === "runs"
                        ? `${activeWorkflow.name} · Select a workflow, review dependencies, and configure input arguments.`
                      : page === "components"
                        ? "Import, export, edit, and test composed workflow components"
                      : page === "data-sources"
                        ? "Catalogs, indices, references, and datasets for workflow nodes"
                      : page === "types"
                        ? "Define reusable type contracts and inspect their usage"
                      : page === "settings"
                        ? "Hotkeys and workflow type colors"
                        : viewMode === "home"
                          ? "Start a workflow run, load a report JSON, or open a saved run."
                          : hasLoadedReport
                            ? `${workflowKindName(activeWorkflow.kind)} · ${reportTitle}`
                            : workflowKindName(activeWorkflow.kind)}
                  </p>
                </div>
                {page === "analysis" && (
                  <div className="flex flex-wrap gap-2">
                    <IconButton
                      icon={<RefreshIcon className="h-4 w-4" />}
                      label="Sample"
                      onClick={loadSampleReport}
                    />
                    {hasLoadedReport && (
                      <IconButton
                        icon={<DownloadIcon className="h-4 w-4" />}
                        label="JSON"
                        onClick={() => downloadReport(report)}
                      />
                    )}
                  </div>
                )}
              </div>
              {page === "analysis" && (
                <SegmentedControl<ViewMode>
                  value={viewMode}
                  options={analysisViewOptions}
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
                savedBlocks={savedBlocks}
                onSavedBlocksChange={setSavedBlocks}
                workflowCatalog={workflowCatalog}
                dataSources={dataSources}
                typeDefinitions={typeDefinitions}
                portTypeColors={portTypeColors}
                hotkeyBindings={hotkeyBindings}
                focusTarget={workflowFocusTarget?.workflowId === activeWorkflow.id ? workflowFocusTarget : null}
                externalMessage={workflowBuilderMessage}
                onOpenRunWorkspace={openWorkflowRunWorkspace}
              />
            ) : page === "components" ? (
              <ComponentsPage
                savedBlocks={savedBlocks}
                typeDefinitions={typeDefinitions}
                onSavedBlocksChange={setSavedBlocks}
                onEditComponent={(block) => activateComponentDraft(block, "workflow")}
                onTestComponent={(block) => activateComponentDraft(block, "runs")}
              />
            ) : page === "runs" ? (
              <RunWorkspace
                form={form}
                onFormChange={(next) => {
                  handleRunFormChange(next);
                }}
                onRun={runAnalysis}
                isRunning={runStatus === "running"}
                runDisabled={runStatus === "running" || validationMessage !== null}
                validationMessage={validationMessage}
                cliRun={cliRun}
                runOutput={runOutput}
                activeRunId={activeBackendRunId}
                activeRunRecord={activeRunRecord}
                runEvents={runEvents}
                collectionManifestPreview={collectionManifestPreview}
                dataSources={dataSources}
                workflowLibrary={workflowLibrary}
                activeWorkflow={activeWorkflow}
                activeWorkflowInputModel={activeWorkflowInputModel}
                transcriptionCatalog={transcriptionCatalog}
                selectedWorkflowKind={selectedWorkflowKind}
                onSelectWorkflow={selectRunWorkflowDefinition}
                onCreateWorkflow={createWorkflowDefinition}
                onEditWorkflow={() => navigateToPage("workflow", { workflowId: activeWorkflow.id })}
                onFocusWorkflowInput={focusWorkflowInput}
                onCancelRun={cancelActiveRun}
                onRetryRun={runAnalysis}
                onOpenReport={openActiveReport}
                onPreviewCollectionManifest={previewYoutubeCollectionManifest}
                onCollectionManifestSelectionChange={(selectedItemIds) =>
                  setCollectionManifestPreview((current) => ({ ...current, selectedItemIds }))
                }
                onLoadReport={loadReport}
              />
            ) : page === "data-sources" ? (
              <WorkspaceDataSourcesPage
                dataSources={dataSources}
                references={dataSourceReferences}
                loading={dataSourcesLoading}
                legacyMigrationAvailable={legacyLocalDataSources.length > 0}
                onImportLegacy={importLegacyLocalDataSourcesToWorkspace}
                onCreateDataSource={createWorkspaceDataSource}
                onUpdateDataSource={updateWorkspaceDataSource}
                onDeleteDataSource={deleteWorkspaceDataSource}
                onCreateDataSourceDerivation={createWorkspaceDataSourceDerivation}
                onOpenWorkflow={(workflowId) => {
                  activateWorkflowDefinition(workflowId);
                  navigateToPage("workflow", { workflowId });
                }}
                typeDefinitions={typeDefinitions}
                onTypeDefinitionsChange={setTypeDefinitions}
              />
            ) : page === "types" ? (
              <TypeLibraryPage
                workflowLibrary={workflowLibrary}
                definitions={typeDefinitions}
                onDefinitionsChange={setTypeDefinitions}
                selectedDefinitionId={activeTypeRouteId}
                onDefinitionRouteChange={navigateToTypeDefinition}
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
            ) : viewMode === "home" ? (
              <AnalysisHomePage
                activeWorkflow={activeWorkflow}
                onStartRun={startNewWorkflowRun}
                onEditWorkflow={() => navigateToPage("workflow")}
                onLoadSample={loadSampleReport}
                onLoadReport={loadReport}
              />
            ) : (
              <ReportDashboard
                report={report}
                mode={viewMode}
                runId={activeReportRunId}
                layout={dashboardLayout}
                bindingSummaries={resultPanelBindingSummariesForActiveWorkflow}
                onLayoutChange={updateAttachedDashboardLayout}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function isDerivedOriginRecord<T extends { origin: DataSourceOrigin }>(
  record: T,
): record is T & { origin: Extract<DataSourceOrigin, { mode: "derived_view" }> } {
  return record.origin.mode === "derived_view";
}
