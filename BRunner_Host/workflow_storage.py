import os
import secrets
import shutil
from pathlib import Path
from atomic_io import atomic_write_json


class WorkflowUpgradeError(ValueError):
    pass


def atomic_upgrade_workflow(path, content):
    """Replace a v1 workflow with v2 while retaining one immutable v1 backup."""
    workflow_path = Path(path).resolve()
    if not workflow_path.exists() or not workflow_path.is_file():
        raise WorkflowUpgradeError("Workflow file not found.")
    if not isinstance(content, dict) or content.get("schemaVersion") != 2:
        raise WorkflowUpgradeError("Upgrade content must use workflow schemaVersion 2.")
    if not isinstance(content.get("nodes"), list) or not isinstance(content.get("edges"), list):
        raise WorkflowUpgradeError("Upgrade content must contain graph nodes and edges arrays.")

    backup_path = workflow_path.with_name(f"{workflow_path.name}.v1.bak")
    if backup_path.exists():
        raise WorkflowUpgradeError("A v1 backup already exists for this workflow.")

    token = secrets.token_hex(6)
    content_temp = workflow_path.with_name(f".{workflow_path.name}.{token}.upgrade.tmp")
    backup_temp = workflow_path.with_name(f".{workflow_path.name}.{token}.backup.tmp")

    try:
        atomic_write_json(content_temp, content, indent=4)
        shutil.copyfile(workflow_path, backup_temp)
        os.replace(backup_temp, backup_path)
        os.replace(content_temp, workflow_path)
    except Exception:
        if content_temp.exists() and backup_path.exists():
            backup_path.unlink()
        raise
    finally:
        if content_temp.exists():
            content_temp.unlink()
        if backup_temp.exists():
            backup_temp.unlink()

    return {
        "filename": workflow_path.name,
        "backupFilename": backup_path.name,
    }
