import React, { useMemo, useState, useRef, useEffect, useCallback } from "react";
import {
  useNodesState,
  useEdgesState,
  type Edge,
  type ReactFlowInstance,
  type HandleType,
  type Connection,
  addEdge,
  type OnReconnect,
  type FinalConnectionState,
  type NodeChange,
  applyNodeChanges,
  ReactFlow,
  Background,
  Controls,
} from "@xyflow/react";
import { type TypeDefinition } from "../type-library/page";
import { type WorkflowCatalog as RustWorkflowCatalog } from "../api/client";
import { encodeWorkflowSharePayload, workflowShareUrl } from "../workflowShare";
import type { DataSourceEntry, WorkflowKindId } from "../run/types";
import { workflowKindName } from "../run/workflowKinds";
import { workflowFocusTargetKey } from "../run/workflowRunInputs";
import {
  ArrangeIcon,
  DownloadIcon,
  OpenIcon,
  PlayIcon,
  RefreshIcon,
  SaveIcon,
  SpinnerIcon,
  UploadIcon,
} from "../shared/icons";
import {
  classNames,
  copyTextToClipboard,
  formatWorkflowTimestamp,
  loadStoredBoolean,
  persistStoredBoolean,
} from "../shared/utils";
import {
  autoArrangeWorkflowNodes,
  connectedWorkflowNodePosition,
  nextBlockAnchor,
} from "./autoLayout";
import {
  filterSavedWorkflowBlocks,
  filterWorkflowNodeTemplates,
  workflowPrimitiveConnectorTargets,
  workflowSavedBlockConnectorTargets,
} from "./componentCatalog";
import { WorkflowComponentSelector } from "./ComponentLibrary";
import {
  compatibleConnection,
  connectionCreatesLoop,
  connectionLoopMessage,
  connectionMismatchMessage,
  workflowEdgeFromConnection,
} from "./connections";
import {
  maxSavedWorkflowVersions,
  workflowBuilderComponentsCollapsedStorageKey,
  workflowBuilderDetailsCollapsedStorageKey,
  workflowComponentDragDataType,
} from "./constants";
import {
  PortTypeColorContext,
  WorkflowFocusContext,
  WorkflowOutputConnectorContext,
} from "./contexts";
import {
  workflowNodeDataSourceSynced,
  workflowNodeDataWithAdapter,
  workflowNodeDataWithAdapterSource,
  workflowNodeDataWithDataSource,
} from "./dataSourceNodes";
import {
  buildSavedWorkflowBlock,
  createSavedWorkflowBlock,
  createWorkflowClipboardState,
  createWorkflowGroup,
  dedupeEdges,
  instantiateSavedWorkflowBlock,
  restoreWorkflowGroup,
} from "./graphOperations";
import { parseWorkflowComponentDragPayload } from "./guards";
import { hotkeyActions, matchesHotkeyBinding, shouldIgnoreHotkeyEvent } from "./hotkeys";
import { createWorkflowNodeInstanceId } from "./ids";
import {
  stickWorkflowInlineAttachments,
  workflowDisplayEdges,
  workflowInlineAttachmentForDraggedNode,
  workflowInlineAttachmentForDrop,
} from "./inlineAttachments";
import { workflowNodeTemplates } from "./nodeCatalog";
import { cloneWorkflowNodeData } from "./nodeData";
import { workflowCatalogNodeTemplates } from "./nodeFactory";
import { workflowNodeDataCanUseInlineLayout } from "./nodeSizing";
import { portTypeColorsStyle } from "./portColors";
import { findPort, handleId, portsCompatible } from "./ports";
import { cloneWorkflowResultPanel, normalizeWorkflowResultPanel } from "./resultPanels";
import {
  downloadSavedWorkflowBlocksJson,
  mergeSavedWorkflowBlocks,
  parseSavedWorkflowBlocksJson,
} from "./savedBlocks";
import type {
  AdapterTransformStep,
  DataSourceSchema,
  FlowPort,
  HotkeyActionId,
  HotkeyBindings,
  PortTypeColors,
  SavedWorkflow,
  SavedWorkflowBlock,
  SavedWorkflowLibrary,
  SavedWorkflowVersion,
  WorkflowBlockCategoryDraft,
  WorkflowBlockOpenInput,
  WorkflowClipboardState,
  WorkflowContextMenuState,
  WorkflowFocusTarget,
  WorkflowNodeData,
  WorkflowNodeModel,
  WorkflowOutputConnectorContextValue,
  WorkflowOutputConnectorMenuState,
  WorkflowResultPanel,
} from "./types";
import { WorkflowDetailsPanel } from "./WorkflowDetailsPanel";
import {
  activeSavedWorkflow,
  buildWorkflowFile,
  createBlankSavedWorkflow,
  createSavedWorkflow,
  createSavedWorkflowVersion,
  downloadWorkflowJson,
  parseWorkflowJson,
  persistSavedWorkflowLibrary,
  workflowSeedState,
  workflowStateFromSavedWorkflow,
} from "./workflowLibrary";
import { WorkflowContextMenu, WorkflowOutputConnectorMenu } from "./WorkflowMenus";
import { WorkflowNode } from "./WorkflowNode";
import {
  serializeWorkflowEdge,
  serializeWorkflowNode,
  workflowHasChangesSinceLatestVersion,
} from "./workflowVersions";

const workflowNodeTypes = { workflow: WorkflowNode };

export function WorkflowBuilder({
  workflowLibrary,
  onWorkflowLibraryChange,
  savedBlocks,
  onSavedBlocksChange,
  workflowCatalog,
  dataSources,
  typeDefinitions,
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
  typeDefinitions: TypeDefinition[];
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
    const workflow = {
      ...createSavedWorkflow(`${activeWorkflow.name} Copy`, nodes, edges, activeWorkflow.kind),
      resultPanel: cloneWorkflowResultPanel(activeWorkflow.resultPanel, activeWorkflow.kind, `${activeWorkflow.name} Copy`),
    };
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
  }, [activeWorkflow.kind, activeWorkflow.name, activeWorkflow.resultPanel, commitWorkflowLibrary, edges, nodes, setEdges, setNodes, workflowLibrary]);

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
          workflow.id === workflowId
            ? {
                ...workflow,
                kind,
                updatedAt,
                resultPanel: normalizeWorkflowResultPanel(workflow.resultPanel, kind, workflow.name),
              }
            : workflow,
        ),
      };
      commitWorkflowLibrary(nextLibrary);
    },
    [commitWorkflowLibrary, workflowLibrary],
  );

  const updateWorkflowResultPanel = useCallback(
    (workflowId: string, panel: WorkflowResultPanel) => {
      const updatedAt = new Date().toISOString();
      const nextLibrary: SavedWorkflowLibrary = {
        ...workflowLibrary,
        workflows: workflowLibrary.workflows.map((workflow) =>
          workflow.id === workflowId
            ? {
                ...workflow,
                updatedAt,
                resultPanel: normalizeWorkflowResultPanel(panel, workflow.kind, workflow.name),
              }
            : workflow,
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

  const updateWorkflowNodeAdapter = useCallback(
    (
      nodeId: string,
      inputSchema: DataSourceSchema,
      outputSchema: DataSourceSchema,
      steps: AdapterTransformStep[],
    ) => {
      const nextNodes = nodes.map((node) =>
        node.id === nodeId && node.data.adapterNode
          ? {
              ...node,
              data: workflowNodeDataWithAdapter(node.data, inputSchema, outputSchema, steps),
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
          typeDefinitions={typeDefinitions}
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
          onResultPanelChange={(panel) => updateWorkflowResultPanel(activeWorkflow.id, panel)}
          onSaveSelectedBlock={saveSelectedBlock}
          onGroupSelected={() => groupNodes(selectedNodeIds)}
          onDeleteSelected={() => deleteWorkflowNodes(selectedNodeIds)}
          onUpdateSelectedGroup={updateGroupDetails}
          onUpdateSelectedDataSource={updateWorkflowNodeDataSource}
          onUpdateSelectedAdapter={updateWorkflowNodeAdapter}
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
