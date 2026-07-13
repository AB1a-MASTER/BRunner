import errno
import os
import socket
import subprocess
import sys
from pathlib import Path

from app import SERVE_HOST_ENV
from app_paths import application_directory


class HostServiceController:
    def __init__(self, base_dir=None, host_script=None, popen_factory=None, run_factory=None):
        self.base_dir = Path(base_dir).resolve() if base_dir else application_directory(__file__)
        self.host_script = Path(host_script).resolve() if host_script else self.base_dir / "brunner_host.py"
        self.popen_factory = popen_factory or subprocess.Popen
        self.run_factory = run_factory or subprocess.run
        self.process = None
        self.last_message = ""

    def command(self):
        if getattr(sys, "frozen", False):
            return [sys.executable, "--serve-host"]
        return [sys.executable, str(self.host_script)]

    def environment(self):
        env = os.environ.copy()
        if getattr(sys, "frozen", False):
            env[SERVE_HOST_ENV] = "1"
        return env

    def is_running(self):
        return bool(self.process and self.process.poll() is None)

    def configured_port(self, config=None):
        settings = config if isinstance(config, dict) else {}
        host = settings.get("host") if isinstance(settings.get("host"), dict) else {}
        value = host.get("port") or settings.get("port")
        try:
            port = int(value)
        except (TypeError, ValueError):
            return None
        if 1 <= port <= 65535:
            return port
        return None

    def is_port_listening(self, port, host="127.0.0.1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind((host, int(port)))
                return False
        except OSError as error:
            return error.errno in {
                errno.EADDRINUSE,
                errno.EACCES,
                10013,
                10048,
            }
        except ValueError:
            return False

    def start(self, config=None):
        if self.is_running():
            self.last_message = "Host start requested; host is already running."
            return False
        port = self.configured_port(config)
        if port and self.is_port_listening(port):
            self.last_message = (
                f"Host start requested; port {port} is already in use. "
                "An existing BRunner host may already be running."
            )
            return False
        popen_options = {
            "cwd": str(self.base_dir),
            "env": self.environment(),
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            popen_options["creationflags"] = subprocess.CREATE_NO_WINDOW
        self.process = self.popen_factory(self.command(), **popen_options)
        self.last_message = "Host start requested."
        return True

    def stop(self, timeout=3):
        if not self.is_running():
            self.last_message = "Host stop requested; host was not running."
            return False
        process = self.process
        tree_stop_requested = self.stop_windows_process_tree(process)
        if not tree_stop_requested:
            process.terminate()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=timeout)
        self.process = None
        self.last_message = "Host stop requested."
        return True

    def stop_windows_process_tree(self, process):
        pid = getattr(process, "pid", None)
        if os.name != "nt" or not pid:
            return False
        try:
            self.run_factory(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except OSError:
            return False

    def restart(self, config=None):
        self.stop()
        return self.start(config)

    def status(self, config):
        host = config.get("host") if isinstance(config.get("host"), dict) else {}
        port = host.get("port") or config.get("port")
        external = False
        if not self.is_running():
            checked_port = self.configured_port(config)
            external = bool(checked_port and self.is_port_listening(checked_port))
        return {
            "running": self.is_running() or external,
            "external": external,
            "port": port,
            "pairedExtensionId": config.get("pairedExtensionId") or config.get("paired_extension_id"),
        }
