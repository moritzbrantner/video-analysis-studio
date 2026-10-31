import type { WorkflowKindId } from "../run/types";

export function createWorkflowBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `block-${crypto.randomUUID()}`;
  }
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createWorkflowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-${crypto.randomUUID()}`;
  }
  return `workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function workflowSeedId(kind: WorkflowKindId, name: string): string {
  return `workflow-seed-${safeFlowId(kind)}-${safeFlowId(name.trim().toLowerCase().replace(/\s+/g, "-"))}`;
}

export function createWorkflowVersionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-version-${crypto.randomUUID()}`;
  }
  return `workflow-version-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createWorkflowRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `workflow-run-${crypto.randomUUID()}`;
  }
  return `workflow-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createWorkflowNodeInstanceId(baseId: string): string {
  const safeBaseId = safeFlowId(baseId) || "node";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${safeBaseId}-${crypto.randomUUID()}`;
  }
  return `${safeBaseId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function safeFlowId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}
