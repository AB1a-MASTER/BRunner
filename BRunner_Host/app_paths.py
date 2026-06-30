import sys
from pathlib import Path


def application_directory(anchor_file=None):
    """Return the source or packaged executable directory for persistent data."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    if anchor_file is not None:
        anchor = Path(anchor_file).resolve()
        if anchor.is_dir():
            return anchor
        return anchor.parent
    return Path(__file__).resolve().parent


def default_workflows_directory(anchor_file=None):
    return application_directory(anchor_file) / "Workflows"


def active_workflows_directory(config, anchor_file=None):
    storage = config.get("workflowStorage") if isinstance(config, dict) else {}
    if not isinstance(storage, dict):
        storage = {}
    directory = str(storage.get("directory") or "").strip()
    if storage.get("mode") == "custom" and directory:
        path = Path(directory)
        if not path.is_absolute():
            path = application_directory(anchor_file) / path
        return path.resolve()
    return default_workflows_directory(anchor_file)


def default_config_file(anchor_file=None):
    return application_directory(anchor_file) / "brunner_config.json"


def default_logs_directory(anchor_file=None):
    return application_directory(anchor_file) / "Logs"


def default_log_file(anchor_file=None):
    return application_directory(anchor_file) / "brunner_host.log"
