import json
from datetime import datetime, timezone
from pathlib import Path

from atomic_io import atomic_write_json
from workflow_storage import atomic_upgrade_workflow


class WorkflowRepositoryError(ValueError):
    pass


class WorkflowRepository:
    def __init__(self, workflows_dir):
        self.workflows_dir = Path(workflows_dir).resolve()
        self.workflows_dir.mkdir(parents=True, exist_ok=True)

    def sanitize_filename(self, filename):
        if not filename:
            raise WorkflowRepositoryError("Missing filename.")

        name = Path(str(filename)).name
        if not name.lower().endswith(".json"):
            name += ".json"

        if name in [".json", "..json"]:
            raise WorkflowRepositoryError("Invalid filename.")

        return name

    def workflow_path(self, filename):
        safe_name = self.sanitize_filename(filename)
        path = (self.workflows_dir / safe_name).resolve()
        if self.workflows_dir not in path.parents and path != self.workflows_dir:
            raise WorkflowRepositoryError("Invalid workflow path.")
        return path

    def list_workflows(self):
        self.workflows_dir.mkdir(parents=True, exist_ok=True)
        return sorted([
            path.name
            for path in self.workflows_dir.iterdir()
            if path.is_file() and path.name.lower().endswith(".json")
        ])

    def list_workflow_summaries(self):
        return [
            self._summary_for_path(self.workflow_path(filename))
            for filename in self.list_workflows()
        ]

    def load_workflow(self, filename):
        path = self.workflow_path(filename)
        if not path.exists():
            raise WorkflowRepositoryError("File not found.")
        with open(path, "r", encoding="utf-8") as handle:
            content = json.load(handle)
        return {"filename": path.name, "content": content}

    def save_workflow(self, filename, content):
        path = self.workflow_path(filename)
        atomic_write_json(path, content, indent=4)
        return {"filename": path.name}

    def delete_workflow(self, filename):
        path = self.workflow_path(filename)
        if not path.exists():
            raise WorkflowRepositoryError("File not found.")
        path.unlink()
        return {"filename": path.name}

    def duplicate_workflow(self, filename, new_filename):
        original_path = self.workflow_path(filename)
        new_path = self.workflow_path(new_filename)

        if not original_path.exists():
            raise WorkflowRepositoryError("Original workflow not found.")
        if new_path.exists():
            raise WorkflowRepositoryError("Target workflow already exists.")

        with open(original_path, "r", encoding="utf-8") as handle:
            content = json.load(handle)
        atomic_write_json(new_path, content, indent=4)
        return {"filename": original_path.name, "newFilename": new_path.name}

    def rename_workflow(self, filename, new_filename, content=None):
        original_path = self.workflow_path(filename)
        new_path = self.workflow_path(new_filename)

        if not original_path.exists():
            raise WorkflowRepositoryError("Original workflow not found.")
        if original_path != new_path and new_path.exists():
            raise WorkflowRepositoryError("A workflow with the new name already exists.")

        if content is None:
            with open(original_path, "r", encoding="utf-8") as handle:
                content = json.load(handle)

        atomic_write_json(new_path, content, indent=4)
        if original_path != new_path:
            original_path.unlink()
        return {"filename": original_path.name, "newFilename": new_path.name}

    def upgrade_workflow(self, filename, content):
        return atomic_upgrade_workflow(self.workflow_path(filename), content)

    def _summary_for_path(self, path):
        content = None
        try:
            with open(path, "r", encoding="utf-8") as handle:
                content = json.load(handle)
        except (OSError, json.JSONDecodeError):
            content = {}

        if not isinstance(content, dict):
            content = {}

        metadata = content.get("metadata") if isinstance(content.get("metadata"), dict) else {}
        stat = path.stat()
        updated_at = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
        display_name = (
            content.get("name")
            or metadata.get("name")
            or metadata.get("displayName")
            or path.stem
        )
        tags = content.get("tags") if isinstance(content.get("tags"), list) else metadata.get("tags")
        if not isinstance(tags, list):
            tags = []

        return {
            "id": str(content.get("id") or metadata.get("id") or path.stem),
            "filename": path.name,
            "displayName": str(display_name),
            "schemaVersion": content.get("schemaVersion", 1),
            "createdAt": content.get("createdAt") or metadata.get("createdAt") or None,
            "updatedAt": content.get("updatedAt") or metadata.get("updatedAt") or updated_at,
            "revision": content.get("revision") or metadata.get("revision") or None,
            "tags": [str(tag) for tag in tags],
            "enabled": content.get("enabled") is not False,
        }
