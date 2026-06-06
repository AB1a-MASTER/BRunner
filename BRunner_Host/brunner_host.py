import asyncio
import websockets
import json
import pyautogui
import os
import secrets
import logging
import glob

# --- Setup Persistent Logging ---
# This creates a 'brunner_host.log' file and also prints to the console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("brunner_host.log"),
        logging.StreamHandler()
    ]
)

CONFIG_FILE = "brunner_config.json"
PORT = 8999

# --- Authentication & Setup ---


def load_or_create_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    else:
        new_key = secrets.token_hex(16)
        config = {"pairing_key": new_key, "paired_extension_id": None}
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f)
        return config


config = load_or_create_config()
PAIRING_KEY = config["pairing_key"]

logging.info("========================================")
logging.info(" BRunner Native OS Host Started")
logging.info(f" Listening on ws://localhost:{PORT}")
logging.info("========================================")
logging.info(f" YOUR PAIRING KEY: {PAIRING_KEY}")
logging.info("========================================")

# --- WebSocket Command Router ---


async def handle_connection(websocket):
    authenticated = False
    remote_ip = websocket.remote_address[0]
    logging.info(f"[Network] New connection attempt from {remote_ip}")

    try:
        async for message in websocket:
            data = json.loads(message)
            command = data.get("command", "UNKNOWN")
            payload = data.get("payload", {})

            logging.info(
                f"[Inbound] Received Command: {command} | Payload: {payload}")

            # 1. Enforce Authentication Handshake
            if command == "AUTH":
                client_key = payload.get("key")
                if client_key == PAIRING_KEY:
                    authenticated = True
                    await websocket.send(json.dumps({"status": "success", "message": "Authenticated successfully."}))
                    logging.info(
                        "[Auth] Extension connected and authenticated securely.")
                else:
                    await websocket.send(json.dumps({"status": "failed", "error": "Invalid Pairing Key."}))
                    logging.warning(
                        "[Auth] Blocked connection attempt with invalid key.")
                continue

            # Block everything else if not authenticated
            if not authenticated:
                await websocket.send(json.dumps({"status": "failed", "error": "Not authenticated."}))
                logging.warning(
                    f"[Security] Rejected unauthenticated command: {command}")
                continue

            # 2. Command Execution
            if command == "OS_KEYSTROKE":
                key = payload.get("key", "").lower()
                try:
                    logging.info(
                        f"[Hardware] Dispatching OS keystroke: '{key}'")
                    pyautogui.press(key)
                    await websocket.send(json.dumps({"status": "success", "strategy": "Python_OS_Hardware"}))
                    logging.info(
                        f"[Hardware] Keystroke '{key}' executed successfully.")
                except Exception as e:
                    error_msg = str(e)
                    await websocket.send(json.dumps({"status": "failed", "error": error_msg}))
                    logging.error(f"[Hardware] Keystroke failed: {error_msg}")
            elif command == "LIST_WORKFLOWS":
                try:
                    # Look for .json files in the local Workflows directory
                    os.makedirs("Workflows", exist_ok=True)
                    files = [f for f in os.listdir(
                        "Workflows") if f.endswith(".json")]
                    await websocket.send(json.dumps({"status": "success", "files": files}))
                except Exception as e:
                    await websocket.send(json.dumps({"status": "failed", "error": str(e)}))

            elif command == "SAVE_WORKFLOW":
                try:
                    filename = payload.get("filename")
                    content = payload.get("content")
                    with open(f"Workflows/{filename}", "w") as f:
                        json.dump(content, f, indent=4)
                    await websocket.send(json.dumps({"status": "success"}))
                except Exception as e:
                    await websocket.send(json.dumps({"status": "failed", "error": str(e)}))

            elif command == "LOAD_WORKFLOW":
                try:
                    filename = payload.get("filename")
                    with open(f"Workflows/{filename}", "r") as f:
                        content = json.load(f)
                    await websocket.send(json.dumps({"status": "success", "content": content}))
                except Exception as e:
                    await websocket.send(json.dumps({"status": "failed", "error": str(e)}))

            else:
                await websocket.send(json.dumps({"status": "error", "error": f"Unknown command: {command}"}))
                logging.warning(
                    f"[Router] Unhandled command received: {command}")

    except websockets.exceptions.ConnectionClosed:
        logging.info("[Network] Extension disconnected.")
    except Exception as e:
        logging.error(f"[System] Unexpected error: {str(e)}")


async def main():
    async with websockets.serve(handle_connection, "localhost", PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
