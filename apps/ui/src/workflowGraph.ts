export interface WorkflowGraphEdge {
  id?: string | null;
  source: string;
  target: string;
}

export function workflowGraphWouldCreateCycle(
  edges: readonly WorkflowGraphEdge[],
  candidate: WorkflowGraphEdge,
  options: { ignoreEdgeId?: string | null } = {},
): boolean {
  if (!candidate.source || !candidate.target) {
    return false;
  }
  if (candidate.source === candidate.target) {
    return true;
  }
  return workflowGraphHasPath(edges, candidate.target, candidate.source, options.ignoreEdgeId);
}

export function workflowGraphHasCycle(edges: readonly WorkflowGraphEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const edge of edges) {
    if (!edge.source || !edge.target) {
      continue;
    }
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.source, indegree.get(edge.source) ?? 0);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([node]) => node);
  let visitedCount = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    visitedCount += 1;
    for (const target of adjacency.get(node) ?? []) {
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        queue.push(target);
      }
    }
  }

  return visitedCount !== indegree.size;
}

function workflowGraphHasPath(
  edges: readonly WorkflowGraphEdge[],
  start: string,
  goal: string,
  ignoreEdgeId?: string | null,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.id === ignoreEdgeId) {
      continue;
    }
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  }

  const queue = [start];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node)) {
      continue;
    }
    if (node === goal) {
      return true;
    }
    visited.add(node);
    queue.push(...(adjacency.get(node) ?? []));
  }
  return false;
}
