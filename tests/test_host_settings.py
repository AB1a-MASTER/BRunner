import json
import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from host_settings import (
    DEFAULT_PORT,
    format_allowed_roots,
    load_or_create_config,
    normalize_config,
    parse_allowed_roots,
    save_config,
)


class HostSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.config_file = self.base_dir / "brunner_config.json"

    def tearDown(self):
        self.temp.cleanup()

    def test_creates_default_config(self):
        config = load_or_create_config(self.config_file, self.base_dir)

        self.assertTrue(self.config_file.exists())
        self.assertEqual(config["port"], DEFAULT_PORT)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["AllowedFiles"])
        self.assertTrue(config["pairing_key"])

    def test_normalizes_invalid_values(self):
        config = normalize_config(
            {
                "pairing_key": "",
                "paired_extension_id": "",
                "port": "999999",
                "local_file_access": {
                    "enabled": "yes",
                    "allowed_roots": ["", "Data", " C:/Safe "],
                },
            },
            self.base_dir,
        )

        self.assertEqual(config["port"], DEFAULT_PORT)
        self.assertIsNone(config["paired_extension_id"])
        self.assertEqual(config["local_file_access"]["enabled"], False)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["Data", "C:/Safe"])
        self.assertTrue(config["pairing_key"])

    def test_save_config_is_normalized_json(self):
        saved = save_config(
            self.config_file,
            {
                "pairing_key": "abc",
                "paired_extension_id": "ext",
                "port": "9001",
                "local_file_access": {
                    "enabled": True,
                    "allowed_roots": ["AllowedFiles", "Datasets"],
                },
            },
        )

        on_disk = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(saved, on_disk)
        self.assertEqual(on_disk["port"], 9001)
        self.assertEqual(on_disk["local_file_access"]["allowed_roots"], ["AllowedFiles", "Datasets"])

    def test_allowed_roots_text_round_trip(self):
        roots = parse_allowed_roots("AllowedFiles\n\nDatasets\n")
        self.assertEqual(roots, ["AllowedFiles", "Datasets"])
        self.assertEqual(format_allowed_roots(roots), "AllowedFiles\nDatasets")


if __name__ == "__main__":
    unittest.main()
