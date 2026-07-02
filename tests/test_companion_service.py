import sys
import subprocess
import tempfile
import unittest
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from companion_service import HostServiceController


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
            {"running": False, "port": 9001, "pairedExtensionId": "extension"},
        )
        self.assertEqual(
            self.controller.status({
                "port": 9002,
                "paired_extension_id": "legacy",
            }),
            {"running": False, "port": 9002, "pairedExtensionId": "legacy"},
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


if __name__ == "__main__":
    unittest.main()
