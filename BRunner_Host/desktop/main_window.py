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
from companion_service import HostServiceController
from directory_registry import list_approved_directories
from host_settings import load_or_create_config, save_config, unique_alias_id
from window_validation import host_window_status
from workflow_location import apply_workflow_location, restore_default_workflow_location
from workflow_repository import WorkflowRepository


def run_companion_app():
    try:
        from PySide6.QtGui import QAction
        from PySide6.QtWidgets import QApplication
    except ImportError as error:
        raise SystemExit(
            "PySide6 is not installed. Install BRunner_Host/requirements.txt to run the companion app."
        ) from error

    app = QApplication.instance() or QApplication([])
    app.setApplicationName("BRunner Companion")
    window = BRunnerCompanionWindow(QAction)
    window.show()
    return app.exec()


class BRunnerCompanionWindow:
    def __new__(cls, action_class):
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
                self.setWindowTitle("BRunner Companion")
                self.resize(760, 520)

                self.tabs = QTabWidget()
                self.setCentralWidget(self.tabs)
                self._build_status_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton)
                self._build_storage_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem)
                self._build_folders_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem)
                self._build_fallback_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem, QCheckBox, QDoubleSpinBox)
                self._build_pairing_tab(QWidget, QVBoxLayout, QLabel, QTextEdit)
                self._build_diagnostics_tab(QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTextEdit)
                self._build_tray(QSystemTrayIcon, QMenu, action_class, QApplication)
                self.refresh()

            def _build_status_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.host_state = QLabel()
                self.host_port = QLabel()
                self.extension_state = QLabel()
                layout.addWidget(self.host_state)
                layout.addWidget(self.host_port)
                layout.addWidget(self.extension_state)
                buttons = QHBoxLayout()
                for label, handler in [
                    ("Start Host", self.start_host),
                    ("Stop Host", self.stop_host),
                    ("Restart Host", self.restart_host),
                    ("Refresh", self.refresh),
                ]:
                    button = QPushButton(label)
                    button.clicked.connect(handler)
                    buttons.addWidget(button)
                layout.addLayout(buttons)
                layout.addStretch(1)
                self.tabs.addTab(tab, "Status")

            def _build_storage_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTableWidget, QTableWidgetItem):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                self.workflow_folder = QLabel()
                layout.addWidget(self.workflow_folder)
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
                self.fallback_screenshots = QCheckBox("Capture diagnostics screenshots")
                layout.addWidget(self.fallback_screenshots)
                self.fallback_window_state = QLabel()
                self.fallback_screen_state = QLabel()
                layout.addWidget(self.fallback_window_state)
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

            def _build_pairing_tab(self, QWidget, QVBoxLayout, QLabel, QTextEdit):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                layout.addWidget(QLabel("Pairing key"))
                self.pairing_key = QTextEdit()
                self.pairing_key.setReadOnly(True)
                self.pairing_key.setMaximumHeight(80)
                layout.addWidget(self.pairing_key)
                self.paired_extension = QLabel()
                layout.addWidget(self.paired_extension)
                layout.addStretch(1)
                self.tabs.addTab(tab, "Pairing")

            def _build_diagnostics_tab(self, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QTextEdit):
                tab = QWidget()
                layout = QVBoxLayout(tab)
                layout.addWidget(QLabel("Recent host log"))
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
                open_action = QAction("Open BRunner", self)
                open_action.triggered.connect(self.show_from_tray)
                menu.addAction(open_action)
                start_action = QAction("Start Host", self)
                start_action.triggered.connect(self.start_host)
                menu.addAction(start_action)
                stop_action = QAction("Stop Host", self)
                stop_action.triggered.connect(self.stop_host)
                menu.addAction(stop_action)
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
                self.config = load_or_create_config(self.config_file, self.base_dir)
                self.repository = WorkflowRepository(active_workflows_directory(self.config, self.base_dir))
                status = self.service.status(self.config)
                self.host_state.setText(f"Host: {'running' if status['running'] else 'stopped'}")
                self.host_port.setText(f"WebSocket port: {status.get('port') or 'unknown'}")
                paired = status.get("pairedExtensionId") or "not paired"
                self.extension_state.setText(f"Extension: {paired}")
                self.pairing_key.setPlainText(str(self.config.get("pairingKey") or ""))
                self.paired_extension.setText(f"Paired extension id: {paired}")
                self.refresh_workflows()
                self.refresh_folders()
                self.refresh_fallback()
                self.refresh_logs()

            def refresh_workflows(self):
                storage = self.config.get("workflowStorage") if isinstance(self.config.get("workflowStorage"), dict) else {}
                mode = storage.get("mode") or "default"
                self.workflow_folder.setText(
                    f"Active workflow folder ({mode}): {self.repository.workflows_dir}"
                )
                summaries = self.repository.list_workflow_summaries()
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
                self.fallback_screenshots.setChecked(fallback.get("captureDiagnosticsScreenshots") is True)
                try:
                    status = host_window_status(self.config)
                except Exception as error:
                    status = {
                        "foregroundWindow": None,
                        "screen": {"width": 0, "height": 0},
                        "supportedActions": [],
                    }
                    self.write_companion_log(f"Host fallback status unavailable: {error}")
                window = status.get("foregroundWindow") or {}
                title = window.get("title") or "unavailable"
                self.fallback_window_state.setText(f"Foreground window: {title}")
                screen = status.get("screen") or {}
                self.fallback_screen_state.setText(
                    f"Screen: {screen.get('width', 0)} x {screen.get('height', 0)}"
                )
                actions = status.get("supportedActions") or []
                self.fallback_actions_table.setRowCount(len(actions))
                for row, action in enumerate(actions):
                    self.fallback_actions_table.setItem(row, 0, self.table_item_class(str(action)))
                    self.fallback_actions_table.setItem(row, 1, self.table_item_class(self.host_fallback_action_description(action)))
                    self.fallback_actions_table.setItem(row, 2, self.table_item_class("Available"))

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

            def save_host_fallback_settings(self):
                fallback = self.config.get("hostFallback") if isinstance(self.config.get("hostFallback"), dict) else {}
                fallback["enabled"] = self.fallback_enabled.isChecked()
                fallback["minimumCoordinateConfidence"] = float(self.fallback_confidence.value())
                fallback["captureDiagnosticsScreenshots"] = self.fallback_screenshots.isChecked()
                self.config["hostFallback"] = fallback
                try:
                    self.config = save_config(self.config_file, self.config)
                except Exception as error:
                    self.message_box.warning(self, "Host Fallback", str(error))
                    return
                self.write_companion_log("Host fallback settings saved.")
                self.refresh()

            def open_workflow_folder(self):
                os.startfile(str(self.repository.workflows_dir))

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
                    apply_workflow_location(
                        self.config_file,
                        self.base_dir,
                        selected,
                        migration,
                    )
                except Exception as error:
                    self.message_box.warning(self, "Workflow Storage", str(error))
                    return
                self.refresh()

            def use_default_workflow_location(self):
                migration = self.ask_migration_mode()
                if not migration:
                    return
                try:
                    restore_default_workflow_location(
                        self.config_file,
                        self.base_dir,
                        migration,
                    )
                except Exception as error:
                    self.message_box.warning(self, "Workflow Storage", str(error))
                    return
                self.refresh()

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
                started = self.service.start()
                self.write_companion_log(
                    "Host start requested."
                    if started else
                    "Host start requested; host is already running."
                )
                self.refresh()
                self.refresh_logs_after_service_change()

            def stop_host(self):
                stopped = self.service.stop()
                self.write_companion_log(
                    "Host stop requested."
                    if stopped else
                    "Host stop requested; host was not running."
                )
                self.refresh()
                self.refresh_logs_after_service_change()

            def restart_host(self):
                restarted = self.service.restart()
                self.write_companion_log(
                    "Host restart requested."
                    if restarted else
                    "Host restart requested; host did not start."
                )
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
                self.tray.hide()
                self.service.stop()
                QApplication.quit()

        return _Window()
