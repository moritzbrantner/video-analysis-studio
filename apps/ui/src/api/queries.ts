import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import type {
  DataSourceDerivationInput,
  DataSourceRecord,
  DataSourceUpsert,
  RunEvent,
  RunRecord,
  SystemDependencyReport,
  TranscriptionCatalog,
  WorkflowCatalog,
} from "./client";
import { getWorkflowClient } from "./client";
import type { StudioReport, YoutubeCollectionManifest, YoutubeCollectionManifestRequest } from "../types";

const oneMinute = 60 * 1000;
const fiveMinutes = 5 * oneMinute;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: oneMinute,
    },
  },
});

export const queryKeys = {
  systemDependencies: ["system", "dependencies"] as const,
  transcriptionCatalog: ["transcription", "catalog"] as const,
  workflowCatalog: ["workflow", "catalog"] as const,
  dataSources: ["data-sources"] as const,
  run: (runId: string) => ["runs", runId] as const,
  runEvents: (runId: string) => ["runs", runId, "events"] as const,
  report: (runId: string, workflowKind: string) => ["runs", runId, "report", workflowKind] as const,
  mediaUrl: (runId: string | null, path: string) => ["media-url", runId ?? "json-report", path] as const,
};

export function workflowCatalogQueryOptions(): UseQueryOptions<WorkflowCatalog, Error> {
  return {
    queryKey: queryKeys.workflowCatalog,
    queryFn: () => getWorkflowClient().getWorkflowCatalog(),
    staleTime: fiveMinutes,
  };
}

export function transcriptionCatalogQueryOptions(): UseQueryOptions<TranscriptionCatalog, Error> {
  return {
    queryKey: queryKeys.transcriptionCatalog,
    queryFn: () => getWorkflowClient().getTranscriptionCatalog(),
    staleTime: fiveMinutes,
  };
}

export function dataSourcesQueryOptions(): UseQueryOptions<DataSourceRecord[], Error> {
  return {
    queryKey: queryKeys.dataSources,
    queryFn: () => getWorkflowClient().listDataSources(),
  };
}

export function systemDependenciesQueryOptions(): UseQueryOptions<SystemDependencyReport, Error> {
  return {
    queryKey: queryKeys.systemDependencies,
    queryFn: () => getWorkflowClient().checkDependencies(),
    staleTime: fiveMinutes,
  };
}

export function runQueryOptions(runId: string): UseQueryOptions<RunRecord, Error> {
  return {
    queryKey: queryKeys.run(runId),
    queryFn: () => getWorkflowClient().getRun(runId),
    staleTime: 0,
  };
}

export function runEventsQueryOptions(runId: string): UseQueryOptions<RunEvent[], Error> {
  return {
    queryKey: queryKeys.runEvents(runId),
    queryFn: () => getWorkflowClient().getRunEvents(runId),
    staleTime: 0,
  };
}

export function reportQueryOptions(
  runId: string,
  workflowKind: string,
  fetchReport: () => Promise<StudioReport>,
): UseQueryOptions<StudioReport, Error> {
  return {
    queryKey: queryKeys.report(runId, workflowKind),
    queryFn: fetchReport,
    staleTime: fiveMinutes,
  };
}

export function useWorkflowCatalogQuery() {
  return useQuery(workflowCatalogQueryOptions());
}

export function useTranscriptionCatalogQuery() {
  return useQuery(transcriptionCatalogQueryOptions());
}

export function useDataSourcesQuery() {
  return useQuery(dataSourcesQueryOptions());
}

export function useSystemDependenciesQuery() {
  return useQuery(systemDependenciesQueryOptions());
}

export function useMediaUrlQuery(runId: string | null | undefined, path: string) {
  return useQuery({
    queryKey: queryKeys.mediaUrl(runId ?? null, path),
    queryFn: () => getWorkflowClient().mediaUrl(runId ?? null, path),
    enabled: path.trim().length > 0,
    staleTime: fiveMinutes,
  });
}

export function useDiscoverYoutubeCollectionManifestMutation() {
  return useMutation<YoutubeCollectionManifest, Error, YoutubeCollectionManifestRequest>({
    mutationFn: (request) => getWorkflowClient().discoverYoutubeCollectionManifest(request),
  });
}

export function useDataSourceMutations() {
  const cache = useQueryClient();

  const invalidateDataSources = () => cache.invalidateQueries({ queryKey: queryKeys.dataSources });

  return {
    createDataSource: useMutation({
      mutationFn: (request: DataSourceUpsert) => getWorkflowClient().createDataSource(request),
      onSuccess: (record) => {
        cache.setQueryData<DataSourceRecord[]>(queryKeys.dataSources, (records = []) => upsertDataSource(records, record));
        void invalidateDataSources();
      },
    }),
    updateDataSource: useMutation({
      mutationFn: ({ currentId, request }: { currentId: string; request: DataSourceUpsert }) =>
        getWorkflowClient().updateDataSource(currentId, request),
      onSuccess: (record, variables) => {
        cache.setQueryData<DataSourceRecord[]>(queryKeys.dataSources, (records = []) =>
          upsertDataSource(records.filter((current) => current.id !== variables.currentId), record),
        );
        void invalidateDataSources();
      },
    }),
    deleteDataSource: useMutation({
      mutationFn: (id: string) => getWorkflowClient().deleteDataSource(id).then(() => id),
      onSuccess: (id) => {
        cache.setQueryData<DataSourceRecord[]>(queryKeys.dataSources, (records = []) =>
          records.filter((record) => record.id !== id),
        );
        void invalidateDataSources();
      },
    }),
    createDataSourceDerivation: useMutation({
      mutationFn: ({ parentId, request }: { parentId: string; request: DataSourceDerivationInput }) =>
        getWorkflowClient().createDataSourceDerivation(parentId, request),
      onSuccess: (record) => {
        cache.setQueryData<DataSourceRecord[]>(queryKeys.dataSources, (records = []) => upsertDataSource(records, record));
        void invalidateDataSources();
      },
    }),
  };
}

function upsertDataSource(records: DataSourceRecord[], record: DataSourceRecord): DataSourceRecord[] {
  const nextRecords = records.filter((current) => current.id !== record.id);
  return [...nextRecords, record].sort((a, b) => a.id.localeCompare(b.id));
}
