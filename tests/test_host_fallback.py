import sys
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from fallback_input import execute_host_action
from window_validation import HostFallbackError, host_window_status, validate_host_action


class FakeWindow:
    title = "BRunner Test - Chromium"
    left = 10
    top = 20
    width = 1200
    height = 800


class FakeAdapter:
    def __init__(self):
        self.calls = []

    def size(self):
        return (1920, 1080)

    def getActiveWindow(self):
        return FakeWindow()

    def moveTo(self, x, y):
        self.calls.append(("moveTo", x, y))

    def click(self, x, y, **kwargs):
        self.calls.append(("click", x, y, kwargs))

    def scroll(self, amount):
        self.calls.append(("scroll", amount))

    def write(self, text, interval=0):
        self.calls.append(("write", text, interval))

    def press(self, key):
        self.calls.append(("press", key))

    def hotkey(self, *keys):
        self.calls.append(("hotkey", keys))


class HostFallbackTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "hostFallback": {
                "enabled": True,
                "minimumCoordinateConfidence": 0.75,
            }
        }
        self.adapter = FakeAdapter()

    def test_window_status_reports_foreground_match_and_supported_actions(self):
        result = host_window_status(
            self.config,
            {"expectedWindowTitle": "Chromium"},
            self.adapter,
        )

        self.assertTrue(result["enabled"])
        self.assertTrue(result["matchesExpectedWindow"])
        self.assertEqual(result["screen"]["width"], 1920)
        self.assertEqual(result["foregroundWindow"]["title"], "BRunner Test - Chromium")
        self.assertIn("click", result["supportedActions"])
        self.assertEqual(len(result["supportedActions"]), len(set(result["supportedActions"])))
        self.assertIn("type", result["supportedActions"])
        self.assertNotIn("typeText", result["supportedActions"])
        self.assertNotIn("type_text", result["supportedActions"])

    def test_validate_refuses_disabled_low_confidence_wrong_window_and_offscreen(self):
        with self.assertRaisesRegex(HostFallbackError, "disabled"):
            validate_host_action(
                {"hostFallback": {"enabled": False}},
                {"action": "click", "x": 10, "y": 10, "coordinateConfidence": 1},
                self.adapter,
            )

        with self.assertRaisesRegex(HostFallbackError, "confidence"):
            validate_host_action(
                self.config,
                {"action": "click", "x": 10, "y": 10, "coordinateConfidence": 0.25},
                self.adapter,
            )

        with self.assertRaisesRegex(HostFallbackError, "foreground"):
            validate_host_action(
                self.config,
                {
                    "action": "click",
                    "x": 10,
                    "y": 10,
                    "coordinateConfidence": 1,
                    "expectedWindowTitle": "Notepad",
                },
                self.adapter,
            )

        with self.assertRaisesRegex(HostFallbackError, "outside"):
            validate_host_action(
                self.config,
                {"action": "click", "x": 9999, "y": 10, "coordinateConfidence": 1},
                self.adapter,
            )

    def test_execute_click_uses_centered_bounds_after_validation(self):
        result = execute_host_action(
            self.config,
            {
                "action": "click",
                "target": {"left": 100, "top": 200, "width": 40, "height": 20},
                "coordinateConfidence": 0.95,
                "expectedWindowTitle": "Chromium",
            },
            self.adapter,
        )

        self.assertTrue(result["performed"])
        self.assertEqual(result["action"], "click")
        self.assertEqual(result["x"], 120)
        self.assertEqual(result["y"], 210)
        self.assertEqual(
            self.adapter.calls,
            [("click", 120, 210, {"button": "left"})],
        )

    def test_validate_normalizes_legacy_coordinate_confidence_scale(self):
        result = validate_host_action(
            self.config,
            {
                "action": "click",
                "x": 10,
                "y": 10,
                "coordinateConfidence": 92,
                "expectedWindowTitle": "Chromium",
            },
            self.adapter,
        )

        self.assertEqual(result["coordinateConfidence"], 0.92)

    def test_execute_keyboard_shortcut_does_not_require_coordinates(self):
        result = execute_host_action(
            self.config,
            {"action": "shortcut", "keys": ["ctrl", "l"], "expectedWindowTitle": "Chromium"},
            self.adapter,
        )

        self.assertTrue(result["performed"])
        self.assertEqual(self.adapter.calls, [("hotkey", ("ctrl", "l"))])


if __name__ == "__main__":
    unittest.main()
