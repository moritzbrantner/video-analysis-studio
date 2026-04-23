import type {
  AlreadyDownloadedPolicy,
  YoutubeCollectionManifest,
  YoutubeCollectionManifestRequest,
  YoutubeCollectionSource,
} from "../types";

export interface YoutubeCollectionFormFields {
  url: string;
  collectionMaxItems: string;
  collectionTitleContains: string;
  collectionDurationMin: string;
  collectionDurationMax: string;
  alreadyDownloaded: AlreadyDownloadedPolicy;
}

export function buildYoutubeCollectionManifestRequest(
  form: YoutubeCollectionFormFields,
): YoutubeCollectionManifestRequest {
  return {
    source: { kind: youtubeCollectionSourceKind(form.url), url: form.url.trim() },
    metadata_filter: {
      title_contains: form.collectionTitleContains.trim() || null,
      title_excludes: [],
      duration_seconds_min: optionalNumber(form.collectionDurationMin),
      duration_seconds_max: optionalNumber(form.collectionDurationMax),
      already_downloaded: form.alreadyDownloaded,
    },
    metadata_depth: "fast",
    max_items: optionalInteger(form.collectionMaxItems),
  };
}

export function filterYoutubeCollectionManifest(
  manifest: YoutubeCollectionManifest,
  selectedItemIds: string[],
): YoutubeCollectionManifest {
  const selected = new Set(selectedItemIds);
  return {
    ...manifest,
    items: manifest.items.filter((item) => selected.has(item.item_id)),
  };
}

function youtubeCollectionSourceKind(url: string): YoutubeCollectionSource["kind"] {
  const normalized = url.toLowerCase();
  if (normalized.includes("/channel/") || normalized.includes("/@")) {
    return "channel_url";
  }
  if (normalized.includes("list=") || normalized.includes("/playlist")) {
    return "playlist_url";
  }
  return "youtube_url";
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalInteger(value: string): number | null {
  const parsed = optionalNumber(value);
  return parsed == null ? null : Math.max(1, Math.floor(parsed));
}
