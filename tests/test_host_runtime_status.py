import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from host_runtime_status import (
    RUNTIME_STATUS_VERSION,
    clear_connection_status,
    connection_status_is_fresh,
    read_connection_status,
    runtime_status_file,
    write_connection_status,
)


PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000"


class HostRuntimeStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.now = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp.cleanup()

    def test_round_trip_records_complete_handshaked_heartbeat(self):
        write_connection_status(
            self.base_dir,
            profile_instance_id=PROFILE_ID,
            port=8765,
            host_process_id=4321,
            now=self.now,
        )

        status = read_connection_status(self.base_dir)

        self.assertEqual(status["version"], RUNTIME_STATUS_VERSION)
        self.assertTrue(status["connected"])
        self.assertTrue(status["handshakeComplete"])
        self.assertEqual(status["profileInstanceId"], PROFILE_ID)
        self.assertEqual(status["port"], 8765)
        self.assertEqual(status["hostProcessId"], 4321)
        self.assertTrue(connection_status_is_fresh(status, now=self.now))
        self.assertFalse(
            connection_status_is_fresh(
                status,
                now=self.now + timedelta(seconds=16),
            )
        )

    def test_incomplete_or_legacy_records_fail_closed(self):
        incomplete_records = [
            {
                "version": RUNTIME_STATUS_VERSION,
                "connected": True,
                "handshakeComplete": False,
                "profileInstanceId": PROFILE_ID,
                "port": 8765,
                "hostProcessId": 4321,
                "updatedAt": self.now.isoformat(),
            },
            {
                "connected": True,
                "profileInstanceId": PROFILE_ID,
                "port": 8765,
                "hostProcessId": 4321,
                "updatedAt": self.now.isoformat(),
            },
        ]

        for record in incomplete_records:
            with self.subTest(record=record):
                path = runtime_status_file(self.base_dir)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(record), encoding="utf-8")
                status = read_connection_status(self.base_dir)
                self.assertFalse(status["connected"])
                self.assertFalse(status["handshakeComplete"])
                self.assertIsNone(status["profileInstanceId"])
                self.assertIsNone(status["hostProcessId"])

    def test_writer_and_clear_require_complete_connection_identity(self):
        for overrides in (
            {"profile_instance_id": None},
            {"port": None},
            {"host_process_id": 0},
            {"handshake_complete": False},
        ):
            arguments = {
                "profile_instance_id": PROFILE_ID,
                "port": 8765,
                "host_process_id": 4321,
                "handshake_complete": True,
                "now": self.now,
            }
            arguments.update(overrides)
            with self.subTest(overrides=overrides):
                write_connection_status(self.base_dir, **arguments)
                self.assertFalse(read_connection_status(self.base_dir)["connected"])

        clear_connection_status(self.base_dir, port=8765)
        cleared = read_connection_status(self.base_dir)
        self.assertFalse(cleared["connected"])
        self.assertEqual(cleared["port"], 8765)


if __name__ == "__main__":
    unittest.main()
