import type { DataSourceKind, DataSourceRecord } from "../api/client";
import type { DataSourceReference } from "./references";

export interface DataSourceDeleteBlockers {
  childCount: number;
  referenceCount: number;
}

export function isDerivedDataSource(record: DataSourceRecord): boolean {
  return record.origin.mode === "derived_view";
}

export function parentDataSource(
  record: DataSourceRecord,
  byId: Map<string, DataSourceRecord>,
): DataSourceRecord | null {
  if (record.origin.mode !== "derived_view") {
    return null;
  }
  return byId.get(record.origin.parent_id) ?? null;
}

export function childDataSources(
  dataSources: DataSourceRecord[],
  parentId: string,
): DataSourceRecord[] {
  return dataSources.filter(
    (record) => record.origin.mode === "derived_view" && record.origin.parent_id === parentId,
  );
}

export function effectiveDataSourceKind(
  record: DataSourceRecord,
  byId: Map<string, DataSourceRecord>,
): DataSourceKind {
  const root = rootDataSource(record, byId);
  return root?.kind ?? record.kind;
}

export function effectiveDataSourceLocation(
  record: DataSourceRecord,
  byId: Map<string, DataSourceRecord>,
): string {
  const root = rootDataSource(record, byId);
  return root?.location ?? record.location;
}

export function effectiveDataSourceBody(
  record: DataSourceRecord,
  byId: Map<string, DataSourceRecord>,
): string {
  const root = rootDataSource(record, byId);
  return root?.body ?? record.body;
}

export function rootDataSource(
  record: DataSourceRecord,
  byId: Map<string, DataSourceRecord>,
): DataSourceRecord | null {
  let current: DataSourceRecord | null = record;
  const visited = new Set<string>();
  while (current?.origin.mode === "derived_view") {
    if (visited.has(current.id)) {
      return null;
    }
    visited.add(current.id);
    current = byId.get(current.origin.parent_id) ?? null;
  }
  return current;
}

export function dataSourceDeleteBlockers(
  record: DataSourceRecord,
  dataSources: DataSourceRecord[],
  references: DataSourceReference[],
): DataSourceDeleteBlockers {
  return {
    childCount: childDataSources(dataSources, record.id).length,
    referenceCount: references.filter((reference) => reference.dataSourceId === record.id).length,
  };
}
