import base64
import csv
import fnmatch
import io
import json
import mimetypes
from pathlib import Path

from atomic_io import atomic_write_text
from file_access import LocalFileAccessError, find_approved_directory, resolve_directory_path


MAX_FIND_RESULTS = 500
MAX_WRITE_BYTES = 10 * 1024 * 1024


class DirectoryRegistryError(ValueError):
    pass


def list_approved_directories(config, base_dir):
    directories = config.get("approvedDirectories")
    if not isinstance(directories, list):
        return []

    result = []
    for entry in directories:
        if not isinstance(entry, dict):
            continue
        item = {
            "id": str(entry.get("id") or "").strip(),
            "displayName": str(entry.get("displayName") or entry.get("id") or "").strip(),
            "path": str(entry.get("path") or "").strip(),
            "read": entry.get("read") is True,
            "write": entry.get("write") is True,
            "recursive": entry.get("recursive") is not False,
            "available": False,
        }
        try:
            item["resolvedPath"] = str(resolve_directory_path(base_dir, item["path"]))
            item["available"] = True
        except LocalFileAccessError as error:
            item["error"] = str(error)
        result.append(item)
    return result


def find_approved_files(config, base_dir, request):
    entry = require_directory(config, base_dir, request, permission="read")
    root = entry["root"]
    pattern = str(request.get("pattern") or request.get("glob") or "*").strip() or "*"
    query = str(request.get("query") or "").strip().lower()
    extensions = normalize_extensions(request.get("extensions"))
    recursive = entry["directory"].get("recursive") is not False
    max_results = normalize_limit(request.get("maxResults"), MAX_FIND_RESULTS)
    iterator = root.rglob("*") if recursive else root.glob("*")
    files = []

    for path in iterator:
        if len(files) >= max_results:
            break
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if not fnmatch.fnmatch(path.name, pattern) and not fnmatch.fnmatch(relative, pattern):
            continue
        if query and query not in path.name.lower() and query not in relative.lower():
            continue
        if extensions and path.suffix.lower().lstrip(".") not in extensions:
            continue
        stat = path.stat()
        files.append({
            "directoryAlias": entry["directory"]["id"],
            "relativePath": relative,
            "filename": path.name,
            "mimeType": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "size": stat.st_size,
            "modifiedAt": stat.st_mtime,
        })

    files.sort(key=lambda item: item["relativePath"].lower())
    return {
        "directoryAlias": entry["directory"]["id"],
        "files": files,
        "count": len(files),
        "truncated": len(files) >= max_results,
    }


def write_approved_file(config, base_dir, request):
    entry = require_directory(config, base_dir, request, permission="write")
    destination = resolve_output_path(entry["root"], entry["directory"], request)
    content = request.get("content", "")
    encoding = str(request.get("encoding") or "utf-8").strip().lower()
    if encoding not in {"utf-8", "utf-8-sig"}:
        raise DirectoryRegistryError("Output encoding is unsupported.")

    if request.get("base64") is True or request.get("contentEncoding") == "base64":
        try:
            raw = base64.b64decode(str(content or ""), validate=True)
        except Exception as error:
            raise DirectoryRegistryError("Base64 output content is invalid.") from error
        if len(raw) > MAX_WRITE_BYTES:
            raise DirectoryRegistryError("Output file exceeds the safety limit.")
        atomic_write_bytes(destination, raw)
    else:
        text = str(content or "")
        if len(text.encode(encoding)) > MAX_WRITE_BYTES:
            raise DirectoryRegistryError("Output file exceeds the safety limit.")
        atomic_write_text(destination, text)

    return file_write_result(entry["directory"]["id"], entry["root"], destination)


def export_data_file(config, base_dir, request):
    data = request.get("data")
    fmt = str(request.get("format") or "").strip().lower().lstrip(".")
    if not fmt:
        name = str(request.get("relativePath") or request.get("path") or "")
        fmt = Path(name).suffix.lower().lstrip(".")

    if fmt == "json":
        content = json.dumps(data, ensure_ascii=False, indent=2)
    elif fmt == "csv":
        content = serialize_csv(data)
    elif fmt in {"txt", "text"}:
        content = serialize_text(data)
    else:
        raise DirectoryRegistryError("Unsupported export format.")

    write_request = dict(request)
    write_request["content"] = content
    write_request["encoding"] = request.get("encoding") or "utf-8"
    result = write_approved_file(config, base_dir, write_request)
    result["format"] = "txt" if fmt == "text" else fmt
    return result


def require_directory(config, base_dir, request, permission):
    if not isinstance(request, dict):
        raise DirectoryRegistryError("Directory request is missing.")
    alias = str(request.get("directoryAlias") or request.get("alias") or "").strip()
    if not alias:
        raise DirectoryRegistryError("Approved directory alias is missing.")
    directory = find_approved_directory(config, alias)
    if not directory:
        raise DirectoryRegistryError("Approved directory alias is unavailable.")
    if directory.get(permission) is not True:
        raise DirectoryRegistryError(f"Approved directory does not allow {permission}s.")
    return {
        "directory": directory,
        "root": resolve_directory_path(base_dir, directory.get("path")),
    }


def resolve_output_path(root, directory, request):
    relative_path = str(
        request.get("relativePath")
        or request.get("path")
        or request.get("filePath")
        or ""
    ).strip()
    if not relative_path:
        raise DirectoryRegistryError("Output file path is missing.")
    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise DirectoryRegistryError("Output file path must be relative.")
    destination = (root / candidate).resolve(strict=False)
    if destination == root or root not in destination.parents:
        raise DirectoryRegistryError("Output file is outside approved directory.")
    if directory.get("recursive") is False and destination.parent != root:
        raise DirectoryRegistryError("Approved directory does not allow recursive access.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return destination


def atomic_write_bytes(destination, content):
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{id(content)}.tmp")
    try:
        with open(temp_path, "wb") as handle:
            handle.write(content)
            handle.flush()
            import os
            os.fsync(handle.fileno())
        temp_path.replace(path)
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass


def file_write_result(alias, root, destination):
    stat = destination.stat()
    return {
        "directoryAlias": alias,
        "relativePath": destination.relative_to(root).as_posix(),
        "filename": destination.name,
        "mimeType": mimetypes.guess_type(destination.name)[0] or "application/octet-stream",
        "size": stat.st_size,
        "modifiedAt": stat.st_mtime,
    }


def serialize_csv(data):
    rows = data if isinstance(data, list) else []
    output = io.StringIO()
    if rows and all(isinstance(row, dict) for row in rows):
        headers = sorted({key for row in rows for key in row.keys()})
        writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()
    writer = csv.writer(output, lineterminator="\n")
    for row in rows:
        if isinstance(row, (list, tuple)):
            writer.writerow(row)
        else:
            writer.writerow([row])
    return output.getvalue()


def serialize_text(data):
    if isinstance(data, list):
        return "\n".join(str(item) for item in data)
    if isinstance(data, dict):
        return json.dumps(data, ensure_ascii=False, indent=2)
    return str(data if data is not None else "")


def normalize_extensions(value):
    values = value if isinstance(value, list) else [value] if value else []
    return {
        str(item or "").strip().lower().lstrip(".")
        for item in values
        if str(item or "").strip()
    }


def normalize_limit(value, default):
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return default
    return max(1, min(limit, MAX_FIND_RESULTS))
