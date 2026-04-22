import { useMemo, useState } from "react";

import type {
  CollectionItemReport,
  CollectionTableRow,
  YoutubeCollectionReport,
  YoutubeVideoReport,
} from "../types";
import { EventList, ObservationList, ScenePanel, VideoSummaryCards } from "../core";
import { DataBucketOverview } from "../data";
import { SourceSummary } from "../ingest";
import { ModelObservationGrid } from "../models";
import { Panel, EmptyState, StatCard } from "../shared/primitives";
import { formatBytes, formatNumber, formatSeconds } from "../shared/utils";
import { SplitPlanTable } from "../split";
import { TranscriptPanel } from "../use-cases";

type FlattenedMode = "videos" | "scenes" | "observations" | "transcript" | "audio_events" | "text_events" | "buckets";
type SortDirection = "asc" | "desc";

export function CollectionSummaryCards({ report }: { report: YoutubeCollectionReport }) {
  const downloadedBytes = report.items.reduce((sum, item) => {
    const records = item.report?.data_buckets.reduce((bucketSum, bucket) => bucketSum + bucket.estimated_bytes, 0) ?? 0;
    return sum + records;
  }, 0);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Discovered" value={formatNumber(report.collection.discovered_items)} tone="sky" />
      <StatCard label="Analyzed" value={formatNumber(report.collection.analyzed_items)} tone="emerald" />
      <StatCard label="Filtered" value={formatNumber(report.collection.filtered_items)} tone="amber" />
      <StatCard
        label="Duration"
        value={formatSeconds(report.collection.total_duration_seconds)}
        detail={formatBytes(downloadedBytes)}
        tone="violet"
      />
    </div>
  );
}

export function CollectionDashboard({ report }: { report: YoutubeCollectionReport }) {
  return (
    <section className="space-y-4">
      <CollectionSummaryCards report={report} />
      <CollectionObjectBrowser report={report} />
      <FlattenedCollectionTable report={report} />
    </section>
  );
}

export function CollectionObjectBrowser({ report }: { report: YoutubeCollectionReport }) {
  const firstAnalyzed = report.items.find((item) => item.report)?.item_id ?? report.items[0]?.item_id ?? null;
  const [selectedItemId, setSelectedItemId] = useState<string | null>(firstAnalyzed);
  const selectedItem = report.items.find((item) => item.item_id === selectedItemId) ?? report.items[0] ?? null;

  return (
    <Panel title="Collection Items" description={`${formatNumber(report.items.length)} stable items`}>
      {report.items.length === 0 ? (
        <EmptyState>No collection items</EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
          <ArrayTableWidget
            rows={collectionItemRows(report)}
            columns={[
              { key: "playlist_index", label: "#" },
              { key: "title", label: "Title" },
              { key: "status", label: "Status" },
            ]}
            selectedRowId={selectedItemId ?? undefined}
            onSelectRow={(row) => setSelectedItemId(row.item_id)}
          />
          <div className="min-w-0">
            {selectedItem ? (
              <CollectionItemDetail item={selectedItem} />
            ) : (
              <EmptyState>Select a collection item</EmptyState>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function CollectionItemDetail({ item }: { item: CollectionItemReport }) {
  if (!item.report) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4">
        <div className="text-sm font-semibold text-zinc-950">{item.title ?? item.item_id}</div>
        <div className="mt-1 text-sm text-zinc-600">{item.status}</div>
        {item.error && <p className="mt-3 text-sm text-rose-700">{item.error}</p>}
      </div>
    );
  }

  return <NestedVideoDashboard report={item.report} />;
}

export function FlattenedCollectionTable({ report }: { report: YoutubeCollectionReport }) {
  const [mode, setMode] = useState<FlattenedMode>("videos");
  const rows = useMemo(() => flattenedRowsForMode(report, mode), [report, mode]);
  const columns = columnsForMode(mode);

  return (
    <Panel title="Collection Table" description={`${formatNumber(rows.length)} ${mode.replace("_", " ")}`}>
      <div className="mb-3 inline-grid w-full grid-cols-2 rounded-lg border border-zinc-200 bg-zinc-100 p-1 sm:grid-cols-4 xl:grid-cols-7">
        {(["videos", "scenes", "observations", "transcript", "audio_events", "text_events", "buckets"] as FlattenedMode[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 ${
              mode === option ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950"
            }`}
            onClick={() => setMode(option)}
          >
            {option.replace("_", " ")}
          </button>
        ))}
      </div>
      <ArrayTableWidget rows={rows} columns={columns} />
    </Panel>
  );
}

export function ArrayTableWidget({
  rows,
  columns,
  selectedRowId,
  onSelectRow,
}: {
  rows: CollectionTableRow[];
  columns: Array<{ key: string; label: string }>;
  selectedRowId?: string;
  onSelectRow?: (row: CollectionTableRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    const filtered = normalizedQuery
      ? rows.filter((row) =>
          columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(normalizedQuery)),
        )
      : rows;
    return [...filtered].sort((left, right) => {
      const comparison = compareValues(left[sortKey], right[sortKey]);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [columns, normalizedQuery, rows, sortDirection, sortKey]);

  if (rows.length === 0) {
    return <EmptyState>No rows</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <input
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        value={query}
        placeholder="Filter rows"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left"
                    onClick={() => {
                      if (sortKey === column.key) {
                        setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                      } else {
                        setSortKey(column.key);
                        setSortDirection("asc");
                      }
                    }}
                  >
                    {column.label}
                    {sortKey === column.key && <span>{sortDirection === "asc" ? "up" : "down"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                className={`${onSelectRow ? "cursor-pointer hover:bg-zinc-50" : ""} ${
                  selectedRowId === row.id ? "bg-sky-50" : ""
                }`}
                onClick={() => onSelectRow?.(row)}
              >
                {columns.map((column) => (
                  <td key={column.key} className="max-w-[360px] truncate px-3 py-2 text-zinc-700">
                    {formatCell(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function collectionItemRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.map((item) => ({
    id: item.item_id,
    collection_id: report.collection.collection_id,
    item_id: item.item_id,
    youtube_id: item.youtube_id,
    title: item.title,
    kind: "collection_item",
    playlist_index: item.playlist_index,
    status: item.status,
    source_url: item.source_url,
    local_video: item.local_video,
    error: item.error,
  }));
}

export function collectionVideoRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.map((item) => ({
    id: `${item.item_id}:video`,
    collection_id: report.collection.collection_id,
    item_id: item.item_id,
    youtube_id: item.youtube_id,
    title: item.title,
    kind: "video",
    status: item.status,
    duration_seconds: item.report?.video.duration_seconds ?? null,
    frames_processed: item.report?.video.frames_processed ?? null,
    scenes: item.report?.video.scenes.length ?? null,
    observations: item.report?.video.observations.length ?? null,
  }));
}

export function collectionSceneRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.video.scenes.map((scene) => ({
      id: `${item.item_id}:scene:${scene.index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "scene",
      scene_index: scene.index,
      start_seconds: scene.start_seconds,
      end_seconds: scene.end_seconds,
      observations: scene.observations.length,
    })) ?? [],
  );
}

export function collectionObservationRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.video.observations.map((observation, index) => ({
      id: `${item.item_id}:observation:${index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "observation",
      analyzer: observation.analyzer,
      observation_kind: observation.kind,
      label: observation.label ?? observation.text ?? null,
      score: observation.score ?? null,
      timestamp_seconds: observation.timestamp_seconds ?? null,
      frame_index: observation.frame_index ?? null,
      scene_index: observation.scene_index ?? null,
    })) ?? [],
  );
}

export function collectionTranscriptRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.transcription.segments.map((segment) => ({
      id: `${item.item_id}:transcript:${segment.index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "transcript",
      segment_index: segment.index,
      start_seconds: segment.start_seconds ?? null,
      end_seconds: segment.end_seconds ?? null,
      text: segment.text,
    })) ?? [],
  );
}

function collectionAudioEventRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.audio.events.map((event, index) => ({
      id: `${item.item_id}:audio:${index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "audio_event",
      analyzer: event.analyzer,
      label: event.label,
      score: event.score ?? null,
      timestamp_seconds: event.timestamp_seconds ?? null,
    })) ?? [],
  );
}

function collectionTextEventRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.text.events.map((event, index) => ({
      id: `${item.item_id}:text:${index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "text_event",
      analyzer: event.analyzer,
      label: event.label,
      score: event.score ?? null,
      timestamp_seconds: event.timestamp_seconds ?? null,
    })) ?? [],
  );
}

function collectionBucketRows(report: YoutubeCollectionReport): CollectionTableRow[] {
  return report.items.flatMap((item) =>
    item.report?.data_buckets.map((bucket) => ({
      id: `${item.item_id}:bucket:${bucket.bucket_index}`,
      collection_id: report.collection.collection_id,
      item_id: item.item_id,
      youtube_id: item.youtube_id,
      title: item.title,
      kind: "bucket",
      bucket_index: bucket.bucket_index,
      records: bucket.records,
      estimated_bytes: bucket.estimated_bytes,
      streams: bucket.streams.length,
    })) ?? [],
  );
}

function flattenedRowsForMode(report: YoutubeCollectionReport, mode: FlattenedMode): CollectionTableRow[] {
  switch (mode) {
    case "videos":
      return collectionVideoRows(report);
    case "scenes":
      return collectionSceneRows(report);
    case "observations":
      return collectionObservationRows(report);
    case "transcript":
      return collectionTranscriptRows(report);
    case "audio_events":
      return collectionAudioEventRows(report);
    case "text_events":
      return collectionTextEventRows(report);
    case "buckets":
      return collectionBucketRows(report);
  }
}

function columnsForMode(mode: FlattenedMode): Array<{ key: string; label: string }> {
  const base = [
    { key: "item_id", label: "Item" },
    { key: "title", label: "Title" },
  ];
  switch (mode) {
    case "videos":
      return [...base, { key: "status", label: "Status" }, { key: "duration_seconds", label: "Duration" }, { key: "scenes", label: "Scenes" }];
    case "scenes":
      return [...base, { key: "scene_index", label: "Scene" }, { key: "start_seconds", label: "Start" }, { key: "end_seconds", label: "End" }];
    case "observations":
      return [...base, { key: "observation_kind", label: "Kind" }, { key: "label", label: "Label" }, { key: "score", label: "Score" }];
    case "transcript":
      return [...base, { key: "segment_index", label: "Segment" }, { key: "start_seconds", label: "Start" }, { key: "text", label: "Text" }];
    case "audio_events":
    case "text_events":
      return [...base, { key: "analyzer", label: "Analyzer" }, { key: "label", label: "Label" }, { key: "score", label: "Score" }];
    case "buckets":
      return [...base, { key: "bucket_index", label: "Bucket" }, { key: "records", label: "Records" }, { key: "estimated_bytes", label: "Bytes" }];
  }
}

function NestedVideoDashboard({ report }: { report: YoutubeVideoReport }) {
  return (
    <div className="space-y-4">
      <VideoSummaryCards video={report.video} />
      <SourceSummary source={report.source} />
      <ScenePanel scenes={report.video.scenes} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <ObservationList observations={report.video.observations} title="Video Observations" />
        <ModelObservationGrid observations={report.video.observations} />
      </div>
      <TranscriptPanel transcription={report.transcription} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <EventList events={report.audio.events} title={`Audio Events (${report.audio.status})`} />
        <EventList events={report.text.events} title={`Text Events (${report.text.status})`} />
      </div>
      <DataBucketOverview buckets={report.data_buckets} />
      <SplitPlanTable scenes={report.video.scenes} videoName={basename(report.source.local_video)} />
    </div>
  );
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function formatCell(value: unknown): string {
  if (value == null || value === "") {
    return "n/a";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? formatNumber(value) : value.toFixed(2);
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function basename(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  return last.replace(/\.[^.]+$/, "") || "video";
}
