import base64
import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from file_access import LocalFileAccessError, read_allowed_file


class LocalFileAccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.allowed = self.base_dir / "allowed"
        self.allowed.mkdir()
        self.config = {
            "local_file_access": {
                "enabled": True,
                "allowed_roots": [str(self.allowed)],
            }
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_reads_allowed_file_without_returning_path(self):
        file_path = self.allowed / "sample.txt"
        file_path.write_text("BRunner", encoding="utf-8")

        result = read_allowed_file(self.config, self.base_dir, file_path)

        self.assertEqual(result["filename"], "sample.txt")
        self.assertEqual(result["mimeType"], "text/plain")
        self.assertEqual(result["size"], 7)
        self.assertEqual(base64.b64decode(result["content"]), b"BRunner")
        self.assertNotIn("path", result)

    def test_disabled_access_fails(self):
        config = {
            "local_file_access": {
                "enabled": False,
                "allowed_roots": [str(self.allowed)],
            }
        }

        with self.assertRaisesRegex(LocalFileAccessError, "disabled"):
            read_allowed_file(config, self.base_dir, "sample.txt")

    def test_file_outside_allowed_roots_fails(self):
        outside = self.base_dir / "outside.txt"
        outside.write_text("blocked", encoding="utf-8")

        with self.assertRaisesRegex(LocalFileAccessError, "outside allowed roots"):
            read_allowed_file(self.config, self.base_dir, outside)

    def test_oversized_file_fails(self):
        file_path = self.allowed / "large.bin"
        file_path.write_bytes(b"1234")

        with self.assertRaisesRegex(LocalFileAccessError, "safety limit"):
            read_allowed_file(
                self.config,
                self.base_dir,
                file_path,
                max_bytes=3,
            )

    def test_reads_file_from_approved_directory_alias(self):
        file_path = self.allowed / "alias.txt"
        file_path.write_text("Alias", encoding="utf-8")
        config = {
            "approvedDirectories": [{
                "id": "imports",
                "displayName": "Imports",
                "path": str(self.allowed),
                "read": True,
                "write": False,
                "recursive": True,
            }]
        }

        result = read_allowed_file(
            config,
            self.base_dir,
            {"directoryAlias": "imports", "relativePath": "alias.txt"},
        )

        self.assertEqual(result["filename"], "alias.txt")
        self.assertEqual(base64.b64decode(result["content"]), b"Alias")

    def test_approved_directory_alias_requires_read_permission(self):
        (self.allowed / "blocked.txt").write_text("blocked", encoding="utf-8")
        config = {
            "approvedDirectories": [{
                "id": "imports",
                "path": str(self.allowed),
                "read": False,
                "recursive": True,
            }]
        }

        with self.assertRaisesRegex(LocalFileAccessError, "does not allow reads"):
            read_allowed_file(
                config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "blocked.txt"},
            )

    def test_approved_directory_alias_rejects_escape_and_non_recursive_child(self):
        child = self.allowed / "child"
        child.mkdir()
        (child / "nested.txt").write_text("nested", encoding="utf-8")
        config = {
            "approvedDirectories": [{
                "id": "imports",
                "path": str(self.allowed),
                "read": True,
                "recursive": False,
            }]
        }

        with self.assertRaisesRegex(LocalFileAccessError, "recursive"):
            read_allowed_file(
                config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "child/nested.txt"},
            )

        with self.assertRaisesRegex(LocalFileAccessError, "does not exist|outside approved"):
            read_allowed_file(
                config,
                self.base_dir,
                {"directoryAlias": "imports", "relativePath": "../outside.txt"},
            )


if __name__ == "__main__":
    unittest.main()
