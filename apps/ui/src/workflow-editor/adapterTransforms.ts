import { isRecord } from "../shared/utils";
import type { AdapterOperationKind, AdapterTransformStep } from "./types";

export const adapterOperationDefinitions: Array<{ kind: AdapterOperationKind; label: string; detail: string }> = [
  {
    kind: "map",
    label: "Map",
    detail: "Runs once per array item. Use item, index, and input; return the converted item.",
  },
  {
    kind: "filter",
    label: "Filter",
    detail: "Runs once per array item. Use item, index, and input; return true to keep the item.",
  },
  {
    kind: "reduce",
    label: "Reduce",
    detail: "Runs once per array item. Use accumulator, item, index, and input; return the next accumulator.",
  },
  {
    kind: "flat_map",
    label: "Flat Map",
    detail: "Runs once per array item. Return an array of replacement items to flatten into the result.",
  },
  {
    kind: "group_by",
    label: "Group By",
    detail: "Runs once per array item. Return the grouping key to build a keyed object.",
  },
  {
    kind: "pick",
    label: "Pick",
    detail: "Return an array of object keys to keep on each object or on the root object.",
  },
  {
    kind: "omit",
    label: "Omit",
    detail: "Return an array of object keys to remove from each object or from the root object.",
  },
  {
    kind: "custom",
    label: "Custom",
    detail: "Runs once for the current value. Use input and return the final converted value.",
  },
];

export function normalizeAdapterTransformSteps(value: unknown): AdapterTransformStep[] {
  if (!Array.isArray(value)) {
    return [createAdapterTransformStep("custom")];
  }
  const steps = value.filter(isAdapterTransformStep).map((step) => ({
    id: step.id,
    operation: step.operation,
    expression: step.expression,
    ...(step.enabled === false ? { enabled: false } : {}),
  }));
  return steps.length > 0 ? steps : [createAdapterTransformStep("custom")];
}

export function createAdapterTransformStep(operation: AdapterOperationKind): AdapterTransformStep {
  return {
    id: createAdapterTransformStepId(),
    operation,
    expression: adapterOperationTemplate(operation),
  };
}

function createAdapterTransformStepId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `adapter-step-${crypto.randomUUID()}`;
  }
  return `adapter-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function adapterOperationTemplate(operation: AdapterOperationKind): string {
  switch (operation) {
    case "map":
      return "return item;";
    case "filter":
      return "return true;";
    case "reduce":
      return "return accumulator;";
    case "flat_map":
      return "return [item];";
    case "group_by":
      return "return item.category ?? \"default\";";
    case "pick":
      return "return [\"id\", \"title\"];";
    case "omit":
      return "return [\"debug\"];";
    case "custom":
      return "return input;";
  }
}

export function moveAdapterTransformStep(
  steps: AdapterTransformStep[],
  fromIndex: number,
  toIndex: number,
): AdapterTransformStep[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= steps.length || toIndex >= steps.length) {
    return steps;
  }
  const nextSteps = [...steps];
  const [step] = nextSteps.splice(fromIndex, 1);
  nextSteps.splice(toIndex, 0, step);
  return nextSteps;
}

export function isAdapterTransformStep(value: unknown): value is AdapterTransformStep {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isAdapterOperationKind(value.operation) &&
    typeof value.expression === "string" &&
    (value.enabled === undefined || typeof value.enabled === "boolean")
  );
}

function isAdapterOperationKind(value: unknown): value is AdapterOperationKind {
  return (
    value === "map" ||
    value === "filter" ||
    value === "reduce" ||
    value === "flat_map" ||
    value === "group_by" ||
    value === "pick" ||
    value === "omit" ||
    value === "custom"
  );
}
