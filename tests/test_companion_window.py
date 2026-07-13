import os
import json
import sys
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))


class CompanionWindowTests(unittest.TestCase):
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
            self.assertEqual(window.windowTitle(), "BRunner Companion")
            self.assertEqual(window.tabs.count(), 6)
            self.assertEqual(window.tabs.tabText(2), "Approved Folders")
            self.assertEqual(window.tabs.tabText(3), "Host Fallback")
            self.assertEqual(window.fallback_actions_table.columnCount(), 3)
            self.assertEqual(window.fallback_actions_table.horizontalHeaderItem(1).text(), "Description")
            self.assertIn("Left-clicks", window.host_fallback_action_description("click"))
            self.assertTrue(hasattr(window, "pairing_port"))
            self.assertTrue(hasattr(window, "save_pairing_settings"))
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
                window.log_file = Path(temp) / "brunner_host.log"
                window.write_companion_log("Host start requested.")
                window.refresh_logs()

                self.assertIn("[Companion] Host start requested.", window.logs.toPlainText())
                self.assertIn("Host start requested.", window.log_file.read_text(encoding="utf-8"))

                window.clear_logs()

                self.assertEqual(window.log_file.read_text(encoding="utf-8"), "")
                self.assertEqual(window.logs.toPlainText(), "")
            finally:
                window.tray.hide()
                window.close()

    def test_pairing_settings_save_key_port_and_unpair(self):
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
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 2,
                    "pairingKey": "old",
                    "pairedExtensionId": "extension",
                    "host": {"port": 8999},
                    "workflowStorage": {"mode": "default", "directory": None},
                    "approvedDirectories": [],
                    "hostFallback": {},
                }
                new_key = "0123456789abcdef0123456789abcdef"
                window.pairing_key.setText("0123-4567-89ab-cdef-0123-4567-89ab-cdef")
                window.pairing_port.setText("9005")

                window.save_pairing_settings()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertEqual(saved["pairingKey"], new_key)
                self.assertEqual(saved["host"]["port"], 9005)

                window.unpair_extension()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertIsNone(saved["pairedExtensionId"])
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
                    "pairedExtensionId": None,
                }

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            window = BRunnerCompanionWindow(QAction)
            try:
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 2,
                    "pairingKey": "0123456789abcdef0123456789abcdef",
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
                window.config_file = Path(temp) / "brunner_config.json"
                window.log_file = Path(temp) / "brunner_host.log"
                window.config = {
                    "schemaVersion": 2,
                    "pairingKey": "test",
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
                window.fallback_screenshots.setChecked(True)

                window.save_host_fallback_settings()

                saved = json.loads(window.config_file.read_text(encoding="utf-8"))
                self.assertFalse(saved["hostFallback"]["enabled"])
                self.assertEqual(saved["hostFallback"]["minimumCoordinateConfidence"], 0.55)
                self.assertTrue(saved["hostFallback"]["captureDiagnosticsScreenshots"])
                self.assertIn("Host fallback settings saved.", window.log_file.read_text(encoding="utf-8"))
            finally:
                window.tray.hide()
                window.close()


if __name__ == "__main__":
    unittest.main()
