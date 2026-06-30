import csv
import json
import re

from file_access import LocalFileAccessError, resolve_allowed_file_path


MAX_DATA_SOURCE_BYTES = 1 * 1024 * 1024
DEFAULT_MAX_ROWS = 5000
DEFAULT_MAX_COLUMNS = 100


class DataSourceError(ValueError):
    pass


def read_data_source(config, base_dir, source):
    if not isinstance(source, dict):
        raise DataSourceError("Data source declaration is missing.")

    requested_path = source if source.get("directoryAlias") else (
        source.get("relativePath")
        or source.get("path")
        or source.get("filePath")
    )
    resolved, size = resolve_allowed_file_path(
        config,
        base_dir,
        requested_path,
        int(source.get("maxBytes") or MAX_DATA_SOURCE_BYTES),
    )
    encoding = normalize_encoding(source.get("encoding") or "utf-8-sig")
    max_rows = normalize_limit(source.get("maxRows"), DEFAULT_MAX_ROWS, "row")
    max_columns = normalize_limit(
        source.get("maxColumns"),
        DEFAULT_MAX_COLUMNS,
        "column",
    )
    fmt = normalize_format(source.get("format"), resolved.name)

    try:
        text = resolved.read_text(encoding=encoding)
    except UnicodeDecodeError:
        raise DataSourceError("Data source encoding is invalid or unsupported.")

    if fmt == "txt":
        parsed = parse_txt_list(text, max_rows)
    elif fmt == "csv":
        parsed = parse_csv(text, max_rows, max_columns, source)
    elif fmt == "json":
        parsed = parse_json(text, max_rows, max_columns)
    else:
        raise DataSourceError("Unsupported data source format.")

    return {
        "id": safe_text(source.get("id") or source.get("name") or resolved.stem),
        "name": safe_text(source.get("name") or source.get("id") or resolved.stem),
        "filename": resolved.name,
        "format": fmt,
        "size": size,
        **parsed,
    }


def parse_txt_list(text, max_rows):
    values = [
        parse_scalar(line.strip())
        for line in text.splitlines()
        if line.strip()
    ]
    if len(values) > max_rows:
        raise DataSourceError("Data source exceeds the row limit.")
    return {
        "kind": "list",
        "rows": len(values),
        "columns": 1,
        "data": values,
        "preview": f"{len(values)} items",
    }


def parse_csv(text, max_rows, max_columns, source):
    rows = list(csv.reader(text.splitlines()))
    rows = [row for row in rows if any(str(cell).strip() for cell in row)]
    if not rows:
        return empty_list()

    column_count = max(len(row) for row in rows)
    if column_count > max_columns:
        raise DataSourceError("Data source exceeds the column limit.")

    has_header = source.get("hasHeader") is not False
    shape = str(source.get("shape") or "").strip().lower()

    if not has_header:
        data_rows = rows
        if len(data_rows) > max_rows:
            raise DataSourceError("Data source exceeds the row limit.")
        if column_count == 1 or shape == "list":
            values = [parse_scalar(row[0] if row else "") for row in data_rows]
            return list_result(values)
        headers = [f"column_{index + 1}" for index in range(column_count)]
        records = [row_to_record(headers, row) for row in data_rows]
        return table_result(records, headers)

    headers = [safe_header(cell, index) for index, cell in enumerate(rows[0])]
    data_rows = rows[1:]
    if len(data_rows) > max_rows:
        raise DataSourceError("Data source exceeds the row limit.")
    if len(headers) == 1 and shape == "list":
        return list_result([parse_scalar(row[0] if row else "") for row in data_rows])
    records = [row_to_record(headers, row) for row in data_rows]
    return table_result(records, headers)


def parse_json(text, max_rows, max_columns):
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        raise DataSourceError("Data source JSON is malformed.")

    if isinstance(value, list):
        if len(value) > max_rows:
            raise DataSourceError("Data source exceeds the row limit.")
        if value and all(isinstance(item, dict) for item in value):
            headers = sorted({key for item in value for key in item.keys()})
            if len(headers) > max_columns:
                raise DataSourceError("Data source exceeds the column limit.")
            return table_result(value, headers)
        return list_result(value)

    if isinstance(value, dict):
        if len(value.keys()) > max_columns:
            raise DataSourceError("Data source exceeds the column limit.")
        return {
            "kind": "object",
            "rows": 1,
            "columns": len(value.keys()),
            "data": value,
            "preview": f"{len(value.keys())} fields",
        }

    return {
        "kind": "scalar",
        "rows": 1,
        "columns": 1,
        "data": value,
        "preview": "value available",
    }


def list_result(values):
    return {
        "kind": "list",
        "rows": len(values),
        "columns": 1,
        "data": values,
        "preview": f"{len(values)} items",
    }


def table_result(records, headers):
    return {
        "kind": "table",
        "rows": len(records),
        "columns": len(headers),
        "headers": headers,
        "data": records,
        "preview": f"{len(records)} rows",
    }


def empty_list():
    return {
        "kind": "list",
        "rows": 0,
        "columns": 1,
        "data": [],
        "preview": "0 items",
    }


def row_to_record(headers, row):
    return {
        header: parse_scalar(row[index].strip() if index < len(row) else "")
        for index, header in enumerate(headers)
    }


def parse_scalar(value):
    text = str(value).strip()
    if re.fullmatch(r"[-+]?\d+", text):
        return int(text)
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)", text):
        return float(text)
    lowered = text.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return text


def safe_header(value, index):
    text = safe_text(value)
    return text or f"column_{index + 1}"


def safe_text(value):
    return str(value or "").strip()[:120]


def normalize_format(value, filename):
    fmt = str(value or "").strip().lower().lstrip(".")
    if fmt:
        return fmt
    name = str(filename or "").lower()
    if name.endswith(".csv"):
        return "csv"
    if name.endswith(".json"):
        return "json"
    if name.endswith(".txt"):
        return "txt"
    return ""


def normalize_encoding(value):
    encoding = str(value or "").strip().lower()
    if encoding not in {"utf-8", "utf-8-sig"}:
        raise DataSourceError("Data source encoding is unsupported.")
    return encoding


def normalize_limit(value, default, label):
    if value in (None, ""):
        return default
    try:
        limit = int(value)
    except (TypeError, ValueError):
        raise DataSourceError(f"Data source {label} limit is invalid.")
    if limit < 1:
        raise DataSourceError(f"Data source {label} limit must be positive.")
    return limit
