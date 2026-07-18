import asyncio
import websockets
import json
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
from host_settings import load_or_create_config, save_config
from host_runtime_status import clear_connection_status, write_connection_status
from pairing_coordinator import PairingCoordinator
from product_version import HOST_VERSION
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
PROTOCOL_VERSION = 2
PROTOCOL_V2_CAPABILITIES = [
    "host.hello",
    "host.window",
    "host.action",
    "host.visual_match",
]
HOST_CAPABILITIES = [
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
MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024 * 1024
MAX_WEBSOCKET_QUEUE = 16
CONNECTION_STATUS_HEARTBEAT_SECONDS = 5
CONNECTION_STATUS_HEARTBEAT_TASK_NAME = "brunner-connection-status-heartbeat"

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

# --- Service Setup ---

logging.info("========================================")
logging.info(" BRunner Native OS Host Started")
logging.info(f" Listening on ws://localhost:{PORT}")
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


def failure(request_id=None, error="Unknown error", status="failed", **kwargs):
    return response(
        request_id=request_id,
        status=status,
        error=str(error),
        **kwargs,
    )


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


def save_current_config(settings):
    global config
    config = save_config(CONFIG_FILE, settings)
    return config


def report_connection(profile_instance_id):
    try:
        write_connection_status(
            BASE_DIR,
            profile_instance_id=profile_instance_id,
            port=PORT,
        )
    except Exception as error:
        logging.warning("[Pairing] Could not update live connection status: %s", error)


def clear_live_connection_status():
    try:
        clear_connection_status(BASE_DIR, port=PORT)
    except Exception as error:
        logging.warning("[Pairing] Could not clear live connection status: %s", error)


async def connection_status_heartbeat(
    profile_instance_id,
    interval_seconds=None,
    reporter=None,
):
    interval = (
        CONNECTION_STATUS_HEARTBEAT_SECONDS
        if interval_seconds is None
        else float(interval_seconds)
    )
    if interval <= 0:
        raise ValueError("Connection-status heartbeat interval must be positive.")
    report = reporter or report_connection
    while True:
        await asyncio.sleep(interval)
        try:
            report(profile_instance_id)
        except Exception as error:
            logging.warning("[Pairing] Connection-status heartbeat failed: %s", error)


async def cancel_connection_status_heartbeat(task):
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception as error:
        logging.warning("[Pairing] Connection-status heartbeat stopped: %s", error)


PAIRING_COORDINATOR = PairingCoordinator(
    current_config,
    save_current_config,
    report_connection,
)


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
        "capabilities": list(HOST_CAPABILITIES),
        "protocolV2Capabilities": list(PROTOCOL_V2_CAPABILITIES),
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


async def send_pairing_result(websocket, request_id, result):
    details = {
        key: value
        for key, value in result.items()
        if key not in {"ok", "message"}
    }
    if result.get("ok"):
        body = success(request_id, message=result.get("message"), **details)
    else:
        body = failure(request_id, result.get("message"), **details)
    await send_json(websocket, body)


async def handle_profile_hello(websocket, request_id, payload, send_response=True):
    result = PAIRING_COORDINATOR.announce(
        websocket,
        payload.get("profileInstanceId") or payload.get("profile_instance_id"),
    )
    if send_response:
        await send_pairing_result(websocket, request_id, result)
    logging.info(
        "[Pairing] Profile hello: %s",
        result.get("code"),
    )
    return result


async def handle_pair_profile(websocket, request_id, payload, send_response=True):
    result = PAIRING_COORDINATOR.pair(
        websocket,
        payload.get("profileInstanceId") or payload.get("profile_instance_id"),
    )
    if send_response:
        await send_pairing_result(websocket, request_id, result)
    logging.info("[Pairing] Pair request: %s", result.get("code"))
    return result


async def handle_unpair_profile(websocket, request_id, payload, send_response=True):
    result = PAIRING_COORDINATOR.unpair(
        websocket,
        payload.get("profileInstanceId") or payload.get("profile_instance_id"),
    )
    if send_response:
        await send_pairing_result(websocket, request_id, result)
    logging.info("[Pairing] Unpair request: %s", result.get("code"))
    return result


async def handle_os_keystroke(websocket, request_id, payload):
    raw_keys = (
        payload.get("keys")
        or payload.get("key")
        or payload.get("value")
        or payload.get("text")
    )

    keys = parse_keys(raw_keys)

    logging.info(f"[Hardware] Dispatching OS keystroke: {keys}")
    action_request = dict(payload)
    if len(keys) == 1:
        action_request.update({"action": "press", "key": keys[0]})
    else:
        action_request.update({"action": "shortcut", "keys": keys})
    result = execute_host_action(current_config(), action_request)

    await send_json(
        websocket,
        success(
            request_id,
            strategy="Python_OS_Hardware",
            keys=keys,
            hostAction=result,
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
        "[Fallback] host.visual_match performed: %s x=%s y=%s confidence=%s search_ms=%s region=%s",
        result["action"],
        result.get("x"),
        result.get("y"),
        result.get("matchConfidence"),
        result.get("searchDurationMs"),
        result.get("searchRegion"),
    )


async def handle_read_file(websocket, request_id, payload):
    request = directory_request(payload)
    if not request.get("directoryAlias"):
        request = payload.get("path") or payload.get("filePath")
    file_data = read_allowed_file(
        current_config(),
        BASE_DIR,
        request,
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


def directory_request(payload):
    if not isinstance(payload, dict):
        return {}
    request = payload.get("request")
    return request if isinstance(request, dict) else payload


async def handle_find_approved_files(websocket, request_id, payload):
    result = find_approved_files(
        current_config(),
        BASE_DIR,
        directory_request(payload),
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
        directory_request(payload),
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
        directory_request(payload),
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
    profile_instance_id = ""
    heartbeat_task = None
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

            if command in {"PROFILE_HELLO", "PAIR_PROFILE", "UNPAIR_PROFILE"}:
                try:
                    if command == "PROFILE_HELLO":
                        pairing_result = await handle_profile_hello(
                            websocket,
                            request_id,
                            payload,
                            send_response=False,
                        )
                    elif command == "PAIR_PROFILE":
                        pairing_result = await handle_pair_profile(
                            websocket,
                            request_id,
                            payload,
                            send_response=False,
                        )
                    else:
                        pairing_result = await handle_unpair_profile(
                            websocket,
                            request_id,
                            payload,
                            send_response=False,
                        )
                    if pairing_result.get("ok"):
                        next_profile_instance_id = (
                            pairing_result.get("profileInstanceId") or ""
                        )
                        await cancel_connection_status_heartbeat(heartbeat_task)
                        heartbeat_task = None
                        if (
                            pairing_result.get("connected")
                            and next_profile_instance_id
                        ):
                            profile_instance_id = next_profile_instance_id
                            heartbeat_task = asyncio.create_task(
                                connection_status_heartbeat(profile_instance_id),
                                name=CONNECTION_STATUS_HEARTBEAT_TASK_NAME,
                            )
                        else:
                            profile_instance_id = ""
                            if (
                                getattr(PAIRING_COORDINATOR, "active_connection", None) is None
                                or getattr(PAIRING_COORDINATOR, "active_connection", None) is websocket
                            ):
                                clear_live_connection_status()
                    elif not profile_instance_id:
                        # Retain a valid announced identity so later commands
                        # receive the coordinator's precise pairing diagnostic.
                        profile_instance_id = (
                            pairing_result.get("profileInstanceId") or ""
                        )
                    await send_pairing_result(websocket, request_id, pairing_result)
                except Exception as error:
                    await cancel_connection_status_heartbeat(heartbeat_task)
                    heartbeat_task = None
                    profile_instance_id = ""
                    PAIRING_COORDINATOR.release(websocket)
                    if getattr(PAIRING_COORDINATOR, "active_connection", None) is None:
                        clear_live_connection_status()
                    await send_json(
                        websocket,
                        failure(
                            request_id,
                            str(error),
                            code="pairing_state_error",
                            pairingState="pairing_failed",
                            paired=False,
                            connected=False,
                        ),
                    )
                    logging.error("[Pairing] %s failed: %s", command, error)
                continue

            if not profile_instance_id:
                await send_pairing_result(
                    websocket,
                    request_id,
                    PAIRING_COORDINATOR.pairing_required(),
                )
                logging.warning("[Pairing] Rejected command before profile hello: %s", command)
                continue

            try:
                pairing_result = PAIRING_COORDINATOR.validate_session(
                    websocket,
                    profile_instance_id,
                )
            except Exception as error:
                await cancel_connection_status_heartbeat(heartbeat_task)
                heartbeat_task = None
                profile_instance_id = ""
                if (
                    getattr(PAIRING_COORDINATOR, "active_connection", None) is None
                    or getattr(PAIRING_COORDINATOR, "active_connection", None) is websocket
                ):
                    clear_live_connection_status()
                await send_json(
                    websocket,
                    failure(
                        request_id,
                        str(error),
                        code="pairing_state_error",
                        pairingState="pairing_failed",
                        paired=False,
                        connected=False,
                    ),
                )
                logging.error("[Pairing] Could not validate %s: %s", command, error)
                continue
            if not pairing_result.get("ok"):
                await cancel_connection_status_heartbeat(heartbeat_task)
                heartbeat_task = None
                profile_instance_id = ""
                if (
                    getattr(PAIRING_COORDINATOR, "active_connection", None) is None
                    or getattr(PAIRING_COORDINATOR, "active_connection", None) is websocket
                ):
                    clear_live_connection_status()
                await send_pairing_result(websocket, request_id, pairing_result)
                logging.warning(
                    "[Pairing] Rejected command %s: %s",
                    command,
                    pairing_result.get("code"),
                )
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

    finally:
        await cancel_connection_status_heartbeat(heartbeat_task)
        PAIRING_COORDINATOR.release(websocket)


async def main():
    try:
        clear_live_connection_status()
        async with websockets.serve(
            handle_connection,
            "localhost",
            PORT,
            max_size=MAX_WEBSOCKET_MESSAGE_BYTES,
            max_queue=MAX_WEBSOCKET_QUEUE,
        ):
            await asyncio.Future()
    finally:
        clear_live_connection_status()


if __name__ == "__main__":
    asyncio.run(main())
