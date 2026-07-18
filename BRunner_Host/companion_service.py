import errno
import ctypes
import os
import socket
import subprocess
import sys
from pathlib import Path

from app import SERVE_HOST_ENV
from app_paths import application_directory
from host_runtime_status import (
    clear_connection_status,
    connection_status_is_fresh,
    read_connection_status,
)


class HostServiceController:
    def __init__(
        self,
        base_dir=None,
        host_script=None,
        popen_factory=None,
        run_factory=None,
        process_alive_factory=None,
        listener_process_ids_factory=None,
    ):
        self.base_dir = Path(base_dir).resolve() if base_dir else application_directory(__file__)
        self.host_script = Path(host_script).resolve() if host_script else self.base_dir / "brunner_host.py"
        self.popen_factory = popen_factory or subprocess.Popen
        self.run_factory = run_factory or subprocess.run
        self.process_alive_factory = process_alive_factory or process_is_alive
        self.listener_process_ids_factory = (
            listener_process_ids_factory or windows_listening_process_ids
        )
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
        self.clear_runtime_status(port)
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
        self.clear_runtime_status()
        self.last_message = "Host stop requested."
        return True

    def stop_windows_process_tree(self, process):
        pid = getattr(process, "pid", None)
        if os.name != "nt" or not pid:
            return False
        try:
            completed = self.run_factory(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return getattr(completed, "returncode", 1) == 0
        except OSError:
            return False

    def restart(self, config=None):
        self.stop()
        return self.start(config)

    def status(self, config):
        host = config.get("host") if isinstance(config.get("host"), dict) else {}
        port = host.get("port") or config.get("port")
        external = False
        managed = self.is_running()
        if not managed:
            checked_port = self.configured_port(config)
            external = bool(checked_port and self.is_port_listening(checked_port))
        running = managed or external
        paired_instance_id = str(config.get("pairedInstanceId") or "").strip() or None
        runtime = read_connection_status(self.base_dir)
        configured_port = self.configured_port(config)
        runtime_port = runtime.get("port")
        live = bool(
            running
            and configured_port
            and runtime_port == configured_port
            and runtime.get("connected")
            and runtime.get("handshakeComplete")
            and connection_status_is_fresh(runtime)
        )
        process_id = getattr(self.process, "pid", None) if managed else None
        runtime_process_id = runtime.get("hostProcessId")
        if managed:
            if not process_id or process_id != runtime_process_id:
                live = False
        elif external:
            try:
                process_alive = bool(
                    runtime_process_id
                    and self.process_alive_factory(runtime_process_id)
                )
            except Exception:
                process_alive = False
            if not process_alive:
                live = False
            else:
                try:
                    listener_process_ids = self.listener_process_ids_factory(
                        configured_port
                    )
                except Exception:
                    listener_process_ids = None
                if (
                    not isinstance(listener_process_ids, (set, frozenset, list, tuple))
                    or runtime_process_id not in listener_process_ids
                ):
                    live = False
        connected_instance_id = runtime.get("profileInstanceId") if live else None
        if connected_instance_id != paired_instance_id:
            connected_instance_id = None
            live = False
        return {
            "running": running,
            "external": external,
            "port": port,
            "pairedInstanceId": paired_instance_id,
            "extensionConnected": live,
            "connectedProfileInstanceId": connected_instance_id,
            "pairingState": (
                "unpaired"
                if not paired_instance_id
                else ("connected" if live else "disconnected")
            ),
        }

    def clear_runtime_status(self, port=None):
        try:
            clear_connection_status(self.base_dir, port=port)
        except OSError:
            return False
        return True


def process_is_alive(process_id):
    try:
        process_id = int(process_id)
    except (TypeError, ValueError):
        return False
    if process_id <= 0:
        return False

    if os.name == "nt":
        process_query_limited_information = 0x1000
        still_active = 259
        try:
            from ctypes import wintypes

            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(
                process_query_limited_information,
                False,
                process_id,
            )
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD(0)
                return bool(
                    kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                    and exit_code.value == still_active
                )
            finally:
                kernel32.CloseHandle(handle)
        except (AttributeError, OSError, TypeError, ValueError):
            return False

    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def windows_listening_process_ids(port):
    """Return IPv4 listener PIDs for a local port, or None when unverified."""
    try:
        port = int(port)
    except (TypeError, ValueError):
        return None
    if os.name != "nt" or not 1 <= port <= 65535:
        return None

    try:
        from ctypes import wintypes

        class MibTcpRowOwnerPid(ctypes.Structure):
            _fields_ = [
                ("state", wintypes.DWORD),
                ("local_address", wintypes.DWORD),
                ("local_port", wintypes.DWORD),
                ("remote_address", wintypes.DWORD),
                ("remote_port", wintypes.DWORD),
                ("owning_process_id", wintypes.DWORD),
            ]

        ip_helper = ctypes.WinDLL("iphlpapi", use_last_error=True)
        get_tcp_table = ip_helper.GetExtendedTcpTable
        get_tcp_table.argtypes = [
            wintypes.LPVOID,
            ctypes.POINTER(wintypes.ULONG),
            wintypes.BOOL,
            wintypes.ULONG,
            wintypes.ULONG,
            wintypes.ULONG,
        ]
        get_tcp_table.restype = wintypes.DWORD

        address_family_inet = 2
        owner_pid_listener_table = 3
        insufficient_buffer = 122
        size = wintypes.ULONG(0)
        result = get_tcp_table(
            None,
            ctypes.byref(size),
            False,
            address_family_inet,
            owner_pid_listener_table,
            0,
        )
        if result != insufficient_buffer or size.value <= ctypes.sizeof(wintypes.DWORD):
            return None

        buffer = ctypes.create_string_buffer(size.value)
        result = get_tcp_table(
            buffer,
            ctypes.byref(size),
            False,
            address_family_inet,
            owner_pid_listener_table,
            0,
        )
        if result != 0:
            return None

        row_count = ctypes.cast(
            buffer,
            ctypes.POINTER(wintypes.DWORD),
        ).contents.value
        row_size = ctypes.sizeof(MibTcpRowOwnerPid)
        first_row = ctypes.sizeof(wintypes.DWORD)
        if first_row + (row_count * row_size) > size.value:
            return None

        process_ids = set()
        for index in range(row_count):
            row = MibTcpRowOwnerPid.from_buffer(
                buffer,
                first_row + (index * row_size),
            )
            local_port = socket.ntohs(int(row.local_port) & 0xFFFF)
            if local_port == port and int(row.owning_process_id) > 0:
                process_ids.add(int(row.owning_process_id))
        return process_ids
    except (AttributeError, OSError, TypeError, ValueError):
        return None
