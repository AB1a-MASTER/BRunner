import sys
from pathlib import Path


def application_directory(anchor_file=None):
    """Return the source or packaged executable directory for persistent data."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    if anchor_file is not None:
        return Path(anchor_file).resolve().parent
    return Path(__file__).resolve().parent


def default_workflows_directory(anchor_file=None):
    return application_directory(anchor_file) / "Workflows"


def default_config_file(anchor_file=None):
    return application_directory(anchor_file) / "brunner_config.json"


def default_logs_directory(anchor_file=None):
    return application_directory(anchor_file) / "Logs"


def default_log_file(anchor_file=None):
    return application_directory(anchor_file) / "brunner_host.log"
