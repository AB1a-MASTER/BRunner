import subprocess
import sys
from pathlib import Path

from app_paths import application_directory


class HostServiceController:
    def __init__(self, base_dir=None, host_script=None, popen_factory=None):
        self.base_dir = Path(base_dir).resolve() if base_dir else application_directory(__file__)
        self.host_script = Path(host_script).resolve() if host_script else self.base_dir / "brunner_host.py"
        self.popen_factory = popen_factory or subprocess.Popen
        self.process = None

    def command(self):
        if getattr(sys, "frozen", False):
            return [sys.executable, "--serve-host"]
        return [sys.executable, str(self.host_script)]

    def is_running(self):
        return bool(self.process and self.process.poll() is None)

    def start(self):
        if self.is_running():
            return False
        self.process = self.popen_factory(
            self.command(),
            cwd=str(self.base_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True

    def stop(self):
        if not self.is_running():
            return False
        self.process.terminate()
        return True

    def restart(self):
        self.stop()
        return self.start()

    def status(self, config):
        host = config.get("host") if isinstance(config.get("host"), dict) else {}
        return {
            "running": self.is_running(),
            "port": host.get("port") or config.get("port"),
            "pairedExtensionId": config.get("pairedExtensionId") or config.get("paired_extension_id"),
        }
