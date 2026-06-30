import json
import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from host_settings import save_config
from workflow_location import (
    apply_workflow_location,
    copy_valid_workflows,
    restore_default_workflow_location,
)


class WorkflowLocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.config_file = self.base_dir / "brunner_config.json"
        save_config(self.config_file, {"pairing_key": "key"})
        self.default_dir = self.base_dir / "Workflows"
        self.default_dir.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def write_default_workflow(self, filename, content):
        path = self.default_dir / filename
        path.write_text(json.dumps(content), encoding="utf-8")
        return path

    def test_use_new_location_changes_config_without_copying(self):
        self.write_default_workflow("flow.json", {"name": "Flow"})
        target = self.base_dir / "OtherFlows"

        result = apply_workflow_location(self.config_file, self.base_dir, target, "use_new")

        self.assertEqual(result["migrated"], 0)
        self.assertEqual(result["workflowStorage"]["mode"], "custom")
        self.assertEqual(Path(result["activeDirectory"]), target.resolve())
        self.assertFalse((target / "flow.json").exists())

    def test_copy_location_copies_valid_json_only(self):
        self.write_default_workflow("flow.json", {"name": "Flow"})
        (self.default_dir / "bad.json").write_text("{bad", encoding="utf-8")
        (self.default_dir / "note.txt").write_text("skip", encoding="utf-8")
        target = self.base_dir / "CopiedFlows"

        result = apply_workflow_location(self.config_file, self.base_dir, target, "copy")

        self.assertEqual(result["migrated"], 1)
        self.assertTrue((self.default_dir / "flow.json").exists())
        self.assertEqual(
            json.loads((target / "flow.json").read_text(encoding="utf-8")),
            {"name": "Flow"},
        )
        self.assertFalse((target / "bad.json").exists())

    def test_move_location_removes_only_copied_sources(self):
        source = self.write_default_workflow("flow.json", {"name": "Flow"})
        bad = self.default_dir / "bad.json"
        bad.write_text("{bad", encoding="utf-8")
        target = self.base_dir / "MovedFlows"

        result = apply_workflow_location(self.config_file, self.base_dir, target, "move")

        self.assertEqual(result["migrated"], 1)
        self.assertFalse(source.exists())
        self.assertTrue(bad.exists())
        self.assertTrue((target / "flow.json").exists())

    def test_restore_default_location(self):
        custom = self.base_dir / "Custom"
        apply_workflow_location(self.config_file, self.base_dir, custom, "use_new")

        result = restore_default_workflow_location(self.config_file, self.base_dir, "use_new")

        self.assertEqual(result["workflowStorage"], {"mode": "default", "directory": None})
        self.assertEqual(Path(result["activeDirectory"]), self.default_dir.resolve())

    def test_copy_valid_workflows_skips_existing_destination(self):
        self.write_default_workflow("flow.json", {"name": "Source"})
        target = self.base_dir / "Target"
        target.mkdir()
        (target / "flow.json").write_text(json.dumps({"name": "Target"}), encoding="utf-8")

        count = copy_valid_workflows(self.default_dir, target)

        self.assertEqual(count, 0)
        self.assertEqual(
            json.loads((target / "flow.json").read_text(encoding="utf-8")),
            {"name": "Target"},
        )


if __name__ == "__main__":
    unittest.main()
