#!/usr/bin/env python3
"""Keep transport/UI crates behind the studio-core capability façade."""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTER_MANIFESTS = (
    ROOT / "crates" / "studio-api" / "Cargo.toml",
    ROOT / "apps" / "desktop" / "src-tauri" / "Cargo.toml",
)
FORBIDDEN_PREFIXES = (
    "audio-analysis-",
    "text-transcripts",
    "video-analysis-",
)


def main() -> int:
    violations: list[str] = []
    for manifest in OUTER_MANIFESTS:
        data = tomllib.loads(manifest.read_text(encoding="utf-8"))
        dependencies = data.get("dependencies", {})
        for dependency in sorted(dependencies):
            if dependency.startswith(FORBIDDEN_PREFIXES):
                violations.append(f"{manifest.relative_to(ROOT)}: direct `{dependency}` dependency")

        if "studio-core" not in dependencies:
            violations.append(f"{manifest.relative_to(ROOT)}: missing `studio-core` façade dependency")

    if violations:
        print("video-analysis-studio dependency boundary violations:")
        for violation in violations:
            print(f"- {violation}")
        print("Transport and desktop layers must compose media capabilities through studio-core.")
        return 1

    print("video-analysis-studio dependency boundaries: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
