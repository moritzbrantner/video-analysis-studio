import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeResizer,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type HandleType,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnReconnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  buildYoutubeCollectionManifestRequest,
  CliRunPanel,
  CollectionManifestPreviewPanel,
  filterYoutubeCollectionManifest,
  JsonReportLoader,
  type SongAnalysisRunRequest,
  type CliRun,
  type StudioReport,
  type SubtitleGenerationRunRequest,
  type TranscriptionEngine,
  type VideoRedCarsRunRequest,
  type WhisperCppModel,
  type YoutubeCollectionManifest,
  type YoutubeCollectionRunRequest,
} from "./index";

import "./index.css";
import "@xyflow/react/dist/style.css";
import { sampleReport } from "./sampleReport";
import {
  defaultDashboardLayout,
  type DashboardLayout,
} from "./ResultPageEditor";
import { ReportDashboard, type ReportDashboardMode } from "./dashboard";
import {
  clearLegacyLocalDataSources,
  dataSourceKindLabel,
  loadLegacyLocalDataSources,
} from "./data-sources/types";
import { DataSourcesPage as WorkspaceDataSourcesPage } from "./data-sources/page";
import { collectDataSourceReferences } from "./data-sources/references";
import {
  DataSourceDerivationInput,
  DataSourceOrigin,
  DataSourceRecord,
  DataSourceUpsert,
  getWorkflowClient,
  isSongAnalysisReport,
  isSubtitleGenerationReport,
  isYoutubeCollectionReport,
  isYoutubeVideoReport,
  waitForRunCompletion,
  type RunEvent,
  type RunRecord,
  type RunStatus,
  type SystemDependencyReport,
  type WorkflowCatalog as RustWorkflowCatalog,
  type WorkflowInputSurface,
  type WorkflowRuntimeValidation,
  type WorkflowSemanticKind,
  type PortKind as RustPortKind,
  type PortSpec as RustPortSpec,
  type TranscriptionCatalog,
  type WorkflowTypeSpec,
  type YoutubeRunRequest,
} from "./api/client";
import workflowSeedDefinitionsJson from "./workflow-seeds.json";
import {
  describeWorkflowRuntimeValue,
  formatWorkflowTypeSpec,
  formatWorkflowTypeSpecJson,
  isWorkflowTypeSpec,
  validateWorkflowValue,
  workflowTypeSignature,
  workflowTypesAssignable,
} from "./workflowTypeSpec";
import { appendRunEvent, normalizeRunEvents } from "./runEvents";
import {
  decodeWorkflowSharePayload,
  encodeWorkflowSharePayload,
  workflowShareTokenFromUrl,
  workflowShareUrl,
} from "./workflowShare";
import { workflowGraphHasCycle, workflowGraphWouldCreateCycle } from "./workflowGraph";

type WorkflowKindId = "youtube-video" | "video-red-cars" | "youtube-collection" | "song-analysis" | "subtitle-generation";
type SourceMode = "url" | "file" | "collection";
type AppPage = "analysis" | "runs" | "workflow" | "components" | "data-sources" | "settings";
interface AppLocation {
  page: AppPage;
  workflowId: string | null;
}
type ViewMode = "home" | ReportDashboardMode;
type JsonSchemaScalar = "number" | "boolean" | "null" | "any";

type DataSourceSchema =
  | { type: "port"; portType: DataSourceType }
  | { type: "string"; semantic?: WorkflowSemanticKind }
  | { type: "binary"; mediaType: string; portType: DataSourceType; semantic?: WorkflowSemanticKind }
  | { type: "array"; items: DataSourceSchema; minItems?: number; maxItems?: number }
  | { type: "object"; properties: DataSourceSchemaProperty[]; additionalProperties?: boolean; semantic?: WorkflowSemanticKind }
  | { type: "union"; variants: DataSourceSchema[] }
  | { type: JsonSchemaScalar };

interface DataSourceSchemaProperty {
  id: string;
  name: string;
  schema: DataSourceSchema;
  required: boolean;
}

interface WorkflowRunForm {
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
  transcriptionEngine: Exclude<TranscriptionEngine, "fast_whisper">;
  transcriptionModel: WhisperCppModel;
  transcriptionCommand: string;
  objectCommand: string;
  ocrCommand: string;
  textCommand: string;
  collectionMaxItems: string;
  collectionTitleContains: string;
  collectionDurationMin: string;
  collectionDurationMax: string;
  localDurationMin: string;
  localDurationMax: string;
  localExtensions: string;
  alreadyDownloaded: "include" | "skip" | "reuse";
  songCatalogPath: string;
  songMinScore: number;
  songAmbiguousMargin: number;
  songMaxCandidates: number;
  songWindowSeconds: number;
  songHopSeconds: number;
  songMinBpm: number;
  songMaxBpm: number;
  musicCommand: string;
  workflowInputs: Record<string, string>;
}

interface CollectionManifestPreviewState {
  status: "idle" | "loading" | "ready" | "error";
  manifest: YoutubeCollectionManifest | null;
  selectedItemIds: string[];
  stale: boolean;
  error: string | null;
}

type DataSourceEntry = DataSourceRecord;

const workflowKinds: Array<{
  id: WorkflowKindId;
  name: string;
  defaultWorkflowName: string;
  packageName: string;
  status: string;
}> = [
  {
    id: "youtube-video",
    name: "YouTube Video",
    defaultWorkflowName: "YouTube Video Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "video-red-cars",
    name: "Video Red Cars",
    defaultWorkflowName: "Video Red Cars Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "youtube-collection",
    name: "YouTube Collection",
    defaultWorkflowName: "YouTube Collection Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "song-analysis",
    name: "Song Analysis",
    defaultWorkflowName: "Song Analysis Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
  {
    id: "subtitle-generation",
    name: "Subtitle Generation",
    defaultWorkflowName: "Subtitle Generation Workflow",
    packageName: "studio-core",
    status: "Ready",
  },
];

const exampleWorkflowSeeds: Array<{ kind: WorkflowKindId; name: string }> = [
  { kind: "youtube-video", name: "YouTube Video Quick Review" },
  { kind: "video-red-cars", name: "YouTube Red Cars Counter" },
  { kind: "youtube-collection", name: "YouTube Collection Spot Check" },
  { kind: "song-analysis", name: "Song Analysis Quick Match" },
  { kind: "subtitle-generation", name: "Subtitle SRT Starter" },
];

const initialForm: WorkflowRunForm = {
  sourceMode: "url",
  url: "",
  input: "./video.mp4",
  output: "workflow-output/youtube-video/analysis.json",
  workDir: "workflow-output/youtube-video",
  sceneThreshold: 27,
  minSceneLen: 15,
  maxFrames: "",
  visualSampleEvery: 30,
  skipTranscription: false,
  transcriptionEngine: "whisper_cpp",
  transcriptionModel: "base.en",
  transcriptionCommand: "",
  objectCommand: "",
  ocrCommand: "",
  textCommand: "",
  collectionMaxItems: "25",
  collectionTitleContains: "",
  collectionDurationMin: "",
  collectionDurationMax: "",
  localDurationMin: "",
  localDurationMax: "",
  localExtensions: "mp4,mkv,webm,mov",
  alreadyDownloaded: "reuse",
  songCatalogPath: "",
  songMinScore: 0.82,
  songAmbiguousMargin: 0.03,
  songMaxCandidates: 5,
  songWindowSeconds: 30,
  songHopSeconds: 15,
  songMinBpm: 60,
  songMaxBpm: 200,
  musicCommand: "",
  workflowInputs: {},
};

const initialCollectionManifestPreview: CollectionManifestPreviewState = {
  status: "idle",
  manifest: null,
  selectedItemIds: [],
  stale: false,
  error: null,
};

const mainSidebarCollapsedStorageKey = "video-analysis.mainSidebarCollapsed.v1";
const workflowBuilderComponentsCollapsedStorageKey = "video-analysis.workflowBuilder.componentsCollapsed.v1";
const workflowBuilderDetailsCollapsedStorageKey = "video-analysis.workflowBuilder.detailsCollapsed.v1";
function App() {
  const [form, setForm] = useState<WorkflowRunForm>(initialForm);
  const [report, setReport] = useState<StudioReport>(sampleReport);
  const [hasLoadedReport, setHasLoadedReport] = useState(false);
  const [page, setPage] = useState<AppPage>(() =>
    typeof window === "undefined" ? "analysis" : appLocationFromPath(window.location.pathname).page,
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
  const [dataSources, setDataSources] = useState<DataSourceEntry[]>([]);
  const [dataSourcesLoading, setDataSourcesLoading] = useState(true);
  const [legacyLocalDataSources, setLegacyLocalDataSources] = useState(() => loadLegacyLocalDataSources());
  const [workflowCatalog, setWorkflowCatalog] = useState<RustWorkflowCatalog | null>(null);
  const [transcriptionCatalog, setTranscriptionCatalog] = useState<TranscriptionCatalog | null>(null);
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

  const activeWorkflow = useMemo(() => activeSavedWorkflow(workflowLibrary), [workflowLibrary]);
  const dataSourceReferences = useMemo(() => collectDataSourceReferences(workflowLibrary), [workflowLibrary]);
  const selectedWorkflowKind = activeWorkflow.kind;
  const activeWorkflowInputModel = useMemo(() => deriveWorkflowRunInputModel(activeWorkflow), [activeWorkflow]);
  const validationMessage = getRunValidation(form, activeWorkflowInputModel, selectedWorkflowKind);
  const activeReport = hasLoadedReport ? report : null;
  const songReport = activeReport && isSongAnalysisReport(activeReport) ? activeReport : null;
  const subtitleReport = activeReport && isSubtitleGenerationReport(activeReport) ? activeReport : null;
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
    let canceled = false;
    getWorkflowClient()
      .getWorkflowCatalog()
      .then((catalog) => {
        if (!canceled) {
          setWorkflowCatalog(catalog);
        }
      })
      .catch(() => {
        if (!canceled) {
          setWorkflowCatalog(null);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    getWorkflowClient()
      .getTranscriptionCatalog()
      .then((catalog) => {
        if (canceled) {
          return;
        }
        setTranscriptionCatalog(catalog);
        setForm((current) => {
          const nextEngine =
            current.transcriptionEngine === initialForm.transcriptionEngine
              ? defaultTranscriptionEngine(catalog)
              : current.transcriptionEngine;
          const nextModel =
            current.transcriptionModel === initialForm.transcriptionModel
              ? defaultWhisperCppModel(catalog)
              : current.transcriptionModel;
          return nextEngine === current.transcriptionEngine && nextModel === current.transcriptionModel
            ? current
            : { ...current, transcriptionEngine: nextEngine, transcriptionModel: nextModel };
        });
      })
      .catch(() => {
        if (!canceled) {
          setTranscriptionCatalog(null);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    persistHotkeyBindings(hotkeyBindings);
  }, [hotkeyBindings]);

  useEffect(() => {
    persistSavedWorkflowBlocks(savedBlocks);
  }, [savedBlocks]);

  useEffect(() => {
    let canceled = false;
    setDataSourcesLoading(true);
    getWorkflowClient()
      .listDataSources()
      .then((records) => {
        if (!canceled) {
          setDataSources(records);
          setDataSourcesLoading(false);
        }
      })
      .catch(() => {
        if (!canceled) {
          setDataSources([]);
          setDataSourcesLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onPopState = () => {
      const nextLocation = appLocationFromPath(window.location.pathname);
      setPage(nextLocation.page);
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
    const expectedPath = pathForAppPage(page, activeWorkflow.id);
    if (window.location.pathname !== expectedPath) {
      window.history.replaceState({}, "", expectedPath);
    }
  }, [activeWorkflow.id, page]);

  const navigateToPage = useCallback((nextPage: AppPage, options?: { workflowId?: string | null; history?: "push" | "replace" }) => {
    setPage(nextPage);
    if (typeof window === "undefined") {
      return;
    }
    const nextPath = pathForAppPage(nextPage, options?.workflowId ?? activeWorkflow.id);
    if (window.location.pathname !== nextPath) {
      const method = options?.history === "replace" ? "replaceState" : "pushState";
      window.history[method]({}, "", nextPath);
    }
  }, [activeWorkflow.id]);

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
    const records = await getWorkflowClient().listDataSources();
    setDataSources(records);
    setDataSourcesLoading(false);
    return records;
  }, []);

  const createWorkspaceDataSource = useCallback(async (request: DataSourceUpsert) => {
    const created = await getWorkflowClient().createDataSource(request);
    await reloadDataSources();
    return created;
  }, [reloadDataSources]);

  const updateWorkspaceDataSource = useCallback(async (currentId: string, request: DataSourceUpsert) => {
    const updated = await getWorkflowClient().updateDataSource(currentId, request);
    if (currentId !== updated.id) {
      setWorkflowLibrary((currentLibrary) => renameWorkflowLibraryDataSourceId(currentLibrary, currentId, updated.id));
    }
    await reloadDataSources();
    return updated;
  }, [reloadDataSources]);

  const deleteWorkspaceDataSource = useCallback(async (id: string) => {
    await getWorkflowClient().deleteDataSource(id);
    await reloadDataSources();
  }, [reloadDataSources]);

  const createWorkspaceDataSourceDerivation = useCallback(
    async (parentId: string, request: DataSourceDerivationInput) => {
      const created = await getWorkflowClient().createDataSourceDerivation(parentId, request);
      await reloadDataSources();
      return created;
    },
    [reloadDataSources],
  );

  const importLegacyLocalDataSourcesToWorkspace = useCallback(async () => {
    if (legacyLocalDataSources.length === 0) {
      return;
    }
    const client = getWorkflowClient();
    const existingIds = new Set((await client.listDataSources()).map((record) => record.id));
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
  }, [legacyLocalDataSources, reloadDataSources]);

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
            client.getRun(run.backendRunId),
            client.getRunEvents(run.backendRunId),
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
    [activeWorkflow.id, commitWorkflowLibrary, navigateToPage, transcriptionCatalog, workflowLibrary],
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
      const manifest = await getWorkflowClient().discoverYoutubeCollectionManifest(
        buildYoutubeCollectionManifestRequest(form),
      );
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
  }, [form]);

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
      record
        ? { ...record, status: "canceled", updated_at: now, finished_at: now, message: "canceled" }
        : record,
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
  }, [activeBackendRunId]);

  const openActiveReport = useCallback(async () => {
    if (!activeBackendRunId) {
      return;
    }
    const client = getWorkflowClient();
    const record = activeRunRecord ?? (await client.getRun(activeBackendRunId));
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
          : buildYoutubeRunRequest(form, activeWorkflowInputModel)),
    );
    setReport(
      workflowKind === "youtube-collection"
        ? await client.getYoutubeCollectionReport(record.run_id)
        : workflowKind === "video-red-cars"
          ? await client.getVideoRedCarsReport(record.run_id)
        : workflowKind === "subtitle-generation"
          ? await client.getSubtitleGenerationReport(record.run_id)
        : workflowKind === "song-analysis"
          ? await client.getSongAnalysisReport(record.run_id)
        : await client.getYoutubeVideoReport(record.run_id),
    );
    setHasLoadedReport(true);
    setActiveReportRunId(record.run_id);
    navigateToPage("analysis");
    setViewMode("overview");
  }, [activeBackendRunId, activeRunRecord, activeWorkflowInputModel, collectionManifestPreview, form, navigateToPage, selectedWorkflowKind, workflowRuns]);

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
        : buildYoutubeRunRequest(form, activeWorkflowInputModel);
    const localRun = createSavedWorkflowRun(activeWorkflow, request, workflowInputSummaryFromForm(form, activeWorkflowInputModel));
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
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, started));
      setLastRun(runRecordToCliRun(started, client.label, activeWorkflow.name));

      const finalRun = await waitForRunCompletion(
        client,
        started.run_id,
        (run) => {
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
        updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
        setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
        return;
      }

      setReport(
        workflowKind === "youtube-collection"
          ? await client.getYoutubeCollectionReport(finalRun.run_id)
          : workflowKind === "video-red-cars"
            ? await client.getVideoRedCarsReport(finalRun.run_id)
          : workflowKind === "subtitle-generation"
            ? await client.getSubtitleGenerationReport(finalRun.run_id)
          : workflowKind === "song-analysis"
            ? await client.getSongAnalysisReport(finalRun.run_id)
          : await client.getYoutubeVideoReport(finalRun.run_id),
      );
      setHasLoadedReport(true);
      setActiveReportRunId(finalRun.run_id);
      setRunStatus("succeeded");
      setActiveRunRecord(finalRun);
      updateWorkflowRun(localRun.id, (run) => workflowRunFromRunRecord(run, finalRun));
      setLastRun(runRecordToCliRun(finalRun, client.label, activeWorkflow.name));
      navigateToPage("analysis");
      setViewMode("overview");
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
                portTypeColors={portTypeColors}
                hotkeyBindings={hotkeyBindings}
                focusTarget={workflowFocusTarget?.workflowId === activeWorkflow.id ? workflowFocusTarget : null}
                externalMessage={workflowBuilderMessage}
                onOpenRunWorkspace={openWorkflowRunWorkspace}
              />
            ) : page === "components" ? (
              <ComponentsPage
                savedBlocks={savedBlocks}
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
                onLayoutChange={setDashboardLayout}
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

function RunWorkspace({
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

function AnalysisHomePage({
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
type WorkflowComponentCategory =
  | "Application"
  | "Input"
  | "API"
  | "Pipeline"
  | "Ingest"
  | "Detection"
  | "Models"
  | "Audio"
  | "Text"
  | "Data"
  | "Report"
  | "Dashboard"
  | "Output"
  | "Generator"
  | "Control Flow"
  | "Reusable";
type WorkflowBlockCategoryDraft = WorkflowComponentCategory | "Auto";
type PortPresentationKind =
  | "run_request"
  | "run_config"
  | "template_string"
  | "string_value"
  | "number_value"
  | "boolean_value"
  | "array_value"
  | "youtube_url"
  | "youtube_collection_url"
  | "video_file"
  | "audio_file"
  | "media_file"
  | "transcript"
  | "subtitle_file"
  | "collection_manifest"
  | "collection_item"
  | "collection_report"
  | "collection_table"
  | "video_metadata"
  | "video_frame"
  | "audio_frame"
  | "audio_wav"
  | "song_fingerprint"
  | "song_match"
  | "music_feature"
  | "scene_result"
  | "video_observation"
  | "model_request"
  | "model_prediction"
  | "transcript_segment"
  | "audio_event"
  | "text_event"
  | "http_request"
  | "http_response"
  | "object_value"
  | "data_value"
  | "data_record"
  | "data_bucket"
  | "json_report"
  | "dashboard_view"
  | "song_catalog";
type PortType = PortPresentationKind;
type DataSourceType = PortPresentationKind;

interface FlowPort {
  id: string;
  label: string;
  type: PortType;
  kind?: RustPortKind;
  valueType: WorkflowTypeSpec;
  optional?: boolean;
  stream?: boolean;
  exposableInput?: boolean;
  inputSurface?: WorkflowInputSurface;
  suggestedAdapters?: string[];
  runtimeValidation?: WorkflowRuntimeValidation;
}

type FlowPortOptions = Pick<
  FlowPort,
  "optional" | "stream" | "kind" | "exposableInput" | "inputSurface" | "suggestedAdapters" | "runtimeValidation"
> & { valueType?: WorkflowTypeSpec };

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
  inputs: WorkflowRunInput[];
  sourceModes: SourceMode[];
  configInputs: WorkflowRunInput[];
  openInputs: WorkflowRunInput[];
  genericInputs: WorkflowRunInput[];
}

interface WorkflowFocusTarget {
  workflowId: string;
  nodeId: string;
  direction: PortDirection;
  portId: string;
  portType: PortType;
}

interface WorkflowNodeData extends Record<string, unknown> {
  title: string;
  packageName: string;
  description: string;
  category?: WorkflowComponentCategory;
  tone: FlowTone;
  inputs: FlowPort[];
  outputs: FlowPort[];
  tags?: string[];
  size?: WorkflowNodeSize;
  kind?: "step" | "group";
  group?: WorkflowGroupMetadata;
  groupOpen?: boolean;
  minimized?: boolean;
  dataSourceNode?: boolean;
  dataSourceId?: string;
  dataSourceType?: DataSourceType;
  adapterNode?: boolean;
  adapterInputSchema?: DataSourceSchema;
  adapterOutputSchema?: DataSourceSchema;
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
  kind?: WorkflowKindId;
  category?: WorkflowComponentCategory;
  tags?: string[];
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowComponentDraft {
  blockId: string;
  blockName: string;
}

interface SavedWorkflowFile {
  format: string;
  version: number;
  lastUpdated: string;
  workflowName?: string;
  workflowKind?: WorkflowKindId;
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
  kind: WorkflowKindId;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  versions: SavedWorkflowVersion[];
  componentDraft?: SavedWorkflowComponentDraft;
  nodes: SavedWorkflowBlockNode[];
  edges: SavedWorkflowBlockEdge[];
}

interface SavedWorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  inputSummary: string;
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest;
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
  stream?: boolean;
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

interface WorkflowLayoutEdge {
  source: string;
  target: string;
}

interface WorkflowSeedNodeLayout {
  id: string;
  x: number;
  y: number;
}

interface WorkflowSeedEdgeLayout {
  source: string;
  sourcePortId: string;
  target: string;
  targetPortId: string;
}

interface WorkflowSeedTemplate {
  nodes: WorkflowSeedNodeLayout[];
  edges: WorkflowSeedEdgeLayout[];
}

interface WorkflowSeedDefinitionsFile {
  starterTemplates: Record<string, WorkflowSeedTemplate>;
  basicTestTemplates: Record<string, WorkflowSeedTemplate>;
  exampleStarterTemplates: Record<string, WorkflowSeedTemplate>;
}

interface WorkflowLayoutSize {
  width: number;
  height: number;
}

interface WorkflowInlineAttachment {
  edge: Edge;
  position: { x: number; y: number };
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
const defaultSeedWorkflowName = "YouTube Video Workflow";
const legacySeedWorkflowName = "YouTube Analysis Workflow";
const legacySeedWorkflowNames = new Set([legacySeedWorkflowName, "Default Analysis Pipeline"]);
const maxSavedWorkflowVersions = 25;
const defaultWorkflowNodeWidth = 310;
const defaultWorkflowGroupHeight = 190;
const inlineWorkflowNodeWidth = 240;
const inlineWorkflowNodeHeight = 48;
const workflowInlineAttachGap = 8;
const workflowInlineSnapDistance = 72;
const minWorkflowGroupWidth = 260;
const minWorkflowGroupHeight = 140;
const workflowLayoutStartX = 80;
const workflowLayoutStartY = 60;
const workflowLayoutColumnGap = 170;
const workflowLayoutRowGap = 64;
const workflowLayoutBackEdgeTolerance = 80;

const portTypes: PortType[] = [
  "run_request",
  "run_config",
  "template_string",
  "string_value",
  "number_value",
  "boolean_value",
  "array_value",
  "youtube_url",
  "youtube_collection_url",
  "video_file",
  "audio_file",
  "media_file",
  "transcript",
  "subtitle_file",
  "collection_manifest",
  "collection_item",
  "collection_report",
  "collection_table",
  "video_metadata",
  "video_frame",
  "audio_frame",
  "audio_wav",
  "song_fingerprint",
  "song_match",
  "music_feature",
  "scene_result",
  "video_observation",
  "model_request",
  "model_prediction",
  "transcript_segment",
  "audio_event",
  "text_event",
  "http_request",
  "http_response",
  "object_value",
  "data_value",
  "data_record",
  "data_bucket",
  "json_report",
  "dashboard_view",
  "song_catalog",
];

const defaultPortTypeColors: PortTypeColors = {
  run_request: "#52525b",
  run_config: "#71717a",
  template_string: "#14b8a6",
  string_value: "#0891b2",
  number_value: "#16a34a",
  boolean_value: "#ca8a04",
  array_value: "#9333ea",
  youtube_url: "#0ea5e9",
  youtube_collection_url: "#0284c7",
  video_file: "#f59e0b",
  audio_file: "#06b6d4",
  media_file: "#0f766e",
  transcript: "#4f46e5",
  subtitle_file: "#7c3aed",
  collection_manifest: "#0f766e",
  collection_item: "#059669",
  collection_report: "#2563eb",
  collection_table: "#4f46e5",
  video_metadata: "#d97706",
  video_frame: "#10b981",
  audio_frame: "#06b6d4",
  audio_wav: "#0891b2",
  song_fingerprint: "#db2777",
  song_match: "#be123c",
  music_feature: "#65a30d",
  scene_result: "#22c55e",
  video_observation: "#8b5cf6",
  model_request: "#a855f7",
  model_prediction: "#7c3aed",
  transcript_segment: "#6366f1",
  audio_event: "#0e7490",
  text_event: "#d946ef",
  http_request: "#2563eb",
  http_response: "#0d9488",
  object_value: "#db2777",
  data_value: "#334155",
  data_record: "#64748b",
  data_bucket: "#475569",
  json_report: "#0284c7",
  dashboard_view: "#2563eb",
  song_catalog: "#ea580c",
};

const dataSourceOutputTypes: DataSourceType[] = portTypes.filter(
  (type) => type !== "run_request" && type !== "dashboard_view",
);

const streamBridgePortDescriptors: Array<{ id: string; label: string; type: PortType }> = [
  { id: "collection_item", label: "collection items", type: "collection_item" },
  { id: "video_file", label: "video files", type: "video_file" },
  { id: "video_frame", label: "video frames", type: "video_frame" },
  { id: "audio_frame", label: "audio frames", type: "audio_frame" },
  { id: "song_fingerprint", label: "fingerprints", type: "song_fingerprint" },
  { id: "song_match", label: "song matches", type: "song_match" },
  { id: "music_feature", label: "music features", type: "music_feature" },
  { id: "scene_result", label: "scenes", type: "scene_result" },
  { id: "video_observation", label: "observations", type: "video_observation" },
  { id: "model_request", label: "model requests", type: "model_request" },
  { id: "model_prediction", label: "predictions", type: "model_prediction" },
  { id: "transcript_segment", label: "transcript segments", type: "transcript_segment" },
  { id: "audio_event", label: "audio events", type: "audio_event" },
  { id: "text_event", label: "text events", type: "text_event" },
  { id: "http_request", label: "HTTP requests", type: "http_request" },
  { id: "http_response", label: "HTTP responses", type: "http_response" },
  { id: "data_value", label: "data values", type: "data_value" },
  { id: "data_record", label: "records", type: "data_record" },
  { id: "data_bucket", label: "buckets", type: "data_bucket" },
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
const WorkflowFocusContext = React.createContext<WorkflowFocusTarget | null>(null);

const initialWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("react-page", 0, 180, {
    title: "User Story Page",
    packageName: "@video-analysis/web",
    description: "Form state, report state, and dashboard tabs.",
    tone: "sky",
    inputs: [port("report", "report", "json_report")],
    outputs: [
      port("run", "run", "run_request"),
      port("config", "config", "run_config", {
        exposableInput: true,
        inputSurface: "config",
        runtimeValidation: "external_input",
      }),
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
      port("url", "youtube url", "youtube_url", {
        exposableInput: true,
        inputSurface: "source_url",
        runtimeValidation: "external_input",
      }),
      port("collection", "playlist/channel", "youtube_collection_url", {
        exposableInput: true,
        inputSurface: "collection_url",
        runtimeValidation: "external_input",
      }),
      port("file", "local file", "video_file", {
        exposableInput: true,
        inputSurface: "file",
        runtimeValidation: "external_input",
      }),
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
  workflowNode("youtube-workflow", 720, 190, {
    title: "YouTube Workflow",
    packageName: "studio-core",
    description: "Coordinates download, ingest, analysis, buckets, and report JSON.",
    tone: "amber",
    inputs: [
      port("args", "cargo args", "run_config"),
      port("url", "youtube url", "youtube_url"),
      port("collection", "playlist/channel", "youtube_collection_url"),
      port("file", "local file", "video_file"),
    ],
    outputs: [
      port("url", "youtube url", "youtube_url"),
      port("collection", "playlist/channel", "youtube_collection_url"),
      port("file", "video file", "video_file"),
      port("config", "pipeline config", "run_config"),
    ],
  }),
  workflowNode("video-red-cars-workflow", 1080, 360, {
    title: "Video Red Cars Workflow",
    packageName: "video-analysis-use-cases",
    description: "Detects red cars in sampled frames, groups them by scene, and writes per-scene counts.",
    tone: "amber",
    inputs: [
      port("file", "video file", "video_file"),
      port("args", "workflow config", "run_config"),
    ],
    outputs: [
      port("file", "video file", "video_file"),
      port("report", "video-red-cars.json", "json_report"),
    ],
    tags: ["video", "red-cars", "scene", "detection"],
  }),
  workflowNode("song-workflow", 720, 560, {
    title: "Song Workflow",
    packageName: "studio-core",
    description: "Coordinates song source resolution, catalog matching, lyrics transcription, BPM, key, and report JSON.",
    tone: "amber",
    inputs: [
      port("args", "cargo args", "run_config"),
      port("url", "youtube url", "youtube_url"),
      port("file", "local file", "video_file"),
    ],
    outputs: [
      port("file", "media file", "video_file"),
      port("config", "song config", "run_config"),
    ],
    tags: ["song", "music", "audio", "analysis"],
  }),
  workflowNode("subtitle-workflow", 720, 900, {
    title: "Subtitle Workflow",
    packageName: "studio-core",
    description: "Coordinates source resolution, transcription, SRT writing next to the video, and JSON report output.",
    tone: "amber",
    inputs: [
      port("args", "cargo args", "run_config"),
      port("url", "youtube url", "youtube_url"),
      port("file", "local file", "video_file"),
    ],
    outputs: [
      port("url", "youtube url", "youtube_url"),
      port("file", "video file", "video_file"),
      port("config", "subtitle config", "run_config"),
    ],
    tags: ["subtitle", "srt", "transcription", "output"],
  }),
  workflowNode("song-fingerprinter", 1080, 720, {
    title: "Song Fingerprinter",
    packageName: "fpcalc / Chromaprint",
    description: "Creates full-track and chunk fingerprints for local catalog matching.",
    tone: "rose",
    inputs: [port("file", "media file", "video_file")],
    outputs: [port("fingerprint", "fingerprint", "song_fingerprint")],
    tags: ["song", "fingerprint", "chromaprint"],
  }),
  workflowNode("song-catalog-matcher", 1440, 720, {
    title: "Catalog Matcher",
    packageName: "rusqlite",
    description: "Compares song fingerprints with the local SQLite catalog and emits ranked candidates.",
    tone: "rose",
    inputs: [
      port("fingerprint", "fingerprint", "song_fingerprint"),
      port("config", "catalog config", "run_config"),
    ],
    outputs: [port("matches", "matches", "song_match")],
    tags: ["song", "catalog", "matching"],
  }),
  workflowNode("song-music-analyzer", 1440, 980, {
    title: "Music Analyzer",
    packageName: "librosa command",
    description: "Estimates global and windowed BPM and key from extracted mono audio.",
    tone: "cyan",
    inputs: [
      port("file", "media file", "video_file"),
      port("config", "music config", "run_config"),
    ],
    outputs: [port("features", "BPM/key", "music_feature")],
    tags: ["song", "bpm", "key", "music"],
  }),
  workflowNode("song-report-writer", 2180, 820, {
    title: "Song Report Writer",
    packageName: "serde_json",
    description: "Writes identification, lyrics, BPM, key, capabilities, and artifact paths to song-analysis.json.",
    tone: "zinc",
    inputs: [
      port("matches", "matches", "song_match"),
      port("segments", "lyrics", "transcript_segment"),
      port("features", "BPM/key", "music_feature"),
    ],
    outputs: [port("report", "song-analysis.json", "json_report")],
    tags: ["song", "report"],
  }),
  workflowNode("song-dashboard", 2550, 820, {
    title: "Song Dashboard",
    packageName: "@video-analysis-studio/ui",
    description: "Renders song identity candidates, lyrics, global BPM/key, and segment-level music estimates.",
    tone: "sky",
    inputs: [port("report", "song report", "json_report")],
    outputs: [port("view", "song panels", "dashboard_view")],
    tags: ["song", "dashboard"],
  }),
  workflowNode("collection-manifest", 1080, -250, {
    title: "Collection Manifest",
    packageName: "yt-dlp",
    description: "Discovers playlist or channel metadata and emits stable item IDs before download.",
    tone: "cyan",
    inputs: [port("url", "playlist/channel", "youtube_collection_url")],
    outputs: [
      port("manifest", "manifest", "collection_manifest"),
      port("items", "items", "collection_item"),
    ],
  }),
  workflowNode("collection-download-loop", 1440, -250, {
    title: "Collection Download Loop",
    packageName: "studio-core",
    description: "Filters manifest items, downloads each selected video, and preserves item identity.",
    tone: "cyan",
    inputs: [
      port("manifest", "manifest", "collection_manifest"),
      port("config", "filters", "run_config"),
    ],
    outputs: [
      port("files", "video files", "video_file"),
      port("items", "downloaded items", "collection_item"),
    ],
  }),
  workflowNode("collection-report", 2920, -250, {
    title: "Collection Report Writer",
    packageName: "serde_json",
    description: "Writes the item-centric collection report and derived table-ready data.",
    tone: "zinc",
    inputs: [
      port("items", "items", "collection_item"),
      port("reports", "item reports", "json_report"),
    ],
    outputs: [
      port("report", "collection report", "collection_report"),
      port("table", "collection table", "collection_table"),
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
  workflowNode("subtitle-writer", 2180, 1040, {
    title: "Subtitle Writer",
    packageName: "studio-core / fs",
    description: "Formats transcript segments as SRT and writes the subtitle file into the source video's folder.",
    tone: "indigo",
    inputs: [
      port("file", "video file", "video_file"),
      port("segments", "segments", "transcript_segment"),
      port("config", "subtitle config", "run_config"),
    ],
    outputs: [port("report", "subtitle report", "json_report")],
    tags: ["subtitle", "srt", "transcript", "output"],
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
    inputs: [
      port("report", "report json", "json_report"),
      port("collection", "collection report", "collection_report", { optional: true }),
    ],
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

const dashboardWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("json-report-loader", 0, 0, {
    title: "JSON Report Loader",
    packageName: "@video-analysis-studio/ui",
    description: "Loads a saved analysis JSON file and emits a report payload for preview or downstream panels.",
    category: "Input",
    tone: "sky",
    inputs: [],
    outputs: [port("report", "report json", "json_report")],
    tags: ["dashboard", "report", "json", "loader", "input"],
  }),
  workflowNode("video-summary-cards", 0, 0, {
    title: "Video Summary Cards",
    packageName: "@video-analysis-studio/ui/core",
    description: "Renders resolution, duration, frame count, and scene count as compact dashboard metrics.",
    category: "Dashboard",
    tone: "sky",
    inputs: [
      port("metadata", "metadata", "video_metadata"),
      port("scenes", "scenes", "scene_result"),
    ],
    outputs: [port("view", "summary cards", "dashboard_view")],
    tags: ["dashboard", "summary", "metrics", "video"],
  }),
  workflowNode("media-metadata-panel", 0, 0, {
    title: "Media Metadata Panel",
    packageName: "@video-analysis-studio/ui/ffmpeg",
    description: "Shows probed media dimensions, duration, frame rate, sample rate, and channel count.",
    category: "Dashboard",
    tone: "amber",
    inputs: [port("metadata", "metadata", "video_metadata")],
    outputs: [port("view", "metadata panel", "dashboard_view")],
    tags: ["dashboard", "ffmpeg", "metadata", "media"],
  }),
  workflowNode("source-summary", 0, 0, {
    title: "Source Summary",
    packageName: "@video-analysis-studio/ui/ingest",
    description: "Displays the original source URL and local media path from the report.",
    category: "Dashboard",
    tone: "sky",
    inputs: [port("report", "source report", "json_report")],
    outputs: [port("view", "source panel", "dashboard_view")],
    tags: ["dashboard", "source", "ingest", "report"],
  }),
  workflowNode("asset-summary", 0, 0, {
    title: "Asset Summary",
    packageName: "@video-analysis-studio/ui/ingest",
    description: "Lists generated artifacts such as the work directory, report path, and extracted audio.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("report", "asset report", "json_report")],
    outputs: [port("view", "asset panel", "dashboard_view")],
    tags: ["dashboard", "assets", "output", "report"],
  }),
  workflowNode("capability-panel", 0, 0, {
    title: "Capability Panel",
    packageName: "@video-analysis-studio/ui/models",
    description: "Shows completed and skipped analysis capabilities from the report.",
    category: "Dashboard",
    tone: "violet",
    inputs: [port("report", "capabilities", "json_report")],
    outputs: [port("view", "capability panel", "dashboard_view")],
    tags: ["dashboard", "capabilities", "models", "status"],
  }),
  workflowNode("scene-panel", 0, 0, {
    title: "Scene Panel",
    packageName: "@video-analysis-studio/ui/core",
    description: "Combines scene timeline and scene table views for detected scene spans.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("scenes", "scenes", "scene_result")],
    outputs: [port("view", "scene panel", "dashboard_view")],
    tags: ["dashboard", "scenes", "timeline", "table"],
  }),
  workflowNode("scene-timeline", 0, 0, {
    title: "Scene Timeline",
    packageName: "@video-analysis-studio/ui/core",
    description: "Renders detected scene spans as a compact horizontal timeline.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("scenes", "scenes", "scene_result")],
    outputs: [port("view", "scene timeline", "dashboard_view")],
    tags: ["dashboard", "scenes", "timeline"],
  }),
  workflowNode("scene-table", 0, 0, {
    title: "Scene Table",
    packageName: "@video-analysis-studio/ui/core",
    description: "Renders scene index, start/end time, frames, and duration in a sortable table shape.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("scenes", "scenes", "scene_result")],
    outputs: [port("view", "scene table", "dashboard_view")],
    tags: ["dashboard", "scenes", "table"],
  }),
  workflowNode("detection-summary", 0, 0, {
    title: "Detection Summary",
    packageName: "@video-analysis-studio/ui/detectors",
    description: "Shows scene detector totals, processed frame counts, and optional cut details.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("scenes", "detection result", "scene_result")],
    outputs: [port("view", "detection summary", "dashboard_view")],
    tags: ["dashboard", "detection", "cuts", "scenes"],
  }),
  workflowNode("cut-table", 0, 0, {
    title: "Cut Table",
    packageName: "@video-analysis-studio/ui/detectors",
    description: "Lists individual detector cut points with frame, time, detector, and score columns.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("cuts", "cuts", "scene_result")],
    outputs: [port("view", "cut table", "dashboard_view")],
    tags: ["dashboard", "cuts", "detection", "table"],
  }),
  workflowNode("observation-list", 0, 0, {
    title: "Observation List",
    packageName: "@video-analysis-studio/ui/core",
    description: "Displays visual observations with labels, analyzer names, timestamps, regions, and scores.",
    category: "Dashboard",
    tone: "violet",
    inputs: [port("observations", "observations", "video_observation")],
    outputs: [port("view", "observation list", "dashboard_view")],
    tags: ["dashboard", "observations", "visual", "scores"],
  }),
  workflowNode("model-observation-grid", 0, 0, {
    title: "Model Observation Grid",
    packageName: "@video-analysis-studio/ui/models",
    description: "Highlights scored model observations as cards with analyzer labels and score meters.",
    category: "Dashboard",
    tone: "violet",
    inputs: [port("observations", "scored observations", "video_observation")],
    outputs: [port("view", "model grid", "dashboard_view")],
    tags: ["dashboard", "models", "observations", "scores"],
  }),
  workflowNode("transcript-panel", 0, 0, {
    title: "Transcript Panel",
    packageName: "@video-analysis-studio/ui/workflows",
    description: "Displays transcript segments with timestamps and transcription status.",
    category: "Dashboard",
    tone: "indigo",
    inputs: [port("segments", "segments", "transcript_segment")],
    outputs: [port("view", "transcript panel", "dashboard_view")],
    tags: ["dashboard", "transcript", "segments", "text"],
  }),
  workflowNode("audio-event-list", 0, 0, {
    title: "Audio Event List",
    packageName: "@video-analysis-studio/ui/core",
    description: "Displays timestamped audio events with analyzer, label, and score columns.",
    category: "Dashboard",
    tone: "cyan",
    inputs: [port("events", "audio events", "audio_event")],
    outputs: [port("view", "audio events", "dashboard_view")],
    tags: ["dashboard", "audio", "events", "table"],
  }),
  workflowNode("text-event-list", 0, 0, {
    title: "Text Event List",
    packageName: "@video-analysis-studio/ui/core",
    description: "Displays transcript-derived text events with analyzer, label, and score columns.",
    category: "Dashboard",
    tone: "fuchsia",
    inputs: [port("events", "text events", "text_event")],
    outputs: [port("view", "text events", "dashboard_view")],
    tags: ["dashboard", "text", "events", "table"],
  }),
  workflowNode("data-bucket-overview", 0, 0, {
    title: "Data Bucket Overview",
    packageName: "@video-analysis-studio/ui/data",
    description: "Summarizes bounded data buckets with record counts, estimated bytes, and stream breakdowns.",
    category: "Dashboard",
    tone: "slate",
    inputs: [port("buckets", "buckets", "data_bucket")],
    outputs: [port("view", "bucket overview", "dashboard_view")],
    tags: ["dashboard", "data", "buckets", "streams"],
  }),
  workflowNode("stream-summary-table", 0, 0, {
    title: "Stream Summary Table",
    packageName: "@video-analysis-studio/ui/data",
    description: "Shows per-stream payload counts, record totals, byte estimates, and media/text counts.",
    category: "Dashboard",
    tone: "slate",
    inputs: [port("buckets", "streams", "data_bucket")],
    outputs: [port("view", "stream table", "dashboard_view")],
    tags: ["dashboard", "data", "streams", "table"],
  }),
  workflowNode("split-plan-table", 0, 0, {
    title: "Split Plan Table",
    packageName: "@video-analysis-studio/ui/split",
    description: "Previews scene clip output names, start times, durations, and frame ranges.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [
      port("scenes", "scenes", "scene_result"),
      port("template", "name template", "template_string", { optional: true }),
    ],
    outputs: [port("view", "split plan", "dashboard_view")],
    tags: ["dashboard", "split", "scenes", "clips", "template"],
  }),
  workflowNode("result-persistence-panel", 0, 0, {
    title: "Result Persistence Panel",
    packageName: "@video-analysis-studio/ui/output",
    description: "Provides disk, IndexedDB, and HTTP save controls for a JSON result payload.",
    category: "Dashboard",
    tone: "emerald",
    inputs: [port("result", "result", "json_report")],
    outputs: [port("view", "save controls", "dashboard_view")],
    tags: ["dashboard", "save", "disk", "database", "http", "output"],
  }),
  workflowNode("cli-run-panel", 0, 0, {
    title: "CLI Run Panel",
    packageName: "@video-analysis-studio/ui/cli",
    description: "Displays command arguments, run status, messages, and generated output file paths.",
    category: "Dashboard",
    tone: "zinc",
    inputs: [port("run", "run", "run_request")],
    outputs: [port("view", "run panel", "dashboard_view")],
    tags: ["dashboard", "cli", "run", "status", "outputs"],
  }),
];

const generatorWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("string-generator", 0, 0, {
    title: "String Generator",
    packageName: "Generator",
    description: "Emits a generated text value for templates, labels, paths, and metadata.",
    tone: "cyan",
    inputs: [],
    outputs: [
      port("value", "string", "string_value"),
      port("template", "template", "template_string"),
    ],
    tags: ["generator", "string", "text", "template"],
  }),
  workflowNode("number-generator", 0, 0, {
    title: "Number Generator",
    packageName: "Generator",
    description: "Emits a generated numeric value for counters, thresholds, limits, and scores.",
    tone: "emerald",
    inputs: [],
    outputs: [port("value", "number", "number_value")],
    tags: ["generator", "number", "integer", "float"],
  }),
  workflowNode("boolean-generator", 0, 0, {
    title: "Boolean Generator",
    packageName: "Generator",
    description: "Emits a generated true or false value for flags, toggles, and conditional routing.",
    tone: "amber",
    inputs: [],
    outputs: [port("value", "boolean", "boolean_value")],
    tags: ["generator", "boolean", "flag", "toggle"],
  }),
  workflowNode("array-generator", 0, 0, {
    title: "Array Generator",
    packageName: "Generator",
    description: "Emits a generated ordered list for batch values, tags, IDs, and sampled items.",
    tone: "violet",
    inputs: [],
    outputs: [
      port("items", "array", "array_value"),
      port("data", "data", "data_value"),
    ],
    tags: ["generator", "array", "list", "items"],
  }),
  workflowNode("object-generator", 0, 0, {
    title: "Object Generator",
    packageName: "Generator",
    description: "Emits a generated object for structured context, parameters, and JSON-like data.",
    tone: "fuchsia",
    inputs: [],
    outputs: [
      port("object", "object", "object_value"),
      port("data", "data", "data_value"),
    ],
    tags: ["generator", "object", "json", "context"],
  }),
  workflowNode("data-source", 0, 0, {
    title: "Data Source",
    packageName: "Data Sources",
    description: "Selects a saved data source by ID and emits its payload through a typed output port.",
    category: "Data",
    tone: "slate",
    inputs: [],
    outputs: [port("data", "data", "data_value")],
    dataSourceNode: true,
    dataSourceType: "data_value",
    tags: ["data-source", "dataset", "catalog", "reference", "typed"],
  }),
];

const adapterWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("data-adapter", 0, 0, {
    title: "Data Adapter",
    packageName: "Typed adapter",
    description: "Accepts a typed payload and exposes a configurable output contract so you can reshape data between incompatible nodes.",
    category: "Data",
    tone: "violet",
    inputs: [port("source", "source data", "data_value")],
    outputs: [port("result", "adapted data", "data_value")],
    adapterNode: true,
    adapterInputSchema: { type: "any" },
    adapterOutputSchema: { type: "any" },
    tags: ["adapter", "typed", "schema", "reshape", "transform"],
  }),
  workflowNode("object-adapter", 0, 0, {
    title: "Object Adapter",
    packageName: "Typed adapter",
    description: "Starts with object-shaped ports so you can rearrange named fields and emit a new object contract downstream.",
    category: "Data",
    tone: "indigo",
    inputs: [port("source", "source object", "object_value")],
    outputs: [port("result", "mapped object", "object_value")],
    adapterNode: true,
    adapterInputSchema: { type: "object", properties: [] },
    adapterOutputSchema: { type: "object", properties: [] },
    tags: ["adapter", "object", "mapping", "fields", "reshape"],
  }),
];

const streamWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("stream-sender", 0, 0, {
    title: "Stream Sender",
    packageName: "video-analysis-data",
    description: "Publishes a compatible data payload as a typed stream for chunked downstream processing.",
    category: "Data",
    tone: "slate",
    inputs: streamBridgePortDescriptors.map(({ id, label, type }) => port(id, label, type, { optional: true })),
    outputs: streamBridgePortDescriptors.map(({ id, label, type }) =>
      port(id, `${label} stream`, type, { optional: true, stream: true }),
    ),
    tags: ["stream", "sender", "publish", "data", "chunked"],
  }),
  workflowNode("stream-receiver", 0, 0, {
    title: "Stream Receiver",
    packageName: "video-analysis-data",
    description: "Receives a typed stream and exposes the materialized payload to compatible workflow nodes.",
    category: "Data",
    tone: "cyan",
    inputs: streamBridgePortDescriptors.map(({ id, label, type }) =>
      port(id, `${label} stream`, type, { optional: true, stream: true }),
    ),
    outputs: streamBridgePortDescriptors.map(({ id, label, type }) => port(id, label, type, { optional: true })),
    tags: ["stream", "receiver", "subscribe", "data", "chunked"],
  }),
];

const httpWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("http-request-builder", 0, 0, {
    title: "HTTP Request Builder",
    packageName: "fetch",
    description: "Combines URL, method, headers, and an optional payload into a typed HTTP request.",
    category: "API",
    tone: "rose",
    inputs: [
      port("url", "URL", "string_value"),
      port("method", "method", "string_value", { optional: true }),
      port("headers", "headers", "object_value", { optional: true }),
      port("body", "body", "data_value", { optional: true }),
    ],
    outputs: [port("request", "HTTP request", "http_request")],
    tags: ["http", "request", "api", "fetch", "webhook"],
  }),
  workflowNode("http-client", 0, 0, {
    title: "HTTP Client",
    packageName: "fetch",
    description: "Executes a typed HTTP request and emits the full response plus parsed body data.",
    category: "API",
    tone: "rose",
    inputs: [port("request", "HTTP request", "http_request")],
    outputs: [
      port("response", "HTTP response", "http_response"),
      port("body", "response body", "data_value"),
    ],
    tags: ["http", "client", "api", "fetch", "response"],
  }),
  workflowNode("http-response-reader", 0, 0, {
    title: "HTTP Response Reader",
    packageName: "fetch",
    description: "Extracts status, success state, headers, and body data from an HTTP response.",
    category: "API",
    tone: "cyan",
    inputs: [port("response", "HTTP response", "http_response")],
    outputs: [
      port("status", "status", "number_value"),
      port("ok", "ok", "boolean_value"),
      port("headers", "headers", "object_value"),
      port("body", "body", "data_value"),
    ],
    tags: ["http", "response", "status", "headers", "body", "api"],
  }),
];

const controlFlowWorkflowNodes: WorkflowNodeModel[] = [
  workflowNode("boolean-not", 0, 0, {
    title: "Boolean NOT",
    packageName: "Control Flow",
    description: "Inverts a boolean value before it is used by gates, switches, or route conditions.",
    tone: "amber",
    inputs: [port("value", "boolean", "boolean_value")],
    outputs: [port("inverted", "not", "boolean_value")],
    tags: ["control", "flow", "boolean", "not", "invert", "condition"],
  }),
  workflowNode("boolean-and", 0, 0, {
    title: "Boolean AND",
    packageName: "Control Flow",
    description: "Combines two boolean conditions and emits true only when both inputs are true.",
    tone: "amber",
    inputs: [
      port("left", "left", "boolean_value"),
      port("right", "right", "boolean_value"),
    ],
    outputs: [port("value", "and", "boolean_value")],
    tags: ["control", "flow", "boolean", "and", "all", "condition"],
  }),
  workflowNode("boolean-or", 0, 0, {
    title: "Boolean OR",
    packageName: "Control Flow",
    description: "Combines two boolean conditions and emits true when either input is true.",
    tone: "amber",
    inputs: [
      port("left", "left", "boolean_value"),
      port("right", "right", "boolean_value"),
    ],
    outputs: [port("value", "or", "boolean_value")],
    tags: ["control", "flow", "boolean", "or", "any", "condition"],
  }),
  workflowNode("number-compare", 0, 0, {
    title: "Number Compare",
    packageName: "Control Flow",
    description: "Compares two numbers and emits boolean conditions for equality and ordering.",
    tone: "emerald",
    inputs: [
      port("left", "left number", "number_value"),
      port("right", "right number", "number_value"),
    ],
    outputs: [
      port("equal", "equal", "boolean_value"),
      port("greater", "greater than", "boolean_value"),
      port("less", "less than", "boolean_value"),
    ],
    tags: ["control", "flow", "compare", "number", "boolean", "condition", "threshold"],
  }),
  workflowNode("boolean-switch", 0, 0, {
    title: "Boolean Switch",
    packageName: "Control Flow",
    description: "Routes incoming data to true and false branches based on a boolean condition.",
    tone: "indigo",
    inputs: [
      port("condition", "condition", "boolean_value"),
      port("data", "data", "data_value"),
    ],
    outputs: [
      port("true", "true branch", "data_value"),
      port("false", "false branch", "data_value"),
    ],
    tags: ["control", "flow", "boolean", "switch", "branch", "if", "else", "route"],
  }),
  workflowNode("conditional-select", 0, 0, {
    title: "Conditional Select",
    packageName: "Control Flow",
    description: "Selects one of two incoming values based on a boolean condition.",
    tone: "indigo",
    inputs: [
      port("condition", "condition", "boolean_value"),
      port("true", "true value", "data_value"),
      port("false", "false value", "data_value"),
    ],
    outputs: [port("value", "selected", "data_value")],
    tags: ["control", "flow", "boolean", "select", "conditional", "ternary", "if", "else"],
  }),
  workflowNode("for-each-item", 0, 0, {
    title: "For Each Item",
    packageName: "Control Flow",
    description: "Iterates over a bounded list inside one component and emits each item as a stream without introducing graph cycles.",
    tone: "indigo",
    inputs: [port("items", "items", "array_value", { valueType: { type: "array", items: { type: "any" } } })],
    outputs: [
      port("item", "item", "data_value", { stream: true }),
      port("index", "index", "number_value", { stream: true }),
    ],
    tags: ["control", "flow", "loop", "iterate", "for each", "array", "stream"],
  }),
  workflowNode("while-loop", 0, 0, {
    title: "While Loop",
    packageName: "Control Flow",
    description: "Repeats an internal loop while the continue condition stays true, then emits the final state when the break condition is reached.",
    tone: "violet",
    inputs: [
      port("state", "initial state", "data_value"),
      port("continue", "continue condition", "boolean_value"),
    ],
    outputs: [
      port("iteration", "iteration state", "data_value", { stream: true }),
      port("index", "iteration index", "number_value", { stream: true }),
      port("result", "final state", "data_value"),
    ],
    tags: ["control", "flow", "loop", "while", "break", "condition", "iterate", "state"],
  }),
  workflowNode("data-gate", 0, 0, {
    title: "Data Gate",
    packageName: "Control Flow",
    description: "Passes incoming data only when a boolean condition allows the route.",
    tone: "slate",
    inputs: [
      port("condition", "condition", "boolean_value"),
      port("data", "data", "data_value"),
    ],
    outputs: [port("allowed", "allowed data", "data_value")],
    tags: ["control", "flow", "boolean", "gate", "guard", "filter", "data"],
  }),
  workflowNode("run-gate", 0, 0, {
    title: "Run Gate",
    packageName: "Control Flow",
    description: "Passes a run request only when a boolean condition allows execution.",
    tone: "zinc",
    inputs: [
      port("condition", "condition", "boolean_value"),
      port("run", "run request", "run_request"),
    ],
    outputs: [port("run", "allowed run", "run_request")],
    tags: ["control", "flow", "boolean", "gate", "run", "execution", "guard"],
  }),
];

const workflowNodeTemplates: WorkflowNodeModel[] = initialWorkflowNodes.concat(
  dashboardWorkflowNodes,
  generatorWorkflowNodes,
  adapterWorkflowNodes,
  streamWorkflowNodes,
  httpWorkflowNodes,
  controlFlowWorkflowNodes,
);

const initialWorkflowEdges: Edge[] = [
  workflowEdge("react-page", "run", "vite-api", "run"),
  workflowEdge("react-page", "config", "vite-api", "config"),
  workflowEdge("source", "url", "youtube-workflow", "url"),
  workflowEdge("source", "collection", "youtube-workflow", "collection"),
  workflowEdge("source", "file", "youtube-workflow", "file"),
  workflowEdge("vite-api", "args", "youtube-workflow", "args"),
  workflowEdge("source", "url", "song-workflow", "url"),
  workflowEdge("source", "file", "song-workflow", "file"),
  workflowEdge("vite-api", "args", "song-workflow", "args"),
  workflowEdge("source", "url", "subtitle-workflow", "url"),
  workflowEdge("source", "file", "subtitle-workflow", "file"),
  workflowEdge("vite-api", "args", "subtitle-workflow", "args"),
  workflowEdge("song-workflow", "file", "song-fingerprinter", "file"),
  workflowEdge("song-workflow", "file", "song-music-analyzer", "file"),
  workflowEdge("song-workflow", "file", "ffmpeg", "file"),
  workflowEdge("song-workflow", "config", "song-catalog-matcher", "config"),
  workflowEdge("song-workflow", "config", "song-music-analyzer", "config"),
  workflowEdge("song-fingerprinter", "fingerprint", "song-catalog-matcher", "fingerprint"),
  workflowEdge("song-catalog-matcher", "matches", "song-report-writer", "matches"),
  workflowEdge("song-music-analyzer", "features", "song-report-writer", "features"),
  workflowEdge("youtube-workflow", "url", "download", "url"),
  workflowEdge("download", "file", "video-red-cars-workflow", "file"),
  workflowEdge("youtube-workflow", "config", "video-red-cars-workflow", "args"),
  workflowEdge("subtitle-workflow", "url", "download", "url"),
  workflowEdge("youtube-workflow", "collection", "collection-manifest", "url"),
  workflowEdge("collection-manifest", "manifest", "collection-download-loop", "manifest"),
  workflowEdge("youtube-workflow", "config", "collection-download-loop", "config"),
  workflowEdge("collection-download-loop", "files", "ffmpeg", "file"),
  workflowEdge("collection-download-loop", "items", "collection-report", "items"),
  workflowEdge("report-writer", "report", "collection-report", "reports"),
  workflowEdge("youtube-workflow", "file", "ffmpeg", "file"),
  workflowEdge("subtitle-workflow", "file", "ffmpeg", "file"),
  workflowEdge("subtitle-workflow", "file", "subtitle-writer", "file"),
  workflowEdge("subtitle-workflow", "config", "subtitle-writer", "config"),
  workflowEdge("download", "file", "ffmpeg", "file"),
  workflowEdge("download", "file", "subtitle-writer", "file"),
  workflowEdge("youtube-workflow", "config", "video-pipeline", "config"),
  workflowEdge("youtube-workflow", "config", "content-detector", "config"),
  workflowEdge("youtube-workflow", "config", "model-sampler", "config"),
  workflowEdge("youtube-workflow", "config", "text-pipeline", "config"),
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
  workflowEdge("transcriber", "segments", "song-report-writer", "segments"),
  workflowEdge("transcriber", "segments", "subtitle-writer", "segments"),
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
  workflowEdge("collection-report", "report", "dashboard", "collection"),
  workflowEdge("song-report-writer", "report", "song-dashboard", "report"),
  workflowEdge("song-report-writer", "report", "react-page", "report"),
  workflowEdge("song-report-writer", "report", "disk-result-sink", "report"),
  workflowEdge("song-report-writer", "report", "database-result-sink", "report"),
  workflowEdge("song-report-writer", "report", "http-result-sink", "report"),
  workflowEdge("subtitle-writer", "report", "react-page", "report"),
  workflowEdge("subtitle-writer", "report", "dashboard", "report"),
  workflowEdge("subtitle-writer", "report", "disk-result-sink", "report"),
  workflowEdge("subtitle-writer", "report", "database-result-sink", "report"),
  workflowEdge("subtitle-writer", "report", "http-result-sink", "report"),
];

const workflowSeedDefinitions = workflowSeedDefinitionsJson as WorkflowSeedDefinitionsFile;
const workflowStarterTemplates = workflowSeedDefinitions.starterTemplates as Record<
  WorkflowKindId,
  WorkflowSeedTemplate
>;

// Internal smoke-test fixtures for structural workflow graph coverage only.
const basicWorkflowTestTemplates = workflowSeedDefinitions.basicTestTemplates;

const exampleWorkflowStarterTemplates = workflowSeedDefinitions.exampleStarterTemplates;

function WorkflowBuilder({
  workflowLibrary,
  onWorkflowLibraryChange,
  savedBlocks,
  onSavedBlocksChange,
  workflowCatalog,
  dataSources,
  portTypeColors,
  hotkeyBindings,
  focusTarget,
  externalMessage,
  onOpenRunWorkspace,
}: {
  workflowLibrary: SavedWorkflowLibrary;
  onWorkflowLibraryChange: React.Dispatch<React.SetStateAction<SavedWorkflowLibrary>>;
  savedBlocks: SavedWorkflowBlock[];
  onSavedBlocksChange: React.Dispatch<React.SetStateAction<SavedWorkflowBlock[]>>;
  workflowCatalog: RustWorkflowCatalog | null;
  dataSources: DataSourceEntry[];
  portTypeColors: PortTypeColors;
  hotkeyBindings: HotkeyBindings;
  focusTarget: WorkflowFocusTarget | null;
  externalMessage: string | null;
  onOpenRunWorkspace: () => void;
}) {
  const activeWorkflow = useMemo(() => activeSavedWorkflow(workflowLibrary), [workflowLibrary]);
  const initialWorkflowState = useMemo(
    () => workflowStateFromSavedWorkflow(activeWorkflow),
    [],
  );
  const [nodes, setNodes] = useNodesState<WorkflowNodeModel>(initialWorkflowState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialWorkflowState.edges);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [blockName, setBlockName] = useState("");
  const [blockCategory, setBlockCategory] = useState<WorkflowBlockCategoryDraft>("Auto");
  const [blockTags, setBlockTags] = useState("");
  const [blockLibraryMessage, setBlockLibraryMessage] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenuState | null>(null);
  const [outputConnectorMenu, setOutputConnectorMenu] = useState<WorkflowOutputConnectorMenuState | null>(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [sharingWorkflow, setSharingWorkflow] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<WorkflowNodeModel, Edge> | null>(null);
  const [workflowNameDraft, setWorkflowNameDraft] = useState(activeWorkflow.name);
  const [componentsCollapsed, setComponentsCollapsed] = useState(() =>
    loadStoredBoolean(workflowBuilderComponentsCollapsedStorageKey, false),
  );
  const [detailsCollapsed, setDetailsCollapsed] = useState(() =>
    loadStoredBoolean(workflowBuilderDetailsCollapsedStorageKey, false),
  );
  const workflowAutosaveReadyRef = useRef(false);
  const workflowSelectionLoadingRef = useRef(false);
  const workflowFileInputRef = useRef<HTMLInputElement | null>(null);
  const blockFileInputRef = useRef<HTMLInputElement | null>(null);
  const workflowClipboardRef = useRef<WorkflowClipboardState | null>(null);
  const focusedWorkflowTargetRef = useRef<string | null>(null);
  const reconnectingEdgeRef = useRef<{ edgeId: string; handleType: HandleType } | null>(null);
  const portTypeColorStyle = useMemo(() => portTypeColorsStyle(portTypeColors), [portTypeColors]);

  useEffect(() => {
    setWorkflowNameDraft(activeWorkflow.name);
  }, [activeWorkflow.id, activeWorkflow.name]);

  useEffect(() => {
    if (externalMessage) {
      setBlockLibraryMessage(externalMessage);
    }
  }, [externalMessage]);

  useEffect(() => {
    persistStoredBoolean(workflowBuilderComponentsCollapsedStorageKey, componentsCollapsed);
  }, [componentsCollapsed]);

  useEffect(() => {
    persistStoredBoolean(workflowBuilderDetailsCollapsedStorageKey, detailsCollapsed);
  }, [detailsCollapsed]);

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
    if (!focusTarget || focusTarget.workflowId !== activeWorkflow.id || !flowInstance) {
      return;
    }

    const targetNode = nodes.find((node) => node.id === focusTarget.nodeId);
    if (!targetNode) {
      return;
    }

    const targetKey = workflowFocusTargetKey(focusTarget);
    if (focusedWorkflowTargetRef.current === targetKey) {
      return;
    }
    focusedWorkflowTargetRef.current = targetKey;

    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        selected: node.id === focusTarget.nodeId,
        data:
          node.id === focusTarget.nodeId && node.data.minimized
            ? { ...node.data, minimized: false }
            : node.data,
      })),
    );
    setSelectedNodeIds([focusTarget.nodeId]);
    setContextMenu(null);
    setOutputConnectorMenu(null);

    requestAnimationFrame(() => {
      flowInstance?.fitView({
        nodes: [{ id: focusTarget.nodeId }],
        padding: 1.4,
        maxZoom: 1.05,
        duration: 350,
      });
    });
  }, [activeWorkflow.id, flowInstance, focusTarget, nodes, setNodes]);

  useEffect(() => {
    const dataSourceById = new Map(dataSources.map((entry) => [entry.id, entry]));
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (!node.data.dataSourceNode || typeof node.data.dataSourceId !== "string") {
        return node;
      }
      const dataSource = dataSourceById.get(node.data.dataSourceId);
      if (!dataSource) {
        return node;
      }
      const nextData = workflowNodeDataWithDataSource(node.data, dataSource);
      if (workflowNodeDataSourceSynced(node.data, nextData)) {
        return node;
      }
      changed = true;
      return { ...node, data: nextData };
    });
    if (!changed) {
      return;
    }
    setNodes(nextNodes);
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => !nextNodes.some((node) => node.id === edge.source && node.data.dataSourceNode) || compatibleConnection(nextNodes, edge)),
    );
  }, [dataSources, nodes, setEdges, setNodes]);

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
    (connection: Connection | Edge) =>
      compatibleConnection(nodes, connection) &&
      !connectionCreatesLoop(edges, connection, reconnectingEdgeRef.current?.edgeId),
    [edges, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourcePort = findPort(nodes, connection.source, connection.sourceHandle, "out");
      const targetPort = findPort(nodes, connection.target, connection.targetHandle, "in");
      if (!sourcePort || !targetPort || !portsCompatible(sourcePort, targetPort)) {
        setConnectionMessage(connectionMismatchMessage(sourcePort, targetPort));
        return;
      }
      if (connectionCreatesLoop(edges, connection)) {
        setConnectionMessage(connectionLoopMessage(nodes, connection));
        return;
      }
      setConnectionMessage(null);
      setEdges((currentEdges) =>
        addEdge(
          workflowEdgeFromConnection(connection, sourcePort),
          currentEdges,
        ),
      );
    },
    [edges, nodes, setEdges],
  );

  const onReconnect = useCallback<OnReconnect<Edge>>(
    (oldEdge, connection) => {
      const sourcePort = findPort(nodes, connection.source, connection.sourceHandle, "out");
      const targetPort = findPort(nodes, connection.target, connection.targetHandle, "in");
      if (!sourcePort || !targetPort || !portsCompatible(sourcePort, targetPort)) {
        setConnectionMessage(connectionMismatchMessage(sourcePort, targetPort));
        return;
      }
      if (connectionCreatesLoop(edges, connection, oldEdge.id)) {
        setConnectionMessage(connectionLoopMessage(nodes, connection));
        return;
      }
      setConnectionMessage(null);
      const nextEdge = workflowEdgeFromConnection(connection, sourcePort);
      setEdges((currentEdges) => {
        const withoutOldEdge = currentEdges.filter((edge) => edge.id !== oldEdge.id);
        return withoutOldEdge.some((edge) => edge.id === nextEdge.id)
          ? withoutOldEdge
          : withoutOldEdge.concat(nextEdge);
      });
    },
    [edges, nodes, setEdges],
  );

  const onReconnectStart = useCallback(
    (_event: React.MouseEvent, edge: Edge, handleType: HandleType) => {
      reconnectingEdgeRef.current = { edgeId: edge.id, handleType };
    },
    [],
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge, handleType: HandleType, connectionState: FinalConnectionState) => {
      const reconnectingEdge = reconnectingEdgeRef.current;
      reconnectingEdgeRef.current = null;
      if (connectionState.isValid || handleType !== "target") {
        return;
      }
      if (!reconnectingEdge || reconnectingEdge.edgeId !== edge.id || reconnectingEdge.handleType !== "target") {
        return;
      }
      setEdges((currentEdges) => currentEdges.filter((candidate) => candidate.id !== edge.id));
    },
    [setEdges],
  );

  const onWorkflowNodesChange = useCallback(
    (changes: NodeChange<WorkflowNodeModel>[]) => {
      setNodes((currentNodes) => stickWorkflowInlineAttachments(applyNodeChanges(changes, currentNodes), edges));
    },
    [edges, setNodes],
  );

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: WorkflowNodeModel[] }) => {
    setSelectedNodeIds(selectedNodes.map((node) => node.id));
  }, []);

  const focusWorkflowNode = useCallback(
    (nodeId: string) => {
      if (!nodes.some((node) => node.id === nodeId)) {
        return;
      }
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          selected: node.id === nodeId,
          data:
            node.id === nodeId && node.data.minimized
              ? { ...node.data, minimized: false }
              : node.data,
        })),
      );
      setSelectedNodeIds([nodeId]);
      setContextMenu(null);
      setOutputConnectorMenu(null);

      requestAnimationFrame(() => {
        flowInstance?.fitView({
          nodes: [{ id: nodeId }],
          padding: 1.4,
          maxZoom: 1.05,
          duration: 320,
        });
      });
    },
    [flowInstance, nodes, setNodes],
  );

  const arrangeWorkflow = useCallback(() => {
    if (nodes.length === 0) {
      setBlockLibraryMessage("No components to arrange");
      return;
    }

    setNodes(autoArrangeWorkflowNodes(nodes, edges));
    setContextMenu(null);
    setOutputConnectorMenu(null);
    setBlockLibraryMessage(`Arranged ${nodes.length} component${nodes.length === 1 ? "" : "s"}`);
    requestAnimationFrame(() => {
      flowInstance?.fitView({ padding: 0.18, duration: 350 });
    });
  }, [edges, flowInstance, nodes, setNodes]);

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
    const workflow = createBlankSavedWorkflow("Untitled Workflow", activeWorkflow.kind);
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
  }, [activeWorkflow.kind, commitWorkflowLibrary, setEdges, setNodes, workflowLibrary]);

  const cloneActiveWorkflow = useCallback(() => {
    const workflow = createSavedWorkflow(`${activeWorkflow.name} Copy`, nodes, edges, activeWorkflow.kind);
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
  }, [activeWorkflow.kind, activeWorkflow.name, commitWorkflowLibrary, edges, nodes, setEdges, setNodes, workflowLibrary]);

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
        ? (remainingWorkflows[0] ?? createBlankSavedWorkflow("Untitled Workflow", activeWorkflow.kind))
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

  const changeWorkflowKind = useCallback(
    (workflowId: string, kind: WorkflowKindId) => {
      const updatedAt = new Date().toISOString();
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        workflows: workflowLibrary.workflows.map((workflow) =>
          workflow.id === workflowId ? { ...workflow, kind, updatedAt } : workflow,
        ),
      };
      commitWorkflowLibrary(nextLibrary);
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
    const block = createSavedWorkflowBlock(nodesToSave, edges, blockName, blockTags, blockCategory, activeWorkflow.kind);
    if (!block) {
      return;
    }
    onSavedBlocksChange((currentBlocks) => [block, ...currentBlocks].slice(0, 24));
    setBlockName("");
    setBlockCategory("Auto");
    setBlockTags("");
    setBlockLibraryMessage("Saved component");
    setContextMenu(null);
    setOutputConnectorMenu(null);
  }, [activeWorkflow.kind, blockCategory, blockName, blockTags, edges, onSavedBlocksChange]);

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
      setBlockCategory("Auto");
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

  const updateWorkflowNodeDataSource = useCallback(
    (nodeId: string, dataSourceId: string | null) => {
      const dataSource = dataSourceId ? dataSources.find((entry) => entry.id === dataSourceId) ?? null : null;
      const nextNodes = nodes.map((node) =>
        node.id === nodeId && node.data.dataSourceNode
          ? {
              ...node,
              data: workflowNodeDataWithDataSource(node.data, dataSource),
            }
          : node,
      );
      setNodes(nextNodes);
      setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== nodeId || compatibleConnection(nextNodes, edge)));
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [dataSources, nodes, setEdges, setNodes],
  );

  const updateWorkflowNodeAdapterSchemas = useCallback(
    (nodeId: string, inputSchema: DataSourceSchema, outputSchema: DataSourceSchema) => {
      const nextNodes = nodes.map((node) =>
        node.id === nodeId && node.data.adapterNode
          ? {
              ...node,
              data: workflowNodeDataWithAdapter(node.data, inputSchema, outputSchema),
            }
          : node,
      );
      setNodes(nextNodes);
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) => (edge.source !== nodeId && edge.target !== nodeId) || compatibleConnection(nextNodes, edge),
        ),
      );
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [nodes, setEdges, setNodes],
  );

  const setGroupOpen = useCallback(
    (nodeId: string, groupOpen: boolean) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId || !node.data.group) {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              groupOpen,
              minimized: groupOpen ? false : node.data.minimized,
            },
          };
        }),
      );
      setContextMenu(null);
      setOutputConnectorMenu(null);
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
    onSavedBlocksChange((currentBlocks) => currentBlocks.filter((block) => block.id !== blockId));
    setBlockLibraryMessage("Deleted component");
  }, [onSavedBlocksChange]);

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
      onSavedBlocksChange((currentBlocks) => mergeSavedWorkflowBlocks(importedBlocks, currentBlocks));
      setBlockLibraryMessage(`Loaded ${importedBlocks.length} component${importedBlocks.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBlockLibraryMessage(error instanceof Error ? error.message : "Could not load components");
    }
  }, [onSavedBlocksChange]);

  const updateDraftComponent = useCallback(() => {
    const draft = activeWorkflow.componentDraft;
    if (!draft) {
      return;
    }
    const existingBlock = savedBlocks.find((block) => block.id === draft.blockId);
    if (!existingBlock) {
      setBlockLibraryMessage("Original component was not found");
      return;
    }
    const nextBlock = buildSavedWorkflowBlock(nodes, edges, {
      requestedName: existingBlock.name,
      requestedTags: (existingBlock.tags ?? []).join(", "),
      requestedCategory: existingBlock.category ?? "Reusable",
      requestedKind: activeWorkflow.kind,
      id: existingBlock.id,
      createdAt: existingBlock.createdAt,
      minNodeCount: 1,
    });
    if (!nextBlock) {
      setBlockLibraryMessage("Component draft is empty");
      return;
    }
    onSavedBlocksChange((currentBlocks) =>
      currentBlocks.map((block) => (block.id === existingBlock.id ? nextBlock : block)),
    );
    setBlockLibraryMessage(`Updated component "${existingBlock.name}"`);
  }, [activeWorkflow.componentDraft, activeWorkflow.kind, edges, nodes, onSavedBlocksChange, savedBlocks]);

  const exportWorkflow = useCallback(() => {
    downloadWorkflowJson(activeWorkflow, nodes, edges);
    setBlockLibraryMessage(`Exported workflow with ${nodes.length} component${nodes.length === 1 ? "" : "s"}`);
  }, [activeWorkflow, edges, nodes]);

  const shareWorkflow = useCallback(async () => {
    if (nodes.length === 0) {
      setBlockLibraryMessage("No workflow to share");
      return;
    }

    setSharingWorkflow(true);
    try {
      const shareToken = await encodeWorkflowSharePayload(buildWorkflowFile(activeWorkflow, nodes, edges));
      const shareLink =
        typeof window === "undefined" ? null : workflowShareUrl(window.location.origin, shareToken);
      if (!shareLink) {
        throw new Error("Workflow sharing is unavailable in this environment");
      }

      if (await copyTextToClipboard(shareLink)) {
        setBlockLibraryMessage("Share link copied to clipboard");
      } else if (typeof window !== "undefined") {
        window.prompt("Copy this workflow share link", shareLink);
        setBlockLibraryMessage("Share link ready to copy");
      } else {
        throw new Error("Could not copy share link");
      }
    } catch (error) {
      setBlockLibraryMessage(error instanceof Error ? error.message : "Could not create share link");
    } finally {
      setSharingWorkflow(false);
    }
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
        if (workflow.workflowKind) {
          changeWorkflowKind(activeWorkflow.id, workflow.workflowKind);
        }
        setSelectedNodeIds([]);
        setContextMenu(null);
        setOutputConnectorMenu(null);
        setBlockLibraryMessage(`Loaded workflow updated ${formatWorkflowTimestamp(workflow.lastUpdated)}`);
      } catch (error) {
        setBlockLibraryMessage(error instanceof Error ? error.message : "Could not load workflow");
      }
    },
    [activeWorkflow.id, changeWorkflowKind, setEdges, setNodes],
  );

  const contextNodes = useMemo(
    () => (contextMenu ? nodes.filter((node) => contextMenu.nodeIds.includes(node.id)) : []),
    [contextMenu, nodes],
  );
  const primitiveNodeTemplates = useMemo(
    () => workflowCatalogNodeTemplates(workflowCatalog, workflowNodeTemplates),
    [workflowCatalog],
  );
  const contextGroupNode = contextNodes.length === 1 && contextNodes[0].data.group ? contextNodes[0] : null;
  const contextNodesAllMinimized = contextNodes.length > 0 && contextNodes.every((node) => node.data.minimized);
  const filteredPrimitiveNodes = useMemo(
    () => filterWorkflowNodeTemplates(primitiveNodeTemplates, componentSearch),
    [componentSearch, primitiveNodeTemplates],
  );
  const filteredSavedBlocks = useMemo(
    () => filterSavedWorkflowBlocks(savedBlocks, componentSearch),
    [componentSearch, savedBlocks],
  );
  const outputConnectorPrimitiveTargets = useMemo(
    () =>
      outputConnectorMenu
        ? workflowPrimitiveConnectorTargets(primitiveNodeTemplates, outputConnectorMenu.sourcePort)
        : [],
    [outputConnectorMenu?.sourcePort, primitiveNodeTemplates],
  );
  const outputConnectorSavedBlockTargets = useMemo(
    () =>
      outputConnectorMenu
        ? workflowSavedBlockConnectorTargets(savedBlocks, outputConnectorMenu.sourcePort)
        : [],
    [outputConnectorMenu?.sourcePort, savedBlocks],
  );
  const displayEdges = useMemo(() => workflowDisplayEdges(edges, nodes), [edges, nodes]);
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
      const data = template.data.adapterNode
        ? workflowNodeDataWithAdapterSource(cloneWorkflowNodeData(template.data), outputConnectorMenu.sourcePort)
        : cloneWorkflowNodeData(template.data);
      if (workflowNodeDataCanUseInlineLayout(data)) {
        data.minimized = true;
      }
      const position = connectedWorkflowNodePosition(sourceNode, nodes, data);
      const nextNode: WorkflowNodeModel = {
        id: nodeId,
        type: "workflow",
        position,
        data,
        selected: true,
      };
      const edge = workflowEdgeFromConnection(
        {
          source: outputConnectorMenu.sourceNodeId,
          sourceHandle: outputConnectorMenu.sourceHandle,
          target: nodeId,
          targetHandle: handleId("in", targetPort),
        },
        outputConnectorMenu.sourcePort,
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
        outputConnectorMenu.sourcePort,
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
  const attachDraggedInlineNode = useCallback(
    (draggedNode: WorkflowNodeModel) => {
      if (!workflowNodeDataCanUseInlineLayout(draggedNode.data)) {
        return;
      }

      const draggableNodes = nodes.map((node) =>
        node.id === draggedNode.id
          ? {
              ...node,
              position: { ...draggedNode.position },
              data: { ...node.data, minimized: true },
            }
          : node,
      );
      const attachment = workflowInlineAttachmentForDraggedNode(draggedNode.id, draggableNodes, edges);
      if (!attachment) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === draggedNode.id
            ? {
                ...node,
                position: attachment.position,
                data: { ...node.data, minimized: true },
                selected: true,
              }
            : node,
        ),
      );
      setEdges((currentEdges) => dedupeEdges(currentEdges.concat(attachment.edge)));
      setSelectedNodeIds([draggedNode.id]);
      setContextMenu(null);
      setOutputConnectorMenu(null);
    },
    [edges, nodes, setEdges, setNodes],
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
        const template = primitiveNodeTemplates.find((node) => node.id === payload.id);
        if (template) {
          if (position && workflowNodeDataCanUseInlineLayout(template.data)) {
            const nodeId = createWorkflowNodeInstanceId(template.id);
            const data = { ...cloneWorkflowNodeData(template.data), minimized: true };
            const nextNode: WorkflowNodeModel = {
              id: nodeId,
              type: "workflow",
              position,
              data,
              selected: true,
            };
            const attachment = workflowInlineAttachmentForDrop(nodeId, nodes.concat(nextNode), edges, position);
            setNodes((currentNodes) => {
              const nextNodes: WorkflowNodeModel[] = currentNodes.map((node) => ({ ...node, selected: false }));
              return nextNodes.concat({
                  ...nextNode,
                  position: attachment?.position ?? position,
                  selected: true,
                });
            });
            if (attachment) {
              setEdges((currentEdges) => dedupeEdges(currentEdges.concat(attachment.edge)));
            }
            setSelectedNodeIds([nodeId]);
            setContextMenu(null);
            setOutputConnectorMenu(null);
            return;
          }
          addPrimitiveNode(template, position);
        }
        return;
      }
      const block = savedBlocks.find((candidate) => candidate.id === payload.id);
      if (block) {
        addSavedBlock(block, position);
      }
    },
    [addPrimitiveNode, addSavedBlock, edges, flowInstance, nodes, primitiveNodeTemplates, savedBlocks, setEdges, setNodes],
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
      <WorkflowFocusContext.Provider value={focusTarget}>
        <WorkflowOutputConnectorContext.Provider value={outputConnectorContextValue}>
        <section
          className={classNames(
            "grid min-h-[760px] gap-4",
            componentsCollapsed && detailsCollapsed
              ? "xl:grid-cols-[64px_minmax(0,1fr)_64px]"
              : componentsCollapsed
                ? "xl:grid-cols-[64px_minmax(0,1fr)_340px]"
                : detailsCollapsed
                  ? "xl:grid-cols-[300px_minmax(0,1fr)_64px]"
                  : "xl:grid-cols-[300px_minmax(0,1fr)_340px]",
          )}
          style={portTypeColorStyle}
        >
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
          collapsed={componentsCollapsed}
          onToggleCollapsed={() => setComponentsCollapsed((current) => !current)}
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
                {workflowKindName(activeWorkflow.kind)} · v{activeWorkflow.version} · {nodes.length} components · {edges.length} connections
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                onClick={onOpenRunWorkspace}
                title="Open run controls for this workflow"
              >
                <PlayIcon className="h-4 w-4" />
                Run Workflow
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
                onClick={saveActiveWorkflowVersion}
                title="Save workflow version"
              >
                <SaveIcon className="h-4 w-4" />
                Save Version
              </button>
              <button
                className={classNames(
                  "inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50",
                  sharingWorkflow && "cursor-wait opacity-75",
                )}
                onClick={() => void shareWorkflow()}
                disabled={sharingWorkflow}
                title="Copy a shareable workflow link"
              >
                {sharingWorkflow ? <SpinnerIcon className="h-4 w-4" /> : <OpenIcon className="h-4 w-4" />}
                {sharingWorkflow ? "Sharing" : "Share"}
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
                className={classNames(
                  "inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50",
                  nodes.length === 0 && "cursor-not-allowed opacity-50",
                )}
                onClick={arrangeWorkflow}
                disabled={nodes.length === 0}
                title="Arrange workflow to reduce overlap"
              >
                <ArrangeIcon className="h-4 w-4" />
                Arrange
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => {
                  const seedState = workflowSeedState(activeWorkflow.kind, activeWorkflow.name);
                  setNodes(seedState.nodes);
                  setEdges(seedState.edges);
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
          {connectionMessage && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {connectionMessage}
            </div>
          )}
          <div className="h-[720px] min-h-[560px] w-full">
            <ReactFlow<WorkflowNodeModel, Edge>
              nodes={nodes}
              edges={displayEdges}
              nodeTypes={workflowNodeTypes}
              onNodesChange={onWorkflowNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onReconnectStart={onReconnectStart}
              onReconnectEnd={onReconnectEnd}
              isValidConnection={isValidConnection}
              onNodeDragStop={(_event, node) => attachDraggedInlineNode(node)}
              onSelectionChange={onSelectionChange}
              onPaneClick={() => {
                setContextMenu(null);
                setOutputConnectorMenu(null);
                setConnectionMessage(null);
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
                  canOpenGroup={Boolean(contextGroupNode)}
                  groupOpen={contextGroupNode?.data.groupOpen === true}
                  groupOpenLabel={contextGroupNode?.data.groupOpen ? "Close group" : "Open group"}
                  minimizeLabel={contextNodesAllMinimized ? "Expand selected" : "Minimize selected"}
                  onGroup={() => groupNodes(contextMenu.nodeIds)}
                  onSave={() => saveNodesAsBlock(contextNodes)}
                  onToggleGroupOpen={() => {
                    if (contextGroupNode) {
                      setGroupOpen(contextGroupNode.id, !contextGroupNode.data.groupOpen);
                    }
                  }}
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
          dataSources={dataSources}
          selectedNodes={selectedNodes}
          selectedInternalEdgeCount={selectedInternalEdgeCount}
          blockName={blockName}
          blockCategory={blockCategory}
          blockTags={blockTags}
          onBlockNameChange={setBlockName}
          onBlockCategoryChange={setBlockCategory}
          onBlockTagsChange={setBlockTags}
          onSelectWorkflow={selectWorkflow}
          onCreateWorkflow={createBlankWorkflow}
          onCloneWorkflow={cloneActiveWorkflow}
          onDeleteWorkflow={() => deleteWorkflow(activeWorkflow.id)}
          workflowNameDraft={workflowNameDraft}
          onWorkflowNameDraftChange={setWorkflowNameDraft}
          onCommitWorkflowName={commitActiveWorkflowName}
          onWorkflowKindChange={(kind) => changeWorkflowKind(activeWorkflow.id, kind)}
          onSaveSelectedBlock={saveSelectedBlock}
          onGroupSelected={() => groupNodes(selectedNodeIds)}
          onDeleteSelected={() => deleteWorkflowNodes(selectedNodeIds)}
          onUpdateSelectedGroup={updateGroupDetails}
          onUpdateSelectedDataSource={updateWorkflowNodeDataSource}
          onUpdateSelectedAdapter={updateWorkflowNodeAdapterSchemas}
          onToggleSelectedGroupOpen={() => {
            const groupNode = selectedNodes.length === 1 && selectedNodes[0].data.group ? selectedNodes[0] : null;
            if (groupNode) {
              setGroupOpen(groupNode.id, !groupNode.data.groupOpen);
            }
          }}
          onUngroupSelected={() => {
            const groupNode = selectedNodes.length === 1 && selectedNodes[0].data.group ? selectedNodes[0] : null;
            if (groupNode) {
              ungroupNode(groupNode.id);
            }
          }}
          onSaveWorkflowVersion={saveActiveWorkflowVersion}
          onUpdateDraftComponent={updateDraftComponent}
          onRestoreWorkflowVersion={restoreWorkflowVersion}
          onFocusNode={focusWorkflowNode}
          collapsed={detailsCollapsed}
          onToggleCollapsed={() => setDetailsCollapsed((current) => !current)}
          onOpenRunWorkspace={onOpenRunWorkspace}
        />
      </section>
        </WorkflowOutputConnectorContext.Provider>
      </WorkflowFocusContext.Provider>
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

function WorkflowComponentCategoryGroup({
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

function ComponentsPage({
  savedBlocks,
  onSavedBlocksChange,
  onEditComponent,
  onTestComponent,
}: {
  savedBlocks: SavedWorkflowBlock[];
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
                        <WorkflowTypeDetails spec={input.port.valueType} />
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
                        <WorkflowTypeDetails spec={output.port.valueType} />
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

function WorkflowDetailsPanel({
  workflowLibrary,
  activeWorkflow,
  nodes,
  edges,
  dataSources,
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
  onSaveSelectedBlock: () => void;
  onGroupSelected: () => void;
  onDeleteSelected: () => void;
  onUpdateSelectedGroup: (nodeId: string, updates: Pick<WorkflowNodeData, "title" | "description">) => void;
  onUpdateSelectedDataSource: (nodeId: string, dataSourceId: string | null) => void;
  onUpdateSelectedAdapter: (nodeId: string, inputSchema: DataSourceSchema, outputSchema: DataSourceSchema) => void;
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
              <AdapterNodeSettings node={selectedNode} onChange={onUpdateSelectedAdapter} />
            )}
            <WorkflowPortConnectionsList
              title="Inputs"
              groups={selectedInputConnections}
              onFocusNode={onFocusNode}
            />
            <WorkflowPortConnectionsList
              title="Outputs"
              groups={selectedOutputConnections}
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
  onFocusNode,
}: {
  title: string;
  groups: WorkflowPortConnectionGroup[];
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
                <WorkflowTypeDetails spec={portValue.valueType} />
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

function WorkflowTypeDetails({ spec }: { spec: WorkflowTypeSpec }) {
  return (
    <pre className="mt-2 overflow-auto rounded-md bg-white/80 px-2 py-2 font-mono text-[10px] leading-4 text-zinc-600">
      {formatWorkflowTypeSpecJson(spec)}
    </pre>
  );
}

function DataSourceNodeSettings({
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

function AdapterNodeSettings({
  node,
  onChange,
}: {
  node: WorkflowNodeModel;
  onChange: (nodeId: string, inputSchema: DataSourceSchema, outputSchema: DataSourceSchema) => void;
}) {
  const inputSchema = normalizeDataSourceSchema(node.data.adapterInputSchema, { type: "any" });
  const outputSchema = normalizeDataSourceSchema(node.data.adapterOutputSchema, { type: "any" });
  const inputPort = node.data.inputs[0];
  const outputPort = node.data.outputs[0];

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
          onChange={(nextInputSchema) => onChange(node.id, nextInputSchema, outputSchema)}
        />
      </div>
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase text-zinc-500">Output contract</div>
        <DataSourceSchemaEditor
          schema={outputSchema}
          onChange={(nextOutputSchema) => onChange(node.id, inputSchema, nextOutputSchema)}
        />
      </div>
    </div>
  );
}

function DataSourceSchemaEditor({
  schema,
  onChange,
  depth = 0,
}: {
  schema: DataSourceSchema;
  onChange: (schema: DataSourceSchema) => void;
  depth?: number;
}) {
  const updateKind = (kind: DataSourceSchema["type"]) => {
    onChange(defaultDataSourceSchemaForKind(kind));
  };

  return (
    <section className={classNames("rounded-lg border border-zinc-200 bg-zinc-50 p-3", depth > 0 && "bg-white")}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={depth === 0 ? "Type" : "Nested type"}>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={schema.type}
            onChange={(event) => updateKind(event.target.value as DataSourceSchema["type"])}
          >
            <option value="any">Any JSON</option>
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
            <option value="null">Null</option>
            <option value="binary">Binary</option>
            <option value="array">Array of</option>
            <option value="object">Object</option>
            <option value="union">Union</option>
            <option value="port">Workflow port type</option>
          </select>
        </Field>
        <Metric label="Workflow output" value={formatWorkflowTypeSpec(dataSourceSchemaToWorkflowType(schema))} />
      </div>

      {schema.type === "port" && (
        <Field label="Port type">
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={schema.portType}
            onChange={(event) => onChange({ type: "port", portType: event.target.value as DataSourceType })}
          >
            {dataSourceOutputTypes.map((type) => (
              <option key={type} value={type}>
                {formatPortType(type)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {schema.type === "binary" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Media type">
            <input
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={schema.mediaType}
              onChange={(event) => onChange({ ...schema, mediaType: event.target.value })}
              placeholder="audio/mpeg"
            />
          </Field>
          <Field label="Port type">
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={schema.portType}
              onChange={(event) => onChange({ ...schema, portType: event.target.value as DataSourceType })}
            >
              {dataSourceOutputTypes.map((type) => (
                <option key={type} value={type}>
                  {formatPortType(type)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {schema.type === "array" && (
        <div className="mt-3 border-l-2 border-zinc-200 pl-3">
          <DataSourceSchemaEditor
            schema={schema.items}
            onChange={(items) => onChange({ ...schema, items })}
            depth={depth + 1}
          />
        </div>
      )}

      {schema.type === "union" && (
        <div className="mt-3 space-y-3">
          {schema.variants.map((variant, index) => (
            <div key={`variant-${index}`} className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase text-zinc-500">Variant {index + 1}</div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-zinc-600 hover:bg-zinc-50"
                  onClick={() =>
                    onChange({
                      ...schema,
                      variants: schema.variants.filter((_, variantIndex) => variantIndex !== index),
                    })
                  }
                  disabled={schema.variants.length <= 1}
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
              <DataSourceSchemaEditor
                schema={variant}
                onChange={(nextVariant) =>
                  onChange({
                    ...schema,
                    variants: schema.variants.map((candidate, candidateIndex) =>
                      candidateIndex === index ? nextVariant : candidate,
                    ),
                  })
                }
                depth={depth + 1}
              />
            </div>
          ))}
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => onChange({ ...schema, variants: [...schema.variants, { type: "any" }] })}
          >
            <PlusIcon className="h-4 w-4" />
            Add Variant
          </button>
        </div>
      )}

      {schema.type === "object" && (
        <div className="mt-3 space-y-3">
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-zinc-300"
              checked={schema.additionalProperties !== false}
              onChange={(event) => onChange({ ...schema, additionalProperties: event.target.checked })}
            />
            Allow additional properties
          </label>
          {schema.properties.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-4 text-sm text-zinc-500">
              No properties defined.
            </div>
          ) : (
            schema.properties.map((property) => (
              <div key={property.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    className="min-w-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={property.name}
                    onChange={(event) =>
                      onChange(updateDataSourceSchemaProperty(schema, property.id, { name: event.target.value }))
                    }
                    placeholder="property_name"
                  />
                  <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300"
                      checked={property.required}
                      onChange={(event) =>
                        onChange(updateDataSourceSchemaProperty(schema, property.id, { required: event.target.checked }))
                      }
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-zinc-600 hover:bg-zinc-50"
                    onClick={() => onChange(removeDataSourceSchemaProperty(schema, property.id))}
                    title="Remove property"
                    aria-label="Remove property"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 border-l-2 border-zinc-200 pl-3">
                  <DataSourceSchemaEditor
                    schema={property.schema}
                    onChange={(propertySchema) =>
                      onChange(updateDataSourceSchemaProperty(schema, property.id, { schema: propertySchema }))
                    }
                    depth={depth + 1}
                  />
                </div>
              </div>
            ))
          )}
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => onChange(addDataSourceSchemaProperty(schema))}
          >
            <PlusIcon className="h-4 w-4" />
            Add Property
          </button>
        </div>
      )}
    </section>
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

function buildSavedWorkflowBlock(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  {
    requestedName,
    requestedTags = "",
    requestedCategory = "Auto",
    requestedKind,
    id,
    createdAt,
    minNodeCount = 2,
  }: {
    requestedName: string;
    requestedTags?: string;
    requestedCategory?: WorkflowBlockCategoryDraft | WorkflowComponentCategory;
    requestedKind?: WorkflowKindId;
    id?: string;
    createdAt?: string;
    minNodeCount?: number;
  },
): SavedWorkflowBlock | null {
  if (selectedNodes.length < minNodeCount) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const minX = Math.min(...selectedNodes.map((node) => node.position.x));
  const minY = Math.min(...selectedNodes.map((node) => node.position.y));
  const name = requestedName.trim() || defaultWorkflowBlockName(selectedNodes);
  const tags = parseWorkflowTags(requestedTags);
  const category =
    requestedCategory === "Auto" ? categoryForWorkflowNodes(selectedNodes) : workflowComponentCategory(requestedCategory);

  return {
    id: id ?? createWorkflowBlockId(),
    name,
    createdAt: createdAt ?? new Date().toISOString(),
    ...(requestedKind ? { kind: requestedKind } : {}),
    category,
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

function createSavedWorkflowBlock(
  selectedNodes: WorkflowNodeModel[],
  edges: Edge[],
  requestedName: string,
  requestedTags = "",
  requestedCategory: WorkflowBlockCategoryDraft = "Auto",
  requestedKind?: WorkflowKindId,
): SavedWorkflowBlock | null {
  return buildSavedWorkflowBlock(selectedNodes, edges, {
    requestedName,
    requestedTags,
    requestedCategory,
    requestedKind,
  });
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
      category: categoryForWorkflowNodes(selectedNodes),
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
        inputBoundaries.push({
          wrapperPortId: wrapperPort.id,
          nodeId: node.id,
          handle,
          type: input.type,
          ...(portIsStream(input) ? { stream: true } : {}),
        });
      }
    }

    for (const output of node.data.outputs) {
      const handle = handleId("out", output);
      const hasInternalEdge = internalEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      const hasOutgoingEdge = outgoingEdges.some((edge) => edge.source === node.id && edge.sourceHandle === handle);
      if (!hasInternalEdge || hasOutgoingEdge) {
        const wrapperPort = groupBoundaryPort("out", node, output);
        outputPorts.push(wrapperPort);
        outputBoundaries.push({
          wrapperPortId: wrapperPort.id,
          nodeId: node.id,
          handle,
          type: output.type,
          ...(portIsStream(output) ? { stream: true } : {}),
        });
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
      category: categoryForWorkflowNodes(selectedNodes),
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
        wrapperPort,
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
        wrapperPort,
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
    const sourcePort = findPort(restoredNodes, source, edge.sourceHandle, "out");
    const targetPort = findPort(restoredNodes, target, edge.targetHandle, "in");
    const edgePort = sourcePort ?? targetPort ?? "run_config";
    return [
      workflowEdgeFromConnection(
        {
          source,
          sourceHandle: edge.sourceHandle ?? null,
          target,
          targetHandle: edge.targetHandle ?? null,
        },
        edgePort,
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
          port(boundary.wrapperPortId, boundary.wrapperPortId, boundary.type, { stream: boundary.stream }),
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
          port(boundary.wrapperPortId, boundary.wrapperPortId, boundary.type, { stream: boundary.stream }),
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
    const edgePort = sourcePort ?? targetPort ?? "run_config";
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
        edgePort,
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
    category: workflowComponentCategory(data.category ?? categoryForWorkflowNodeData(data)),
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
  if (data.groupOpen) {
    cloned.groupOpen = true;
  }
  if (data.minimized) {
    cloned.minimized = true;
  }
  if (data.dataSourceNode) {
    cloned.dataSourceNode = true;
  }
  if (typeof data.dataSourceId === "string") {
    cloned.dataSourceId = data.dataSourceId;
  }
  if (isDataSourceType(data.dataSourceType)) {
    cloned.dataSourceType = data.dataSourceType;
  }
  if (data.adapterNode) {
    cloned.adapterNode = true;
  }
  if (isDataSourceSchema(data.adapterInputSchema)) {
    cloned.adapterInputSchema = normalizeDataSourceSchema(data.adapterInputSchema, { type: "any" });
  }
  if (isDataSourceSchema(data.adapterOutputSchema)) {
    cloned.adapterOutputSchema = normalizeDataSourceSchema(data.adapterOutputSchema, { type: "any" });
  }
  return cloned;
}

function cloneFlowPort(portValue: FlowPort): FlowPort {
  return normalizeFlowPort(portValue);
}

function normalizeFlowPort(portValue: Pick<FlowPort, "id" | "label" | "type"> & Partial<FlowPort>): FlowPort {
  return {
    id: portValue.id,
    label: portValue.label,
    type: portValue.type,
    ...(portValue.kind ? { kind: portValue.kind } : {}),
    valueType: isWorkflowTypeSpec(portValue.valueType) ? structuredClone(portValue.valueType) : workflowTypeForPortType(portValue.type),
    ...(portValue.optional ? { optional: true } : {}),
    ...(portValue.stream ? { stream: true } : {}),
    ...(portValue.exposableInput ? { exposableInput: true } : {}),
    ...(portValue.inputSurface ? { inputSurface: portValue.inputSurface } : {}),
    ...(portValue.suggestedAdapters ? { suggestedAdapters: [...portValue.suggestedAdapters] } : {}),
    ...(portValue.runtimeValidation ? { runtimeValidation: portValue.runtimeValidation } : {}),
  };
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
  return normalizeFlowPort({
    id: `${direction}-${safeFlowId(node.id)}-${safeFlowId(portValue.id)}`,
    label: `${node.data.title}: ${portValue.label}`,
    type: portValue.type,
    kind: portValue.kind,
    valueType: structuredClone(portValue.valueType),
    optional: portValue.optional,
    stream: portValue.stream,
    exposableInput: portValue.exposableInput,
    inputSurface: portValue.inputSurface,
    suggestedAdapters: portValue.suggestedAdapters,
    runtimeValidation: portValue.runtimeValidation,
  });
}

function boundaryKey(nodeId: string, handle: string | null | undefined): string {
  return `${nodeId}|${handle ?? ""}`;
}

function dedupePorts(ports: FlowPort[]): FlowPort[] {
  const seen = new Set<string>();
  return ports.filter((portValue) => {
    const key = `${portValue.id}|${handleSignature(portValue)}`;
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

function workflowDisplayEdges(edges: Edge[], nodes: WorkflowNodeModel[]): Edge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const hidden = source && target ? workflowEdgeHiddenByInlineAttachment(edge, source, target) : false;
    return hidden === Boolean(edge.hidden) ? edge : { ...edge, hidden };
  });
}

function workflowEdgeHiddenByInlineAttachment(edge: Edge, source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  if (!workflowEdgeTouchesInlineNode(edge, source, target)) {
    return false;
  }
  return workflowNodesAreVisuallyAttached(source, target);
}

function workflowEdgeTouchesInlineNode(edge: Edge, source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  const sourceInline = workflowNodeDataUsesInlineLayout(source.data);
  const targetInline = workflowNodeDataUsesInlineLayout(target.data);
  if (!sourceInline && !targetInline) {
    return false;
  }
  if (sourceInline) {
    const sourceOutput = source.data.outputs[0];
    if (!sourceOutput || edge.sourceHandle !== handleId("out", sourceOutput)) {
      return false;
    }
  }
  if (targetInline) {
    const targetInput = target.data.inputs[0];
    if (!targetInput || edge.targetHandle !== handleId("in", targetInput)) {
      return false;
    }
  }
  return true;
}

function workflowNodesAreVisuallyAttached(source: WorkflowNodeModel, target: WorkflowNodeModel): boolean {
  const sourceSize = workflowLayoutNodeSize(source);
  const targetSize = workflowLayoutNodeSize(target);
  const gap = target.position.x - (source.position.x + sourceSize.width);
  if (gap < -2 || gap > workflowInlineAttachGap + 10) {
    return false;
  }

  const sourceCenterY = source.position.y + sourceSize.height / 2;
  const targetCenterY = target.position.y + targetSize.height / 2;
  const yTolerance = Math.max(42, Math.max(sourceSize.height, targetSize.height) / 2 + workflowInlineAttachGap);
  return Math.abs(sourceCenterY - targetCenterY) <= yTolerance;
}

function workflowNodeDataCanUseInlineLayout(data: WorkflowNodeData): boolean {
  return data.kind !== "group" && data.inputs.length <= 1 && data.outputs.length <= 1 && data.inputs.length + data.outputs.length > 0;
}

function workflowNodeDataUsesInlineLayout(data: WorkflowNodeData): boolean {
  return data.minimized === true && workflowNodeDataCanUseInlineLayout(data);
}

function stickWorkflowInlineAttachments(nodes: WorkflowNodeModel[], edges: Edge[]): WorkflowNodeModel[] {
  if (nodes.length === 0 || edges.length === 0) {
    return nodes;
  }

  let nextNodes = nodes;
  for (let pass = 0; pass < 4; pass += 1) {
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
    const incomingInlineNodeIds = new Set(
      edges
        .map((edge) => {
          const target = nodeById.get(edge.target);
          return target && workflowNodeDataUsesInlineLayout(target.data) ? target.id : null;
        })
        .filter((id): id is string => id !== null),
    );
    const positionByInlineNodeId = new Map<string, { x: number; y: number }>();

    for (const edge of edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) {
        continue;
      }

      const incomingPosition = workflowInlineIncomingAttachmentPosition(edge, source, target);
      if (incomingPosition) {
        positionByInlineNodeId.set(target.id, incomingPosition);
        continue;
      }

      if (incomingInlineNodeIds.has(source.id)) {
        continue;
      }

      const outgoingPosition = workflowInlineOutgoingAttachmentPosition(edge, source, target);
      if (outgoingPosition) {
        positionByInlineNodeId.set(source.id, outgoingPosition);
      }
    }

    if (positionByInlineNodeId.size === 0) {
      return nextNodes;
    }

    let changed = false;
    nextNodes = nextNodes.map((node) => {
      const position = positionByInlineNodeId.get(node.id);
      if (!position || (node.position.x === position.x && node.position.y === position.y)) {
        return node;
      }
      changed = true;
      return { ...node, position };
    });

    if (!changed) {
      return nextNodes;
    }
  }

  return nextNodes;
}

function workflowInlineIncomingAttachmentPosition(
  edge: Edge,
  source: WorkflowNodeModel,
  target: WorkflowNodeModel,
): { x: number; y: number } | null {
  if (!workflowNodeDataUsesInlineLayout(target.data)) {
    return null;
  }
  const input = target.data.inputs[0];
  if (!input || edge.targetHandle !== handleId("in", input)) {
    return null;
  }
  const sourcePort = source.data.outputs.find((portValue) => edge.sourceHandle === handleId("out", portValue));
  if (!sourcePort || !portsCompatible(sourcePort, input)) {
    return null;
  }
  const sourceSize = workflowLayoutNodeSize(source);
  const sourceHandlePoint = workflowPortHandlePoint(source, "out", sourcePort);
  return {
    x: source.position.x + sourceSize.width + workflowInlineAttachGap,
    y: sourceHandlePoint.y - inlineWorkflowNodeHeight / 2,
  };
}

function workflowInlineOutgoingAttachmentPosition(
  edge: Edge,
  source: WorkflowNodeModel,
  target: WorkflowNodeModel,
): { x: number; y: number } | null {
  if (!workflowNodeDataUsesInlineLayout(source.data)) {
    return null;
  }
  const output = source.data.outputs[0];
  if (!output || edge.sourceHandle !== handleId("out", output)) {
    return null;
  }
  const targetPort = target.data.inputs.find((portValue) => edge.targetHandle === handleId("in", portValue));
  if (!targetPort || !portsCompatible(output, targetPort)) {
    return null;
  }
  const targetHandlePoint = workflowPortHandlePoint(target, "in", targetPort);
  return {
    x: target.position.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
    y: targetHandlePoint.y - inlineWorkflowNodeHeight / 2,
  };
}

function workflowInlineAttachmentForDraggedNode(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
): WorkflowInlineAttachment | null {
  return workflowInlineAttachmentForNode(nodeId, nodes, edges, "drag");
}

function workflowInlineAttachmentForDrop(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  dropPoint: { x: number; y: number },
): WorkflowInlineAttachment | null {
  return workflowInlineAttachmentForNode(nodeId, nodes, edges, "drop", dropPoint);
}

function workflowInlineAttachmentForNode(
  nodeId: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  mode: "drag" | "drop",
  dropPoint?: { x: number; y: number },
): WorkflowInlineAttachment | null {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !workflowNodeDataCanUseInlineLayout(node.data)) {
    return null;
  }

  const candidates: Array<WorkflowInlineAttachment & { score: number }> = [];
  const input = node.data.inputs[0];
  const output = node.data.outputs[0];
  const currentInputPoint = mode === "drop" && dropPoint
    ? dropPoint
    : { x: node.position.x, y: node.position.y + workflowLayoutNodeSize(node).height / 2 };
  const currentOutputPoint = mode === "drop" && dropPoint
    ? dropPoint
    : { x: node.position.x + workflowLayoutNodeSize(node).width, y: node.position.y + workflowLayoutNodeSize(node).height / 2 };

  if (input) {
    for (const source of nodes) {
      if (source.id === node.id) {
        continue;
      }
      for (const sourcePort of source.data.outputs) {
        if (!portsCompatible(sourcePort, input)) {
          continue;
        }
        const sourceHandlePoint = workflowPortHandlePoint(source, "out", sourcePort);
        const score = distanceBetweenPoints(currentInputPoint, sourceHandlePoint);
        if (score > workflowInlineSnapDistance) {
          continue;
        }
        const sourceSize = workflowLayoutNodeSize(source);
        const position = {
          x: source.position.x + sourceSize.width + workflowInlineAttachGap,
          y: sourceHandlePoint.y - inlineWorkflowNodeHeight / 2,
        };
        candidates.push({
          score,
          position,
          edge: workflowEdgeFromConnection(
            {
              source: source.id,
              sourceHandle: handleId("out", sourcePort),
              target: node.id,
              targetHandle: handleId("in", input),
            },
            sourcePort,
          ),
        });
      }
    }
  }

  if (output) {
    for (const target of nodes) {
      if (target.id === node.id) {
        continue;
      }
      for (const targetPort of target.data.inputs) {
        if (!portsCompatible(output, targetPort)) {
          continue;
        }
        const targetHandlePoint = workflowPortHandlePoint(target, "in", targetPort);
        const score = distanceBetweenPoints(currentOutputPoint, targetHandlePoint);
        if (score > workflowInlineSnapDistance) {
          continue;
        }
        const position = {
          x: target.position.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
          y: targetHandlePoint.y - inlineWorkflowNodeHeight / 2,
        };
        candidates.push({
          score,
          position,
          edge: workflowEdgeFromConnection(
            {
              source: node.id,
              sourceHandle: handleId("out", output),
              target: target.id,
              targetHandle: handleId("in", targetPort),
            },
            output,
          ),
        });
      }
    }
  }

  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  const safeCandidates = candidates.filter(
    (candidate) =>
      !existingEdgeIds.has(candidate.edge.id) && !workflowGraphWouldCreateCycle(edges, candidate.edge),
  );
  return (
    safeCandidates.sort((left, right) => left.score - right.score)[0] ??
    null
  );
}

function workflowPortHandlePoint(
  node: WorkflowNodeModel,
  direction: PortDirection,
  portValue: FlowPort,
): { x: number; y: number } {
  const size = workflowLayoutNodeSize(node);
  return {
    x: direction === "in" ? node.position.x : node.position.x + size.width,
    y: node.position.y + workflowPortCenterY(node, direction, portValue, size),
  };
}

function workflowPortCenterY(
  node: WorkflowNodeModel,
  direction: PortDirection,
  portValue: FlowPort,
  size = workflowLayoutNodeSize(node),
): number {
  if (workflowNodeDataUsesInlineLayout(node.data)) {
    return size.height / 2;
  }

  const ports = direction === "in" ? node.data.inputs : node.data.outputs;
  const index = Math.max(
    0,
    ports.findIndex(
      (candidate) => candidate.id === portValue.id && handleSignature(candidate) === handleSignature(portValue),
    ),
  );
  if (node.data.minimized) {
    return ((index + 1) / (ports.length + 1)) * size.height;
  }

  const portRows = Math.max(1, node.data.inputs.length, node.data.outputs.length);
  const portAreaHeight = portRows * 48;
  const headerHeight = Math.max(64, size.height - portAreaHeight);
  return Math.min(size.height - 18, headerHeight + index * 48 + 24);
}

function distanceBetweenPoints(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function autoArrangeWorkflowNodes(nodes: WorkflowNodeModel[], edges: Edge[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) {
    return nodes.map((node) => ({
      ...node,
      position: { x: workflowLayoutStartX, y: workflowLayoutStartY },
    }));
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layoutEdges = workflowLayoutEdges(edges, nodeById);
  const rankEdges = workflowLayoutRankEdges(layoutEdges, nodeById);
  const rankById = compactWorkflowLayoutRanks(workflowLayoutRanks(nodes, rankEdges));
  const columns = workflowLayoutColumns(nodes, rankById);
  const orderedColumns = orderWorkflowLayoutColumns(columns, layoutEdges);
  const sizeById = new Map(nodes.map((node) => [node.id, workflowLayoutNodeSize(node)]));
  const positionById = new Map<string, { x: number; y: number }>();
  let x = workflowLayoutStartX;

  for (const column of orderedColumns) {
    const columnWidth = Math.max(
      defaultWorkflowNodeWidth,
      ...column.map((node) => sizeById.get(node.id)?.width ?? defaultWorkflowNodeWidth),
    );
    let y = workflowLayoutStartY;

    for (const node of column) {
      const size = sizeById.get(node.id) ?? { width: defaultWorkflowNodeWidth, height: defaultWorkflowGroupHeight };
      positionById.set(node.id, { x, y });
      y += size.height + workflowLayoutRowGap;
    }

    x += columnWidth + workflowLayoutColumnGap;
  }

  positionInlineWorkflowNodes(nodes, edges, sizeById, positionById);

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? { ...node.position },
  }));
}

function positionInlineWorkflowNodes(
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  sizeById: Map<string, WorkflowLayoutSize>,
  positionById: Map<string, { x: number; y: number }>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inlineNodesBySource = new Map<string, WorkflowNodeModel[]>();
  const inlineNodesByTarget = new Map<string, WorkflowNodeModel[]>();
  const positionedInlineNodeIds = new Set<string>();

  for (const node of nodes) {
    if (!workflowNodeDataUsesInlineLayout(node.data)) {
      continue;
    }
    const incomingEdge = edges.find((edge) => edge.target === node.id && nodeById.has(edge.source));
    if (!incomingEdge) {
      continue;
    }
    inlineNodesBySource.set(incomingEdge.source, [...(inlineNodesBySource.get(incomingEdge.source) ?? []), node]);
    positionedInlineNodeIds.add(node.id);
  }

  for (const node of nodes) {
    if (!workflowNodeDataUsesInlineLayout(node.data) || positionedInlineNodeIds.has(node.id)) {
      continue;
    }
    const outgoingEdge = edges.find((edge) => edge.source === node.id && nodeById.has(edge.target));
    if (!outgoingEdge) {
      continue;
    }
    inlineNodesByTarget.set(outgoingEdge.target, [...(inlineNodesByTarget.get(outgoingEdge.target) ?? []), node]);
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const [sourceId, inlineNodes] of inlineNodesBySource) {
      const source = nodeById.get(sourceId);
      const sourcePosition = positionById.get(sourceId);
      if (!source || !sourcePosition) {
        continue;
      }

      const sourceSize = sizeById.get(source.id) ?? workflowLayoutNodeSize(source);
      const orderedInlineNodes = [...inlineNodes].sort(compareWorkflowLayoutNodesByPosition);
      const totalHeight =
        orderedInlineNodes.length * inlineWorkflowNodeHeight +
        Math.max(0, orderedInlineNodes.length - 1) * workflowInlineAttachGap;
      const startY = sourcePosition.y + sourceSize.height / 2 - totalHeight / 2;

      orderedInlineNodes.forEach((node, index) => {
        positionById.set(node.id, {
          x: sourcePosition.x + sourceSize.width + workflowInlineAttachGap,
          y: startY + index * (inlineWorkflowNodeHeight + workflowInlineAttachGap),
        });
      });
    }

    for (const [targetId, inlineNodes] of inlineNodesByTarget) {
      const target = nodeById.get(targetId);
      const targetPosition = positionById.get(targetId);
      if (!target || !targetPosition) {
        continue;
      }

      const targetSize = sizeById.get(target.id) ?? workflowLayoutNodeSize(target);
      const orderedInlineNodes = [...inlineNodes].sort(compareWorkflowLayoutNodesByPosition);
      const totalHeight =
        orderedInlineNodes.length * inlineWorkflowNodeHeight +
        Math.max(0, orderedInlineNodes.length - 1) * workflowInlineAttachGap;
      const startY = targetPosition.y + targetSize.height / 2 - totalHeight / 2;

      orderedInlineNodes.forEach((node, index) => {
        positionById.set(node.id, {
          x: targetPosition.x - inlineWorkflowNodeWidth - workflowInlineAttachGap,
          y: startY + index * (inlineWorkflowNodeHeight + workflowInlineAttachGap),
        });
      });
    }
  }
}

function workflowLayoutEdges(edges: Edge[], nodeById: Map<string, WorkflowNodeModel>): WorkflowLayoutEdge[] {
  const seen = new Set<string>();
  const layoutEdges: WorkflowLayoutEdge[] = [];

  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) {
      continue;
    }
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      continue;
    }
    const key = `${edge.source}|${edge.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    layoutEdges.push({ source: edge.source, target: edge.target });
  }

  return layoutEdges;
}

function workflowLayoutRankEdges(
  edges: WorkflowLayoutEdge[],
  nodeById: Map<string, WorkflowNodeModel>,
): WorkflowLayoutEdge[] {
  const forwardEdges = edges.filter((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    return Boolean(source && target && target.position.x + workflowLayoutBackEdgeTolerance >= source.position.x);
  });
  return forwardEdges.length > 0 ? forwardEdges : edges;
}

function workflowLayoutRanks(nodes: WorkflowNodeModel[], edges: WorkflowLayoutEdge[]): Map<string, number> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  const rankById = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
    .sort((left, right) => compareWorkflowLayoutNodeIds(left, right, nodeById));
  const processed = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (processed.has(id)) {
      continue;
    }
    processed.add(id);

    for (const target of outgoing.get(id) ?? []) {
      rankById.set(target, Math.max(rankById.get(target) ?? 0, (rankById.get(id) ?? 0) + 1));
      const nextIncomingCount = (incomingCount.get(target) ?? 0) - 1;
      incomingCount.set(target, nextIncomingCount);
      if (nextIncomingCount === 0) {
        queue.push(target);
        queue.sort((left, right) => compareWorkflowLayoutNodeIds(left, right, nodeById));
      }
    }
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const fallbackColumnWidth = defaultWorkflowNodeWidth + workflowLayoutColumnGap;
  for (const node of nodes) {
    if (processed.has(node.id)) {
      continue;
    }
    rankById.set(node.id, Math.max(0, Math.round((node.position.x - minX) / fallbackColumnWidth)));
  }

  return rankById;
}

function compactWorkflowLayoutRanks(rankById: Map<string, number>): Map<string, number> {
  const compactRankByValue = new Map(
    [...new Set([...rankById.values()])]
      .sort((left, right) => left - right)
      .map((rank, index) => [rank, index]),
  );
  return new Map([...rankById.entries()].map(([id, rank]) => [id, compactRankByValue.get(rank) ?? 0]));
}

function workflowLayoutColumns(
  nodes: WorkflowNodeModel[],
  rankById: Map<string, number>,
): WorkflowNodeModel[][] {
  const columnCount = Math.max(0, ...rankById.values()) + 1;
  const columns: WorkflowNodeModel[][] = Array.from({ length: columnCount }, () => []);

  for (const node of nodes) {
    columns[rankById.get(node.id) ?? 0].push(node);
  }

  return columns.map((column) => [...column].sort(compareWorkflowLayoutNodesByPosition));
}

function orderWorkflowLayoutColumns(
  columns: WorkflowNodeModel[][],
  edges: WorkflowLayoutEdge[],
): WorkflowNodeModel[][] {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const ordered = columns.map((column) => [...column]);
  let orderById = workflowLayoutOrderById(ordered);

  for (let pass = 0; pass < 3; pass += 1) {
    for (let columnIndex = 1; columnIndex < ordered.length; columnIndex += 1) {
      ordered[columnIndex].sort((left, right) =>
        compareWorkflowLayoutBarycenter(left, right, incoming, orderById),
      );
    }
    orderById = workflowLayoutOrderById(ordered);

    for (let columnIndex = ordered.length - 2; columnIndex >= 0; columnIndex -= 1) {
      ordered[columnIndex].sort((left, right) =>
        compareWorkflowLayoutBarycenter(left, right, outgoing, orderById),
      );
    }
    orderById = workflowLayoutOrderById(ordered);
  }

  return ordered;
}

function workflowLayoutOrderById(columns: WorkflowNodeModel[][]): Map<string, number> {
  const orderById = new Map<string, number>();
  for (const column of columns) {
    column.forEach((node, index) => orderById.set(node.id, index));
  }
  return orderById;
}

function compareWorkflowLayoutBarycenter(
  left: WorkflowNodeModel,
  right: WorkflowNodeModel,
  neighborsById: Map<string, string[]>,
  orderById: Map<string, number>,
): number {
  const leftCenter = workflowLayoutNeighborMedian(left.id, neighborsById, orderById);
  const rightCenter = workflowLayoutNeighborMedian(right.id, neighborsById, orderById);

  if (leftCenter !== null && rightCenter !== null && leftCenter !== rightCenter) {
    return leftCenter - rightCenter;
  }
  if (leftCenter !== null && rightCenter === null) {
    return -1;
  }
  if (leftCenter === null && rightCenter !== null) {
    return 1;
  }
  return compareWorkflowLayoutNodesByPosition(left, right);
}

function workflowLayoutNeighborMedian(
  nodeId: string,
  neighborsById: Map<string, string[]>,
  orderById: Map<string, number>,
): number | null {
  const neighborOrders = (neighborsById.get(nodeId) ?? [])
    .map((neighborId) => orderById.get(neighborId))
    .filter((order): order is number => order !== undefined)
    .sort((left, right) => left - right);

  if (neighborOrders.length === 0) {
    return null;
  }
  const middle = Math.floor(neighborOrders.length / 2);
  return neighborOrders.length % 2 === 1
    ? neighborOrders[middle]
    : (neighborOrders[middle - 1] + neighborOrders[middle]) / 2;
}

function workflowLayoutNodeSize(node: WorkflowNodeModel): WorkflowLayoutSize {
  if (workflowNodeDataUsesInlineLayout(node.data)) {
    return { width: inlineWorkflowNodeWidth, height: inlineWorkflowNodeHeight };
  }
  if (node.data.minimized) {
    return { width: 230, height: 54 };
  }

  const groupSize = node.data.kind === "group" ? normalizedWorkflowNodeSize(node.data.size) : null;
  if (groupSize) {
    const openGroupHeight =
      node.data.groupOpen && node.data.group ? workflowGroupOpenViewLayout(node.data.group).height + 128 : 0;
    return {
      width: groupSize.width,
      height: Math.max(groupSize.height, openGroupHeight),
    };
  }

  const portRows = Math.max(1, node.data.inputs.length, node.data.outputs.length);
  const descriptionRows = Math.max(1, Math.min(4, Math.ceil(node.data.description.length / 58)));
  return {
    width: defaultWorkflowNodeWidth,
    height: 112 + descriptionRows * 20 + portRows * 48,
  };
}

function compareWorkflowLayoutNodeIds(
  left: string,
  right: string,
  nodeById: Map<string, WorkflowNodeModel>,
): number {
  const leftNode = nodeById.get(left);
  const rightNode = nodeById.get(right);
  if (!leftNode || !rightNode) {
    return left.localeCompare(right);
  }
  return compareWorkflowLayoutNodesByPosition(leftNode, rightNode);
}

function compareWorkflowLayoutNodesByPosition(left: WorkflowNodeModel, right: WorkflowNodeModel): number {
  return left.position.y - right.position.y || left.position.x - right.position.x || left.id.localeCompare(right.id);
}

function nextBlockAnchor(nodes: WorkflowNodeModel[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 80, y: 80 };
  }
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return { x: maxX + 420, y: Math.max(40, minY) };
}

function connectedWorkflowNodePosition(
  sourceNode: WorkflowNodeModel,
  nodes: WorkflowNodeModel[],
  connectedNodeData?: WorkflowNodeData,
): { x: number; y: number } {
  const sourceSize = workflowLayoutNodeSize(sourceNode);
  const inlineTarget = connectedNodeData ? workflowNodeDataUsesInlineLayout(connectedNodeData) : false;
  const basePosition = inlineTarget
    ? {
        x: sourceNode.position.x + sourceSize.width + workflowInlineAttachGap,
        y: sourceNode.position.y + sourceSize.height / 2 - inlineWorkflowNodeHeight / 2,
      }
    : {
        x: sourceNode.position.x + sourceSize.width + 140,
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

function buildWorkflowFile(workflow: SavedWorkflow, nodes: WorkflowNodeModel[], edges: Edge[]): SavedWorkflowFile {
  return {
    format: savedWorkflowJsonFormat,
    version: savedWorkflowJsonVersion,
    lastUpdated: new Date().toISOString(),
    workflowName: workflow.name,
    workflowKind: workflow.kind,
    workflowVersion: workflow.version,
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
}

function downloadWorkflowJson(workflow: SavedWorkflow, nodes: WorkflowNodeModel[], edges: Edge[]) {
  if (typeof document === "undefined") {
    return;
  }

  const payload = buildWorkflowFile(workflow, nodes, edges);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    `video-analysis-workflow-${safeFlowId(workflow.name).toLowerCase()}-v${workflow.version}-${fileDateStamp(payload.lastUpdated)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseWorkflowJson(text: string): {
  lastUpdated: string;
  workflowName?: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  nodes: WorkflowNodeModel[];
  edges: Edge[];
} {
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

  return restoreWorkflowFile(parsed);
}

function restoreWorkflowFile(file: SavedWorkflowFile): {
  lastUpdated: string;
  workflowName?: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  nodes: WorkflowNodeModel[];
  edges: Edge[];
} {
  const nodes = file.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  if (!hasUniqueWorkflowNodeIds(nodes)) {
    throw new Error("Workflow contains duplicate component IDs");
  }

  return {
    lastUpdated: file.lastUpdated,
    workflowName: file.workflowName,
    workflowKind: file.workflowKind,
    workflowVersion: file.workflowVersion,
    nodes,
    edges: restoreValidWorkflowEdges(file.edges, nodes),
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
  if (!sourcePort || !targetPort || !portsCompatible(sourcePort, targetPort)) {
    return null;
  }

  return workflowEdgeFromConnection(
    {
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    },
    sourcePort,
  );
}

const workflowLoopValidationMessage =
  'Workflow contains a loop. Keep workflows acyclic and use "For Each Item" or "While Loop" for intentional iteration.';

function restoreValidWorkflowEdges(serializedEdges: SavedWorkflowBlockEdge[], nodes: WorkflowNodeModel[]): Edge[] {
  const restoredEdges = serializedEdges.map((edge) => restoreSavedWorkflowEdge(edge, nodes));
  if (restoredEdges.some((edge) => edge === null)) {
    throw new Error("Workflow contains invalid connections");
  }
  const edges = dedupeEdges(restoredEdges.filter((edge): edge is Edge => edge !== null));
  if (workflowGraphHasCycle(edges)) {
    throw new Error(workflowLoopValidationMessage);
  }
  return edges;
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

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to the legacy copy path below.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.className = "fixed left-[-9999px] top-0";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function loadSavedWorkflowLibrary(): SavedWorkflowLibrary {
  const workflowIdFromUrl =
    typeof window === "undefined" ? null : appLocationFromPath(window.location.pathname).workflowId;
  const fallback = workflowLibraryWithRequestedActiveId(seedSavedWorkflowLibrary(), workflowIdFromUrl);
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

    const workflows = ensureWorkflowKindCoverage(parsed.workflows.filter(savedWorkflowHasValidGraph).map(normalizeSavedWorkflow));
    if (workflows.length === 0) {
      persistSavedWorkflowLibrary(fallback);
      return fallback;
    }

    const library = workflowLibraryWithRequestedActiveId({
      format: savedWorkflowsJsonFormat,
      version: savedWorkflowsJsonVersion,
      activeWorkflowId: workflows.some((workflow) => workflow.id === parsed.activeWorkflowId)
        ? parsed.activeWorkflowId
        : workflows[0].id,
      workflows,
    }, workflowIdFromUrl);
    const migratedLibrary = migrateLegacySeedWorkflows(library);
    persistSavedWorkflowLibrary(migratedLibrary);
    return migratedLibrary;
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

function renameWorkflowLibraryDataSourceId(
  library: SavedWorkflowLibrary,
  previousId: string,
  nextId: string,
): SavedWorkflowLibrary {
  if (previousId === nextId) {
    return library;
  }
  const workflows = library.workflows.map((workflow) => ({
    ...workflow,
    nodes: workflow.nodes.map((node) => ({
      ...node,
      data:
        node.data.dataSourceNode && node.data.dataSourceId === previousId
          ? { ...node.data, dataSourceId: nextId }
          : node.data,
    })),
    versions: workflow.versions.map((version) => ({
      ...version,
      nodes: version.nodes.map((node) => ({
        ...node,
        data:
          node.data.dataSourceNode && node.data.dataSourceId === previousId
            ? { ...node.data, dataSourceId: nextId }
            : node.data,
      })),
    })),
  }));
  const nextLibrary = { ...library, workflows };
  persistSavedWorkflowLibrary(nextLibrary);
  return nextLibrary;
}

function workflowLibraryWithRequestedActiveId(
  library: SavedWorkflowLibrary,
  requestedWorkflowId: string | null,
): SavedWorkflowLibrary {
  if (!requestedWorkflowId || !library.workflows.some((workflow) => workflow.id === requestedWorkflowId)) {
    return library;
  }
  return {
    ...library,
    activeWorkflowId: requestedWorkflowId,
  };
}

function workflowSeedTemplateFor(kind: WorkflowKindId, name?: string): WorkflowSeedTemplate {
  return (name ? exampleWorkflowStarterTemplates[name] : null) ?? workflowStarterTemplates[kind];
}

function instantiateWorkflowSeedTemplate(template: WorkflowSeedTemplate): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
  const nodes = template.nodes.map((layout) => instantiateWorkflowSeedNode(layout));
  const edges = template.edges.map((edge) =>
    workflowEdge(edge.source, edge.sourcePortId, edge.target, edge.targetPortId),
  );
  return { nodes, edges };
}

function instantiateWorkflowSeedNode(layout: WorkflowSeedNodeLayout): WorkflowNodeModel {
  const template = workflowNodeTemplates.find((candidate) => candidate.id === layout.id);
  if (!template) {
    throw new Error(`Missing workflow node template ${layout.id}`);
  }
  return {
    ...template,
    position: { x: layout.x, y: layout.y },
    data: cloneWorkflowNodeData(template.data),
  };
}

function workflowSeedState(kind: WorkflowKindId, name?: string): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
  return instantiateWorkflowSeedTemplate(workflowSeedTemplateFor(kind, name));
}

function createSeedSavedWorkflow(
  name: string,
  kind: WorkflowKindId,
  id = createWorkflowId(),
): SavedWorkflow {
  const { nodes, edges } = workflowSeedState(kind, name);
  return createSavedWorkflow(name, nodes, edges, kind, id);
}

function migrateLegacySeedWorkflows(library: SavedWorkflowLibrary): SavedWorkflowLibrary {
  const legacySeedSnapshot = savedWorkflowGraphSnapshot(
    initialWorkflowNodes.map(serializeWorkflowNode),
    initialWorkflowEdges.map(serializeWorkflowEdge),
  );
  let changed = false;
  const workflows = library.workflows.map((workflow) => {
    if (!isBuiltInSeedWorkflow(workflow) || savedWorkflowGraphSnapshot(workflow.nodes, workflow.edges) !== legacySeedSnapshot) {
      return workflow;
    }
    changed = true;
    return recreateSeedWorkflow(workflow);
  });
  return changed ? { ...library, workflows } : library;
}

function recreateSeedWorkflow(workflow: SavedWorkflow): SavedWorkflow {
  const seeded = createSeedSavedWorkflow(workflow.name, workflow.kind, workflow.id);
  const createdAt = workflow.createdAt;
  const updatedAt = new Date().toISOString();
  return {
    ...seeded,
    createdAt,
    updatedAt,
    versions: seeded.versions.map((version, index) => ({
      ...version,
      version: index + 1,
      createdAt,
      name: workflow.name,
    })),
  };
}

function isBuiltInSeedWorkflow(workflow: SavedWorkflow): boolean {
  return builtInWorkflowSeedIds().has(workflow.id);
}

function builtInWorkflowSeedIds(): Set<string> {
  return new Set([
    ...workflowKinds.map((workflowKind) => workflowSeedId(workflowKind.id, workflowKind.defaultWorkflowName)),
    ...exampleWorkflowSeeds.map((workflow) => workflowSeedId(workflow.kind, workflow.name)),
  ]);
}

function savedWorkflowGraphSnapshot(nodes: SavedWorkflowBlockNode[], edges: SavedWorkflowBlockEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map(comparableWorkflowNode).sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(comparableWorkflowEdge)
      .sort((a, b) =>
        `${a.source}|${a.sourceHandle ?? ""}|${a.target}|${a.targetHandle ?? ""}`.localeCompare(
          `${b.source}|${b.sourceHandle ?? ""}|${b.target}|${b.targetHandle ?? ""}`,
        ),
      ),
  });
}

function seedSavedWorkflowLibrary(): SavedWorkflowLibrary {
  const workflows = [
    ...workflowKinds.map((workflowKind) =>
      createSeedSavedWorkflow(
        workflowKind.defaultWorkflowName,
        workflowKind.id,
        workflowSeedId(workflowKind.id, workflowKind.defaultWorkflowName),
      ),
    ),
    ...exampleWorkflowSeeds.map((workflow) =>
      createSeedSavedWorkflow(
        workflow.name,
        workflow.kind,
        workflowSeedId(workflow.kind, workflow.name),
      ),
    ),
  ];
  return {
    format: savedWorkflowsJsonFormat,
    version: savedWorkflowsJsonVersion,
    activeWorkflowId: workflows[0].id,
    workflows,
  };
}

function normalizeSavedWorkflow(workflow: SavedWorkflow): SavedWorkflow {
  const name = legacySeedWorkflowNames.has(workflow.name) ? defaultSeedWorkflowName : workflow.name;
  const kind = workflowKindId((workflow as Partial<SavedWorkflow>).kind) ?? inferWorkflowKindFromName(name);
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
    kind,
    name,
    version: Math.max(version, ...versions.map((savedVersion) => savedVersion.version)),
    versions,
    updatedAt: legacySeedWorkflowNames.has(workflow.name) ? new Date().toISOString() : workflow.updatedAt,
  };
}

function ensureWorkflowKindCoverage(workflows: SavedWorkflow[]): SavedWorkflow[] {
  const presentKinds = new Set(workflows.map((workflow) => workflow.kind));
  const missingWorkflows = workflowKinds
    .filter((workflowKind) => !presentKinds.has(workflowKind.id))
    .map((workflowKind) =>
      createSeedSavedWorkflow(
        workflowKind.defaultWorkflowName,
        workflowKind.id,
        workflowSeedId(workflowKind.id, workflowKind.defaultWorkflowName),
      ),
    );
  return workflows.concat(missingWorkflows);
}

function createSavedWorkflow(
  name: string,
  nodes: WorkflowNodeModel[],
  edges: Edge[],
  kind: WorkflowKindId = "youtube-video",
  id = createWorkflowId(),
): SavedWorkflow {
  const createdAt = new Date().toISOString();
  const workflow: SavedWorkflow = {
    id,
    kind,
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

function createBlankSavedWorkflow(name = "Untitled Workflow", kind: WorkflowKindId = "youtube-video"): SavedWorkflow {
  return createSavedWorkflow(name, [], [], kind);
}

function importSharedWorkflowFile(
  library: SavedWorkflowLibrary,
  file: SavedWorkflowFile,
): { library: SavedWorkflowLibrary; workflowId: string; message: string } {
  const restored = restoreWorkflowFile(file);
  const importedSnapshot = savedWorkflowGraphSnapshot(
    restored.nodes.map(serializeWorkflowNode),
    restored.edges.map(serializeWorkflowEdge),
  );
  const importedName = file.workflowName?.trim() || "Shared Workflow";
  const importedKind = file.workflowKind ?? "youtube-video";
  const existing = library.workflows.find(
    (workflow) =>
      workflow.kind === importedKind &&
      workflow.name === importedName &&
      savedWorkflowGraphSnapshot(workflow.nodes, workflow.edges) === importedSnapshot,
  );

  if (existing) {
    return {
      library: { ...library, activeWorkflowId: existing.id },
      workflowId: existing.id,
      message: `Opened shared workflow "${existing.name}"`,
    };
  }

  const versionNumber = Math.max(1, file.workflowVersion ?? 1);
  const importedAt = new Date().toISOString();
  const workflowId = createWorkflowId();
  const version: SavedWorkflowVersion = {
    id: createWorkflowVersionId(),
    version: versionNumber,
    name: importedName,
    createdAt: restored.lastUpdated || importedAt,
    nodes: restored.nodes.map(serializeWorkflowNode),
    edges: restored.edges.map(serializeWorkflowEdge),
  };
  const importedWorkflow: SavedWorkflow = {
    id: workflowId,
    kind: importedKind,
    name: importedName,
    createdAt: importedAt,
    updatedAt: restored.lastUpdated || importedAt,
    version: versionNumber,
    versions: [version],
    nodes: version.nodes.map((node) => ({
      id: node.id,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
    edges: version.edges.map((edge) => ({ ...edge })),
  };

  return {
    library: {
      ...library,
      activeWorkflowId: workflowId,
      workflows: [importedWorkflow, ...library.workflows],
    },
    workflowId,
    message: `Imported shared workflow "${importedName}"`,
  };
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
  return { nodes, edges: restoreValidWorkflowEdges(workflow.edges, nodes) };
}

function workflowStateFromSavedWorkflowBlock(block: SavedWorkflowBlock): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
  const nodes: WorkflowNodeModel[] = block.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  return { nodes, edges: restoreValidWorkflowEdges(block.edges, nodes) };
}

function createComponentDraftWorkflow(block: SavedWorkflowBlock): SavedWorkflow {
  const state = workflowStateFromSavedWorkflowBlock(block);
  return {
    ...createSavedWorkflow(`${block.name} Component Draft`, state.nodes, state.edges, workflowKindForSavedWorkflowBlock(block)),
    componentDraft: {
      blockId: block.id,
      blockName: block.name,
    },
  };
}

function savedWorkflowHasValidGraph(workflow: SavedWorkflow): boolean {
  const nodes = workflow.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  if (!hasUniqueWorkflowNodeIds(nodes)) {
    return false;
  }
  try {
    restoreValidWorkflowEdges(workflow.edges, nodes);
    return true;
  } catch {
    return false;
  }
}

function savedWorkflowVersionHasValidGraph(version: SavedWorkflowVersion): boolean {
  const nodes = version.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  if (!hasUniqueWorkflowNodeIds(nodes)) {
    return false;
  }
  try {
    restoreValidWorkflowEdges(version.edges, nodes);
    return true;
  } catch {
    return false;
  }
}

function savedWorkflowBlockHasValidGraph(block: SavedWorkflowBlock): boolean {
  const nodes = block.nodes.map((node) => ({
    id: node.id,
    type: "workflow" as const,
    position: { ...node.position },
    data: cloneWorkflowNodeData(node.data),
    selected: false,
  }));
  if (!hasUniqueWorkflowNodeIds(nodes)) {
    return false;
  }
  try {
    restoreValidWorkflowEdges(block.edges, nodes);
    return true;
  } catch {
    return false;
  }
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
  request: YoutubeRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest,
  inputSummary: string,
): SavedWorkflowRun {
  const createdAt = new Date().toISOString();
  return {
    id: createWorkflowRunId(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowKind: workflow.kind,
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
    return parsed.filter(isSavedWorkflowBlock).map(normalizeSavedWorkflowBlock).filter(savedWorkflowBlockHasValidGraph);
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

function defaultDataSourceSchemaForKind(kind: DataSourceSchema["type"]): DataSourceSchema {
  switch (kind) {
    case "port":
      return portTypeToDataSourceSchema("data_value");
    case "union":
      return { type: "union", variants: [{ type: "string" }, { type: "number" }] };
    case "array":
      return { type: "array", items: { type: "any" } };
    case "object":
      return { type: "object", properties: [], additionalProperties: true };
    case "binary":
      return { type: "binary", mediaType: "audio/mpeg", portType: "data_value" };
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "any":
      return { type: kind };
  }
}

function portTypeToDataSourceSchema(portType: DataSourceType): DataSourceSchema {
  switch (portType) {
    case "string_value":
      return { type: "string" };
    case "template_string":
      return { type: "string", semantic: "template_string" };
    case "youtube_url":
      return { type: "string", semantic: "youtube_url" };
    case "youtube_collection_url":
      return { type: "string", semantic: "youtube_collection_url" };
    case "subtitle_file":
      return { type: "string", semantic: "subtitle_file" };
    case "audio_file":
      return { type: "binary", mediaType: "audio/*", portType, semantic: "audio_file" };
    case "audio_wav":
      return { type: "binary", mediaType: "audio/wav", portType, semantic: "audio_wav" };
    case "video_file":
      return { type: "binary", mediaType: "video/*", portType, semantic: "video_file" };
    case "media_file":
      return { type: "binary", mediaType: "application/octet-stream", portType, semantic: "media_file" };
    case "number_value":
      return { type: "number" };
    case "boolean_value":
      return { type: "boolean" };
    case "array_value":
      return { type: "array", items: { type: "any" } };
    case "object_value":
      return { type: "object", properties: [], additionalProperties: true };
    case "transcript":
      return { type: "object", properties: [], additionalProperties: true, semantic: "transcript" };
    case "song_catalog":
      return { type: "object", properties: [], additionalProperties: true, semantic: "song_catalog" };
    case "data_value":
      return { type: "any" };
    default:
      return { type: "port", portType };
  }
}

function workflowTypeForPortType(type: PortType): WorkflowTypeSpec {
  switch (type) {
    case "run_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "run_request" };
    case "run_config":
      return { type: "object", properties: [], additional_properties: true, semantic: "run_config" };
    case "template_string":
      return { type: "string", semantic: "template_string" };
    case "string_value":
      return { type: "string" };
    case "number_value":
      return { type: "number" };
    case "boolean_value":
      return { type: "boolean" };
    case "array_value":
      return { type: "array", items: { type: "any" } };
    case "youtube_url":
      return { type: "string", semantic: "youtube_url" };
    case "youtube_collection_url":
      return { type: "string", semantic: "youtube_collection_url" };
    case "video_file":
      return { type: "binary", media_type: "video/*", semantic: "video_file" };
    case "audio_file":
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "media_file":
      return { type: "binary", semantic: "media_file" };
    case "transcript":
      return { type: "object", properties: [], additional_properties: true, semantic: "transcript" };
    case "subtitle_file":
      return { type: "string", semantic: "subtitle_file" };
    case "collection_manifest":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_manifest" };
    case "collection_item":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_item" };
    case "collection_report":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_report" };
    case "collection_table":
      return { type: "object", properties: [], additional_properties: true, semantic: "collection_table" };
    case "video_metadata":
      return { type: "object", properties: [], additional_properties: true, semantic: "video_metadata" };
    case "video_frame":
      return { type: "binary", media_type: "image/*" };
    case "audio_frame":
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "audio_wav":
      return { type: "binary", media_type: "audio/wav", semantic: "audio_wav" };
    case "song_fingerprint":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_fingerprint" };
    case "song_match":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_match" };
    case "music_feature":
      return { type: "object", properties: [], additional_properties: true, semantic: "music_feature" };
    case "scene_result":
      return { type: "object", properties: [], additional_properties: true, semantic: "scene_result" };
    case "video_observation":
      return { type: "object", properties: [], additional_properties: true, semantic: "video_observation" };
    case "model_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_request" };
    case "model_prediction":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_prediction" };
    case "transcript_segment":
      return { type: "object", properties: [], additional_properties: true, semantic: "transcript_segment" };
    case "audio_event":
      return { type: "object", properties: [], additional_properties: true, semantic: "audio_event" };
    case "text_event":
      return { type: "object", properties: [], additional_properties: true, semantic: "text_event" };
    case "http_request":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_request" };
    case "http_response":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_response" };
    case "object_value":
      return { type: "object", properties: [], additional_properties: true };
    case "data_value":
      return { type: "any" };
    case "song_catalog":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_catalog" };
    case "data_record":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_record" };
    case "data_bucket":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_bucket" };
    case "json_report":
      return { type: "object", properties: [], additional_properties: true, semantic: "json_report" };
    case "dashboard_view":
      return { type: "object", properties: [], additional_properties: true, semantic: "dashboard_view" };
  }
}

function workflowSemanticKindToPortType(semantic: WorkflowSemanticKind | undefined): PortType | null {
  switch (semantic) {
    case "run_request":
      return "run_request";
    case "run_config":
      return "run_config";
    case "template_string":
      return "template_string";
    case "youtube_url":
      return "youtube_url";
    case "youtube_collection_url":
      return "youtube_collection_url";
    case "video_file":
      return "video_file";
    case "audio_file":
      return "audio_file";
    case "audio_wav":
      return "audio_wav";
    case "media_file":
      return "media_file";
    case "transcript":
      return "transcript";
    case "subtitle_file":
      return "subtitle_file";
    case "video_metadata":
      return "video_metadata";
    case "scene_result":
      return "scene_result";
    case "video_observation":
      return "video_observation";
    case "model_request":
      return "model_request";
    case "model_prediction":
      return "model_prediction";
    case "transcript_segment":
      return "transcript_segment";
    case "audio_event":
      return "audio_event";
    case "text_event":
      return "text_event";
    case "collection_manifest":
      return "collection_manifest";
    case "collection_item":
      return "collection_item";
    case "collection_report":
      return "collection_report";
    case "collection_table":
      return "collection_table";
    case "song_fingerprint":
      return "song_fingerprint";
    case "song_catalog":
      return "song_catalog";
    case "song_match":
      return "song_match";
    case "music_feature":
      return "music_feature";
    case "http_request":
      return "http_request";
    case "http_response":
      return "http_response";
    case "json_report":
      return "json_report";
    case "dashboard_view":
      return "dashboard_view";
    case "data_record":
      return "data_record";
    case "data_bucket":
      return "data_bucket";
    default:
      return null;
  }
}

function workflowTypeToPortType(spec: WorkflowTypeSpec, fallbackType: PortType = "data_value"): PortType {
  switch (spec.type) {
    case "string":
      return workflowSemanticKindToPortType(spec.semantic) ?? "string_value";
    case "number":
      return "number_value";
    case "boolean":
      return "boolean_value";
    case "array":
      return "array_value";
    case "object":
      return workflowSemanticKindToPortType(spec.semantic) ?? "object_value";
    case "binary":
      return (
        workflowSemanticKindToPortType(spec.semantic) ??
        (spec.media_type === "audio/wav"
          ? "audio_wav"
          : spec.media_type?.startsWith("audio/")
            ? "audio_file"
            : spec.media_type?.startsWith("video/")
              ? "video_file"
              : spec.media_type?.startsWith("image/")
                ? "video_frame"
                : fallbackType)
      );
    case "null":
    case "any":
    case "union":
      return fallbackType;
  }
}

function dataSourceSchemaToWorkflowType(schema: DataSourceSchema): WorkflowTypeSpec {
  switch (schema.type) {
    case "port":
      return workflowTypeForPortType(schema.portType);
    case "string":
      return { type: "string", ...(schema.semantic ? { semantic: schema.semantic } : {}) };
    case "binary": {
      const portType = workflowTypeForPortType(schema.portType);
      return {
        type: "binary",
        media_type: schema.mediaType || (portType.type === "binary" ? portType.media_type : undefined),
        ...(schema.semantic
          ? { semantic: schema.semantic }
          : portType.type === "binary" && portType.semantic
            ? { semantic: portType.semantic }
            : {}),
      };
    }
    case "array":
      return {
        type: "array",
        items: dataSourceSchemaToWorkflowType(schema.items),
        ...(typeof schema.minItems === "number" ? { min_items: schema.minItems } : {}),
        ...(typeof schema.maxItems === "number" ? { max_items: schema.maxItems } : {}),
      };
    case "object":
      return {
        type: "object",
        properties: schema.properties
          .filter((property) => property.name.trim())
          .map((property) => ({
            name: property.name.trim(),
            value: dataSourceSchemaToWorkflowType(property.schema),
            required: property.required,
          })),
        additional_properties: schema.additionalProperties ?? schema.properties.length === 0,
        ...(schema.semantic ? { semantic: schema.semantic } : {}),
      };
    case "union":
      return { type: "union", variants: schema.variants.map(dataSourceSchemaToWorkflowType) };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "any":
      return { type: "any" };
  }
}

function dataSourcePortType(schema: DataSourceSchema): DataSourceType {
  const fallbackType = schema.type === "port" || schema.type === "binary" ? schema.portType : "data_value";
  return workflowTypeToPortType(dataSourceSchemaToWorkflowType(schema), fallbackType);
}

function formatDataSourceSchema(schema: DataSourceSchema): string {
  switch (schema.type) {
    case "port":
      return formatWorkflowTypeSpec(workflowTypeForPortType(schema.portType));
    case "binary":
      return `Binary ${schema.mediaType || "application/octet-stream"}`;
    case "union":
      return schema.variants.map((variant) => formatDataSourceSchema(variant)).join(" | ");
    case "array":
      return `Array${formatArrayBounds(schema.minItems, schema.maxItems)} of ${formatDataSourceSchema(schema.items)}`;
    case "object": {
      const namedProperties = schema.properties.filter((property) => property.name.trim()).slice(0, 3);
      if (namedProperties.length === 0) {
        return schema.semantic ? formatWorkflowTypeSpec(dataSourceSchemaToWorkflowType(schema)) : "Object";
      }
      const suffix = schema.properties.length > namedProperties.length ? ", ..." : "";
      return `Object { ${namedProperties.map((property) => property.name.trim()).join(", ")}${suffix} }`;
    }
    case "any":
      return "Any JSON";
    case "string":
      return schema.semantic ? formatWorkflowTypeSpec(dataSourceSchemaToWorkflowType(schema)) : "String";
    case "number":
    case "boolean":
    case "null":
      return schema.type[0].toUpperCase() + schema.type.slice(1);
  }
}

function formatArrayBounds(minItems?: number, maxItems?: number): string {
  if (minItems === undefined && maxItems === undefined) {
    return "";
  }
  const min = minItems ?? 0;
  const max = maxItems ?? "*";
  return `[${min}..${max}]`;
}

function dataSourceSchemaToJsonSchema(schema: DataSourceSchema): unknown {
  switch (schema.type) {
    case "port":
      return { "x-portType": schema.portType };
    case "string":
      return {
        type: "string",
        ...(schema.semantic ? { "x-semantic": schema.semantic } : {}),
      };
    case "binary":
      return {
        type: "string",
        contentEncoding: "base64",
        contentMediaType: schema.mediaType || "application/octet-stream",
        "x-portType": schema.portType,
        ...(schema.semantic ? { "x-semantic": schema.semantic } : {}),
      };
    case "array":
      return {
        type: "array",
        items: dataSourceSchemaToJsonSchema(schema.items),
        ...(typeof schema.minItems === "number" ? { minItems: schema.minItems } : {}),
        ...(typeof schema.maxItems === "number" ? { maxItems: schema.maxItems } : {}),
      };
    case "object": {
      const properties = schema.properties.reduce<Record<string, unknown>>((current, property) => {
        const name = property.name.trim();
        if (name) {
          current[name] = dataSourceSchemaToJsonSchema(property.schema);
        }
        return current;
      }, {});
      return {
        type: "object",
        properties,
        required: schema.properties.filter((property) => property.required && property.name.trim()).map((property) => property.name.trim()),
        ...(schema.additionalProperties === false ? { additionalProperties: false } : {}),
        ...(schema.semantic ? { "x-semantic": schema.semantic } : {}),
      };
    }
    case "union":
      return { anyOf: schema.variants.map(dataSourceSchemaToJsonSchema) };
    case "any":
      return {};
    case "number":
    case "boolean":
    case "null":
      return { type: schema.type };
  }
}

function formatDataSourceSchemaJson(schema: DataSourceSchema): string {
  return JSON.stringify(dataSourceSchemaToJsonSchema(schema), null, 2);
}

function parseDataSourceSchemaJson(text: string): DataSourceSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
  const schema = dataSourceSchemaFromJsonSchema(parsed);
  if (!schema) {
    throw new Error("Unsupported schema");
  }
  return schema;
}

function dataSourceSchemaFromJsonSchema(value: unknown): DataSourceSchema | null {
  if (!isRecord(value)) {
    return null;
  }

  const portType = dataSourceSchemaPortTypeExtension(value);
  const semantic = dataSourceSchemaSemanticExtension(value);
  const type = typeof value.type === "string" ? value.type : undefined;
  if (Array.isArray(value.anyOf)) {
    const variants = value.anyOf.map((variant) => dataSourceSchemaFromJsonSchema(variant)).filter(Boolean) as DataSourceSchema[];
    return variants.length > 0 ? { type: "union", variants } : null;
  }
  if (portType && !type) {
    return { type: "port", portType };
  }
  if (Object.keys(value).length === 0) {
    return { type: "any" };
  }

  if (type === "array") {
    return {
      type: "array",
      items: dataSourceSchemaFromJsonSchema(value.items) ?? { type: "any" },
      ...(typeof value.minItems === "number" ? { minItems: value.minItems } : {}),
      ...(typeof value.maxItems === "number" ? { maxItems: value.maxItems } : {}),
    };
  }

  if (type === "object" || isRecord(value.properties)) {
    const required = new Set(
      Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : [],
    );
    const properties = isRecord(value.properties)
      ? Object.entries(value.properties).flatMap(([name, propertyValue]) => {
          const schema = dataSourceSchemaFromJsonSchema(propertyValue);
          if (!schema) {
            return [];
          }
          return [
            {
              id: createDataSourceSchemaPropertyId(),
              name,
              schema,
              required: required.has(name),
            },
          ];
        })
      : [];
    return {
      type: "object",
      properties,
      additionalProperties: value.additionalProperties !== false,
      ...(semantic ? { semantic } : {}),
    };
  }

  if (type === "binary" || (type === "string" && (value.contentEncoding === "base64" || typeof value.contentMediaType === "string"))) {
    return {
      type: "binary",
      mediaType: typeof value.contentMediaType === "string" && value.contentMediaType.trim() ? value.contentMediaType.trim() : "application/octet-stream",
      portType: portType ?? "data_value",
      ...(semantic ? { semantic } : {}),
    };
  }

  if (type === "string") {
    return { type: "string", ...(semantic ? { semantic } : {}) };
  }
  if (type === "number" || type === "boolean" || type === "null") {
    return { type };
  }
  if (type === "any") {
    return { type: "any" };
  }
  return null;
}

function dataSourceSchemaPortTypeExtension(value: Record<string, unknown>): DataSourceType | null {
  const portType = value["x-portType"] ?? value.xPortType ?? value.portType;
  return isDataSourceType(portType) ? portType : null;
}

function dataSourceSchemaSemanticExtension(value: Record<string, unknown>): WorkflowSemanticKind | null {
  const semantic = value["x-semantic"] ?? value.xSemantic ?? value.semantic;
  return isWorkflowSemanticKind(semantic) ? semantic : null;
}

function addDataSourceSchemaProperty(schema: Extract<DataSourceSchema, { type: "object" }>): DataSourceSchema {
  return {
    ...schema,
    properties: [
      ...schema.properties,
      {
        id: createDataSourceSchemaPropertyId(),
        name: "",
        schema: { type: "any" },
        required: true,
      },
    ],
  };
}

function updateDataSourceSchemaProperty(
  schema: Extract<DataSourceSchema, { type: "object" }>,
  propertyId: string,
  update: Partial<Omit<DataSourceSchemaProperty, "id">>,
): DataSourceSchema {
  return {
    ...schema,
    properties: schema.properties.map((property) =>
      property.id === propertyId ? { ...property, ...update } : property,
    ),
  };
}

function removeDataSourceSchemaProperty(
  schema: Extract<DataSourceSchema, { type: "object" }>,
  propertyId: string,
): DataSourceSchema {
  return {
    ...schema,
    properties: schema.properties.filter((property) => property.id !== propertyId),
  };
}

function createDataSourceSchemaPropertyId(): string {
  return `property-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  const blocks = candidates.map(cloneImportedSavedWorkflowBlock);
  const invalidBlock = blocks.find((block) => !savedWorkflowBlockHasValidGraph(block));
  if (invalidBlock) {
    throw new Error(`Component "${invalidBlock.name}" contains a workflow loop`);
  }
  return blocks;
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
    ...(block.kind ? { kind: block.kind } : {}),
    category: workflowComponentCategory(block.category ?? categoryForSavedWorkflowBlock(block)),
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
    ...(block.kind ? { kind: block.kind } : {}),
    category: workflowComponentCategory(block.category ?? categoryForSavedWorkflowBlock(block)),
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
    (value.kind === undefined || isWorkflowKindId(value.kind)) &&
    typeof value.name === "string" &&
    typeof value.createdAt === "string" &&
    (value.category === undefined || isWorkflowComponentCategory(value.category)) &&
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
  const workflowKindValid = value.workflowKind === undefined || isWorkflowKindId(value.workflowKind);
  const workflowVersionValid = value.workflowVersion === undefined || typeof value.workflowVersion === "number";
  return (
    typeof value.id === "string" &&
    typeof value.workflowId === "string" &&
    typeof value.workflowName === "string" &&
    workflowKindValid &&
    workflowVersionValid &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    isRunStatus(value.status) &&
    typeof value.inputSummary === "string" &&
    (isYoutubeRunRequest(value.request) ||
      isVideoRedCarsRunRequest(value.request) ||
      isYoutubeCollectionRunRequest(value.request) ||
      isSongAnalysisRunRequest(value.request) ||
      isSubtitleGenerationRunRequest(value.request)) &&
    backendRunIdValid &&
    reportPathValid &&
    messageValid
  );
}

function isDataSourceType(value: unknown): value is DataSourceType {
  return typeof value === "string" && dataSourceOutputTypes.includes(value as DataSourceType);
}

function isWorkflowSemanticKind(value: unknown): value is WorkflowSemanticKind {
  return typeof value === "string";
}

function isDataSourceSchema(value: unknown): value is DataSourceSchema {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "port":
      return isDataSourceType(value.portType);
    case "binary":
      return (
        typeof value.mediaType === "string" &&
        isDataSourceType(value.portType) &&
        (value.semantic === undefined || isWorkflowSemanticKind(value.semantic))
      );
    case "array":
      return (
        isDataSourceSchema(value.items) &&
        (value.minItems === undefined || typeof value.minItems === "number") &&
        (value.maxItems === undefined || typeof value.maxItems === "number")
      );
    case "object":
      return (
        Array.isArray(value.properties) &&
        (value.additionalProperties === undefined || typeof value.additionalProperties === "boolean") &&
        (value.semantic === undefined || isWorkflowSemanticKind(value.semantic)) &&
        value.properties.every(
          (property) =>
            isRecord(property) &&
            typeof property.id === "string" &&
            typeof property.name === "string" &&
            isDataSourceSchema(property.schema) &&
            typeof property.required === "boolean",
        )
      );
    case "union":
      return Array.isArray(value.variants) && value.variants.length > 0 && value.variants.every(isDataSourceSchema);
    case "string":
      return value.semantic === undefined || isWorkflowSemanticKind(value.semantic);
    case "number":
    case "boolean":
    case "null":
    case "any":
      return true;
    default:
      return false;
  }
}

function normalizeDataSourceSchema(value: unknown, fallback: DataSourceSchema): DataSourceSchema {
  if (isDataSourceType(value)) {
    return portTypeToDataSourceSchema(value);
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return dataSourceSchemaFromJsonSchema(value) ?? fallback;
  }
  switch (value.type) {
    case "port":
      return isDataSourceType(value.portType) ? { type: "port", portType: value.portType } : fallback;
    case "binary":
      return {
        type: "binary",
        mediaType: typeof value.mediaType === "string" && value.mediaType.trim() ? value.mediaType.trim() : "application/octet-stream",
        portType: isDataSourceType(value.portType) ? value.portType : "data_value",
        ...(isWorkflowSemanticKind(value.semantic) ? { semantic: value.semantic } : {}),
      };
    case "union":
      return {
        type: "union",
        variants: Array.isArray(value.variants) && value.variants.length > 0
          ? value.variants.map((variant) => normalizeDataSourceSchema(variant, { type: "any" }))
          : [{ type: "any" }],
      };
    case "array":
      return {
        type: "array",
        items: normalizeDataSourceSchema(value.items, { type: "any" }),
        ...(typeof value.minItems === "number" ? { minItems: value.minItems } : {}),
        ...(typeof value.maxItems === "number" ? { maxItems: value.maxItems } : {}),
      };
    case "object":
      if (isRecord(value.properties)) {
        return dataSourceSchemaFromJsonSchema(value) ?? fallback;
      }
      return {
        type: "object",
        properties: Array.isArray(value.properties)
          ? value.properties.flatMap((property) => {
              if (!isRecord(property)) {
                return [];
              }
              return [
                {
                  id: typeof property.id === "string" && property.id ? property.id : createDataSourceSchemaPropertyId(),
                  name: typeof property.name === "string" ? property.name : "",
                  schema: normalizeDataSourceSchema(property.schema, { type: "any" }),
                  required: typeof property.required === "boolean" ? property.required : true,
                },
              ];
            })
          : [],
        additionalProperties: typeof value.additionalProperties === "boolean" ? value.additionalProperties : true,
        ...(isWorkflowSemanticKind(value.semantic) ? { semantic: value.semantic } : {}),
      };
    case "string": {
      if (value.contentEncoding === "base64" || typeof value.contentMediaType === "string") {
        return dataSourceSchemaFromJsonSchema(value) ?? fallback;
      }
      return { type: "string", ...(isWorkflowSemanticKind(value.semantic) ? { semantic: value.semantic } : {}) };
    }
    case "number":
    case "boolean":
    case "null":
    case "any":
      return { type: value.type };
    default:
      return fallback;
  }
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
    (value.workflowKind === undefined || isWorkflowKindId(value.workflowKind)) &&
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
  const groupOpenValid = value.groupOpen === undefined || typeof value.groupOpen === "boolean";
  const minimizedValid = value.minimized === undefined || typeof value.minimized === "boolean";
  const categoryValid = value.category === undefined || isWorkflowComponentCategory(value.category);
  const tagsValid = value.tags === undefined || isWorkflowTags(value.tags);
  const sizeValid = value.size === undefined || isWorkflowNodeSize(value.size);
  const dataSourceNodeValid = value.dataSourceNode === undefined || typeof value.dataSourceNode === "boolean";
  const dataSourceIdValid = value.dataSourceId === undefined || typeof value.dataSourceId === "string";
  const dataSourceTypeValid = value.dataSourceType === undefined || isDataSourceType(value.dataSourceType);
  const adapterNodeValid = value.adapterNode === undefined || typeof value.adapterNode === "boolean";
  const adapterInputSchemaValid = value.adapterInputSchema === undefined || isDataSourceSchema(value.adapterInputSchema);
  const adapterOutputSchemaValid = value.adapterOutputSchema === undefined || isDataSourceSchema(value.adapterOutputSchema);
  return (
    typeof value.title === "string" &&
    typeof value.packageName === "string" &&
    typeof value.description === "string" &&
    categoryValid &&
    isFlowTone(value.tone) &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isFlowPort) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isFlowPort) &&
    tagsValid &&
    sizeValid &&
    kindValid &&
    groupValid &&
    groupOpenValid &&
    minimizedValid &&
    dataSourceNodeValid &&
    dataSourceIdValid &&
    dataSourceTypeValid &&
    adapterNodeValid &&
    adapterInputSchemaValid &&
    adapterOutputSchemaValid
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
  const streamValid = value.stream === undefined || typeof value.stream === "boolean";
  return (
    typeof value.wrapperPortId === "string" &&
    typeof value.nodeId === "string" &&
    handleValid &&
    typeof value.type === "string" &&
    isPortType(value.type) &&
    streamValid
  );
}

function isFlowPort(value: unknown): value is FlowPort {
  const streamValid = isRecord(value) && (value.stream === undefined || typeof value.stream === "boolean");
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.type === "string" &&
    isPortType(value.type) &&
    (value.kind === undefined || typeof value.kind === "string") &&
    (value.valueType === undefined || isWorkflowTypeSpec(value.valueType)) &&
    (value.optional === undefined || typeof value.optional === "boolean") &&
    (value.exposableInput === undefined || typeof value.exposableInput === "boolean") &&
    (value.inputSurface === undefined || typeof value.inputSurface === "string") &&
    (value.suggestedAdapters === undefined ||
      (Array.isArray(value.suggestedAdapters) && value.suggestedAdapters.every((adapter) => typeof adapter === "string"))) &&
    (value.runtimeValidation === undefined || typeof value.runtimeValidation === "string") &&
    streamValid
  );
}

function isWorkflowComponentCategory(value: unknown): value is WorkflowComponentCategory {
  return (
    value === "Application" ||
    value === "Input" ||
    value === "API" ||
    value === "Pipeline" ||
    value === "Ingest" ||
    value === "Detection" ||
    value === "Models" ||
    value === "Audio" ||
    value === "Text" ||
    value === "Data" ||
    value === "Report" ||
    value === "Dashboard" ||
    value === "Output" ||
    value === "Generator" ||
    value === "Control Flow" ||
    value === "Reusable"
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

function isYoutubeCollectionRunRequest(value: unknown): value is YoutubeCollectionRunRequest {
  if (!isRecord(value) || !isRecord(value.metadata_filter) || !isRecord(value.local_file_filter) || !isRecord(value.analysis)) {
    return false;
  }
  const sourceValid = value.source === undefined || value.source === null || isYoutubeCollectionSource(value.source);
  return (
    sourceValid &&
    (value.manifest === undefined || value.manifest === null || isRecord(value.manifest)) &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    (value.max_items === undefined || value.max_items === null || typeof value.max_items === "number") &&
    typeof value.analysis.scene_threshold === "number" &&
    typeof value.analysis.min_scene_len === "number" &&
    typeof value.analysis.visual_sample_every === "number" &&
    isRecord(value.analysis.transcription) &&
    typeof value.analysis.transcription.enabled === "boolean" &&
    isRecord(value.analysis.models)
  );
}

function isVideoRedCarsRunRequest(value: unknown): value is VideoRedCarsRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.vehicle_detector)) {
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
    typeof value.vehicle_detector.command === "string" &&
    Array.isArray(value.vehicle_detector.args)
  );
}

function isSongAnalysisRunRequest(value: unknown): value is SongAnalysisRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.catalog) || !isRecord(value.identification) || !isRecord(value.transcription) || !isRecord(value.music)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    (value.catalog.db_path === undefined || value.catalog.db_path === null || typeof value.catalog.db_path === "string") &&
    typeof value.identification.enabled === "boolean" &&
    typeof value.identification.min_score === "number" &&
    typeof value.identification.ambiguous_margin === "number" &&
    typeof value.identification.max_candidates === "number" &&
    typeof value.transcription.enabled === "boolean" &&
    typeof value.music.enabled === "boolean" &&
    typeof value.music.window_seconds === "number" &&
    typeof value.music.hop_seconds === "number" &&
    typeof value.music.min_bpm === "number" &&
    typeof value.music.max_bpm === "number"
  );
}

function isSubtitleGenerationRunRequest(value: unknown): value is SubtitleGenerationRunRequest {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.transcription)) {
    return false;
  }
  const sourceValid =
    (value.source.kind === "youtube_url" && typeof value.source.url === "string") ||
    (value.source.kind === "local_file" && typeof value.source.path === "string");
  return (
    sourceValid &&
    (value.work_dir === undefined || value.work_dir === null || typeof value.work_dir === "string") &&
    typeof value.transcription.enabled === "boolean" &&
    typeof value.overwrite === "boolean"
  );
}

function isYoutubeCollectionSource(value: unknown): value is YoutubeCollectionRunRequest["source"] {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    (value.kind === "playlist_url" || value.kind === "channel_url" || value.kind === "youtube_url")
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

function workflowSeedId(kind: WorkflowKindId, name: string): string {
  return `workflow-seed-${safeFlowId(kind)}-${safeFlowId(name.trim().toLowerCase().replace(/\s+/g, "-"))}`;
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

const workflowGroupPreviewNodeWidth = 148;
const workflowGroupPreviewNodeHeight = 62;
const workflowGroupPreviewPadding = 22;

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

function WorkflowContextMenu({
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

function workflowNode(id: string, x: number, y: number, data: WorkflowNodeData): WorkflowNodeModel {
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      ...data,
      category: workflowComponentCategory(data.category ?? categoryForWorkflowNodeData(data)),
      tags: normalizeWorkflowTags(data.tags ?? tagsForWorkflowNodeData(data)),
    },
  };
}

function workflowCatalogNodeTemplates(
  catalog: RustWorkflowCatalog | null,
  fallbackTemplates: WorkflowNodeModel[],
): WorkflowNodeModel[] {
  if (!catalog) {
    return fallbackTemplates;
  }
  const catalogNodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  return fallbackTemplates.map((template) => {
    const spec = catalogNodes.get(template.id);
    if (!spec || spec.ui_owned) {
      return template;
    }
    return {
      ...template,
      data: {
        ...template.data,
        title: spec.title || template.data.title,
        packageName: spec.package_name || template.data.packageName,
        inputs: spec.inputs.map(rustPortSpecToFlowPort).filter(Boolean) as FlowPort[],
        outputs: spec.outputs.map(rustPortSpecToFlowPort).filter(Boolean) as FlowPort[],
      },
    };
  });
}

function workflowNodeDataWithDataSource(data: WorkflowNodeData, dataSource: DataSourceEntry | null): WorkflowNodeData {
  const type = dataSource ? workflowTypeToPortType(dataSource.type, "data_value") : "data_value";
  const nextData: WorkflowNodeData = {
    ...data,
    title: dataSource ? `Data Source: ${dataSource.name}` : "Data Source",
    packageName: "Data Sources",
    description: dataSource
      ? `Emits ${dataSource.name} from data source ID ${dataSource.id}.`
      : "Selects a saved data source by ID and emits its payload through a typed output port.",
    category: "Data",
    tone: data.tone,
    outputs: [dataSourceOutputPort(dataSource, type)],
    dataSourceNode: true,
    dataSourceType: type,
  };
  if (dataSource) {
    nextData.dataSourceId = dataSource.id;
  } else {
    delete nextData.dataSourceId;
  }
  return nextData;
}

function workflowNodeDataWithAdapter(
  data: WorkflowNodeData,
  inputSchema: DataSourceSchema,
  outputSchema: DataSourceSchema,
): WorkflowNodeData {
  const normalizedInput = normalizeDataSourceSchema(inputSchema, { type: "any" });
  const normalizedOutput = normalizeDataSourceSchema(outputSchema, { type: "any" });
  return {
    ...data,
    category: "Data",
    inputs: [adapterPort("source", "source data", normalizedInput)],
    outputs: [adapterPort("result", "adapted data", normalizedOutput)],
    adapterNode: true,
    adapterInputSchema: normalizedInput,
    adapterOutputSchema: normalizedOutput,
  };
}

function workflowNodeDataWithAdapterSource(data: WorkflowNodeData, sourcePort: FlowPort): WorkflowNodeData {
  const inputSchema = workflowTypeSpecToDataSourceSchema(sourcePort.valueType, sourcePort.type);
  const outputSchema = workflowTypeSpecToDataSourceSchema(sourcePort.valueType, sourcePort.type);
  return {
    ...workflowNodeDataWithAdapter(data, inputSchema, outputSchema),
    inputs: [
      port("source", "source data", sourcePort.type, {
        valueType: structuredClone(sourcePort.valueType),
        optional: sourcePort.optional,
        stream: sourcePort.stream,
      }),
    ],
    outputs: [
      port("result", "adapted data", sourcePort.type, {
        valueType: structuredClone(sourcePort.valueType),
        stream: sourcePort.stream,
      }),
    ],
  };
}

function workflowNodeDataSourceSynced(current: WorkflowNodeData, expected: WorkflowNodeData): boolean {
  return (
    current.title === expected.title &&
    current.description === expected.description &&
    current.dataSourceId === expected.dataSourceId &&
    current.dataSourceType === expected.dataSourceType &&
    current.outputs.length === expected.outputs.length &&
    current.outputs.every((output, index) => {
      const expectedOutput = expected.outputs[index];
      return (
        expectedOutput &&
        output.id === expectedOutput.id &&
        output.label === expectedOutput.label &&
        output.type === expectedOutput.type &&
        workflowTypeSignature(output.valueType, portIsStream(output)) ===
          workflowTypeSignature(expectedOutput.valueType, portIsStream(expectedOutput))
      );
    })
  );
}

function dataSourceOutputPort(dataSource: DataSourceEntry | null, fallbackType: DataSourceType): FlowPort {
  const outputType = dataSource ? workflowTypeToPortType(dataSource.type, fallbackType) : fallbackType;
  return port("data", dataSource ? "source data" : "data", outputType, {
    valueType: dataSource ? structuredClone(dataSource.type) : workflowTypeForPortType(outputType),
  });
}

function adapterPort(id: string, label: string, schema: DataSourceSchema): FlowPort {
  const type = dataSourcePortType(schema);
  return port(id, label, type, { valueType: dataSourceSchemaToWorkflowType(schema) });
}

function workflowTypeSpecToDataSourceSchema(spec: WorkflowTypeSpec, fallbackPortType: DataSourceType = "data_value"): DataSourceSchema {
  switch (spec.type) {
    case "any":
    case "null":
    case "boolean":
    case "number":
      return { type: spec.type };
    case "string":
      return { type: "string", ...(spec.semantic ? { semantic: spec.semantic } : {}) };
    case "binary": {
      const portType = workflowTypeToPortType(spec, fallbackPortType);
      const fallbackType = workflowTypeForPortType(portType);
      const fallbackMediaType = fallbackType.type === "binary" ? fallbackType.media_type : undefined;
      return {
        type: "binary",
        mediaType: spec.media_type || fallbackMediaType || "application/octet-stream",
        portType,
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    }
    case "array":
      return {
        type: "array",
        items: workflowTypeSpecToDataSourceSchema(spec.items),
        ...(typeof spec.min_items === "number" ? { minItems: spec.min_items } : {}),
        ...(typeof spec.max_items === "number" ? { maxItems: spec.max_items } : {}),
      };
    case "object":
      return {
        type: "object",
        properties: (spec.properties ?? []).map((property) => ({
          id: createDataSourceSchemaPropertyId(),
          name: property.name,
          schema: workflowTypeSpecToDataSourceSchema(property.value),
          required: Boolean(property.required),
        })),
        additionalProperties: spec.additional_properties ?? false,
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    case "union":
      return {
        type: "union",
        variants: spec.variants.map((variant) => workflowTypeSpecToDataSourceSchema(variant, fallbackPortType)),
      };
  }
}

function defaultSuggestedAdaptersForType(spec: WorkflowTypeSpec): string[] {
  switch (spec.type) {
    case "object":
      return ["object-adapter", "data-adapter"];
    case "array":
    case "union":
    case "any":
      return ["data-adapter"];
    default:
      return [];
  }
}

function rustPortSpecToFlowPort(spec: RustPortSpec): FlowPort | null {
  const fallbackType = rustPortKindToPortType(spec.kind);
  if (!fallbackType) {
    return null;
  }
  const valueType = isWorkflowTypeSpec(spec.value_type) ? spec.value_type : workflowTypeForPortType(fallbackType);
  const type = workflowTypeToPortType(valueType, fallbackType);
  return port(spec.id, spec.label, type, {
    kind: spec.kind,
    optional: Boolean(spec.optional),
    stream: Boolean(spec.stream),
    valueType,
    exposableInput: Boolean(spec.exposable_input),
    inputSurface: spec.input_surface,
    suggestedAdapters:
      Array.isArray(spec.suggested_adapters) && spec.suggested_adapters.length > 0
        ? spec.suggested_adapters
        : defaultSuggestedAdaptersForType(valueType),
    runtimeValidation: spec.runtime_validation,
  });
}

function rustPortKindToPortType(kind: RustPortSpec["kind"]): PortType | null {
  const mapped: Partial<Record<RustPortSpec["kind"], PortType>> = {
    run_trigger: "run_request",
    run_config: "run_config",
    youtube_url: "youtube_url",
    youtube_collection_url: "youtube_collection_url",
    video_file: "video_file",
    audio_file: "audio_file",
    media_file: "media_file",
    transcript: "transcript",
    subtitle_file: "subtitle_file",
    scene_list: "scene_result",
    observation_list: "video_observation",
    audio_events: "audio_event",
    text_events: "text_event",
    data_buckets: "data_bucket",
    json_report: "json_report",
    collection_manifest: "collection_manifest",
    collection_items: "collection_item",
    song_fingerprint: "song_fingerprint",
    song_catalog: "song_catalog",
    song_matches: "song_match",
    music_features: "music_feature",
    template_string: "template_string",
    string: "string_value",
    number: "number_value",
    boolean: "boolean_value",
    array: "array_value",
    object: "object_value",
    http_request: "http_request",
    http_response: "http_response",
  };
  return mapped[kind] ?? null;
}

function port(id: string, label: string, type: PortType, options: FlowPortOptions = {}): FlowPort {
  const valueType = options.valueType ?? workflowTypeForPortType(type);
  return {
    id,
    label,
    type,
    ...(options.kind ? { kind: options.kind } : {}),
    valueType,
    ...(options.optional ? { optional: true } : {}),
    ...(options.stream ? { stream: true } : {}),
    ...(options.exposableInput ? { exposableInput: true } : {}),
    ...(options.inputSurface ? { inputSurface: options.inputSurface } : {}),
    suggestedAdapters: [...(options.suggestedAdapters ?? defaultSuggestedAdaptersForType(valueType))],
    ...(options.runtimeValidation ? { runtimeValidation: options.runtimeValidation } : {}),
  };
}

function workflowEdge(source: string, sourcePortId: string, target: string, targetPortId: string): Edge {
  const sourceNode = initialWorkflowNodes.find((node) => node.id === source);
  const targetNode = initialWorkflowNodes.find((node) => node.id === target);
  const sourcePort = sourceNode?.data.outputs.find((candidate) => candidate.id === sourcePortId);
  const targetPort = targetNode?.data.inputs.find((candidate) => candidate.id === targetPortId);
  const portValue = sourcePort ?? targetPort ?? port("fallback", "fallback", "run_config");

  return workflowEdgeFromConnection(
    {
      source,
      target,
      sourceHandle: sourcePort ? handleId("out", sourcePort) : null,
      targetHandle: targetPort ? handleId("in", targetPort) : null,
    },
    portValue,
  );
}

function workflowEdgeFromConnection(connection: Connection | Edge, portValue: FlowPort | PortType): Edge {
  const type = typeof portValue === "string" ? portValue : portValue.type;
  const stream = typeof portValue === "string" ? false : portIsStream(portValue);
  return {
    id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
    source: connection.source ?? "",
    target: connection.target ?? "",
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    label: typeof portValue === "string" ? formatPortType(type, stream) : formatFlowPortType(portValue),
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
  return Boolean(sourcePort && targetPort && portsCompatible(sourcePort, targetPort));
}

function connectionCreatesLoop(
  edges: Edge[],
  connection: Pick<Connection, "source" | "target">,
  ignoredEdgeId?: string | null,
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }
  return workflowGraphWouldCreateCycle(
    edges,
    { source: connection.source, target: connection.target },
    { ignoreEdgeId: ignoredEdgeId },
  );
}

function portsCompatible(sourcePort: FlowPort, targetPort: FlowPort): boolean {
  const streamConnection = portIsStream(sourcePort) || portIsStream(targetPort);
  if (streamConnection) {
    return portIsStream(sourcePort) && portIsStream(targetPort) && workflowTypesAssignable(sourcePort.valueType, targetPort.valueType);
  }
  return workflowTypesAssignable(sourcePort.valueType, targetPort.valueType);
}

function connectionMismatchMessage(sourcePort: FlowPort | null, targetPort: FlowPort | null): string {
  if (!sourcePort || !targetPort) {
    return "Connection is invalid for the selected handles.";
  }
  const suggestions = [...(targetPort.suggestedAdapters ?? []), ...(sourcePort.suggestedAdapters ?? [])];
  return `${sourcePort.label} emits ${formatFlowPortType(sourcePort)}, but ${targetPort.label} expects ${formatFlowPortType(targetPort)}.${suggestions.length > 0 ? ` Try ${[...new Set(suggestions)].join(", ")}.` : ""}`;
}

function connectionLoopMessage(nodes: WorkflowNodeModel[], connection: Pick<Connection, "source" | "target">): string {
  const sourceTitle = nodes.find((node) => node.id === connection.source)?.data.title ?? "This component";
  const targetTitle = nodes.find((node) => node.id === connection.target)?.data.title ?? "that component";
  return `Connecting ${sourceTitle} to ${targetTitle} would create a workflow loop. Keep workflows acyclic and use For Each Item or While Loop for intentional iteration.`;
}

function portIsStream(portValue: FlowPort): boolean {
  return portValue.stream === true;
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
  return (
    ports?.find(
      (portCandidate) =>
        portCandidate.id === parsed.portId &&
        (handleSignature(portCandidate) === parsed.signature ||
          (parsed.legacyType !== undefined && portCandidate.type === parsed.legacyType)),
    ) ?? null
  );
}

function handleId(direction: PortDirection, portValue: FlowPort): string {
  return `${direction}|${portValue.id}|${handleSignature(portValue)}`;
}

function parseHandleId(handle: string): { direction: PortDirection; portId: string; signature: string; legacyType?: PortType } | null {
  const [direction, portId, ...signatureParts] = handle.split("|");
  const signature = signatureParts.join("|");
  if ((direction !== "in" && direction !== "out") || !portId || !signature) {
    return null;
  }
  return {
    direction,
    portId,
    signature,
    ...(isPortType(signature) ? { legacyType: signature } : {}),
  };
}

function isPortType(value: string | undefined): value is PortType {
  return portTypes.includes((value ?? "") as PortType);
}

function formatPortType(type: PortType, stream = false): string {
  return `${type.replace(/_/g, " ")}${stream ? " stream" : ""}`;
}

function formatFlowPortType(portValue: FlowPort): string {
  return formatWorkflowTypeSpec(portValue.valueType, portIsStream(portValue));
}

function handleSignature(portValue: FlowPort): string {
  return workflowTypeSignature(portValue.valueType, portIsStream(portValue));
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
      if (output.exposableInput) {
        addInput(node, output, "provider");
      }
    }
  }

  const sourceModes = inputs.reduce<SourceMode[]>((modes, input) => {
    const mode = sourceModeForWorkflowInput(input.port);
    if (mode && !modes.includes(mode)) {
      modes.push(mode);
    }
    return modes;
  }, []);

  const configInputs = inputs.filter((input) => workflowInputSurface(input.port) === "config");

  return {
    inputs,
    sourceModes,
    configInputs,
    openInputs: inputs.filter((input) => input.source === "open"),
    genericInputs: inputs.filter(
      (input) => input.source === "open" && workflowInputSurface(input.port) === "generic",
    ),
  };
}

function workflowRunInputForSurface(inputModel: WorkflowRunInputModel, surface: WorkflowInputSurface): WorkflowRunInput | null {
  return (
    inputModel.inputs.find((input) => input.source === "open" && workflowInputSurface(input.port) === surface) ??
    inputModel.inputs.find((input) => workflowInputSurface(input.port) === surface) ??
    null
  );
}

function workflowInputFieldLabel(label: string, input: WorkflowRunInput | null): string {
  if (!input) {
    return label;
  }
  return `${label} {${input.nodeTitle}}${input.port.optional ? " (optional)" : ""}`;
}

function workflowFocusTargetKey(target: WorkflowFocusTarget): string {
  return `${target.workflowId}:${target.nodeId}:${target.direction}:${target.portId}:${target.portType}`;
}

function isWorkflowInputProviderNode(node: SavedWorkflowBlockNode, incomingNodes: Set<string>): boolean {
  return !incomingNodes.has(node.id) && node.data.outputs.some((output) => output.exposableInput);
}

function sourceModeForWorkflowInput(portValue: FlowPort): SourceMode | null {
  switch (workflowInputSurface(portValue)) {
    case "source_url":
      return "url";
    case "collection_url":
      return "collection";
    case "file":
      return "file";
    default:
      return null;
  }
}

function workflowInputSurface(portValue: FlowPort): WorkflowInputSurface {
  if (portValue.inputSurface) {
    return portValue.inputSurface;
  }
  switch (portValue.valueType.type) {
    case "string":
      if (portValue.valueType.semantic === "youtube_url") {
        return "source_url";
      }
      if (portValue.valueType.semantic === "youtube_collection_url") {
        return "collection_url";
      }
      return "generic";
    case "binary":
      if (portValue.valueType.semantic === "video_file" || portValue.valueType.semantic === "media_file") {
        return "file";
      }
      return "generic";
    case "object":
      return portValue.valueType.semantic === "run_config" || portValue.kind === "run_config" || portValue.type === "run_config"
        ? "config"
        : "generic";
    default:
      return "generic";
  }
}

function effectiveSourceMode(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SourceMode {
  const sourceModes = inputModel?.sourceModes.length ? inputModel.sourceModes : (["url", "file"] as SourceMode[]);
  return sourceModes.includes(form.sourceMode) ? form.sourceMode : sourceModes[0] ?? form.sourceMode;
}

function WorkflowRunControls({
  form,
  inputModel,
  transcriptionCatalog,
  selectedWorkflowKind,
  onChange,
  onFocusWorkflowInput,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
  activeRunId,
  activeRunRecord,
  onCancelRun,
  onRetryRun,
  onOpenReport,
}: {
  form: WorkflowRunForm;
  inputModel: WorkflowRunInputModel;
  transcriptionCatalog: TranscriptionCatalog | null;
  selectedWorkflowKind: WorkflowKindId;
  onChange: (form: WorkflowRunForm) => void;
  onFocusWorkflowInput: (input: WorkflowRunInput) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
  activeRunId: string | null;
  activeRunRecord: RunRecord | null;
  onCancelRun: () => void;
  onRetryRun: () => void;
  onOpenReport: () => void;
}) {
  const set = <K extends keyof WorkflowRunForm>(key: K, value: WorkflowRunForm[K]) =>
    onChange({ ...form, [key]: value });
  const setWorkflowInput = (key: string, value: string) =>
    onChange({ ...form, workflowInputs: { ...form.workflowInputs, [key]: value } });
  const sourceModes =
    selectedWorkflowKind === "song-analysis" || selectedWorkflowKind === "subtitle-generation"
      ? (["url", "file"] as SourceMode[])
      : form.sourceMode === "collection"
      ? (["collection"] as SourceMode[])
      : inputModel.sourceModes.length > 0
        ? inputModel.sourceModes
        : (["url", "file"] as SourceMode[]);
  const selectedSourceMode =
    selectedWorkflowKind === "song-analysis" || selectedWorkflowKind === "subtitle-generation"
      ? form.sourceMode === "file"
        ? "file"
        : "url"
      : form.sourceMode === "collection" ? "collection" : effectiveSourceMode(form, inputModel);
  const showSourceSelector = sourceModes.length > 1;
  const urlInput = workflowRunInputForSurface(inputModel, "source_url");
  const collectionInput = workflowRunInputForSurface(inputModel, "collection_url");
  const fileInput = workflowRunInputForSurface(inputModel, "file");
  const runConfigInput = workflowRunInputForSurface(inputModel, "config");
  const activeStatus = activeRunRecord?.status;
  const canCancel = Boolean(activeRunId && (activeStatus === "pending" || activeStatus === "running" || isRunning));
  const canRetry = Boolean(activeRunRecord && ["failed", "canceled", "succeeded"].includes(activeRunRecord.status));
  const canOpenReport = activeRunRecord?.status === "succeeded";
  const isRedCars = selectedWorkflowKind === "video-red-cars";
  const usesNativeWhisperCpp = form.transcriptionEngine === "whisper_cpp";
  const transcriptionModels = transcriptionCatalog?.whisper_cpp.models ?? [{ model: form.transcriptionModel, cached: false }];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Input</h2>
      </div>
      <div className="space-y-4 p-4">
        {showSourceSelector && (
          <SegmentedControl<SourceMode>
            value={selectedSourceMode}
            options={sourceModes.map((mode): [SourceMode, string] => [
              mode,
              mode === "url" ? "URL" : mode === "file" ? "File" : "Collection",
            ])}
            onChange={(value) => set("sourceMode", value)}
          />
        )}

        {selectedSourceMode === "collection" ? (
          <>
            <Field
              label="Playlist or channel URL"
              action={<RunInputFocusButton input={collectionInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.url}
                placeholder="https://www.youtube.com/playlist?list=..."
                onChange={(event) => onChange({ ...form, sourceMode: "collection", url: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max items">
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionMaxItems}
                  onChange={(event) => set("collectionMaxItems", event.target.value)}
                />
              </Field>
              <Field label="Already downloaded">
                <select
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.alreadyDownloaded}
                  onChange={(event) => set("alreadyDownloaded", event.target.value as WorkflowRunForm["alreadyDownloaded"])}
                >
                  <option value="reuse">Reuse</option>
                  <option value="skip">Skip</option>
                  <option value="include">Include</option>
                </select>
              </Field>
            </div>
            <Field label="Title contains">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.collectionTitleContains}
                placeholder="optional"
                onChange={(event) => set("collectionTitleContains", event.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Metadata duration min">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionDurationMin}
                  onChange={(event) => set("collectionDurationMin", event.target.value)}
                />
              </Field>
              <Field label="Metadata duration max">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionDurationMax}
                  onChange={(event) => set("collectionDurationMax", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Local duration min">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.localDurationMin}
                  onChange={(event) => set("localDurationMin", event.target.value)}
                />
              </Field>
              <Field label="Local duration max">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.localDurationMax}
                  onChange={(event) => set("localDurationMax", event.target.value)}
                />
              </Field>
            </div>
            <Field label="Local extensions">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.localExtensions}
                onChange={(event) => set("localExtensions", event.target.value)}
              />
            </Field>
          </>
        ) : selectedSourceMode === "url" ? (
          <Field
            label={workflowInputFieldLabel("YouTube URL", urlInput)}
            action={<RunInputFocusButton input={urlInput} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.url}
              placeholder="https://www.youtube.com/watch?v=..."
              onChange={(event) => onChange({ ...form, sourceMode: "url", url: event.target.value })}
            />
          </Field>
        ) : (
          <Field
            label={workflowInputFieldLabel("Input file", fileInput)}
            action={<RunInputFocusButton input={fileInput} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.input}
              onChange={(event) => onChange({ ...form, sourceMode: "file", input: event.target.value })}
            />
          </Field>
        )}

        {inputModel.configInputs.length > 0 && (
          <>
            <Field
              label={workflowInputFieldLabel("Work directory", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.workDir}
                onChange={(event) => set("workDir", event.target.value)}
              />
            </Field>

            {selectedWorkflowKind === "subtitle-generation" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={workflowInputFieldLabel("Transcription engine", runConfigInput)}>
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label="Whisper.cpp model">
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Transcriber command">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked
                    readOnly
                  />
                  <span>Write SRT next to video file</span>
                </label>
              </>
            ) : selectedWorkflowKind !== "song-analysis" ? (
              <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={workflowInputFieldLabel("Scene threshold", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.sceneThreshold}
                  onChange={(event) => set("sceneThreshold", Number(event.target.value))}
                />
              </Field>
              <Field
                label={workflowInputFieldLabel("Minimum scene frames", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
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
              <Field
                label={workflowInputFieldLabel("Max frames", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
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
              <Field
                label={workflowInputFieldLabel("Visual sample step", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
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

            {!isRedCars && (
              <>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked={form.skipTranscription}
                    onChange={(event) => set("skipTranscription", event.target.checked)}
                  />
                  <span>Skip transcription</span>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={workflowInputFieldLabel("Transcription engine", runConfigInput)}
                    action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                  >
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label={workflowInputFieldLabel("Whisper.cpp model", runConfigInput)}>
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label={workflowInputFieldLabel("Transcriber command", runConfigInput)}>
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </>
            )}

            <Field
              label={workflowInputFieldLabel(isRedCars ? "Vehicle detector command" : "Object command", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.objectCommand}
                placeholder={isRedCars ? "required" : "optional"}
                onChange={(event) => set("objectCommand", event.target.value)}
              />
            </Field>
            {!isRedCars && (
              <>
                <Field
                  label={workflowInputFieldLabel("OCR command", runConfigInput)}
                  action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                >
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.ocrCommand}
                    placeholder="optional"
                    onChange={(event) => set("ocrCommand", event.target.value)}
                  />
                </Field>
                <Field
                  label={workflowInputFieldLabel("Text command", runConfigInput)}
                  action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                >
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.textCommand}
                    placeholder="optional"
                    onChange={(event) => set("textCommand", event.target.value)}
                  />
                </Field>
              </>
            )}
              </>
            ) : (
              <>
                <Field label={workflowInputFieldLabel("Catalog DB", runConfigInput)}>
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.songCatalogPath}
                    placeholder="default app catalog"
                    onChange={(event) => set("songCatalogPath", event.target.value)}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Min score">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMinScore}
                      onChange={(event) => set("songMinScore", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Ambiguous margin">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songAmbiguousMargin}
                      onChange={(event) => set("songAmbiguousMargin", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Candidates">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMaxCandidates}
                      onChange={(event) => set("songMaxCandidates", Number(event.target.value))}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Window seconds">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songWindowSeconds}
                      onChange={(event) => set("songWindowSeconds", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Hop seconds">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songHopSeconds}
                      onChange={(event) => set("songHopSeconds", Number(event.target.value))}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum BPM">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMinBpm}
                      onChange={(event) => set("songMinBpm", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Maximum BPM">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMaxBpm}
                      onChange={(event) => set("songMaxBpm", Number(event.target.value))}
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
                  <span>Skip lyrics transcription</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={workflowInputFieldLabel("Lyrics engine", runConfigInput)}>
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label="Whisper.cpp model">
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Lyrics transcriber command">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
                <Field label="Music analyzer command">
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.musicCommand}
                    placeholder="optional"
                    onChange={(event) => set("musicCommand", event.target.value)}
                  />
                </Field>
              </>
            )}

            <Field
              label={workflowInputFieldLabel("Output JSON", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.output}
                onChange={(event) => set("output", event.target.value)}
              />
            </Field>
          </>
        )}

        {inputModel.genericInputs.map((input) => (
          <Field
            key={input.key}
            label={workflowInputFieldLabel(input.port.label, input)}
            action={<RunInputFocusButton input={input} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.workflowInputs[input.key] ?? ""}
              placeholder={
                input.port.valueType.type === "string" && input.port.valueType.semantic === "template_string"
                  ? "output/{{id}}.json"
                  : formatFlowPortType(input.port)
              }
              title={formatFlowPortType(input.port)}
              onChange={(event) => setWorkflowInput(input.key, event.target.value)}
            />
          </Field>
        ))}

        <div className="rounded-lg bg-zinc-950 p-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-100">
            {buildCommand(form, inputModel, selectedWorkflowKind).map(shellQuote).join(" ")}
          </pre>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {canCancel ? (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-700 focus:ring-offset-2"
              onClick={onCancelRun}
            >
              <CloseIcon className="h-4 w-4" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className={classNames(
                "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
                !canRetry && runDisabled ? "cursor-not-allowed bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800",
              )}
              onClick={canRetry ? onRetryRun : onRun}
              disabled={canRetry ? isRunning : runDisabled}
            >
              {isRunning ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : canRetry ? (
                <RefreshIcon className="h-4 w-4" />
              ) : (
                <PlayIcon className="h-4 w-4" />
              )}
              {isRunning ? "Creating run" : canRetry ? "Retry" : "Create run"}
            </button>
          )}
          {canOpenReport ? (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
              onClick={onOpenReport}
            >
              <OpenIcon className="h-4 w-4" />
              Open result
            </button>
          ) : null}
        </div>
        {validationMessage && <p className="text-sm text-amber-700">{validationMessage}</p>}
      </div>
    </section>
  );
}

function RunEventTimeline({
  events,
  stdout,
  stderr,
}: {
  events: RunEvent[];
  stdout?: string;
  stderr?: string;
}) {
  if (events.length === 0 && !stdout && !stderr) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Event Log</h2>
      </div>
      <div className="space-y-3 p-4">
        {events.length > 0 && (
          <div className="space-y-2">
            {events.map((event, index) => (
              <div key={`${event.run_id}-${event.timestamp}-${index}`} className="rounded-lg border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={classNames("rounded-md px-2 py-0.5 text-xs font-medium", runStatusPillClass(event.status))}>
                    {event.status}
                  </span>
                  {event.node ? (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                      {formatRunNodeLabel(event.node)}
                    </span>
                  ) : null}
                  {event.phase ? (
                    <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {formatRunPhaseLabel(event.phase)}
                    </span>
                  ) : null}
                  {typeof event.progress === "number" ? (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                      {formatRunProgress(event.progress)}
                    </span>
                  ) : null}
                  <span className="text-xs tabular-nums text-zinc-500">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-800">{event.message}</p>
                {event.stderr && <OutputBlock label="stderr" value={event.stderr} tone="rose" />}
                {event.stdout && <OutputBlock label="stdout" value={event.stdout} tone="zinc" />}
              </div>
            ))}
          </div>
        )}
        {stderr && <OutputBlock label="stderr" value={stderr} tone="rose" />}
        {stdout && <OutputBlock label="stdout" value={stdout} tone="zinc" />}
      </div>
    </section>
  );
}

function RunNodeStatusPanel({ events }: { events: RunEvent[] }) {
  const nodeEvents = events.filter((event) => Boolean(event.node));
  if (nodeEvents.length === 0) {
    return null;
  }

  const byNode = new Map<string, RunEvent>();
  for (const event of nodeEvents) {
    if (event.node) {
      byNode.set(event.node, event);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Nodes</h2>
      </div>
      <div className="space-y-3 p-4">
        {[...byNode.entries()].map(([node, event]) => (
          <div key={`${node}-${event.timestamp}`} className="rounded-lg border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">{formatRunNodeLabel(node)}</span>
              <span className={classNames("rounded-md px-2 py-0.5 text-xs font-medium", runStatusPillClass(event.status))}>
                {event.status}
              </span>
              {event.phase ? (
                <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                  {formatRunPhaseLabel(event.phase)}
                </span>
              ) : null}
              {typeof event.progress === "number" ? (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-700">
                  {formatRunProgress(event.progress)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-zinc-700">{event.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function runStatusPillClass(status: RunStatus): string {
  switch (status) {
    case "succeeded":
      return "bg-emerald-50 text-emerald-800";
    case "failed":
      return "bg-rose-50 text-rose-800";
    case "canceled":
      return "bg-amber-50 text-amber-800";
    case "running":
      return "bg-sky-50 text-sky-800";
    case "pending":
      return "bg-zinc-100 text-zinc-700";
  }
}

function formatRunNodeLabel(node: string): string {
  return node
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatRunPhaseLabel(phase: NonNullable<RunEvent["phase"]>): string {
  switch (phase) {
    case "preparing":
      return "Preparing";
    case "downloading_model":
      return "Downloading Model";
    case "loading_model":
      return "Loading Model";
    case "transcribing":
      return "Transcribing";
  }
}

function formatRunProgress(progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.round(clamped * 100)}%`;
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

function RunInputFocusButton({
  input,
  onFocus,
}: {
  input: WorkflowRunInput | null;
  onFocus: (input: WorkflowRunInput) => void;
}) {
  if (!input) {
    return null;
  }

  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-1"
      onClick={() => onFocus(input)}
      title={`Show ${input.port.label} in workflow`}
      aria-label={`Show ${input.port.label} in workflow`}
    >
      <WorkflowIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function TranscriptionEngineSelect({
  value,
  onChange,
}: {
  value: Exclude<TranscriptionEngine, "fast_whisper">;
  onChange: (value: Exclude<TranscriptionEngine, "fast_whisper">) => void;
}) {
  return (
    <select
      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
      value={value}
      onChange={(event) => onChange(event.target.value as Exclude<TranscriptionEngine, "fast_whisper">)}
    >
      <option value="whisper_cpp">Whisper.cpp (native)</option>
      <option value="whisper">Whisper CLI</option>
      <option value="faster_whisper">Faster Whisper</option>
      <option value="whisperx">WhisperX</option>
    </select>
  );
}

function TranscriptionModelSelect({
  value,
  models,
  onChange,
}: {
  value: WhisperCppModel;
  models: Array<{ model: WhisperCppModel; cached: boolean }>;
  onChange: (value: WhisperCppModel) => void;
}) {
  const options = models.length > 0 ? models : [{ model: value, cached: false }];
  return (
    <select
      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
      value={value}
      onChange={(event) => onChange(event.target.value as WhisperCppModel)}
    >
      {options.map((option) => (
        <option key={option.model} value={option.model}>
          {option.model}
          {option.cached ? " (cached)" : ""}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  action,
  children,
}: {
  label: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <span className="block min-w-0 break-words text-xs font-medium uppercase text-zinc-500">{label}</span>
        {action}
      </div>
      {children}
    </div>
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

function buildCommand(
  form: WorkflowRunForm,
  inputModel?: WorkflowRunInputModel,
  workflowKind: WorkflowKindId = "youtube-video",
): string[] {
  if (workflowKind === "youtube-collection" || form.sourceMode === "collection") {
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/youtube-collection/runs",
      "--url",
      form.url,
      "--work-dir",
      form.workDir,
      "--max-items",
      form.collectionMaxItems || "all",
    ];
    if (form.collectionTitleContains.trim()) {
      command.push("--title-contains", form.collectionTitleContains.trim());
    }
    if (form.collectionDurationMin.trim()) {
      command.push("--metadata-duration-min", form.collectionDurationMin.trim());
    }
    if (form.collectionDurationMax.trim()) {
      command.push("--metadata-duration-max", form.collectionDurationMax.trim());
    }
    if (form.localDurationMin.trim()) {
      command.push("--local-duration-min", form.localDurationMin.trim());
    }
    if (form.localDurationMax.trim()) {
      command.push("--local-duration-max", form.localDurationMax.trim());
    }
    command.push("--already-downloaded", form.alreadyDownloaded);
    return command;
  }
  if (workflowKind === "song-analysis") {
    const sourceMode = form.sourceMode === "file" ? "file" : "url";
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/song-analysis/runs",
      "--work-dir",
      form.workDir,
      "--catalog",
      form.songCatalogPath || "default",
      "--window-seconds",
      String(form.songWindowSeconds),
      "--hop-seconds",
      String(form.songHopSeconds),
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    if (form.skipTranscription) {
      command.push("--skip-transcription");
    }
    command.push("--transcription-engine", form.transcriptionEngine);
    if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
      command.push("--transcriber-command", form.transcriptionCommand.trim());
    }
    if (form.musicCommand.trim()) {
      command.push("--music-command", form.musicCommand.trim());
    }
    return command;
  }
  if (workflowKind === "subtitle-generation") {
    const sourceMode = effectiveSourceMode(form, inputModel);
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/subtitle-generation/runs",
      "--work-dir",
      form.workDir,
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    command.push("--transcription-engine", form.transcriptionEngine);
    if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
      command.push("--transcriber-command", form.transcriptionCommand.trim());
    }
    command.push("--write-to-video-folder");
    return command;
  }
  if (workflowKind === "video-red-cars") {
    const sourceMode = effectiveSourceMode(form, inputModel);
    const command = [
      "studio-api",
      "POST",
      "/api/workflows/video-red-cars/runs",
      "--work-dir",
      form.workDir,
      "--scene-threshold",
      String(form.sceneThreshold),
      "--min-scene-len",
      String(form.minSceneLen),
      "--visual-sample-every",
      String(form.visualSampleEvery),
      "--vehicle-detector",
      form.objectCommand || "required",
    ];
    command.push(sourceMode === "url" ? "--url" : "--input", sourceMode === "url" ? form.url : form.input);
    if (form.maxFrames.trim()) {
      command.push("--max-frames", form.maxFrames.trim());
    }
    return command;
  }
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
  command.push("--transcription-engine", form.transcriptionEngine);
  if (form.transcriptionEngine !== "whisper_cpp" && form.transcriptionCommand.trim()) {
    command.push("--transcriber-command", form.transcriptionCommand.trim());
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

function buildYoutubeRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): YoutubeRunRequest {
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
      ...buildTranscriptionRequest(form, !form.skipTranscription),
    },
    models: {
      object: commandConfig(form.objectCommand),
      ocr: commandConfig(form.ocrCommand),
      text: commandConfig(form.textCommand),
    },
  };
}

function buildVideoRedCarsRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): VideoRedCarsRunRequest {
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
    vehicle_detector: {
      command: form.objectCommand.trim(),
      args: [],
    },
  };
}

function buildYoutubeCollectionRunRequest(
  form: WorkflowRunForm,
  manifestPreview?: CollectionManifestPreviewState,
): YoutubeCollectionRunRequest {
  const previewManifest =
    manifestPreview?.status === "ready" && manifestPreview.manifest && !manifestPreview.stale
      ? filterYoutubeCollectionManifest(manifestPreview.manifest, manifestPreview.selectedItemIds)
      : null;
  return {
    source: { kind: youtubeCollectionSourceKind(form.url), url: form.url.trim() },
    manifest: previewManifest && previewManifest.items.length > 0 ? previewManifest : null,
    metadata_filter: {
      title_contains: form.collectionTitleContains.trim() || null,
      title_excludes: [],
      duration_seconds_min: optionalNumber(form.collectionDurationMin),
      duration_seconds_max: optionalNumber(form.collectionDurationMax),
      already_downloaded: form.alreadyDownloaded,
    },
    local_file_filter: {
      duration_seconds_min: optionalNumber(form.localDurationMin),
      duration_seconds_max: optionalNumber(form.localDurationMax),
      extension_allowlist: parseCsv(form.localExtensions),
      failed_probe_behavior: "failed",
    },
    analysis: {
      scene_threshold: form.sceneThreshold,
      min_scene_len: form.minSceneLen,
      max_frames: form.maxFrames.trim() ? Number(form.maxFrames.trim()) : null,
      visual_sample_every: form.visualSampleEvery,
      transcription: buildTranscriptionRequest(form, !form.skipTranscription),
      models: {
        object: commandConfig(form.objectCommand),
        ocr: commandConfig(form.ocrCommand),
        text: commandConfig(form.textCommand),
      },
    },
    delete_filtered_downloads: false,
    work_dir: form.workDir.trim() || null,
    max_items: optionalInteger(form.collectionMaxItems),
  };
}

function buildSongAnalysisRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SongAnalysisRunRequest {
  const sourceMode = form.sourceMode === "file" ? "file" : effectiveSourceMode(form, inputModel) === "file" ? "file" : "url";
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    catalog: {
      db_path: form.songCatalogPath.trim() || null,
    },
    identification: {
      enabled: true,
      min_score: form.songMinScore,
      ambiguous_margin: form.songAmbiguousMargin,
      max_candidates: form.songMaxCandidates,
    },
    transcription: buildTranscriptionRequest(form, !form.skipTranscription),
    music: {
      enabled: true,
      command: commandConfig(form.musicCommand),
      window_seconds: form.songWindowSeconds,
      hop_seconds: form.songHopSeconds,
      min_bpm: form.songMinBpm,
      max_bpm: form.songMaxBpm,
    },
  };
}

function buildSubtitleGenerationRunRequest(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): SubtitleGenerationRunRequest {
  const sourceMode = effectiveSourceMode(form, inputModel);
  return {
    source:
      sourceMode === "url"
        ? { kind: "youtube_url", url: form.url.trim() }
        : { kind: "local_file", path: form.input.trim() },
    work_dir: form.workDir.trim() || null,
    transcription: buildTranscriptionRequest(form, true),
    overwrite: true,
  };
}

function formFromYoutubeRunRequest(request: YoutubeRunRequest, catalog?: TranscriptionCatalog | null): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
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
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
    objectCommand: commandConfigToInput(request.models.object),
    ocrCommand: commandConfigToInput(request.models.ocr),
    textCommand: commandConfigToInput(request.models.text),
  };
}

function formFromVideoRedCarsRunRequest(request: VideoRedCarsRunRequest): WorkflowRunForm {
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/video-red-cars",
    output: request.work_dir
      ? `${request.work_dir.replace(/\/$/, "")}/video-red-cars.json`
      : "workflow-output/video-red-cars/video-red-cars.json",
    sceneThreshold: request.scene_threshold,
    minSceneLen: request.min_scene_len,
    maxFrames: request.max_frames ? String(request.max_frames) : "",
    visualSampleEvery: request.visual_sample_every,
    skipTranscription: true,
    objectCommand: request.vehicle_detector.command,
  };
}

function formFromYoutubeCollectionRunRequest(
  request: YoutubeCollectionRunRequest,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(
    request.analysis.transcription.engine,
    request.analysis.transcription.command,
  );
  return {
    ...initialForm,
    sourceMode: "collection",
    url: request.source?.url ?? "",
    workDir: request.work_dir ?? "workflow-output/youtube-collection",
    sceneThreshold: request.analysis.scene_threshold,
    minSceneLen: request.analysis.min_scene_len,
    maxFrames: request.analysis.max_frames ? String(request.analysis.max_frames) : "",
    visualSampleEvery: request.analysis.visual_sample_every,
    skipTranscription: !request.analysis.transcription.enabled,
    transcriptionEngine,
    transcriptionModel: request.analysis.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.analysis.transcription.command),
    objectCommand: commandConfigToInput(request.analysis.models.object),
    ocrCommand: commandConfigToInput(request.analysis.models.ocr),
    textCommand: commandConfigToInput(request.analysis.models.text),
    collectionMaxItems: request.max_items ? String(request.max_items) : "",
    collectionTitleContains: request.metadata_filter.title_contains ?? "",
    collectionDurationMin: request.metadata_filter.duration_seconds_min ? String(request.metadata_filter.duration_seconds_min) : "",
    collectionDurationMax: request.metadata_filter.duration_seconds_max ? String(request.metadata_filter.duration_seconds_max) : "",
    localDurationMin: request.local_file_filter.duration_seconds_min ? String(request.local_file_filter.duration_seconds_min) : "",
    localDurationMax: request.local_file_filter.duration_seconds_max ? String(request.local_file_filter.duration_seconds_max) : "",
    localExtensions: request.local_file_filter.extension_allowlist?.join(",") ?? initialForm.localExtensions,
    alreadyDownloaded: request.metadata_filter.already_downloaded ?? "reuse",
  };
}

function formFromSongAnalysisRunRequest(request: SongAnalysisRunRequest, catalog?: TranscriptionCatalog | null): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/song-analysis",
    output: request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/song-analysis.json` : "workflow-output/song-analysis/song-analysis.json",
    songCatalogPath: request.catalog.db_path ?? "",
    songMinScore: request.identification.min_score,
    songAmbiguousMargin: request.identification.ambiguous_margin,
    songMaxCandidates: request.identification.max_candidates,
    skipTranscription: !request.transcription.enabled,
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
    songWindowSeconds: request.music.window_seconds,
    songHopSeconds: request.music.hop_seconds,
    songMinBpm: request.music.min_bpm,
    songMaxBpm: request.music.max_bpm,
    musicCommand: commandConfigToInput(request.music.command),
  };
}

function formFromSubtitleGenerationRunRequest(
  request: SubtitleGenerationRunRequest,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  const transcriptionEngine = normalizedTranscriptionEngine(request.transcription.engine, request.transcription.command);
  return {
    ...initialForm,
    sourceMode: request.source.kind === "youtube_url" ? "url" : "file",
    url: request.source.kind === "youtube_url" ? request.source.url : "",
    input: request.source.kind === "local_file" ? request.source.path : initialForm.input,
    workDir: request.work_dir ?? "workflow-output/subtitle-generation",
    output: request.work_dir
      ? `${request.work_dir.replace(/\/$/, "")}/subtitle-generation.json`
      : "workflow-output/subtitle-generation/subtitle-generation.json",
    skipTranscription: false,
    transcriptionEngine,
    transcriptionModel: request.transcription.whisper_cpp?.model ?? defaultWhisperCppModel(catalog),
    transcriptionCommand: commandConfigToInput(request.transcription.command),
  };
}

function workflowInputSummaryFromForm(form: WorkflowRunForm, inputModel?: WorkflowRunInputModel): string {
  if (form.sourceMode === "collection") {
    return form.url.trim() || "YouTube collection";
  }
  if (effectiveSourceMode(form, inputModel) === "url") {
    return form.url.trim() || "YouTube URL";
  }
  return form.input.trim() || "Local file";
}

function commandConfig(command: string) {
  const trimmed = command.trim();
  return trimmed ? { command: trimmed, args: [] } : null;
}

function commandConfigToInput(config: { command: string; args: string[] } | null | undefined): string {
  if (!config) {
    return "";
  }
  return [config.command, ...config.args].filter(Boolean).join(" ");
}

function buildTranscriptionRequest(form: WorkflowRunForm, enabled: boolean) {
  const usesNativeWhisperCpp = form.transcriptionEngine === "whisper_cpp";
  return {
    enabled,
    engine: form.transcriptionEngine,
    command: usesNativeWhisperCpp ? null : commandConfig(form.transcriptionCommand),
    whisper_cpp: usesNativeWhisperCpp
      ? {
          model: form.transcriptionModel,
          language: null,
          translate: false,
          threads: null,
        }
      : undefined,
  };
}

function normalizedTranscriptionEngine(
  value: TranscriptionEngine | undefined,
  command?: { command: string; args: string[] } | null,
): Exclude<TranscriptionEngine, "fast_whisper"> {
  if (value === "whisperx") {
    return "whisperx";
  }
  if (value === "faster_whisper" || value === "fast_whisper") {
    return "faster_whisper";
  }
  if (value === "whisper_cpp" || value == null) {
    return "whisper_cpp";
  }
  return command ? "whisper" : "whisper_cpp";
}

function defaultTranscriptionEngine(catalog?: TranscriptionCatalog | null): Exclude<TranscriptionEngine, "fast_whisper"> {
  return normalizedTranscriptionEngine(catalog?.default_engine);
}

function defaultWhisperCppModel(catalog?: TranscriptionCatalog | null): WhisperCppModel {
  return catalog?.whisper_cpp.default_model ?? initialForm.transcriptionModel;
}

function createDefaultRunForm(
  workflowKind: WorkflowKindId,
  catalog?: TranscriptionCatalog | null,
): WorkflowRunForm {
  return {
    ...initialForm,
    sourceMode: workflowKind === "youtube-collection" ? "collection" : "url",
    workDir: defaultWorkDirForWorkflowKind(workflowKind),
    output: defaultOutputForWorkflowKind(workflowKind),
    transcriptionEngine: defaultTranscriptionEngine(catalog),
    transcriptionModel: defaultWhisperCppModel(catalog),
  };
}

function defaultTranscriptionCommand(engine: Exclude<TranscriptionEngine, "fast_whisper">): string {
  switch (engine) {
    case "whisper_cpp":
      return "";
    case "faster_whisper":
      return "whisper-ctranslate2";
    case "whisperx":
      return "whisperx";
    case "whisper":
      return "whisper";
  }
}

function youtubeCollectionSourceKind(url: string): "playlist_url" | "channel_url" | "youtube_url" {
  const normalized = url.toLowerCase();
  if (normalized.includes("/channel/") || normalized.includes("/@") || normalized.includes("/c/") || normalized.includes("/user/")) {
    return "channel_url";
  }
  if (normalized.includes("list=") || normalized.includes("/playlist")) {
    return "playlist_url";
  }
  return "youtube_url";
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInteger(value: string): number | null {
  const parsed = optionalNumber(value);
  return parsed == null ? null : Math.max(1, Math.floor(parsed));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseWorkflowInputValue(raw: string, spec: WorkflowTypeSpec): unknown {
  const trimmed = raw.trim();
  switch (spec.type) {
    case "string":
    case "binary":
      return raw;
    case "number": {
      const parsed = Number(trimmed);
      if (!trimmed || !Number.isFinite(parsed)) {
        throw new Error("Expected a number.");
      }
      return parsed;
    }
    case "boolean":
      if (trimmed === "true") {
        return true;
      }
      if (trimmed === "false") {
        return false;
      }
      throw new Error("Expected true or false.");
    case "null":
      if (trimmed === "null") {
        return null;
      }
      throw new Error("Expected null.");
    case "any":
      return trimmed ? JSON.parse(trimmed) : null;
    case "array":
    case "object":
    case "union":
      if (!trimmed) {
        throw new Error("Expected JSON.");
      }
      return JSON.parse(trimmed);
  }
}

function validateWorkflowInputValue(portValue: FlowPort, raw: string): string | null {
  if (!raw.trim()) {
    return portValue.optional ? null : `${portValue.label} is required.`;
  }
  let parsed: unknown;
  try {
    parsed = parseWorkflowInputValue(raw, portValue.valueType);
  } catch (error) {
    return `${portValue.label}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const issue = validateWorkflowValue(portValue.valueType, parsed);
  if (!issue) {
    return null;
  }
  return `${portValue.label}: expected ${issue.expected} at ${issue.path}, got ${issue.actual}.`;
}

function collectionManifestFormKey(form: WorkflowRunForm): string {
  return JSON.stringify({
    url: form.url.trim(),
    collectionMaxItems: form.collectionMaxItems.trim(),
    collectionTitleContains: form.collectionTitleContains.trim(),
    collectionDurationMin: form.collectionDurationMin.trim(),
    collectionDurationMax: form.collectionDurationMax.trim(),
    alreadyDownloaded: form.alreadyDownloaded,
  });
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

function reportPathForRequest(
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest,
): string {
  if (isYoutubeCollectionRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/collection-analysis.json` : "collection-analysis.json";
  }
  if (isSubtitleGenerationRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/subtitle-generation.json` : "subtitle-generation.json";
  }
  if (isSongAnalysisRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/song-analysis.json` : "song-analysis.json";
  }
  if (isVideoRedCarsRunRequest(request)) {
    return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/video-red-cars.json` : "video-red-cars.json";
  }
  return request.work_dir ? `${request.work_dir.replace(/\/$/, "")}/analysis.json` : initialForm.output;
}

function downloadReport(report: StudioReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "video-analysis-report.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function getRunValidation(
  form: WorkflowRunForm,
  inputModel?: WorkflowRunInputModel,
  workflowKind: WorkflowKindId = "youtube-video",
): string | null {
  const isRedCars = workflowKind === "video-red-cars";
  const isSong = workflowKind === "song-analysis";
  const isSubtitle = workflowKind === "subtitle-generation";
  if (workflowKind === "youtube-collection" && form.sourceMode === "collection") {
    const url = form.url.trim();
    if (!url) {
      return "Enter a YouTube playlist or channel URL.";
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
    for (const [label, value] of [
      ["Max items", form.collectionMaxItems],
      ["Metadata duration min", form.collectionDurationMin],
      ["Metadata duration max", form.collectionDurationMax],
      ["Local duration min", form.localDurationMin],
      ["Local duration max", form.localDurationMax],
    ] as const) {
      if (value.trim() && Number(value) < 0) {
        return `${label} must be non-negative.`;
      }
    }
    return null;
  }
  const sourceMode = isSong || isSubtitle ? (form.sourceMode === "file" ? "file" : "url") : effectiveSourceMode(form, inputModel);
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
  if (isSong) {
    if (!Number.isFinite(form.songMinScore) || form.songMinScore < 0 || form.songMinScore > 1) {
      return "Song match score must be between 0 and 1.";
    }
    if (!Number.isFinite(form.songAmbiguousMargin) || form.songAmbiguousMargin < 0) {
      return "Song ambiguous margin must be non-negative.";
    }
    if (!Number.isFinite(form.songMaxCandidates) || form.songMaxCandidates < 1) {
      return "Song candidates must be at least 1.";
    }
    if (!Number.isFinite(form.songWindowSeconds) || form.songWindowSeconds <= 0) {
      return "Window seconds must be positive.";
    }
    if (!Number.isFinite(form.songHopSeconds) || form.songHopSeconds <= 0) {
      return "Hop seconds must be positive.";
    }
    if (!Number.isFinite(form.songMinBpm) || !Number.isFinite(form.songMaxBpm) || form.songMinBpm >= form.songMaxBpm) {
      return "Minimum BPM must be lower than maximum BPM.";
    }
    return null;
  }
  if (isSubtitle) {
    return null;
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
  if (isRedCars && !form.objectCommand.trim()) {
    return "Vehicle detector command is required.";
  }
  if (inputModel) {
    for (const input of inputModel.genericInputs) {
      const message = validateWorkflowInputValue(input.port, form.workflowInputs[input.key] ?? "");
      if (message) {
        return message;
      }
    }
  }
  return null;
}

function currentWorkflowKind(id: WorkflowKindId) {
  return workflowKinds.find((workflowKind) => workflowKind.id === id) ?? workflowKinds[0];
}

function workflowKindName(id: WorkflowKindId): string {
  return currentWorkflowKind(id).name;
}

function workflowKindId(value: unknown): WorkflowKindId | null {
  return isWorkflowKindId(value) ? value : null;
}

function isWorkflowKindId(value: unknown): value is WorkflowKindId {
  return typeof value === "string" && workflowKinds.some((workflowKind) => workflowKind.id === value);
}

function inferWorkflowKindFromName(name: string): WorkflowKindId {
  const normalized = name.toLowerCase();
  if (normalized.includes("collection") || normalized.includes("playlist") || normalized.includes("channel")) {
    return "youtube-collection";
  }
  if (normalized.includes("song") || normalized.includes("music")) {
    return "song-analysis";
  }
  if (normalized.includes("red car")) {
    return "video-red-cars";
  }
  if (normalized.includes("subtitle") || normalized.includes("srt")) {
    return "subtitle-generation";
  }
  return "youtube-video";
}

function workflowKindFromRunRequest(
  request: YoutubeRunRequest | VideoRedCarsRunRequest | YoutubeCollectionRunRequest | SongAnalysisRunRequest | SubtitleGenerationRunRequest,
): WorkflowKindId {
  if (isYoutubeCollectionRunRequest(request)) {
    return "youtube-collection";
  }
  if (isVideoRedCarsRunRequest(request)) {
    return "video-red-cars";
  }
  if (isSubtitleGenerationRunRequest(request)) {
    return "subtitle-generation";
  }
  if (isSongAnalysisRunRequest(request)) {
    return "song-analysis";
  }
  return "youtube-video";
}

function defaultWorkDirForWorkflowKind(id: WorkflowKindId): string {
  switch (id) {
    case "video-red-cars":
      return "workflow-output/video-red-cars";
    case "youtube-collection":
      return "workflow-output/youtube-collection";
    case "song-analysis":
      return "workflow-output/song-analysis";
    case "subtitle-generation":
      return "workflow-output/subtitle-generation";
    case "youtube-video":
      return "workflow-output/youtube-video";
  }
}

function defaultOutputForWorkflowKind(id: WorkflowKindId): string {
  switch (id) {
    case "video-red-cars":
      return "workflow-output/video-red-cars/video-red-cars.json";
    case "youtube-collection":
      return "workflow-output/youtube-collection/collection-analysis.json";
    case "song-analysis":
      return "workflow-output/song-analysis/song-analysis.json";
    case "subtitle-generation":
      return "workflow-output/subtitle-generation/subtitle-generation.json";
    case "youtube-video":
      return "workflow-output/youtube-video/analysis.json";
  }
}

function appLocationFromPath(pathname: string): AppLocation {
  const segments = pathname.split("/").filter(Boolean);
  const [pageSegment, workflowSegment] = segments;
  if (pageSegment === "workflow" || pageSegment === "workflows") {
    return {
      page: "workflow",
      workflowId: decodePathSegment(workflowSegment),
    };
  }
  if (pageSegment === "run" || pageSegment === "runs") {
    return {
      page: "runs",
      workflowId: decodePathSegment(workflowSegment),
    };
  }
  if (pageSegment === "data-sources" || pageSegment === "datasources") {
    return { page: "data-sources", workflowId: null };
  }
  if (pageSegment === "components" || pageSegment === "component-library") {
    return { page: "components", workflowId: null };
  }
  if (pageSegment === "settings") {
    return { page: "settings", workflowId: null };
  }
  return { page: "analysis", workflowId: null };
}

function pathForAppPage(page: AppPage, workflowId?: string | null): string {
  switch (page) {
    case "workflow":
      return workflowId ? `/workflow/${encodeURIComponent(workflowId)}` : "/workflow";
    case "runs":
      return workflowId ? `/runs/${encodeURIComponent(workflowId)}` : "/runs";
    case "components":
      return "/components";
    case "data-sources":
      return "/data-sources";
    case "settings":
      return "/settings";
    case "analysis":
      return "/";
  }
}

function decodePathSegment(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
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

const workflowComponentCategoryOrder: WorkflowComponentCategory[] = [
  "Application",
  "Input",
  "API",
  "Pipeline",
  "Ingest",
  "Detection",
  "Models",
  "Audio",
  "Text",
  "Data",
  "Report",
  "Dashboard",
  "Output",
  "Generator",
  "Control Flow",
  "Reusable",
];

function groupWorkflowNodeTemplatesByCategory(
  nodes: WorkflowNodeModel[],
): Array<{ category: WorkflowComponentCategory; items: WorkflowNodeModel[] }> {
  return groupWorkflowComponentsByCategory(nodes, (node) => node.data.category ?? "Reusable");
}

function groupSavedWorkflowBlocksByCategory(
  blocks: SavedWorkflowBlock[],
): Array<{ category: WorkflowComponentCategory; items: SavedWorkflowBlock[] }> {
  return groupWorkflowComponentsByCategory(blocks, (block) => block.category ?? "Reusable");
}

function groupWorkflowComponentsByCategory<T>(
  items: T[],
  getCategory: (item: T) => WorkflowComponentCategory,
): Array<{ category: WorkflowComponentCategory; items: T[] }> {
  const groups = new Map<WorkflowComponentCategory, T[]>();
  for (const item of items) {
    const category = workflowComponentCategory(getCategory(item));
    const group = groups.get(category);
    if (group) {
      group.push(item);
    } else {
      groups.set(category, [item]);
    }
  }
  return Array.from(groups.entries())
    .map(([category, groupItems]) => ({ category, items: groupItems }))
    .sort((left, right) => workflowComponentCategorySortIndex(left.category) - workflowComponentCategorySortIndex(right.category));
}

function workflowComponentCategorySortIndex(category: WorkflowComponentCategory): number {
  const index = workflowComponentCategoryOrder.indexOf(category);
  return index === -1 ? workflowComponentCategoryOrder.length : index;
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
      node.data.category ?? "",
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
  sourcePort: FlowPort,
): WorkflowPrimitiveConnectorTarget[] {
  return nodes.flatMap((template) => {
    const input = template.data.inputs.find((portValue) => portsCompatible(sourcePort, portValue));
    return input ? [{ template, input }] : [];
  });
}

function workflowSavedBlockConnectorTargets(
  blocks: SavedWorkflowBlock[],
  sourcePort: FlowPort,
): WorkflowSavedBlockConnectorTarget[] {
  return blocks.flatMap((block) => {
    const input = savedWorkflowBlockOpenInputs(block).find((candidate) => portsCompatible(sourcePort, candidate.port));
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

function savedWorkflowBlockExposedOutputs(block: SavedWorkflowBlock): WorkflowBlockOpenInput[] {
  const outgoingHandles = new Set(
    block.edges
      .filter((edge) => edge.sourceHandle)
      .map((edge) => `${edge.source}:${edge.sourceHandle}`),
  );

  return block.nodes.flatMap((node) =>
    node.data.outputs
      .filter((output) => !outgoingHandles.has(`${node.id}:${handleId("out", output)}`))
      .map((output) => ({
        nodeId: node.id,
        nodeTitle: node.data.title,
        port: output,
      })),
  );
}

function workflowKindForSavedWorkflowBlock(block: SavedWorkflowBlock): WorkflowKindId {
  return workflowKindId(block.kind) ?? inferWorkflowKindFromName(block.name);
}

function filterSavedWorkflowBlocks(blocks: SavedWorkflowBlock[], query: string): SavedWorkflowBlock[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return blocks;
  }
  return blocks.filter((block) =>
    [
      block.name,
      block.category ?? "",
      ...(block.tags ?? []),
      ...block.nodes.flatMap((node) => [
        node.data.title,
        node.data.packageName,
        node.data.description,
        node.data.category ?? "",
        ...(node.data.tags ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function workflowComponentCategory(value: unknown): WorkflowComponentCategory {
  return isWorkflowComponentCategory(value) ? value : "Reusable";
}

function categoryForWorkflowNodes(nodes: WorkflowNodeModel[]): WorkflowComponentCategory {
  const categories = nodes.map((node) => node.data.category ?? categoryForWorkflowNodeData(node.data));
  const uniqueCategories = new Set(categories);
  if (uniqueCategories.size === 1) {
    return workflowComponentCategory(categories[0]);
  }
  if (categories.some((category) => category === "Dashboard")) {
    return "Dashboard";
  }
  if (categories.some((category) => category === "Output")) {
    return "Output";
  }
  return "Reusable";
}

function categoryForSavedWorkflowBlock(block: SavedWorkflowBlock): WorkflowComponentCategory {
  return categoryForWorkflowNodes(
    block.nodes.map((node) => ({
      id: node.id,
      type: "workflow" as const,
      position: { ...node.position },
      data: cloneWorkflowNodeData(node.data),
    })),
  );
}

function categoryForWorkflowNodeData(data: WorkflowNodeData): WorkflowComponentCategory {
  const packageName = data.packageName.toLowerCase();
  const title = data.title.toLowerCase();
  const text = `${title} ${packageName} ${data.description.toLowerCase()}`;

  if (data.category) {
    return workflowComponentCategory(data.category);
  }
  if (packageName.includes("@video-analysis-studio/ui") || title.includes("dashboard") || title.includes("panel") || title.includes("table")) {
    return "Dashboard";
  }
  if (packageName.includes("generator")) {
    return "Generator";
  }
  if (packageName.includes("control flow")) {
    return "Control Flow";
  }
  if (packageName.includes("studio-api") || title.includes("api")) {
    return "API";
  }
  if (packageName === "input" || title.includes("source picker") || title.includes("loader")) {
    return "Input";
  }
  if (title.includes("workflow") || title.includes("pipeline")) {
    return "Pipeline";
  }
  if (title.includes("sink") || title.includes("save") || text.includes("webhook")) {
    return "Output";
  }
  if (text.includes("ffmpeg") || text.includes("ingest") || text.includes("download")) {
    return "Ingest";
  }
  if (text.includes("detector") || text.includes("scene")) {
    return "Detection";
  }
  if (text.includes("model") || text.includes("ocr") || text.includes("object")) {
    return "Models";
  }
  if (text.includes("audio")) {
    return "Audio";
  }
  if (text.includes("transcript") || text.includes("text")) {
    return "Text";
  }
  if (text.includes("report") || text.includes("serde_json")) {
    return "Report";
  }
  if (text.includes("bucket") || text.includes("data")) {
    return "Data";
  }
  if (title.includes("user story")) {
    return "Application";
  }
  return "Pipeline";
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
    data.category ?? categoryForWorkflowNodeData(data),
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

function workflowGroupOpenViewLayout(group: WorkflowGroupMetadata): {
  width: number;
  height: number;
  nodes: Array<{ node: SavedWorkflowBlockNode; x: number; y: number }>;
  edges: Array<{ id: string; path: string; type: PortType }>;
} {
  if (group.nodes.length === 0) {
    return { width: 240, height: 150, nodes: [], edges: [] };
  }

  const xGroups = workflowGroupCoordinateGroups(group.nodes.map((node) => node.position.x), 120);
  const yGroups = workflowGroupCoordinateGroups(group.nodes.map((node) => node.position.y), 90);
  const cellCounts = new Map<string, number>();
  const layoutNodes = group.nodes.map((node) => {
    const xRank = workflowGroupCoordinateRank(node.position.x, xGroups);
    const yRank = workflowGroupCoordinateRank(node.position.y, yGroups);
    const cellKey = `${xRank}:${yRank}`;
    const cellIndex = cellCounts.get(cellKey) ?? 0;
    cellCounts.set(cellKey, cellIndex + 1);
    return {
      node,
      x: workflowGroupPreviewPadding + xRank * 190,
      y: workflowGroupPreviewPadding + yRank * 96 + cellIndex * 74,
    };
  });
  const layoutNodeById = new Map(layoutNodes.map((node) => [node.node.id, node]));
  const layoutEdges = group.edges.flatMap((edge, index) => {
    const source = layoutNodeById.get(edge.source);
    const target = layoutNodeById.get(edge.target);
    if (!source || !target) {
      return [];
    }
    const sourceX = source.x + workflowGroupPreviewNodeWidth;
    const sourceY = source.y + workflowGroupPreviewNodeHeight / 2;
    const targetX = target.x;
    const targetY = target.y + workflowGroupPreviewNodeHeight / 2;
    const distance = Math.max(36, Math.abs(targetX - sourceX) * 0.45);
    const path = `M ${sourceX} ${sourceY} C ${sourceX + distance} ${sourceY}, ${targetX - distance} ${targetY}, ${targetX} ${targetY}`;
    const sourcePort = source.node.data.outputs.find((portValue) => edge.sourceHandle === handleId("out", portValue));
    const targetPort = target.node.data.inputs.find((portValue) => edge.targetHandle === handleId("in", portValue));
    const type = sourcePort?.type ?? targetPort?.type ?? "run_config";
    return [{ id: `${edge.source}-${edge.sourceHandle}-${edge.target}-${edge.targetHandle}-${index}`, path, type }];
  });
  const width =
    Math.max(...layoutNodes.map((node) => node.x)) + workflowGroupPreviewNodeWidth + workflowGroupPreviewPadding;
  const height =
    Math.max(...layoutNodes.map((node) => node.y)) + workflowGroupPreviewNodeHeight + workflowGroupPreviewPadding;

  return {
    width: Math.max(260, width),
    height: Math.max(150, height),
    nodes: layoutNodes,
    edges: layoutEdges,
  };
}

function workflowGroupCoordinateGroups(values: number[], threshold: number): number[] {
  const groups: number[] = [];
  for (const value of [...values].sort((left, right) => left - right)) {
    const last = groups.at(-1);
    if (last === undefined || Math.abs(value - last) > threshold) {
      groups.push(value);
    } else {
      groups[groups.length - 1] = (last + value) / 2;
    }
  }
  return groups;
}

function workflowGroupCoordinateRank(value: number, groups: number[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  groups.forEach((groupValue, index) => {
    const distance = Math.abs(value - groupValue);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
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

function ComponentsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="4" width="5.5" height="5.5" rx="1.2" />
      <rect x="7.25" y="10.5" width="5.5" height="5.5" rx="1.2" />
      <path d="M9 6.75h2" strokeLinecap="round" />
      <path d="m10 9.5.25 1" strokeLinecap="round" />
      <path d="m11 10.5 1.75-1" strokeLinecap="round" />
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

function DataSourceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <ellipse cx="10" cy="5" rx="5.8" ry="2.5" />
      <path d="M4.2 5v9.2c0 1.4 2.6 2.5 5.8 2.5s5.8-1.1 5.8-2.5V5" />
      <path d="M4.2 9.2c0 1.4 2.6 2.5 5.8 2.5s5.8-1.1 5.8-2.5" />
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

function OpenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M7.5 4.5H4.8c-.7 0-1.3.6-1.3 1.3v9.4c0 .7.6 1.3 1.3 1.3h9.4c.7 0 1.3-.6 1.3-1.3v-2.7" strokeLinecap="round" />
      <path d="M11 3.5h5.5V9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m9 11 7-7" strokeLinecap="round" />
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

function ArrangeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <rect x="3.5" y="4" width="5" height="4" rx="1" />
      <rect x="11.5" y="3.5" width="5" height="4" rx="1" />
      <rect x="7.5" y="12" width="5" height="4" rx="1" />
      <path d="M8.5 6h3" strokeLinecap="round" />
      <path d="m10 8v4" strokeLinecap="round" />
      <path d="m13.5 7.5-2 4.5" strokeLinecap="round" />
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
