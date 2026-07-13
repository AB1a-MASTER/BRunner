import sys
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from packaging_config import (
    APP_NAME,
    ENTRY_SCRIPT,
    HIDDEN_IMPORTS,
    MODULE_EXCLUDES,
    RELEASE_EXCLUDE_PATTERNS,
)
from release_packager import (
    build_release_manifest,
    is_release_excluded,
    normalize_release_name,
    stage_release_bundle,
)


class PackagingConfigTests(unittest.TestCase):
    def test_pyinstaller_entry_and_hidden_imports_cover_current_host_modules(self):
        self.assertEqual(APP_NAME, "BRunnerHost")
        self.assertEqual(ENTRY_SCRIPT, "app.py")

        required = {
            "brunner_host",
            "cv2",
            "desktop.main_window",
            "directory_registry",
            "fallback_input",
            "PIL.Image",
            "PySide6.QtWidgets",
            "visual_match",
            "window_validation",
            "workflow_repository",
        }
        self.assertTrue(required.issubset(set(HIDDEN_IMPORTS)))
        self.assertIn("PyQt5", MODULE_EXCLUDES)
        self.assertIn("tkinter", MODULE_EXCLUDES)
        self.assertIn("_tkinter", MODULE_EXCLUDES)

    def test_release_excludes_runtime_and_development_outputs(self):
        self.assertIn("tests", MODULE_EXCLUDES)
        self.assertIn("build/", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("dist/", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("Logs/", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("Workflows/", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("release/", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("brunner_config.json", RELEASE_EXCLUDE_PATTERNS)
        self.assertIn("brunner_host copy.py", RELEASE_EXCLUDE_PATTERNS)

    def test_release_exclude_matching_covers_nested_runtime_artifacts(self):
        self.assertTrue(is_release_excluded("Logs/run.log"))
        self.assertTrue(is_release_excluded("AllowedFiles/acceptance/input.txt"))
        self.assertTrue(is_release_excluded("Workflows/recording.json"))
        self.assertTrue(is_release_excluded("__pycache__/module.pyc"))
        self.assertTrue(is_release_excluded("brunner_config.json"))
        self.assertTrue(is_release_excluded("nested/brunner_host.log"))
        self.assertTrue(is_release_excluded("nested/config.v1.bak"))
        self.assertFalse(is_release_excluded("README.md"))
        self.assertFalse(is_release_excluded("BRunnerHost.exe"))

    def test_release_bundle_stages_executable_docs_and_manifest_only(self):
        with self.subTest("bundle name is filesystem safe"):
            self.assertEqual(normalize_release_name("v1 beta"), "BRunnerHost-v1-beta")

        import json
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            host = root / "host"
            output = root / "out"
            (host / "dist").mkdir(parents=True)
            (host / "dist" / "BRunnerHost.exe").write_bytes(b"exe")
            (host / "README.md").write_text("readme", encoding="utf-8")
            (host / "Logs").mkdir()
            (host / "Logs" / "run.log").write_text("nope", encoding="utf-8")
            (host / "Workflows").mkdir()
            (host / "Workflows" / "recording.json").write_text("{}", encoding="utf-8")
            (host / "brunner_config.json").write_text("{}", encoding="utf-8")

            manifest = build_release_manifest(host, "v1 beta")
            self.assertEqual(manifest["name"], "BRunnerHost-v1-beta")

            bundle = stage_release_bundle(host, output, "v1 beta")
            self.assertTrue((bundle / "BRunnerHost.exe").is_file())
            self.assertTrue((bundle / "README.md").is_file())
            self.assertFalse((bundle / "Logs").exists())
            self.assertFalse((bundle / "Workflows").exists())
            self.assertFalse((bundle / "brunner_config.json").exists())

            saved_manifest = json.loads((bundle / "release_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(
                sorted(item["target"] for item in saved_manifest["files"]),
                ["BRunnerHost.exe", "README.md"],
            )

    def test_pyinstaller_scripts_use_shared_packaging_config(self):
        spec = (HOST_DIR / "BRunnerHost.spec").read_text(encoding="utf-8")
        builder = (HOST_DIR / "build_host_ui.py").read_text(encoding="utf-8")

        self.assertIn("from packaging_config import", spec)
        self.assertIn("HIDDEN_IMPORTS", spec)
        self.assertIn("MODULE_EXCLUDES", spec)
        self.assertIn("BRunnerHost.spec", builder)
        self.assertIn('"--clean"', builder)
        self.assertNotIn("--hidden-import", builder)


if __name__ == "__main__":
    unittest.main()
