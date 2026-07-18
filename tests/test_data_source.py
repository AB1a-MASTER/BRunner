import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from data_source import (
    DataSourceError,
    MAX_DATA_SOURCE_BYTES,
    MAX_DATA_SOURCE_COLUMNS,
    MAX_DATA_SOURCE_ROWS,
    read_data_source,
)


class DataSourceTests(unittest.TestCase):
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

    def test_txt_numbers_parse_as_list(self):
        (self.allowed / "list.txt").write_text("1\n2\n3\n", encoding="utf-8")

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "numbers",
                "relativePath": str(self.allowed / "list.txt"),
                "format": "txt",
            },
        )

        self.assertEqual(result["kind"], "list")
        self.assertEqual(result["data"], [1, 2, 3])
        self.assertEqual(result["filename"], "list.txt")
        self.assertEqual(result["preview"], "3 items")
        self.assertNotIn("path", result)

    def test_format_is_inferred_from_extension(self):
        (self.allowed / "list.txt").write_text("alpha\nbeta\n", encoding="utf-8")

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "names",
                "relativePath": str(self.allowed / "list.txt"),
            },
        )

        self.assertEqual(result["format"], "txt")
        self.assertEqual(result["data"], ["alpha", "beta"])

    def test_txt_scalar_types_are_coerced(self):
        (self.allowed / "typed.txt").write_text(
            "1\n-2\n3.5\ntrue\nfalse\nplain\n",
            encoding="utf-8",
        )

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "typed",
                "relativePath": str(self.allowed / "typed.txt"),
                "format": "txt",
            },
        )

        self.assertEqual(result["data"], [1, -2, 3.5, True, False, "plain"])

    def test_csv_header_parses_table(self):
        (self.allowed / "users.csv").write_text(
            "id,name\n1,Ada\n2,Linus\n",
            encoding="utf-8",
        )

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "users",
                "relativePath": str(self.allowed / "users.csv"),
                "format": "csv",
            },
        )

        self.assertEqual(result["kind"], "table")
        self.assertEqual(result["headers"], ["id", "name"])
        self.assertEqual(result["data"][0], {"id": 1, "name": "Ada"})
        self.assertEqual(result["rows"], 2)
        self.assertEqual(result["columns"], 2)

    def test_csv_single_column_can_parse_as_list(self):
        (self.allowed / "numbers.csv").write_text("number\n1\n2\n", encoding="utf-8")

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "numbers",
                "relativePath": str(self.allowed / "numbers.csv"),
                "format": "csv",
                "shape": "list",
            },
        )

        self.assertEqual(result["kind"], "list")
        self.assertEqual(result["data"], [1, 2])

    def test_csv_without_header_uses_generated_columns(self):
        (self.allowed / "rows.csv").write_text("1,Ada\n2,Linus\n", encoding="utf-8")

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "rows",
                "relativePath": str(self.allowed / "rows.csv"),
                "format": "csv",
                "hasHeader": False,
            },
        )

        self.assertEqual(result["kind"], "table")
        self.assertEqual(result["headers"], ["column_1", "column_2"])
        self.assertEqual(result["data"][1], {"column_1": 2, "column_2": "Linus"})

    def test_json_list_of_objects_parses_as_table(self):
        (self.allowed / "users.json").write_text(
            '[{"id": 1, "name": "Ada"}, {"id": 2, "email": "l@example.com"}]',
            encoding="utf-8",
        )

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "users",
                "relativePath": str(self.allowed / "users.json"),
            },
        )

        self.assertEqual(result["kind"], "table")
        self.assertEqual(result["headers"], ["email", "id", "name"])
        self.assertEqual(result["rows"], 2)

    def test_json_list_object_and_scalar_shapes(self):
        (self.allowed / "list.json").write_text("[1, 2, 3]", encoding="utf-8")
        list_result = read_data_source(
            self.config,
            self.base_dir,
            {"relativePath": str(self.allowed / "list.json")},
        )
        self.assertEqual(list_result["kind"], "list")
        self.assertEqual(list_result["data"], [1, 2, 3])

        (self.allowed / "object.json").write_text('{"ok": true}', encoding="utf-8")
        object_result = read_data_source(
            self.config,
            self.base_dir,
            {"relativePath": str(self.allowed / "object.json")},
        )
        self.assertEqual(object_result["kind"], "object")
        self.assertEqual(object_result["data"], {"ok": True})

        (self.allowed / "scalar.json").write_text("42", encoding="utf-8")
        scalar_result = read_data_source(
            self.config,
            self.base_dir,
            {"relativePath": str(self.allowed / "scalar.json")},
        )
        self.assertEqual(scalar_result["kind"], "scalar")
        self.assertEqual(scalar_result["data"], 42)

    def test_denied_source_uses_allowlist(self):
        outside = self.base_dir / "outside.txt"
        outside.write_text("1\n", encoding="utf-8")

        with self.assertRaisesRegex(Exception, "outside allowed roots"):
            read_data_source(
                self.config,
                self.base_dir,
                {"relativePath": str(outside), "format": "txt"},
            )

    def test_relative_path_is_resolved_under_allowed_base(self):
        (self.allowed / "relative.txt").write_text("x\n", encoding="utf-8")

        result = read_data_source(
            self.config,
            self.base_dir,
            {
                "id": "relative",
                "relativePath": "allowed/relative.txt",
                "format": "txt",
            },
        )

        self.assertEqual(result["data"], ["x"])

    def test_directory_alias_source_reads_relative_file(self):
        (self.allowed / "alias.csv").write_text("id,name\n1,Ada\n", encoding="utf-8")
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

        result = read_data_source(
            config,
            self.base_dir,
            {
                "id": "alias-users",
                "directoryAlias": "imports",
                "relativePath": "alias.csv",
            },
        )

        self.assertEqual(result["kind"], "table")
        self.assertEqual(result["data"], [{"id": 1, "name": "Ada"}])
        self.assertEqual(result["filename"], "alias.csv")

    def test_scalar_path_uses_matching_alias_policy_with_multiple_aliases(self):
        denied = self.base_dir / "denied"
        readable = self.base_dir / "readable"
        denied.mkdir()
        readable.mkdir()
        denied_file = denied / "denied.txt"
        readable_file = readable / "readable.txt"
        denied_file.write_text("blocked\n", encoding="utf-8")
        readable_file.write_text("allowed\n", encoding="utf-8")
        config = {
            "approvedDirectories": [
                {
                    "id": "denied",
                    "path": str(denied),
                    "read": False,
                    "recursive": True,
                },
                {
                    "id": "readable",
                    "path": str(readable),
                    "read": True,
                    "recursive": True,
                },
            ],
            "local_file_access": {
                "enabled": True,
                "allowed_roots": [str(denied), str(readable)],
            },
        }

        result = read_data_source(
            config,
            self.base_dir,
            {"relativePath": str(readable_file), "format": "txt"},
        )
        self.assertEqual(result["data"], ["allowed"])

        with self.assertRaisesRegex(Exception, "does not allow reads"):
            read_data_source(
                config,
                self.base_dir,
                {"relativePath": str(denied_file), "format": "txt"},
            )

    def test_scalar_path_honors_non_recursive_alias(self):
        direct = self.allowed / "direct.txt"
        child = self.allowed / "child"
        nested = child / "nested.txt"
        child.mkdir()
        direct.write_text("direct\n", encoding="utf-8")
        nested.write_text("nested\n", encoding="utf-8")
        config = {
            "approvedDirectories": [{
                "id": "imports",
                "path": str(self.allowed),
                "read": True,
                "recursive": False,
            }],
            "local_file_access": {
                "enabled": True,
                "allowed_roots": [str(self.allowed)],
            },
        }

        result = read_data_source(
            config,
            self.base_dir,
            {"relativePath": str(direct), "format": "txt"},
        )
        self.assertEqual(result["data"], ["direct"])

        with self.assertRaisesRegex(Exception, "recursive"):
            read_data_source(
                config,
                self.base_dir,
                {"relativePath": str(nested), "format": "txt"},
            )

    def test_scalar_path_accepts_an_authorized_overlapping_alias(self):
        child = self.allowed / "child"
        child.mkdir()
        nested = child / "nested.txt"
        nested.write_text("nested\n", encoding="utf-8")
        config = {
            "approvedDirectories": [
                {
                    "id": "denied-parent",
                    "path": str(self.allowed),
                    "read": False,
                    "recursive": True,
                },
                {
                    "id": "readable-child",
                    "path": str(child),
                    "read": True,
                    "recursive": False,
                },
            ],
            "local_file_access": {
                "enabled": True,
                "allowed_roots": [str(self.allowed), str(child)],
            },
        }

        result = read_data_source(
            config,
            self.base_dir,
            {"relativePath": str(nested), "format": "txt"},
        )

        self.assertEqual(result["data"], ["nested"])

    def test_scalar_path_falls_back_to_legacy_roots_only_when_alias_key_is_absent(self):
        source = self.allowed / "legacy.txt"
        source.write_text("legacy\n", encoding="utf-8")
        legacy = {
            "local_file_access": {
                "enabled": True,
                "allowed_roots": [str(self.allowed)],
            },
        }

        result = read_data_source(
            legacy,
            self.base_dir,
            {"relativePath": str(source), "format": "txt"},
        )
        self.assertEqual(result["data"], ["legacy"])

        for approved in ([], None):
            config = {**legacy, "approvedDirectories": approved}
            with self.subTest(approved=approved):
                with self.assertRaisesRegex(Exception, "no approved directories"):
                    read_data_source(
                        config,
                        self.base_dir,
                        {"relativePath": str(source), "format": "txt"},
                    )

    def test_row_limit_fails(self):
        (self.allowed / "list.txt").write_text("1\n2\n", encoding="utf-8")

        with self.assertRaisesRegex(DataSourceError, "row limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "list.txt"),
                    "format": "txt",
                    "maxRows": 1,
                },
            )

    def test_csv_column_limit_fails(self):
        (self.allowed / "wide.csv").write_text("a,b\n1,2\n", encoding="utf-8")

        with self.assertRaisesRegex(DataSourceError, "column limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "wide.csv"),
                    "format": "csv",
                    "maxColumns": 1,
                },
            )

    def test_json_malformed_fails(self):
        (self.allowed / "bad.json").write_text("{bad", encoding="utf-8")

        with self.assertRaisesRegex(DataSourceError, "malformed"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "bad.json"),
                    "format": "json",
                },
            )

    def test_unsupported_format_fails(self):
        (self.allowed / "data.bin").write_text("x", encoding="utf-8")

        with self.assertRaisesRegex(DataSourceError, "Unsupported"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "data.bin"),
                    "format": "bin",
                },
            )

    def test_invalid_encoding_fails(self):
        (self.allowed / "list.txt").write_text("x", encoding="utf-8")

        with self.assertRaisesRegex(DataSourceError, "encoding"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "list.txt"),
                    "format": "txt",
                    "encoding": "utf-16",
                },
            )

    def test_size_limit_fails(self):
        (self.allowed / "large.txt").write_text("12345", encoding="utf-8")

        with self.assertRaisesRegex(Exception, "safety limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "large.txt"),
                    "format": "txt",
                    "maxBytes": 4,
                },
            )

    def test_oversized_byte_override_is_clamped_to_hard_ceiling(self):
        (self.allowed / "too-large.txt").write_bytes(
            b"x" * (MAX_DATA_SOURCE_BYTES + 1)
        )

        with self.assertRaisesRegex(Exception, "safety limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "too-large.txt"),
                    "format": "txt",
                    "maxBytes": MAX_DATA_SOURCE_BYTES * 100,
                },
            )

    def test_oversized_row_override_is_clamped_to_hard_ceiling(self):
        (self.allowed / "too-many-rows.txt").write_text(
            "x\n" * (MAX_DATA_SOURCE_ROWS + 1),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(DataSourceError, "row limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(self.allowed / "too-many-rows.txt"),
                    "format": "txt",
                    "maxRows": MAX_DATA_SOURCE_ROWS * 100,
                },
            )

    def test_oversized_column_override_is_clamped_to_hard_ceiling(self):
        columns = ",".join(
            f'"column_{index}": {index}'
            for index in range(MAX_DATA_SOURCE_COLUMNS + 1)
        )
        (self.allowed / "too-many-columns.json").write_text(
            "{" + columns + "}",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(DataSourceError, "column limit"):
            read_data_source(
                self.config,
                self.base_dir,
                {
                    "relativePath": str(
                        self.allowed / "too-many-columns.json"
                    ),
                    "format": "json",
                    "maxColumns": MAX_DATA_SOURCE_COLUMNS * 100,
                },
            )


if __name__ == "__main__":
    unittest.main()
