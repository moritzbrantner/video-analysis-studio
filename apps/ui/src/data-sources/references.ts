export interface DataSourceReference {
  dataSourceId: string;
  workflowId: string;
  workflowName: string;
  nodeId: string;
  nodeTitle: string;
}

interface WorkflowLibraryLike {
  workflows: Array<{
    id: string;
    name: string;
    nodes: Array<{
      id: string;
      data: {
        title?: string;
        dataSourceNode?: boolean;
        dataSourceId?: string;
      };
    }>;
  }>;
}

export function collectDataSourceReferences(library: WorkflowLibraryLike): DataSourceReference[] {
  return library.workflows.flatMap((workflow) =>
    workflow.nodes.flatMap((node) => {
      if (!node.data.dataSourceNode || typeof node.data.dataSourceId !== "string" || !node.data.dataSourceId) {
        return [];
      }
      return [
        {
          dataSourceId: node.data.dataSourceId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          nodeId: node.id,
          nodeTitle: node.data.title ?? "Data Source",
        },
      ];
    }),
  );
}

export function referencesForDataSource(
  references: DataSourceReference[],
  dataSourceId: string,
): DataSourceReference[] {
  return references.filter((reference) => reference.dataSourceId === dataSourceId);
}
