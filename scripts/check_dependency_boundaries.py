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
    "text-analysis-",
    "video-analysis-",
    "moenarch-audio-analysis-",
    "moenarch-text-",
    "moenarch-video-analysis-",
)


def dependency_tables(data):
    for group in ("dependencies", "dev-dependencies", "build-dependencies"):
        yield group, data.get(group, {})
    for target, tables in data.get("target", {}).items():
        for group in ("dependencies", "dev-dependencies", "build-dependencies"):
            yield f"target.{target}.{group}", tables.get(group, {})


def package_identity(key, value, workspace):
    if isinstance(value, dict) and value.get("workspace") is True:
        value = workspace.get(key, {})
    return value.get("package", key) if isinstance(value, dict) else key


def main() -> int:
    violations: list[str] = []
    root = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
    workspace = root.get("workspace", {}).get("dependencies", {})
    for manifest in OUTER_MANIFESTS:
        data = tomllib.loads(manifest.read_text(encoding="utf-8"))
        for group, dependencies in dependency_tables(data):
            for key, value in sorted(dependencies.items()):
                package = package_identity(key, value, workspace)
                if package.startswith(FORBIDDEN_PREFIXES):
                    violations.append(f"{manifest.relative_to(ROOT)} [{group}]: direct `{package}` dependency (key `{key}`)")

        runtime_packages = {
            package_identity(key, value, workspace)
            for key, value in data.get("dependencies", {}).items()
        }
        if "studio-core" not in runtime_packages:
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
