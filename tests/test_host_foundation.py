import json
import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from app_paths import (
    application_directory,
    default_config_file,
    default_log_file,
    default_logs_directory,
    default_workflows_directory,
)
from atomic_io import atomic_write_json, atomic_write_text


class HostFoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_source_mode_paths_use_anchor_directory(self):
        anchor = self.base_dir / "host" / "brunner_host.py"
        anchor.parent.mkdir()
        anchor.write_text("# host", encoding="utf-8")

        self.assertEqual(application_directory(anchor), anchor.parent)
        self.assertEqual(default_config_file(anchor), anchor.parent / "brunner_config.json")
        self.assertEqual(default_workflows_directory(anchor), anchor.parent / "Workflows")
        self.assertEqual(default_logs_directory(anchor), anchor.parent / "Logs")
        self.assertEqual(default_log_file(anchor), anchor.parent / "brunner_host.log")

    def test_frozen_paths_use_executable_directory(self):
        original_executable = sys.executable
        had_frozen = hasattr(sys, "frozen")
        original_frozen = getattr(sys, "frozen", None)
        executable = self.base_dir / "dist" / "BRunnerHost.exe"
        executable.parent.mkdir()
        executable.write_text("binary", encoding="utf-8")

        try:
            sys.frozen = True
            sys.executable = str(executable)

            self.assertEqual(application_directory(__file__), executable.parent)
            self.assertEqual(default_workflows_directory(__file__), executable.parent / "Workflows")
        finally:
            sys.executable = original_executable
            if had_frozen:
                sys.frozen = original_frozen
            else:
                delattr(sys, "frozen")

    def test_atomic_json_write_creates_normalized_file_without_temp_leftovers(self):
        destination = self.base_dir / "nested" / "config.json"

        atomic_write_json(destination, {"name": "BRunner", "ok": True}, indent=2)

        self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))["name"], "BRunner")
        self.assertEqual(list(destination.parent.glob("*.tmp")), [])

    def test_atomic_text_write_normalizes_newlines(self):
        destination = self.base_dir / "Logs" / "run.log"

        atomic_write_text(destination, "one\r\ntwo\rthree\n")

        self.assertEqual(destination.read_text(encoding="utf-8"), "one\ntwo\nthree\n")
        self.assertEqual(list(destination.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
