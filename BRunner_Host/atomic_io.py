import json
import os
import secrets
from pathlib import Path


def atomic_write_text(destination, content):
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = _normalize_newlines(str(content))
    temp_path = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    try:
        with open(temp_path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def atomic_write_json(destination, content, indent=4):
    serialized = json.dumps(content, indent=indent, ensure_ascii=False)
    atomic_write_text(destination, serialized + "\n")


def _normalize_newlines(value):
    return value.replace("\r\n", "\n").replace("\r", "\n")
