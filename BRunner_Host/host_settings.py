import json
import re
from pathlib import Path
from atomic_io import atomic_write_json


SCHEMA_VERSION = 3
DEFAULT_PORT = 8999
DEFAULT_ALLOWED_ROOTS = ["AllowedFiles"]
DEFAULT_COORDINATE_CONFIDENCE = 0.9
PROFILE_INSTANCE_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def normalize_profile_instance_id(value):
    return str(value or "").strip().lower()


def is_valid_profile_instance_id(value):
    return bool(PROFILE_INSTANCE_ID_PATTERN.fullmatch(
        normalize_profile_instance_id(value)
    ))


def create_default_config():
    config = {
        "schemaVersion": SCHEMA_VERSION,
        "pairedInstanceId": None,
        "host": {
            "port": DEFAULT_PORT,
            "startWithApp": True,
        },
        "workflowStorage": {
            "mode": "default",
            "directory": None,
        },
        "workflowDiscovery": {
            "recursive": False,
        },
        "approvedDirectories": roots_to_approved_directories(
            DEFAULT_ALLOWED_ROOTS,
            enabled=False,
        ),
        "hostFallback": {
            "enabled": True,
            "minimumCoordinateConfidence": DEFAULT_COORDINATE_CONFIDENCE,
        },
    }
    return with_legacy_aliases(config)


def load_or_create_config(config_file, base_dir):
    path = Path(config_file)
    if path.exists():
        with open(path, "r", encoding="utf-8-sig") as handle:
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
    has_explicit_approved_directories = isinstance(
        source.get("approvedDirectories"),
        list,
    )
    paired_instance_id = normalize_profile_instance_id(
        source.get("pairedInstanceId")
    )
    if not is_valid_profile_instance_id(paired_instance_id):
        paired_instance_id = None
    host = source.get("host") if isinstance(source.get("host"), dict) else {}
    workflow_storage = (
        source.get("workflowStorage")
        if isinstance(source.get("workflowStorage"), dict)
        else {}
    )
    workflow_discovery = (
        source.get("workflowDiscovery")
        if isinstance(source.get("workflowDiscovery"), dict)
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
        "pairedInstanceId": paired_instance_id,
        "host": {
            "port": normalize_port(host.get("port", source.get("port"))),
            "startWithApp": host.get("startWithApp") is not False,
        },
        "workflowStorage": normalize_workflow_storage(workflow_storage),
        "workflowDiscovery": {
            "recursive": workflow_discovery.get("recursive") is True,
        },
        "approvedDirectories": approved_directories,
        "hostFallback": {
            "enabled": host_fallback.get("enabled") is not False,
            "minimumCoordinateConfidence": normalize_coordinate_confidence(
                host_fallback.get("minimumCoordinateConfidence")
            ),
        },
    }
    if (
        not has_explicit_approved_directories
        and local_file_access.get("enabled") is True
        and not local_enabled
    ):
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
    copied["port"] = normalize_port(host.get("port"))
    copied["local_file_access"] = {
        "enabled": any(entry.get("read") for entry in approved),
        "allowed_roots": [entry["path"] for entry in approved if entry.get("path")],
    }
    return copied


def normalize_port(_value=None):
    """Keep the companion aligned with the extension's fixed loopback port."""
    return DEFAULT_PORT


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
    if isinstance(value, list):
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
