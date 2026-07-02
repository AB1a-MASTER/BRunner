import json
import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from directory_registry import (
    DirectoryRegistryError,
    export_data_file,
    find_approved_files,
    list_approved_directories,
    write_approved_file,
)


class DirectoryRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.approved = self.base_dir / "approved"
        self.approved.mkdir()
        self.config = {
            "approvedDirectories": [{
                "id": "imports",
                "displayName": "Imports",
                "path": str(self.approved),
                "read": True,
                "write": True,
                "recursive": True,
            }]
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_lists_alias_availability_without_hiding_permissions(self):
        result = list_approved_directories(self.config, self.base_dir)

        self.assertEqual(result[0]["id"], "imports")
        self.assertEqual(result[0]["displayName"], "Imports")
        self.assertTrue(result[0]["available"])
        self.assertTrue(result[0]["read"])
        self.assertTrue(result[0]["write"])

    def test_find_files_respects_alias_pattern_and_extensions(self):
        (self.approved / "users.csv").write_text("id,name\n1,Ada\n", encoding="utf-8")
        (self.approved / "notes.txt").write_text("skip", encoding="utf-8")

        result = find_approved_files(
            self.config,
            self.base_dir,
            {"directoryAlias": "imports", "pattern": "*.csv", "extensions": ["csv"]},
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["files"][0]["relativePath"], "users.csv")
        self.assertNotIn("path", result["files"][0])

    def test_find_requires_read_permission(self):
        self.config["approvedDirectories"][0]["read"] = False

        with self.assertRaisesRegex(DirectoryRegistryError, "reads"):
            find_approved_files(
                self.config,
                self.base_dir,
                {"directoryAlias": "imports"},
            )

    def test_write_requires_write_permission_and_blocks_escape(self):
        self.config["approvedDirectories"][0]["write"] = False

        with self.assertRaisesRegex(DirectoryRegistryError, "writes"):
            write_approved_file(
                self.config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "out.txt", "content": "x"},
            )

        self.config["approvedDirectories"][0]["write"] = True
        with self.assertRaisesRegex(DirectoryRegistryError, "outside approved"):
            write_approved_file(
                self.config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "../out.txt", "content": "x"},
            )

    def test_write_and_export_create_files_atomically_under_alias(self):
        write_result = write_approved_file(
            self.config,
            self.base_dir,
            {"directoryAlias": "imports", "relativePath": "nested/out.txt", "content": "ok"},
        )

        self.assertEqual(write_result["relativePath"], "nested/out.txt")
        self.assertEqual((self.approved / "nested" / "out.txt").read_text(encoding="utf-8"), "ok")
        self.assertEqual(list((self.approved / "nested").glob("*.tmp")), [])

        export_result = export_data_file(
            self.config,
            self.base_dir,
            {
                "directoryAlias": "imports",
                "relativePath": "exports/users.json",
                "format": "json",
                "data": [{"id": 1, "name": "Ada"}],
            },
        )

        self.assertEqual(export_result["format"], "json")
        self.assertEqual(
            json.loads((self.approved / "exports" / "users.json").read_text(encoding="utf-8")),
            [{"id": 1, "name": "Ada"}],
        )

    def test_non_recursive_alias_blocks_child_output(self):
        self.config["approvedDirectories"][0]["recursive"] = False

        with self.assertRaisesRegex(DirectoryRegistryError, "recursive"):
            write_approved_file(
                self.config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "child/out.txt", "content": "x"},
            )


if __name__ == "__main__":
    unittest.main()
