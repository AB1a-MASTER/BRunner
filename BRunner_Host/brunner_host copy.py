#!/usr/bin/env python3
import sys
import json
import struct
import pyautogui  # OS-Level hardware control
import os

# --- Chrome Native Messaging Protocol Setup ---


def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        sys.exit(0)
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)


def send_message(message_content):
    encoded_content = json.dumps(message_content).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded_content)))
    sys.stdout.buffer.write(encoded_content)
    sys.stdout.buffer.flush()

# --- Command Router ---


def main():
    while True:
        message = get_message()
        command = message.get("command")
        payload = message.get("payload", {})

        if command == "PING":
            send_message(
                {"status": "success", "message": "Python Host is connected!"})

        elif command == "OS_KEYSTROKE":
            key = payload.get("key", "").lower()
            try:
                # Dispatches a true OS-level keystroke
                pyautogui.press(key)
                send_message(
                    {"status": "success", "strategy": "Python_OS_Hardware"})
            except Exception as e:
                send_message({"status": "failed", "error": str(e)})

        elif command == "SAVE_WORKFLOW":
            # Future Phase 7 implementation...
            send_message({"status": "success", "message": "Save triggered"})

        else:
            send_message(
                {"status": "error", "message": f"Unknown command: {command}"})


if __name__ == '__main__':
    main()
