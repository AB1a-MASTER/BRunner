import os
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from companion_service import HostServiceController
from app import SERVE_HOST_ENV


class FakeProcess:
    def __init__(self):
        self.terminated = False
        self.killed = False

    def poll(self):
        return 1 if self.terminated else None

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True
        self.terminated = True

    def wait(self, timeout=None):
        return self.poll()


class FakePopen:
    def __init__(self):
        self.calls = []
        self.processes = []

    def __call__(self, command, **kwargs):
        process = FakeProcess()
        self.calls.append((command, kwargs))
        self.processes.append(process)
        return process


class StubbornProcess(FakeProcess):
    def wait(self, timeout=None):
        if not self.killed:
            raise subprocess.TimeoutExpired("host", timeout)
        return self.poll()


class StubbornPopen(FakePopen):
    def __call__(self, command, **kwargs):
        process = StubbornProcess()
        self.calls.append((command, kwargs))
        self.processes.append(process)
        return process


class HostServiceControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base_dir = Path(self.temp.name)
        self.host_script = self.base_dir / "brunner_host.py"
        self.host_script.write_text("# host", encoding="utf-8")
        self.popen = FakePopen()
        self.controller = HostServiceController(
            self.base_dir,
            self.host_script,
            popen_factory=self.popen,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_source_command_uses_host_script(self):
        self.assertEqual(self.controller.command(), [sys.executable, str(self.host_script)])
        self.assertNotIn(SERVE_HOST_ENV, self.controller.environment())

    def test_frozen_command_uses_executable_and_serve_environment(self):
        original_executable = sys.executable
        had_frozen = hasattr(sys, "frozen")
        original_frozen = getattr(sys, "frozen", None)
        executable = self.base_dir / "dist" / "BRunnerHost.exe"

        try:
            sys.frozen = True
            sys.executable = str(executable)

            self.assertEqual(self.controller.command(), [str(executable), "--serve-host"])
            self.assertEqual(self.controller.environment()[SERVE_HOST_ENV], "1")
        finally:
            sys.executable = original_executable
            if had_frozen:
                sys.frozen = original_frozen
            else:
                delattr(sys, "frozen")

    def test_start_stop_and_restart_manage_single_process(self):
        self.assertTrue(self.controller.start())
        self.assertTrue(self.controller.is_running())
        self.assertFalse(self.controller.start())
        self.assertEqual(len(self.popen.calls), 1)

        self.assertTrue(self.controller.stop())
        self.assertFalse(self.controller.is_running())
        self.assertFalse(self.controller.stop())

        self.assertTrue(self.controller.restart())
        self.assertEqual(len(self.popen.calls), 2)

    def test_status_uses_v2_and_legacy_config_values(self):
        self.assertEqual(
            self.controller.status({
                "host": {"port": 9001},
                "pairedExtensionId": "extension",
            }),
            {"running": False, "external": False, "port": 9001, "pairedExtensionId": "extension"},
        )
        self.assertEqual(
            self.controller.status({
                "port": 9002,
                "paired_extension_id": "legacy",
            }),
            {"running": False, "external": False, "port": 9002, "pairedExtensionId": "legacy"},
        )

    def test_start_refuses_when_configured_port_is_already_listening(self):
        self.controller.is_port_listening = lambda port: port == 9010

        self.assertFalse(self.controller.start({"host": {"port": 9010}}))

        self.assertEqual(len(self.popen.calls), 0)
        self.assertIn("port 9010 is already in use", self.controller.last_message)

    def test_status_reports_external_listener(self):
        self.controller.is_port_listening = lambda port: port == 9011

        self.assertEqual(
            self.controller.status({"host": {"port": 9011}}),
            {
                "running": True,
                "external": True,
                "port": 9011,
                "pairedExtensionId": None,
            },
        )

    def test_stop_kills_process_when_terminate_times_out(self):
        popen = StubbornPopen()
        controller = HostServiceController(
            self.base_dir,
            self.host_script,
            popen_factory=popen,
        )

        self.assertTrue(controller.start())
        self.assertTrue(controller.stop(timeout=0.01))
        self.assertTrue(popen.processes[0].killed)
        self.assertFalse(controller.is_running())

    def test_windows_tree_stop_targets_managed_launcher_pid(self):
        calls = []

        class Process:
            pid = 4321

        controller = HostServiceController(
            self.base_dir,
            self.host_script,
            popen_factory=self.popen,
            run_factory=lambda command, **kwargs: calls.append((command, kwargs)),
        )
        original_os_name = os.name
        try:
            os.name = "nt"
            self.assertTrue(controller.stop_windows_process_tree(Process()))
        finally:
            os.name = original_os_name

        self.assertEqual(calls[0][0], ["taskkill", "/PID", "4321", "/T", "/F"])


if __name__ == "__main__":
    unittest.main()
