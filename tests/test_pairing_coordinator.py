import sys
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from pairing_coordinator import PairingCoordinator


PROFILE_A = "123e4567-e89b-42d3-a456-426614174000"
PROFILE_B = "123e4567-e89b-42d3-b456-426614174001"


class PairingCoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.settings = {"pairedInstanceId": None}
        self.connection_reports = []

        def load_settings():
            return dict(self.settings)

        def save_settings(settings):
            self.settings = dict(settings)
            return dict(settings)

        self.coordinator = PairingCoordinator(
            load_settings,
            save_settings,
            self.connection_reports.append,
        )
        self.connection_a = object()
        self.connection_b = object()

    def test_profile_hello_requires_explicit_pair(self):
        result = self.coordinator.announce(self.connection_a, PROFILE_A)

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "pairing_required")
        self.assertEqual(result["pairingState"], "unpaired")
        self.assertIsNone(self.settings["pairedInstanceId"])
        self.assertEqual(self.connection_reports, [])

    def test_pair_stores_profile_and_accepts_live_connection(self):
        result = self.coordinator.pair(self.connection_a, PROFILE_A)

        self.assertTrue(result["ok"])
        self.assertTrue(result["paired"])
        self.assertTrue(result["connected"])
        self.assertEqual(self.settings["pairedInstanceId"], PROFILE_A)
        self.assertEqual(self.connection_reports, [PROFILE_A])
        self.assertTrue(
            self.coordinator.validate_session(self.connection_a, PROFILE_A)["ok"]
        )

    def test_other_profile_receives_stable_diagnostic(self):
        self.coordinator.pair(self.connection_a, PROFILE_A)

        result = self.coordinator.pair(self.connection_b, PROFILE_B)

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "paired_to_other_profile")
        self.assertEqual(result["pairingState"], "paired_to_other_profile")
        self.assertEqual(self.settings["pairedInstanceId"], PROFILE_A)

    def test_second_connection_for_same_profile_is_declined(self):
        self.coordinator.pair(self.connection_a, PROFILE_A)

        result = self.coordinator.announce(self.connection_b, PROFILE_A)

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "paired_connection_active")
        self.assertIs(self.coordinator.active_connection, self.connection_a)

    def test_matching_profile_can_reconnect_after_release(self):
        self.coordinator.pair(self.connection_a, PROFILE_A)
        self.assertTrue(self.coordinator.release(self.connection_a))

        result = self.coordinator.announce(self.connection_b, PROFILE_A)

        self.assertTrue(result["ok"])
        self.assertIs(self.coordinator.active_connection, self.connection_b)
        self.assertEqual(self.connection_reports, [PROFILE_A, None, PROFILE_A])

    def test_unpair_clears_config_and_live_connection(self):
        self.coordinator.pair(self.connection_a, PROFILE_A)

        result = self.coordinator.unpair(self.connection_a, PROFILE_A)

        self.assertTrue(result["ok"])
        self.assertFalse(result["paired"])
        self.assertFalse(result["connected"])
        self.assertIsNone(self.settings["pairedInstanceId"])
        self.assertIsNone(self.coordinator.active_connection)
        self.assertEqual(self.connection_reports, [PROFILE_A, None])

    def test_other_profile_cannot_unpair_current_profile(self):
        self.coordinator.pair(self.connection_a, PROFILE_A)

        result = self.coordinator.unpair(self.connection_b, PROFILE_B)

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "paired_to_other_profile")
        self.assertEqual(self.settings["pairedInstanceId"], PROFILE_A)
        self.assertIs(self.coordinator.active_connection, self.connection_a)


if __name__ == "__main__":
    unittest.main()
