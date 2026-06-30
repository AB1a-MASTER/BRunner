import json
import re
from datetime import datetime, timezone
from pathlib import Path
from atomic_io import atomic_write_text


MAX_LOG_ENTRIES = 200
ALLOWED_DIAGNOSTIC_KEYS = {
    "action", "attempt", "finalReason", "maxAttempts", "status",
    "stepIndex", "timeoutMs", "variableName", "valuePath",
}


class ExecutionLogStorageError(ValueError):
    pass


def save_execution_log(logs_dir, workflow_name, run_id, entries, saved_at=None):
    """Atomically save bounded, allowlisted execution events as a .log file."""
    if not isinstance(entries, list):
        raise ExecutionLogStorageError("Execution logs must be an array.")

    safe_entries = [_sanitize_entry(entry) for entry in entries[-MAX_LOG_ENTRIES:]]
    directory = Path(logs_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    moment = saved_at or datetime.now(timezone.utc)
    timestamp = moment.strftime("%Y%m%dT%H%M%SZ")
    filename = (
        f"{_safe_stem(workflow_name, 'workflow')}-"
        f"{_safe_stem(run_id, 'run')}-{timestamp}.log"
    )
    destination = (directory / filename).resolve()
    if directory not in destination.parents:
        raise ExecutionLogStorageError("Invalid execution log destination.")

    lines = [
        "BRunner Execution Log",
        f"Workflow: {_safe_line(workflow_name, 120)}",
        f"Run ID: {_safe_line(run_id, 120)}",
        f"Saved At: {moment.astimezone(timezone.utc).isoformat()}",
        f"Events: {len(safe_entries)}",
        "",
    ]
    lines.extend(_format_entry(entry) for entry in safe_entries)
    atomic_write_text(destination, "\n".join(lines) + "\n")

    return {"filename": filename, "entries": len(safe_entries)}


def _sanitize_entry(entry):
    if not isinstance(entry, dict):
        raise ExecutionLogStorageError("Every execution log entry must be an object.")
    return {
        "timestamp": _safe_line(entry.get("timestamp"), 64),
        "status": _safe_line(entry.get("status"), 40),
        "scope": _safe_line(entry.get("scope"), 20),
        "nodeId": _safe_line(entry.get("nodeId"), 120),
        "stepIndex": entry.get("stepIndex") if isinstance(entry.get("stepIndex"), int) else -1,
        "action": _safe_line(entry.get("action"), 120),
        "message": _safe_line(entry.get("message"), 240),
        "diagnostics": _sanitize_diagnostics(entry.get("diagnostics")),
    }


def _sanitize_diagnostics(value):
    if not isinstance(value, dict):
        return None
    safe = {}
    for key, item in value.items():
        if key not in ALLOWED_DIAGNOSTIC_KEYS:
            continue
        if isinstance(item, bool) or isinstance(item, (int, float)):
            safe[key] = item
        elif isinstance(item, str):
            safe[key] = _safe_line(item, 160)
    return safe or None


def _format_entry(entry):
    target = entry["nodeId"] or "workflow"
    action = f" {entry['action']}" if entry["action"] else ""
    diagnostics = ""
    if entry["diagnostics"]:
        diagnostics = " " + json.dumps(
            entry["diagnostics"], ensure_ascii=False, sort_keys=True
        )
    return (
        f"[{entry['timestamp'] or '-'}] "
        f"{(entry['status'] or 'info').upper()} {target}{action} - "
        f"{entry['message'] or 'Execution update'}{diagnostics}"
    )


def _safe_line(value, limit):
    return re.sub(r"[\r\n\t]+", " ", str(value or "")).strip()[:limit]


def _safe_stem(value, fallback):
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", _safe_line(value, 80))
    return text.strip("._-") or fallback
