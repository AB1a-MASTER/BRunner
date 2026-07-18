import json
import tempfile
import unittest
from pathlib import Path
import sys


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from host_settings import (
    DEFAULT_PORT,
    SCHEMA_VERSION,
    format_allowed_roots,
    is_valid_profile_instance_id,
    load_or_create_config,
    normalize_config,
    normalize_profile_instance_id,
    parse_allowed_roots,
    save_config,
)


PROFILE_INSTANCE_ID = "123e4567-e89b-42d3-a456-426614174000"


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
        self.assertEqual(config["schemaVersion"], SCHEMA_VERSION)
        self.assertIsNone(config["pairedInstanceId"])
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        self.assertEqual(config["workflowStorage"]["mode"], "default")
        self.assertEqual(config["approvedDirectories"][0]["id"], "allowedfiles")
        self.assertEqual(config["hostFallback"]["minimumCoordinateConfidence"], 0.9)
        self.assertEqual(config["port"], DEFAULT_PORT)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["AllowedFiles"])

    def test_normalizes_invalid_values(self):
        config = normalize_config(
            {
                "pairedInstanceId": "not-a-profile-id",
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
        self.assertIsNone(config["pairedInstanceId"])
        self.assertEqual(config["local_file_access"]["enabled"], False)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["Data", "C:/Safe"])
        self.assertEqual([entry["id"] for entry in config["approvedDirectories"]], ["data", "safe"])

    def test_save_config_is_normalized_json(self):
        saved = save_config(
            self.config_file,
            {
                "pairedInstanceId": PROFILE_INSTANCE_ID.upper(),
                "port": "9001",
                "local_file_access": {
                    "enabled": True,
                    "allowed_roots": ["AllowedFiles", "Datasets"],
                },
            },
        )

        on_disk = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(saved, on_disk)
        self.assertEqual(on_disk["schemaVersion"], SCHEMA_VERSION)
        self.assertEqual(on_disk["pairedInstanceId"], PROFILE_INSTANCE_ID)
        self.assertEqual(on_disk["host"]["port"], DEFAULT_PORT)
        self.assertEqual(on_disk["approvedDirectories"][0]["path"], "AllowedFiles")
        self.assertEqual(on_disk["port"], DEFAULT_PORT)
        self.assertEqual(on_disk["local_file_access"]["allowed_roots"], ["AllowedFiles", "Datasets"])
        self.assertEqual(list(self.config_file.parent.glob("*.tmp")), [])

    def test_normalizes_v3_config_and_preserves_non_pairing_aliases(self):
        config = normalize_config(
            {
                "schemaVersion": 3,
                "pairedInstanceId": PROFILE_INSTANCE_ID,
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

        self.assertEqual(config["pairedInstanceId"], PROFILE_INSTANCE_ID)
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        self.assertEqual(config["workflowStorage"]["directory"], "C:/Flows")
        self.assertEqual(config["approvedDirectories"][0]["id"], "imports")
        self.assertEqual(config["approvedDirectories"][0]["recursive"], False)
        self.assertEqual(config["hostFallback"]["enabled"], False)
        self.assertEqual(config["hostFallback"]["minimumCoordinateConfidence"], 0.75)
        self.assertNotIn("captureDiagnosticsScreenshots", config["hostFallback"])
        self.assertEqual(config["port"], DEFAULT_PORT)
        self.assertEqual(config["local_file_access"]["enabled"], True)
        self.assertEqual(config["local_file_access"]["allowed_roots"], ["C:/Imports"])

    def test_load_migrates_older_config_to_unpaired_and_preserves_backup(self):
        older = {
            "schemaVersion": 2,
            "port": 9010,
            "local_file_access": {
                "enabled": True,
                "allowed_roots": ["AllowedFiles"],
            },
        }
        self.config_file.write_text(json.dumps(older), encoding="utf-8")

        config = load_or_create_config(self.config_file, self.base_dir)

        backup = self.config_file.with_name("brunner_config.json.v1.bak")
        self.assertTrue(backup.exists())
        self.assertEqual(json.loads(backup.read_text(encoding="utf-8")), older)
        self.assertEqual(config["schemaVersion"], SCHEMA_VERSION)
        self.assertIsNone(config["pairedInstanceId"])
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        self.assertEqual(config["approvedDirectories"][0]["path"], "AllowedFiles")
        self.assertEqual(config["approvedDirectories"][0]["read"], True)

    def test_load_accepts_utf8_bom_config_files(self):
        self.config_file.write_text(
            "\ufeff" + json.dumps({
                "schemaVersion": 3,
                "pairedInstanceId": PROFILE_INSTANCE_ID,
                "host": {"port": 9009},
                "workflowStorage": {"mode": "default"},
                "approvedDirectories": [],
                "hostFallback": {},
            }),
            encoding="utf-8",
        )

        config = load_or_create_config(self.config_file, self.base_dir)

        self.assertEqual(config["pairedInstanceId"], PROFILE_INSTANCE_ID)
        self.assertEqual(config["host"]["port"], DEFAULT_PORT)
        on_disk = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(on_disk["host"]["port"], DEFAULT_PORT)
        self.assertEqual(on_disk["port"], DEFAULT_PORT)

    def test_explicit_empty_approved_directories_does_not_restore_legacy_roots(self):
        self.config_file.write_text(
            json.dumps({
                "schemaVersion": 3,
                "host": {"port": 8999},
                "workflowStorage": {"mode": "default"},
                "approvedDirectories": [],
                "local_file_access": {
                    "enabled": True,
                    "allowed_roots": ["AllowedFiles"],
                },
                "hostFallback": {},
            }),
            encoding="utf-8",
        )

        config = load_or_create_config(self.config_file, self.base_dir)

        self.assertEqual(config["approvedDirectories"], [])
        self.assertEqual(config["local_file_access"], {
            "enabled": False,
            "allowed_roots": [],
        })
        on_disk = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertEqual(on_disk["approvedDirectories"], [])

    def test_explicit_all_read_disabled_survives_repeated_normalization(self):
        config = normalize_config({
            "approvedDirectories": [{
                "id": "imports",
                "displayName": "Imports",
                "path": "C:/Imports",
                "read": True,
                "write": False,
                "recursive": True,
            }],
        }, self.base_dir)
        config["approvedDirectories"][0]["read"] = False

        normalized = normalize_config(config, self.base_dir)

        self.assertFalse(normalized["approvedDirectories"][0]["read"])
        self.assertFalse(normalized["local_file_access"]["enabled"])
        self.assertEqual(
            normalize_config(normalized, self.base_dir)["approvedDirectories"],
            normalized["approvedDirectories"],
        )

    def test_allowed_roots_text_round_trip(self):
        roots = parse_allowed_roots("AllowedFiles\n\nDatasets\n")
        self.assertEqual(roots, ["AllowedFiles", "Datasets"])
        self.assertEqual(format_allowed_roots(roots), "AllowedFiles\nDatasets")

    def test_profile_instance_id_normalization_and_validation(self):
        self.assertEqual(
            normalize_profile_instance_id(f"  {PROFILE_INSTANCE_ID.upper()}  "),
            PROFILE_INSTANCE_ID,
        )
        self.assertTrue(is_valid_profile_instance_id(PROFILE_INSTANCE_ID))
        self.assertFalse(is_valid_profile_instance_id("123456"))


if __name__ == "__main__":
    unittest.main()
