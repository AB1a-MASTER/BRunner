import base64
import io
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

from PIL import Image


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from visual_match import (
    MAX_TEMPLATE_BASE64_CHARS,
    MAX_TEMPLATE_DIMENSION,
    decode_template_image,
    execute_visual_match_action,
)
from window_validation import HostFallbackError


DEFAULT_SCREEN = {"left": -1920, "top": -100, "width": 3840, "height": 1180}
DEFAULT_WINDOW = {
    "windowId": 101,
    "title": "BRunner Test - Chromium",
    "className": "Chrome_WidgetWin_1",
    "processId": 202,
    "processName": "chromium.exe",
    "executable": r"C:\Chromium\chromium.exe",
    "left": -1500,
    "top": 20,
    "width": 1200,
    "height": 800,
    "visible": True,
    "minimized": False,
}
DEFAULT_SESSION = {"available": True, "interactive": True, "desktopName": "Default"}


class FakeAdapter:
    def __init__(self, matches=None, screens=None, windows=None, sessions=None):
        self.matches = matches if matches is not None else [
            {"left": 100, "top": 180, "width": 60, "height": 30, "confidence": 0.97}
        ]
        self.screens = list(screens or [DEFAULT_SCREEN])
        self.windows = list(windows or [DEFAULT_WINDOW])
        self.sessions = list(sessions or [DEFAULT_SESSION])
        self.screen_index = 0
        self.window_index = 0
        self.session_index = 0
        self.calls = []

    @staticmethod
    def _next(values, index):
        value = values[min(index, len(values) - 1)]
        return (dict(value) if isinstance(value, dict) else value, index + 1)

    def virtual_screen_bounds(self):
        value, self.screen_index = self._next(self.screens, self.screen_index)
        return value

    def foreground_window_snapshot(self):
        value, self.window_index = self._next(self.windows, self.window_index)
        return value

    def session_snapshot(self):
        value, self.session_index = self._next(self.sessions, self.session_index)
        return value

    def capture_region(self, region):
        self.calls.append(("capture_region", region))
        return SimpleNamespace(size=(region[2], region[3]))

    def locateAll(self, needle, haystack, **kwargs):
        self.calls.append(("locateAll", needle.size, haystack.size, kwargs))
        return list(self.matches)

    def click(self, x, y, **kwargs):
        self.calls.append(("click", x, y, kwargs))


def png_data_url(width=8, height=6, mime="image/png"):
    buffer = io.BytesIO()
    image = Image.new("RGB", (width, height), color=(220, 30, 40))
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


class VisualMatchFallbackTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "hostFallback": {
                "enabled": True,
                "minimumCoordinateConfidence": 0.75,
            }
        }

    def test_visual_match_captures_only_foreground_region_on_negative_monitor(self):
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
        self.assertEqual(result["x"], -1370)
        self.assertEqual(result["y"], 215)
        self.assertEqual(result["matchConfidence"], 0.97)
        self.assertEqual(result["searchRegion"], {
            "left": -1500,
            "top": 20,
            "width": 1200,
            "height": 800,
        })
        self.assertGreaterEqual(result["searchDurationMs"], 0)
        self.assertEqual(adapter.calls[0], ("capture_region", (-1500, 20, 1200, 800)))
        self.assertEqual(
            adapter.calls[1],
            ("locateAll", (8, 6), (1200, 800), {"confidence": 0.9, "grayscale": True}),
        )
        self.assertEqual(
            adapter.calls[-1],
            ("click", -1370, 215, {"clicks": 1, "button": "left"}),
        )

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
                    {"left": 100, "top": 180, "width": 60, "height": 30, "confidence": 0.97},
                    {"left": 500, "top": 180, "width": 60, "height": 30, "confidence": 0.96},
                ]),
            )

    def test_visual_match_fails_closed_for_locked_session_and_unverified_browser(self):
        locked = FakeAdapter(
            sessions=[{"available": True, "interactive": False, "desktopName": "Winlogon"}]
        )
        with self.assertRaisesRegex(HostFallbackError, "locked"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url()},
                locked,
            )
        self.assertEqual(locked.calls, [])

        not_browser = FakeAdapter(windows=[{**DEFAULT_WINDOW, "processName": "notepad.exe"}])
        with self.assertRaisesRegex(HostFallbackError, "verified Chrome"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url()},
                not_browser,
            )
        self.assertEqual(not_browser.calls, [])

    def test_visual_match_rejects_out_of_region_and_low_confidence_matches(self):
        outside = FakeAdapter([
            {"left": 1190, "top": 100, "width": 20, "height": 20, "confidence": 0.99}
        ])
        with self.assertRaisesRegex(HostFallbackError, "outside"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url(), "matchConfidence": 0.9},
                outside,
            )
        self.assertFalse(any(call[0] == "click" for call in outside.calls))

        low = FakeAdapter([
            {"left": 100, "top": 100, "width": 20, "height": 20, "confidence": 0.5}
        ])
        with self.assertRaisesRegex(HostFallbackError, "confidence"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url(), "matchConfidence": 0.9},
                low,
            )
        self.assertFalse(any(call[0] == "click" for call in low.calls))

    def test_visual_match_revalidates_stale_window_and_display_after_search(self):
        changed_window = {**DEFAULT_WINDOW, "windowId": 303, "title": "Other - Chromium"}
        stale_window = FakeAdapter(windows=[DEFAULT_WINDOW, changed_window])
        with self.assertRaisesRegex(HostFallbackError, "window changed"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url()},
                stale_window,
            )
        self.assertFalse(any(call[0] == "click" for call in stale_window.calls))

        changed_screen = {**DEFAULT_SCREEN, "left": -2560, "width": 4480}
        stale_display = FakeAdapter(screens=[DEFAULT_SCREEN, changed_screen])
        with self.assertRaisesRegex(HostFallbackError, "display layout changed"):
            execute_visual_match_action(
                self.config,
                {"action": "click", "imageDataUrl": png_data_url()},
                stale_display,
            )
        self.assertFalse(any(call[0] == "click" for call in stale_display.calls))

    def test_template_decoder_bounds_encoded_size_dimensions_and_mime(self):
        with self.assertRaisesRegex(HostFallbackError, "size limit"):
            decode_template_image({"image": "A" * (MAX_TEMPLATE_BASE64_CHARS + 1)})

        with self.assertRaisesRegex(HostFallbackError, "dimensions"):
            decode_template_image({"imageDataUrl": png_data_url(MAX_TEMPLATE_DIMENSION + 1, 1)})

        with self.assertRaisesRegex(HostFallbackError, "does not match"):
            decode_template_image({"imageDataUrl": png_data_url(mime="image/jpeg")})

        with self.assertRaisesRegex(HostFallbackError, "Invalid"):
            decode_template_image({"imageDataUrl": "data:image/png,not-base64"})


if __name__ == "__main__":
    unittest.main()
