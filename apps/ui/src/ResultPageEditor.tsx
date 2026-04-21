import { useEffect, useMemo, useRef, useState } from "react";
import { createSwapy, utils, type SlotItemMapArray, type Swapy } from "swapy";
import {
  AssetSummary,
  DataBucketOverview,
  EventList,
  ModelObservationGrid,
  ObservationList,
  ScenePanel,
  SourceSummary,
  SplitPlanTable,
  TranscriptPanel,
  VideoSummaryCards,
  type YoutubeVideoReport,
} from "./index";

export type DashboardWidgetId =
  | "summary"
  | "source-assets"
  | "scenes"
  | "observations"
  | "transcript"
  | "audio-events"
  | "text-events"
  | "data-buckets"
  | "split-plan"
  | "diagnostics";

export interface DashboardWidget {
  id: DashboardWidgetId;
}

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
  | "json_report";

const widgetOptions: Array<{ id: DashboardWidgetId; label: string; dataKinds: DashboardDataKind[] }> = [
  { id: "summary", label: "Summary", dataKinds: ["video_metadata", "scene_result"] },
  { id: "source-assets", label: "Source + Assets", dataKinds: ["json_report"] },
  { id: "scenes", label: "Scenes", dataKinds: ["scene_result"] },
  { id: "observations", label: "Observations", dataKinds: ["video_observation"] },
  { id: "transcript", label: "Transcript", dataKinds: ["transcript_segment"] },
  { id: "audio-events", label: "Audio Events", dataKinds: ["audio_event"] },
  { id: "text-events", label: "Text Events", dataKinds: ["text_event"] },
  { id: "data-buckets", label: "Data Buckets", dataKinds: ["data_bucket"] },
  { id: "split-plan", label: "Split Plan", dataKinds: ["scene_result"] },
  {
    id: "diagnostics",
    label: "Diagnostics",
    dataKinds: ["video_frame", "audio_frame", "audio_wav", "model_prediction", "audio_feature", "data_record"],
  },
];

export const defaultDashboardWidgets: DashboardWidget[] = [
  { id: "summary" },
  { id: "scenes" },
  { id: "observations" },
  { id: "transcript" },
  { id: "audio-events" },
  { id: "data-buckets" },
];

export function ResultPageEditor({
  report,
  widgets,
  onWidgetsChange,
}: {
  report: YoutubeVideoReport;
  widgets: DashboardWidget[];
  onWidgetsChange: (widgets: DashboardWidget[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swapyRef = useRef<Swapy | null>(null);
  const [slotItemMap, setSlotItemMap] = useState<SlotItemMapArray>(() => utils.initSlotItemMap(widgets, "id"));
  const [selectedWidget, setSelectedWidget] = useState<DashboardWidgetId>("source-assets");

  const slottedItems = useMemo(
    () => utils.toSlottedItems(widgets, "id", slotItemMap),
    [slotItemMap, widgets],
  );
  const inactiveOptions = widgetOptions.filter((option) => !widgets.some((widget) => widget.id === option.id));

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    swapyRef.current = createSwapy(containerRef.current, {
      animation: "spring",
      manualSwap: true,
      swapMode: "drop",
    });
    swapyRef.current.onSwap((event) => setSlotItemMap(event.newSlotItemMap.asArray));

    return () => {
      swapyRef.current?.destroy();
      swapyRef.current = null;
    };
  }, []);

  useEffect(() => {
    utils.dynamicSwapy(swapyRef.current, widgets, "id", slotItemMap, setSlotItemMap);
  }, [widgets]);

  useEffect(() => {
    if (!inactiveOptions.some((option) => option.id === selectedWidget) && inactiveOptions[0]) {
      setSelectedWidget(inactiveOptions[0].id);
    }
  }, [inactiveOptions, selectedWidget]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Result Page Editor</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {widgets.length} visible components | {dashboardDataKindsForWidgets(widgets).length} data types covered
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={selectedWidget}
              onChange={(event) => setSelectedWidget(event.target.value as DashboardWidgetId)}
              disabled={inactiveOptions.length === 0}
            >
              {inactiveOptions.length === 0 ? (
                <option value={selectedWidget}>All components</option>
              ) : (
                inactiveOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
              onClick={() => addWidget(selectedWidget, widgets, onWidgetsChange)}
              disabled={inactiveOptions.length === 0}
              title="Add component"
            >
              <PlusIcon className="h-4 w-4" />
              Add
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
              onClick={() => {
                onWidgetsChange(defaultDashboardWidgets);
                setSlotItemMap(utils.initSlotItemMap(defaultDashboardWidgets, "id"));
              }}
              title="Reset layout"
            >
              <RefreshIcon className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="grid gap-4 xl:grid-cols-2">
        {slottedItems.map(({ slotId, itemId, item }) => (
          <div
            key={slotId}
            data-swapy-slot={slotId}
            className="min-h-36 rounded-lg border border-dashed border-zinc-300 bg-zinc-100/60 p-2"
          >
            {item && (
              <div data-swapy-item={itemId} className="h-full rounded-lg bg-white shadow-sm">
                <div
                  data-swapy-handle
                  className="flex min-h-11 cursor-grab items-center justify-between gap-3 border-b border-zinc-200 px-3 text-sm font-medium text-zinc-800 active:cursor-grabbing"
                >
                  <span>{widgetLabel(item.id)}</span>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
                    onClick={() => onWidgetsChange(widgets.filter((widget) => widget.id !== item.id))}
                    title="Remove component"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-3">{renderWidget(item.id, report)}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function dashboardDataKindsForWidgets(widgets: DashboardWidget[]): string[] {
  return Array.from(
    new Set(
      widgets.flatMap((widget) => widgetOptions.find((option) => option.id === widget.id)?.dataKinds ?? []),
    ),
  );
}

export function addDashboardWidgetForDataKind(
  dataKind: string,
  widgets: DashboardWidget[],
  onWidgetsChange: (widgets: DashboardWidget[]) => void,
) {
  const option = widgetOptions.find((candidate) => candidate.dataKinds.includes(dataKind as DashboardDataKind));
  if (!option || widgets.some((widget) => widget.id === option.id)) {
    return;
  }
  onWidgetsChange([...widgets, { id: option.id }]);
}

function addWidget(
  widgetId: DashboardWidgetId,
  widgets: DashboardWidget[],
  onWidgetsChange: (widgets: DashboardWidget[]) => void,
) {
  if (widgets.some((widget) => widget.id === widgetId)) {
    return;
  }
  onWidgetsChange([...widgets, { id: widgetId }]);
}

function renderWidget(widgetId: DashboardWidgetId, report: YoutubeVideoReport) {
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

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" className={className}>
      <path d="M10 4v12" strokeLinecap="round" />
      <path d="M4 10h12" strokeLinecap="round" />
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
