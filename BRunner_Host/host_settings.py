import json
import os
import secrets
from pathlib import Path


DEFAULT_PORT = 8999
DEFAULT_ALLOWED_ROOTS = ["AllowedFiles"]


def create_default_config(pairing_key=None):
    return {
        "pairing_key": pairing_key or secrets.token_hex(16),
        "paired_extension_id": None,
        "port": DEFAULT_PORT,
        "local_file_access": {
            "enabled": False,
            "allowed_roots": list(DEFAULT_ALLOWED_ROOTS),
        },
    }


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
        save_config(path, normalized)
    return normalized


def save_config(config_file, config):
    path = Path(config_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = normalize_config(config, path.parent)
    temp_path = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(normalized, handle, indent=4)
    os.replace(temp_path, path)
    return normalized


def normalize_config(config, base_dir=None):
    source = config if isinstance(config, dict) else {}
    defaults = create_default_config()
    pairing_key = str(source.get("pairing_key") or "").strip()
    paired_extension_id = source.get("paired_extension_id")
    local_file_access = source.get("local_file_access")
    if not isinstance(local_file_access, dict):
        local_file_access = {}

    return {
        "pairing_key": pairing_key or defaults["pairing_key"],
        "paired_extension_id": normalize_optional_text(paired_extension_id),
        "port": normalize_port(source.get("port")),
        "local_file_access": {
            "enabled": local_file_access.get("enabled") is True,
            "allowed_roots": normalize_allowed_roots(
                local_file_access.get("allowed_roots"),
                base_dir,
            ),
        },
    }


def normalize_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        return DEFAULT_PORT
    if port < 1 or port > 65535:
        return DEFAULT_PORT
    return port


def normalize_allowed_roots(value, base_dir=None):
    roots = value if isinstance(value, list) else DEFAULT_ALLOWED_ROOTS
    normalized = []
    for item in roots:
        text = str(item or "").strip().strip('"')
        if not text:
            continue
        normalized.append(text)
    return normalized or list(DEFAULT_ALLOWED_ROOTS)


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
