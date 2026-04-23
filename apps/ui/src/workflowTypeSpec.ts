import type { WorkflowObjectProperty, WorkflowTypeSpec } from "./api/client";

export function workflowTypesAssignable(source: WorkflowTypeSpec, target: WorkflowTypeSpec): boolean {
  if (target.type === "any") {
    return true;
  }
  if (target.type === "union") {
    return target.variants.some((variant) => workflowTypesAssignable(source, variant));
  }
  if (source.type === "union") {
    return source.variants.every((variant) => workflowTypesAssignable(variant, target));
  }
  if (source.type === "any") {
    return false;
  }

  switch (source.type) {
    case "null":
    case "boolean":
    case "number":
      return source.type === target.type;
    case "string":
      return target.type === "string" && semanticAssignable(source.semantic, target.semantic);
    case "binary":
      return target.type === "binary" && mediaTypeAssignable(source.media_type, target.media_type) && semanticAssignable(source.semantic, target.semantic);
    case "array":
      return (
        target.type === "array" &&
        workflowTypesAssignable(source.items, target.items) &&
        (source.min_items ?? 0) >= (target.min_items ?? 0) &&
        maxItemsAssignable(source.max_items, target.max_items)
      );
    case "object":
      return (
        target.type === "object" &&
        semanticAssignable(source.semantic, target.semantic) &&
        objectPropertiesAssignable(
          source.properties ?? [],
          source.additional_properties ?? false,
          target.properties ?? [],
          target.additional_properties ?? false,
        )
      );
  }
}

export function formatWorkflowTypeSpec(spec: WorkflowTypeSpec, stream = false): string {
  const formatted = formatWorkflowType(spec);
  return stream ? `${formatted} stream` : formatted;
}

export function formatWorkflowTypeSpecJson(spec: WorkflowTypeSpec): string {
  return JSON.stringify(canonicalizeWorkflowTypeSpec(spec), null, 2);
}

export function workflowTypeSignature(spec: WorkflowTypeSpec, stream = false): string {
  return fnv1aHash(JSON.stringify(canonicalizeWorkflowTypeSpec(spec)) + `|${stream ? "stream" : "value"}`);
}

export function canonicalizeWorkflowTypeSpec(spec: WorkflowTypeSpec): WorkflowTypeSpec {
  switch (spec.type) {
    case "array":
      return {
        type: "array",
        items: canonicalizeWorkflowTypeSpec(spec.items),
        ...(typeof spec.min_items === "number" ? { min_items: spec.min_items } : {}),
        ...(typeof spec.max_items === "number" ? { max_items: spec.max_items } : {}),
      };
    case "object":
      return {
        type: "object",
        properties: [...(spec.properties ?? [])]
          .map((property) => ({
            name: property.name,
            value: canonicalizeWorkflowTypeSpec(property.value),
            required: Boolean(property.required),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
        additional_properties: Boolean(spec.additional_properties),
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    case "union":
      return {
        type: "union",
        variants: [...spec.variants].map(canonicalizeWorkflowTypeSpec).sort(compareCanonicalTypeSpec),
      };
    case "binary":
      return {
        type: "binary",
        ...(spec.media_type ? { media_type: spec.media_type } : {}),
        ...(spec.semantic ? { semantic: spec.semantic } : {}),
      };
    case "string":
      return { type: "string", ...(spec.semantic ? { semantic: spec.semantic } : {}) };
    case "any":
    case "null":
    case "boolean":
    case "number":
      return { type: spec.type };
  }
}

export function isWorkflowTypeSpec(value: unknown): value is WorkflowTypeSpec {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  switch (value.type) {
    case "any":
    case "null":
    case "boolean":
    case "number":
      return true;
    case "string":
      return value.semantic === undefined || typeof value.semantic === "string";
    case "binary":
      return (value.media_type === undefined || typeof value.media_type === "string") && (value.semantic === undefined || typeof value.semantic === "string");
    case "array":
      return isWorkflowTypeSpec(value.items) && (value.min_items === undefined || typeof value.min_items === "number") && (value.max_items === undefined || typeof value.max_items === "number");
    case "object":
      return (
        (value.properties === undefined || (Array.isArray(value.properties) && value.properties.every(isWorkflowObjectProperty))) &&
        (value.additional_properties === undefined || typeof value.additional_properties === "boolean") &&
        (value.semantic === undefined || typeof value.semantic === "string")
      );
    case "union":
      return Array.isArray(value.variants) && value.variants.length > 0 && value.variants.every(isWorkflowTypeSpec);
    default:
      return false;
  }
}

function formatWorkflowType(spec: WorkflowTypeSpec): string {
  switch (spec.type) {
    case "any":
      return "Any";
    case "null":
      return "Null";
    case "boolean":
      return "Boolean";
    case "number":
      return "Number";
    case "string":
      return spec.semantic ? `${semanticLabel(spec.semantic)} string` : "String";
    case "binary":
      return spec.media_type ? `Binary<${spec.media_type}>` : "Binary";
    case "array": {
      const bounds = formatBounds(spec.min_items, spec.max_items);
      return `Array<${formatWorkflowType(spec.items)}>${bounds}`;
    }
    case "object": {
      const properties = (spec.properties ?? []).slice(0, 3).map((property) => property.name.trim()).filter(Boolean);
      const preview = properties.length > 0 ? `{${properties.join(", ")}${(spec.properties ?? []).length > properties.length ? ", ..." : ""}}` : "{}";
      const base = spec.semantic ? `${semanticLabel(spec.semantic)} ${preview}` : `Object${preview}`;
      return spec.additional_properties === false ? base : `${base}+`;
    }
    case "union":
      return spec.variants.map(formatWorkflowType).join(" | ");
  }
}

function formatBounds(minItems?: number, maxItems?: number): string {
  if (minItems === undefined && maxItems === undefined) {
    return "";
  }
  const min = minItems ?? 0;
  const max = maxItems ?? "*";
  return `[${min}..${max}]`;
}

function semanticLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function semanticAssignable(source?: string, target?: string): boolean {
  return target === undefined || source === target;
}

function mediaTypeAssignable(source?: string, target?: string): boolean {
  return target === undefined || source === target;
}

function maxItemsAssignable(source?: number, target?: number): boolean {
  return target === undefined || (typeof source === "number" && source <= target);
}

function objectPropertiesAssignable(
  sourceProperties: WorkflowObjectProperty[],
  sourceAdditionalProperties: boolean,
  targetProperties: WorkflowObjectProperty[],
  targetAdditionalProperties: boolean,
): boolean {
  for (const targetProperty of targetProperties) {
    const sourceProperty = sourceProperties.find((property) => property.name === targetProperty.name);
    if (!sourceProperty) {
      if (targetProperty.required) {
        return false;
      }
      continue;
    }
    if (!workflowTypesAssignable(sourceProperty.value, targetProperty.value)) {
      return false;
    }
  }

  if (!targetAdditionalProperties) {
    if (sourceAdditionalProperties) {
      return false;
    }
    for (const sourceProperty of sourceProperties) {
      if (!targetProperties.some((targetProperty) => targetProperty.name === sourceProperty.name)) {
        return false;
      }
    }
  }

  return true;
}

function isWorkflowObjectProperty(value: unknown): value is WorkflowObjectProperty {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isWorkflowTypeSpec(value.value) &&
    (value.required === undefined || typeof value.required === "boolean")
  );
}

function compareCanonicalTypeSpec(left: WorkflowTypeSpec, right: WorkflowTypeSpec): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `t${(hash >>> 0).toString(16)}`;
}
