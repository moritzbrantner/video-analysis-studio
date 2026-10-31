import { type WorkflowTypeSpec, type WorkflowSemanticKind } from "../api/client";
import { formatWorkflowTypeSpec } from "../workflowTypeSpec";
import { isRecord } from "../shared/utils";
import { isDataSourceType, isWorkflowSemanticKind } from "./portTypes";
import type { DataSourceSchema, DataSourceSchemaProperty, DataSourceType, PortType } from "./types";

export function defaultDataSourceSchemaForKind(kind: DataSourceSchema["type"]): DataSourceSchema {
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
    case "image_file":
      return { type: "binary", mediaType: "image/*", portType, semantic: "image_file" };
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

export function workflowTypeForPortType(type: PortType): WorkflowTypeSpec {
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
    case "image_file":
      return { type: "binary", media_type: "image/*", semantic: "image_file" };
    case "image_batch":
      return { type: "object", properties: [], additional_properties: true, semantic: "image_batch" };
    case "audio_file":
      return { type: "binary", media_type: "audio/*", semantic: "audio_file" };
    case "audio_waveform":
      return { type: "object", properties: [], additional_properties: true, semantic: "audio_waveform" };
    case "media_file":
      return { type: "binary", semantic: "media_file" };
    case "mask_tensor":
      return { type: "object", properties: [], additional_properties: true, semantic: "mask_tensor" };
    case "latent_batch":
      return { type: "object", properties: [], additional_properties: true, semantic: "latent_batch" };
    case "conditioning":
      return { type: "object", properties: [], additional_properties: true, semantic: "conditioning" };
    case "model_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_ref" };
    case "vae_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "vae_ref" };
    case "clip_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "clip_ref" };
    case "clip_vision_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "clip_vision_ref" };
    case "upscale_model_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "upscale_model_ref" };
    case "model_patch_ref":
      return { type: "object", properties: [], additional_properties: true, semantic: "model_patch_ref" };
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
    case "image_file":
      return "image_file";
    case "image_batch":
      return "image_batch";
    case "audio_file":
      return "audio_file";
    case "audio_waveform":
      return "audio_waveform";
    case "audio_wav":
      return "audio_wav";
    case "media_file":
      return "media_file";
    case "mask_tensor":
      return "mask_tensor";
    case "latent_batch":
      return "latent_batch";
    case "conditioning":
      return "conditioning";
    case "model_ref":
      return "model_ref";
    case "vae_ref":
      return "vae_ref";
    case "clip_ref":
      return "clip_ref";
    case "clip_vision_ref":
      return "clip_vision_ref";
    case "upscale_model_ref":
      return "upscale_model_ref";
    case "model_patch_ref":
      return "model_patch_ref";
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

export function workflowTypeToPortType(spec: WorkflowTypeSpec, fallbackType: PortType = "data_value"): PortType {
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

export function dataSourceSchemaToWorkflowType(schema: DataSourceSchema): WorkflowTypeSpec {
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
        ...(schema.additionalPropertySchema
          ? { additional_property_value: dataSourceSchemaToWorkflowType(schema.additionalPropertySchema) }
          : {}),
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

export function dataSourcePortType(schema: DataSourceSchema): DataSourceType {
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
        ...(schema.additionalPropertySchema
          ? { additionalProperties: dataSourceSchemaToJsonSchema(schema.additionalPropertySchema) }
          : schema.additionalProperties === false
            ? { additionalProperties: false }
            : {}),
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
      ...(isRecord(value.additionalProperties)
        ? { additionalPropertySchema: dataSourceSchemaFromJsonSchema(value.additionalProperties) ?? { type: "any" } }
        : {}),
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

export function addDataSourceSchemaProperty(schema: Extract<DataSourceSchema, { type: "object" }>): DataSourceSchema {
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

export function updateDataSourceSchemaProperty(
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

export function removeDataSourceSchemaProperty(
  schema: Extract<DataSourceSchema, { type: "object" }>,
  propertyId: string,
): DataSourceSchema {
  return {
    ...schema,
    properties: schema.properties.filter((property) => property.id !== propertyId),
  };
}

export function createDataSourceSchemaPropertyId(): string {
  return `property-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isDataSourceSchema(value: unknown): value is DataSourceSchema {
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
        (value.additionalPropertySchema === undefined || isDataSourceSchema(value.additionalPropertySchema)) &&
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

export function normalizeDataSourceSchema(value: unknown, fallback: DataSourceSchema): DataSourceSchema {
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
        ...(value.additionalPropertySchema !== undefined
          ? { additionalPropertySchema: normalizeDataSourceSchema(value.additionalPropertySchema, { type: "any" }) }
          : {}),
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
