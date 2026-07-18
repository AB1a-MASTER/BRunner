import json
import os
from pathlib import Path

from app_paths import active_workflows_directory, default_workflows_directory
from atomic_io import atomic_write_json
from host_settings import load_or_create_config, save_config


class WorkflowLocationError(ValueError):
    pass


def apply_workflow_location(config_file, base_dir, target_dir, migration="use_new"):
    target = resolve_workflow_location(base_dir, target_dir)
    return change_workflow_location(
        config_file,
        base_dir,
        target,
        migration,
        {
            "mode": "custom",
            "directory": str(target),
        },
    )


def restore_default_workflow_location(config_file, base_dir, migration="use_new"):
    target = default_workflows_directory(base_dir).resolve()
    return change_workflow_location(
        config_file,
        base_dir,
        target,
        migration,
        {
            "mode": "default",
            "directory": None,
        },
    )


def change_workflow_location(config_file, base_dir, target, migration, storage):
    if migration not in {"use_new", "copy", "move"}:
        raise WorkflowLocationError("Unknown workflow location migration mode.")

    config = load_or_create_config(config_file, base_dir)
    current_dir = active_workflows_directory(config, base_dir)
    target_existed = target.exists()
    copied = []

    try:
        ensure_writable_directory(target)
        if migration in {"copy", "move"} and current_dir != target:
            copy_valid_workflow_manifest(current_dir, target, copied)

        updated = dict(config)
        updated["workflowStorage"] = storage
        saved = save_config(config_file, updated)
    except Exception:
        rollback_copied_workflows(copied)
        remove_created_directory_if_empty(target, target_existed)
        raise

    source_cleanup_failures = []
    if migration == "move":
        for source, _destination in copied:
            try:
                source.unlink()
            except OSError:
                source_cleanup_failures.append(str(source))

    return {
        "workflowStorage": saved["workflowStorage"],
        "migrated": len(copied),
        "activeDirectory": str(active_workflows_directory(saved, base_dir)),
        "sourceCleanupFailures": source_cleanup_failures,
    }


def resolve_workflow_location(base_dir, target_dir):
    target = Path(target_dir).expanduser()
    if not target.is_absolute():
        target = Path(base_dir).resolve() / target
    return target.resolve()


def ensure_writable_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise WorkflowLocationError("Workflow location is not a folder.")
    probe = path / f".brunner-write-test.{os.getpid()}.tmp"
    try:
        probe.write_text("ok", encoding="utf-8")
    except OSError as error:
        raise WorkflowLocationError("Workflow location is not writable.") from error
    finally:
        try:
            probe.unlink()
        except OSError:
            pass


def copy_valid_workflows(source_dir, target_dir, remove_source=False):
    copied = copy_valid_workflow_manifest(source_dir, target_dir)
    if remove_source:
        for source, _destination in copied:
            source.unlink()
    return len(copied)


def copy_valid_workflow_manifest(source_dir, target_dir, copied=None):
    source = Path(source_dir)
    target = Path(target_dir)
    manifest = copied if copied is not None else []
    if not source.exists():
        return manifest

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
        manifest.append((path, destination))

    return manifest


def rollback_copied_workflows(copied):
    for _source, destination in reversed(copied):
        try:
            destination.unlink()
        except OSError:
            pass


def remove_created_directory_if_empty(target, target_existed):
    if target_existed:
        return
    try:
        target.rmdir()
    except OSError:
        pass
