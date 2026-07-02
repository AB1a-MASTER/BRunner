import asyncio
import websockets
import json
import pyautogui
import logging
from app_paths import (
    active_workflows_directory,
    application_directory,
    default_config_file,
    default_log_file,
    default_logs_directory,
)
from file_access import read_allowed_file
from data_source import read_data_source
from directory_registry import (
    export_data_file,
    find_approved_files,
    list_approved_directories,
    write_approved_file,
)
from fallback_input import execute_host_action
from visual_match import execute_visual_match_action
from workflow_repository import WorkflowRepository
from execution_log_storage import save_execution_log
from host_settings import load_or_create_config
from window_validation import HostFallbackError, host_window_status

# --- Paths ---

BASE_DIR = application_directory(__file__)
CONFIG_FILE = default_config_file(__file__)
EXECUTION_LOGS_DIR = default_logs_directory(__file__)
LOG_FILE = default_log_file(__file__)
config = load_or_create_config(CONFIG_FILE, BASE_DIR)
PORT = config["port"]
WORKFLOWS_DIR = active_workflows_directory(config, BASE_DIR)
WORKFLOW_REPOSITORY = WorkflowRepository(WORKFLOWS_DIR)
HOST_VERSION = "0.1.0"
PROTOCOL_VERSION = 2
SUPPORTED_CAPABILITIES = [
    "host.hello",
    "workflow.list",
    "workflow.load",
    "workflow.save",
    "workflow.delete",
    "workflow.duplicate",
    "workflow.rename",
    "workflow.upgrade",
    "host.window",
    "host.action",
    "host.visual_match",
    "os.keystroke",
    "local_file.read",
    "approved_directory.list",
    "approved_file.find",
    "approved_file.write",
    "data_file.export",
    "data_source.read",
    "execution_log.save",
]

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


def current_config():
    global config
    config = load_or_create_config(CONFIG_FILE, BASE_DIR)
    return config


def host_hello_payload():
    settings = current_config()
    host = settings.get("host") if isinstance(settings.get("host"), dict) else {}
    approved = settings.get("approvedDirectories")
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "host": {
            "name": "BRunner Native Host",
            "version": HOST_VERSION,
            "port": host.get("port") or settings.get("port") or PORT,
        },
        "capabilities": list(SUPPORTED_CAPABILITIES),
        "status": {
            "workflowStorageMode": (
                settings.get("workflowStorage", {}).get("mode")
                if isinstance(settings.get("workflowStorage"), dict)
                else "default"
            ),
            "approvedDirectoryCount": len(approved) if isinstance(approved, list) else 0,
        },
    }


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


async def handle_host_hello(websocket, request_id, protocol_version=None):
    payload = host_hello_payload()
    host_status = payload.pop("status", None)
    if host_status is not None:
        payload["hostStatus"] = host_status
    if protocol_version == 2:
        payload["requestId"] = request_id
    await send_json(
        websocket,
        success(request_id, **payload)
    )
    logging.info("[Protocol] host.hello returned %s capabilities", len(payload["capabilities"]))


async def handle_host_window(websocket, request_id, payload, protocol_version=None):
    result = host_window_status(current_config(), payload)
    if protocol_version == 2:
        result["requestId"] = request_id
    await send_json(websocket, success(request_id, **result))
    logging.info("[Fallback] host.window returned foreground-window status")


async def handle_host_action(websocket, request_id, payload, protocol_version=None):
    result = execute_host_action(current_config(), payload)
    if protocol_version == 2:
        result["requestId"] = request_id
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[Fallback] host.action performed: %s x=%s y=%s confidence=%s",
        result["action"],
        result.get("x"),
        result.get("y"),
        result.get("coordinateConfidence"),
    )


async def handle_host_visual_match(websocket, request_id, payload, protocol_version=None):
    result = execute_visual_match_action(current_config(), payload)
    if protocol_version == 2:
        result["requestId"] = request_id
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[Fallback] host.visual_match performed: %s x=%s y=%s confidence=%s",
        result["action"],
        result.get("x"),
        result.get("y"),
        result.get("matchConfidence"),
    )


async def handle_read_file(websocket, request_id, payload):
    file_data = read_allowed_file(
        current_config(),
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
        current_config(),
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


async def handle_list_approved_directories(websocket, request_id):
    directories = list_approved_directories(current_config(), BASE_DIR)
    await send_json(
        websocket,
        success(request_id, directories=directories)
    )


async def handle_find_approved_files(websocket, request_id, payload):
    result = find_approved_files(
        current_config(),
        BASE_DIR,
        payload.get("request") if isinstance(payload.get("request"), dict) else payload,
    )
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[Directory] Listed approved files: alias=%s count=%s",
        result["directoryAlias"],
        result["count"],
    )


async def handle_write_approved_file(websocket, request_id, payload):
    result = write_approved_file(
        current_config(),
        BASE_DIR,
        payload.get("request") if isinstance(payload.get("request"), dict) else payload,
    )
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[Directory] Wrote approved file: alias=%s name=%s size=%s",
        result["directoryAlias"],
        result["filename"],
        result["size"],
    )


async def handle_export_data_file(websocket, request_id, payload):
    result = export_data_file(
        current_config(),
        BASE_DIR,
        payload.get("request") if isinstance(payload.get("request"), dict) else payload,
    )
    await send_json(websocket, success(request_id, **result))
    logging.info(
        "[Directory] Exported approved data: alias=%s name=%s format=%s",
        result["directoryAlias"],
        result["filename"],
        result["format"],
    )


async def handle_list_workflows(websocket, request_id):
    await send_json(
        websocket,
        success(request_id, files=WORKFLOW_REPOSITORY.list_workflows())
    )


async def handle_save_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    content = payload.get("content")

    if content is None:
        content = payload.get("workflow")

    result = WORKFLOW_REPOSITORY.save_workflow(filename, content)

    await send_json(
        websocket,
        success(request_id, **result)
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
    result = WORKFLOW_REPOSITORY.upgrade_workflow(filename, content)

    await send_json(
        websocket,
        success(request_id, **result)
    )


async def handle_load_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    result = WORKFLOW_REPOSITORY.load_workflow(filename)
    await send_json(
        websocket,
        success(request_id, **result)
    )


async def handle_delete_workflow(websocket, request_id, payload):
    filename = payload.get("filename")
    result = WORKFLOW_REPOSITORY.delete_workflow(filename)
    await send_json(
        websocket,
        success(request_id, **result)
    )


async def handle_duplicate_workflow(websocket, request_id, payload):
    original = payload.get("filename")
    new_name = (
        payload.get("newFilename")
        or payload.get("new_filename")
        or payload.get("targetFilename")
    )

    result = WORKFLOW_REPOSITORY.duplicate_workflow(original, new_name)
    await send_json(
        websocket,
        success(request_id, **result)
    )


async def handle_rename_workflow(websocket, request_id, payload):
    original = payload.get("filename")
    new_name = (
        payload.get("newFilename")
        or payload.get("new_filename")
        or payload.get("targetFilename")
    )
    content = payload.get("content")

    result = WORKFLOW_REPOSITORY.rename_workflow(original, new_name, content)
    await send_json(
        websocket,
        success(request_id, **result)
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

            protocol_version = data.get("protocolVersion")
            request_id = data.get("requestId") or data.get("id")
            capability = str(data.get("capability") or "").strip()
            command = data.get("command") or (
                f"v2:{capability}" if protocol_version == 2 and capability else "UNKNOWN"
            )
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
                if command == "HOST_HELLO":
                    await handle_host_hello(websocket, request_id)

                elif protocol_version == 2 and capability == "host.hello":
                    await handle_host_hello(websocket, request_id, protocol_version=2)

                elif command == "HOST_WINDOW":
                    await handle_host_window(websocket, request_id, payload)

                elif protocol_version == 2 and capability == "host.window":
                    await handle_host_window(websocket, request_id, payload, protocol_version=2)

                elif command == "HOST_ACTION":
                    await handle_host_action(websocket, request_id, payload)

                elif protocol_version == 2 and capability == "host.action":
                    await handle_host_action(websocket, request_id, payload, protocol_version=2)

                elif command == "HOST_VISUAL_MATCH":
                    await handle_host_visual_match(websocket, request_id, payload)

                elif protocol_version == 2 and capability == "host.visual_match":
                    await handle_host_visual_match(websocket, request_id, payload, protocol_version=2)

                elif command == "OS_KEYSTROKE":
                    await handle_os_keystroke(websocket, request_id, payload)

                elif command == "READ_FILE":
                    await handle_read_file(websocket, request_id, payload)

                elif command == "READ_DATA_SOURCE":
                    await handle_read_data_source(websocket, request_id, payload)

                elif command == "LIST_APPROVED_DIRECTORIES":
                    await handle_list_approved_directories(websocket, request_id)

                elif command == "FIND_APPROVED_FILES":
                    await handle_find_approved_files(websocket, request_id, payload)

                elif command == "WRITE_APPROVED_FILE":
                    await handle_write_approved_file(websocket, request_id, payload)

                elif command == "EXPORT_DATA_FILE":
                    await handle_export_data_file(websocket, request_id, payload)

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

            except HostFallbackError as e:
                error_msg = str(e)
                await send_json(websocket, failure(request_id, error_msg))
                logging.warning(f"[Fallback] {command} refused: {error_msg}")

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
