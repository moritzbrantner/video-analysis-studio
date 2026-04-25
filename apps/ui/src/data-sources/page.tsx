import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type {
  DataSourceDerivationInput,
  DataSourceKind,
  DataSourceOrigin,
  DataSourceRecord,
  DataSourceUpsert,
} from "../api/client";
import { Badge, EmptyState, Panel, StatCard } from "../shared/primitives";
import { cn } from "../shared/utils";
import { formatWorkflowTypeSpec, workflowTypesAssignable } from "../workflowTypeSpec";
import {
  childDataSources,
  dataSourceDeleteBlockers,
  effectiveDataSourceBody,
  effectiveDataSourceKind,
  effectiveDataSourceLocation,
  isDerivedDataSource,
  parentDataSource,
} from "./derivations";
import type { DataSourceReference } from "./references";
import { referencesForDataSource } from "./references";
import { WorkflowTypeEditor } from "./schema";
import {
  dataSourceKindLabel,
  dataSourceToUpsert,
  dataSourcePopulationOptions,
  defaultDataSourcePopulationMode,
  defaultDataSourceType,
  defaultDataSourceUpsert,
  downloadDataSourcesJson,
  editableInlineBody,
  filterDataSources,
  formatTags,
  nextDataSourceId,
  normalizeDataSourceId,
  normalizeTagText,
  parseImportedDataSourcesJson,
  type DataSourcePopulationMode,
  validateDataSourceBody,
  validateDataSourceId,
} from "./types";

const dataSourceKinds: DataSourceKind[] = ["sqlite", "json", "csv", "txt", "folder", "api", "other"];

interface DataSourcesPageProps {
  dataSources: DataSourceRecord[];
  references: DataSourceReference[];
  loading?: boolean;
  legacyMigrationAvailable?: boolean;
  onImportLegacy?: () => Promise<void>;
  onCreateDataSource: (request: DataSourceUpsert) => Promise<DataSourceRecord>;
  onUpdateDataSource: (currentId: string, request: DataSourceUpsert) => Promise<DataSourceRecord>;
  onDeleteDataSource: (id: string) => Promise<void>;
  onCreateDataSourceDerivation: (
    parentId: string,
    request: DataSourceDerivationInput,
  ) => Promise<DataSourceRecord>;
  onOpenWorkflow?: (workflowId: string) => void;
}

export function DataSourcesPage({
  dataSources,
  references,
  loading = false,
  legacyMigrationAvailable = false,
  onImportLegacy,
  onCreateDataSource,
  onUpdateDataSource,
  onDeleteDataSource,
  onCreateDataSourceDerivation,
  onOpenWorkflow,
}: DataSourcesPageProps) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createStep, setCreateStep] = useState<"schema" | "population">("schema");
  const [createDraft, setCreateDraft] = useState<DataSourceUpsert>(() => defaultDataSourceUpsert([]));
  const [createTagText, setCreateTagText] = useState("");
  const [createTypeError, setCreateTypeError] = useState<string | null>(null);
  const [createPopulationMode, setCreatePopulationMode] = useState<DataSourcePopulationMode>("inline");
  const [draft, setDraft] = useState<DataSourceUpsert>(() => defaultDataSourceUpsert([]));
  const [tagText, setTagText] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDerivationForm, setShowDerivationForm] = useState(false);
  const [derivationDraft, setDerivationDraft] = useState<DataSourceDerivationInput | null>(null);
  const [derivationTags, setDerivationTags] = useState("");
  const [derivationTypeError, setDerivationTypeError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const byId = useMemo(() => new Map(dataSources.map((record) => [record.id, record])), [dataSources]);
  const activeRecord = useMemo(
    () => dataSources.find((record) => record.id === activeId) ?? null,
    [activeId, dataSources],
  );
  const filtered = useMemo(() => filterDataSources(dataSources, query), [dataSources, query]);
  const activeReferences = useMemo(
    () => (activeRecord ? referencesForDataSource(references, activeRecord.id) : []),
    [activeRecord, references],
  );
  const activeChildren = useMemo(
    () => (activeRecord ? childDataSources(dataSources, activeRecord.id) : []),
    [activeRecord, dataSources],
  );
  const activeParent = useMemo(
    () => (activeRecord ? parentDataSource(activeRecord, byId) : null),
    [activeRecord, byId],
  );

  useEffect(() => {
    if (!dataSources.length) {
      setActiveId(null);
      setDraft(defaultDataSourceUpsert([]));
      setTagText("");
      return;
    }
    if (!activeId || !dataSources.some((record) => record.id === activeId)) {
      setActiveId(dataSources[0].id);
    }
  }, [activeId, dataSources]);

  useEffect(() => {
    if (!activeRecord) {
      return;
    }
    setDraft(dataSourceToUpsert(activeRecord));
    setTagText(formatTags(activeRecord.tags));
    setTypeError(null);
    setShowDerivationForm(false);
    setDerivationDraft(null);
    setDerivationTags("");
    setDerivationTypeError(null);
  }, [activeRecord]);

  const openCreateForm = () => {
    const nextDraft = defaultDataSourceUpsert(dataSources.map((record) => record.id));
    setCreateDraft(nextDraft);
    setCreateTagText("");
    setCreateTypeError(null);
    setCreatePopulationMode(defaultDataSourcePopulationMode(nextDraft.kind));
    setCreateStep("schema");
    setShowCreateForm(true);
    setMessage(null);
  };

  const cancelCreateForm = () => {
    setShowCreateForm(false);
    setCreateStep("schema");
    setCreateTypeError(null);
  };

  const selectCreateKind = (kind: DataSourceKind) => {
    setCreateDraft((current) => ({
      ...current,
      kind,
      type: defaultDataSourceType(kind),
      body: editableInlineBody(kind) ? current.body : "",
    }));
    setCreatePopulationMode(defaultDataSourcePopulationMode(kind));
    setCreateTypeError(null);
  };

  const continueCreateForm = () => {
    if (createTypeError) {
      setMessage("Type contract JSON must be valid before continuing.");
      return;
    }
    setCreateStep("population");
  };

  const createRootSource = async () => {
    const nextId = normalizeDataSourceId(createDraft.id);
    const idError = validateDataSourceId(nextId, dataSources.map((record) => record.id));
    if (idError) {
      setMessage(idError);
      return;
    }
    if (createTypeError) {
      setMessage("Type contract JSON must be valid before creating the source.");
      return;
    }
    const nextDraft: DataSourceUpsert = {
      ...createDraft,
      id: nextId,
      name: createDraft.name.trim(),
      location: createPopulationMode === "metadata" ? "" : createDraft.location.trim(),
      description: createDraft.description.trim(),
      tags: normalizeTagText(createTagText),
      body:
        createPopulationMode === "inline" && editableInlineBody(createDraft.kind) ? createDraft.body : "",
    };
    if (createPopulationMode === "location" && !nextDraft.location) {
      setMessage("Location is required when the source is populated from a path or URL.");
      return;
    }
    const bodyError = validateDataSourceBody(nextDraft);
    if (bodyError) {
      setMessage(bodyError);
      return;
    }
    const created = await onCreateDataSource(nextDraft);
    setShowCreateForm(false);
    setCreateStep("schema");
    setActiveId(created.id);
    setMessage(`Created ${created.id}.`);
  };

  const saveSource = async () => {
    if (!activeRecord) {
      return;
    }
    const nextId = normalizeDataSourceId(draft.id);
    const idError = validateDataSourceId(nextId, dataSources.map((record) => record.id), activeRecord.id);
    if (idError) {
      setMessage(idError);
      return;
    }
    if (typeError) {
      setMessage("Type contract JSON must be valid before saving.");
      return;
    }
    const nextDraft: DataSourceUpsert = {
      ...draft,
      id: nextId,
      name: draft.name.trim(),
      location: draft.location.trim(),
      description: draft.description.trim(),
      tags: normalizeTagText(tagText),
      body: editableInlineBody(draft.kind) ? draft.body : "",
    };
    const bodyError = validateDataSourceBody(nextDraft);
    if (bodyError) {
      setMessage(bodyError);
      return;
    }
    setIsSaving(true);
    try {
      const updated = await onUpdateDataSource(activeRecord.id, nextDraft);
      setActiveId(updated.id);
      setMessage(`Saved ${updated.id}.`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSource = async () => {
    if (!activeRecord) {
      return;
    }
    const blockers = dataSourceDeleteBlockers(activeRecord, dataSources, references);
    if (blockers.childCount > 0 || blockers.referenceCount > 0) {
      setMessage("Resolve workflow references and derived children before deleting this source.");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`Delete data source "${activeRecord.id}"?`)) {
      return;
    }
    await onDeleteDataSource(activeRecord.id);
    setMessage(`Deleted ${activeRecord.id}.`);
  };

  const openDerivationForm = () => {
    if (!activeRecord) {
      return;
    }
    const suggestedId = nextDataSourceId(dataSources.map((record) => record.id), `${activeRecord.id}-view`);
    setDerivationDraft({
      id: suggestedId,
      name: `${activeRecord.name} View`,
      type: activeRecord.type,
      description: "",
      tags: [],
      derivation_kind: "alias",
      summary: "",
    });
    setDerivationTags("");
    setDerivationTypeError(null);
    setShowDerivationForm(true);
  };

  const createDerivation = async () => {
    if (!activeRecord || !derivationDraft) {
      return;
    }
    const nextId = normalizeDataSourceId(derivationDraft.id);
    const idError = validateDataSourceId(nextId, dataSources.map((record) => record.id));
    if (idError) {
      setMessage(idError);
      return;
    }
    if (derivationTypeError) {
      setMessage("Derived type contract JSON must be valid before saving.");
      return;
    }
    if (!workflowTypesAssignable(activeRecord.type, derivationDraft.type)) {
      setMessage("Derived type must be assignable from the parent type.");
      return;
    }
    const created = await onCreateDataSourceDerivation(activeRecord.id, {
      ...derivationDraft,
      id: nextId,
      name: derivationDraft.name.trim(),
      description: derivationDraft.description.trim(),
      tags: normalizeTagText(derivationTags),
      summary: derivationDraft.summary?.trim() || undefined,
    });
    setShowDerivationForm(false);
    setDerivationDraft(null);
    setActiveId(created.id);
    setMessage(`Created derivation ${created.id}.`);
  };

  const importRecords = async (records: ReturnType<typeof parseImportedDataSourcesJson>) => {
    const existingIds = new Set(dataSources.map((record) => record.id));
    const importedIdMap = new Map<string, string>();
    const roots = records.filter((record) => record.origin.mode === "root");
    const derived = records.filter(isDerivedOriginRecord);

    for (const record of roots) {
      const id = existingIds.has(record.id) ? nextDataSourceId(existingIds, record.id) : record.id;
      const created = await onCreateDataSource({
        id,
        name: record.name,
        kind: record.kind,
        type: record.type,
        location: record.location,
        description: record.description,
        tags: record.tags,
        body: record.body,
      });
      existingIds.add(created.id);
      importedIdMap.set(record.id, created.id);
    }

    const pending = [...derived];
    while (pending.length > 0) {
      let progressed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const record = pending[index];
        const parentId = importedIdMap.get(record.origin.parent_id) ?? record.origin.parent_id;
        if (!existingIds.has(parentId)) {
          continue;
        }
        const id = existingIds.has(record.id) ? nextDataSourceId(existingIds, record.id) : record.id;
        const created = await onCreateDataSourceDerivation(parentId, {
          id,
          name: record.name,
          type: record.type,
          description: record.description,
          tags: record.tags,
          derivation_kind: record.origin.derivation_kind,
          summary: record.origin.summary,
        });
        existingIds.add(created.id);
        importedIdMap.set(record.id, created.id);
        pending.splice(index, 1);
        index -= 1;
        progressed = true;
      }
      if (!progressed) {
        throw new Error("Imported derivations reference missing parents.");
      }
    }
  };

  const activeDeleteBlockers = activeRecord
    ? dataSourceDeleteBlockers(activeRecord, dataSources, references)
    : { childCount: 0, referenceCount: 0 };

  const detailDescription =
    message ??
    (showCreateForm
      ? "Step through schema setup first, then choose how this source will be populated."
      : "IDs are stable workflow handles. Derived sources inherit root location and body.");

  return (
    <section className="space-y-4">
      {legacyMigrationAvailable && dataSources.length === 0 && onImportLegacy ? (
        <Panel
          title="Import Legacy Data Sources"
          description="This workspace catalog is empty, but legacy browser-local data sources are available for one-time import."
          actions={
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
              onClick={async () => {
                await onImportLegacy();
                setMessage("Imported legacy browser-local data sources into the workspace catalog.");
              }}
            >
              Import Local Data Sources Into Workspace
            </button>
          }
        >
          <p className="text-sm text-zinc-600">
            The old `localStorage` catalog is no longer the source of truth. Import it once so the catalog lives in the workspace and is shared across sessions.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel
          title="Data Sources"
          description="Workspace-backed source registry with typed IDs and derivations."
          className="h-fit"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={openCreateForm}
              >
                New
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={() => importInputRef.current?.click()}
              >
                Import
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                onClick={() => downloadDataSourcesJson(dataSources)}
                disabled={dataSources.length === 0}
              >
                Export
              </button>
            </div>
          }
        >
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) {
                return;
              }
              try {
                const records = parseImportedDataSourcesJson(await file.text());
                await importRecords(records);
                setMessage(`Imported ${records.length} data source${records.length === 1 ? "" : "s"}.`);
              } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error));
              }
            }}
          />
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Sources" value={String(dataSources.length)} />
              <StatCard label="Derived" value={String(dataSources.filter(isDerivedDataSource).length)} />
              <StatCard label="References" value={String(references.length)} />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-normal text-zinc-500">
                Search
              </label>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find by id, type, tags, parent, location"
              />
            </div>
            {loading ? (
              <EmptyState>Loading workspace catalog…</EmptyState>
            ) : filtered.length === 0 ? (
              <EmptyState>{dataSources.length === 0 ? "No data sources yet." : "No sources match this search."}</EmptyState>
            ) : (
              <div className="max-h-[72vh] space-y-2 overflow-auto">
                {filtered.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    className={cn(
                      "w-full rounded-lg border px-3 py-3 text-left transition",
                      activeId === record.id
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50",
                    )}
                    onClick={() => {
                      setShowCreateForm(false);
                      setActiveId(record.id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{record.name}</div>
                        <div className="mt-1 truncate font-mono text-[11px] opacity-80">{record.id}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <span className="rounded-md border border-current/20 px-2 py-0.5 text-[10px] font-semibold uppercase opacity-80">
                          {record.kind}
                        </span>
                        {record.origin.mode === "derived_view" ? (
                          <span className="rounded-md border border-current/20 px-2 py-0.5 text-[10px] font-semibold uppercase opacity-80">
                            derived
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 line-clamp-2 text-[11px] opacity-75">{formatWorkflowTypeSpec(record.type)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title={showCreateForm ? "Create Source" : activeRecord ? "Edit Source" : "Source Details"}
          description={detailDescription}
        >
          {showCreateForm ? (
            <CreateDataSourceWizard
              step={createStep}
              draft={createDraft}
              tagText={createTagText}
              populationMode={createPopulationMode}
              typeError={createTypeError}
              onDraftChange={setCreateDraft}
              onTagTextChange={setCreateTagText}
              onPopulationModeChange={setCreatePopulationMode}
              onTypeChange={(value, jsonError) => {
                setCreateDraft((current) => ({ ...current, type: value }));
                setCreateTypeError(jsonError);
              }}
              onSelectKind={selectCreateKind}
              onBack={() => setCreateStep("schema")}
              onCancel={cancelCreateForm}
              onContinue={continueCreateForm}
              onCreate={createRootSource}
            />
          ) : !activeRecord ? (
            <EmptyState>Select or create a data source.</EmptyState>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>{dataSourceKindLabel(effectiveDataSourceKind(activeRecord, byId))}</Badge>
                  {isDerivedDataSource(activeRecord) ? <Badge tone="violet">Derived</Badge> : <Badge tone="sky">Root</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={openDerivationForm}
                  >
                    Create Derivation
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={saveSource}
                    disabled={isSaving}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-sm font-medium text-rose-800 hover:bg-rose-100"
                    onClick={deleteSource}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="ID">
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={draft.id}
                    onBlur={() => setDraft((current) => ({ ...current, id: normalizeDataSourceId(current.id) }))}
                    onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
                  />
                </Field>
                <Field label="Name">
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </Field>
                <Field label="Kind">
                  <select
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:bg-zinc-50"
                    value={effectiveDataSourceKind(activeRecord, byId)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        kind: event.target.value as DataSourceKind,
                        body: editableInlineBody(event.target.value as DataSourceKind) ? current.body : "",
                      }))
                    }
                    disabled={isDerivedDataSource(activeRecord)}
                  >
                    {dataSourceKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {dataSourceKindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Location / Path / URL">
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:bg-zinc-50"
                    value={isDerivedDataSource(activeRecord) ? effectiveDataSourceLocation(activeRecord, byId) : draft.location}
                    onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
                    disabled={isDerivedDataSource(activeRecord)}
                    placeholder="studio-data/catalog.sqlite"
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Created At">
                  <ReadOnlyValue>{formatDate(activeRecord.created_at)}</ReadOnlyValue>
                </Field>
                <Field label="Updated At">
                  <ReadOnlyValue>{formatDate(activeRecord.updated_at)}</ReadOnlyValue>
                </Field>
              </div>

              <WorkflowTypeEditor
                value={draft.type}
                onChange={(value, jsonError) => {
                  setDraft((current) => ({ ...current, type: value }));
                  setTypeError(jsonError);
                }}
              />

              <Field label="Tags">
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  placeholder="songs, matching, catalog"
                />
              </Field>

              <Field label="Description">
                <textarea
                  className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                />
              </Field>

              <Field
                label="Body / Contents"
                hint={
                  isDerivedDataSource(activeRecord)
                    ? "Derived sources inherit root contents and cannot edit them directly."
                    : editableInlineBody(draft.kind)
                      ? "Inline editing is supported for JSON, text, and API samples."
                      : "This source kind is metadata-only in v1."
                }
              >
                <textarea
                  className="min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:bg-zinc-50"
                  value={isDerivedDataSource(activeRecord) ? effectiveDataSourceBody(activeRecord, byId) : draft.body}
                  onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                  disabled={isDerivedDataSource(activeRecord) || !editableInlineBody(draft.kind)}
                  spellCheck={false}
                />
              </Field>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Derivation" className="shadow-none">
                  <div className="space-y-3">
                    {activeParent ? (
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                        Parent: <button type="button" className="font-mono text-zinc-950 underline" onClick={() => setActiveId(activeParent.id)}>{activeParent.id}</button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500">Root source</div>
                    )}
                    {activeChildren.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500">No derived children.</div>
                    ) : (
                      <div className="space-y-2">
                        {activeChildren.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-left hover:border-zinc-300 hover:bg-zinc-50"
                            onClick={() => setActiveId(child.id)}
                          >
                            <div className="font-medium text-zinc-900">{child.name}</div>
                            <div className="mt-1 font-mono text-[11px] text-zinc-500">{child.id}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>

                <Panel title="References" className="shadow-none">
                  {activeReferences.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500">No workflow references.</div>
                  ) : (
                    <div className="space-y-2">
                      {activeReferences.map((reference) => (
                        <div key={`${reference.workflowId}:${reference.nodeId}`} className="rounded-lg border border-zinc-200 px-3 py-2">
                          <div className="font-medium text-zinc-900">{reference.workflowName}</div>
                          <div className="mt-1 text-xs text-zinc-500">{reference.nodeTitle}</div>
                          {onOpenWorkflow ? (
                            <button
                              type="button"
                              className="mt-2 text-xs font-medium text-zinc-900 underline"
                              onClick={() => onOpenWorkflow(reference.workflowId)}
                            >
                              Open workflow
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </div>

              {(activeDeleteBlockers.childCount > 0 || activeDeleteBlockers.referenceCount > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  Delete blocked: {activeDeleteBlockers.referenceCount} workflow reference{activeDeleteBlockers.referenceCount === 1 ? "" : "s"} and {activeDeleteBlockers.childCount} derived child{activeDeleteBlockers.childCount === 1 ? "" : "ren"} depend on this source.
                </div>
              )}

              {showDerivationForm && derivationDraft ? (
                <Panel title="Create Derivation" className="shadow-none">
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Child ID">
                        <input
                          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                          value={derivationDraft.id}
                          onBlur={() =>
                            setDerivationDraft((current) =>
                              current ? { ...current, id: normalizeDataSourceId(current.id) } : current,
                            )
                          }
                          onChange={(event) =>
                            setDerivationDraft((current) =>
                              current ? { ...current, id: event.target.value } : current,
                            )
                          }
                        />
                      </Field>
                      <Field label="Child Name">
                        <input
                          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                          value={derivationDraft.name}
                          onChange={(event) =>
                            setDerivationDraft((current) =>
                              current ? { ...current, name: event.target.value } : current,
                            )
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Summary">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={derivationDraft.summary ?? ""}
                        onChange={(event) =>
                          setDerivationDraft((current) =>
                            current ? { ...current, summary: event.target.value } : current,
                          )
                        }
                      />
                    </Field>
                    <WorkflowTypeEditor
                      value={derivationDraft.type}
                      onChange={(value, jsonError) => {
                        setDerivationDraft((current) => (current ? { ...current, type: value } : current));
                        setDerivationTypeError(jsonError);
                      }}
                    />
                    <Field label="Tags">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={derivationTags}
                        onChange={(event) => setDerivationTags(event.target.value)}
                      />
                    </Field>
                    <Field label="Description">
                      <textarea
                        className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={derivationDraft.description}
                        onChange={(event) =>
                          setDerivationDraft((current) =>
                            current ? { ...current, description: event.target.value } : current,
                          )
                        }
                      />
                    </Field>
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                      Parent type compatibility: {workflowTypesAssignable(activeRecord.type, derivationDraft.type) ? "compatible" : "incompatible"}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                        onClick={() => setShowDerivationForm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
                        onClick={createDerivation}
                      >
                        Save Derivation
                      </button>
                    </div>
                  </div>
                </Panel>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </section>
  );
}

function CreateDataSourceWizard({
  step,
  draft,
  tagText,
  populationMode,
  typeError,
  onDraftChange,
  onTagTextChange,
  onPopulationModeChange,
  onTypeChange,
  onSelectKind,
  onBack,
  onCancel,
  onContinue,
  onCreate,
}: {
  step: "schema" | "population";
  draft: DataSourceUpsert;
  tagText: string;
  populationMode: DataSourcePopulationMode;
  typeError: string | null;
  onDraftChange: (next: DataSourceUpsert | ((current: DataSourceUpsert) => DataSourceUpsert)) => void;
  onTagTextChange: (value: string) => void;
  onPopulationModeChange: (mode: DataSourcePopulationMode) => void;
  onTypeChange: (value: DataSourceUpsert["type"], jsonError: string | null) => void;
  onSelectKind: (kind: DataSourceKind) => void;
  onBack: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onCreate: () => Promise<void>;
}) {
  const populationOptions = dataSourcePopulationOptions(draft.kind);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Badge tone={step === "schema" ? "sky" : "neutral"}>1. Schema</Badge>
        <Badge tone={step === "population" ? "sky" : "neutral"}>2. Data</Badge>
      </div>

      <Panel
        title="Choose A Starting Schema"
        description="Start from a source preset, then adjust the type contract if the default shape is too loose or too strict."
        className="shadow-none"
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dataSourceKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cn(
                  "rounded-lg border px-3 py-3 text-left transition",
                  draft.kind === kind
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50",
                )}
                onClick={() => onSelectKind(kind)}
              >
                <div className="font-medium">{dataSourceKindLabel(kind)}</div>
                <div className="mt-1 text-xs opacity-80">{describeDataSourceKind(kind)}</div>
              </button>
            ))}
          </div>
          <WorkflowTypeEditor value={draft.type} onChange={onTypeChange} />
        </div>
      </Panel>

      {step === "population" ? (
        <Panel
          title="Choose How To Populate It"
          description="This decides whether the source stores inline contents, points at an external location, or exists as a typed contract only."
          className="shadow-none"
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {populationOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition",
                    populationMode === option.value
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50",
                  )}
                  onClick={() => onPopulationModeChange(option.value)}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="mt-1 text-xs opacity-80">{option.description}</div>
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="ID">
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={draft.id}
                  onBlur={() => onDraftChange((current) => ({ ...current, id: normalizeDataSourceId(current.id) }))}
                  onChange={(event) => onDraftChange((current) => ({ ...current, id: event.target.value }))}
                />
              </Field>
              <Field label="Name">
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={draft.name}
                  onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Kind">
                <ReadOnlyValue>{dataSourceKindLabel(draft.kind)}</ReadOnlyValue>
              </Field>
              <Field label="Type Summary">
                <ReadOnlyValue>{formatWorkflowTypeSpec(draft.type)}</ReadOnlyValue>
              </Field>
            </div>

            {populationMode === "location" ? (
              <Field label={locationFieldLabel(draft.kind)} hint={locationFieldHint(draft.kind)}>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={draft.location}
                  onChange={(event) => onDraftChange((current) => ({ ...current, location: event.target.value }))}
                  placeholder={locationPlaceholder(draft.kind)}
                />
              </Field>
            ) : null}

            {populationMode === "inline" && editableInlineBody(draft.kind) ? (
              <Field label={inlineBodyLabel(draft.kind)} hint={inlineBodyHint(draft.kind, typeError)}>
                <textarea
                  className="min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={draft.body}
                  onChange={(event) => onDraftChange((current) => ({ ...current, body: event.target.value }))}
                  placeholder={inlineBodyPlaceholder(draft.kind)}
                  spellCheck={false}
                />
              </Field>
            ) : null}

            {populationMode === "metadata" ? (
              <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
                This will create the typed source without attaching a body or location yet. You can fill those in later from the editor.
              </div>
            ) : null}

            <Field label="Tags">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={tagText}
                onChange={(event) => onTagTextChange(event.target.value)}
                placeholder="songs, matching, catalog"
              />
            </Field>

            <Field label="Description">
              <textarea
                className="min-h-24 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={draft.description}
                onChange={(event) => onDraftChange((current) => ({ ...current, description: event.target.value }))}
              />
            </Field>
          </div>
        </Panel>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {step === "population" ? (
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={onBack}
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          onClick={onCancel}
        >
          Cancel
        </button>
        {step === "schema" ? (
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={onContinue}
          >
            Continue To Data
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={() => void onCreate()}
          >
            Create Source
          </button>
        )}
      </div>
    </div>
  );
}

function isDerivedOriginRecord<T extends { origin: DataSourceOrigin }>(
  record: T,
): record is T & { origin: Extract<DataSourceOrigin, { mode: "derived_view" }> } {
  return record.origin.mode === "derived_view";
}

function describeDataSourceKind(kind: DataSourceKind): string {
  switch (kind) {
    case "sqlite":
      return "Structured records backed by a local SQLite database file.";
    case "json":
      return "Structured JSON documents, objects, or arrays.";
    case "csv":
      return "Tabular rows from a CSV file with a typed record shape.";
    case "txt":
      return "Plain text, prompts, notes, or templates.";
    case "folder":
      return "A directory-shaped source whose contents are treated as a bucket.";
    case "api":
      return "HTTP responses or endpoint contracts with typed payloads.";
    case "other":
      return "Anything else that still needs a stable typed handle.";
  }
}

function locationFieldLabel(kind: DataSourceKind): string {
  switch (kind) {
    case "api":
      return "Endpoint URL";
    case "folder":
      return "Folder Path";
    default:
      return "Location / Path / URL";
  }
}

function locationFieldHint(kind: DataSourceKind): string {
  switch (kind) {
    case "api":
      return "Use a full URL or a workspace-relative route description.";
    case "folder":
      return "Point this source at the directory that will satisfy the schema.";
    default:
      return "Keep the payload external and reference where it lives.";
  }
}

function locationPlaceholder(kind: DataSourceKind): string {
  switch (kind) {
    case "sqlite":
      return "studio-data/catalog.sqlite";
    case "csv":
      return "studio-data/catalog.csv";
    case "txt":
      return "studio-data/notes.txt";
    case "folder":
      return "studio-data/assets";
    case "api":
      return "https://api.example.com/catalog";
    case "json":
      return "studio-data/catalog.json";
    case "other":
      return "s3://bucket/path-or-custom-reference";
  }
}

function inlineBodyLabel(kind: DataSourceKind): string {
  switch (kind) {
    case "txt":
      return "Inline Text";
    case "api":
      return "Sample Response Body";
    default:
      return "Inline Body";
  }
}

function inlineBodyHint(kind: DataSourceKind, typeError: string | null): string {
  if (typeError) {
    return "Fix the type contract JSON above before this inline payload can be validated.";
  }
  switch (kind) {
    case "txt":
      return "Store the text contents directly in the catalog.";
    case "api":
      return "Paste a representative JSON response for this endpoint.";
    default:
      return "Paste JSON that matches the selected type contract.";
  }
}

function inlineBodyPlaceholder(kind: DataSourceKind): string {
  switch (kind) {
    case "txt":
      return "Write the source contents here...";
    case "api":
      return '{\n  "items": []\n}';
    default:
      return '{\n  "id": "example"\n}';
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-normal text-zinc-500">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{children}</div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
