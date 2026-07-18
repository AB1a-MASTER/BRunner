import os
import sys
import json
import socket
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

from companion_service import HostServiceController, windows_listening_process_ids
from app import SERVE_HOST_ENV
from host_runtime_status import runtime_status_file, write_connection_status


PROFILE_INSTANCE_ID = "123e4567-e89b-42d3-a456-426614174000"


class FakeProcess:
    def __init__(self):
        self.terminated = False
        self.killed = False
        self.pid = 4321

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

    def test_status_reports_configured_profile_without_live_connection(self):
        self.assertEqual(
            self.controller.status({
                "host": {"port": 9001},
                "pairedInstanceId": PROFILE_INSTANCE_ID,
            }),
            {
                "running": False,
                "external": False,
                "port": 9001,
                "pairedInstanceId": PROFILE_INSTANCE_ID,
                "extensionConnected": False,
                "connectedProfileInstanceId": None,
                "pairingState": "disconnected",
            },
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
                "pairedInstanceId": None,
                "extensionConnected": False,
                "connectedProfileInstanceId": None,
                "pairingState": "unpaired",
            },
        )

    def test_status_requires_matching_live_profile_and_process(self):
        config = {
            "host": {"port": 9003},
            "pairedInstanceId": PROFILE_INSTANCE_ID,
        }
        self.assertTrue(self.controller.start(config))
        write_connection_status(
            self.base_dir,
            profile_instance_id=PROFILE_INSTANCE_ID,
            port=9003,
            host_process_id=self.controller.process.pid,
        )

        status = self.controller.status(config)

        self.assertTrue(status["extensionConnected"])
        self.assertEqual(status["connectedProfileInstanceId"], PROFILE_INSTANCE_ID)
        self.assertEqual(status["pairingState"], "connected")

    def test_status_rejects_stale_or_mismatched_runtime_heartbeat(self):
        config = {
            "host": {"port": 9003},
            "pairedInstanceId": PROFILE_INSTANCE_ID,
        }
        self.assertTrue(self.controller.start(config))
        base_arguments = {
            "profile_instance_id": PROFILE_INSTANCE_ID,
            "port": 9003,
            "host_process_id": self.controller.process.pid,
        }
        cases = [
            {"now": datetime(2020, 1, 1, tzinfo=timezone.utc)},
            {"port": 9004},
            {"profile_instance_id": "223e4567-e89b-42d3-a456-426614174001"},
            {"host_process_id": self.controller.process.pid + 1},
        ]

        for overrides in cases:
            with self.subTest(overrides=overrides):
                arguments = dict(base_arguments)
                arguments.update(overrides)
                write_connection_status(self.base_dir, **arguments)
                self.assertFalse(self.controller.status(config)["extensionConnected"])

        write_connection_status(self.base_dir, **base_arguments)
        path = runtime_status_file(self.base_dir)
        record = json.loads(path.read_text(encoding="utf-8"))
        record["handshakeComplete"] = False
        path.write_text(json.dumps(record), encoding="utf-8")
        self.assertFalse(self.controller.status(config)["extensionConnected"])

    def test_external_status_requires_live_pid_to_own_configured_listener(self):
        process_alive = True
        listener_process_ids = {7777}
        controller = HostServiceController(
            self.base_dir,
            self.host_script,
            popen_factory=self.popen,
            process_alive_factory=lambda process_id: process_alive and process_id == 7777,
            listener_process_ids_factory=lambda port: (
                listener_process_ids if port == 9011 else None
            ),
        )
        controller.is_port_listening = lambda port: port == 9011
        config = {
            "host": {"port": 9011},
            "pairedInstanceId": PROFILE_INSTANCE_ID,
        }
        write_connection_status(
            self.base_dir,
            profile_instance_id=PROFILE_INSTANCE_ID,
            port=9011,
            host_process_id=7777,
        )

        self.assertTrue(controller.status(config)["extensionConnected"])

        listener_process_ids = {8888}
        self.assertFalse(controller.status(config)["extensionConnected"])

        listener_process_ids = {7777}
        process_alive = False
        self.assertFalse(controller.status(config)["extensionConnected"])

    @unittest.skipUnless(os.name == "nt", "Windows listener ownership contract")
    def test_windows_listener_lookup_reports_actual_owning_process(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]

            self.assertIn(os.getpid(), windows_listening_process_ids(port))

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
            run_factory=lambda command, **kwargs: (
                calls.append((command, kwargs))
                or subprocess.CompletedProcess(command, 0)
            ),
        )
        original_os_name = os.name
        try:
            os.name = "nt"
            self.assertTrue(controller.stop_windows_process_tree(Process()))
        finally:
            os.name = original_os_name

        self.assertEqual(calls[0][0], ["taskkill", "/PID", "4321", "/T", "/F"])

    def test_windows_tree_stop_nonzero_falls_back_to_process_terminate(self):
        calls = []
        process = FakeProcess()
        controller = HostServiceController(
            self.base_dir,
            self.host_script,
            popen_factory=self.popen,
            run_factory=lambda command, **kwargs: (
                calls.append((command, kwargs))
                or subprocess.CompletedProcess(command, 128)
            ),
        )
        controller.process = process
        original_os_name = os.name
        try:
            os.name = "nt"
            self.assertTrue(controller.stop())
        finally:
            os.name = original_os_name

        self.assertEqual(calls[0][0], ["taskkill", "/PID", "4321", "/T", "/F"])
        self.assertTrue(process.terminated)
        self.assertFalse(process.killed)


if __name__ == "__main__":
    unittest.main()
