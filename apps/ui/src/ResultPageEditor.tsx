import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  AssetSummary,
  CollectionDashboard,
  CollectionObjectBrowser,
  CollectionSummaryCards,
  DataBucketOverview,
  EventList,
  FlattenedCollectionTable,
  ModelObservationGrid,
  ObservationList,
  ResultPersistencePanel,
  ScenePanel,
  SourceSummary,
  SplitPlanTable,
  TranscriptPanel,
  VideoSummaryCards,
  type StudioReport,
  type YoutubeVideoReport,
} from "./index";
import { isYoutubeCollectionReport, isYoutubeVideoReport } from "./api/client";

export type DashboardWidgetId =
  | "summary"
  | "source-assets"
  | "scenes"
  | "observations"
  | "transcript"
  | "audio-events"
  | "text-events"
  | "data-buckets"
  | "collection-summary"
  | "collection-browser"
  | "collection-table"
  | "result-delivery"
  | "split-plan"
  | "diagnostics";

type DashboardSplitDirection = "row" | "column";
type DropSide = "top" | "right" | "bottom" | "left";

export type DashboardLayout =
  | { type: "widget"; id: DashboardWidgetId }
  | {
      type: "split";
      id: string;
      direction: DashboardSplitDirection;
      sizes: number[];
      children: DashboardLayout[];
    };

type DashboardDataKind =
  | "video_metadata"
  | "scene_result"
  | "video_observation"
  | "audio_event"
  | "audio_feature"
  | "audio_frame"
  | "audio_wav"
  | "transcript_segment"
  | "text_event"
  | "data_record"
  | "data_bucket"
  | "model_prediction"
  | "video_frame"
  | "json_report"
  | "collection_manifest"
  | "collection_item"
  | "collection_report"
  | "collection_table";

interface DragPayload {
  source: "palette" | "layout";
  widgetId: DashboardWidgetId;
}

const widgetOptions: Array<{ id: DashboardWidgetId; label: string; dataKinds: DashboardDataKind[] }> = [
  { id: "summary", label: "Summary", dataKinds: ["video_metadata", "scene_result"] },
  { id: "source-assets", label: "Source + Assets", dataKinds: ["json_report"] },
  { id: "scenes", label: "Scenes", dataKinds: ["scene_result"] },
  { id: "observations", label: "Observations", dataKinds: ["video_observation"] },
  { id: "transcript", label: "Transcript", dataKinds: ["transcript_segment"] },
  { id: "audio-events", label: "Audio Events", dataKinds: ["audio_event"] },
  { id: "text-events", label: "Text Events", dataKinds: ["text_event"] },
  { id: "data-buckets", label: "Data Buckets", dataKinds: ["data_bucket"] },
  { id: "collection-summary", label: "Collection Summary", dataKinds: ["collection_report"] },
  { id: "collection-browser", label: "Collection Browser", dataKinds: ["collection_item"] },
  { id: "collection-table", label: "Collection Table", dataKinds: ["collection_table"] },
  { id: "result-delivery", label: "Save Results", dataKinds: ["json_report"] },
  { id: "split-plan", label: "Split Plan", dataKinds: ["scene_result"] },
  {
    id: "diagnostics",
    label: "Diagnostics",
    dataKinds: ["video_frame", "audio_frame", "audio_wav", "model_prediction", "audio_feature", "data_record"],
  },
];

const WIDGET_DRAG_TYPE = "application/x-video-analysis-result-widget";
const MIN_SPLIT_SIZE = 0.12;
let nextSplitId = 0;

export const defaultDashboardLayout: DashboardLayout = {
  type: "split",
  id: "default-root",
  direction: "row",
  sizes: [1, 1],
  children: [
    {
      type: "split",
      id: "default-left-column",
      direction: "column",
      sizes: [1, 1, 1],
      children: [{ type: "widget", id: "summary" }, { type: "widget", id: "observations" }, { type: "widget", id: "audio-events" }],
    },
    {
      type: "split",
      id: "default-right-column",
      direction: "column",
      sizes: [1, 1, 1],
      children: [{ type: "widget", id: "scenes" }, { type: "widget", id: "transcript" }, { type: "widget", id: "data-buckets" }],
    },
  ],
};

export const defaultDashboardWidgets = defaultDashboardLayout;

export function ResultPageEditor({
  report,
  layout,
  onLayoutChange,
}: {
  report: StudioReport;
  layout: DashboardLayout;
  onLayoutChange: (layout: DashboardLayout) => void;
}) {
  const activeWidgetIds = useMemo(() => widgetIdsForLayout(layout), [layout]);
  const inactiveOptions = widgetOptions.filter((option) => !activeWidgetIds.includes(option.id));
  const visibleCount = activeWidgetIds.length;
  const [currentDragPayload, setCurrentDragPayload] = useState<DragPayload | null>(null);

  function handlePaletteDragStart(event: ReactDragEvent<HTMLElement>, widgetId: DashboardWidgetId) {
    const payload: DragPayload = { source: "palette", widgetId };
    setCurrentDragPayload(payload);
    setDragPayload(event, payload);
  }

  function handleWidgetDragStart(event: ReactDragEvent<HTMLElement>, widgetId: DashboardWidgetId) {
    const payload: DragPayload = { source: "layout", widgetId };
    setCurrentDragPayload(payload);
    setDragPayload(event, payload);
  }

  function handleDragEnd() {
    setCurrentDragPayload(null);
  }

  function handleDrop(targetId: DashboardWidgetId, side: DropSide, event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();

    const payload = getDragPayload(event) ?? currentDragPayload;
    setCurrentDragPayload(null);
    if (!payload || payload.widgetId === targetId) {
      return;
    }
    if (payload.source === "palette" && activeWidgetIds.includes(payload.widgetId)) {
      return;
    }

    const targetLayout = payload.source === "layout" ? removeWidget(layout, payload.widgetId) : layout;
    if (!targetLayout || !containsWidget(targetLayout, targetId)) {
      return;
    }
    onLayoutChange(insertWidget(targetLayout, targetId, payload.widgetId, side));
  }

  function handleRemove(widgetId: DashboardWidgetId) {
    const nextLayout = removeWidget(layout, widgetId);
    if (nextLayout) {
      onLayoutChange(nextLayout);
    }
  }

  function handleSplitResize(
    path: number[],
    dividerIndex: number,
    direction: DashboardSplitDirection,
    containerRef: RefObject<HTMLDivElement | null>,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const container = containerRef.current;
    const split = getSplitAtPath(layout, path);
    if (!container || !split) {
      return;
    }

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const totalPixels = direction === "row" ? rect.width : rect.height;
    if (totalPixels <= 0) {
      return;
    }

    const startPointer = direction === "row" ? event.clientX : event.clientY;
    const startSizes = normalizeSizes(split.sizes, split.children.length);
    const pairTotal = startSizes[dividerIndex] + startSizes[dividerIndex + 1];
    const minSize = Math.min(pairTotal / 2, MIN_SPLIT_SIZE);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const nextPointer = direction === "row" ? moveEvent.clientX : moveEvent.clientY;
      const delta = (nextPointer - startPointer) / totalPixels;
      const first = clamp(startSizes[dividerIndex] + delta, minSize, pairTotal - minSize);
      const nextSizes = [...startSizes];
      nextSizes[dividerIndex] = first;
      nextSizes[dividerIndex + 1] = pairTotal - first;
      onLayoutChange(updateSplitSizes(layout, path, nextSizes));
    }

    function stopResize() {
      window.removeEventListener("pointermove", handlePointerMove);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Result Page Editor</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {visibleCount} visible components | {dashboardDataKindsForWidgets(layout).length} data types covered
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {inactiveOptions.length === 0 ? (
                <span className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-zinc-500">
                  All components placed
                </span>
              ) : (
                inactiveOptions.map((option) => (
                  <span
                    key={option.id}
                    draggable
                    className="inline-flex h-9 cursor-grab items-center rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 active:cursor-grabbing"
                    onDragStart={(event) => handlePaletteDragStart(event, option.id)}
                    onDragEnd={handleDragEnd}
                    title={`Drag ${option.label}`}
                  >
                    {option.label}
                  </span>
                ))
              )}
            </div>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={() => onLayoutChange(defaultDashboardLayout)}
              title="Reset layout"
            >
              <RefreshIcon className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="result-layout-tree">
        <DashboardLayoutNode
          node={layout}
          path={[]}
          report={report}
          canRemove={visibleCount > 1}
          currentDragPayload={currentDragPayload}
          onDragWidget={handleWidgetDragStart}
          onDragEnd={handleDragEnd}
          onDropWidget={handleDrop}
          onRemoveWidget={handleRemove}
          onResizeSplit={handleSplitResize}
        />
      </div>
    </section>
  );
}

export function dashboardDataKindsForWidgets(layout: DashboardLayout): string[] {
  return Array.from(
    new Set(
      widgetIdsForLayout(layout).flatMap(
        (widgetId) => widgetOptions.find((option) => option.id === widgetId)?.dataKinds ?? [],
      ),
    ),
  );
}

export function addDashboardWidgetForDataKind(
  dataKind: string,
  layout: DashboardLayout,
  onLayoutChange: (layout: DashboardLayout) => void,
) {
  const option = widgetOptions.find((candidate) => candidate.dataKinds.includes(dataKind as DashboardDataKind));
  if (!option || containsWidget(layout, option.id)) {
    return;
  }

  const firstWidgetId = widgetIdsForLayout(layout)[0];
  onLayoutChange(firstWidgetId ? insertWidget(layout, firstWidgetId, option.id, "right") : widgetNode(option.id));
}

function DashboardLayoutNode({
  node,
  path,
  report,
  canRemove,
  currentDragPayload,
  onDragWidget,
  onDragEnd,
  onDropWidget,
  onRemoveWidget,
  onResizeSplit,
}: {
  node: DashboardLayout;
  path: number[];
  report: StudioReport;
  canRemove: boolean;
  currentDragPayload: DragPayload | null;
  onDragWidget: (event: ReactDragEvent<HTMLElement>, widgetId: DashboardWidgetId) => void;
  onDragEnd: () => void;
  onDropWidget: (targetId: DashboardWidgetId, side: DropSide, event: ReactDragEvent<HTMLElement>) => void;
  onRemoveWidget: (widgetId: DashboardWidgetId) => void;
  onResizeSplit: (
    path: number[],
    dividerIndex: number,
    direction: DashboardSplitDirection,
    containerRef: RefObject<HTMLDivElement | null>,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
}) {
  if (node.type === "widget") {
    return (
      <ResultWidgetPanel
        widgetId={node.id}
        report={report}
        canRemove={canRemove}
        currentDragPayload={currentDragPayload}
        onDragWidget={onDragWidget}
        onDragEnd={onDragEnd}
        onDropWidget={onDropWidget}
        onRemoveWidget={onRemoveWidget}
      />
    );
  }

  return (
    <SplitPane
      node={node}
      path={path}
      report={report}
      canRemove={canRemove}
      currentDragPayload={currentDragPayload}
      onDragWidget={onDragWidget}
      onDragEnd={onDragEnd}
      onDropWidget={onDropWidget}
      onRemoveWidget={onRemoveWidget}
      onResizeSplit={onResizeSplit}
    />
  );
}

function SplitPane({
  node,
  path,
  report,
  canRemove,
  currentDragPayload,
  onDragWidget,
  onDragEnd,
  onDropWidget,
  onRemoveWidget,
  onResizeSplit,
}: {
  node: Extract<DashboardLayout, { type: "split" }>;
  path: number[];
  report: StudioReport;
  canRemove: boolean;
  currentDragPayload: DragPayload | null;
  onDragWidget: (event: ReactDragEvent<HTMLElement>, widgetId: DashboardWidgetId) => void;
  onDragEnd: () => void;
  onDropWidget: (targetId: DashboardWidgetId, side: DropSide, event: ReactDragEvent<HTMLElement>) => void;
  onRemoveWidget: (widgetId: DashboardWidgetId) => void;
  onResizeSplit: (
    path: number[],
    dividerIndex: number,
    direction: DashboardSplitDirection,
    containerRef: RefObject<HTMLDivElement | null>,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
}) {
  const splitRef = useRef<HTMLDivElement | null>(null);
  const sizes = normalizeSizes(node.sizes, node.children.length);

  return (
    <div ref={splitRef} className={`result-split result-split-${node.direction}`}>
      {node.children.map((child, index) => (
        <Fragment key={layoutNodeKey(child, index)}>
          <div className="result-pane" style={resultPaneStyle(sizes[index])}>
            <DashboardLayoutNode
              node={child}
              path={[...path, index]}
              report={report}
              canRemove={canRemove}
              currentDragPayload={currentDragPayload}
              onDragWidget={onDragWidget}
              onDragEnd={onDragEnd}
              onDropWidget={onDropWidget}
              onRemoveWidget={onRemoveWidget}
              onResizeSplit={onResizeSplit}
            />
          </div>
          {index < node.children.length - 1 && (
            <div
              className={`result-split-divider result-split-divider-${node.direction}`}
              onPointerDown={(event) => onResizeSplit(path, index, node.direction, splitRef, event)}
              role="separator"
              aria-orientation={node.direction === "row" ? "vertical" : "horizontal"}
              title="Resize components"
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function ResultWidgetPanel({
  widgetId,
  report,
  canRemove,
  currentDragPayload,
  onDragWidget,
  onDragEnd,
  onDropWidget,
  onRemoveWidget,
}: {
  widgetId: DashboardWidgetId;
  report: StudioReport;
  canRemove: boolean;
  currentDragPayload: DragPayload | null;
  onDragWidget: (event: ReactDragEvent<HTMLElement>, widgetId: DashboardWidgetId) => void;
  onDragEnd: () => void;
  onDropWidget: (targetId: DashboardWidgetId, side: DropSide, event: ReactDragEvent<HTMLElement>) => void;
  onRemoveWidget: (widgetId: DashboardWidgetId) => void;
}) {
  const [dropSide, setDropSide] = useState<DropSide | null>(null);

  return (
    <section
      className="result-component rounded-lg border border-zinc-200 bg-white shadow-sm"
      onDragOver={(event) => {
        const activePayload = currentDragPayload ?? getDragPayload(event);
        if (activePayload?.widgetId === widgetId) {
          setDropSide(null);
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = activePayload?.source === "layout" ? "move" : "copy";
        setDropSide(getDropSide(event, event.currentTarget));
      }}
      onDragLeave={(event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
          setDropSide(null);
        }
      }}
      onDrop={(event) => {
        const side = getDropSide(event, event.currentTarget);
        setDropSide(null);
        onDropWidget(widgetId, side, event);
      }}
    >
      {dropSide && <div className={`result-drop-highlight result-drop-highlight-${dropSide}`} />}
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-zinc-200 px-3 text-sm font-medium text-zinc-800">
        <div
          draggable
          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
          onDragStart={(event) => onDragWidget(event, widgetId)}
          onDragEnd={onDragEnd}
          title="Move component"
        >
          <GripIcon className="h-4 w-4 shrink-0 text-zinc-400" />
          <span className="truncate">{widgetLabel(widgetId)}</span>
        </div>
        <button
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-300"
          onClick={() => onRemoveWidget(widgetId)}
          disabled={!canRemove}
          title="Remove component"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{renderWidget(widgetId, report)}</div>
    </section>
  );
}

function getDropSide(event: ReactDragEvent<HTMLElement>, element: HTMLElement): DropSide {
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const distances: Record<DropSide, number> = {
    top: y,
    right: rect.width - x,
    bottom: rect.height - y,
    left: x,
  };

  return (Object.entries(distances) as Array<[DropSide, number]>).reduce((nearest, candidate) =>
    candidate[1] < nearest[1] ? candidate : nearest,
  )[0];
}

function setDragPayload(event: ReactDragEvent<HTMLElement>, payload: DragPayload) {
  const serialized = JSON.stringify(payload);
  event.dataTransfer.effectAllowed = payload.source === "palette" ? "copy" : "move";
  event.dataTransfer.setData(WIDGET_DRAG_TYPE, serialized);
  event.dataTransfer.setData("text/plain", payload.widgetId);
}

function getDragPayload(event: ReactDragEvent<HTMLElement>): DragPayload | null {
  const serialized = event.dataTransfer.getData(WIDGET_DRAG_TYPE);
  if (!serialized) {
    return null;
  }

  try {
    const payload = JSON.parse(serialized) as DragPayload;
    return widgetOptions.some((option) => option.id === payload.widgetId) ? payload : null;
  } catch {
    return null;
  }
}

function widgetNode(widgetId: DashboardWidgetId): DashboardLayout {
  return { type: "widget", id: widgetId };
}

function insertWidget(
  layout: DashboardLayout,
  targetId: DashboardWidgetId,
  widgetId: DashboardWidgetId,
  side: DropSide,
): DashboardLayout {
  return normalizeLayout(insertWidgetRecursive(layout, targetId, widgetId, side).layout);
}

function insertWidgetRecursive(
  layout: DashboardLayout,
  targetId: DashboardWidgetId,
  widgetId: DashboardWidgetId,
  side: DropSide,
): { layout: DashboardLayout; inserted: boolean } {
  if (layout.type === "widget") {
    if (layout.id !== targetId) {
      return { layout, inserted: false };
    }

    const direction = side === "left" || side === "right" ? "row" : "column";
    const children =
      side === "left" || side === "top" ? [widgetNode(widgetId), layout] : [layout, widgetNode(widgetId)];
    return {
      layout: {
        type: "split",
        id: createSplitId(),
        direction,
        sizes: [1, 1],
        children,
      },
      inserted: true,
    };
  }

  const children = [...layout.children];
  for (let index = 0; index < children.length; index += 1) {
    const result = insertWidgetRecursive(children[index], targetId, widgetId, side);
    if (result.inserted) {
      children[index] = result.layout;
      return { layout: { ...layout, children }, inserted: true };
    }
  }

  return { layout, inserted: false };
}

function removeWidget(layout: DashboardLayout, widgetId: DashboardWidgetId): DashboardLayout | null {
  if (layout.type === "widget") {
    return layout.id === widgetId ? null : layout;
  }

  const children = layout.children
    .map((child) => removeWidget(child, widgetId))
    .filter((child): child is DashboardLayout => child !== null);

  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }

  return normalizeLayout({ ...layout, children, sizes: normalizeSizes(layout.sizes, children.length) });
}

function normalizeLayout(layout: DashboardLayout): DashboardLayout {
  if (layout.type === "widget") {
    return layout;
  }

  const children = layout.children.map(normalizeLayout);

  if (children.length === 1) {
    return children[0];
  }

  return {
    ...layout,
    children,
    sizes: normalizeSizes(layout.sizes, children.length),
  };
}

function updateSplitSizes(layout: DashboardLayout, path: number[], sizes: number[]): DashboardLayout {
  if (path.length === 0) {
    return layout.type === "split" ? { ...layout, sizes } : layout;
  }
  if (layout.type === "widget") {
    return layout;
  }

  const [index, ...rest] = path;
  return {
    ...layout,
    children: layout.children.map((child, childIndex) =>
      childIndex === index ? updateSplitSizes(child, rest, sizes) : child,
    ),
  };
}

function getSplitAtPath(layout: DashboardLayout, path: number[]): Extract<DashboardLayout, { type: "split" }> | null {
  if (path.length === 0) {
    return layout.type === "split" ? layout : null;
  }
  if (layout.type === "widget") {
    return null;
  }

  const [index, ...rest] = path;
  return getSplitAtPath(layout.children[index], rest);
}

function containsWidget(layout: DashboardLayout, widgetId: DashboardWidgetId): boolean {
  return layout.type === "widget"
    ? layout.id === widgetId
    : layout.children.some((child) => containsWidget(child, widgetId));
}

function widgetIdsForLayout(layout: DashboardLayout): DashboardWidgetId[] {
  return layout.type === "widget" ? [layout.id] : layout.children.flatMap(widgetIdsForLayout);
}

function normalizeSizes(sizes: number[], count: number): number[] {
  const next = Array.from({ length: count }, (_, index) => (Number.isFinite(sizes[index]) ? sizes[index] : 1));
  const total = next.reduce((sum, size) => sum + size, 0);
  return total > 0 ? next.map((size) => size / total) : next.map(() => 1 / count);
}

function resultPaneStyle(size: number): CSSProperties {
  return {
    flexBasis: `${Math.max(0, size) * 100}%`,
    flexGrow: size,
    flexShrink: 1,
  };
}

function layoutNodeKey(node: DashboardLayout, fallback: number): string {
  return node.type === "widget" ? node.id : node.id || `split-${fallback}`;
}

function createSplitId(): string {
  nextSplitId += 1;
  return `split-${nextSplitId}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function renderWidget(widgetId: DashboardWidgetId, report: StudioReport) {
  if (isYoutubeCollectionReport(report)) {
    switch (widgetId) {
      case "collection-summary":
      case "summary":
        return <CollectionSummaryCards report={report} />;
      case "collection-browser":
        return <CollectionObjectBrowser report={report} />;
      case "collection-table":
      case "data-buckets":
        return <FlattenedCollectionTable report={report} />;
      case "result-delivery":
        return (
          <ResultPersistencePanel
            result={report}
            defaultFilename={basename(report.assets.report_path) || "collection-analysis.json"}
            defaultLabel={report.collection.title ?? "Collection analysis"}
          />
        );
      default:
        return <CollectionDashboard report={report} />;
    }
  }
  if (!isYoutubeVideoReport(report)) {
    return null;
  }
  switch (widgetId) {
    case "summary":
      return <VideoSummaryCards video={report.video} />;
    case "source-assets":
      return (
        <div className="grid gap-4 2xl:grid-cols-2">
          <SourceSummary source={report.source} />
          <AssetSummary assets={report.assets} />
        </div>
      );
    case "scenes":
      return <ScenePanel scenes={report.video.scenes} />;
    case "observations":
      return (
        <div className="grid gap-4 2xl:grid-cols-2">
          <ObservationList observations={report.video.observations} title="Video Observations" />
          <ModelObservationGrid observations={report.video.observations} />
        </div>
      );
    case "transcript":
      return <TranscriptPanel transcription={report.transcription} />;
    case "audio-events":
      return <EventList events={report.audio.events} title={`Audio Events (${report.audio.status})`} />;
    case "text-events":
      return <EventList events={report.text.events} title={`Text Events (${report.text.status})`} />;
    case "data-buckets":
      return <DataBucketOverview buckets={report.data_buckets} />;
    case "collection-summary":
    case "collection-browser":
    case "collection-table":
      return <DiagnosticsPanel report={report} />;
    case "result-delivery":
      return (
        <ResultPersistencePanel
          result={report}
          defaultFilename={basename(report.assets.report_path) || "analysis.json"}
          defaultLabel={basename(report.source.local_video) || "Analysis result"}
        />
      );
    case "split-plan":
      return <SplitPlanTable scenes={report.video.scenes} videoName={basename(report.source.local_video)} />;
    case "diagnostics":
      return <DiagnosticsPanel report={report} />;
  }
}

function DiagnosticsPanel({ report }: { report: YoutubeVideoReport }) {
  const recordCount = report.data_buckets.reduce((sum, bucket) => sum + bucket.records, 0);
  const modelCount = report.video.observations.filter((observation) =>
    ["object-command", "ocr-command", "scene-classifier"].includes(observation.analyzer),
  ).length;
  const rows = [
    ["Video frames", formatNumber(report.video.frames_processed), "decoded frames"],
    ["Audio frames", formatNumber(report.audio.frames_processed), "decoded audio frames"],
    ["Audio wav", report.assets.audio_wav ? "1" : "0", report.assets.audio_wav ?? "not exported"],
    ["Raw model predictions", formatNumber(modelCount), "external command responses"],
    ["Audio features", formatNumber(report.audio.frames_processed), "energy windows"],
    ["Data records", formatNumber(recordCount), "bucket input records"],
  ];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Diagnostics</h2>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map(([label, value, detail]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 px-4 py-3 text-sm">
            <div>
              <div className="font-medium text-zinc-900">{label}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>
            </div>
            <div className="text-right font-semibold tabular-nums text-zinc-950">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function widgetLabel(widgetId: DashboardWidgetId): string {
  return widgetOptions.find((option) => option.id === widgetId)?.label ?? widgetId;
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="7" cy="5" r="1.2" />
      <circle cx="13" cy="5" r="1.2" />
      <circle cx="7" cy="10" r="1.2" />
      <circle cx="13" cy="10" r="1.2" />
      <circle cx="7" cy="15" r="1.2" />
      <circle cx="13" cy="15" r="1.2" />
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
