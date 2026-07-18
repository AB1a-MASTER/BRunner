import base64
import mimetypes
from pathlib import Path


MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024


class LocalFileAccessError(ValueError):
    pass


CANONICAL_LOCAL_FILE_REQUEST_ERROR = (
    "Local file request requires directoryAlias and relativePath; "
    "legacy raw paths are not accepted."
)


def resolve_allowed_file_path(config, base_dir, requested_path, max_bytes=MAX_LOCAL_FILE_BYTES):
    if isinstance(requested_path, dict):
        return resolve_approved_directory_file(
            config,
            base_dir,
            requested_path,
            max_bytes,
        )

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

    if isinstance(config, dict) and "approvedDirectories" in config:
        require_approved_path_read(config, base_path, resolved)
    else:
        require_legacy_path_read(config, base_path, resolved)

    if not resolved.is_file():
        raise LocalFileAccessError("Local file path is not a file.")

    size = resolved.stat().st_size
    if size > max_bytes:
        raise LocalFileAccessError("Local file exceeds the safety limit.")

    return resolved, size


def require_approved_path_read(config, base_path, resolved):
    directories = config.get("approvedDirectories")
    if not isinstance(directories, list) or not directories:
        raise LocalFileAccessError("Local file access has no approved directories.")

    matching = []
    readable = []
    for directory in directories:
        if not isinstance(directory, dict):
            continue
        try:
            root = resolve_directory_path(base_path, directory.get("path"))
        except LocalFileAccessError:
            continue
        if resolved != root and root not in resolved.parents:
            continue
        matching.append(directory)
        if directory.get("read") is not True:
            continue
        readable.append(directory)
        if (
            directory.get("recursive") is not False
            or resolved == root
            or resolved.parent == root
        ):
            return

    if not matching:
        raise LocalFileAccessError("Local file is outside approved directories.")
    if not readable:
        raise LocalFileAccessError("Approved directory does not allow reads.")
    raise LocalFileAccessError("Approved directory does not allow recursive access.")


def require_legacy_path_read(config, base_path, resolved):
    access = config.get("local_file_access") if isinstance(config, dict) else None
    if not isinstance(access, dict) or access.get("enabled") is not True:
        raise LocalFileAccessError("Local file access is disabled in host config.")

    allowed_roots = access.get("allowed_roots")
    if not isinstance(allowed_roots, list) or not allowed_roots:
        raise LocalFileAccessError("Local file access has no allowed roots.")

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


def resolve_approved_directory_file(config, base_dir, request, max_bytes=MAX_LOCAL_FILE_BYTES):
    alias = str(request.get("directoryAlias") or "").strip()
    relative_path = str(request.get("relativePath") or "").strip()

    if not alias or not relative_path:
        raise LocalFileAccessError(CANONICAL_LOCAL_FILE_REQUEST_ERROR)

    directory = find_approved_directory(config, alias)
    if not directory:
        raise LocalFileAccessError("Approved directory alias is unavailable.")
    if directory.get("read") is not True:
        raise LocalFileAccessError("Approved directory does not allow reads.")

    root = resolve_directory_path(base_dir, directory.get("path"))
    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise LocalFileAccessError("Approved directory file path must be relative.")

    try:
        resolved = (root / candidate).resolve(strict=True)
    except (OSError, RuntimeError):
        raise LocalFileAccessError("Local file does not exist.")

    if resolved == root or root not in resolved.parents:
        raise LocalFileAccessError("Local file is outside approved directory.")

    if directory.get("recursive") is False and resolved.parent != root:
        raise LocalFileAccessError("Approved directory does not allow recursive access.")

    if not resolved.is_file():
        raise LocalFileAccessError("Local file path is not a file.")

    size = resolved.stat().st_size
    if size > max_bytes:
        raise LocalFileAccessError("Local file exceeds the safety limit.")

    return resolved, size


def find_approved_directory(config, alias):
    directories = config.get("approvedDirectories")
    if not isinstance(directories, list):
        return None
    for entry in directories:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("id") or "").strip() == alias:
            return entry
    return None


def resolve_directory_path(base_dir, value):
    raw_path = str(value or "").strip()
    if not raw_path:
        raise LocalFileAccessError("Approved directory path is missing.")
    root = Path(raw_path)
    if not root.is_absolute():
        root = Path(base_dir).resolve() / root
    try:
        resolved = root.resolve(strict=True)
    except (OSError, RuntimeError):
        raise LocalFileAccessError("Approved directory is unavailable.")
    if not resolved.is_dir():
        raise LocalFileAccessError("Approved directory path is not a folder.")
    return resolved


def read_allowed_file(config, base_dir, requested_path, max_bytes=MAX_LOCAL_FILE_BYTES):
    resolved, size = resolve_allowed_file_path(
        config,
        base_dir,
        requested_path,
        max_bytes,
    )

    mime_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
    content = base64.b64encode(resolved.read_bytes()).decode("ascii")

    return {
        "filename": resolved.name,
        "mimeType": mime_type,
        "size": size,
        "content": content,
    }
