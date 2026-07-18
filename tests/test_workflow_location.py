import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from host_settings import save_config
import workflow_location
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
        save_config(self.config_file, {})
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

        with mock.patch.object(
            workflow_location,
            "save_config",
            wraps=workflow_location.save_config,
        ) as save:
            result = restore_default_workflow_location(
                self.config_file,
                self.base_dir,
                "use_new",
            )

        self.assertEqual(result["workflowStorage"], {"mode": "default", "directory": None})
        self.assertEqual(Path(result["activeDirectory"]), self.default_dir.resolve())
        self.assertEqual(save.call_count, 1)

    def test_copy_rolls_back_new_targets_when_config_save_fails(self):
        source = self.write_default_workflow("flow.json", {"name": "Flow"})
        target = self.base_dir / "CopiedFlows"

        with mock.patch.object(
            workflow_location,
            "save_config",
            side_effect=OSError("config write failed"),
        ):
            with self.assertRaisesRegex(OSError, "config write failed"):
                apply_workflow_location(
                    self.config_file,
                    self.base_dir,
                    target,
                    "copy",
                )

        self.assertTrue(source.exists())
        self.assertFalse((target / "flow.json").exists())
        self.assertFalse(target.exists())
        saved = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(saved["workflowStorage"]["mode"], "default")

    def test_move_preserves_sources_when_config_save_fails(self):
        source = self.write_default_workflow("flow.json", {"name": "Flow"})
        target = self.base_dir / "MovedFlows"

        with mock.patch.object(
            workflow_location,
            "save_config",
            side_effect=OSError("config write failed"),
        ):
            with self.assertRaisesRegex(OSError, "config write failed"):
                apply_workflow_location(
                    self.config_file,
                    self.base_dir,
                    target,
                    "move",
                )

        self.assertTrue(source.exists())
        self.assertFalse((target / "flow.json").exists())

    def test_copy_rolls_back_partial_manifest_when_a_later_copy_fails(self):
        first = self.write_default_workflow("a.json", {"name": "A"})
        second = self.write_default_workflow("b.json", {"name": "B"})
        target = self.base_dir / "CopiedFlows"
        real_atomic_write = workflow_location.atomic_write_json

        def fail_second_copy(destination, content, indent=4):
            if Path(destination).name == "b.json":
                raise OSError("workflow copy failed")
            return real_atomic_write(destination, content, indent=indent)

        with mock.patch.object(
            workflow_location,
            "atomic_write_json",
            side_effect=fail_second_copy,
        ):
            with self.assertRaisesRegex(OSError, "workflow copy failed"):
                apply_workflow_location(
                    self.config_file,
                    self.base_dir,
                    target,
                    "copy",
                )

        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertFalse((target / "a.json").exists())
        self.assertFalse(target.exists())

    def test_restore_default_rolls_back_copy_when_config_save_fails(self):
        custom = self.base_dir / "Custom"
        apply_workflow_location(self.config_file, self.base_dir, custom, "use_new")
        source = custom / "flow.json"
        source.write_text(json.dumps({"name": "Flow"}), encoding="utf-8")

        with mock.patch.object(
            workflow_location,
            "save_config",
            side_effect=OSError("config write failed"),
        ) as save:
            with self.assertRaisesRegex(OSError, "config write failed"):
                restore_default_workflow_location(
                    self.config_file,
                    self.base_dir,
                    "copy",
                )

        self.assertEqual(save.call_count, 1)
        self.assertTrue(source.exists())
        self.assertFalse((self.default_dir / "flow.json").exists())
        saved = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(saved["workflowStorage"]["mode"], "custom")
        self.assertEqual(
            Path(saved["workflowStorage"]["directory"]),
            custom.resolve(),
        )

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

    def test_ordered_use_new_restore_copy_move_and_restore_transitions(self):
        self.write_default_workflow("alpha.json", {"name": "Alpha"})
        self.write_default_workflow("beta.json", {"name": "Beta"})
        default_names = {"alpha.json", "beta.json"}
        use_new = self.base_dir / "UseNew"
        copied = self.base_dir / "Copied"
        moved = self.base_dir / "Moved"

        use_new_result = apply_workflow_location(
            self.config_file,
            self.base_dir,
            use_new,
            "use_new",
        )
        self.assertEqual(use_new_result["migrated"], 0)
        self.assertEqual(list(use_new.glob("*.json")), [])
        self.assertEqual(
            {path.name for path in self.default_dir.glob("*.json")},
            default_names,
        )

        restored = restore_default_workflow_location(
            self.config_file,
            self.base_dir,
            "use_new",
        )
        self.assertEqual(restored["workflowStorage"], {
            "mode": "default",
            "directory": None,
        })
        self.assertEqual(
            {path.name for path in self.default_dir.glob("*.json")},
            default_names,
        )

        copied_result = apply_workflow_location(
            self.config_file,
            self.base_dir,
            copied,
            "copy",
        )
        self.assertEqual(copied_result["migrated"], 2)
        self.assertEqual(
            {path.name for path in copied.glob("*.json")},
            default_names,
        )
        self.assertEqual(
            {path.name for path in self.default_dir.glob("*.json")},
            default_names,
        )

        moved_result = apply_workflow_location(
            self.config_file,
            self.base_dir,
            moved,
            "move",
        )
        self.assertEqual(moved_result["migrated"], 2)
        self.assertEqual(moved_result["sourceCleanupFailures"], [])
        self.assertEqual(list(copied.glob("*.json")), [])
        self.assertEqual(
            {path.name for path in moved.glob("*.json")},
            default_names,
        )

        final = restore_default_workflow_location(
            self.config_file,
            self.base_dir,
            "use_new",
        )
        self.assertEqual(final["workflowStorage"], {
            "mode": "default",
            "directory": None,
        })
        self.assertEqual(Path(final["activeDirectory"]), self.default_dir.resolve())
        self.assertEqual(
            {path.name for path in self.default_dir.glob("*.json")},
            default_names,
        )


if __name__ == "__main__":
    unittest.main()
