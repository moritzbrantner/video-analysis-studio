import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Panel as FlowPanel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { YoutubeVideoReport } from "./types";

type SourceMode = "url" | "file";

interface WorkflowFormSnapshot {
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
}

type ExecutionStatus = "waiting" | "processing" | "complete";
type ExecutionTone = "sky" | "rose" | "amber" | "emerald" | "violet" | "cyan" | "indigo" | "fuchsia" | "slate" | "zinc";
type WorkflowDataKind =
  | "run_config"
  | "source_media"
  | "video_metadata"
  | "video_frame"
  | "audio_frame"
  | "audio_wav"
  | "scene_result"
  | "video_observation"
  | "model_prediction"
  | "audio_feature"
  | "audio_event"
  | "transcript_segment"
  | "text_event"
  | "data_record"
  | "data_bucket"
  | "json_report"
  | "dashboard_view";

interface ExecutionPort {
  id: string;
  label: string;
  kind: WorkflowDataKind;
}

interface ExecutionDataPacket {
  kind: WorkflowDataKind;
  label: string;
  summary: string;
  count: number;
  detail: string;
}

interface ExecutionNodeTemplate {
  id: string;
  x: number;
  y: number;
  title: string;
  packageName: string;
  description: string;
  tone: ExecutionTone;
  inputs: ExecutionPort[];
  outputs: ExecutionPort[];
}

interface ExecutionNodeData extends Record<string, unknown> {
  title: string;
  packageName: string;
  description: string;
  tone: ExecutionTone;
  status: ExecutionStatus;
  inputs: ExecutionDataPacket[];
  outputs: ExecutionDataPacket[];
  onInspect: (event: MouseEvent, packet: ExecutionDataPacket, owner: string) => void;
}

type ExecutionNodeModel = Node<ExecutionNodeData, "execution">;

interface InspectState {
  x: number;
  y: number;
  title: string;
  packet: ExecutionDataPacket;
}

const executionNodeTypes = { execution: ExecutionFlowNode };

const executionTemplates: ExecutionNodeTemplate[] = [
  {
    id: "inputs",
    x: 0,
    y: 210,
    title: "Workflow Inputs",
    packageName: "@video-analysis/web",
    description: "Validated run parameters and the selected media source.",
    tone: "sky",
    inputs: [],
    outputs: [
      port("config", "run config", "run_config"),
      port("source", "source media", "source_media"),
    ],
  },
  {
    id: "ingest",
    x: 390,
    y: 160,
    title: "Ingest",
    packageName: "video-analysis-ffmpeg",
    description: "Probes media metadata and emits decoded frame/audio streams.",
    tone: "amber",
    inputs: [
      port("source", "source media", "source_media"),
      port("config", "run config", "run_config"),
    ],
    outputs: [
      port("metadata", "metadata", "video_metadata"),
      port("frames", "video frames", "video_frame"),
      port("audio", "audio frames", "audio_frame"),
      port("wav", "audio wav", "audio_wav"),
    ],
  },
  {
    id: "scene",
    x: 790,
    y: 0,
    title: "Scene Detector",
    packageName: "video-analysis-detectors",
    description: "Splits the frame stream into scene spans using the configured threshold.",
    tone: "emerald",
    inputs: [
      port("frames", "video frames", "video_frame"),
      port("config", "thresholds", "run_config"),
    ],
    outputs: [
      port("scenes", "scenes", "scene_result"),
      port("records", "scene records", "data_record"),
    ],
  },
  {
    id: "visual",
    x: 790,
    y: 310,
    title: "Visual Models",
    packageName: "video-analysis-models",
    description: "Samples frames and normalizes optional object/OCR model responses.",
    tone: "violet",
    inputs: [
      port("frames", "sampled frames", "video_frame"),
      port("config", "model config", "run_config"),
    ],
    outputs: [
      port("observations", "observations", "video_observation"),
      port("predictions", "raw predictions", "model_prediction"),
      port("records", "model records", "data_record"),
    ],
  },
  {
    id: "audio",
    x: 790,
    y: 650,
    title: "Audio Analysis",
    packageName: "video-analysis-core",
    description: "Converts decoded samples into coarse audio events and diagnostics.",
    tone: "cyan",
    inputs: [port("audio", "audio frames", "audio_frame")],
    outputs: [
      port("events", "audio events", "audio_event"),
      port("features", "energy features", "audio_feature"),
      port("records", "audio records", "data_record"),
    ],
  },
  {
    id: "text",
    x: 1200,
    y: 650,
    title: "Transcript + Text",
    packageName: "whisper cli / video-analysis-core",
    description: "Creates transcript segments and text-derived events when enabled.",
    tone: "indigo",
    inputs: [
      port("wav", "audio wav", "audio_wav"),
      port("config", "text config", "run_config"),
    ],
    outputs: [
      port("segments", "segments", "transcript_segment"),
      port("events", "text events", "text_event"),
      port("records", "text records", "data_record"),
    ],
  },
  {
    id: "buckets",
    x: 1200,
    y: 310,
    title: "Bucket Aggregator",
    packageName: "video-analysis-data",
    description: "Compacts frame, model, audio, and transcript records into bounded buckets.",
    tone: "slate",
    inputs: [port("records", "records", "data_record")],
    outputs: [port("buckets", "buckets", "data_bucket")],
  },
  {
    id: "report",
    x: 1610,
    y: 210,
    title: "Report Writer",
    packageName: "serde_json",
    description: "Assembles the final report from every routed analysis product.",
    tone: "zinc",
    inputs: [
      port("metadata", "metadata", "video_metadata"),
      port("scenes", "scenes", "scene_result"),
      port("observations", "observations", "video_observation"),
      port("audio", "audio events", "audio_event"),
      port("segments", "segments", "transcript_segment"),
      port("text", "text events", "text_event"),
      port("buckets", "buckets", "data_bucket"),
    ],
    outputs: [port("report", "analysis.json", "json_report")],
  },
  {
    id: "result",
    x: 2430,
    y: 210,
    title: "Result Page",
    packageName: "Result Page Editor",
    description: "Visualizes selected report outputs in the assembled dashboard.",
    tone: "sky",
    inputs: [port("report", "report json", "json_report")],
    outputs: [port("view", "dashboard view", "dashboard_view")],
  },
  {
    id: "disk-sink",
    x: 2020,
    y: 0,
    title: "Disk Result Sink",
    packageName: "fs / browser download",
    description: "Persists the final JSON report to disk as analysis output.",
    tone: "emerald",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  },
  {
    id: "database-sink",
    x: 2020,
    y: 210,
    title: "Database Result Sink",
    packageName: "IndexedDB / database adapter",
    description: "Stores the final JSON report as a durable database record.",
    tone: "cyan",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  },
  {
    id: "http-sink",
    x: 2020,
    y: 420,
    title: "HTTP Result Sink",
    packageName: "fetch / webhook",
    description: "Sends the final JSON report to an HTTP endpoint.",
    tone: "rose",
    inputs: [port("report", "report json", "json_report")],
    outputs: [],
  },
];

const defaultExecutionEdges: Edge[] = [
  executionEdge("inputs", "config", "ingest", "config"),
  executionEdge("inputs", "source", "ingest", "source"),
  executionEdge("inputs", "config", "scene", "config"),
  executionEdge("inputs", "config", "visual", "config"),
  executionEdge("inputs", "config", "text", "config"),
  executionEdge("ingest", "metadata", "report", "metadata"),
  executionEdge("ingest", "frames", "scene", "frames"),
  executionEdge("ingest", "frames", "visual", "frames"),
  executionEdge("ingest", "audio", "audio", "audio"),
  executionEdge("ingest", "wav", "text", "wav"),
  executionEdge("scene", "scenes", "report", "scenes"),
  executionEdge("scene", "records", "buckets", "records"),
  executionEdge("visual", "observations", "report", "observations"),
  executionEdge("visual", "records", "buckets", "records"),
  executionEdge("audio", "events", "report", "audio"),
  executionEdge("audio", "records", "buckets", "records"),
  executionEdge("text", "segments", "report", "segments"),
  executionEdge("text", "events", "report", "text"),
  executionEdge("text", "records", "buckets", "records"),
  executionEdge("buckets", "buckets", "report", "buckets"),
  executionEdge("report", "report", "result", "report"),
  executionEdge("report", "report", "disk-sink", "report"),
  executionEdge("report", "report", "database-sink", "report"),
  executionEdge("report", "report", "http-sink", "report"),
];

export function WorkflowExecutionEditor({
  form,
  report,
  workflowName = "Workflow",
  visualizedDataKinds,
  onVisualizeDataKind,
}: {
  form: WorkflowFormSnapshot;
  report: YoutubeVideoReport;
  workflowName?: string;
  visualizedDataKinds: string[];
  onVisualizeDataKind: (dataKind: string) => void;
}) {
  const [step, setStep] = useState(-1);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [ignoredKinds, setIgnoredKinds] = useState<Set<string>>(() => new Set(["audio_feature", "model_prediction"]));
  const [inspect, setInspect] = useState<InspectState | null>(null);
  const packets = useMemo(() => buildPackets(form, report, visualizedDataKinds), [form, report, visualizedDataKinds]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ExecutionNodeModel>(
    buildExecutionNodes(step, packets, openPacketInspector),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(defaultExecutionEdges);

  const openInspector = useCallback((event: MouseEvent, packet: ExecutionDataPacket, owner: string) => {
    event.preventDefault();
    setInspect({ x: event.clientX, y: event.clientY, title: owner, packet });
  }, []);

  function openPacketInspector(event: MouseEvent, packet: ExecutionDataPacket, owner: string) {
    event.preventDefault();
    setInspect({ x: event.clientX, y: event.clientY, title: owner, packet });
  }

  useEffect(() => {
    setNodes((currentNodes) => {
      const nextNodes = buildExecutionNodes(step, packets, openInspector);
      const byId = new Map(currentNodes.map((node) => [node.id, node]));
      return nextNodes.map((node) => ({ ...node, position: byId.get(node.id)?.position ?? node.position }));
    });
  }, [openInspector, packets, setNodes, step]);

  useEffect(() => {
    if (!isAutoRunning) {
      return;
    }
    if (step >= executionTemplates.length) {
      setIsAutoRunning(false);
      return;
    }
    const timer = window.setTimeout(() => setStep((current) => Math.min(current + 1, executionTemplates.length)), 700);
    return () => window.clearTimeout(timer);
  }, [isAutoRunning, step]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => compatibleExecutionConnection(connection),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      const sourcePort = findTemplatePort(connection.source, connection.sourceHandle, "out");
      const targetPort = findTemplatePort(connection.target, connection.targetHandle, "in");
      if (!sourcePort || !targetPort || sourcePort.kind !== targetPort.kind) {
        return;
      }
      setEdges((currentEdges) => addEdge(executionEdgeFromConnection(connection, sourcePort.kind), currentEdges));
    },
    [setEdges],
  );

  const coverage = useMemo(
    () => buildCoverage(edges, visualizedDataKinds, ignoredKinds),
    [edges, ignoredKinds, visualizedDataKinds],
  );

  return (
    <section className="space-y-4">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950">{workflowName}</h2>
              <p className="mt-1 text-sm text-zinc-600">{workflowInputSummary(form)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => {
                  setStep(0);
                  setIsAutoRunning(true);
                }}
                title="Run workflow"
              >
                <PlayIcon className="h-4 w-4" />
                Run
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => {
                  setIsAutoRunning(false);
                  setStep((current) => Math.min(current + 1, executionTemplates.length));
                }}
                title="Step workflow"
              >
                <StepIcon className="h-4 w-4" />
                Step
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
                onClick={() => {
                  setIsAutoRunning(false);
                  setStep(-1);
                  setNodes(buildExecutionNodes(-1, packets, openInspector));
                  setEdges(defaultExecutionEdges);
                  setIgnoredKinds(new Set(["audio_feature", "model_prediction"]));
                }}
                title="Reset workflow"
              >
                <RefreshIcon className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>
          <div className="h-[720px] min-h-[560px] w-full">
            <ReactFlow<ExecutionNodeModel, Edge>
              nodes={nodes}
              edges={edges.map((edge) => executionEdgeWithState(edge, step))}
              nodeTypes={executionNodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeContextMenu={(event, node) => {
                const nodeData = node.data as ExecutionNodeData;
                const packet = nodeData.outputs[0] ?? nodeData.inputs[0];
                if (packet) {
                  openInspector(event, packet, nodeData.title);
                }
              }}
              isValidConnection={isValidConnection}
              fitView
              minZoom={0.22}
              maxZoom={1.35}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              edgesReconnectable
              deleteKeyCode={["Backspace", "Delete"]}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#d4d4d8" gap={18} />
              <Controls showInteractive={false} />
              <FlowPanel position="top-left" className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 shadow-sm">
                {step < 0
                  ? "waiting"
                  : step >= executionTemplates.length
                    ? "complete"
                    : `${executionTemplates[step]?.title ?? "done"} processing`}
              </FlowPanel>
            </ReactFlow>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-950">Data Coverage</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {coverage.unresolved.length === 0 ? "All terminal data is routed." : `${coverage.unresolved.length} outputs need routing.`}
            </p>
          </div>
          <div className="space-y-3 p-4">
            {coverage.items.map((item) => (
              <div
                key={`${item.nodeId}-${item.port.id}`}
                className="rounded-lg border border-zinc-200 p-3"
                title={`${formatDataKind(item.port.kind)} | ${item.reason}`}
                onContextMenu={(event) => {
                  const packet = packets[item.port.kind];
                  if (packet) {
                    openInspector(event, packet, item.template.title);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-900">{item.port.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">{item.template.title}</div>
                  </div>
                  <span className={coverageBadgeClass(item.status)}>{item.status}</span>
                </div>
                {!item.routed && item.status !== "visualized" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-8 items-center rounded-md border border-zinc-300 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() => onVisualizeDataKind(item.port.kind)}
                    >
                      Visualize
                    </button>
                    <button
                      className="inline-flex h-8 items-center rounded-md border border-zinc-300 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() =>
                        setIgnoredKinds((current) => {
                          const next = new Set(current);
                          if (next.has(item.port.kind)) {
                            next.delete(item.port.kind);
                          } else {
                            next.add(item.port.kind);
                          }
                          return next;
                        })
                      }
                    >
                      {ignoredKinds.has(item.port.kind) ? "Unignore" : "Ignore"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {inspect && (
        <div
          className="fixed z-50 w-80 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl"
          style={{ left: Math.min(inspect.x, window.innerWidth - 340), top: Math.min(inspect.y, window.innerHeight - 260) }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase text-zinc-500">{inspect.title}</div>
              <h3 className="mt-1 text-sm font-semibold text-zinc-950">{inspect.packet.label}</h3>
            </div>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
              onClick={() => setInspect(null)}
              title="Close"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-zinc-500">Type</dt>
            <dd className="font-medium text-zinc-900">{formatDataKind(inspect.packet.kind)}</dd>
            <dt className="text-zinc-500">Count</dt>
            <dd className="font-medium text-zinc-900">{formatNumber(inspect.packet.count)}</dd>
            <dt className="text-zinc-500">Summary</dt>
            <dd className="text-zinc-800">{inspect.packet.summary}</dd>
            <dt className="text-zinc-500">Detail</dt>
            <dd className="text-zinc-800">{inspect.packet.detail}</dd>
          </dl>
        </div>
      )}
    </section>
  );
}

function ExecutionFlowNode({ id, data, selected, isConnectable }: NodeProps) {
  const nodeData = data as unknown as ExecutionNodeData;
  return (
    <div
      className={classNames(
        "w-[330px] rounded-lg border bg-white text-left shadow-sm",
        selected ? "border-zinc-950 ring-2 ring-zinc-950/10" : "border-zinc-200",
      )}
    >
      <div className={classNames("border-b px-3 py-2", executionHeaderClass(nodeData.tone))}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-950">{nodeData.title}</div>
            <div className="mt-0.5 text-[11px] font-medium text-zinc-600">{nodeData.packageName}</div>
          </div>
          <span className={statusClass(nodeData.status)}>{nodeData.status}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-600">{nodeData.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3">
        <ExecutionPortColumn
          nodeId={id}
          title="Inputs"
          direction="in"
          packets={nodeData.inputs}
          isConnectable={isConnectable}
          onInspect={nodeData.onInspect}
          owner={nodeData.title}
        />
        <ExecutionPortColumn
          nodeId={id}
          title="Outputs"
          direction="out"
          packets={nodeData.outputs}
          isConnectable={isConnectable}
          onInspect={nodeData.onInspect}
          owner={nodeData.title}
        />
      </div>
    </div>
  );
}

function ExecutionPortColumn({
  nodeId,
  title,
  direction,
  packets,
  isConnectable,
  onInspect,
  owner,
}: {
  nodeId: string;
  title: string;
  direction: "in" | "out";
  packets: ExecutionDataPacket[];
  isConnectable: boolean;
  onInspect: (event: MouseEvent, packet: ExecutionDataPacket, owner: string) => void;
  owner: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase text-zinc-500">{title}</div>
      {packets.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-200 px-2 py-1.5 text-xs text-zinc-400">none</div>
      ) : (
        <div className="space-y-2">
          {packets.map((packet) => (
            <ExecutionPortRow
              key={`${nodeId}-${direction}-${packet.kind}-${packet.label}`}
              direction={direction}
              packet={packet}
              isConnectable={isConnectable}
              onInspect={onInspect}
              owner={owner}
              handleId={handleId(direction, packet.kind, portIdFromPacket(nodeId, direction, packet.kind))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExecutionPortRow({
  direction,
  packet,
  isConnectable,
  onInspect,
  owner,
  handleId: packetHandleId,
}: {
  direction: "in" | "out";
  packet: ExecutionDataPacket;
  isConnectable: boolean;
  onInspect: (event: MouseEvent, packet: ExecutionDataPacket, owner: string) => void;
  owner: string;
  handleId: string;
}) {
  const isInput = direction === "in";
  return (
    <div
      className={classNames("relative rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5", isInput ? "pl-3" : "pr-3")}
      title={`${packet.label}: ${packet.summary}`}
      onContextMenu={(event) => onInspect(event, packet, owner)}
    >
      <Handle
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        id={packetHandleId}
        isConnectable={isConnectable}
        className={classNames("!h-3 !w-3 !border-2 !border-white", executionToneDot(dataTone(packet.kind)))}
        style={{
          left: isInput ? -7 : undefined,
          right: isInput ? undefined : -7,
          top: "50%",
        }}
      />
      <div className={classNames("flex flex-col gap-1", isInput ? "items-start" : "items-end text-right")}>
        <span className="text-xs font-medium text-zinc-800">{packet.label}</span>
        <span className={classNames("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", dataBadgeClass(packet.kind))}>
          {formatNumber(packet.count)} | {formatDataKind(packet.kind)}
        </span>
      </div>
    </div>
  );
}

function buildExecutionNodes(
  step: number,
  packets: Record<WorkflowDataKind, ExecutionDataPacket>,
  onInspect: (event: MouseEvent, packet: ExecutionDataPacket, owner: string) => void,
): ExecutionNodeModel[] {
  return executionTemplates.map((template, index) => ({
    id: template.id,
    type: "execution",
    position: { x: template.x, y: template.y },
    data: {
      title: template.title,
      packageName: template.packageName,
      description: template.description,
      tone: template.tone,
      status: nodeStatus(index, step),
      inputs: template.inputs.map((input) => packetForPort(input, packets)),
      outputs: template.outputs.map((output) => packetForPort(output, packets)),
      onInspect,
    },
  }));
}

function packetForPort(portValue: ExecutionPort, packets: Record<WorkflowDataKind, ExecutionDataPacket>): ExecutionDataPacket {
  return { ...packets[portValue.kind], label: portValue.label };
}

function buildPackets(
  form: WorkflowFormSnapshot,
  report: YoutubeVideoReport,
  visualizedDataKinds: string[],
): Record<WorkflowDataKind, ExecutionDataPacket> {
  const dataRecords = report.data_buckets.reduce((sum, bucket) => sum + bucket.records, 0);
  const modelCount = report.video.observations.filter((observation) =>
    ["object-command", "ocr-command", "scene-classifier"].includes(observation.analyzer),
  ).length;

  return {
    run_config: packet("run_config", "run config", 1, workflowInputSummary(form), `Output ${form.output}`),
    source_media: packet(
      "source_media",
      "source media",
      form.sourceMode === "url" ? Number(Boolean(form.url.trim())) : Number(Boolean(form.input.trim())),
      form.sourceMode === "url" ? form.url || "missing URL" : form.input || "missing file",
      form.sourceMode === "url" ? "YouTube URL input" : "Local video file input",
    ),
    video_metadata: packet(
      "video_metadata",
      "metadata",
      1,
      `${report.video.width}x${report.video.height} | ${report.video.frame_rate}`,
      `${formatSeconds(report.video.duration_seconds)} duration`,
    ),
    video_frame: packet("video_frame", "video frames", report.video.frames_processed, "decoded frame stream", "Feeds scenes and sampled visual models"),
    audio_frame: packet("audio_frame", "audio frames", report.audio.frames_processed, "decoded audio stream", "Feeds audio event detection"),
    audio_wav: packet("audio_wav", "audio wav", report.assets.audio_wav ? 1 : 0, report.assets.audio_wav ?? "not exported", "Feeds transcription"),
    scene_result: packet("scene_result", "scenes", report.video.scenes.length, `${report.video.scenes.length} scene spans`, "Used by report and split plan"),
    video_observation: packet(
      "video_observation",
      "observations",
      report.video.observations.length,
      `${report.video.observations.length} normalized visual observations`,
      "Object, OCR, and scene-level model results",
    ),
    model_prediction: packet("model_prediction", "raw predictions", modelCount, `${modelCount} model responses`, "Ignored unless debugging raw external command output"),
    audio_feature: packet("audio_feature", "audio features", report.audio.frames_processed, "energy windows", "Intermediate diagnostics for audio event detection"),
    audio_event: packet("audio_event", "audio events", report.audio.events.length, `${report.audio.status} | ${report.audio.events.length} events`, "Speech/silence style labels"),
    transcript_segment: packet(
      "transcript_segment",
      "segments",
      report.transcription.segments.length,
      `${report.transcription.status} | ${report.transcription.segments.length} segments`,
      report.transcription.message ?? "Transcript segments",
    ),
    text_event: packet("text_event", "text events", report.text.events.length, `${report.text.status} | ${report.text.events.length} events`, "Transcript-derived labels"),
    data_record: packet("data_record", "records", dataRecords, `${formatNumber(dataRecords)} stream records`, "Intermediate bucket inputs"),
    data_bucket: packet("data_bucket", "buckets", report.data_buckets.length, `${report.data_buckets.length} bounded buckets`, "Used by data bucket dashboard components"),
    json_report: packet("json_report", "report json", 1, report.assets.report_path, "Final serializable workflow output"),
    dashboard_view: packet("dashboard_view", "dashboard view", visualizedDataKinds.length, `${visualizedDataKinds.length} visualized data types`, "Result page component layout"),
  };
}

function buildCoverage(edges: Edge[], visualizedDataKinds: string[], ignoredKinds: Set<string>) {
  const edgeSources = new Set(edges.map((edge) => `${edge.source}:${edge.sourceHandle}`));
  const visualized = new Set(visualizedDataKinds);
  const items = executionTemplates.flatMap((template) =>
    template.outputs.map((portValue) => {
      const routed = edgeSources.has(`${template.id}:${handleId("out", portValue.kind, portValue.id)}`);
      const ignored = ignoredKinds.has(portValue.kind);
      const isVisualized = visualized.has(portValue.kind) || portValue.kind === "dashboard_view";
      const status = routed ? "routed" : isVisualized ? "visualized" : ignored ? "ignored" : "unresolved";
      const reason = routed
        ? "connected to another component"
        : isVisualized
          ? "covered by a result page component"
          : ignored
            ? "explicitly ignored"
            : "not routed, visualized, or ignored";
      return { nodeId: template.id, template, port: portValue, routed, status, reason };
    }),
  );
  return {
    items,
    unresolved: items.filter((item) => item.status === "unresolved"),
  };
}

function nodeStatus(index: number, step: number): ExecutionStatus {
  if (step < index) {
    return "waiting";
  }
  if (step === index) {
    return "processing";
  }
  return "complete";
}

function executionEdge(source: string, sourcePortId: string, target: string, targetPortId: string): Edge {
  const sourcePort = executionTemplates.find((template) => template.id === source)?.outputs.find((candidate) => candidate.id === sourcePortId);
  const targetPort = executionTemplates.find((template) => template.id === target)?.inputs.find((candidate) => candidate.id === targetPortId);
  const kind = sourcePort?.kind ?? targetPort?.kind ?? "run_config";
  return executionEdgeFromConnection(
    {
      source,
      target,
      sourceHandle: sourcePort ? handleId("out", sourcePort.kind, sourcePort.id) : null,
      targetHandle: targetPort ? handleId("in", targetPort.kind, targetPort.id) : null,
    },
    kind,
  );
}

function executionEdgeFromConnection(connection: Connection | Edge, kind: WorkflowDataKind): Edge {
  return {
    id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
    source: connection.source ?? "",
    target: connection.target ?? "",
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    label: formatDataKind(kind),
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: dataStroke(kind), strokeWidth: 1.8 },
    labelStyle: { fill: "#3f3f46", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
  };
}

function executionEdgeWithState(edge: Edge, step: number): Edge {
  const sourceIndex = executionTemplates.findIndex((template) => template.id === edge.source);
  const active = sourceIndex >= 0 && sourceIndex < step;
  return {
    ...edge,
    animated: active,
    style: {
      ...(edge.style ?? {}),
      opacity: active ? 1 : 0.38,
      strokeWidth: active ? 2.2 : 1.4,
    },
  };
}

function compatibleExecutionConnection(connection: Connection | Edge): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return false;
  }
  const sourcePort = findTemplatePort(connection.source, connection.sourceHandle, "out");
  const targetPort = findTemplatePort(connection.target, connection.targetHandle, "in");
  return Boolean(sourcePort && targetPort && sourcePort.kind === targetPort.kind);
}

function findTemplatePort(nodeId: string | null | undefined, handle: string | null | undefined, direction: "in" | "out"): ExecutionPort | null {
  if (!nodeId || !handle) {
    return null;
  }
  const parsed = parseHandleId(handle);
  if (!parsed || parsed.direction !== direction) {
    return null;
  }
  const template = executionTemplates.find((candidate) => candidate.id === nodeId);
  const ports = direction === "in" ? template?.inputs : template?.outputs;
  return ports?.find((candidate) => candidate.id === parsed.portId && candidate.kind === parsed.kind) ?? null;
}

function portIdFromPacket(nodeId: string, direction: "in" | "out", kind: WorkflowDataKind): string {
  const template = executionTemplates.find((candidate) => candidate.id === nodeId);
  const ports = direction === "in" ? template?.inputs : template?.outputs;
  return ports?.find((candidate) => candidate.kind === kind)?.id ?? kind;
}

function handleId(direction: "in" | "out", kind: WorkflowDataKind, portId: string): string {
  return `${direction}|${portId}|${kind}`;
}

function parseHandleId(handle: string): { direction: "in" | "out"; portId: string; kind: WorkflowDataKind } | null {
  const [direction, portId, kind] = handle.split("|");
  if ((direction !== "in" && direction !== "out") || !portId || !isWorkflowDataKind(kind)) {
    return null;
  }
  return { direction, portId, kind };
}

function isWorkflowDataKind(value: string | undefined): value is WorkflowDataKind {
  return [
    "run_config",
    "source_media",
    "video_metadata",
    "video_frame",
    "audio_frame",
    "audio_wav",
    "scene_result",
    "video_observation",
    "model_prediction",
    "audio_feature",
    "audio_event",
    "transcript_segment",
    "text_event",
    "data_record",
    "data_bucket",
    "json_report",
    "dashboard_view",
  ].includes(value ?? "");
}

function port(id: string, label: string, kind: WorkflowDataKind): ExecutionPort {
  return { id, label, kind };
}

function packet(
  kind: WorkflowDataKind,
  label: string,
  count: number,
  summary: string,
  detail: string,
): ExecutionDataPacket {
  return { kind, label, count, summary, detail };
}

function workflowInputSummary(form: WorkflowFormSnapshot): string {
  const source = form.sourceMode === "url" ? form.url || "URL missing" : form.input || "file missing";
  const frameLimit = form.maxFrames.trim() ? `max ${form.maxFrames.trim()} frames` : "all frames";
  return `${source} | threshold ${form.sceneThreshold} | sample every ${form.visualSampleEvery} | ${frameLimit}`;
}

function executionHeaderClass(tone: ExecutionTone): string {
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

function dataTone(kind: WorkflowDataKind): ExecutionTone {
  switch (kind) {
    case "source_media":
    case "json_report":
    case "dashboard_view":
      return "sky";
    case "video_metadata":
    case "video_frame":
      return "amber";
    case "scene_result":
      return "emerald";
    case "video_observation":
    case "model_prediction":
      return "violet";
    case "audio_frame":
    case "audio_wav":
    case "audio_feature":
    case "audio_event":
      return "cyan";
    case "transcript_segment":
      return "indigo";
    case "text_event":
      return "fuchsia";
    case "data_record":
    case "data_bucket":
      return "slate";
    case "run_config":
      return "zinc";
  }
}

function executionToneDot(tone: ExecutionTone): string {
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

function dataBadgeClass(kind: WorkflowDataKind): string {
  switch (dataTone(kind)) {
    case "sky":
      return "bg-sky-100 text-sky-800";
    case "rose":
      return "bg-rose-100 text-rose-800";
    case "amber":
      return "bg-amber-100 text-amber-800";
    case "emerald":
      return "bg-emerald-100 text-emerald-800";
    case "violet":
      return "bg-violet-100 text-violet-800";
    case "cyan":
      return "bg-cyan-100 text-cyan-800";
    case "indigo":
      return "bg-indigo-100 text-indigo-800";
    case "fuchsia":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "slate":
      return "bg-slate-100 text-slate-800";
    case "zinc":
      return "bg-zinc-100 text-zinc-800";
  }
}

function dataStroke(kind: WorkflowDataKind): string {
  switch (dataTone(kind)) {
    case "sky":
      return "#0ea5e9";
    case "rose":
      return "#f43f5e";
    case "amber":
      return "#f59e0b";
    case "emerald":
      return "#10b981";
    case "violet":
      return "#8b5cf6";
    case "cyan":
      return "#06b6d4";
    case "indigo":
      return "#6366f1";
    case "fuchsia":
      return "#d946ef";
    case "slate":
      return "#64748b";
    case "zinc":
      return "#52525b";
  }
}

function statusClass(status: ExecutionStatus): string {
  switch (status) {
    case "waiting":
      return "rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500";
    case "processing":
      return "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800";
    case "complete":
      return "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800";
  }
}

function coverageBadgeClass(status: string): string {
  switch (status) {
    case "routed":
      return "rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800";
    case "visualized":
      return "rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-800";
    case "ignored":
      return "rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700";
    default:
      return "rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-800";
  }
}

function formatDataKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSeconds(value?: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${value.toFixed(2)}s`;
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M6.5 4.9v10.2c0 .6.7 1 1.2.6l7.4-5.1c.4-.3.4-.9 0-1.2L7.7 4.3c-.5-.4-1.2 0-1.2.6Z" />
    </svg>
  );
}

function StepIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M5 4.5v11" strokeLinecap="round" />
      <path d="m8 5 6 5-6 5V5Z" fill="currentColor" stroke="none" />
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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="m5 5 10 10" strokeLinecap="round" />
      <path d="m15 5-10 10" strokeLinecap="round" />
    </svg>
  );
}
