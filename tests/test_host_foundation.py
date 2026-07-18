import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from app_paths import (
    active_workflows_directory,
    application_directory,
    default_config_file,
    default_log_file,
    default_logs_directory,
    default_workflows_directory,
)
from atomic_io import atomic_write_json, atomic_write_text
import app
from app import (
    SELF_CHECK_FLAG,
    SERVE_HOST_ENV,
    launcher_log_file,
    companion_startup_error_message,
    run_self_check,
    should_run_self_check,
    should_serve_host,
)


class HostFoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_source_mode_paths_use_anchor_directory(self):
        anchor = self.base_dir / "host" / "brunner_host.py"
        anchor.parent.mkdir()
        anchor.write_text("# host", encoding="utf-8")

        self.assertEqual(application_directory(anchor), anchor.parent)
        self.assertEqual(default_config_file(anchor), anchor.parent / "brunner_config.json")
        self.assertEqual(default_workflows_directory(anchor), anchor.parent / "Workflows")
        self.assertEqual(default_logs_directory(anchor), anchor.parent / "Logs")
        self.assertEqual(default_log_file(anchor), anchor.parent / "Logs" / "brunner_host.log")

    def test_source_mode_accepts_directory_anchor(self):
        self.assertEqual(application_directory(self.base_dir), self.base_dir)
        self.assertEqual(default_workflows_directory(self.base_dir), self.base_dir / "Workflows")

    def test_active_workflows_directory_uses_custom_or_default(self):
        custom = self.base_dir / "CustomFlows"
        self.assertEqual(
            active_workflows_directory(
                {"workflowStorage": {"mode": "custom", "directory": str(custom)}},
                self.base_dir,
            ),
            custom.resolve(),
        )
        self.assertEqual(
            active_workflows_directory(
                {"workflowStorage": {"mode": "default", "directory": str(custom)}},
                self.base_dir,
            ),
            self.base_dir / "Workflows",
        )

    def test_frozen_paths_use_executable_directory(self):
        original_executable = sys.executable
        had_frozen = hasattr(sys, "frozen")
        original_frozen = getattr(sys, "frozen", None)
        executable = self.base_dir / "dist" / "BRunnerHost.exe"
        executable.parent.mkdir()
        executable.write_text("binary", encoding="utf-8")

        try:
            sys.frozen = True
            sys.executable = str(executable)

            self.assertEqual(application_directory(__file__), executable.parent)
            self.assertEqual(default_workflows_directory(__file__), executable.parent / "Workflows")
        finally:
            sys.executable = original_executable
            if had_frozen:
                sys.frozen = original_frozen
            else:
                delattr(sys, "frozen")

    def test_launcher_recognizes_argument_and_environment_serve_modes(self):
        self.assertTrue(should_serve_host(["BRunnerHost.exe", "--serve-host"], {}))
        self.assertTrue(should_serve_host(["BRunnerHost.exe"], {SERVE_HOST_ENV: "1"}))
        self.assertTrue(should_serve_host(["BRunnerHost.exe"], {SERVE_HOST_ENV: "true"}))
        self.assertFalse(should_serve_host(["BRunnerHost.exe"], {}))
        self.assertTrue(should_run_self_check(["BRunnerHost.exe", SELF_CHECK_FLAG]))
        self.assertFalse(should_run_self_check(["BRunnerHost.exe"]))

    def test_source_self_check_initializes_writable_runtime_state(self):
        original_host_dir = app.HOST_DIR
        try:
            app.HOST_DIR = self.base_dir
            self.assertEqual(run_self_check(), 0)
            self.assertTrue((self.base_dir / "brunner_config.json").is_file())
            self.assertTrue((self.base_dir / "Workflows").is_dir())
        finally:
            app.HOST_DIR = original_host_dir

    def test_frozen_launcher_log_uses_executable_directory(self):
        original_executable = sys.executable
        had_frozen = hasattr(sys, "frozen")
        original_frozen = getattr(sys, "frozen", None)
        executable = self.base_dir / "dist" / "BRunnerHost.exe"
        executable.parent.mkdir()

        try:
            sys.frozen = True
            sys.executable = str(executable)

            self.assertEqual(launcher_log_file(), executable.parent / "brunner_launcher.log")
        finally:
            sys.executable = original_executable
            if had_frozen:
                sys.frozen = original_frozen
            else:
                delattr(sys, "frozen")

    def test_serve_host_startup_failure_returns_without_reraising(self):
        original_argv = sys.argv
        original_run_embedded_host = app.run_embedded_host
        original_write_launcher_error = app.write_launcher_error

        def fail_startup():
            raise OSError("port already in use")

        try:
            sys.argv = ["BRunnerHost.exe", "--serve-host"]
            app.run_embedded_host = fail_startup
            app.write_launcher_error = lambda error: None

            self.assertEqual(app.main(), 2)
        finally:
            sys.argv = original_argv
            app.run_embedded_host = original_run_embedded_host
            app.write_launcher_error = original_write_launcher_error

    def test_companion_startup_failure_is_logged_and_shown_actionably(self):
        error = PermissionError("workflow folder is read-only")
        original_argv = sys.argv
        try:
            sys.argv = ["app.py"]
            with mock.patch(
                "desktop.main_window.run_companion_app",
                side_effect=error,
            ), mock.patch.object(app, "write_launcher_error") as write_error, mock.patch.object(
                app,
                "show_companion_startup_error",
            ) as show_error, mock.patch.dict(
                "os.environ",
                {SERVE_HOST_ENV: ""},
            ):
                self.assertEqual(app.main(), 2)
        finally:
            sys.argv = original_argv

        write_error.assert_called_once_with(error)
        show_error.assert_called_once_with(error)
        message = companion_startup_error_message(error)
        self.assertIn("workflow folder", message)
        self.assertIn("writable", message)
        self.assertIn("move the source folder", message)

    def test_atomic_json_write_creates_normalized_file_without_temp_leftovers(self):
        destination = self.base_dir / "nested" / "config.json"

        atomic_write_json(destination, {"name": "BRunner", "ok": True}, indent=2)

        self.assertEqual(json.loads(destination.read_text(encoding="utf-8"))["name"], "BRunner")
        self.assertEqual(list(destination.parent.glob("*.tmp")), [])

    def test_atomic_text_write_normalizes_newlines(self):
        destination = self.base_dir / "Logs" / "run.log"

        atomic_write_text(destination, "one\r\ntwo\rthree\n")

        self.assertEqual(destination.read_text(encoding="utf-8"), "one\ntwo\nthree\n")
        self.assertEqual(list(destination.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
