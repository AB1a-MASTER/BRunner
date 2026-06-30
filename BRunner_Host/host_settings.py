import json
import secrets
import re
from pathlib import Path
from atomic_io import atomic_write_json


SCHEMA_VERSION = 2
DEFAULT_PORT = 8999
DEFAULT_ALLOWED_ROOTS = ["AllowedFiles"]
DEFAULT_COORDINATE_CONFIDENCE = 0.9


def create_default_config(pairing_key=None):
    key = pairing_key or secrets.token_hex(16)
    config = {
        "schemaVersion": SCHEMA_VERSION,
        "pairingKey": key,
        "pairedExtensionId": None,
        "host": {
            "port": DEFAULT_PORT,
            "startWithApp": True,
        },
        "workflowStorage": {
            "mode": "default",
            "directory": None,
        },
        "approvedDirectories": roots_to_approved_directories(
            DEFAULT_ALLOWED_ROOTS,
            enabled=False,
        ),
        "hostFallback": {
            "enabled": True,
            "minimumCoordinateConfidence": DEFAULT_COORDINATE_CONFIDENCE,
            "captureDiagnosticsScreenshots": False,
        },
    }
    return with_legacy_aliases(config)


def load_or_create_config(config_file, base_dir):
    path = Path(config_file)
    if path.exists():
        with open(path, "r", encoding="utf-8") as handle:
            config = json.load(handle)
    else:
        config = create_default_config()
        save_config(path, config)

    normalized = normalize_config(config, base_dir)
    if normalized != config:
        preserve_v1_backup(path, config)
        save_config(path, normalized)
    return normalized


def save_config(config_file, config):
    path = Path(config_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = normalize_config(config, path.parent)
    atomic_write_json(path, normalized, indent=4)
    return normalized


def normalize_config(config, base_dir=None):
    source = config if isinstance(config, dict) else {}
    defaults = create_default_config()
    pairing_key = str(source.get("pairingKey") or source.get("pairing_key") or "").strip()
    paired_extension_id = source.get("pairedExtensionId", source.get("paired_extension_id"))
    host = source.get("host") if isinstance(source.get("host"), dict) else {}
    workflow_storage = (
        source.get("workflowStorage")
        if isinstance(source.get("workflowStorage"), dict)
        else {}
    )
    host_fallback = (
        source.get("hostFallback")
        if isinstance(source.get("hostFallback"), dict)
        else {}
    )
    local_file_access = source.get("local_file_access")
    if not isinstance(local_file_access, dict):
        local_file_access = {}
    approved_directories = normalize_approved_directories(
        source.get("approvedDirectories"),
        local_file_access,
        base_dir,
    )
    local_enabled = any(entry.get("read") for entry in approved_directories)
    normalized = {
        "schemaVersion": SCHEMA_VERSION,
        "pairingKey": pairing_key or defaults["pairingKey"],
        "pairedExtensionId": normalize_optional_text(paired_extension_id),
        "host": {
            "port": normalize_port(host.get("port", source.get("port"))),
            "startWithApp": host.get("startWithApp") is not False,
        },
        "workflowStorage": normalize_workflow_storage(workflow_storage),
        "approvedDirectories": approved_directories,
        "hostFallback": {
            "enabled": host_fallback.get("enabled") is not False,
            "minimumCoordinateConfidence": normalize_coordinate_confidence(
                host_fallback.get("minimumCoordinateConfidence")
            ),
            "captureDiagnosticsScreenshots": (
                host_fallback.get("captureDiagnosticsScreenshots") is True
            ),
        },
    }
    if local_file_access.get("enabled") is True and not local_enabled:
        normalized["approvedDirectories"] = [
            {**entry, "read": True}
            for entry in normalized["approvedDirectories"]
        ]

    return with_legacy_aliases(normalized)


def with_legacy_aliases(config):
    copied = dict(config)
    approved = copied.get("approvedDirectories")
    if not isinstance(approved, list):
        approved = []
    host = copied.get("host") if isinstance(copied.get("host"), dict) else {}
    copied["pairing_key"] = copied.get("pairingKey")
    copied["paired_extension_id"] = copied.get("pairedExtensionId")
    copied["port"] = normalize_port(host.get("port"))
    copied["local_file_access"] = {
        "enabled": any(entry.get("read") for entry in approved),
        "allowed_roots": [entry["path"] for entry in approved if entry.get("path")],
    }
    return copied


def normalize_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        return DEFAULT_PORT
    if port < 1 or port > 65535:
        return DEFAULT_PORT
    return port


def normalize_coordinate_confidence(value):
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return DEFAULT_COORDINATE_CONFIDENCE
    if confidence < 0 or confidence > 1:
        return DEFAULT_COORDINATE_CONFIDENCE
    return confidence


def normalize_workflow_storage(value):
    mode = str(value.get("mode") or "default").strip().lower()
    if mode not in {"default", "custom"}:
        mode = "default"
    directory = normalize_optional_text(value.get("directory"))
    if mode == "default":
        directory = None
    return {
        "mode": mode,
        "directory": directory,
    }


def normalize_allowed_roots(value, base_dir=None):
    roots = value if isinstance(value, list) else DEFAULT_ALLOWED_ROOTS
    normalized = []
    for item in roots:
        text = str(item or "").strip().strip('"')
        if not text:
            continue
        normalized.append(text)
    return normalized or list(DEFAULT_ALLOWED_ROOTS)


def normalize_approved_directories(value, local_file_access=None, base_dir=None):
    if isinstance(value, list) and value:
        entries = []
        used_ids = set()
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                continue
            path = normalize_optional_text(item.get("path"))
            if not path:
                continue
            entry_id = unique_alias_id(
                item.get("id") or item.get("displayName") or path,
                used_ids,
                index,
            )
            entries.append({
                "id": entry_id,
                "displayName": normalize_optional_text(item.get("displayName")) or entry_id,
                "path": path,
                "read": item.get("read") is not False,
                "write": item.get("write") is True,
                "recursive": item.get("recursive") is not False,
            })
        if entries:
            return entries

    access = local_file_access if isinstance(local_file_access, dict) else {}
    roots = normalize_allowed_roots(access.get("allowed_roots"), base_dir)
    return roots_to_approved_directories(
        roots,
        enabled=access.get("enabled") is True,
    )


def roots_to_approved_directories(roots, enabled=False):
    used_ids = set()
    entries = []
    for index, root in enumerate(normalize_allowed_roots(roots)):
        entry_id = unique_alias_id(root, used_ids, index)
        entries.append({
            "id": entry_id,
            "displayName": display_name_from_root(root, entry_id),
            "path": root,
            "read": enabled is True,
            "write": False,
            "recursive": True,
        })
    return entries


def unique_alias_id(value, used_ids, index):
    base = slugify(value) or f"directory-{index + 1}"
    candidate = base
    suffix = 2
    while candidate in used_ids:
        candidate = f"{base}-{suffix}"
        suffix += 1
    used_ids.add(candidate)
    return candidate


def slugify(value):
    text = str(value or "").replace("\\", "/").rstrip("/").split("/")[-1]
    text = re.sub(r"[^A-Za-z0-9]+", "-", text.lower()).strip("-")
    return text or "directory"


def display_name_from_root(root, fallback):
    text = str(root or "").replace("\\", "/").rstrip("/").split("/")[-1]
    return text or fallback


def preserve_v1_backup(path, config):
    if not isinstance(config, dict) or config.get("schemaVersion") == SCHEMA_VERSION:
        return
    backup = Path(path).with_name(f"{Path(path).name}.v1.bak")
    if backup.exists():
        return
    atomic_write_json(backup, config, indent=4)


def normalize_optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def format_allowed_roots(roots):
    return "\n".join(normalize_allowed_roots(roots))


def parse_allowed_roots(text):
    return [
        line.strip()
        for line in str(text or "").splitlines()
        if line.strip()
    ] or list(DEFAULT_ALLOWED_ROOTS)
