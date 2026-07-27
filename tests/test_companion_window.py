import os
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))


class CompanionWindowTests(unittest.TestCase):
    def test_startup_storage_recovery_saves_a_selected_writable_folder(self):
        from desktop import main_window

        class FakeDialog:
            selected = ""

            @classmethod
            def getExistingDirectory(cls, *_args):
                return cls.selected

        class FakeMessageBox:
            warnings = []
            criticals = []

            @classmethod
            def warning(cls, _parent, title, message):
                cls.warnings.append((title, message))

            @classmethod
            def critical(cls, _parent, title, message):
                cls.criticals.append((title, message))

        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            anchor = base_dir / "app.py"
            anchor.write_text("# source launcher", encoding="utf-8")
            target = base_dir / "RecoveredWorkflows"
            target.mkdir()
            FakeDialog.selected = str(target)

            with mock.patch.object(
                main_window,
                "ensure_writable_directory",
                side_effect=OSError("workflow folder is read-only"),
            ):
                ready = main_window.prepare_companion_storage(
                    FakeDialog,
                    FakeMessageBox,
                    anchor,
                )

            self.assertTrue(ready)
            self.assertEqual(len(FakeMessageBox.warnings), 1)
            self.assertEqual(FakeMessageBox.criticals, [])
            saved = json.loads(
                (base_dir / "brunner_config.json").read_text(encoding="utf-8")
            )
            self.assertEqual(saved["workflowStorage"], {
                "mode": "custom",
                "directory": str(target.resolve()),
            })

    def test_startup_unwritable_config_has_actionable_visible_error(self):
        from desktop import main_window

        class FakeDialog:
            @classmethod
            def getExistingDirectory(cls, *_args):
                raise AssertionError("folder choice should not open before config loads")

        class FakeMessageBox:
            criticals = []

            @classmethod
            def warning(cls, *_args):
                raise AssertionError("config failure should use the startup error")

            @classmethod
            def critical(cls, _parent, title, message):
                cls.criticals.append((title, message))

        with tempfile.TemporaryDirectory() as temp:
            anchor = Path(temp) / "app.py"
            with mock.patch.object(
                main_window,
                "ensure_config_writable",
                side_effect=PermissionError("config is read-only"),
            ):
                ready = main_window.prepare_companion_storage(
                    FakeDialog,
                    FakeMessageBox,
                    anchor,
                )

        self.assertFalse(ready)
        self.assertEqual(len(FakeMessageBox.criticals), 1)
        message = FakeMessageBox.criticals[0][1]
        self.assertIn("configuration file", message)
        self.assertIn("writable", message)
        self.assertIn("move the BRunner source folder", message)

    def test_companion_window_constructs_with_pyside6_enums(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        app = QApplication.instance() or QApplication([])
        window = BRunnerCompanionWindow(QAction)
        try:
            window.connection_timer.stop()
            self.assertEqual(window.windowTitle(), "BRunner Companion")
            self.assertEqual(window.tabs.count(), 6)
            self.assertEqual(window.tabs.tabText(2), "Approved Folders")
            self.assertEqual(window.tabs.tabText(3), "Host Fallback")
            self.assertEqual(window.fallback_actions_table.columnCount(), 3)
            self.assertEqual(window.fallback_actions_table.horizontalHeaderItem(1).text(), "Description")
            self.assertIn("Left-clicks", window.host_fallback_action_description("click"))
            self.assertTrue(hasattr(window, "pairing_port"))
            self.assertTrue(hasattr(window, "profile_instance_id"))
            self.assertTrue(hasattr(window, "pair_profile_instance"))
            self.assertEqual(window.pairing_port.metaObject().className(), "QLabel")
            self.assertEqual(window.pairing_port.text(), "8999")
            self.assertFalse(hasattr(window, "save_pairing_port"))
        finally:
            window.tray.hide()
            window.close()

    def test_diagnostics_log_write_and_clear_updates_panel(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.diagnostics_timer.stop()
                window.log_file = Path(temp) / "brunner_host.log"
                window.write_companion_log("Host start requested.")
                window.refresh_logs()

                self.assertIn("[Companion] Host start requested.", window.logs.toPlainText())
                self.assertIn(str(window.log_file), window.log_path_state.text())
                self.assertIn("Host start requested.", window.log_file.read_text(encoding="utf-8"))

                window.clear_logs()

                self.assertEqual(window.log_file.read_text(encoding="utf-8"), "")
                self.assertEqual(window.logs.toPlainText(), "")
            finally:
                window.tray.hide()
                window.close()

    def test_pair_profile_keeps_fixed_port_and_unpairs(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 3,
                    "pairedInstanceId": None,
                    "host": {"port": 9005},
                    "workflowStorage": {"mode": "default", "directory": None},
                    "approvedDirectories": [],
                    "hostFallback": {},
                }
                profile_instance_id = "123e4567-e89b-42d3-a456-426614174000"
                window.profile_instance_id.setText(profile_instance_id)

                window.pair_profile_instance()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertEqual(saved["pairedInstanceId"], profile_instance_id)
                self.assertEqual(saved["host"]["port"], 8999)
                self.assertEqual(saved["port"], 8999)
                self.assertEqual(window.pairing_port.text(), "8999")

                window.unpair_extension()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertIsNone(saved["pairedInstanceId"])
            finally:
                window.tray.hide()
                window.close()

    def test_startup_setting_and_configured_host_lifecycle(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        class FakeService:
            def __init__(self):
                self.started = 0
                self.stopped = 0
                self.last_message = ""

            def start(self, config):
                self.started += 1
                self.last_message = "Host start requested."
                return True

            def stop(self):
                self.stopped += 1
                self.last_message = "Host stop requested."
                return True

            def status(self, config):
                return {
                    "running": self.started > self.stopped,
                    "external": False,
                    "port": config.get("host", {}).get("port", 8999),
                    "pairedInstanceId": config.get("pairedInstanceId"),
                    "extensionConnected": False,
                    "connectedProfileInstanceId": None,
                    "pairingState": "unpaired",
                }

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 3,
                    "pairedInstanceId": None,
                    "host": {"port": 8999, "startWithApp": True},
                    "workflowStorage": {"mode": "default", "directory": None},
                    "approvedDirectories": [],
                    "hostFallback": {},
                }
                window.service = FakeService()

                self.assertTrue(window.start_configured_host())
                self.assertEqual(window.service.started, 1)
                window.shutdown()
                window.shutdown()
                self.assertEqual(window.service.stopped, 1)
            finally:
                window.tray.hide()
                window.close()

    def test_workflow_location_refreshes_repository_and_restarts_managed_host(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config

        class FakeService:
            def __init__(self):
                self.restarted_with = None
                self.last_message = ""

            def is_running(self):
                return True

            def restart(self, config):
                self.restarted_with = config
                self.last_message = "Host start requested."
                return True

            def status(self, config):
                return {
                    "running": True,
                    "external": False,
                    "port": config.get("host", {}).get("port", 8999),
                    "pairedInstanceId": config.get("pairedInstanceId"),
                    "extensionConnected": False,
                    "connectedProfileInstanceId": None,
                    "pairingState": "unpaired",
                }

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            target = base_dir / "CustomWorkflows"
            target.mkdir()
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.config_file = base_dir / "brunner_config.json"
                window.log_file = base_dir / "brunner_host.log"
                save_config(window.config_file, {
                    "workflowStorage": {
                        "mode": "custom",
                        "directory": str(target),
                    },
                    "approvedDirectories": [],
                })
                window.service = FakeService()

                window.refresh_after_workflow_location_change()

                self.assertEqual(window.repository.workflows_dir, target.resolve())
                self.assertIsNotNone(window.service.restarted_with)
                self.assertEqual(
                    window.service.restarted_with["workflowStorage"]["directory"],
                    str(target),
                )
                self.assertIn(
                    "Managed host restarted to apply the workflow storage location.",
                    window.log_file.read_text(encoding="utf-8"),
                )
            finally:
                window.tray.hide()
                window.close()

    def test_workflow_location_warns_when_external_host_needs_restart(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config

        class FakeService:
            last_message = ""

            @staticmethod
            def is_running():
                return False

            @staticmethod
            def status(config):
                return {
                    "running": True,
                    "external": True,
                    "port": config.get("host", {}).get("port", 8999),
                    "pairedInstanceId": config.get("pairedInstanceId"),
                    "extensionConnected": False,
                    "connectedProfileInstanceId": None,
                    "pairingState": "unpaired",
                }

        class FakeMessageBox:
            warnings = []

            @classmethod
            def warning(cls, _parent, title, message):
                cls.warnings.append((title, message))

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            target = base_dir / "CustomWorkflows"
            target.mkdir()
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.config_file = base_dir / "brunner_config.json"
                window.log_file = base_dir / "brunner_host.log"
                save_config(window.config_file, {
                    "workflowStorage": {
                        "mode": "custom",
                        "directory": str(target),
                    },
                    "approvedDirectories": [],
                })
                window.service = FakeService()
                window.message_box = FakeMessageBox

                window.refresh_after_workflow_location_change()

                self.assertEqual(window.repository.workflows_dir, target.resolve())
                self.assertEqual(len(FakeMessageBox.warnings), 1)
                self.assertIn("externally started host", FakeMessageBox.warnings[0][1])
                self.assertIn("Restart that host", FakeMessageBox.warnings[0][1])
                self.assertIn(
                    "externally started host",
                    window.log_file.read_text(encoding="utf-8"),
                )
            finally:
                window.tray.hide()
                window.close()

    def test_approved_folder_ui_preserves_all_read_disabled(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.config_file = base_dir / "brunner_config.json"
                window.log_file = base_dir / "brunner_host.log"
                window.config = save_config(window.config_file, {
                    "approvedDirectories": [{
                        "id": "imports",
                        "displayName": "Imports",
                        "path": str(base_dir / "Imports"),
                        "read": True,
                        "write": False,
                        "recursive": True,
                    }],
                })
                window.refresh = lambda: None

                window.save_folder_entry({
                    **window.config["approvedDirectories"][0],
                    "read": False,
                }, original_id="imports")

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved["approvedDirectories"][0]["read"])
                self.assertFalse(saved["local_file_access"]["enabled"])
            finally:
                window.tray.hide()
                window.close()

    def test_unavailable_approved_folder_is_visible_in_the_table(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            missing = base_dir / "removed-folder"
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.config_file = base_dir / "brunner_config.json"
                window.config = save_config(window.config_file, {
                    "approvedDirectories": [{
                        "id": "imports",
                        "displayName": "Imports",
                        "path": str(missing),
                        "read": True,
                        "write": True,
                        "recursive": True,
                    }],
                })

                window.refresh_folders()

                self.assertEqual(window.folder_rows[0]["id"], "imports")
                self.assertFalse(window.folder_rows[0]["available"])
                self.assertEqual(window.folders_table.rowCount(), 1)
                self.assertEqual(
                    window.folders_table.item(0, 2).text(),
                    f"{missing} (Unavailable)",
                )
            finally:
                window.tray.hide()
                window.close()

    def test_removing_final_approved_folder_persists_an_empty_registry(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config

        class AcceptRemovalMessageBox:
            class StandardButton:
                Yes = 1
                No = 2

            @classmethod
            def question(cls, *_args):
                return cls.StandardButton.Yes

            @classmethod
            def warning(cls, *_args):
                raise AssertionError("a selected alias must not produce a warning")

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            approved = base_dir / "approved"
            approved.mkdir()
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.config_file = base_dir / "brunner_config.json"
                window.config = save_config(window.config_file, {
                    "approvedDirectories": [{
                        "id": "only_alias",
                        "displayName": "Only alias",
                        "path": str(approved),
                        "read": True,
                        "write": True,
                        "recursive": True,
                    }],
                })
                window.message_box = AcceptRemovalMessageBox
                window.refresh = window.refresh_folders
                window.refresh_folders()
                window.folders_table.selectRow(0)

                window.remove_approved_folder()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertEqual(saved["approvedDirectories"], [])
                self.assertFalse(saved["local_file_access"]["enabled"])
                self.assertEqual(window.folder_rows, [])
                self.assertEqual(window.folders_table.rowCount(), 0)
                self.assertEqual(
                    window.folders_summary.text(),
                    "Approved folder aliases: 0",
                )
            finally:
                window.tray.hide()
                window.close()

    def test_close_hides_to_tray_and_tray_exit_stops_managed_host_once(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        class FakeService:
            def __init__(self):
                self.stopped = 0

            def stop(self):
                self.stopped += 1
                return True

        class FakeCloseEvent:
            def __init__(self):
                self.ignored = 0

            def ignore(self):
                self.ignored += 1

        app = QApplication.instance() or QApplication([])
        window = BRunnerCompanionWindow(QAction)
        try:
            window.connection_timer.stop()
            service = FakeService()
            window.service = service
            event = FakeCloseEvent()

            with (
                mock.patch.object(window.tray, "isVisible", return_value=True),
                mock.patch.object(window, "hide") as hide,
                mock.patch.object(window.tray, "showMessage") as show_message,
            ):
                window.closeEvent(event)

            self.assertEqual(event.ignored, 1)
            hide.assert_called_once_with()
            show_message.assert_called_once()
            self.assertEqual(service.stopped, 0)

            window.exit_app()
            window.shutdown()

            self.assertTrue(window._shutting_down)
            self.assertEqual(service.stopped, 1)
            self.assertFalse(window.tray.isVisible())
        finally:
            window.tray.hide()
            window.close()

    def test_host_fallback_settings_save_to_config(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 3,
                    "pairedInstanceId": None,
                    "host": {"port": 8999},
                    "workflowStorage": {"mode": "default", "directory": None},
                    "approvedDirectories": [],
                    "hostFallback": {
                        "enabled": True,
                        "minimumCoordinateConfidence": 0.9,
                        "captureDiagnosticsScreenshots": False,
                    },
                }
                window.fallback_enabled.setChecked(False)
                window.fallback_confidence.setValue(0.55)

                window.save_host_fallback_settings()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved["hostFallback"]["enabled"])
                self.assertEqual(saved["hostFallback"]["minimumCoordinateConfidence"], 0.55)
                self.assertNotIn("captureDiagnosticsScreenshots", saved["hostFallback"])
                self.assertIn("Host fallback settings saved.", window.log_file.read_text(encoding="utf-8"))
            finally:
                window.tray.hide()
                window.close()

    def test_live_status_updates_version_and_dynamic_tray_actions(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop.main_window import BRunnerCompanionWindow
        from host_settings import save_config
        from product_version import APP_VERSION

        class FakeService:
            running = True

            def is_running(self):
                return self.running

            def status(self, config):
                return {
                    "running": self.running,
                    "external": False,
                    "port": 8999,
                    "pairedInstanceId": "123e4567-e89b-42d3-a456-426614174000",
                    "extensionConnected": self.running,
                    "connectedProfileInstanceId": (
                        "123e4567-e89b-42d3-a456-426614174000" if self.running else None
                    ),
                    "pairingState": "connected" if self.running else "disconnected",
                }

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = Path(temp)
                window.config_file = Path(temp) / "brunner_config.json"
                save_config(window.config_file, {"approvedDirectories": []})
                window.service = FakeService()

                window.refresh_connection_status()

                self.assertIn(APP_VERSION, window.version_state.text())
                self.assertIn("running", window.tray_status_action.text())
                self.assertIn("extension connected", window.tray_status_action.text())
                self.assertFalse(window.tray_start_action.isEnabled())
                self.assertTrue(window.tray_restart_action.isEnabled())
                self.assertTrue(window.tray_stop_action.isEnabled())
                self.assertIn(APP_VERSION, window.tray.toolTip())

                window.service.running = False
                window.refresh_connection_status()

                self.assertIn("stopped", window.tray_status_action.text())
                self.assertTrue(window.tray_start_action.isEnabled())
                self.assertFalse(window.tray_restart_action.isEnabled())
                self.assertFalse(window.tray_stop_action.isEnabled())
            finally:
                window.tray.hide()
                window.close()

    def test_fallback_panel_surfaces_context_refusal_and_removes_dead_screenshot_option(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop import main_window

        app = QApplication.instance() or QApplication([])
        window = main_window.BRunnerCompanionWindow(QAction)
        try:
            window.connection_timer.stop()
            window.config["hostFallback"] = {
                "enabled": True,
                "minimumCoordinateConfidence": 0.9,
            }
            status = {
                "screen": {"left": -1920, "top": 0, "width": 3840, "height": 1080},
                "session": {"available": True, "interactive": False, "desktopName": "Winlogon"},
                "foregroundWindow": {
                    "windowId": 55,
                    "title": "Sign-in",
                    "className": "Credential Dialog Xaml Host",
                    "processId": 77,
                    "processName": "logonui.exe",
                },
                "browserVerified": False,
                "contextAvailable": False,
                "contextError": "Interactive Windows session is unavailable or locked.",
                "supportedActions": ["click"],
            }
            with mock.patch.object(main_window, "host_window_status", return_value=status):
                window.refresh_fallback()

            self.assertFalse(hasattr(window, "fallback_screenshots"))
            self.assertIn("blocked", window.fallback_context_state.text().lower())
            self.assertIn("locked", window.fallback_context_state.text().lower())
            self.assertIn("Winlogon", window.fallback_session_state.text())
            self.assertIn("logonui.exe", window.fallback_window_identity.text())
            self.assertIn("no", window.fallback_window_identity.text())
            self.assertEqual(window.fallback_actions_table.item(0, 2).text(), "Blocked")
            self.assertIn("(-1920, 0)", window.fallback_screen_state.text())
        finally:
            window.tray.hide()
            window.close()

    def test_workflow_storage_toggle_persists_and_controls_recursive_listing(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop import main_window
        from host_settings import load_or_create_config, save_config
        from workflow_repository import WorkflowRepository

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            config_file = base_dir / "brunner_config.json"
            workflows_dir = base_dir / "Workflows"
            repository = WorkflowRepository(workflows_dir)
            repository.save_workflow("root.json", {"name": "Root"})
            repository.save_workflow(
                "node_acceptance/001_navigate_acceptance.json",
                {"name": "Navigate Acceptance"},
            )
            save_config(config_file, {
                "workflowDiscovery": {"recursive": False},
                "approvedDirectories": [],
            })

            window = main_window.BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.diagnostics_timer.stop()
                window.base_dir = base_dir
                window.config_file = config_file
                window.log_file = base_dir / "brunner_host.log"
                window.config = load_or_create_config(config_file, base_dir)
                window.repository = repository

                window.refresh_workflows()

                self.assertFalse(window.recursive_workflow_discovery.isChecked())
                self.assertEqual(window.workflow_table.rowCount(), 1)
                self.assertEqual(window.workflow_table.item(0, 0).text(), "root.json")

                window.recursive_workflow_discovery.setChecked(True)

                saved = json.loads(config_file.read_text(encoding="utf-8"))
                self.assertTrue(saved["workflowDiscovery"]["recursive"])
                self.assertEqual(window.workflow_table.rowCount(), 2)
                self.assertEqual(
                    {
                        window.workflow_table.item(row, 0).text()
                        for row in range(window.workflow_table.rowCount())
                    },
                    {
                        "root.json",
                        "node_acceptance/001_navigate_acceptance.json",
                    },
                )

                window.recursive_workflow_discovery.setChecked(False)

                saved = json.loads(config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved["workflowDiscovery"]["recursive"])
                self.assertEqual(window.workflow_table.rowCount(), 1)
            finally:
                window.tray.hide()
                window.close()

    def test_open_paths_and_export_diagnostics_json(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        try:
            from PySide6.QtGui import QAction
            from PySide6.QtWidgets import QApplication
        except ImportError:
            self.skipTest("PySide6 is not installed")

        from desktop import main_window
        from workflow_repository import WorkflowRepository

        class FakeService:
            @staticmethod
            def status(config):
                return {"running": True, "port": 8999, "extensionConnected": True}

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            window = main_window.BRunnerCompanionWindow(QAction)
            try:
                window.connection_timer.stop()
                window.base_dir = base_dir
                window.log_file = base_dir / "brunner_host.log"
                window.log_file.write_text("bounded diagnostic log", encoding="utf-8")
                window.repository = WorkflowRepository(base_dir / "workflows")
                window.service = FakeService()
                window.config = {"host": {"port": 8999}, "hostFallback": {"enabled": True}}
                fallback = {
                    "contextAvailable": False,
                    "contextError": "Foreground window is not verified.",
                }

                with mock.patch.object(main_window, "host_window_status", return_value=fallback):
                    exported = window.export_diagnostics_file(base_dir / "diagnostics")

                payload = json.loads(exported.read_text(encoding="utf-8"))
                self.assertEqual(exported.suffix, ".json")
                self.assertEqual(payload["serviceStatus"]["port"], 8999)
                self.assertFalse(payload["fallbackStatus"]["contextAvailable"])
                self.assertIn("bounded diagnostic log", payload["recentLog"])
                self.assertIn("companionVersion", payload)

                with mock.patch.object(main_window.os, "startfile") as startfile:
                    window.open_logs()
                    window.open_workflow_folder()

                self.assertEqual(startfile.call_count, 2)
                self.assertEqual(Path(startfile.call_args_list[0].args[0]), window.log_file)
                self.assertEqual(
                    Path(startfile.call_args_list[1].args[0]),
                    window.repository.workflows_dir,
                )
            finally:
                window.tray.hide()
                window.close()


if __name__ == "__main__":
    unittest.main()
