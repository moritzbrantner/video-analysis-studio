import { useState, useMemo } from "react";
import { type TranscriptionEngine, type WhisperCppModel } from "../index";
import { type DataSourceRecord, type TranscriptionCatalog, type RunRecord } from "../api/client";
import { imageCandidatesFromDataSource } from "./imageSimilarity";
import { buildCommand, defaultTranscriptionCommand } from "./runRequests";
import type { SourceMode, WorkflowKindId, WorkflowRunForm } from "./types";
import {
  effectiveSourceMode,
  workflowInputFieldLabel,
  workflowRunInputForSurface,
} from "./workflowRunInputs";
import { Field, SegmentedControl } from "../shared/controls";
import {
  CloseIcon,
  OpenIcon,
  PlayIcon,
  RefreshIcon,
  SpinnerIcon,
  UploadIcon,
  WorkflowIcon,
} from "../shared/icons";
import { classNames, shellQuote } from "../shared/utils";
import { formatFlowPortType } from "../workflow-editor/ports";
import type { WorkflowRunInput, WorkflowRunInputModel } from "../workflow-editor/types";

function ImageSimilarityRunControls({
  form,
  dataSources,
  onChange,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
}: {
  form: WorkflowRunForm;
  dataSources: DataSourceRecord[];
  onChange: (form: WorkflowRunForm) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
}) {
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);
  const selectedSourceId = form.imageDataSourceId || dataSources[0]?.id || "";
  const selectedSource = dataSources.find((source) => source.id === selectedSourceId);
  const candidateCount = selectedSource ? imageCandidatesFromDataSource(selectedSource).length : 0;
  const disabled = runDisabled || dataSources.length === 0;

  const updateImage = (dataUrl: string, name: string) => {
    onChange({ ...form, imageDataUrl: dataUrl, imageSourceName: name });
    setPasteMessage(null);
  };
  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setPasteMessage("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateImage(String(reader.result ?? ""), file.name || "uploaded image");
    reader.onerror = () => setPasteMessage("Could not read that image.");
    reader.readAsDataURL(file);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Input</h2>
      </div>
      <div className="space-y-4 p-4">
        <Field label="Image data source">
          <select
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            value={selectedSourceId}
            onChange={(event) => onChange({ ...form, imageDataSourceId: event.target.value })}
          >
            {dataSources.length === 0 ? (
              <option value="">No image data sources</option>
            ) : (
              dataSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} ({imageCandidatesFromDataSource(source).length})
                </option>
              ))
            )}
          </select>
        </Field>

        <div
          className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4"
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
            if (file) {
              event.preventDefault();
              readFile(file);
              return;
            }
            const pasted = event.clipboardData.getData("text/plain").trim();
            if (pasted.startsWith("data:image/") || /^https?:\/\//i.test(pasted)) {
              event.preventDefault();
              updateImage(pasted, "pasted image");
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="text-sm font-medium text-zinc-950">Query image</div>
              <div className="mt-1 text-xs text-zinc-500">Paste an image, paste an image URL/data URL, or upload a file.</div>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
              <UploadIcon className="h-4 w-4" />
              Upload
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    readFile(file);
                  }
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {form.imageDataUrl ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <img src={form.imageDataUrl} alt={form.imageSourceName || "Query image"} className="max-h-56 w-full object-contain" />
            </div>
          ) : null}
          {pasteMessage ? <p className="mt-2 text-xs text-rose-600">{pasteMessage}</p> : null}
        </div>

        <div className="rounded-lg bg-zinc-950 p-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-100">
            {["studio-ui", "image-similarity", "--data-source", selectedSourceId || "none", "--top-k", "3"].map(shellQuote).join(" ")}
          </pre>
        </div>

        {validationMessage || dataSources.length === 0 ? (
          <p className="text-sm text-rose-600">
            {validationMessage ?? "Create a folder, JSON, or TXT data source with images, image URLs, or data URLs."}
          </p>
        ) : null}
        <button
          type="button"
          className={classNames(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
            disabled ? "cursor-not-allowed bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800",
          )}
          onClick={onRun}
          disabled={disabled}
        >
          {isRunning ? <SpinnerIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
          {isRunning ? "Checking" : `Find 3 similar images${candidateCount ? ` from ${candidateCount}` : ""}`}
        </button>
      </div>
    </section>
  );
}

export function WorkflowRunControls({
  form,
  inputModel,
  transcriptionCatalog,
  dataSources,
  selectedWorkflowKind,
  onChange,
  onFocusWorkflowInput,
  onRun,
  isRunning,
  runDisabled,
  validationMessage,
  activeRunId,
  activeRunRecord,
  onCancelRun,
  onRetryRun,
  onOpenReport,
}: {
  form: WorkflowRunForm;
  inputModel: WorkflowRunInputModel;
  transcriptionCatalog: TranscriptionCatalog | null;
  dataSources: DataSourceRecord[];
  selectedWorkflowKind: WorkflowKindId;
  onChange: (form: WorkflowRunForm) => void;
  onFocusWorkflowInput: (input: WorkflowRunInput) => void;
  onRun: () => void;
  isRunning: boolean;
  runDisabled: boolean;
  validationMessage: string | null;
  activeRunId: string | null;
  activeRunRecord: RunRecord | null;
  onCancelRun: () => void;
  onRetryRun: () => void;
  onOpenReport: () => void;
}) {
  const set = <K extends keyof WorkflowRunForm>(key: K, value: WorkflowRunForm[K]) =>
    onChange({ ...form, [key]: value });
  const setWorkflowInput = (key: string, value: string) =>
    onChange({ ...form, workflowInputs: { ...form.workflowInputs, [key]: value } });
  const sourceModes =
    selectedWorkflowKind === "song-analysis" || selectedWorkflowKind === "subtitle-generation"
      ? (["url", "file"] as SourceMode[])
      : form.sourceMode === "collection"
      ? (["collection"] as SourceMode[])
      : inputModel.sourceModes.length > 0
        ? inputModel.sourceModes
        : (["url", "file"] as SourceMode[]);
  const selectedSourceMode =
    selectedWorkflowKind === "song-analysis" || selectedWorkflowKind === "subtitle-generation"
      ? form.sourceMode === "file"
        ? "file"
        : "url"
      : form.sourceMode === "collection" ? "collection" : effectiveSourceMode(form, inputModel);
  const showSourceSelector = sourceModes.length > 1;
  const urlInput = workflowRunInputForSurface(inputModel, "source_url");
  const collectionInput = workflowRunInputForSurface(inputModel, "collection_url");
  const fileInput = workflowRunInputForSurface(inputModel, "file");
  const runConfigInput = workflowRunInputForSurface(inputModel, "config");
  const activeStatus = activeRunRecord?.status;
  const canCancel = Boolean(activeRunId && (activeStatus === "pending" || activeStatus === "running" || isRunning));
  const canRetry = Boolean(activeRunRecord && ["failed", "canceled", "succeeded"].includes(activeRunRecord.status));
  const canOpenReport = activeRunRecord?.status === "succeeded";
  const isRedCars = selectedWorkflowKind === "video-red-cars";
  const usesNativeWhisperCpp = form.transcriptionEngine === "whisper_cpp";
  const transcriptionModels = transcriptionCatalog?.whisper_cpp.models ?? [{ model: form.transcriptionModel, cached: false }];
  const imageDataSources = useMemo(() => dataSources.filter((source) => imageCandidatesFromDataSource(source).length > 0), [dataSources]);

  if (selectedWorkflowKind === "image-similarity") {
    return (
      <ImageSimilarityRunControls
        form={form}
        dataSources={imageDataSources}
        onChange={onChange}
        onRun={onRun}
        isRunning={isRunning}
        runDisabled={runDisabled}
        validationMessage={validationMessage}
      />
    );
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Run Input</h2>
      </div>
      <div className="space-y-4 p-4">
        {showSourceSelector && (
          <SegmentedControl<SourceMode>
            value={selectedSourceMode}
            options={sourceModes.map((mode): [SourceMode, string] => [
              mode,
              mode === "url" ? "URL" : mode === "file" ? "File" : "Collection",
            ])}
            onChange={(value) => set("sourceMode", value)}
          />
        )}

        {selectedSourceMode === "collection" ? (
          <>
            <Field
              label="Playlist or channel URL"
              action={<RunInputFocusButton input={collectionInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.url}
                placeholder="https://www.youtube.com/playlist?list=..."
                onChange={(event) => onChange({ ...form, sourceMode: "collection", url: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Max items">
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionMaxItems}
                  onChange={(event) => set("collectionMaxItems", event.target.value)}
                />
              </Field>
              <Field label="Already downloaded">
                <select
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.alreadyDownloaded}
                  onChange={(event) => set("alreadyDownloaded", event.target.value as WorkflowRunForm["alreadyDownloaded"])}
                >
                  <option value="reuse">Reuse</option>
                  <option value="skip">Skip</option>
                  <option value="include">Include</option>
                </select>
              </Field>
            </div>
            <Field label="Title contains">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.collectionTitleContains}
                placeholder="optional"
                onChange={(event) => set("collectionTitleContains", event.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Metadata duration min">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionDurationMin}
                  onChange={(event) => set("collectionDurationMin", event.target.value)}
                />
              </Field>
              <Field label="Metadata duration max">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.collectionDurationMax}
                  onChange={(event) => set("collectionDurationMax", event.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Local duration min">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.localDurationMin}
                  onChange={(event) => set("localDurationMin", event.target.value)}
                />
              </Field>
              <Field label="Local duration max">
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.localDurationMax}
                  onChange={(event) => set("localDurationMax", event.target.value)}
                />
              </Field>
            </div>
            <Field label="Local extensions">
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.localExtensions}
                onChange={(event) => set("localExtensions", event.target.value)}
              />
            </Field>
          </>
        ) : selectedSourceMode === "url" ? (
          <Field
            label={workflowInputFieldLabel("YouTube URL", urlInput)}
            action={<RunInputFocusButton input={urlInput} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.url}
              placeholder="https://www.youtube.com/watch?v=..."
              onChange={(event) => onChange({ ...form, sourceMode: "url", url: event.target.value })}
            />
          </Field>
        ) : (
          <Field
            label={workflowInputFieldLabel("Input file", fileInput)}
            action={<RunInputFocusButton input={fileInput} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.input}
              onChange={(event) => onChange({ ...form, sourceMode: "file", input: event.target.value })}
            />
          </Field>
        )}

        {inputModel.configInputs.length > 0 && (
          <>
            <Field
              label={workflowInputFieldLabel("Work directory", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.workDir}
                onChange={(event) => set("workDir", event.target.value)}
              />
            </Field>

            {selectedWorkflowKind === "subtitle-generation" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={workflowInputFieldLabel("Transcription engine", runConfigInput)}>
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label="Whisper.cpp model">
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Transcriber command">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked
                    readOnly
                  />
                  <span>Write SRT next to video file</span>
                </label>
              </>
            ) : selectedWorkflowKind !== "song-analysis" ? (
              <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={workflowInputFieldLabel("Scene threshold", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.sceneThreshold}
                  onChange={(event) => set("sceneThreshold", Number(event.target.value))}
                />
              </Field>
              <Field
                label={workflowInputFieldLabel("Minimum scene frames", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.minSceneLen}
                  onChange={(event) => set("minSceneLen", Number(event.target.value))}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={workflowInputFieldLabel("Max frames", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="all"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.maxFrames}
                  onChange={(event) => set("maxFrames", event.target.value)}
                />
              </Field>
              <Field
                label={workflowInputFieldLabel("Visual sample step", runConfigInput)}
                action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                  value={form.visualSampleEvery}
                  onChange={(event) => set("visualSampleEvery", Number(event.target.value))}
                />
              </Field>
            </div>

            {!isRedCars && (
              <>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked={form.skipTranscription}
                    onChange={(event) => set("skipTranscription", event.target.checked)}
                  />
                  <span>Skip transcription</span>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={workflowInputFieldLabel("Transcription engine", runConfigInput)}
                    action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                  >
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label={workflowInputFieldLabel("Whisper.cpp model", runConfigInput)}>
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label={workflowInputFieldLabel("Transcriber command", runConfigInput)}>
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
              </>
            )}

            {isRedCars && (
              <>
                <Field
                  label={workflowInputFieldLabel("Thing to detect", runConfigInput)}
                  action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                >
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.targetObject}
                    placeholder="car"
                    onChange={(event) => set("targetObject", event.target.value)}
                  />
                </Field>
                <p className="text-xs text-zinc-500">
                  The built-in detector only supports car, vehicle, or automobile. Use a custom detector command for
                  other targets.
                </p>
              </>
            )}

            <Field
              label={workflowInputFieldLabel(isRedCars ? "Vehicle detector command override" : "Object command", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.objectCommand}
                placeholder={isRedCars ? "auto: default detector + Facebook SAM bundle" : "optional"}
                onChange={(event) => set("objectCommand", event.target.value)}
              />
            </Field>
            {!isRedCars && (
              <>
                <Field
                  label={workflowInputFieldLabel("OCR command", runConfigInput)}
                  action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                >
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.ocrCommand}
                    placeholder="optional"
                    onChange={(event) => set("ocrCommand", event.target.value)}
                  />
                </Field>
                <Field
                  label={workflowInputFieldLabel("Text command", runConfigInput)}
                  action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
                >
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.textCommand}
                    placeholder="optional"
                    onChange={(event) => set("textCommand", event.target.value)}
                  />
                </Field>
              </>
            )}
              </>
            ) : (
              <>
                <Field label={workflowInputFieldLabel("Catalog DB", runConfigInput)}>
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.songCatalogPath}
                    placeholder="default app catalog"
                    onChange={(event) => set("songCatalogPath", event.target.value)}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Min score">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMinScore}
                      onChange={(event) => set("songMinScore", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Ambiguous margin">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songAmbiguousMargin}
                      onChange={(event) => set("songAmbiguousMargin", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Candidates">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMaxCandidates}
                      onChange={(event) => set("songMaxCandidates", Number(event.target.value))}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Window seconds">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songWindowSeconds}
                      onChange={(event) => set("songWindowSeconds", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Hop seconds">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songHopSeconds}
                      onChange={(event) => set("songHopSeconds", Number(event.target.value))}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum BPM">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMinBpm}
                      onChange={(event) => set("songMinBpm", Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Maximum BPM">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                      value={form.songMaxBpm}
                      onChange={(event) => set("songMaxBpm", Number(event.target.value))}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                    checked={form.skipTranscription}
                    onChange={(event) => set("skipTranscription", event.target.checked)}
                  />
                  <span>Skip lyrics transcription</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={workflowInputFieldLabel("Lyrics engine", runConfigInput)}>
                    <TranscriptionEngineSelect
                      value={form.transcriptionEngine}
                      onChange={(value) => set("transcriptionEngine", value)}
                    />
                  </Field>
                  {usesNativeWhisperCpp ? (
                    <Field label="Whisper.cpp model">
                      <TranscriptionModelSelect
                        value={form.transcriptionModel}
                        models={transcriptionModels}
                        onChange={(value) => set("transcriptionModel", value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Lyrics transcriber command">
                      <input
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                        value={form.transcriptionCommand}
                        placeholder={defaultTranscriptionCommand(form.transcriptionEngine)}
                        onChange={(event) => set("transcriptionCommand", event.target.value)}
                      />
                    </Field>
                  )}
                </div>
                <Field label="Music analyzer command">
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    value={form.musicCommand}
                    placeholder="optional"
                    onChange={(event) => set("musicCommand", event.target.value)}
                  />
                </Field>
              </>
            )}

            <Field
              label={workflowInputFieldLabel("Output JSON", runConfigInput)}
              action={<RunInputFocusButton input={runConfigInput} onFocus={onFocusWorkflowInput} />}
            >
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                value={form.output}
                onChange={(event) => set("output", event.target.value)}
              />
            </Field>
          </>
        )}

        {inputModel.genericInputs.map((input) => (
          <Field
            key={input.key}
            label={workflowInputFieldLabel(input.port.label, input)}
            action={<RunInputFocusButton input={input} onFocus={onFocusWorkflowInput} />}
          >
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              value={form.workflowInputs[input.key] ?? ""}
              placeholder={
                input.port.valueType.type === "string" && input.port.valueType.semantic === "template_string"
                  ? "output/{{id}}.json"
                  : formatFlowPortType(input.port)
              }
              title={formatFlowPortType(input.port)}
              onChange={(event) => setWorkflowInput(input.key, event.target.value)}
            />
          </Field>
        ))}

        <div className="rounded-lg bg-zinc-950 p-3">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-zinc-100">
            {buildCommand(form, inputModel, selectedWorkflowKind).map(shellQuote).join(" ")}
          </pre>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {canCancel ? (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-700 focus:ring-offset-2"
              onClick={onCancelRun}
            >
              <CloseIcon className="h-4 w-4" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className={classNames(
                "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2",
                !canRetry && runDisabled ? "cursor-not-allowed bg-zinc-400" : "bg-zinc-950 hover:bg-zinc-800",
              )}
              onClick={canRetry ? onRetryRun : onRun}
              disabled={canRetry ? isRunning : runDisabled}
            >
              {isRunning ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : canRetry ? (
                <RefreshIcon className="h-4 w-4" />
              ) : (
                <PlayIcon className="h-4 w-4" />
              )}
              {isRunning ? "Creating run" : canRetry ? "Retry" : "Create run"}
            </button>
          )}
          {canOpenReport ? (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2"
              onClick={onOpenReport}
            >
              <OpenIcon className="h-4 w-4" />
              Open result
            </button>
          ) : null}
        </div>
        {validationMessage && <p className="text-sm text-amber-700">{validationMessage}</p>}
      </div>
    </section>
  );
}

function RunInputFocusButton({
  input,
  onFocus,
}: {
  input: WorkflowRunInput | null;
  onFocus: (input: WorkflowRunInput) => void;
}) {
  if (!input) {
    return null;
  }

  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-1"
      onClick={() => onFocus(input)}
      title={`Show ${input.port.label} in workflow`}
      aria-label={`Show ${input.port.label} in workflow`}
    >
      <WorkflowIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function TranscriptionEngineSelect({
  value,
  onChange,
}: {
  value: Exclude<TranscriptionEngine, "fast_whisper">;
  onChange: (value: Exclude<TranscriptionEngine, "fast_whisper">) => void;
}) {
  return (
    <select
      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
      value={value}
      onChange={(event) => onChange(event.target.value as Exclude<TranscriptionEngine, "fast_whisper">)}
    >
      <option value="whisper_cpp">Whisper.cpp (native)</option>
      <option value="whisper">Whisper CLI</option>
      <option value="faster_whisper">Faster Whisper</option>
      <option value="whisperx">WhisperX</option>
    </select>
  );
}

function TranscriptionModelSelect({
  value,
  models,
  onChange,
}: {
  value: WhisperCppModel;
  models: Array<{ model: WhisperCppModel; cached: boolean }>;
  onChange: (value: WhisperCppModel) => void;
}) {
  const options = models.length > 0 ? models : [{ model: value, cached: false }];
  return (
    <select
      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
      value={value}
      onChange={(event) => onChange(event.target.value as WhisperCppModel)}
    >
      {options.map((option) => (
        <option key={option.model} value={option.model}>
          {option.model}
          {option.cached ? " (cached)" : ""}
        </option>
      ))}
    </select>
  );
}
