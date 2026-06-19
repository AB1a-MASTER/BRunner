import json
import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from workflow_storage import WorkflowUpgradeError, atomic_upgrade_workflow


class WorkflowStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workflow_path = Path(self.temp.name) / "sample.json"
        self.v1 = {"steps": [{"id": "one", "action": "element.click"}]}
        self.workflow_path.write_text(json.dumps(self.v1), encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_atomic_upgrade_keeps_exact_v1_backup(self):
        v2 = {"schemaVersion": 2, "nodes": [], "edges": [], "entryNodeId": ""}
        result = atomic_upgrade_workflow(self.workflow_path, v2)

        backup = Path(f"{self.workflow_path}.v1.bak")
        self.assertEqual(json.loads(self.workflow_path.read_text(encoding="utf-8")), v2)
        self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), self.v1)
        self.assertEqual(result["backupFilename"], "sample.json.v1.bak")

    def test_invalid_upgrade_leaves_original_untouched(self):
        with self.assertRaisesRegex(WorkflowUpgradeError, "schemaVersion 2"):
            atomic_upgrade_workflow(self.workflow_path, {"steps": []})

        self.assertEqual(json.loads(self.workflow_path.read_text(encoding="utf-8")), self.v1)
        self.assertFalse(Path(f"{self.workflow_path}.v1.bak").exists())

    def test_existing_backup_blocks_overwrite(self):
        backup = Path(f"{self.workflow_path}.v1.bak")
        backup.write_text("protected", encoding="utf-8")

        with self.assertRaisesRegex(WorkflowUpgradeError, "already exists"):
            atomic_upgrade_workflow(
                self.workflow_path,
                {"schemaVersion": 2, "nodes": [], "edges": []},
            )

        self.assertEqual(backup.read_text(encoding="utf-8"), "protected")
        self.assertEqual(json.loads(self.workflow_path.read_text(encoding="utf-8")), self.v1)


if __name__ == "__main__":
    unittest.main()
