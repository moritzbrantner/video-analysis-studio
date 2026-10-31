import { type Edge } from "@xyflow/react";
import { workflowGraphHasCycle } from "../workflowGraph";
import { appLocationFromPath } from "../app/routing";
import type { WorkflowKindId } from "../run/types";
import { inferWorkflowKindFromName, workflowKindId, workflowKinds } from "../run/workflowKinds";
import { fileDateStamp } from "../shared/utils";
import { workflowKindForSavedWorkflowBlock } from "./componentCatalog";
import { workflowEdgeFromConnection } from "./connections";
import {
  defaultSeedWorkflowName,
  legacySeedWorkflowNames,
  maxSavedWorkflowVersions,
  savedWorkflowJsonFormat,
  savedWorkflowJsonVersion,
  savedWorkflowsJsonFormat,
  savedWorkflowsJsonVersion,
  savedWorkflowsStorageKey,
} from "./constants";
import { dedupeEdges } from "./graphOperations";
import { isSavedWorkflowFile, isSavedWorkflowLibrary } from "./guards";
import { createWorkflowId, createWorkflowVersionId, safeFlowId, workflowSeedId } from "./ids";
import {
  initialWorkflowEdges,
  initialWorkflowNodes,
  workflowEdge,
  workflowNodeTemplates,
} from "./nodeCatalog";
import { cloneWorkflowNodeData } from "./nodeData";
import { findPort, portsCompatible } from "./ports";
import {
  cloneWorkflowResultPanel,
  defaultWorkflowResultPanel,
  normalizeWorkflowResultPanel,
} from "./resultPanels";
import {
  exampleWorkflowSeeds,
  exampleWorkflowStarterTemplates,
  workflowStarterTemplates,
} from "./seedTemplates";
import type {
  SavedWorkflow,
  SavedWorkflowBlock,
  SavedWorkflowBlockEdge,
  SavedWorkflowBlockNode,
  SavedWorkflowFile,
  SavedWorkflowLibrary,
  SavedWorkflowVersion,
  WorkflowNodeModel,
  WorkflowResultPanel,
  WorkflowSeedNodeLayout,
  WorkflowSeedTemplate,
} from "./types";
import {
  comparableWorkflowEdge,
  comparableWorkflowNode,
  serializeWorkflowEdge,
  serializeWorkflowNode,
} from "./workflowVersions";

export function buildWorkflowFile(workflow: SavedWorkflow, nodes: WorkflowNodeModel[], edges: Edge[]): SavedWorkflowFile {
  return {
    format: savedWorkflowJsonFormat,
    version: savedWorkflowJsonVersion,
    lastUpdated: new Date().toISOString(),
    workflowName: workflow.name,
    workflowKind: workflow.kind,
    workflowVersion: workflow.version,
    resultPanel: cloneWorkflowResultPanel(workflow.resultPanel, workflow.kind, workflow.name),
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
}

export function downloadWorkflowJson(workflow: SavedWorkflow, nodes: WorkflowNodeModel[], edges: Edge[]) {
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

export function parseWorkflowJson(text: string): {
  lastUpdated: string;
  workflowName?: string;
  workflowKind?: WorkflowKindId;
  workflowVersion?: number;
  resultPanel?: WorkflowResultPanel;
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
  resultPanel?: WorkflowResultPanel;
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
    resultPanel: normalizeWorkflowResultPanel(file.resultPanel, file.workflowKind ?? "youtube-video", file.workflowName),
    nodes,
    edges: restoreValidWorkflowEdges(file.edges, nodes),
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

export function loadSavedWorkflowLibrary(): SavedWorkflowLibrary {
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

    const workflows = ensureBuiltInWorkflowCoverage(parsed.workflows.filter(savedWorkflowHasValidGraph).map(normalizeSavedWorkflow));
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

export function persistSavedWorkflowLibrary(library: SavedWorkflowLibrary) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(savedWorkflowsStorageKey, JSON.stringify(library));
}

export function renameWorkflowLibraryDataSourceId(
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

export function workflowSeedState(kind: WorkflowKindId, name?: string): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
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
    resultPanel: normalizeWorkflowResultPanel(workflow.resultPanel, kind, name),
    updatedAt: legacySeedWorkflowNames.has(workflow.name) ? new Date().toISOString() : workflow.updatedAt,
  };
}

function ensureBuiltInWorkflowCoverage(workflows: SavedWorkflow[]): SavedWorkflow[] {
  const presentKinds = new Set(workflows.map((workflow) => workflow.kind));
  const workflowKindSeeds = workflowKinds
    .filter((workflowKind) => !presentKinds.has(workflowKind.id))
    .map((workflowKind) =>
      createSeedSavedWorkflow(
        workflowKind.defaultWorkflowName,
        workflowKind.id,
        workflowSeedId(workflowKind.id, workflowKind.defaultWorkflowName),
      ),
    );
  const presentIds = new Set(workflows.map((workflow) => workflow.id));
  const exampleSeeds = exampleWorkflowSeeds
    .filter((workflow) => !presentIds.has(workflowSeedId(workflow.kind, workflow.name)))
    .map((workflow) =>
      createSeedSavedWorkflow(
        workflow.name,
        workflow.kind,
        workflowSeedId(workflow.kind, workflow.name),
      ),
    );
  return workflows.concat(workflowKindSeeds, exampleSeeds);
}

export function createSavedWorkflow(
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
    resultPanel: defaultWorkflowResultPanel(kind, name),
    nodes: nodes.map(serializeWorkflowNode),
    edges: edges.map(serializeWorkflowEdge),
  };
  const version = createSavedWorkflowVersion(workflow, name, nodes, edges, 1, createdAt);
  return {
    ...workflow,
    versions: [version],
  };
}

export function createSavedWorkflowVersion(
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

export function createBlankSavedWorkflow(name = "Untitled Workflow", kind: WorkflowKindId = "youtube-video"): SavedWorkflow {
  return createSavedWorkflow(name, [], [], kind);
}

export function importSharedWorkflowFile(
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
    resultPanel: normalizeWorkflowResultPanel(restored.resultPanel, importedKind, importedName),
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

export function activeSavedWorkflow(library: SavedWorkflowLibrary): SavedWorkflow {
  return library.workflows.find((workflow) => workflow.id === library.activeWorkflowId) ?? library.workflows[0];
}

export function workflowStateFromSavedWorkflow(workflow: SavedWorkflow): { nodes: WorkflowNodeModel[]; edges: Edge[] } {
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

export function createComponentDraftWorkflow(block: SavedWorkflowBlock): SavedWorkflow {
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

export function savedWorkflowBlockHasValidGraph(block: SavedWorkflowBlock): boolean {
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
