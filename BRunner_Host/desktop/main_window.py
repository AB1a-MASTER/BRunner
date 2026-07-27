import os
import sys
from datetime import datetime
from pathlib import Path

HOST_DIR = Path(__file__).resolve().parents[1]
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

from app_paths import (
    active_workflows_directory,
    application_directory,
    default_config_file,
    default_log_file,
)
from atomic_io import atomic_write_json
from companion_service import HostServiceController
from directory_registry import list_approved_directories
from host_settings import (
    DEFAULT_PORT,
    is_valid_profile_instance_id,
    load_or_create_config,
    normalize_profile_instance_id,
    save_config,
    unique_alias_id,
)
from product_version import APP_VERSION
from windows_desktop import initialize_windows_dpi_awareness
from window_validation import host_window_status
from workflow_location import (
    apply_workflow_location,
    ensure_writable_directory,
    restore_default_workflow_location,
)
from workflow_repository import WorkflowRepository


def prepare_companion_storage(file_dialog, message_box, anchor_file=None):
    anchor = Path(anchor_file or (Path(__file__).resolve().parents[1] / "app.py"))
    base_dir = application_directory(anchor)
    config_file = default_config_file(anchor)

    try:
        config = load_or_create_config(config_file, base_dir)
        ensure_config_writable(config_file)
    except Exception as error:
        message_box.critical(
            None,
            "BRunner Startup",
            "BRunner could not read, create, or update its configuration file:\n"
            f"{config_file}\n\n"
            "Make the application folder writable, or move the BRunner source folder "
            "to a writable location, then restart BRunner.\n\n"
            f"Details: {error}",
        )
        return False

    workflows_dir = active_workflows_directory(config, base_dir)
    try:
        ensure_writable_directory(workflows_dir)
        return True
    except Exception as error:
        message_box.warning(
            None,
            "Workflow Storage Unavailable",
            "The configured workflow folder is not writable:\n"
            f"{workflows_dir}\n\n"
            "Choose a writable workflow folder to continue.\n\n"
            f"Details: {error}",
        )

    selected = file_dialog.getExistingDirectory(
        None,
        "Choose a writable workflow folder",
        str(Path.home()),
    )
    if not selected:
        message_box.critical(
            None,
            "BRunner Startup",
            "BRunner cannot start until workflow storage is writable. "
            "Restart BRunner and choose a writable folder, or fix the configured "
            "folder's permissions.",
        )
        return False

    try:
        apply_workflow_location(
            config_file,
            base_dir,
            selected,
            "use_new",
        )
    except Exception as error:
        message_box.critical(
            None,
            "BRunner Startup",
            "BRunner could not save the recovered workflow location. "
            "Make both the chosen folder and the application folder writable, "
            "then try again.\n\n"
            f"Details: {error}",
        )
        return False
    return True


def ensure_config_writable(config_file):
    path = Path(config_file)
    with open(path, "a", encoding="utf-8"):
        pass

    probe = path.with_name(f".{path.name}.{os.getpid()}.write-test.tmp")
    try:
        probe.write_text("ok", encoding="utf-8")
    finally:
        try:
            probe.unlink()
        except FileNotFoundError:
            pass


def run_companion_app():
    initialize_windows_dpi_awareness()
    try:
        from PySide6.QtGui import QAction
        from PySide6.QtWidgets import QApplication, QFileDialog, QMessageBox
    except ImportError as error:
        raise SystemExit(
            "PySide6 is not installed. Install BRunner_Host/requirements.txt to run the companion app."
        ) from error

    app = QApplication.instance() or QApplication([])
    app.setApplicationName("BRunner Companion")
    if not prepare_companion_storage(QFileDialog, QMessageBox):
        return 2
    window = BRunnerCompanionWindow(QAction)
    app.aboutToQuit.connect(window.shutdown)
    window.show()
    window.start_configured_host()
    return app.exec()


class BRunnerCompanionWindow:
    def __new__(cls, action_class):
        initialize_windows_dpi_awareness()
        from PySide6.QtCore import QTimer
        from PySide6.QtWidgets import (
            QMainWindow,
            QWidget,
            QVBoxLayout,
            QHBoxLayout,
            QLabel,
            QPushButton,
            QTabWidget,
            QTextEdit,
            QTableWidget,
            QTableWidgetItem,
            QSystemTrayIcon,
            QMenu,
            QApplication,
            QMessageBox,
            QFileDialog,
            QLineEdit,
            QCheckBox,
            QDoubleSpinBox,
            QDialog,
            QFormLayout,
            QDialogButtonBox,
            QAbstractItemView,
            QStyle,
        )

        class _Window(QMainWindow):
            def __init__(self):
                super().__init__()
                self.anchor_file = Path(__file__).resolve().parents[1] / "app.py"
                self.base_dir = application_directory(self.anchor_file)
                self.config_file = default_config_file(self.anchor_file)
                self.log_file = default_log_file(self.anchor_file)
                self.config = load_or_create_config(self.config_file, self.base_dir)
                self.repository = WorkflowRepository(active_workflows_directory(self.config, self.base_dir))
                self.service = HostServiceController(self.base_dir)
                self.file_dialog = QFileDialog
                self.message_box = QMessageBox
                self._shutting_down = False
                self.setWindowTitle("BRunner Companion")
                self.resize(760, 520)

                self.tabs = QTabWidget()
                self.setCentralWidget(self.tabs)
                self._build_status_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QCheckBox)
                self._build_storage_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QCheckBox)
                self._build_folders_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem)
                self._build_fallback_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QCheckBox, QDoubleSpinBox)
                self._build_pairing_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton)
                self._build_diagnostics_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTextEdit)
                self._build_tray(QSystemTrayIcon, QMenu, action_class, QApplication)
                self.refresh()
                self.connection_timer = QTimer(self)
                self.connection_timer.timeout.connect(self.refresh_connection_status)
                self.connection_timer.start(1000)
                self.diagnostics_timer = QTimer(self)
                self.diagnostics_timer.timeout.connect(self.refresh_logs)
                self.diagnostics_timer.start(1000)

            def _build_status_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QCheckBox):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.version_state = QLabel(f"BRunner Companion version: {APP_VERSION}")
                self.host_state = QLabel()
                self.host_port = QLabel()
                self.extension_state = QLabel()
                layout.addWidget(self.version_state)
                layout.addWidget(self.host_state)
                layout.addWidget(self.host_port)
                layout.addWidget(self.extension_state)
                self.start_with_app = QCheckBox("Start host with companion")
                layout.addWidget(self.start_with_app)
                buttons = QHBoxLayout()
                for label, handler in [
                    ("Start Host", self.start_host),
                    ("Stop Host", self.stop_host),
                    ("Restart Host", self.restart_host),
                    ("Save Startup", self.save_startup_settings),
                    ("Refresh", self.refresh),
                ]:
                    button = QPushButton(label)
                    button.clicked.connect(handler)
                    buttons.addWidget(button)
                layout.addLayout(buttons)
                layout.addStretch(1)
                self.tabs.addTab(tab, "Status")

            def _build_storage_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QCheckBox):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.workflow_folder = QLabel()
                layout.addWidget(self.workflow_folder)
                self.recursive_workflow_discovery = QCheckBox(
                    "Include workflows in subfolders"
                )
                self.recursive_workflow_discovery.setToolTip(
                    "When enabled, workflow lists include valid JSON files in "
                    "all subfolders of the active workflow folder."
                )
                self.recursive_workflow_discovery.toggled.connect(
                    self.save_recursive_workflow_discovery
                )
                layout.addWidget(self.recursive_workflow_discovery)
                self.workflow_table = QTableWidget(0, 4)
                self.workflow_table.setHorizontalHeaderLabels(["Filename", "Name", "Schema", "Updated"])
                self.workflow_table.horizontalHeader().setStretchLastSection(True)
                layout.addWidget(self.workflow_table)
                buttons = QHBoxLayout()
                for label, handler in [
                    ("Open Folder", self.open_workflow_folder),
                    ("Change Location", self.change_workflow_location),
                    ("Use Default", self.use_default_workflow_location),
                    ("Refresh", self.refresh_workflows),
                ]:
                    button = QPushButton(label)
                    button.clicked.connect(handler)
                    buttons.addWidget(button)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                self.table_item_class = QTableWidgetItem
                self.tabs.addTab(tab, "Workflow Storage")

            def _build_folders_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.folders_summary = QLabel()
                layout.addWidget(self.folders_summary)
                self.folders_table = QTableWidget(0, 6)
                self.folders_table.setHorizontalHeaderLabels(["Alias", "Name", "Folder", "Read", "Write", "Recursive"])
                self.folders_table.horizontalHeader().setStretchLastSection(True)
                self.folders_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
                self.folders_table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
                layout.addWidget(self.folders_table)
                buttons = QHBoxLayout()
                for label, handler in [
                    ("Add Folder", self.add_approved_folder),
                    ("Edit Folder", self.edit_approved_folder),
                    ("Remove Folder", self.remove_approved_folder),
                    ("Refresh", self.refresh_folders),
                ]:
                    button = QPushButton(label)
                    button.clicked.connect(handler)
                    buttons.addWidget(button)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                self.folder_rows = []
                self.tabs.addTab(tab, "Approved Folders")

            def _build_fallback_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QCheckBox, QDoubleSpinBox):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.fallback_enabled = QCheckBox("Enable visible host fallback")
                layout.addWidget(self.fallback_enabled)
                threshold_row = QHBoxLayout()
                threshold_row.addWidget(QLabel("Minimum coordinate confidence"))
                self.fallback_confidence = QDoubleSpinBox()
                self.fallback_confidence.setRange(0.0, 1.0)
                self.fallback_confidence.setDecimals(2)
                self.fallback_confidence.setSingleStep(0.05)
                threshold_row.addWidget(self.fallback_confidence)
                threshold_row.addStretch(1)
                layout.addLayout(threshold_row)
                self.fallback_context_state = QLabel()
                self.fallback_session_state = QLabel()
                self.fallback_window_state = QLabel()
                self.fallback_window_identity = QLabel()
                self.fallback_screen_state = QLabel()
                self.fallback_context_state.setWordWrap(True)
                self.fallback_window_identity.setWordWrap(True)
                layout.addWidget(self.fallback_context_state)
                layout.addWidget(self.fallback_session_state)
                layout.addWidget(self.fallback_window_state)
                layout.addWidget(self.fallback_window_identity)
                layout.addWidget(self.fallback_screen_state)
                self.fallback_actions_table = QTableWidget(0, 3)
                self.fallback_actions_table.setHorizontalHeaderLabels(["Action", "Description", "Status"])
                self.fallback_actions_table.horizontalHeader().setStretchLastSection(True)
                self.fallback_actions_table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
                self.fallback_actions_table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
                layout.addWidget(self.fallback_actions_table)
                buttons = QHBoxLayout()
                save = QPushButton("Save Settings")
                save.clicked.connect(self.save_host_fallback_settings)
                buttons.addWidget(save)
                refresh = QPushButton("Refresh Status")
                refresh.clicked.connect(self.refresh_fallback)
                buttons.addWidget(refresh)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                self.tabs.addTab(tab, "Host Fallback")

            def _build_pairing_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                layout.addWidget(QLabel("Pair this companion with one BRunner Chrome profile. Copy the profile instance ID from the extension sidebar, paste it here, and select Pair."))
                self.pairing_state = QLabel()
                layout.addWidget(self.pairing_state)
                layout.addWidget(QLabel("Profile instance ID"))
                self.profile_instance_id = QLineEdit()
                self.profile_instance_id.setPlaceholderText("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx")
                self.profile_instance_id.setMaxLength(36)
                layout.addWidget(self.profile_instance_id)
                layout.addWidget(QLabel("WebSocket port (fixed)"))
                self.pairing_port = QLabel(str(DEFAULT_PORT))
                layout.addWidget(self.pairing_port)
                self.pairing_connection = QLabel()
                layout.addWidget(self.pairing_connection)
                buttons = QHBoxLayout()
                for label, handler in [
                    ("Pair", self.pair_profile_instance),
                    ("Copy ID", self.copy_profile_instance_id),
                    ("Unpair", self.unpair_extension),
                ]:
                    button = QPushButton(label)
                    button.clicked.connect(handler)
                    buttons.addWidget(button)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                layout.addStretch(1)
                self.tabs.addTab(tab, "Pairing")

            def _build_diagnostics_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTextEdit):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                layout.addWidget(QLabel("Recent host log"))
                self.log_path_state = QLabel()
                self.log_path_state.setWordWrap(True)
                layout.addWidget(self.log_path_state)
                self.logs = QTextEdit()
                self.logs.setReadOnly(True)
                layout.addWidget(self.logs)
                layout.addWidget(QLabel("Recent capability activity"))
                self.capability_activity = QTextEdit()
                self.capability_activity.setReadOnly(True)
                self.capability_activity.setMaximumHeight(120)
                layout.addWidget(self.capability_activity)
                buttons = QHBoxLayout()
                refresh = QPushButton("Refresh Logs")
                refresh.clicked.connect(self.refresh_logs)
                buttons.addWidget(refresh)
                open_logs = QPushButton("Open Logs")
                open_logs.clicked.connect(self.open_logs)
                buttons.addWidget(open_logs)
                export = QPushButton("Export Diagnostics")
                export.clicked.connect(self.export_diagnostics)
                buttons.addWidget(export)
                clear = QPushButton("Clear Logs")
                clear.clicked.connect(self.clear_logs)
                buttons.addWidget(clear)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                self.tabs.addTab(tab, "Diagnostics")

            def _build_tray(self, QSystemTrayIcon, QMenu, QAction, QApplication):
                self.tray = QSystemTrayIcon(self)
                self.tray.setIcon(self.style().standardIcon(QStyle.StandardPixmap.SP_ComputerIcon))
                menu = QMenu()
                self.tray_status_action = QAction("Host: checking", self)
                self.tray_status_action.setEnabled(False)
                menu.addAction(self.tray_status_action)
                menu.addSeparator()
                self.tray_open_action = QAction("Open BRunner", self)
                self.tray_open_action.triggered.connect(self.show_from_tray)
                menu.addAction(self.tray_open_action)
                self.tray_open_workflows_action = QAction("Open Workflows Folder", self)
                self.tray_open_workflows_action.triggered.connect(self.open_workflow_folder)
                menu.addAction(self.tray_open_workflows_action)
                self.tray_open_logs_action = QAction("Open Logs", self)
                self.tray_open_logs_action.triggered.connect(self.open_logs)
                menu.addAction(self.tray_open_logs_action)
                menu.addSeparator()
                self.tray_start_action = QAction("Start Host", self)
                self.tray_start_action.triggered.connect(self.start_host)
                menu.addAction(self.tray_start_action)
                self.tray_restart_action = QAction("Restart Host", self)
                self.tray_restart_action.triggered.connect(self.restart_host)
                menu.addAction(self.tray_restart_action)
                self.tray_stop_action = QAction("Stop Host", self)
                self.tray_stop_action.triggered.connect(self.stop_host)
                menu.addAction(self.tray_stop_action)
                menu.addSeparator()
                exit_action = QAction("Exit", self)
                exit_action.triggered.connect(self.exit_app)
                menu.addAction(exit_action)
                self.tray.setContextMenu(menu)
                self.tray.activated.connect(
                    lambda reason: self.show_from_tray()
                    if reason == QSystemTrayIcon.ActivationReason.Trigger
                    else None
                )
                self.tray.show()

            def refresh(self):
                self.refresh_connection_status()
                self.repository = WorkflowRepository(active_workflows_directory(self.config, self.base_dir))
                host = self.config.get("host") if isinstance(self.config.get("host"), dict) else {}
                self.start_with_app.setChecked(host.get("startWithApp") is not False)
                self.refresh_workflows()
                self.refresh_folders()
                self.refresh_fallback()
                self.refresh_logs()

            def refresh_connection_status(self):
                self.config = load_or_create_config(self.config_file, self.base_dir)
                status = self.service.status(self.config)
                running = status.get("running") is True
                is_external = status.get("external") is True
                external = " (already listening)" if is_external else ""
                self.version_state.setText(f"BRunner Companion version: {APP_VERSION}")
                self.host_state.setText(f"Host: {'running' if running else 'stopped'}{external}")
                self.host_port.setText(f"WebSocket port: {status.get('port') or 'unknown'}")
                paired = status.get("pairedInstanceId")
                connected = status.get("extensionConnected") is True
                self.extension_state.setText(
                    "Extension: paired and connected"
                    if connected else
                    ("Extension: paired, disconnected" if paired else "Extension: not paired")
                )
                if not self.profile_instance_id.hasFocus():
                    self.profile_instance_id.setText(paired or "")
                self.pairing_port.setText(str(DEFAULT_PORT))
                self.pairing_state.setText(
                    "Pairing: paired"
                    if paired else
                    "Pairing: unpaired"
                )
                self.pairing_connection.setText(
                    f"Connection: {'active' if connected else 'not active'}"
                )
                managed_check = getattr(self.service, "is_running", None)
                try:
                    managed = bool(managed_check()) if callable(managed_check) else running and not is_external
                except Exception:
                    managed = running and not is_external
                state_text = "running (external)" if is_external else ("running" if running else "stopped")
                connection_text = "extension connected" if connected else "extension disconnected"
                self.tray_status_action.setText(f"Host: {state_text}; {connection_text}")
                self.tray_start_action.setEnabled(not running)
                self.tray_restart_action.setEnabled(managed)
                self.tray_stop_action.setEnabled(managed)
                self.tray.setToolTip(
                    f"BRunner Companion {APP_VERSION} — Host {state_text}; {connection_text}"
                )

            def refresh_workflows(self):
                storage = self.config.get("workflowStorage") if isinstance(self.config.get("workflowStorage"), dict) else {}
                discovery = self.config.get("workflowDiscovery") if isinstance(self.config.get("workflowDiscovery"), dict) else {}
                recursive = discovery.get("recursive") is True
                mode = storage.get("mode") or "default"
                self.workflow_folder.setText(
                    f"Active workflow folder ({mode}): {self.repository.workflows_dir}"
                )
                self.recursive_workflow_discovery.blockSignals(True)
                self.recursive_workflow_discovery.setChecked(recursive)
                self.recursive_workflow_discovery.blockSignals(False)
                summaries = self.repository.list_workflow_summaries(
                    recursive=recursive
                )
                self.workflow_table.setRowCount(len(summaries))
                for row, summary in enumerate(summaries):
                    values = [
                        summary["filename"],
                        summary["displayName"],
                        str(summary["schemaVersion"]),
                        str(summary["updatedAt"] or ""),
                    ]
                    for column, value in enumerate(values):
                        self.workflow_table.setItem(row, column, self.table_item_class(value))

            def save_recursive_workflow_discovery(self, enabled):
                current_discovery = (
                    self.config.get("workflowDiscovery")
                    if isinstance(self.config.get("workflowDiscovery"), dict)
                    else {}
                )
                previous = current_discovery.get("recursive") is True
                updated = {
                    **self.config,
                    "workflowDiscovery": {
                        **current_discovery,
                        "recursive": enabled is True,
                    },
                }
                try:
                    self.config = save_config(self.config_file, updated)
                except Exception as error:
                    self.recursive_workflow_discovery.blockSignals(True)
                    self.recursive_workflow_discovery.setChecked(previous)
                    self.recursive_workflow_discovery.blockSignals(False)
                    self.message_box.warning(
                        self,
                        "Workflow Storage",
                        f"Could not save workflow discovery setting: {error}",
                    )
                    return
                mode = "recursive" if enabled else "top-level only"
                self.write_companion_log(
                    f"Workflow discovery set to {mode}."
                )
                self.refresh_workflows()

            def refresh_folders(self):
                self.folder_rows = list_approved_directories(self.config, self.base_dir)
                self.folders_summary.setText(f"Approved folder aliases: {len(self.folder_rows)}")
                self.folders_table.setRowCount(len(self.folder_rows))
                for row, folder in enumerate(self.folder_rows):
                    path = folder.get("path") or ""
                    if not folder.get("available"):
                        path = f"{path} (Unavailable)"
                    values = [
                        folder.get("id") or "",
                        folder.get("displayName") or "",
                        path,
                        "Yes" if folder.get("read") else "No",
                        "Yes" if folder.get("write") else "No",
                        "Yes" if folder.get("recursive") else "No",
                    ]
                    for column, value in enumerate(values):
                        self.folders_table.setItem(row, column, self.table_item_class(value))

            def refresh_fallback(self):
                fallback = self.config.get("hostFallback") if isinstance(self.config.get("hostFallback"), dict) else {}
                self.fallback_enabled.setChecked(fallback.get("enabled") is not False)
                try:
                    confidence = float(fallback.get("minimumCoordinateConfidence", 0.9))
                except (TypeError, ValueError):
                    confidence = 0.9
                self.fallback_confidence.setValue(max(0.0, min(confidence, 1.0)))
                try:
                    status = host_window_status(self.config)
                except Exception as error:
                    status = {
                        "foregroundWindow": None,
                        "screen": {"width": 0, "height": 0},
                        "session": {"available": False, "interactive": False},
                        "browserVerified": False,
                        "contextAvailable": False,
                        "contextError": str(error),
                        "supportedActions": [],
                    }
                    self.write_companion_log(f"Host fallback status unavailable: {error}")
                context_available = status.get("contextAvailable") is True
                context_error = str(status.get("contextError") or "").strip()
                enabled = fallback.get("enabled") is not False
                if not enabled:
                    context_text = "Visible fallback: disabled"
                elif context_available:
                    context_text = "Visible fallback: ready"
                else:
                    context_text = f"Visible fallback blocked: {context_error or 'desktop context unavailable'}"
                self.fallback_context_state.setText(context_text)
                session = status.get("session") or {}
                desktop_name = session.get("desktopName") or "unavailable"
                session_state = "interactive" if session.get("interactive") is True else "locked or unavailable"
                self.fallback_session_state.setText(
                    f"Windows desktop: {desktop_name} ({session_state})"
                )
                window = status.get("foregroundWindow") or {}
                title = window.get("title") or "unavailable"
                self.fallback_window_state.setText(f"Foreground window: {title}")
                process_name = window.get("processName") or "unknown process"
                process_id = window.get("processId") or "unknown PID"
                window_id = window.get("windowId") or "unknown window"
                class_name = window.get("className") or "unknown class"
                verified = "yes" if status.get("browserVerified") is True else "no"
                self.fallback_window_identity.setText(
                    "Verified Chrome/Chromium: "
                    f"{verified} — {process_name} ({process_id}), window {window_id}, class {class_name}"
                )
                screen = status.get("screen") or {}
                self.fallback_screen_state.setText(
                    "Virtual screen: "
                    f"{screen.get('width', 0)} x {screen.get('height', 0)} "
                    f"at ({screen.get('left', 0)}, {screen.get('top', 0)})"
                )
                actions = status.get("supportedActions") or []
                self.fallback_actions_table.setRowCount(len(actions))
                action_status = "Ready" if enabled and context_available else "Blocked"
                for row, action in enumerate(actions):
                    self.fallback_actions_table.setItem(row, 0, self.table_item_class(str(action)))
                    self.fallback_actions_table.setItem(row, 1, self.table_item_class(self.host_fallback_action_description(action)))
                    self.fallback_actions_table.setItem(row, 2, self.table_item_class(action_status))

            def host_fallback_action_description(self, action):
                descriptions = {
                    "click": "Left-clicks the validated screen coordinate.",
                    "doubleClick": "Double-clicks the validated screen coordinate.",
                    "double_click": "Double-clicks the validated screen coordinate.",
                    "move": "Moves the pointer to the validated screen coordinate.",
                    "rightClick": "Right-clicks the validated screen coordinate.",
                    "right_click": "Right-clicks the validated screen coordinate.",
                    "scroll": "Scrolls at the validated screen coordinate.",
                    "paste": "Sends Ctrl+V to the foreground window.",
                    "press": "Presses one approved keyboard key.",
                    "shortcut": "Sends an approved key combination.",
                    "type": "Types visible text into the foreground window.",
                    "typeText": "Types visible text into the foreground window.",
                    "type_text": "Types visible text into the foreground window.",
                }
                return descriptions.get(str(action), "Visible fallback action.")

            def refresh_logs(self):
                self.log_path_state.setText(f"Active log file: {self.log_file}")
                if self.log_file.exists():
                    content = self.log_file.read_text(encoding="utf-8", errors="replace")[-20000:]
                else:
                    content = "No logs yet."
                self.logs.setPlainText(content)
                self.capability_activity.setPlainText(self.extract_capability_activity(content))

            def extract_capability_activity(self, content):
                markers = [
                    "[Fallback]",
                    "[Protocol]",
                    "[Directory]",
                    "[DataSource]",
                    "[File]",
                    "[ExecutionLog]",
                ]
                lines = [
                    line for line in str(content or "").splitlines()
                    if any(marker in line for marker in markers)
                ]
                return "\n".join(lines[-80:])

            def refresh_logs_after_service_change(self):
                self.refresh_logs()
                QTimer.singleShot(300, self.refresh_logs)
                QTimer.singleShot(1000, self.refresh_logs)

            def write_companion_log(self, message):
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S,%f")[:23]
                self.log_file.parent.mkdir(parents=True, exist_ok=True)
                with open(self.log_file, "a", encoding="utf-8") as handle:
                    handle.write(f"{timestamp} [INFO] [Companion] {message}\n")

            def clear_logs(self):
                try:
                    self.log_file.parent.mkdir(parents=True, exist_ok=True)
                    self.log_file.write_text("", encoding="utf-8")
                except Exception as error:
                    self.message_box.warning(self, "Diagnostics", str(error))
                    return
                self.refresh_logs()

            def open_logs(self):
                try:
                    self.log_file.parent.mkdir(parents=True, exist_ok=True)
                    self.log_file.touch(exist_ok=True)
                    os.startfile(str(self.log_file))
                except (AttributeError, OSError) as error:
                    self.message_box.warning(self, "Diagnostics", f"Could not open the host log: {error}")

            def diagnostics_payload(self):
                try:
                    service_status = self.service.status(self.config)
                except Exception as error:
                    service_status = {"error": str(error)}
                try:
                    fallback_status = host_window_status(self.config)
                except Exception as error:
                    fallback_status = {"contextAvailable": False, "contextError": str(error)}
                try:
                    recent_log = (
                        self.log_file.read_text(encoding="utf-8", errors="replace")[-50000:]
                        if self.log_file.exists()
                        else ""
                    )
                except OSError as error:
                    recent_log = f"Log unavailable: {error}"
                return {
                    "generatedAt": datetime.now().astimezone().isoformat(),
                    "companionVersion": APP_VERSION,
                    "pythonVersion": sys.version.split()[0],
                    "platform": sys.platform,
                    "serviceStatus": service_status,
                    "fallbackStatus": fallback_status,
                    "workflowDirectory": str(self.repository.workflows_dir),
                    "configuration": self.config,
                    "recentLog": recent_log,
                }

            def export_diagnostics_file(self, destination):
                path = Path(destination)
                if path.suffix.lower() != ".json":
                    path = path.with_suffix(".json")
                atomic_write_json(path, self.diagnostics_payload(), indent=2)
                return path

            def export_diagnostics(self):
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                selected, _filter = self.file_dialog.getSaveFileName(
                    self,
                    "Export BRunner diagnostics",
                    str(self.base_dir / f"brunner-diagnostics-{stamp}.json"),
                    "JSON files (*.json)",
                )
                if not selected:
                    return
                try:
                    exported = self.export_diagnostics_file(selected)
                except Exception as error:
                    self.message_box.warning(self, "Diagnostics", f"Could not export diagnostics: {error}")
                    return
                self.write_companion_log(f"Diagnostics exported to {exported}.")
                self.refresh_logs()
                self.message_box.information(
                    self,
                    "Diagnostics",
                    f"Diagnostics exported to:\n{exported}",
                )

            def save_host_fallback_settings(self):
                fallback = self.config.get("hostFallback") if isinstance(self.config.get("hostFallback"), dict) else {}
                fallback["enabled"] = self.fallback_enabled.isChecked()
                fallback["minimumCoordinateConfidence"] = float(self.fallback_confidence.value())
                fallback.pop("captureDiagnosticsScreenshots", None)
                self.config["hostFallback"] = fallback
                try:
                    self.config = save_config(self.config_file, self.config)
                except Exception as error:
                    self.message_box.warning(self, "Host Fallback", str(error))
                    return
                self.write_companion_log("Host fallback settings saved.")
                self.refresh()

            def pair_profile_instance(self):
                profile_instance_id = normalize_profile_instance_id(
                    self.profile_instance_id.text()
                )
                if not is_valid_profile_instance_id(profile_instance_id):
                    self.message_box.warning(
                        self,
                        "Pairing",
                        "Paste a valid profile instance ID from the extension sidebar.",
                    )
                    return
                current = normalize_profile_instance_id(
                    self.config.get("pairedInstanceId")
                )
                if current and current != profile_instance_id:
                    self.message_box.warning(
                        self,
                        "Pairing",
                        "Unpair the current Chrome profile before pairing another profile.",
                    )
                    return
                self.config["pairedInstanceId"] = profile_instance_id
                try:
                    self.config = save_config(self.config_file, self.config)
                except Exception as error:
                    self.message_box.warning(self, "Pairing", str(error))
                    return
                self.write_companion_log("Chrome profile paired.")
                if profile_instance_id != current:
                    self.restart_for_pairing_change()
                self.refresh()

            def unpair_extension(self):
                self.config["pairedInstanceId"] = None
                try:
                    self.config = save_config(self.config_file, self.config)
                except Exception as error:
                    self.message_box.warning(self, "Pairing", str(error))
                    return
                self.write_companion_log("Extension unpaired.")
                self.restart_for_pairing_change()
                self.refresh()

            def copy_profile_instance_id(self):
                profile_instance_id = normalize_profile_instance_id(
                    self.profile_instance_id.text()
                )
                if not is_valid_profile_instance_id(profile_instance_id):
                    self.message_box.warning(
                        self,
                        "Pairing",
                        "No valid profile instance ID is available to copy.",
                    )
                    return
                QApplication.clipboard().setText(profile_instance_id)
                self.write_companion_log("Profile instance ID copied.")

            def restart_for_pairing_change(self):
                status = self.service.status(self.config)
                if self.service.is_running():
                    self.service.restart(self.config)
                    self.write_companion_log(
                        "Managed host restarted to apply pairing changes and close existing connections."
                    )
                elif status.get("external"):
                    self.write_companion_log(
                        "Pairing changed while an external host is listening; restart that host to close existing connections."
                    )

            def save_startup_settings(self):
                host = self.config.get("host") if isinstance(self.config.get("host"), dict) else {}
                host["startWithApp"] = self.start_with_app.isChecked()
                self.config["host"] = host
                try:
                    self.config = save_config(self.config_file, self.config)
                except Exception as error:
                    self.message_box.warning(self, "Startup", str(error))
                    return
                self.write_companion_log("Companion startup setting saved.")
                self.refresh()

            def start_configured_host(self):
                host = self.config.get("host") if isinstance(self.config.get("host"), dict) else {}
                if host.get("startWithApp") is False:
                    return False
                started = self.service.start(self.config)
                self.write_companion_log(self.service.last_message)
                self.refresh()
                self.refresh_logs_after_service_change()
                return started

            def open_workflow_folder(self):
                try:
                    self.repository.workflows_dir.mkdir(parents=True, exist_ok=True)
                    os.startfile(str(self.repository.workflows_dir))
                except (AttributeError, OSError) as error:
                    self.message_box.warning(
                        self,
                        "Workflow Storage",
                        f"Could not open the workflow folder: {error}",
                    )

            def change_workflow_location(self):
                selected = self.file_dialog.getExistingDirectory(
                    self,
                    "Choose workflow folder",
                    str(self.repository.workflows_dir),
                )
                if not selected:
                    return
                migration = self.ask_migration_mode()
                if not migration:
                    return
                try:
                    result = apply_workflow_location(
                        self.config_file,
                        self.base_dir,
                        selected,
                        migration,
                    )
                except Exception as error:
                    self.message_box.warning(self, "Workflow Storage", str(error))
                    return
                self.refresh_after_workflow_location_change(result)

            def use_default_workflow_location(self):
                migration = self.ask_migration_mode()
                if not migration:
                    return
                try:
                    result = restore_default_workflow_location(
                        self.config_file,
                        self.base_dir,
                        migration,
                    )
                except Exception as error:
                    self.message_box.warning(self, "Workflow Storage", str(error))
                    return
                self.refresh_after_workflow_location_change(result)

            def refresh_after_workflow_location_change(self, result=None):
                self.config = load_or_create_config(self.config_file, self.base_dir)
                self.repository = WorkflowRepository(
                    active_workflows_directory(self.config, self.base_dir)
                )

                managed_host_restarted = False
                host_status = self.service.status(self.config)
                if self.service.is_running():
                    try:
                        managed_host_restarted = bool(self.service.restart(self.config))
                        if managed_host_restarted:
                            self.write_companion_log(
                                "Managed host restarted to apply the workflow storage location."
                            )
                        else:
                            raise RuntimeError(
                                self.service.last_message
                                or "the managed host did not restart"
                            )
                    except Exception as error:
                        self.write_companion_log(
                            f"Managed host restart failed after workflow storage changed: {error}"
                        )
                        self.message_box.warning(
                            self,
                            "Workflow Storage",
                            "The workflow location was saved, but the managed host could not be restarted. "
                            "Restart the host before running workflows.",
                        )
                elif host_status.get("external"):
                    message = (
                        "The workflow location was saved, but an externally started host is still "
                        "using the previous location. Restart that host before running workflows."
                    )
                    self.write_companion_log(message)
                    self.message_box.warning(self, "Workflow Storage", message)

                self.refresh()
                if managed_host_restarted:
                    self.refresh_logs_after_service_change()
                cleanup_failures = (
                    result.get("sourceCleanupFailures", [])
                    if isinstance(result, dict)
                    else []
                )
                if cleanup_failures:
                    self.message_box.warning(
                        self,
                        "Workflow Storage",
                        "The workflow location changed and all workflows were copied, "
                        "but some source files could not be removed. The original files "
                        "were left in place so no data was lost.",
                    )

            def ask_migration_mode(self):
                box = self.message_box(self)
                box.setWindowTitle("Workflow Storage")
                box.setText("How should existing workflows be handled?")
                use_new = box.addButton("Use new folder only", self.message_box.ButtonRole.AcceptRole)
                copy_existing = box.addButton("Copy existing workflows", self.message_box.ButtonRole.ActionRole)
                move_existing = box.addButton("Move existing workflows", self.message_box.ButtonRole.DestructiveRole)
                box.addButton(self.message_box.StandardButton.Cancel)
                box.exec()
                clicked = box.clickedButton()
                if clicked == use_new:
                    return "use_new"
                if clicked == copy_existing:
                    return "copy"
                if clicked == move_existing:
                    return "move"
                return None

            def add_approved_folder(self):
                selected = self.file_dialog.getExistingDirectory(
                    self,
                    "Choose approved folder",
                    str(self.base_dir),
                )
                if not selected:
                    return
                selected_path = Path(selected)
                used_ids = {
                    str(entry.get("id") or "").strip()
                    for entry in self.config.get("approvedDirectories", [])
                    if isinstance(entry, dict)
                }
                entry = {
                    "id": unique_alias_id(selected_path.name or "folder", used_ids, len(used_ids)),
                    "displayName": selected_path.name or "Approved Folder",
                    "path": str(selected_path),
                    "read": True,
                    "write": False,
                    "recursive": True,
                }
                updated = self.ask_folder_details(entry, is_new=True)
                if updated:
                    self.save_folder_entry(updated)

            def edit_approved_folder(self):
                entry = self.selected_folder_entry()
                if not entry:
                    self.message_box.warning(self, "Approved Folders", "Select a folder alias to edit.")
                    return
                updated = self.ask_folder_details(entry, is_new=False)
                if updated:
                    self.save_folder_entry(updated, original_id=entry.get("id"))

            def remove_approved_folder(self):
                entry = self.selected_folder_entry()
                if not entry:
                    self.message_box.warning(self, "Approved Folders", "Select a folder alias to remove.")
                    return
                answer = self.message_box.question(
                    self,
                    "Approved Folders",
                    f"Remove approved folder alias '{entry.get('id')}'?",
                    self.message_box.StandardButton.Yes | self.message_box.StandardButton.No,
                    self.message_box.StandardButton.No,
                )
                if answer != self.message_box.StandardButton.Yes:
                    return
                self.config["approvedDirectories"] = [
                    item for item in self.config.get("approvedDirectories", [])
                    if not (isinstance(item, dict) and item.get("id") == entry.get("id"))
                ]
                self.config = save_config(self.config_file, self.config)
                self.refresh()

            def selected_folder_entry(self):
                row = self.folders_table.currentRow()
                if row < 0 or row >= len(self.folder_rows):
                    return None
                entry_id = self.folder_rows[row].get("id")
                for entry in self.config.get("approvedDirectories", []):
                    if isinstance(entry, dict) and entry.get("id") == entry_id:
                        return dict(entry)
                return None

            def ask_folder_details(self, entry, is_new):
                dialog = QDialog(self)
                dialog.setWindowTitle("Approved Folder")
                layout = QFormLayout(dialog)
                alias = QLineEdit(str(entry.get("id") or ""))
                name = QLineEdit(str(entry.get("displayName") or ""))
                path = QLineEdit(str(entry.get("path") or ""))
                read = QCheckBox()
                read.setChecked(entry.get("read") is True)
                write = QCheckBox()
                write.setChecked(entry.get("write") is True)
                recursive = QCheckBox()
                recursive.setChecked(entry.get("recursive") is not False)
                choose = QPushButton("Choose Folder")

                def choose_folder():
                    selected = self.file_dialog.getExistingDirectory(
                        dialog,
                        "Choose approved folder",
                        path.text() or str(self.base_dir),
                    )
                    if selected:
                        path.setText(selected)

                choose.clicked.connect(choose_folder)
                path_row = QWidget()
                path_layout = QHBoxLayout(path_row)
                path_layout.setContentsMargins(0, 0, 0, 0)
                path_layout.addWidget(path)
                path_layout.addWidget(choose)
                layout.addRow("Alias", alias)
                layout.addRow("Name", name)
                layout.addRow("Folder", path_row)
                layout.addRow("Read", read)
                layout.addRow("Write", write)
                layout.addRow("Recursive", recursive)
                buttons = QDialogButtonBox(
                    QDialogButtonBox.StandardButton.Ok
                    | QDialogButtonBox.StandardButton.Cancel
                )
                buttons.accepted.connect(dialog.accept)
                buttons.rejected.connect(dialog.reject)
                layout.addRow(buttons)
                if dialog.exec() != QDialog.DialogCode.Accepted:
                    return None

                updated = {
                    "id": alias.text().strip(),
                    "displayName": name.text().strip(),
                    "path": path.text().strip(),
                    "read": read.isChecked(),
                    "write": write.isChecked(),
                    "recursive": recursive.isChecked(),
                }
                if not updated["id"] or not updated["path"]:
                    self.message_box.warning(self, "Approved Folders", "Alias and folder are required.")
                    return None
                if not updated["displayName"]:
                    updated["displayName"] = updated["id"]
                used = {
                    str(item.get("id") or "").strip()
                    for item in self.config.get("approvedDirectories", [])
                    if isinstance(item, dict)
                }
                if not is_new:
                    used.discard(str(entry.get("id") or "").strip())
                if updated["id"] in used:
                    self.message_box.warning(self, "Approved Folders", "Alias must be unique.")
                    return None
                return updated

            def save_folder_entry(self, entry, original_id=None):
                directories = []
                replaced = False
                for item in self.config.get("approvedDirectories", []):
                    if not isinstance(item, dict):
                        continue
                    if original_id and item.get("id") == original_id:
                        directories.append(entry)
                        replaced = True
                    else:
                        directories.append(item)
                if not replaced:
                    directories.append(entry)
                self.config["approvedDirectories"] = directories
                self.config = save_config(self.config_file, self.config)
                self.refresh()

            def start_host(self):
                self.service.start(self.config)
                self.write_companion_log(self.service.last_message)
                self.refresh()
                self.refresh_logs_after_service_change()

            def stop_host(self):
                self.service.stop()
                self.write_companion_log(self.service.last_message)
                self.refresh()
                self.refresh_logs_after_service_change()

            def restart_host(self):
                self.service.restart(self.config)
                self.write_companion_log(self.service.last_message)
                self.refresh()
                self.refresh_logs_after_service_change()

            def show_from_tray(self):
                self.show()
                self.raise_()
                self.activateWindow()

            def closeEvent(self, event):
                if self.tray.isVisible():
                    event.ignore()
                    self.hide()
                    self.tray.showMessage(
                        "BRunner Companion",
                        "Still running in the system tray.",
                        QSystemTrayIcon.MessageIcon.Information,
                        1800,
                    )
                else:
                    super().closeEvent(event)

            def exit_app(self):
                self.shutdown()
                QApplication.quit()

            def shutdown(self):
                if self._shutting_down:
                    return
                self._shutting_down = True
                self.connection_timer.stop()
                self.tray.hide()
                self.service.stop()

        return _Window()
