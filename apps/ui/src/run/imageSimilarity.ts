import { type ImageSimilarityReport } from "../index";
import { type DataSourceRecord, getWorkflowClient } from "../api/client";
import type { WorkflowRunForm } from "./types";
import { isRecord } from "../shared/utils";

export async function runImageSimilarityWorkflow(
  form: WorkflowRunForm,
  dataSources: DataSourceRecord[],
): Promise<ImageSimilarityReport> {
  const imageSources = dataSources.filter((source) => imageCandidatesFromDataSource(source).length > 0);
  const source =
    imageSources.find((candidate) => candidate.id === form.imageDataSourceId) ??
    imageSources[0];
  if (!source) {
    throw new Error("Create a folder, JSON, or TXT data source with images, image URLs, or data URLs before running image similarity.");
  }
  const candidates = imageCandidatesFromDataSource(source);
  const query = await loadImageElement(form.imageDataUrl);
  const queryFeature = imageFeatureFromElement(query.image);
  const scored = (
    await Promise.all(
      candidates.map(async (candidate) => {
        try {
          const image = await loadImageElement(candidate.imageUrl);
          const feature = imageFeatureFromElement(image.image);
          return {
            candidate: { ...candidate, imageUrl: image.src },
            score: imageFeatureSimilarity(queryFeature, feature),
          };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter((item): item is { candidate: ImageCandidate; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);

  if (scored.length === 0) {
    throw new Error("No images in the selected data source could be loaded for comparison.");
  }

  return {
    workflow: "image-similarity",
    source: {
      data_source_id: source.id,
      data_source_name: source.name,
      candidates: candidates.length,
    },
    query: {
      name: form.imageSourceName || "query image",
      width: query.width,
      height: query.height,
      data_url: form.imageDataUrl,
    },
    matches: scored.map(({ candidate, score }, index) => ({
      rank: index + 1,
      id: candidate.id,
      title: candidate.title,
      image_url: candidate.imageUrl,
      score,
      source_id: candidate.sourceId,
      source_name: candidate.sourceName,
    })),
  };
}

interface ImageCandidate {
  id: string;
  title: string;
  imageUrl: string;
  sourceId: string;
  sourceName: string;
}

export function imageCandidatesFromDataSource(source: DataSourceRecord): ImageCandidate[] {
  const values: unknown[] = [];
  const body = source.body.trim();
  if (body) {
    if (source.kind === "txt") {
      values.push(...body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    } else {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) {
          values.push(...parsed);
        } else if (isRecord(parsed) && Array.isArray(parsed.images)) {
          values.push(...parsed.images);
        } else {
          values.push(parsed);
        }
      } catch {
        values.push(...body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      }
    }
  }
  if (source.location.trim() && looksLikeImageReference(source.location.trim())) {
    values.push(source.location.trim());
  }
  return values.flatMap((value, index) => imageCandidateFromValue(source, value, index));
}

function imageCandidateFromValue(source: DataSourceRecord, value: unknown, index: number): ImageCandidate[] {
  if (typeof value === "string") {
    const imageUrl = value.trim();
    return looksLikeImageReference(imageUrl)
      ? [{
          id: `${source.id}-${index + 1}`,
          title: imageTitleFromUrl(imageUrl, `Image ${index + 1}`),
          imageUrl,
          sourceId: source.id,
          sourceName: source.name,
        }]
      : [];
  }
  if (!isRecord(value)) {
    return [];
  }
  const imageUrl = firstString(value, ["image_url", "imageUrl", "data_url", "dataUrl", "url", "src", "image", "path"]);
  if (!imageUrl || !looksLikeImageReference(imageUrl)) {
    return [];
  }
  return [{
    id: firstString(value, ["id", "key", "name"]) ?? `${source.id}-${index + 1}`,
    title: firstString(value, ["title", "label", "name"]) ?? imageTitleFromUrl(imageUrl, `Image ${index + 1}`),
    imageUrl,
    sourceId: source.id,
    sourceName: source.name,
  }];
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function looksLikeImageReference(value: string): boolean {
  return (
    value.startsWith("data:image/") ||
    /^https?:\/\//i.test(value) ||
    /\.(png|jpe?g|webp|gif|bmp|avif|svg)(\?.*)?$/i.test(value)
  );
}

function imageTitleFromUrl(value: string, fallback: string): string {
  if (value.startsWith("data:image/")) {
    return fallback;
  }
  const last = value.split(/[/?#]/).filter(Boolean).pop();
  return last ? decodeURIComponent(last).replace(/\.[^.]+$/, "") : fallback;
}

async function loadImageElement(src: string): Promise<{ image: HTMLImageElement; width: number; height: number; src: string }> {
  const imageSrc = await resolveImageElementSrc(src);
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(imageSrc)) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight, src: imageSrc });
    image.onerror = () => reject(new Error("Image failed to load."));
    image.src = imageSrc;
  });
}

async function resolveImageElementSrc(src: string): Promise<string> {
  const trimmed = src.trim();
  if (!isLocalImagePath(trimmed)) {
    return trimmed;
  }
  return (await getWorkflowClient().dataSourceMediaUrl(trimmed)) ?? trimmed;
}

function isLocalImagePath(value: string): boolean {
  return (
    looksLikeImageReference(value) &&
    (/^(\/|~\/|\.\.?\/)/.test(value) || /^[a-z]:[\\/]/i.test(value)) &&
    !value.startsWith("data:") &&
    !/^https?:\/\//i.test(value)
  );
}

function imageFeatureFromElement(image: HTMLImageElement): number[] {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is unavailable.");
  }
  context.drawImage(image, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const feature: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    feature.push(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255);
  }
  return feature;
}

function imageFeatureSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  const rmse = Math.sqrt(sum / length);
  return Math.max(0, Math.min(1, 1 - rmse));
}
