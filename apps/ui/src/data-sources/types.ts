import type {
  DataSourceKind,
  DataSourceOrigin,
  DataSourceRecord,
  DataSourceUpsert,
  WorkflowSemanticKind,
  WorkflowTypeSpec,
} from "../api/client";
import {
  formatWorkflowTypeSpec,
  isWorkflowTypeSpec,
  validateWorkflowValue,
} from "../workflowTypeSpec";

export const legacyDataSourcesStorageKey = "video-analysis.dataSources.v1";
export const dataSourcesJsonFormat = "video-analysis.dataSources";
export const dataSourcesJsonVersion = 2;

type LegacyJsonSchemaScalar = "number" | "boolean" | "null" | "any";

type LegacyDataSourceSchema =
  | { type: "port"; portType: LegacyDataSourcePortType }
  | { type: "string"; semantic?: WorkflowSemanticKind }
  | { type: "binary"; mediaType: string; portType: LegacyDataSourcePortType; semantic?: WorkflowSemanticKind }
  | { type: "array"; items: LegacyDataSourceSchema; minItems?: number; maxItems?: number }
  | {
      type: "object";
      properties: Array<{ id?: string; name: string; schema: LegacyDataSourceSchema; required: boolean }>;
      additionalProperties?: boolean;
      semantic?: WorkflowSemanticKind;
    }
  | { type: "union"; variants: LegacyDataSourceSchema[] }
  | { type: LegacyJsonSchemaScalar };

type LegacyDataSourcePortType =
  | "string_value"
  | "template_string"
  | "youtube_url"
  | "youtube_collection_url"
  | "subtitle_file"
  | "audio_file"
  | "audio_wav"
  | "video_file"
  | "media_file"
  | "number_value"
  | "boolean_value"
  | "array_value"
  | "object_value"
  | "transcript"
  | "song_catalog"
  | "data_value"
  | "data_record"
  | "data_bucket"
  | "http_response";

interface LegacyDataSourceEntry {
  id: string;
  name: string;
  format?: string;
  kind?: string;
  type?: WorkflowTypeSpec | LegacyDataSourceSchema;
  location?: string;
  description?: string;
  tags?: string[];
  body?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportedDataSourceRecord {
  id: string;
  name: string;
  kind: DataSourceKind;
  type: WorkflowTypeSpec;
  location: string;
  description: string;
  tags: string[];
  body: string;
  origin: DataSourceOrigin;
}

export function dataSourceKindLabel(kind: DataSourceKind): string {
  switch (kind) {
    case "sqlite":
      return "SQLite DB";
    case "json":
      return "JSON";
    case "csv":
      return "CSV";
    case "txt":
      return "Text";
    case "folder":
      return "Folder";
    case "api":
      return "API";
    case "other":
      return "Other";
  }
}

export function editableInlineBody(kind: DataSourceKind): boolean {
  return kind === "json" || kind === "txt" || kind === "api";
}

export type DataSourcePopulationMode = "inline" | "location" | "metadata";

export interface DataSourcePopulationOption {
  value: DataSourcePopulationMode;
  label: string;
  description: string;
}

export function dataSourcePopulationOptions(kind: DataSourceKind): DataSourcePopulationOption[] {
  switch (kind) {
    case "json":
      return [
        {
          value: "inline",
          label: "Paste JSON",
          description: "Provide the JSON payload directly and validate it against the schema.",
        },
        {
          value: "location",
          label: "Use File Or URL",
          description: "Point the source at a JSON file or remote URL and keep the payload external.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Create the typed source now and decide how to populate it later.",
        },
      ];
    case "txt":
      return [
        {
          value: "inline",
          label: "Paste Text",
          description: "Enter the text contents directly in the catalog.",
        },
        {
          value: "location",
          label: "Use File Path",
          description: "Reference a text file and keep the contents outside the catalog.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Create the source now and attach contents later.",
        },
      ];
    case "api":
      return [
        {
          value: "location",
          label: "Use Endpoint",
          description: "Reference an API endpoint or route that will provide this schema.",
        },
        {
          value: "inline",
          label: "Paste Sample",
          description: "Store a representative JSON response inline as a sample payload.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Create the typed endpoint contract now and wire it up later.",
        },
      ];
    case "sqlite":
      return [
        {
          value: "location",
          label: "Use Database Path",
          description: "Reference a SQLite database file on disk.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Create the source contract now and connect the database later.",
        },
      ];
    case "csv":
      return [
        {
          value: "location",
          label: "Use CSV Path",
          description: "Reference a CSV file on disk or in the workspace.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Define the row shape now and attach a file later.",
        },
      ];
    case "folder":
      return [
        {
          value: "location",
          label: "Use Folder Path",
          description: "Reference a folder whose contents match this schema.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Define the folder contract now and pick the directory later.",
        },
      ];
    case "other":
      return [
        {
          value: "location",
          label: "Use External Reference",
          description: "Point the source at a path, URI, or other external system.",
        },
        {
          value: "metadata",
          label: "Define Later",
          description: "Capture only the typed contract for now.",
        },
      ];
  }
}

export function defaultDataSourcePopulationMode(kind: DataSourceKind): DataSourcePopulationMode {
  return dataSourcePopulationOptions(kind)[0]?.value ?? "metadata";
}

export function defaultDataSourceType(kind: DataSourceKind): WorkflowTypeSpec {
  switch (kind) {
    case "json":
    case "other":
      return { type: "any" };
    case "txt":
      return { type: "string" };
    case "sqlite":
    case "csv":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_record" };
    case "folder":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_bucket" };
    case "api":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_response" };
  }
}

export function normalizeDataSourceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateDataSourceId(value: string, existingIds: string[], currentId?: string): string | null {
  if (!value.trim()) {
    return "ID is required.";
  }
  if (!/^[a-z0-9_-]+$/.test(value.trim())) {
    return "ID must use lowercase letters, numbers, underscores, or hyphens.";
  }
  if (existingIds.some((candidate) => candidate === value.trim() && candidate !== currentId)) {
    return `ID ${value.trim()} already exists.`;
  }
  return null;
}

export function nextDataSourceId(existingIds: Iterable<string>, name = "data-source"): string {
  const ids = new Set(existingIds);
  const base = normalizeDataSourceId(name) || "data-source";
  if (!ids.has(base)) {
    return base;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!ids.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function normalizeTagText(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => {
      if (!token || seen.has(token)) {
        return false;
      }
      seen.add(token);
      return true;
    });
}

export function formatTags(tags: string[]): string {
  return tags.join(", ");
}

export function defaultDataSourceUpsert(existingIds: Iterable<string>, kind: DataSourceKind = "json"): DataSourceUpsert {
  const id = nextDataSourceId(existingIds);
  return {
    id,
    name: `Data Source ${id.replace(/^data-source-?/, "").replace(/-/g, " ").trim() || "1"}`.replace(/\s+/g, " ").trim(),
    kind,
    type: defaultDataSourceType(kind),
    location: "",
    description: "",
    tags: [],
    body: "",
  };
}

export function dataSourceToUpsert(record: DataSourceRecord): DataSourceUpsert {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    type: record.type,
    location: record.location,
    description: record.description,
    tags: [...record.tags],
    body: record.body,
  };
}

export function validateDataSourceBody(draft: DataSourceUpsert): string | null {
  const body = draft.body.trim();
  if (!body || !editableInlineBody(draft.kind)) {
    return null;
  }
  let payload: unknown;
  try {
    payload = draft.kind === "txt" ? draft.body : JSON.parse(draft.body);
  } catch (error) {
    return `Body is not valid ${draft.kind === "txt" ? "text" : "JSON"}: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (draft.kind === "txt") {
    return null;
  }
  const issue = validateWorkflowValue(draft.type, payload);
  if (!issue) {
    return null;
  }
  return `Body does not match type: expected ${issue.expected} at ${issue.path}, got ${issue.actual}.`;
}

export function downloadDataSourcesJson(dataSources: DataSourceRecord[]) {
  if (typeof document === "undefined") {
    return;
  }
  const exportedAt = new Date().toISOString();
  const payload = {
    format: dataSourcesJsonFormat,
    version: dataSourcesJsonVersion,
    exportedAt,
    dataSources,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `video-analysis-data-sources-${exportedAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function filterDataSources(dataSources: DataSourceRecord[], query: string): DataSourceRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return dataSources;
  }
  return dataSources.filter((record) =>
    [
      record.id,
      record.name,
      record.kind,
      formatWorkflowTypeSpec(record.type),
      record.location,
      record.description,
      record.origin.mode === "derived_view" ? record.origin.parent_id : "",
      ...record.tags,
    ]
      .join("\n")
      .toLowerCase()
      .includes(normalized),
  );
}

export function loadLegacyLocalDataSources(): ImportedDataSourceRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(legacyDataSourcesStorageKey);
    if (!raw) {
      return [];
    }
    return parseImportedDataSourcesJson(raw);
  } catch {
    return [];
  }
}

export function clearLegacyLocalDataSources() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(legacyDataSourcesStorageKey);
}

export function parseImportedDataSourcesJson(text: string): ImportedDataSourceRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }
  const candidates = importCandidates(parsed);
  if (!candidates.length) {
    throw new Error("No data sources found in JSON");
  }
  return candidates.map(normalizeImportedCandidate);
}

function importCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.dataSources)) {
      return record.dataSources;
    }
    if (Array.isArray(record.data_sources)) {
      return record.data_sources;
    }
    if (Array.isArray(record.entries)) {
      return record.entries;
    }
  }
  return [];
}

function normalizeImportedCandidate(candidate: unknown): ImportedDataSourceRecord {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("JSON does not match the data source format");
  }
  const record = candidate as Record<string, unknown>;
  const id = normalizeDataSourceId(String(record.id ?? ""));
  if (!id) {
    throw new Error("Imported data source is missing an ID");
  }
  const name = String(record.name ?? "Untitled Data Source").trim() || "Untitled Data Source";
  const kind = normalizeKind(record.kind ?? record.format);
  const type = normalizeImportedType(record.type, kind);
  const origin = normalizeOrigin(record.origin);
  return {
    id,
    name,
    kind,
    type,
    location: typeof record.location === "string" ? record.location.trim() : "",
    description: typeof record.description === "string" ? record.description.trim() : "",
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean)
      : [],
    body: typeof record.body === "string" ? record.body : "",
    origin,
  };
}

function normalizeOrigin(value: unknown): DataSourceOrigin {
  if (!value || typeof value !== "object") {
    return { mode: "root" };
  }
  const origin = value as Record<string, unknown>;
  if (origin.mode !== "derived_view") {
    return { mode: "root" };
  }
  const parentId = normalizeDataSourceId(String(origin.parent_id ?? ""));
  if (!parentId) {
    return { mode: "root" };
  }
  return {
    mode: "derived_view",
    parent_id: parentId,
    derivation_kind: origin.derivation_kind === "subset_view" ? "subset_view" : "alias",
    ...(typeof origin.summary === "string" && origin.summary.trim() ? { summary: origin.summary.trim() } : {}),
  };
}

function normalizeImportedType(value: unknown, kind: DataSourceKind): WorkflowTypeSpec {
  if (isWorkflowTypeSpec(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return legacyDataSourceSchemaToWorkflowType(value as LegacyDataSourceSchema);
  }
  return defaultDataSourceType(kind);
}

function normalizeKind(value: unknown): DataSourceKind {
  switch (value) {
    case "sqlite":
      return "sqlite";
    case "json":
      return "json";
    case "csv":
      return "csv";
    case "txt":
      return "txt";
    case "folder":
      return "folder";
    case "api":
      return "api";
    default:
      return "other";
  }
}

function legacyDataSourceSchemaToWorkflowType(schema: LegacyDataSourceSchema): WorkflowTypeSpec {
  switch (schema.type) {
    case "port":
      return legacyPortTypeToWorkflowType(schema.portType);
    case "string":
      return { type: "string", ...(schema.semantic ? { semantic: schema.semantic } : {}) };
    case "binary":
      return {
        type: "binary",
        ...(schema.mediaType ? { media_type: schema.mediaType } : {}),
        ...(schema.semantic ? { semantic: schema.semantic } : {}),
      };
    case "array":
      return {
        type: "array",
        items: legacyDataSourceSchemaToWorkflowType(schema.items),
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
            value: legacyDataSourceSchemaToWorkflowType(property.schema),
            required: property.required,
          })),
        additional_properties: schema.additionalProperties ?? schema.properties.length === 0,
        ...(schema.semantic ? { semantic: schema.semantic } : {}),
      };
    case "union":
      return { type: "union", variants: schema.variants.map(legacyDataSourceSchemaToWorkflowType) };
    case "number":
    case "boolean":
    case "null":
    case "any":
      return { type: schema.type };
  }
}

function legacyPortTypeToWorkflowType(portType: LegacyDataSourcePortType): WorkflowTypeSpec {
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
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "audio_wav":
      return { type: "binary", media_type: "audio/wav", semantic: "audio_wav" };
    case "video_file":
      return { type: "binary", media_type: "video/*", semantic: "video_file" };
    case "media_file":
      return { type: "binary", media_type: "application/octet-stream", semantic: "media_file" };
    case "number_value":
      return { type: "number" };
    case "boolean_value":
      return { type: "boolean" };
    case "array_value":
      return { type: "array", items: { type: "any" } };
    case "object_value":
      return { type: "object", properties: [], additional_properties: true };
    case "transcript":
      return { type: "object", properties: [], additional_properties: true, semantic: "transcript" };
    case "song_catalog":
      return { type: "object", properties: [], additional_properties: true, semantic: "song_catalog" };
    case "data_record":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_record" };
    case "data_bucket":
      return { type: "object", properties: [], additional_properties: true, semantic: "data_bucket" };
    case "http_response":
      return { type: "object", properties: [], additional_properties: true, semantic: "http_response" };
    case "data_value":
      return { type: "any" };
  }
}
