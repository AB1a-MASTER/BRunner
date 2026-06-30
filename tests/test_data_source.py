import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from data_source import DataSourceError, read_data_source


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


if __name__ == "__main__":
    unittest.main()
