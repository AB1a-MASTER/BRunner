import re
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from atomic_io import atomic_write_json


class MapperRepositoryError(ValueError):
    pass


MAX_MAPPER_STATE_BYTES = 1_000_000
MAX_MAPPER_CONFLICTS = 20


class MapperRepository:
    def __init__(self, workflows_dir):
        self.maps_dir = Path(workflows_dir).resolve() / "MapperMaps"
        self.maps_dir.mkdir(parents=True, exist_ok=True)

    def workflow_id_to_filename(self, workflow_id):
        text = str(workflow_id or "").strip()
        if not text:
            raise MapperRepositoryError("Missing workflow id.")
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("._")
        if not safe:
            raise MapperRepositoryError("Invalid workflow id.")
        return f"{safe[:120]}.mapper.json"

    def state_path(self, workflow_id):
        path = (self.maps_dir / self.workflow_id_to_filename(workflow_id)).resolve()
        if self.maps_dir not in path.parents and path != self.maps_dir:
            raise MapperRepositoryError("Invalid mapper path.")
        return path

    def list_states(self):
        self.maps_dir.mkdir(parents=True, exist_ok=True)
        states = {}
        for path in sorted(self.maps_dir.glob("*.mapper.json")):
            state = self._read_state(path)
            workflow_id = str(state.get("workflowId") or "").strip()
            if workflow_id:
                states[workflow_id] = state
        return states

    def get_state(self, workflow_id):
        path = self.state_path(workflow_id)
        if not path.exists():
            return None
        return self._read_state(path)

    def save_state(self, workflow_id, state):
        if not isinstance(state, dict):
            raise MapperRepositoryError("Mapper state must be an object.")
        path = self.state_path(workflow_id)
        now = datetime.now(timezone.utc).isoformat()
        previous = self._read_state(path) if path.exists() else {}
        previous_storage = previous.get("storage") if isinstance(previous.get("storage"), dict) else {}
        incoming_storage = state.get("storage") if isinstance(state.get("storage"), dict) else {}
        previous_revision = str(previous_storage.get("revision") or "").strip()
        incoming_revision = str(incoming_storage.get("revision") or "").strip()
        conflicts = list(incoming_storage.get("conflicts") or [])
        if previous_revision and incoming_revision and previous_revision != incoming_revision:
            conflicts.append({
                "type": "last_write_wins",
                "workflowId": str(workflow_id or state.get("workflowId") or "").strip(),
                "previousRevision": previous_revision,
                "nextRevision": incoming_revision,
                "detectedAt": now,
                "resolvedBy": "native_mapper_repository",
                "detail": "Incoming mapper state was saved over a newer on-disk revision.",
            })

        content = {
            **state,
            "workflowId": str(workflow_id or state.get("workflowId") or "").strip(),
            "updatedAt": now,
        }
        if not content["workflowId"]:
            raise MapperRepositoryError("Missing workflow id.")

        content["storage"] = {
            **incoming_storage,
            "provider": "native",
            "savedAt": now,
            "lastWriter": "native_host",
            "conflictPolicy": "last_write_wins",
            "conflicts": conflicts[-MAX_MAPPER_CONFLICTS:],
        }
        content["storage"]["revision"] = self._state_revision(content)
        self._validate_state_size(content)
        atomic_write_json(path, content, indent=2)
        return content

    def delete_state(self, workflow_id):
        path = self.state_path(workflow_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    def _read_state(self, path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                content = json.load(handle)
        except Exception as exc:
            raise MapperRepositoryError(f"Could not read mapper state: {exc}") from exc
        return content if isinstance(content, dict) else {}

    def _validate_state_size(self, state):
        size = len(json.dumps(state, ensure_ascii=True, sort_keys=True).encode("utf-8"))
        if size > MAX_MAPPER_STATE_BYTES:
            raise MapperRepositoryError(
                f"Mapper state is too large ({size} bytes; max {MAX_MAPPER_STATE_BYTES})."
            )

    def _state_revision(self, state):
        comparable = dict(state)
        storage = comparable.get("storage") if isinstance(comparable.get("storage"), dict) else {}
        comparable["storage"] = {
            key: value
            for key, value in storage.items()
            if key != "revision"
        }
        payload = json.dumps(comparable, ensure_ascii=True, sort_keys=True).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:24]
