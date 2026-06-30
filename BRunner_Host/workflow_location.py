import json
from pathlib import Path

from app_paths import active_workflows_directory, default_workflows_directory
from atomic_io import atomic_write_json
from host_settings import load_or_create_config, save_config


class WorkflowLocationError(ValueError):
    pass


def apply_workflow_location(config_file, base_dir, target_dir, migration="use_new"):
    config = load_or_create_config(config_file, base_dir)
    current_dir = active_workflows_directory(config, base_dir)
    target = Path(target_dir).expanduser()
    if not target.is_absolute():
        target = Path(base_dir).resolve() / target
    target = target.resolve()
    ensure_writable_directory(target)

    if migration not in {"use_new", "copy", "move"}:
        raise WorkflowLocationError("Unknown workflow location migration mode.")

    migrated = 0
    if migration in {"copy", "move"} and current_dir != target:
        migrated = copy_valid_workflows(current_dir, target, remove_source=migration == "move")

    config["workflowStorage"] = {
        "mode": "custom",
        "directory": str(target),
    }
    saved = save_config(config_file, config)
    return {
        "workflowStorage": saved["workflowStorage"],
        "migrated": migrated,
        "activeDirectory": str(active_workflows_directory(saved, base_dir)),
    }


def restore_default_workflow_location(config_file, base_dir, migration="use_new"):
    target = default_workflows_directory(base_dir)
    result = apply_workflow_location(config_file, base_dir, target, migration)
    config = load_or_create_config(config_file, base_dir)
    config["workflowStorage"] = {
        "mode": "default",
        "directory": None,
    }
    saved = save_config(config_file, config)
    return {
        "workflowStorage": saved["workflowStorage"],
        "migrated": result["migrated"],
        "activeDirectory": str(active_workflows_directory(saved, base_dir)),
    }


def ensure_writable_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise WorkflowLocationError("Workflow location is not a folder.")
    probe = path / ".brunner-write-test.tmp"
    try:
        probe.write_text("ok", encoding="utf-8")
    except OSError as error:
        raise WorkflowLocationError("Workflow location is not writable.") from error
    finally:
        if probe.exists():
            probe.unlink()


def copy_valid_workflows(source_dir, target_dir, remove_source=False):
    source = Path(source_dir)
    target = Path(target_dir)
    if not source.exists():
        return 0

    count = 0
    copied_sources = []
    for path in sorted(source.iterdir()):
        if not path.is_file() or not path.name.lower().endswith(".json"):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                content = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        destination = target / path.name
        if destination.exists():
            continue
        atomic_write_json(destination, content, indent=4)
        copied_sources.append(path)
        count += 1

    if remove_source:
        for path in copied_sources:
            path.unlink()

    return count
