import sys
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from fallback_input import execute_host_action
from window_validation import HostFallbackError, host_window_status, validate_host_action


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


NEGATIVE_DPI_SCREEN = {"left": -2560, "top": -100, "width": 4480, "height": 1540}
NEGATIVE_DPI_WINDOW = {
    **DEFAULT_WINDOW,
    "left": -1500,
    "top": 20,
    "width": 1200,
    "height": 900,
    "clientBounds": {"left": -1493, "top": 25, "width": 1186, "height": 888},
    "rendererViewports": [{
        "windowId": 501,
        "className": "Chrome_RenderWidgetHostHWND",
        "left": -1492,
        "top": 163,
        "width": 1185,
        "height": 750,
    }],
    "dpi": 144,
    "scaleFactor": 1.5,
    "dpiAwareness": "per_monitor_v2",
}
NEGATIVE_DPI_REQUEST = {
    "action": "click",
    "coordinateSpace": "css_viewport",
    "clientPoint": {"x": 100, "y": 50},
    "clientBounds": {
        "left": 90,
        "top": 40,
        "width": 20,
        "height": 20,
        "viewportWidth": 790,
        "viewportHeight": 500,
        "devicePixelRatio": 1.5,
    },
    "devicePixelRatio": 1.5,
    "coordinateConfidence": 0.95,
    "expectedWindowTitle": "Chromium",
}


class FakeAdapter:
    def __init__(self, screens=None, windows=None, sessions=None):
        self.calls = []
        self.screens = list(screens or [DEFAULT_SCREEN])
        self.windows = list(windows or [DEFAULT_WINDOW])
        self.sessions = list(sessions or [DEFAULT_SESSION])
        self.screen_index = 0
        self.window_index = 0
        self.session_index = 0

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

    def test_window_status_reports_verified_virtual_desktop_context(self):
        result = host_window_status(
            self.config,
            {"expectedWindowTitle": "Chromium"},
            self.adapter,
        )

        self.assertTrue(result["enabled"])
        self.assertTrue(result["matchesExpectedWindow"])
        self.assertTrue(result["browserVerified"])
        self.assertTrue(result["contextAvailable"])
        self.assertIsNone(result["contextError"])
        self.assertEqual(result["screen"], DEFAULT_SCREEN)
        self.assertEqual(result["foregroundWindow"]["processName"], "chromium.exe")
        self.assertEqual(result["session"]["desktopName"], "Default")
        self.assertIn("click", result["supportedActions"])
        self.assertEqual(len(result["supportedActions"]), len(set(result["supportedActions"])))
        self.assertIn("type", result["supportedActions"])
        self.assertNotIn("typeText", result["supportedActions"])

    def test_validate_refuses_disabled_low_confidence_and_wrong_window(self):
        with self.assertRaisesRegex(HostFallbackError, "disabled"):
            validate_host_action(
                {"hostFallback": {"enabled": False}},
                {"action": "click", "x": -1400, "y": 100, "coordinateConfidence": 1},
                self.adapter,
            )

        with self.assertRaisesRegex(HostFallbackError, "confidence"):
            validate_host_action(
                self.config,
                {"action": "click", "x": -1400, "y": 100, "coordinateConfidence": 0.25},
                FakeAdapter(),
            )

        with self.assertRaisesRegex(HostFallbackError, "foreground"):
            validate_host_action(
                self.config,
                {
                    "action": "click",
                    "x": -1400,
                    "y": 100,
                    "coordinateConfidence": 1,
                    "expectedWindowTitle": "Notepad",
                },
                FakeAdapter(),
            )

    def test_context_fails_closed_for_missing_display_locked_session_and_non_browser(self):
        cases = [
            (
                "display",
                FakeAdapter(screens=[{"left": 0, "top": 0, "width": 0, "height": 0}]),
                "display bounds",
            ),
            (
                "locked",
                FakeAdapter(sessions=[{"available": True, "interactive": False, "desktopName": "Winlogon"}]),
                "locked",
            ),
            ("window", FakeAdapter(windows=[None]), "verified Chrome"),
            (
                "process",
                FakeAdapter(windows=[{**DEFAULT_WINDOW, "processName": "notepad.exe"}]),
                "verified Chrome",
            ),
            (
                "class",
                FakeAdapter(windows=[{**DEFAULT_WINDOW, "className": "Notepad"}]),
                "verified Chrome",
            ),
            (
                "minimized",
                FakeAdapter(windows=[{**DEFAULT_WINDOW, "minimized": True}]),
                "verified Chrome",
            ),
        ]
        request = {"action": "shortcut", "keys": ["ctrl", "l"]}
        for label, adapter, message in cases:
            with self.subTest(label=label), self.assertRaisesRegex(HostFallbackError, message):
                execute_host_action(self.config, request, adapter)
            self.assertEqual(adapter.calls, [])

    def test_pointer_action_refuses_raw_physical_coordinates(self):
        with self.assertRaisesRegex(HostFallbackError, "explicit css_viewport"):
            execute_host_action(
                self.config,
                {
                    "action": "click",
                    "x": -1380,
                    "y": 210,
                    "coordinateSpace": "physical_screen",
                    "coordinateConfidence": 0.95,
                    "expectedWindowTitle": "Chromium",
                },
                self.adapter,
            )
        self.assertEqual(self.adapter.calls, [])

    def test_css_viewport_coordinates_map_to_physical_negative_origin_monitor(self):
        adapter = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW],
        )

        validated = validate_host_action(
            self.config,
            NEGATIVE_DPI_REQUEST,
            adapter,
        )

        self.assertEqual((validated["x"], validated["y"]), (-1342, 238))
        self.assertEqual(validated["coordinateSpace"], "physical_screen")
        self.assertEqual(validated["sourceCoordinateSpace"], "css_viewport")
        self.assertEqual(
            validated["coordinateMapping"]["method"],
            "verified_renderer_viewport",
        )
        self.assertEqual(
            validated["coordinateMapping"]["physicalClientBounds"],
            NEGATIVE_DPI_WINDOW["clientBounds"],
        )

    def test_css_viewport_mapping_keeps_right_bottom_edge_inside_half_open_renderer(self):
        request = {
            **NEGATIVE_DPI_REQUEST,
            "clientPoint": {"x": 789.75, "y": 499.75},
        }

        validated = validate_host_action(
            self.config,
            request,
            FakeAdapter(
                screens=[NEGATIVE_DPI_SCREEN],
                windows=[NEGATIVE_DPI_WINDOW],
            ),
        )

        self.assertEqual((validated["x"], validated["y"]), (-308, 912))

    def test_css_viewport_coordinates_map_on_positive_mixed_dpi_monitor(self):
        screen = {"left": -2560, "top": -100, "width": 6400, "height": 1540}
        window = {
            **DEFAULT_WINDOW,
            "left": 1920,
            "top": 0,
            "width": 1250,
            "height": 1000,
            "clientBounds": {"left": 1926, "top": 5, "width": 1238, "height": 989},
            "rendererViewports": [{
                "windowId": 502,
                "className": "Chrome_RenderWidgetHostHWND",
                "left": 1926,
                "top": 119,
                "width": 1238,
                "height": 875,
            }],
            "dpi": 120,
            "scaleFactor": 1.25,
            "dpiAwareness": "per_monitor",
        }
        request = {
            **NEGATIVE_DPI_REQUEST,
            "clientPoint": {"x": 200, "y": 120},
            "clientBounds": {
                **NEGATIVE_DPI_REQUEST["clientBounds"],
                "viewportWidth": 990,
                "viewportHeight": 700,
                "devicePixelRatio": 1.25,
            },
            "devicePixelRatio": 1.25,
        }
        adapter = FakeAdapter(screens=[screen], windows=[window])

        result = execute_host_action(self.config, request, adapter)

        self.assertEqual((result["x"], result["y"]), (2176, 269))
        self.assertEqual(
            adapter.calls,
            [("click", 2176, 269, {"button": "left"})],
        )

    def test_css_mapping_uses_horizontally_inset_renderer_with_side_panel(self):
        screen = {"left": 0, "top": 0, "width": 2560, "height": 1440}
        window = {
            **DEFAULT_WINDOW,
            "left": 100,
            "top": 50,
            "width": 2000,
            "height": 1200,
            "clientBounds": {
                "left": 108,
                "top": 58,
                "width": 1984,
                "height": 1184,
            },
            "rendererViewports": [{
                "windowId": 503,
                "className": "Chrome_RenderWidgetHostHWND",
                "left": 508,
                "top": 208,
                "width": 1500,
                "height": 900,
            }],
            "dpi": 144,
            "scaleFactor": 1.5,
            "dpiAwareness": "per_monitor_v2",
        }
        request = {
            **NEGATIVE_DPI_REQUEST,
            "clientPoint": {"x": 100, "y": 50},
            "clientBounds": {
                **NEGATIVE_DPI_REQUEST["clientBounds"],
                "viewportWidth": 1000,
                "viewportHeight": 600,
                "devicePixelRatio": 1.5,
            },
            "devicePixelRatio": 1.5,
        }
        adapter = FakeAdapter(screens=[screen], windows=[window])

        result = execute_host_action(self.config, request, adapter)

        self.assertEqual((result["x"], result["y"]), (658, 283))
        self.assertEqual(
            result["coordinateMapping"]["physicalRendererViewport"]["left"],
            508,
        )
        self.assertNotEqual(
            result["x"],
            window["clientBounds"]["left"] + 150,
            "mapping must use the verified renderer inset, not the full client area",
        )
        self.assertEqual(
            adapter.calls,
            [("click", 658, 283, {"button": "left"})],
        )

    def test_css_mapping_fails_closed_for_missing_or_inconsistent_metrics(self):
        adapter = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW],
        )
        missing_client_point = dict(NEGATIVE_DPI_REQUEST)
        missing_client_point.pop("clientPoint")
        with self.assertRaisesRegex(HostFallbackError, "mapping is unavailable.*clientPoint"):
            validate_host_action(self.config, missing_client_point, adapter)

        missing_viewport_width = {
            **NEGATIVE_DPI_REQUEST,
            "clientBounds": {
                key: value
                for key, value in NEGATIVE_DPI_REQUEST["clientBounds"].items()
                if key != "viewportWidth"
            },
        }
        with self.assertRaisesRegex(HostFallbackError, "missing clientBounds.viewportWidth"):
            validate_host_action(
                self.config,
                missing_viewport_width,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[NEGATIVE_DPI_WINDOW],
                ),
            )

        inconsistent_dpr = {**NEGATIVE_DPI_REQUEST, "devicePixelRatio": 2}
        with self.assertRaisesRegex(HostFallbackError, "devicePixelRatio metrics disagree"):
            validate_host_action(
                self.config,
                inconsistent_dpr,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[NEGATIVE_DPI_WINDOW],
                ),
            )

        missing_renderer = dict(NEGATIVE_DPI_WINDOW)
        missing_renderer.pop("rendererViewports")
        with self.assertRaisesRegex(HostFallbackError, "no verified renderer viewport"):
            validate_host_action(
                self.config,
                NEGATIVE_DPI_REQUEST,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[missing_renderer],
                ),
            )

        unusable_dpi_mode = {**NEGATIVE_DPI_WINDOW, "dpiAwareness": "system"}
        with self.assertRaisesRegex(HostFallbackError, "per-monitor DPI awareness"):
            validate_host_action(
                self.config,
                NEGATIVE_DPI_REQUEST,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[unusable_dpi_mode],
                ),
            )

    def test_css_mapping_supports_page_zoom_and_refuses_ambiguous_renderers(self):
        zoomed_request = {
            **NEGATIVE_DPI_REQUEST,
            "clientPoint": {"x": 80, "y": 40},
            "clientBounds": {
                **NEGATIVE_DPI_REQUEST["clientBounds"],
                "viewportWidth": 632,
                "viewportHeight": 400,
                "devicePixelRatio": 1.875,
            },
            "devicePixelRatio": 1.875,
        }
        zoomed_adapter = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW],
        )
        self.assertEqual(
            zoomed_request["devicePixelRatio"],
            (NEGATIVE_DPI_WINDOW["dpi"] / 96) * 1.25,
        )

        zoomed_result = execute_host_action(
            self.config,
            zoomed_request,
            zoomed_adapter,
        )

        self.assertEqual((zoomed_result["x"], zoomed_result["y"]), (-1342, 238))
        self.assertEqual(
            zoomed_adapter.calls,
            [("click", -1342, 238, {"button": "left"})],
        )

        duplicate_renderer = {
            **NEGATIVE_DPI_WINDOW,
            "rendererViewports": [
                *NEGATIVE_DPI_WINDOW["rendererViewports"],
                {
                    **NEGATIVE_DPI_WINDOW["rendererViewports"][0],
                    "windowId": 503,
                },
            ],
        }
        with self.assertRaisesRegex(HostFallbackError, "renderer viewport is ambiguous"):
            validate_host_action(
                self.config,
                NEGATIVE_DPI_REQUEST,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[duplicate_renderer],
                ),
            )

        missing_physical_client = dict(NEGATIVE_DPI_WINDOW)
        missing_physical_client.pop("clientBounds")
        with self.assertRaisesRegex(HostFallbackError, "client bounds are missing"):
            validate_host_action(
                self.config,
                NEGATIVE_DPI_REQUEST,
                FakeAdapter(
                    screens=[NEGATIVE_DPI_SCREEN],
                    windows=[missing_physical_client],
                ),
            )

    def test_css_mapping_accepts_fractional_high_zoom_renderer_rounding(self):
        request = {
            **NEGATIVE_DPI_REQUEST,
            "clientPoint": {"x": 80, "y": 40},
            "clientBounds": {
                **NEGATIVE_DPI_REQUEST["clientBounds"],
                "viewportWidth": 451,
                "viewportHeight": 285,
                "devicePixelRatio": 2.625,
            },
            "devicePixelRatio": 2.625,
        }
        adapter = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW],
        )

        result = execute_host_action(self.config, request, adapter)

        self.assertEqual(result["coordinateMapping"]["method"], "verified_renderer_viewport")
        self.assertEqual(result["coordinateMapping"]["devicePixelRatio"], 2.625)
        self.assertEqual(len(adapter.calls), 1)

    def test_css_mapping_fails_closed_when_client_geometry_or_dpi_goes_stale(self):
        changed_client = {
            **NEGATIVE_DPI_WINDOW,
            "clientBounds": {
                **NEGATIVE_DPI_WINDOW["clientBounds"],
                "left": NEGATIVE_DPI_WINDOW["clientBounds"]["left"] + 1,
            },
        }
        stale_client = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW, changed_client],
        )
        with self.assertRaisesRegex(HostFallbackError, "window changed"):
            execute_host_action(self.config, NEGATIVE_DPI_REQUEST, stale_client)
        self.assertEqual(stale_client.calls, [])

        changed_dpi = {**NEGATIVE_DPI_WINDOW, "dpi": 192, "scaleFactor": 2}
        stale_dpi = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW, changed_dpi],
        )
        with self.assertRaisesRegex(HostFallbackError, "window changed"):
            execute_host_action(self.config, NEGATIVE_DPI_REQUEST, stale_dpi)
        self.assertEqual(stale_dpi.calls, [])

        changed_renderer = {
            **NEGATIVE_DPI_WINDOW,
            "rendererViewports": [{
                **NEGATIVE_DPI_WINDOW["rendererViewports"][0],
                "left": NEGATIVE_DPI_WINDOW["rendererViewports"][0]["left"] + 1,
            }],
        }
        stale_renderer = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW, changed_renderer],
        )
        with self.assertRaisesRegex(HostFallbackError, "window changed"):
            execute_host_action(self.config, NEGATIVE_DPI_REQUEST, stale_renderer)
        self.assertEqual(stale_renderer.calls, [])

    def test_stale_window_or_display_revalidation_blocks_input(self):
        changed_window = {
            **NEGATIVE_DPI_WINDOW,
            "windowId": 303,
            "title": "Other - Chromium",
        }
        stale_window = FakeAdapter(
            screens=[NEGATIVE_DPI_SCREEN],
            windows=[NEGATIVE_DPI_WINDOW, changed_window],
        )
        with self.assertRaisesRegex(HostFallbackError, "window changed"):
            execute_host_action(self.config, NEGATIVE_DPI_REQUEST, stale_window)
        self.assertEqual(stale_window.calls, [])

        changed_screen = {**DEFAULT_SCREEN, "left": -2560, "width": 4480}
        stale_display = FakeAdapter(screens=[DEFAULT_SCREEN, changed_screen])
        with self.assertRaisesRegex(HostFallbackError, "display layout changed"):
            execute_host_action(
                self.config,
                {"action": "shortcut", "keys": ["ctrl", "l"]},
                stale_display,
            )
        self.assertEqual(stale_display.calls, [])

    def test_validate_normalizes_legacy_coordinate_confidence_scale(self):
        result = validate_host_action(
            self.config,
            {
                **NEGATIVE_DPI_REQUEST,
                "coordinateConfidence": 92,
            },
            FakeAdapter(
                screens=[NEGATIVE_DPI_SCREEN],
                windows=[NEGATIVE_DPI_WINDOW],
            ),
        )

        self.assertEqual(result["coordinateConfidence"], 0.92)

    def test_execute_keyboard_shortcut_requires_browser_context_not_coordinates(self):
        result = execute_host_action(
            self.config,
            {"action": "shortcut", "keys": ["ctrl", "l"], "expectedWindowTitle": "Chromium"},
            self.adapter,
        )

        self.assertTrue(result["performed"])
        self.assertEqual(self.adapter.calls, [("hotkey", ("ctrl", "l"))])


if __name__ == "__main__":
    unittest.main()
