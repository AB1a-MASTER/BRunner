import asyncio
import websockets
import json
import pyautogui
import os
import secrets
import logging
import shutil
from pathlib import Path
from file_access import read_allowed_file
from data_source import read_data_source
from workflow_storage import atomic_upgrade_workflow
from execution_log_storage import save_execution_log
from host_settings import load_or_create_config

# --- Paths ---

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "brunner_config.json"
WORKFLOWS_DIR = BASE_DIR / "Workflows"
EXECUTION_LOGS_DIR = BASE_DIR / "Logs"
LOG_FILE = BASE_DIR / "brunner_host.log"
config = load_or_create_config(CONFIG_FILE, BASE_DIR)
PORT = config["port"]

WORKFLOWS_DIR.mkdir(exist_ok=True)
EXECUTION_LOGS_DIR.mkdir(exist_ok=True)

# --- Setup Persistent Logging ---

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)

# --- Authentication & Setup ---


PAIRING_KEY = config["pairing_key"]

logging.info("========================================")
logging.info(" BRunner Native OS Host Started")
logging.info(f" Listening on ws://localhost:{PORT}")
logging.info("========================================")
logging.info(f" YOUR PAIRING KEY: {PAIRING_KEY}")
logging.info("========================================")


# --- Helpers ---


def get_payload(data):
    """
    Supports both protocol shapes:

    Old:
      { "command": "SAVE_WORKFLOW", "payload": { "filename": "x.json" } }

    New:
      { "id": "1", "command": "SAVE_WORKFLOW", "filename": "x.json" }
    """
    payload = data.get("payload")

    if isinstance(payload, dict):
        merged = dict(data)
        merged.update(payload)
        return merged

    return data


def response(request_id=None, status="success", **kwargs):
    body = {
        "status": status
    }

    if request_id is not None:
        body["id"] = request_id

    body.update(kwargs)
    return json.dumps(body)


def success(request_id=None, **kwargs):
    return response(request_id=request_id, status="success", **kwargs)


def failure(request_id=None, error="Unknown error", status="failed"):
    return response(request_id=request_id, status=status, error=str(error))


def sanitize_filename(filename):
    if not filename:
        raise ValueError("Missing filename.")

    name = os.path.basename(str(filename))

    if not name.lower().endswith(".json"):
        name += ".json"

    if name in [".json", "..json"]:
        raise ValueError("Invalid filename.")

    return name


def workflow_path(filename):
    safe_name = sanitize_filename(filename)
    path = WORKFLOWS_DIR / safe_name

    # Safety check against traversal tricks.
    resolved = path.resolve()
    if WORKFLOWS_DIR.resolve() not in resolved.parents and resolved != WORKFLOWS_DIR.resolve():
        raise ValueError("Invalid workflow path.")

    return resolved


def parse_keys(raw_keys):
    """
    Accepts:
      "enter"
      "ctrl+l"
      "ctrl+shift+s"
      ["ctrl", "l"]

    Returns a normalized list usable by pyautogui.
    """
    if isinstance(raw_keys, list):
        return [str(k).strip().lower() for k in raw_keys if str(k).strip()]

    text = str(raw_keys or "").strip().lower()

    if not text:
        raise ValueError("Missing key sequence.")

    aliases = {
        "control": "ctrl",
        "cmd": "command",
        "return": "enter",
        "esc": "escape"
    }

    parts = [p.strip() for p in text.replace(" ", "").split("+") if p.strip()]
    return [aliases.get(p, p) for p in parts]


async def send_json(websocket, body):
    await websocket.send(body)


# --- Command Handlers ---


async def handle_auth(websocket, request_id, payload):
    client_key = payload.get("key") or payload.get("pairing_key")

    if client_key == PAIRING_KEY:
        await send_json(
            websocket,
            success(request_id, message="Authenticated successfully.")
        )
        logging.info("[Auth] Extension connected and authenticated securely.")
        return True

    await send_json(
        websocket,
        failure(request_id, "Invalid Pairing Key.")
    )
    logging.warning("[Auth] Blocked connection attempt with invalid key.")
    return False


async def handle_os_keystroke(websocket, request_id, payload):
    raw_keys = (
        payload.get("keys")
        or payload.get("key")
        or payload.get("value")
        or payload.get("text")
    )

    keys = parse_keys(raw_keys)

    logging.info(f"[Hardware] Dispatching OS keystroke: {keys}")

    if len(keys) == 1:
        pyautogui.press(keys[0])
    else:
        pyautogui.hotkey(*keys)

    await send_json(
        websocket,
        success(
            request_id,
            strategy="Python_OS_Hardware",
            keys=keys
        )
    )

    logging.info(f"[Hardware] Keystroke executed successfully: {keys}")


async def handle_read_file(websocket, request_id, payload):
    file_data = read_allowed_file(
        config,
        BASE_DIR,
        payload.get("path") or payload.get("filePath")
    )

    await send_json(
        websocket,
        success(request_id, **file_data)
    )

    logging.info(
        "[File] Read approved local file: name=%s size=%s",
        file_data["filename"],
        file_data["size"]
    )


async def handle_read_data_source(websocket, request_id, payload):
    result = read_data_source(
        config,
        BASE_DIR,
        payload.get("source") or payload,
    )

    await send_json(
        websocket,
        success(request_id, **result)
    )

    logging.info(
        "[DataSource] Read approved data source: name=%s format=%s rows=%s",
        result["filename"],
        result["format"],
        result["rows"]
    )


async def handle_list_workflows(websocket, request_id):
    WORKFLOWS_DIR.mkdir(exist_ok=True)

    files = sorted([
        path.name
        for path in WORKFLOWS_DIR.iterdir()
        if path.is_file() and path.name.lower().endswith(".json")
    ])

    await send_json(
        websocket,
        success(request_id, files=files)
    )


async def handle_save_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    content = payload.get("content")

    if content is None:
        content = payload.get("workflow")

    path = workflow_path(filename)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=4)

    await send_json(
        websocket,
        success(request_id, filename=path.name)
    )


async def handle_save_execution_log(websocket, request_id, payload):
    logs = payload.get("logs") if "logs" in payload else []
    result = save_execution_log(
        EXECUTION_LOGS_DIR,
        payload.get("workflowName") or "Untitled",
        payload.get("runId") or "run",
        logs,
    )
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[ExecutionLog] Saved: filename=%s entries=%s",
        result["filename"],
        result["entries"],
    )


async def handle_upgrade_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    content = payload.get("content")
    result = atomic_upgrade_workflow(workflow_path(filename), content)

    await send_json(
        websocket,
        success(request_id, **result)
    )


async def handle_load_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    path = workflow_path(filename)

    if not path.exists():
        await send_json(
            websocket,
            failure(request_id, "File not found.")
        )
        return

    with open(path, "r", encoding="utf-8") as f:
        content = json.load(f)

    await send_json(
        websocket,
        success(request_id, filename=path.name, content=content)
    )


async def handle_delete_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    path = workflow_path(filename)

    if not path.exists():
        await send_json(
            websocket,
            failure(request_id, "File not found.")
        )
        return

    path.unlink()

    await send_json(
        websocket,
        success(request_id, filename=path.name)
    )


async def handle_duplicate_workflow(websocket, request_id, payload):
    original = payload.get("filename")
    new_name = (
        payload.get("newFilename")
        or payload.get("new_filename")
        or payload.get("targetFilename")
    )

    original_path = workflow_path(original)
    new_path = workflow_path(new_name)

    if not original_path.exists():
        await send_json(
            websocket,
            failure(request_id, "Original workflow not found.")
        )
        return

    if new_path.exists():
        await send_json(
            websocket,
            failure(request_id, "Target workflow already exists.")
        )
        return

    shutil.copyfile(original_path, new_path)

    await send_json(
        websocket,
        success(
            request_id,
            filename=original_path.name,
            newFilename=new_path.name
        )
    )


async def handle_rename_workflow(websocket, request_id, payload):
    original = payload.get("filename")
    new_name = (
        payload.get("newFilename")
        or payload.get("new_filename")
        or payload.get("targetFilename")
    )
    content = payload.get("content")

    original_path = workflow_path(original)
    new_path = workflow_path(new_name)

    if not original_path.exists():
        await send_json(
            websocket,
            failure(request_id, "Original workflow not found.")
        )
        return

    if original_path != new_path and new_path.exists():
        await send_json(
            websocket,
            failure(request_id, "A workflow with the new name already exists.")
        )
        return

    if content is None:
        with open(original_path, "r", encoding="utf-8") as f:
            content = json.load(f)

    token = secrets.token_hex(6)
    temp_path = WORKFLOWS_DIR / f".{new_path.name}.{token}.tmp"
    backup_path = WORKFLOWS_DIR / f".{original_path.name}.{token}.bak"

    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(content, f, indent=4)

        if original_path == new_path:
            os.replace(temp_path, original_path)
        else:
            original_path.rename(backup_path)

            try:
                os.replace(temp_path, new_path)
                backup_path.unlink()
            except Exception:
                if new_path.exists():
                    new_path.unlink()
                backup_path.rename(original_path)
                raise
    finally:
        if temp_path.exists():
            temp_path.unlink()

    await send_json(
        websocket,
        success(
            request_id,
            filename=original_path.name,
            newFilename=new_path.name
        )
    )


# --- WebSocket Command Router ---


async def handle_connection(websocket):
    authenticated = False
    remote_ip = websocket.remote_address[0] if websocket.remote_address else "unknown"

    logging.info(f"[Network] New connection attempt from {remote_ip}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                await send_json(websocket, failure(error="Invalid JSON."))
                continue

            request_id = data.get("id")
            command = data.get("command", "UNKNOWN")
            payload = get_payload(data)

            logging.info(
                "[Inbound] Command: %s | Request ID: %s",
                command,
                request_id or "none"
            )

            if command == "AUTH":
                authenticated = await handle_auth(websocket, request_id, payload)
                continue

            if not authenticated:
                await send_json(
                    websocket,
                    failure(request_id, "Not authenticated.")
                )
                logging.warning(
                    f"[Security] Rejected unauthenticated command: {command}")
                continue

            try:
                if command == "OS_KEYSTROKE":
                    await handle_os_keystroke(websocket, request_id, payload)

                elif command == "READ_FILE":
                    await handle_read_file(websocket, request_id, payload)

                elif command == "READ_DATA_SOURCE":
                    await handle_read_data_source(websocket, request_id, payload)

                elif command == "LIST_WORKFLOWS":
                    await handle_list_workflows(websocket, request_id)

                elif command == "SAVE_WORKFLOW":
                    await handle_save_workflow(websocket, request_id, payload)

                elif command == "SAVE_EXECUTION_LOG":
                    await handle_save_execution_log(websocket, request_id, payload)

                elif command == "UPGRADE_WORKFLOW":
                    await handle_upgrade_workflow(websocket, request_id, payload)

                elif command == "LOAD_WORKFLOW":
                    await handle_load_workflow(websocket, request_id, payload)

                elif command == "DELETE_WORKFLOW":
                    await handle_delete_workflow(websocket, request_id, payload)

                elif command == "DUPLICATE_WORKFLOW":
                    await handle_duplicate_workflow(websocket, request_id, payload)

                elif command == "RENAME_WORKFLOW":
                    await handle_rename_workflow(websocket, request_id, payload)

                else:
                    await send_json(
                        websocket,
                        failure(
                            request_id,
                            f"Unknown command: {command}",
                            status="error"
                        )
                    )
                    logging.warning(
                        f"[Router] Unhandled command received: {command}")

            except Exception as e:
                error_msg = str(e)
                await send_json(websocket, failure(request_id, error_msg))
                logging.error(f"[Command] {command} failed: {error_msg}")

    except websockets.exceptions.ConnectionClosed:
        logging.info("[Network] Extension disconnected.")

    except Exception as e:
        logging.error(f"[System] Unexpected error: {str(e)}")


async def main():
    async with websockets.serve(handle_connection, "localhost", PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
