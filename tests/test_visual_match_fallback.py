import base64
import io
import sys
import unittest
from pathlib import Path

from PIL import Image


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from visual_match import execute_visual_match_action
from window_validation import HostFallbackError


class FakeWindow:
    title = "BRunner Test - Chromium"
    left = 10
    top = 20
    width = 1200
    height = 800


class FakeAdapter:
    def __init__(self, matches=None):
        self.matches = matches if matches is not None else [
            {"left": 100, "top": 200, "width": 60, "height": 30, "confidence": 0.97}
        ]
        self.calls = []

    def size(self):
        return (1920, 1080)

    def getActiveWindow(self):
        return FakeWindow()

    def locateAllOnScreen(self, image, **kwargs):
        self.calls.append(("locateAllOnScreen", image.size, kwargs))
        return list(self.matches)

    def click(self, x, y, **kwargs):
        self.calls.append(("click", x, y, kwargs))


def png_data_url():
    buffer = io.BytesIO()
    image = Image.new("RGB", (8, 6), color=(220, 30, 40))
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


class VisualMatchFallbackTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "hostFallback": {
                "enabled": True,
                "minimumCoordinateConfidence": 0.75,
            }
        }

    def test_execute_visual_match_clicks_single_foreground_match(self):
        adapter = FakeAdapter()
        result = execute_visual_match_action(
            self.config,
            {
                "action": "click",
                "imageDataUrl": png_data_url(),
                "matchConfidence": 0.9,
                "expectedWindowTitle": "Chromium",
            },
            adapter,
        )

        self.assertTrue(result["performed"])
        self.assertEqual(result["method"], "visible_host_visual_match")
        self.assertEqual(result["x"], 130)
        self.assertEqual(result["y"], 215)
        self.assertEqual(result["matchConfidence"], 0.97)
        self.assertEqual(adapter.calls[-1], ("click", 130, 215, {"clicks": 1, "button": "left"}))

    def test_visual_match_refuses_disabled_wrong_window_missing_and_ambiguous(self):
        with self.assertRaisesRegex(HostFallbackError, "disabled"):
            execute_visual_match_action(
                {"hostFallback": {"enabled": False}},
                {"action": "click", "imageDataUrl": png_data_url(), "matchConfidence": 0.9},
                FakeAdapter(),
            )

        with self.assertRaisesRegex(HostFallbackError, "foreground"):
            execute_visual_match_action(
                self.config,
                {
                    "action": "click",
                    "imageDataUrl": png_data_url(),
                    "matchConfidence": 0.9,
                    "expectedWindowTitle": "Notepad",
                },
                FakeAdapter(),
            )

        with self.assertRaisesRegex(HostFallbackError, "Missing visual-match"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "matchConfidence": 0.9},
                FakeAdapter(),
            )

        with self.assertRaisesRegex(HostFallbackError, "ambiguous"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url(), "matchConfidence": 0.9},
                FakeAdapter([
                    {"left": 100, "top": 200, "width": 60, "height": 30, "confidence": 0.97},
                    {"left": 500, "top": 200, "width": 60, "height": 30, "confidence": 0.96},
                ]),
            )


if __name__ == "__main__":
    unittest.main()
