import base64
import mimetypes
from pathlib import Path


MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024


class LocalFileAccessError(ValueError):
    pass


def read_allowed_file(config, base_dir, requested_path, max_bytes=MAX_LOCAL_FILE_BYTES):
    access = config.get("local_file_access")

    if not isinstance(access, dict) or access.get("enabled") is not True:
        raise LocalFileAccessError("Local file access is disabled in host config.")

    allowed_roots = access.get("allowed_roots")
    if not isinstance(allowed_roots, list) or not allowed_roots:
        raise LocalFileAccessError("Local file access has no allowed roots.")

    raw_path = str(requested_path or "").strip()
    if not raw_path:
        raise LocalFileAccessError("Local file path is missing.")

    base_path = Path(base_dir).resolve()
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = base_path / candidate

    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        raise LocalFileAccessError("Local file does not exist.")

    roots = []
    for root_value in allowed_roots:
        root = Path(str(root_value))
        if not root.is_absolute():
            root = base_path / root
        try:
            roots.append(root.resolve(strict=True))
        except (OSError, RuntimeError):
            continue

    if not roots:
        raise LocalFileAccessError("Configured local file roots are unavailable.")

    if not any(resolved == root or root in resolved.parents for root in roots):
        raise LocalFileAccessError("Local file is outside allowed roots.")

    if not resolved.is_file():
        raise LocalFileAccessError("Local file path is not a file.")

    size = resolved.stat().st_size
    if size > max_bytes:
        raise LocalFileAccessError("Local file exceeds the 10 MB safety limit.")

    mime_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
    content = base64.b64encode(resolved.read_bytes()).decode("ascii")

    return {
        "filename": resolved.name,
        "mimeType": mime_type,
        "size": size,
        "content": content,
    }
