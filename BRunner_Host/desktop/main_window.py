import os
from pathlib import Path

from app_paths import (
    active_workflows_directory,
    application_directory,
    default_config_file,
    default_log_file,
)
from companion_service import HostServiceController
from host_settings import load_or_create_config
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
                buttons = QHBoxLayout()
                refresh = QPushButton("Refresh Logs")
                refresh.clicked.connect(self.refresh_logs)
                buttons.addWidget(refresh)
                buttons.addStretch(1)
                layout.addLayout(buttons)
                self.tabs.addTab(tab, "Diagnostics")

            def _build_tray(self, QSystemTrayIcon, QMenu, QAction, QApplication):
                self.tray = QSystemTrayIcon(self)
                self.tray.setIcon(self.style().standardIcon(self.style().SP_ComputerIcon))
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
                self.tray.activated.connect(lambda reason: self.show_from_tray() if reason == QSystemTrayIcon.Trigger else None)
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

            def refresh_logs(self):
                if self.log_file.exists():
                    content = self.log_file.read_text(encoding="utf-8", errors="replace")[-20000:]
                else:
                    content = "No logs yet."
                self.logs.setPlainText(content)

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
                use_new = box.addButton("Use new folder only", self.message_box.AcceptRole)
                copy_existing = box.addButton("Copy existing workflows", self.message_box.ActionRole)
                move_existing = box.addButton("Move existing workflows", self.message_box.DestructiveRole)
                box.addButton(self.message_box.Cancel)
                box.exec()
                clicked = box.clickedButton()
                if clicked == use_new:
                    return "use_new"
                if clicked == copy_existing:
                    return "copy"
                if clicked == move_existing:
                    return "move"
                return None

            def start_host(self):
                self.service.start()
                self.refresh()

            def stop_host(self):
                self.service.stop()
                self.refresh()

            def restart_host(self):
                self.service.restart()
                self.refresh()

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
                        self.tray.Information,
                        1800,
                    )
                else:
                    super().closeEvent(event)

            def exit_app(self):
                self.tray.hide()
                self.service.stop()
                QApplication.quit()

        return _Window()
