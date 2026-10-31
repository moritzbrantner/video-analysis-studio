import { type WorkflowCatalog as RustWorkflowCatalog } from "../api/client";
import {
  categoryForWorkflowNodeData,
  normalizeWorkflowTags,
  tagsForWorkflowNodeData,
  workflowComponentCategory,
} from "./componentMetadata";
import { rustPortSpecToFlowPort } from "./ports";
import type { FlowPort, WorkflowNodeData, WorkflowNodeModel } from "./types";

export function workflowNode(id: string, x: number, y: number, data: WorkflowNodeData): WorkflowNodeModel {
  return {
    id,
    type: "workflow",
    position: { x, y },
    data: {
      ...data,
      category: workflowComponentCategory(data.category ?? categoryForWorkflowNodeData(data)),
      tags: normalizeWorkflowTags(data.tags ?? tagsForWorkflowNodeData(data)),
    },
  };
}

export function workflowCatalogNodeTemplates(
  catalog: RustWorkflowCatalog | null,
  fallbackTemplates: WorkflowNodeModel[],
): WorkflowNodeModel[] {
  if (!catalog) {
    return fallbackTemplates;
  }
  const catalogNodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  return fallbackTemplates.map((template) => {
    const spec = catalogNodes.get(template.id);
    if (!spec || spec.ui_owned) {
      return template;
    }
    return {
      ...template,
      data: {
        ...template.data,
        title: spec.title || template.data.title,
        packageName: spec.package_name || template.data.packageName,
        inputs: spec.inputs.map(rustPortSpecToFlowPort).filter(Boolean) as FlowPort[],
        outputs: spec.outputs.map(rustPortSpecToFlowPort).filter(Boolean) as FlowPort[],
      },
    };
  });
}
