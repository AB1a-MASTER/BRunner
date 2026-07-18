import ctypes
import os
import threading
from ctypes import wintypes
from pathlib import Path


SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
DESKTOP_SWITCHDESKTOP = 0x0100
UOI_NAME = 2
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
PROCESS_PER_MONITOR_DPI_AWARE = 2
CHROME_RENDERER_WINDOW_CLASS = "chrome_renderwidgethosthwnd"


_dpi_awareness_lock = threading.Lock()
_dpi_awareness_attempted = False
_dpi_awareness_mode = None


def initialize_windows_dpi_awareness():
    """Set process DPI awareness once, before any screen-coordinate API use."""
    if os.name != "nt":
        return "not_windows"

    global _dpi_awareness_attempted, _dpi_awareness_mode
    with _dpi_awareness_lock:
        if _dpi_awareness_attempted:
            return _dpi_awareness_mode

        _dpi_awareness_mode = _set_windows_dpi_awareness()
        _dpi_awareness_attempted = True
        return _dpi_awareness_mode


def _set_windows_dpi_awareness():
    user32 = _load_windows_library("user32")
    per_monitor_v2 = getattr(user32, "SetProcessDpiAwarenessContext", None)
    if callable(per_monitor_v2):
        _configure_ctypes_function(
            per_monitor_v2,
            [wintypes.HANDLE],
            wintypes.BOOL,
        )
        try:
            context = ctypes.c_void_p(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
            if per_monitor_v2(context):
                return "per_monitor_v2"
        except (AttributeError, OSError, TypeError, ValueError):
            pass

    shcore = _load_windows_library("shcore")
    per_monitor = getattr(shcore, "SetProcessDpiAwareness", None)
    if callable(per_monitor):
        _configure_ctypes_function(
            per_monitor,
            [ctypes.c_int],
            ctypes.c_long,
        )
        try:
            if int(per_monitor(PROCESS_PER_MONITOR_DPI_AWARE)) == 0:
                return "per_monitor"
        except (AttributeError, OSError, TypeError, ValueError):
            pass

    system_aware = getattr(user32, "SetProcessDPIAware", None)
    if callable(system_aware):
        _configure_ctypes_function(system_aware, [], wintypes.BOOL)
        try:
            if system_aware():
                return "system"
        except (AttributeError, OSError, TypeError, ValueError):
            pass

    return "unavailable"


def _load_windows_library(name):
    try:
        return ctypes.WinDLL(name, use_last_error=True)
    except (AttributeError, OSError, ValueError):
        return None


def _configure_ctypes_function(function, argtypes, restype):
    try:
        function.argtypes = argtypes
        function.restype = restype
    except (AttributeError, TypeError):
        pass


class WindowsDesktopAdapter:
    """PyAutoGUI input plus fail-closed Win32 desktop/window inspection."""

    def __init__(self, input_provider=None):
        self.dpi_awareness = initialize_windows_dpi_awareness()
        self._input_provider = input_provider

    def __getattr__(self, name):
        initialize_windows_dpi_awareness()
        provider = self._input_provider
        if provider is None:
            import pyautogui

            provider = pyautogui
            self._input_provider = provider
        return getattr(provider, name)

    def virtual_screen_bounds(self):
        initialize_windows_dpi_awareness()
        if os.name != "nt":
            return None
        try:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            left = int(user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
            top = int(user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
            width = int(user32.GetSystemMetrics(SM_CXVIRTUALSCREEN))
            height = int(user32.GetSystemMetrics(SM_CYVIRTUALSCREEN))
        except (AttributeError, OSError):
            return None
        if width <= 0 or height <= 0:
            return None
        return {"left": left, "top": top, "width": width, "height": height}

    def session_snapshot(self):
        initialize_windows_dpi_awareness()
        if os.name != "nt":
            return {
                "available": False,
                "interactive": False,
                "desktopName": None,
            }

        desktop = None
        try:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.OpenInputDesktop.restype = wintypes.HANDLE
            user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            user32.GetUserObjectInformationW.argtypes = [
                wintypes.HANDLE,
                ctypes.c_int,
                wintypes.LPVOID,
                wintypes.DWORD,
                ctypes.POINTER(wintypes.DWORD),
            ]
            user32.GetUserObjectInformationW.restype = wintypes.BOOL
            user32.CloseDesktop.argtypes = [wintypes.HANDLE]
            user32.CloseDesktop.restype = wintypes.BOOL

            desktop = user32.OpenInputDesktop(0, False, DESKTOP_SWITCHDESKTOP)
            if not desktop:
                return {
                    "available": False,
                    "interactive": False,
                    "desktopName": None,
                }

            required = wintypes.DWORD(0)
            user32.GetUserObjectInformationW(desktop, UOI_NAME, None, 0, ctypes.byref(required))
            if required.value <= 2:
                return {
                    "available": False,
                    "interactive": False,
                    "desktopName": None,
                }

            buffer = ctypes.create_unicode_buffer(max(2, required.value // ctypes.sizeof(wintypes.WCHAR)))
            if not user32.GetUserObjectInformationW(
                desktop,
                UOI_NAME,
                buffer,
                ctypes.sizeof(buffer),
                ctypes.byref(required),
            ):
                return {
                    "available": False,
                    "interactive": False,
                    "desktopName": None,
                }

            name = str(buffer.value or "").strip()
            return {
                "available": bool(name),
                "interactive": name.casefold() == "default",
                "desktopName": name or None,
            }
        except (AttributeError, OSError, ValueError):
            return {
                "available": False,
                "interactive": False,
                "desktopName": None,
            }
        finally:
            if desktop:
                try:
                    user32.CloseDesktop(desktop)
                except (AttributeError, OSError):
                    pass

    def foreground_window_snapshot(self):
        dpi_awareness = initialize_windows_dpi_awareness()
        if os.name != "nt":
            return None
        try:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            user32.GetForegroundWindow.restype = wintypes.HWND
            user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            user32.GetWindowRect.restype = wintypes.BOOL
            user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            user32.GetClientRect.restype = wintypes.BOOL
            user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
            user32.ClientToScreen.restype = wintypes.BOOL
            user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
            user32.GetWindowTextLengthW.restype = ctypes.c_int
            user32.GetWindowTextW.argtypes = [
                wintypes.HWND,
                wintypes.LPWSTR,
                ctypes.c_int,
            ]
            user32.GetWindowTextW.restype = ctypes.c_int
            user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
            user32.GetClassNameW.restype = ctypes.c_int
            user32.GetWindowThreadProcessId.argtypes = [
                wintypes.HWND,
                ctypes.POINTER(wintypes.DWORD),
            ]
            user32.GetWindowThreadProcessId.restype = wintypes.DWORD
            user32.IsWindowVisible.argtypes = [wintypes.HWND]
            user32.IsWindowVisible.restype = wintypes.BOOL
            user32.IsIconic.argtypes = [wintypes.HWND]
            user32.IsIconic.restype = wintypes.BOOL
            enum_child_callback = ctypes.WINFUNCTYPE(
                wintypes.BOOL,
                wintypes.HWND,
                wintypes.LPARAM,
            )
            user32.EnumChildWindows.argtypes = [
                wintypes.HWND,
                enum_child_callback,
                wintypes.LPARAM,
            ]
            user32.EnumChildWindows.restype = wintypes.BOOL
            get_dpi_for_window = getattr(user32, "GetDpiForWindow", None)
            if callable(get_dpi_for_window):
                get_dpi_for_window.argtypes = [wintypes.HWND]
                get_dpi_for_window.restype = wintypes.UINT
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.QueryFullProcessImageNameW.argtypes = [
                wintypes.HANDLE,
                wintypes.DWORD,
                wintypes.LPWSTR,
                ctypes.POINTER(wintypes.DWORD),
            ]
            kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = user32.GetForegroundWindow()
            if not handle:
                return None

            rect = wintypes.RECT()
            if not user32.GetWindowRect(handle, ctypes.byref(rect)):
                return None

            title = self._window_text(user32, handle)
            class_name = self._window_class(user32, handle)
            process_id = wintypes.DWORD(0)
            user32.GetWindowThreadProcessId(handle, ctypes.byref(process_id))
            executable = self._process_executable(kernel32, process_id.value)
            process_name = Path(executable).name.casefold() if executable else None
            client_bounds = self._client_bounds(user32, handle)
            renderer_viewports = self._renderer_viewports(
                user32,
                handle,
                enum_child_callback,
            )
            window_dpi = self._window_dpi(get_dpi_for_window, handle)

            return {
                "windowId": int(handle),
                "title": title,
                "className": class_name,
                "processId": int(process_id.value),
                "processName": process_name,
                "executable": executable,
                "left": int(rect.left),
                "top": int(rect.top),
                "width": max(0, int(rect.right - rect.left)),
                "height": max(0, int(rect.bottom - rect.top)),
                "clientBounds": client_bounds,
                "rendererViewports": renderer_viewports,
                "dpi": window_dpi,
                "scaleFactor": window_dpi / 96 if window_dpi else None,
                "dpiAwareness": dpi_awareness,
                "visible": bool(user32.IsWindowVisible(handle)),
                "minimized": bool(user32.IsIconic(handle)),
            }
        except (AttributeError, OSError, TypeError, ValueError):
            return None

    @staticmethod
    def capture_region(region):
        initialize_windows_dpi_awareness()
        from PIL import ImageGrab

        left, top, width, height = [int(value) for value in region]
        if width <= 0 or height <= 0:
            raise ValueError("Invalid capture region.")
        return ImageGrab.grab(
            bbox=(left, top, left + width, top + height),
            all_screens=True,
        )

    @staticmethod
    def _window_text(user32, handle):
        length = max(0, int(user32.GetWindowTextLengthW(handle)))
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(handle, buffer, len(buffer))
        return str(buffer.value or "")

    @staticmethod
    def _window_class(user32, handle):
        buffer = ctypes.create_unicode_buffer(256)
        if user32.GetClassNameW(handle, buffer, len(buffer)) <= 0:
            return ""
        return str(buffer.value or "")

    @staticmethod
    def _client_bounds(user32, handle):
        rect = wintypes.RECT()
        origin = wintypes.POINT(0, 0)
        try:
            if not user32.GetClientRect(handle, ctypes.byref(rect)):
                return None
            if not user32.ClientToScreen(handle, ctypes.byref(origin)):
                return None
        except (AttributeError, OSError, TypeError, ValueError):
            return None
        width = max(0, int(rect.right - rect.left))
        height = max(0, int(rect.bottom - rect.top))
        if width <= 0 or height <= 0:
            return None
        return {
            "left": int(origin.x),
            "top": int(origin.y),
            "width": width,
            "height": height,
        }

    @staticmethod
    def _window_dpi(get_dpi_for_window, handle):
        if not callable(get_dpi_for_window):
            return None
        try:
            dpi = int(get_dpi_for_window(handle))
        except (OSError, TypeError, ValueError):
            return None
        return dpi if dpi > 0 else None

    @classmethod
    def _renderer_viewports(cls, user32, handle, callback_type):
        viewports = []

        def collect(child_handle, _parameter):
            try:
                class_name = cls._window_class(user32, child_handle)
                if class_name.casefold() != CHROME_RENDERER_WINDOW_CLASS:
                    return True
                if not user32.IsWindowVisible(child_handle):
                    return True
                bounds = cls._client_bounds(user32, child_handle)
                if not bounds:
                    return True
                viewports.append({
                    "windowId": int(child_handle),
                    "className": class_name,
                    **bounds,
                })
            except (AttributeError, OSError, TypeError, ValueError):
                pass
            return True

        callback = callback_type(collect)
        try:
            user32.EnumChildWindows(handle, callback, 0)
        except (AttributeError, OSError, TypeError, ValueError):
            return []
        return sorted(
            viewports,
            key=lambda viewport: (
                viewport["top"],
                viewport["left"],
                viewport["windowId"],
            ),
        )

    @staticmethod
    def _process_executable(kernel32, process_id):
        if not process_id:
            return None
        process = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id)
        if not process:
            return None
        try:
            size = wintypes.DWORD(32768)
            buffer = ctypes.create_unicode_buffer(size.value)
            if not kernel32.QueryFullProcessImageNameW(process, 0, buffer, ctypes.byref(size)):
                return None
            return str(buffer.value or "") or None
        finally:
            kernel32.CloseHandle(process)
