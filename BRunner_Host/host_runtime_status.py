import json
import os
from datetime import datetime, timezone
from pathlib import Path

from atomic_io import atomic_write_json


RUNTIME_STATUS_FILENAME = "host_connection.json"
RUNTIME_STATUS_MAX_AGE_SECONDS = 15.0
RUNTIME_STATUS_VERSION = 1


def runtime_status_file(base_dir):
    return Path(base_dir) / "Logs" / RUNTIME_STATUS_FILENAME


def write_connection_status(
    base_dir,
    profile_instance_id=None,
    port=None,
    host_process_id=None,
    handshake_complete=True,
    now=None,
):
    profile_instance_id = str(profile_instance_id or "").strip() or None
    port = _normalize_port(port)
    process_id = _normalize_process_id(
        host_process_id if host_process_id is not None else os.getpid()
    )
    connected = bool(
        profile_instance_id
        and port
        and process_id
        and handshake_complete is True
    )
    updated_at = now if isinstance(now, datetime) else datetime.now(timezone.utc)
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    status = {
        "version": RUNTIME_STATUS_VERSION,
        "connected": connected,
        "handshakeComplete": connected,
        "profileInstanceId": profile_instance_id if connected else None,
        "port": port,
        "hostProcessId": process_id if connected else None,
        "updatedAt": updated_at.astimezone(timezone.utc).isoformat(),
    }
    atomic_write_json(runtime_status_file(base_dir), status, indent=2)
    return status


def clear_connection_status(base_dir, port=None):
    return write_connection_status(
        base_dir,
        profile_instance_id=None,
        port=port,
        host_process_id=None,
        handshake_complete=False,
    )


def read_connection_status(base_dir):
    path = runtime_status_file(base_dir)
    try:
        with open(path, "r", encoding="utf-8-sig") as handle:
            value = json.load(handle)
    except (OSError, ValueError, TypeError):
        return _empty_status()
    if not isinstance(value, dict):
        return _empty_status()
    version = value.get("version")
    profile_instance_id = str(value.get("profileInstanceId") or "").strip() or None
    port = _normalize_port(value.get("port"))
    process_id = _normalize_process_id(value.get("hostProcessId"))
    handshake_complete = value.get("handshakeComplete") is True
    connected = bool(
        version == RUNTIME_STATUS_VERSION
        and value.get("connected") is True
        and handshake_complete
        and profile_instance_id
        and port
        and process_id
    )
    return {
        "version": version if version == RUNTIME_STATUS_VERSION else None,
        "connected": connected,
        "handshakeComplete": handshake_complete if connected else False,
        "profileInstanceId": profile_instance_id if connected else None,
        "port": port,
        "hostProcessId": process_id if connected else None,
        "updatedAt": str(value.get("updatedAt") or ""),
    }


def connection_status_is_fresh(
    status,
    now=None,
    max_age_seconds=RUNTIME_STATUS_MAX_AGE_SECONDS,
):
    source = status if isinstance(status, dict) else {}
    raw_updated_at = str(source.get("updatedAt") or "").strip()
    if not raw_updated_at:
        return False
    try:
        updated_at = datetime.fromisoformat(raw_updated_at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    current = now if isinstance(now, datetime) else datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    age_seconds = (current.astimezone(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()
    return -1.0 <= age_seconds <= float(max_age_seconds)


def _empty_status():
    return {
        "version": None,
        "connected": False,
        "handshakeComplete": False,
        "profileInstanceId": None,
        "port": None,
        "hostProcessId": None,
        "updatedAt": "",
    }


def _normalize_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    return port if 1 <= port <= 65535 else None


def _normalize_process_id(value):
    try:
        process_id = int(value)
    except (TypeError, ValueError):
        return None
    return process_id if process_id > 0 else None
