#!/usr/bin/env python3
"""Exercise the boundary guard through real Cargo manifest fixtures."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class DependencyBoundaryTests(unittest.TestCase):
    def check(self, extra="", workspace="", facade='studio-core = { path = "../studio-core" }'):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copyfile(ROOT / "scripts/check_dependency_boundaries.py", root / "scripts/check_dependency_boundaries.py")
            (root / "Cargo.toml").write_text("[workspace.dependencies]\n" + workspace)
            for manifest in ["crates/studio-api/Cargo.toml", "apps/desktop/src-tauri/Cargo.toml"]:
                path = root / manifest
                path.parent.mkdir(parents=True)
                path.write_text('[dependencies]\n' + facade + '\n' + extra)
            return subprocess.run(["python3", str(root / "scripts/check_dependency_boundaries.py")], capture_output=True, text=True)

    def test_current_facade_is_allowed(self):
        self.assertEqual(self.check().returncode, 0)

    def test_all_dependency_tables_reject_canonical_and_renamed_capabilities(self):
        for table in ["dependencies", "dev-dependencies", "build-dependencies", "target.'cfg(unix)'.dependencies", "target.'cfg(unix)'.dev-dependencies", "target.'cfg(unix)'.build-dependencies"]:
            for package in ["moenarch-audio-analysis-processing", "moenarch-text-transcripts", "moenarch-video-analysis-core", "text-analysis-core", "text-analysis-transcription", "image-analysis-core", "image-analysis-segmentation"]:
                with self.subTest(table=table, package=package):
                    extra = ('vision = { package = "' + package + '", version = "1" }') if table == "dependencies" else ('[' + table + ']\nvision = { package = "' + package + '", version = "1" }')
                    result = self.check(extra)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assertIn(package, result.stdout)

    def test_workspace_alias_resolves_its_package_identity(self):
        result = self.check('vision.workspace = true', 'vision = { package = "moenarch-video-analysis-core", version = "1" }')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("moenarch-video-analysis-core", result.stdout)

    def test_renamed_facade_is_allowed(self):
        self.assertEqual(self.check(facade='composition = { package = "studio-core", path = "../studio-core" }').returncode, 0)

    def test_missing_facade_is_rejected(self):
        self.assertNotEqual(self.check(facade='serde = "1"').returncode, 0)


if __name__ == "__main__":
    unittest.main()
