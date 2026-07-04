APP_NAME = "BRunnerHost"
ENTRY_SCRIPT = "app.py"

HIDDEN_IMPORTS = [
    "app_paths",
    "atomic_io",
    "brunner_host",
    "companion_service",
    "cv2",
    "data_source",
    "desktop.main_window",
    "directory_registry",
    "execution_log_storage",
    "fallback_input",
    "file_access",
    "host_settings",
    "PIL.Image",
    "PIL.ImageGrab",
    "PIL.PngImagePlugin",
    "pyautogui",
    "pyscreeze",
    "PySide6.QtCore",
    "PySide6.QtGui",
    "PySide6.QtWidgets",
    "websockets",
    "websockets.server",
    "workflow_location",
    "workflow_repository",
    "workflow_storage",
    "visual_match",
    "window_validation",
]

MODULE_EXCLUDES = [
    "PyQt5",
    "PyQt6",
    "brunner_host copy",
    "host_ui",
    "tests",
    "tkinter",
    "_tkinter",
]

RELEASE_EXCLUDE_PATTERNS = [
    "AllowedFiles/",
    "Logs/",
    "Workflows/",
    "build/",
    "dist/",
    "release/",
    "__pycache__/",
    "*.bak",
    "*.log",
    "*.pyc",
    "brunner_config.json",
    "brunner_host copy.py",
    "tests/",
]
