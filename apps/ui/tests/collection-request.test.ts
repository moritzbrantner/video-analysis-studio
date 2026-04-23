import { describe, expect, test } from "bun:test";

import {
  buildYoutubeCollectionManifestRequest,
  filterYoutubeCollectionManifest,
} from "../src/collection/request";
import type { YoutubeCollectionManifest } from "../src/types";

describe("collection request helpers", () => {
  test("buildYoutubeCollectionManifestRequest maps collection form fields", () => {
    expect(
      buildYoutubeCollectionManifestRequest({
        url: " https://www.youtube.com/playlist?list=abc ",
        collectionMaxItems: "5",
        collectionTitleContains: "rust",
        collectionDurationMin: "60",
        collectionDurationMax: "600",
        alreadyDownloaded: "reuse",
      }),
    ).toEqual({
      source: { kind: "playlist_url", url: "https://www.youtube.com/playlist?list=abc" },
      metadata_filter: {
        title_contains: "rust",
        title_excludes: [],
        duration_seconds_min: 60,
        duration_seconds_max: 600,
        already_downloaded: "reuse",
      },
      metadata_depth: "fast",
      max_items: 5,
    });
  });

  test("filterYoutubeCollectionManifest keeps only selected items", () => {
    const manifest: YoutubeCollectionManifest = {
      collection_id: "collection",
      source: { kind: "playlist_url", url: "https://www.youtube.com/playlist?list=abc" },
      title: "Collection",
      items: [
        { item_id: "a", source_url: "https://youtu.be/a" },
        { item_id: "b", source_url: "https://youtu.be/b" },
      ],
    };

    expect(filterYoutubeCollectionManifest(manifest, ["b"]).items.map((item) => item.item_id)).toEqual(["b"]);
  });
});
