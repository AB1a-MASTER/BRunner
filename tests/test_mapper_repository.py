import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from mapper_repository import MapperRepository, MapperRepositoryError
import mapper_repository


class MapperRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workflows_dir = Path(self.temp.name) / "Workflows"
        self.repository = MapperRepository(self.workflows_dir)

    def tearDown(self):
        self.temp.cleanup()

    def test_save_get_list_and_delete_mapper_state(self):
        state = {
            "mapperSchemaVersion": 1,
            "workflowId": "checkout flow",
            "maps": [],
        }

        saved = self.repository.save_state("checkout flow", state)
        loaded = self.repository.get_state("checkout flow")
        states = self.repository.list_states()
        deleted = self.repository.delete_state("checkout flow")

        self.assertEqual(saved["workflowId"], "checkout flow")
        self.assertEqual(saved["storage"]["provider"], "native")
        self.assertTrue(saved["storage"]["revision"])
        self.assertEqual(loaded["workflowId"], "checkout flow")
        self.assertEqual(list(states.keys()), ["checkout flow"])
        self.assertTrue(deleted)
        self.assertFalse(self.repository.get_state("checkout flow"))
        self.assertFalse(self.repository.delete_state("checkout flow"))
        self.assertEqual(list((self.workflows_dir / "MapperMaps").glob("*.tmp")), [])

    def test_rejects_missing_or_invalid_workflow_id(self):
        with self.assertRaisesRegex(MapperRepositoryError, "Missing workflow id"):
            self.repository.save_state("", {})

        with self.assertRaisesRegex(MapperRepositoryError, "Invalid workflow id"):
            self.repository.save_state("...", {})

    def test_sanitizes_mapper_state_filename(self):
        self.repository.save_state("folder/escape:flow", {"maps": []})

        files = sorted((self.workflows_dir / "MapperMaps").glob("*.mapper.json"))

        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "folder_escape_flow.mapper.json")

    def test_retains_conflict_metadata_for_stale_save(self):
        first = self.repository.save_state("flow", {
            "mapperSchemaVersion": 1,
            "workflowId": "flow",
            "maps": [{"mapVersionId": "one"}],
        })
        self.repository.save_state("flow", {
            **first,
            "maps": [{"mapVersionId": "two"}],
        })
        stale = self.repository.save_state("flow", {
            **first,
            "maps": [{"mapVersionId": "stale"}],
        })

        conflicts = stale["storage"]["conflicts"]

        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["type"], "last_write_wins")
        self.assertEqual(conflicts[0]["workflowId"], "flow")
        self.assertEqual(conflicts[0]["nextRevision"], first["storage"]["revision"])

    def test_rejects_oversized_mapper_state(self):
        original_limit = mapper_repository.MAX_MAPPER_STATE_BYTES
        mapper_repository.MAX_MAPPER_STATE_BYTES = 128
        try:
            with self.assertRaisesRegex(MapperRepositoryError, "too large"):
                self.repository.save_state("large", {
                    "mapperSchemaVersion": 1,
                    "workflowId": "large",
                    "maps": [{"payload": "x" * 500}],
                })
        finally:
            mapper_repository.MAX_MAPPER_STATE_BYTES = original_limit


if __name__ == "__main__":
    unittest.main()
