import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Panel } from "../shared/primitives";

type PersistenceMode = "disk" | "database" | "http";

type SaveTone = "success" | "error";

interface SaveMessage {
  tone: SaveTone;
  text: string;
}

export interface StoredResultRecord<T = unknown> {
  id: string;
  label: string;
  createdAt: string;
  payload: T;
}

export interface ResultPersistencePanelProps<T> {
  result: T;
  defaultFilename?: string;
  defaultLabel?: string;
  defaultHttpUrl?: string;
}

const resultDatabaseName = "video-analysis-studio";
const resultStoreName = "analysis-results";

export function ReportShell({
  title = "Analysis Results",
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-zinc-950">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </main>
  );
}

export function JsonReportLoader<T>({
  onLoad,
  label = "Load JSON report",
}: {
  onLoad: (report: T) => void;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Panel title={label}>
      <input
        className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) {
            return;
          }
          file
            .text()
            .then((text) => {
              onLoad(JSON.parse(text) as T);
              setError(null);
            })
            .catch((nextError: unknown) => {
              setError(nextError instanceof Error ? nextError.message : "Invalid JSON report");
            });
        }}
      />
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </Panel>
  );
}

export function ResultPersistencePanel<T>({
  result,
  defaultFilename = "analysis-result.json",
  defaultLabel = "Analysis result",
  defaultHttpUrl = "",
}: ResultPersistencePanelProps<T>) {
  const [mode, setMode] = useState<PersistenceMode>("disk");
  const serialized = useMemo(() => JSON.stringify(result, null, 2), [result]);

  return (
    <Panel title="Save Results" description={`${formatBytes(serialized.length)} JSON payload`}>
      <div className="space-y-4">
        <div className="inline-grid w-full grid-cols-3 rounded-lg border border-zinc-200 bg-zinc-100 p-1">
          {(["disk", "database", "http"] as PersistenceMode[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 ${
                mode === option ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950"
              }`}
              onClick={() => setMode(option)}
            >
              {option === "disk" && <DiskIcon className="h-3.5 w-3.5" />}
              {option === "database" && <DatabaseIcon className="h-3.5 w-3.5" />}
              {option === "http" && <HttpIcon className="h-3.5 w-3.5" />}
              {option === "disk" ? "Disk" : option === "database" ? "Database" : "HTTP"}
            </button>
          ))}
        </div>

        {mode === "disk" && <DiskResultSaver result={result} defaultFilename={defaultFilename} />}
        {mode === "database" && <DatabaseResultSaver result={result} defaultLabel={defaultLabel} />}
        {mode === "http" && (
          <HttpResultSender result={result} serialized={serialized} defaultHttpUrl={defaultHttpUrl} />
        )}
      </div>
    </Panel>
  );
}

export function DiskResultSaver<T>({
  result,
  defaultFilename = "analysis-result.json",
}: {
  result: T;
  defaultFilename?: string;
}) {
  const [filename, setFilename] = useState(defaultFilename);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  useEffect(() => {
    setFilename(defaultFilename);
  }, [defaultFilename]);

  return (
    <div className="space-y-3">
      <PersistenceField label="Filename">
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={filename}
          onChange={(event) => setFilename(event.target.value)}
        />
      </PersistenceField>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
        onClick={() => {
          const nextFilename = ensureJsonFilename(filename.trim() || defaultFilename);
          downloadJsonResult(result, nextFilename);
          setMessage({ tone: "success", text: `Prepared ${nextFilename}` });
        }}
      >
        <DiskIcon className="h-4 w-4" />
        Save JSON
      </button>
      <SaveMessageLine message={message} />
    </div>
  );
}

export function DatabaseResultSaver<T>({
  result,
  defaultLabel = "Analysis result",
}: {
  result: T;
  defaultLabel?: string;
}) {
  const [label, setLabel] = useState(defaultLabel);
  const [records, setRecords] = useState<Array<StoredResultRecord<T>>>([]);
  const [message, setMessage] = useState<SaveMessage | null>(null);

  useEffect(() => {
    setLabel(defaultLabel);
  }, [defaultLabel]);

  useEffect(() => {
    let active = true;
    listStoredResults<T>()
      .then((nextRecords) => {
        if (active) {
          setRecords(nextRecords);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage({ tone: "error", text: errorMessage(error) });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveToDatabase() {
    try {
      const record = await saveResultToIndexedDb(result, label.trim() || defaultLabel);
      setRecords((currentRecords) => [record, ...currentRecords.filter((current) => current.id !== record.id)].slice(0, 5));
      setMessage({ tone: "success", text: `Saved ${record.label}` });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-3">
      <PersistenceField label="Record label">
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </PersistenceField>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
        onClick={saveToDatabase}
      >
        <DatabaseIcon className="h-4 w-4" />
        Save Record
      </button>
      <SaveMessageLine message={message} />
      <div className="rounded-lg border border-zinc-200">
        <div className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
          Recent Records
        </div>
        {records.length === 0 ? (
          <div className="px-3 py-3 text-sm text-zinc-500">No saved records</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {records.slice(0, 5).map((record) => (
              <div key={record.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900">{record.label}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{formatTimestamp(record.createdAt)}</div>
                </div>
                <span className="text-xs font-medium text-zinc-500">IndexedDB</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function HttpResultSender<T>({
  result,
  serialized = JSON.stringify(result, null, 2),
  defaultHttpUrl = "",
}: {
  result: T;
  serialized?: string;
  defaultHttpUrl?: string;
}) {
  const [url, setUrl] = useState(defaultHttpUrl);
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [message, setMessage] = useState<SaveMessage | null>(null);

  async function sendRequest() {
    try {
      const endpoint = url.trim();
      if (!endpoint) {
        throw new Error("Enter an HTTP endpoint.");
      }
      const parsedHeaders = parseHeaders(headers);
      const response = await fetch(endpoint, {
        method,
        headers: parsedHeaders,
        body: method === "GET" || method === "HEAD" ? undefined : serialized,
      });
      setMessage({
        tone: response.ok ? "success" : "error",
        text: `${response.status} ${response.statusText || "response"}`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <PersistenceField label="Method">
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
          </select>
        </PersistenceField>
        <PersistenceField label="Endpoint">
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={url}
            placeholder="https://example.com/results"
            onChange={(event) => setUrl(event.target.value)}
          />
        </PersistenceField>
      </div>
      <PersistenceField label="Headers JSON">
        <textarea
          className="min-h-24 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          value={headers}
          onChange={(event) => setHeaders(event.target.value)}
        />
      </PersistenceField>
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
        onClick={sendRequest}
      >
        <HttpIcon className="h-4 w-4" />
        Send Request
      </button>
      <SaveMessageLine message={message} />
    </div>
  );
}

export function downloadJsonResult<T>(result: T, filename = "analysis-result.json") {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ensureJsonFilename(filename);
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveResultToIndexedDb<T>(payload: T, label: string): Promise<StoredResultRecord<T>> {
  const record: StoredResultRecord<T> = {
    id: createRecordId(),
    label,
    createdAt: new Date().toISOString(),
    payload,
  };
  const database = await openResultDatabase();
  await runResultStoreRequest<IDBValidKey>(database, "readwrite", (store) => store.put(record));
  database.close();
  return record;
}

export async function listStoredResults<T>(): Promise<Array<StoredResultRecord<T>>> {
  const database = await openResultDatabase();
  const records = await runResultStoreRequest<StoredResultRecord<T>[]>(database, "readonly", (store) => store.getAll());
  database.close();
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function PersistenceField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function SaveMessageLine({ message }: { message: SaveMessage | null }) {
  if (!message) {
    return null;
  }
  return (
    <p className={message.tone === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>
      {message.text}
    </p>
  );
}

function parseHeaders(value: string): HeadersInit {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object.");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([key, headerValue]) => [key, String(headerValue)]),
  );
}

function openResultDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(resultDatabaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(resultStoreName)) {
        database.createObjectStore(resultStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open results database."));
  });
}

function runResultStoreRequest<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(resultStoreName, mode);
    const store = transaction.objectStore(resultStoreName);
    const request = createRequest(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Result database request failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Result database transaction failed."));
  });
}

function ensureJsonFilename(filename: string): string {
  return filename.toLowerCase().endsWith(".json") ? filename : `${filename}.json`;
}

function createRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `result-${crypto.randomUUID()}`;
  }
  return `result-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DiskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 3.5h9.5L16 6v10.5H4V3.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 3.5v5h6v-5M7 14h6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 5c0-1.38 2.69-2.5 6-2.5s6 1.12 6 2.5-2.69 2.5-6 2.5S4 6.38 4 5Zm0 0v5c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5m-12 5v5c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5v-5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function HttpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 6.5h13v7h-13v-7Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10h2m2 0h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
