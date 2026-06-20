import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from execution_log_storage import ExecutionLogStorageError, save_execution_log


class ExecutionLogStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.logs_dir = Path(self.temp.name) / "Logs"
        self.saved_at = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp.cleanup()

    def test_saves_allowlisted_log_without_paths_or_secret_fields(self):
        result = save_execution_log(
            self.logs_dir,
            "My Workflow",
            "run_123",
            [{
                "timestamp": "2026-06-20T12:00:00Z",
                "status": "failed",
                "scope": "node",
                "nodeId": "request-1",
                "action": "http.request",
                "message": "http.request failed (http error).",
                "body": "secret body",
                "path": "C:/private/file.txt",
                "diagnostics": {
                    "finalReason": "http_error",
                    "status": 422,
                    "headers": {"authorization": "secret"},
                },
            }],
            self.saved_at,
        )

        self.assertEqual(
            result["filename"],
            "My-Workflow-run_123-20260620T120000Z.log",
        )
        self.assertEqual(result["entries"], 1)
        content = (self.logs_dir / result["filename"]).read_text(encoding="utf-8")
        self.assertIn("http_error", content)
        self.assertNotIn("secret body", content)
        self.assertNotIn("authorization", content)
        self.assertNotIn("C:/private", content)
        self.assertNotIn("path", result)

    def test_bounds_saved_events_to_latest_two_hundred(self):
        entries = [{"message": f"event {index}"} for index in range(205)]
        result = save_execution_log(
            self.logs_dir, "Flow", "run", entries, self.saved_at
        )
        content = (self.logs_dir / result["filename"]).read_text(encoding="utf-8")
        self.assertEqual(result["entries"], 200)
        self.assertNotIn("event 0\n", content)
        self.assertIn("event 204", content)

    def test_rejects_non_array_or_non_object_entries(self):
        with self.assertRaisesRegex(ExecutionLogStorageError, "array"):
            save_execution_log(self.logs_dir, "Flow", "run", {}, self.saved_at)
        with self.assertRaisesRegex(ExecutionLogStorageError, "object"):
            save_execution_log(self.logs_dir, "Flow", "run", ["bad"], self.saved_at)


if __name__ == "__main__":
    unittest.main()
