import { isWorkflowComponentCategory } from "./guards";
import type { WorkflowComponentCategory, WorkflowNodeData, WorkflowNodeModel } from "./types";

export function workflowComponentCategory(value: unknown): WorkflowComponentCategory {
  return isWorkflowComponentCategory(value) ? value : "Reusable";
}

export function categoryForWorkflowNodes(nodes: WorkflowNodeModel[]): WorkflowComponentCategory {
  const categories = nodes.map((node) => node.data.category ?? categoryForWorkflowNodeData(node.data));
  const uniqueCategories = new Set(categories);
  if (uniqueCategories.size === 1) {
    return workflowComponentCategory(categories[0]);
  }
  if (categories.some((category) => category === "Dashboard")) {
    return "Dashboard";
  }
  if (categories.some((category) => category === "Output")) {
    return "Output";
  }
  return "Reusable";
}

export function categoryForWorkflowNodeData(data: WorkflowNodeData): WorkflowComponentCategory {
  const packageName = data.packageName.toLowerCase();
  const title = data.title.toLowerCase();
  const text = `${title} ${packageName} ${data.description.toLowerCase()}`;

  if (data.category) {
    return workflowComponentCategory(data.category);
  }
  if (packageName.includes("@video-analysis-studio/ui") || title.includes("dashboard") || title.includes("panel") || title.includes("table")) {
    return "Dashboard";
  }
  if (packageName.includes("generator")) {
    return "Generator";
  }
  if (packageName.includes("control flow")) {
    return "Control Flow";
  }
  if (packageName.includes("studio-api") || title.includes("api")) {
    return "API";
  }
  if (packageName === "input" || title.includes("source picker") || title.includes("loader")) {
    return "Input";
  }
  if (title.includes("workflow") || title.includes("pipeline")) {
    return "Pipeline";
  }
  if (title.includes("sink") || title.includes("save") || text.includes("webhook")) {
    return "Output";
  }
  if (text.includes("ffmpeg") || text.includes("ingest") || text.includes("download")) {
    return "Ingest";
  }
  if (text.includes("detector") || text.includes("scene")) {
    return "Detection";
  }
  if (text.includes("model") || text.includes("ocr") || text.includes("object")) {
    return "Models";
  }
  if (text.includes("audio")) {
    return "Audio";
  }
  if (text.includes("transcript") || text.includes("text")) {
    return "Text";
  }
  if (text.includes("report") || text.includes("serde_json")) {
    return "Report";
  }
  if (text.includes("bucket") || text.includes("data")) {
    return "Data";
  }
  if (title.includes("user story")) {
    return "Application";
  }
  return "Pipeline";
}

export function parseWorkflowTags(value: string): string[] {
  return normalizeWorkflowTags(value.split(/[\s,]+/));
}

export function normalizeWorkflowTags(value: unknown): string[] {
  const candidates =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value)
        ? value
        : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const tag = candidate.trim().toLowerCase().replace(/[^a-z0-9@/_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (tag.length < 2 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags.slice(0, 12);
}

export function tagsForWorkflowNodes(nodes: WorkflowNodeModel[]): string[] {
  return normalizeWorkflowTags(nodes.flatMap((node) => node.data.tags ?? tagsForWorkflowNodeData(node.data)));
}

export function tagsForWorkflowNodeData(data: WorkflowNodeData): string[] {
  return normalizeWorkflowTags([
    data.title,
    data.packageName,
    data.category ?? categoryForWorkflowNodeData(data),
    data.tone,
    ...data.inputs.map((portValue) => portValue.type),
    ...data.outputs.map((portValue) => portValue.type),
  ].flatMap(tokenizeWorkflowTagText));
}

function tokenizeWorkflowTagText(value: string): string[] {
  const ignoredTags = new Set(["and", "the", "for", "with", "from", "into", "json", "cli", "web"]);
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9@/_-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 1 && !ignoredTags.has(token));
}
