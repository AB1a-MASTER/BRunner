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
        self.assertEqual(config["schemaVersion"], 2)
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        self.assertEqual(config["workflowStorage"]["mode"], "default")
        self.assertEqual(config["approvedDirectories"][0]["id"], "allowedfiles")
        self.assertEqual(config["hostFallback"]["minimumCoordinateConfidence"], 0.9)
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
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        self.assertIsNone(config["paired_extension_id"])
        self.assertEqual(config["local_file_access"]["enabled"], False)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["Data", "C:/Safe"])
        self.assertEqual([entry["id"] for entry in config["approvedDirectories"]], ["data", "safe"])
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
        self.assertEqual(on_disk["schemaVersion"], 2)
        self.assertEqual(on_disk["pairingKey"], "abc")
        self.assertEqual(on_disk["pairedExtensionId"], "ext")
        self.assertEqual(on_disk["host"]["port"], 9001)
        self.assertEqual(on_disk["approvedDirectories"][0]["path"], "AllowedFiles")
        self.assertEqual(on_disk["port"], 9001)
        self.assertEqual(on_disk["local_file_access"]["allowed_roots"], ["AllowedFiles", "Datasets"])
        self.assertEqual(list(self.config_file.parent.glob("*.tmp")), [])

    def test_normalizes_v2_config_and_preserves_legacy_aliases(self):
        config = normalize_config(
            {
                "schemaVersion": 2,
                "pairingKey": "key",
                "pairedExtensionId": "extension",
                "host": {"port": "9002", "startWithApp": False},
                "workflowStorage": {"mode": "custom", "directory": "C:/Flows"},
                "approvedDirectories": [{
                    "id": "imports",
                    "displayName": "Imports",
                    "path": "C:/Imports",
                    "read": True,
                    "write": True,
                    "recursive": False,
                }],
                "hostFallback": {
                    "enabled": False,
                    "minimumCoordinateConfidence": "0.75",
                    "captureDiagnosticsScreenshots": True,
                },
            },
            self.base_dir,
        )

        self.assertEqual(config["pairingKey"], "key")
        self.assertEqual(config["host"]["port"], 9002)
        self.assertEqual(config["workflowStorage"]["directory"], "C:/Flows")
        self.assertEqual(config["approvedDirectories"][0]["id"], "imports")
        self.assertEqual(config["approvedDirectories"][0]["recursive"], False)
        self.assertEqual(config["hostFallback"]["enabled"], False)
        self.assertEqual(config["hostFallback"]["minimumCoordinateConfidence"], 0.75)
        self.assertEqual(config["port"], 9002)
        self.assertEqual(config["local_file_access"]["enabled"], True)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["C:/Imports"])

    def test_load_migrates_v1_config_and_preserves_backup(self):
        legacy = {
            "pairing_key": "legacy",
            "paired_extension_id": "old-extension",
            "port": 9010,
            "local_file_access": {
                "enabled": True,
                "allowed_roots": ["AllowedFiles"],
            },
        }
        self.config_file.write_text(json.dumps(legacy), encoding="utf-8")

        config = load_or_create_config(self.config_file, self.base_dir)

        backup = self.config_file.with_name("brunner_config.json.v1.bak")
        self.assertTrue(backup.exists())
        self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), legacy)
        self.assertEqual(config["schemaVersion"], 2)
        self.assertEqual(config["pairingKey"], "legacy")
        self.assertEqual(config["host"]["port"], 9010)
        self.assertEqual(config["approvedDirectories"][0]["path"], "AllowedFiles")
        self.assertEqual(config["approvedDirectories"][0]["read"], True)

    def test_allowed_roots_text_round_trip(self):
        roots = parse_allowed_roots("AllowedFiles\n\nDatasets\n")
        self.assertEqual(roots, ["AllowedFiles", "Datasets"])
        self.assertEqual(format_allowed_roots(roots), "AllowedFiles\nDatasets")


if __name__ == "__main__":
    unittest.main()
