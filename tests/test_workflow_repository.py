import json
import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from workflow_repository import WorkflowRepository, WorkflowRepositoryError


class WorkflowRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workflows_dir = Path(self.temp.name) / "Workflows"
        self.repository = WorkflowRepository(self.workflows_dir)

    def tearDown(self):
        self.temp.cleanup()

    def write_workflow(self, filename, content):
        path = self.workflows_dir / filename
        path.write_text(json.dumps(content), encoding="utf-8")
        return path

    def test_save_load_and_list_workflows(self):
        result = self.repository.save_workflow(
            "checkout",
            {"schemaVersion": 2, "name": "Checkout", "nodes": [], "edges": []},
        )

        self.assertEqual(result, {"filename": "checkout.json"})
        self.assertEqual(self.repository.list_workflows(), ["checkout.json"])
        loaded = self.repository.load_workflow("checkout.json")
        self.assertEqual(loaded["filename"], "checkout.json")
        self.assertEqual(loaded["content"]["name"], "Checkout")
        self.assertEqual(list(self.workflows_dir.glob("*.tmp")), [])

    def test_rejects_missing_or_invalid_filename(self):
        with self.assertRaisesRegex(WorkflowRepositoryError, "Missing filename"):
            self.repository.save_workflow("", {})

        with self.assertRaisesRegex(WorkflowRepositoryError, "Invalid filename"):
            self.repository.save_workflow(".", {})

    def test_delete_missing_matches_existing_protocol_error(self):
        with self.assertRaisesRegex(WorkflowRepositoryError, "File not found"):
            self.repository.delete_workflow("missing")

    def test_duplicate_reads_valid_json_and_writes_atomically(self):
        self.write_workflow("source.json", {"schemaVersion": 2, "name": "Source"})

        result = self.repository.duplicate_workflow("source.json", "copy.json")

        self.assertEqual(result["filename"], "source.json")
        self.assertEqual(result["newFilename"], "copy.json")
        self.assertEqual(
            json.loads((self.workflows_dir / "copy.json").read_text(encoding="utf-8")),
            {"schemaVersion": 2, "name": "Source"},
        )
        self.assertEqual(list(self.workflows_dir.glob("*.tmp")), [])

    def test_duplicate_refuses_missing_or_existing_target(self):
        with self.assertRaisesRegex(WorkflowRepositoryError, "Original workflow not found"):
            self.repository.duplicate_workflow("missing.json", "copy.json")

        self.write_workflow("source.json", {})
        self.write_workflow("copy.json", {})

        with self.assertRaisesRegex(WorkflowRepositoryError, "already exists"):
            self.repository.duplicate_workflow("source.json", "copy.json")

    def test_rename_preserves_original_until_target_write_succeeds(self):
        self.write_workflow("old.json", {"name": "Old"})

        result = self.repository.rename_workflow("old.json", "new.json", {"name": "New"})

        self.assertEqual(result["filename"], "old.json")
        self.assertEqual(result["newFilename"], "new.json")
        self.assertFalse((self.workflows_dir / "old.json").exists())
        self.assertEqual(
            json.loads((self.workflows_dir / "new.json").read_text(encoding="utf-8")),
            {"name": "New"},
        )

    def test_rename_same_file_rewrites_content(self):
        self.write_workflow("same.json", {"name": "Before"})

        self.repository.rename_workflow("same.json", "same.json", {"name": "After"})

        self.assertEqual(
            json.loads((self.workflows_dir / "same.json").read_text(encoding="utf-8")),
            {"name": "After"},
        )

    def test_upgrade_delegates_to_atomic_upgrade(self):
        self.write_workflow("legacy.json", {"steps": []})

        result = self.repository.upgrade_workflow(
            "legacy.json",
            {"schemaVersion": 2, "nodes": [], "edges": []},
        )

        self.assertEqual(result["backupFilename"], "legacy.json.v1.bak")
        self.assertTrue((self.workflows_dir / "legacy.json.v1.bak").exists())

    def test_workflow_summaries_are_additive_metadata(self):
        self.write_workflow(
            "tagged.json",
            {
                "id": "wf_1",
                "schemaVersion": 2,
                "name": "Tagged Flow",
                "tags": ["imports", 2026],
                "enabled": True,
            },
        )

        summaries = self.repository.list_workflow_summaries()

        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0]["id"], "wf_1")
        self.assertEqual(summaries[0]["filename"], "tagged.json")
        self.assertEqual(summaries[0]["displayName"], "Tagged Flow")
        self.assertEqual(summaries[0]["schemaVersion"], 2)
        self.assertEqual(summaries[0]["tags"], ["imports", "2026"])
        self.assertTrue(summaries[0]["enabled"])
        self.assertTrue(summaries[0]["updatedAt"])


if __name__ == "__main__":
    unittest.main()
