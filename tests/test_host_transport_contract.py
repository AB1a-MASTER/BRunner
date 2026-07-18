import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

import brunner_host
from file_access import MAX_LOCAL_FILE_BYTES
from visual_match import MAX_TEMPLATE_IMAGE_BYTES


PROFILE_INSTANCE_ID = "123e4567-e89b-42d3-a456-426614174000"


class FakeWebSocket:
    def __init__(self, messages=None):
        self.messages = iter(messages or [])
        self.sent = []
        self.remote_address = ("127.0.0.1", 50123)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.messages)
        except StopIteration as exc:
            raise StopAsyncIteration from exc

    async def send(self, body):
        self.sent.append(json.loads(body))


class FakePairingCoordinator:
    def __init__(self):
        self.released = False

    @staticmethod
    def announce(websocket, profile_instance_id):
        return {
            "ok": True,
            "message": "Profile connected.",
            "code": "connected",
            "profileInstanceId": profile_instance_id,
            "paired": True,
            "connected": True,
        }

    @staticmethod
    def validate_session(websocket, profile_instance_id):
        return {
            "ok": True,
            "message": "Profile connected.",
            "code": "connected",
            "profileInstanceId": profile_instance_id,
        }

    def release(self, websocket):
        self.released = True


class HostTransportContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_advertised_v2_capability_routes_over_live_connection(self):
        self.assertEqual(
            brunner_host.PROTOCOL_V2_CAPABILITIES,
            ["host.hello", "host.window", "host.action", "host.visual_match"],
        )
        payloads = {
            "host.hello": {},
            "host.window": {},
            "host.action": {"action": "click"},
            "host.visual_match": {"action": "click"},
        }
        messages = [
            json.dumps({
                "id": "profile",
                "command": "PROFILE_HELLO",
                "profileInstanceId": PROFILE_INSTANCE_ID,
            })
        ]
        messages.extend(
            json.dumps({
                "protocolVersion": 2,
                "requestId": f"request-{index}",
                "capability": capability,
                "payload": payloads[capability],
            })
            for index, capability in enumerate(brunner_host.PROTOCOL_V2_CAPABILITIES, start=1)
        )
        websocket = FakeWebSocket(messages)
        pairing = FakePairingCoordinator()

        with (
            patch.object(brunner_host, "PAIRING_COORDINATOR", pairing),
            patch.object(brunner_host, "current_config", return_value={}),
            patch.object(
                brunner_host,
                "host_window_status",
                return_value={"contextAvailable": True},
            ),
            patch.object(
                brunner_host,
                "execute_host_action",
                return_value={"performed": True, "action": "click"},
            ),
            patch.object(
                brunner_host,
                "execute_visual_match_action",
                return_value={"performed": True, "action": "click"},
            ),
        ):
            await brunner_host.handle_connection(websocket)

        responses = {item.get("id"): item for item in websocket.sent}
        self.assertEqual(responses["profile"]["status"], "success")
        for index, capability in enumerate(brunner_host.PROTOCOL_V2_CAPABILITIES, start=1):
            request_id = f"request-{index}"
            with self.subTest(capability=capability):
                self.assertEqual(responses[request_id]["status"], "success")
                self.assertEqual(responses[request_id]["requestId"], request_id)
                self.assertNotIn("Unknown command", responses[request_id].get("error", ""))

        hello = responses["request-1"]
        self.assertEqual(hello["capabilities"], brunner_host.HOST_CAPABILITIES)
        self.assertEqual(
            hello["protocolV2Capabilities"],
            brunner_host.PROTOCOL_V2_CAPABILITIES,
        )
        self.assertTrue({
            "os.keystroke",
            "local_file.read",
            "approved_directory.list",
            "approved_file.find",
            "approved_file.write",
            "data_file.export",
            "data_source.read",
            "execution_log.save",
        }.issubset(set(hello["capabilities"])))
        self.assertFalse(any(
            capability.startswith("mapper.state.")
            for capability in hello["capabilities"]
        ))
        self.assertTrue(pairing.released)

    async def test_legacy_keystroke_uses_the_validated_visible_action_path(self):
        websocket = FakeWebSocket()
        captured = []

        def execute(config, payload):
            captured.append(payload)
            return {"performed": True, "action": payload["action"]}

        with (
            patch.object(brunner_host, "current_config", return_value={}),
            patch.object(brunner_host, "execute_host_action", side_effect=execute),
        ):
            await brunner_host.handle_os_keystroke(
                websocket,
                "keys-1",
                {"keys": "ctrl+l", "expectedWindowTitle": "Chromium"},
            )

        self.assertEqual(captured, [{
            "keys": ["ctrl", "l"],
            "expectedWindowTitle": "Chromium",
            "action": "shortcut",
        }])
        self.assertEqual(websocket.sent[0]["status"], "success")
        self.assertTrue(websocket.sent[0]["hostAction"]["performed"])

    async def test_websocket_server_applies_bounded_payload_and_queue_limits(self):
        class ServeObserved(Exception):
            pass

        captured = {}

        def observe_serve(*args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs
            raise ServeObserved()

        with (
            patch.object(brunner_host.websockets, "serve", side_effect=observe_serve),
            patch.object(brunner_host, "clear_live_connection_status"),
        ):
            with self.assertRaises(ServeObserved):
                await brunner_host.main()

        self.assertEqual(captured["args"], (brunner_host.handle_connection, "localhost", brunner_host.PORT))
        self.assertEqual(
            captured["kwargs"]["max_size"],
            brunner_host.MAX_WEBSOCKET_MESSAGE_BYTES,
        )
        self.assertEqual(captured["kwargs"]["max_queue"], brunner_host.MAX_WEBSOCKET_QUEUE)

        largest_binary_payload = max(MAX_LOCAL_FILE_BYTES, MAX_TEMPLATE_IMAGE_BYTES)
        largest_base64_payload = ((largest_binary_payload + 2) // 3) * 4
        self.assertGreater(
            brunner_host.MAX_WEBSOCKET_MESSAGE_BYTES,
            largest_base64_payload + 64 * 1024,
        )
        self.assertLessEqual(brunner_host.MAX_WEBSOCKET_MESSAGE_BYTES, 32 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
