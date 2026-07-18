import sys
import types
import unittest
from types import SimpleNamespace
from unittest import mock


from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

import windows_desktop


class WindowsDesktopDpiTests(unittest.TestCase):
    def dpi_context(self, win_dll):
        return (
            mock.patch.object(windows_desktop.os, "name", "nt"),
            mock.patch.object(windows_desktop, "_dpi_awareness_attempted", False),
            mock.patch.object(windows_desktop, "_dpi_awareness_mode", None),
            mock.patch.object(windows_desktop.ctypes, "WinDLL", side_effect=win_dll),
        )

    def test_per_monitor_v2_is_set_before_virtual_screen_snapshot(self):
        events = []
        metrics = {
            windows_desktop.SM_XVIRTUALSCREEN: -1920,
            windows_desktop.SM_YVIRTUALSCREEN: -100,
            windows_desktop.SM_CXVIRTUALSCREEN: 3840,
            windows_desktop.SM_CYVIRTUALSCREEN: 1180,
        }
        per_monitor_v2 = mock.Mock(
            side_effect=lambda _context: events.append("dpi:per_monitor_v2") or True
        )
        get_metric = mock.Mock(
            side_effect=lambda metric: events.append(f"screen:{metric}") or metrics[metric]
        )
        user32 = SimpleNamespace(
            SetProcessDpiAwarenessContext=per_monitor_v2,
            SetProcessDPIAware=mock.Mock(
                side_effect=lambda: events.append("dpi:system") or True
            ),
            GetSystemMetrics=get_metric,
        )

        def win_dll(name, **_kwargs):
            events.append(f"load:{name}")
            if name == "user32":
                return user32
            raise AssertionError(f"Unexpected fallback library: {name}")

        patches = self.dpi_context(win_dll)
        with patches[0], patches[1], patches[2], patches[3]:
            adapter = windows_desktop.WindowsDesktopAdapter(input_provider=object())
            bounds = adapter.virtual_screen_bounds()

        self.assertEqual(adapter.dpi_awareness, "per_monitor_v2")
        self.assertEqual(bounds, {
            "left": -1920,
            "top": -100,
            "width": 3840,
            "height": 1180,
        })
        self.assertEqual(per_monitor_v2.call_count, 1)
        self.assertNotIn("load:shcore", events)
        self.assertLess(events.index("dpi:per_monitor_v2"), events.index(f"screen:{windows_desktop.SM_XVIRTUALSCREEN}"))

    def test_falls_back_to_shcore_per_monitor_awareness(self):
        calls = []
        user32 = SimpleNamespace(
            SetProcessDpiAwarenessContext=mock.Mock(
                side_effect=lambda _context: calls.append("per_monitor_v2") or False
            ),
            SetProcessDPIAware=mock.Mock(
                side_effect=lambda: calls.append("system") or True
            ),
        )
        shcore = SimpleNamespace(
            SetProcessDpiAwareness=mock.Mock(
                side_effect=lambda awareness: calls.append(("per_monitor", awareness)) or 0
            )
        )

        def win_dll(name, **_kwargs):
            return user32 if name == "user32" else shcore

        patches = self.dpi_context(win_dll)
        with patches[0], patches[1], patches[2], patches[3]:
            mode = windows_desktop.initialize_windows_dpi_awareness()

        self.assertEqual(mode, "per_monitor")
        self.assertEqual(calls, [
            "per_monitor_v2",
            ("per_monitor", windows_desktop.PROCESS_PER_MONITOR_DPI_AWARE),
        ])
        user32.SetProcessDPIAware.assert_not_called()

    def test_falls_back_to_legacy_system_awareness_when_newer_apis_fail(self):
        calls = []
        user32 = SimpleNamespace(
            SetProcessDpiAwarenessContext=mock.Mock(
                side_effect=lambda _context: calls.append("per_monitor_v2") or False
            ),
            SetProcessDPIAware=mock.Mock(
                side_effect=lambda: calls.append("system") or True
            ),
        )
        shcore = SimpleNamespace(
            SetProcessDpiAwareness=mock.Mock(
                side_effect=lambda _awareness: calls.append("per_monitor") or -1
            )
        )

        def win_dll(name, **_kwargs):
            return user32 if name == "user32" else shcore

        patches = self.dpi_context(win_dll)
        with patches[0], patches[1], patches[2], patches[3]:
            mode = windows_desktop.initialize_windows_dpi_awareness()

        self.assertEqual(mode, "system")
        self.assertEqual(calls, ["per_monitor_v2", "per_monitor", "system"])

    def test_initialization_is_idempotent_and_precedes_lazy_pyautogui_use(self):
        events = []
        per_monitor_v2 = mock.Mock(
            side_effect=lambda _context: events.append("dpi") or True
        )
        user32 = SimpleNamespace(SetProcessDpiAwarenessContext=per_monitor_v2)

        def win_dll(name, **_kwargs):
            if name != "user32":
                raise AssertionError(f"Unexpected fallback library: {name}")
            return user32

        pyautogui = types.ModuleType("pyautogui")
        pyautogui.click = lambda *_args, **_kwargs: events.append("pyautogui:click")
        patches = self.dpi_context(win_dll)
        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            mock.patch.dict(sys.modules, {"pyautogui": pyautogui}),
        ):
            adapter = windows_desktop.WindowsDesktopAdapter()
            self.assertEqual(
                windows_desktop.initialize_windows_dpi_awareness(),
                "per_monitor_v2",
            )
            adapter.click(10, 20)
            windows_desktop.WindowsDesktopAdapter(input_provider=object())

        self.assertEqual(per_monitor_v2.call_count, 1)
        self.assertEqual(events, ["dpi", "pyautogui:click"])

    def test_renderer_viewport_enumeration_returns_only_visible_chrome_renderers(self):
        classes = {
            2: "Chrome_RenderWidgetHostHWND",
            3: "Notepad",
            4: "Chrome_RenderWidgetHostHWND",
        }

        def enum_children(_parent, callback, _parameter):
            for handle in classes:
                callback(handle, 0)
            return True

        def get_class_name(handle, buffer, _length):
            buffer.value = classes[handle]
            return len(buffer.value)

        def get_client_rect(handle, pointer):
            rect = pointer._obj
            rect.left = 0
            rect.top = 0
            rect.right = 1185 if handle == 2 else 400
            rect.bottom = 750 if handle == 2 else 300
            return True

        def client_to_screen(handle, pointer):
            point = pointer._obj
            point.x = -1492 if handle == 2 else 10
            point.y = 163 if handle == 2 else 10
            return True

        user32 = SimpleNamespace(
            EnumChildWindows=enum_children,
            GetClassNameW=get_class_name,
            IsWindowVisible=lambda handle: handle != 4,
            GetClientRect=get_client_rect,
            ClientToScreen=client_to_screen,
        )

        viewports = windows_desktop.WindowsDesktopAdapter._renderer_viewports(
            user32,
            1,
            lambda callback: callback,
        )

        self.assertEqual(viewports, [{
            "windowId": 2,
            "className": "Chrome_RenderWidgetHostHWND",
            "left": -1492,
            "top": 163,
            "width": 1185,
            "height": 750,
        }])


if __name__ == "__main__":
    unittest.main()
