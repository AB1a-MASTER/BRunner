import asyncio
import base64
import copy
import json
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest import mock

import websockets


HOST_DIR = Path(__file__).resolve().parents[1] / "BRunner_Host"
sys.path.insert(0, str(HOST_DIR))

import brunner_host
from host_runtime_status import read_connection_status
from pairing_coordinator import PairingCoordinator


PROFILE_A = "123e4567-e89b-42d3-a456-426614174000"
PROFILE_B = "223e4567-e89b-42d3-a456-426614174001"


class MemorySettings:
    def __init__(self, settings):
        self.settings = copy.deepcopy(settings)

    def load(self):
        return copy.deepcopy(self.settings)

    def save(self, settings):
        self.settings = copy.deepcopy(settings)
        return self.load()


async def request(websocket, body, timeout=2):
    await websocket.send(json.dumps(body))
    response = await asyncio.wait_for(websocket.recv(), timeout=timeout)
    return json.loads(response)


def command(request_id, name, payload=None):
    return {
        "id": request_id,
        "command": name,
        "payload": payload or {},
    }


def capability(request_id, name, payload=None):
    return {
        "protocolVersion": 2,
        "requestId": request_id,
        "capability": name,
        "payload": payload or {},
    }


@asynccontextmanager
async def live_host(base_dir, settings_store, coordinator):
    with (
        mock.patch.object(brunner_host, "BASE_DIR", Path(base_dir)),
        mock.patch.object(brunner_host, "current_config", side_effect=settings_store.load),
        mock.patch.object(brunner_host, "PAIRING_COORDINATOR", coordinator),
        mock.patch.object(brunner_host, "logging", mock.MagicMock()),
    ):
        async with websockets.serve(
            brunner_host.handle_connection,
            "127.0.0.1",
            0,
            max_size=brunner_host.MAX_WEBSOCKET_MESSAGE_BYTES,
            max_queue=brunner_host.MAX_WEBSOCKET_QUEUE,
        ) as server:
            port = server.sockets[0].getsockname()[1]
            with mock.patch.object(brunner_host, "PORT", port):
                yield f"ws://127.0.0.1:{port}", port


class LiveHostWebSocketContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_handshake_heartbeat_is_fresh_and_stops_with_connection(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = MemorySettings({
                "pairedInstanceId": PROFILE_A,
                "host": {"port": 8999},
                "approvedDirectories": [],
            })
            coordinator = PairingCoordinator(
                settings.load,
                settings.save,
                brunner_host.report_connection,
            )

            async with live_host(temp, settings, coordinator) as (uri, port):
                settings.settings["host"]["port"] = port
                with mock.patch.object(
                    brunner_host,
                    "CONNECTION_STATUS_HEARTBEAT_SECONDS",
                    0.02,
                ):
                    client = await websockets.connect(
                        uri,
                        open_timeout=2,
                        close_timeout=2,
                    )
                    try:
                        announced = await request(
                            client,
                            command("announce-heartbeat", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        )
                        self.assertEqual(announced["status"], "success")
                        initial = read_connection_status(temp)
                        self.assertTrue(initial["connected"])
                        self.assertTrue(initial["handshakeComplete"])
                        self.assertEqual(initial["profileInstanceId"], PROFILE_A)
                        self.assertEqual(initial["port"], port)

                        refreshed = initial
                        for _attempt in range(20):
                            await asyncio.sleep(0.01)
                            refreshed = read_connection_status(temp)
                            if refreshed["updatedAt"] != initial["updatedAt"]:
                                break
                        self.assertNotEqual(refreshed["updatedAt"], initial["updatedAt"])

                        repeated = await request(
                            client,
                            command("repeat-heartbeat", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        )
                        self.assertEqual(repeated["status"], "success")
                        await asyncio.sleep(0.01)
                        heartbeat_tasks = [
                            task
                            for task in asyncio.all_tasks()
                            if not task.done()
                            and task.get_name()
                            == brunner_host.CONNECTION_STATUS_HEARTBEAT_TASK_NAME
                        ]
                        self.assertEqual(len(heartbeat_tasks), 1)
                    finally:
                        await client.close()

                    for _attempt in range(20):
                        await asyncio.sleep(0.01)
                        if not read_connection_status(temp)["connected"]:
                            break
                    self.assertFalse(read_connection_status(temp)["connected"])
                    heartbeat_tasks = [
                        task
                        for task in asyncio.all_tasks()
                        if not task.done()
                        and task.get_name()
                        == brunner_host.CONNECTION_STATUS_HEARTBEAT_TASK_NAME
                    ]
                    self.assertEqual(heartbeat_tasks, [])

    async def test_invalidated_socket_cannot_keep_or_replace_the_active_heartbeat(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = MemorySettings({
                "pairedInstanceId": PROFILE_A,
                "host": {"port": 8999},
                "approvedDirectories": [],
            })
            coordinator = PairingCoordinator(
                settings.load,
                settings.save,
                brunner_host.report_connection,
            )

            def heartbeat_tasks():
                return [
                    task
                    for task in asyncio.all_tasks()
                    if not task.done()
                    and task.get_name()
                    == brunner_host.CONNECTION_STATUS_HEARTBEAT_TASK_NAME
                ]

            async with live_host(temp, settings, coordinator) as (uri, port):
                settings.settings["host"]["port"] = port
                with mock.patch.object(
                    brunner_host,
                    "CONNECTION_STATUS_HEARTBEAT_SECONDS",
                    0.02,
                ):
                    old_client = await websockets.connect(
                        uri,
                        open_timeout=2,
                        close_timeout=2,
                    )
                    replacement = None
                    try:
                        announced = await request(
                            old_client,
                            command("announce-old", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        )
                        self.assertEqual(announced["status"], "success")
                        self.assertEqual(len(heartbeat_tasks()), 1)

                        settings.settings["pairedInstanceId"] = PROFILE_B
                        invalidated = await request(
                            old_client,
                            capability("invalidate-old", "host.hello"),
                        )
                        self.assertEqual(invalidated["status"], "failed")
                        self.assertEqual(invalidated["code"], "paired_to_other_profile")
                        await asyncio.sleep(0.03)
                        self.assertEqual(heartbeat_tasks(), [])
                        self.assertFalse(read_connection_status(temp)["connected"])

                        replacement = await websockets.connect(
                            uri,
                            open_timeout=2,
                            close_timeout=2,
                        )
                        replacement_hello = await request(
                            replacement,
                            command("announce-replacement", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_B,
                            }),
                        )
                        self.assertEqual(replacement_hello["status"], "success")
                        await asyncio.sleep(0.03)
                        self.assertEqual(len(heartbeat_tasks()), 1)
                        self.assertEqual(
                            read_connection_status(temp)["profileInstanceId"],
                            PROFILE_B,
                        )

                        await old_client.close()
                        await asyncio.sleep(0.03)
                        self.assertEqual(len(heartbeat_tasks()), 1)
                        self.assertEqual(
                            read_connection_status(temp)["profileInstanceId"],
                            PROFILE_B,
                        )
                    finally:
                        if not old_client.closed:
                            await old_client.close()
                        if replacement is not None:
                            await replacement.close()

                    for _attempt in range(20):
                        await asyncio.sleep(0.01)
                        if (
                            not heartbeat_tasks()
                            and not read_connection_status(temp)["connected"]
                        ):
                            break
                    self.assertEqual(heartbeat_tasks(), [])
                    self.assertFalse(read_connection_status(temp)["connected"])

    async def test_delayed_unpair_response_cannot_clear_a_replacement_heartbeat(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = MemorySettings({
                "pairedInstanceId": PROFILE_A,
                "host": {"port": 8999},
                "approvedDirectories": [],
            })
            coordinator = PairingCoordinator(
                settings.load,
                settings.save,
                brunner_host.report_connection,
            )
            unpair_response_started = asyncio.Event()
            release_unpair_response = asyncio.Event()
            original_send_pairing_result = brunner_host.send_pairing_result

            async def delayed_unpair_response(websocket, request_id, result):
                if request_id == "unpair-old":
                    unpair_response_started.set()
                    await release_unpair_response.wait()
                await original_send_pairing_result(websocket, request_id, result)

            def heartbeat_tasks():
                return [
                    task
                    for task in asyncio.all_tasks()
                    if not task.done()
                    and task.get_name()
                    == brunner_host.CONNECTION_STATUS_HEARTBEAT_TASK_NAME
                ]

            async with live_host(temp, settings, coordinator) as (uri, port):
                settings.settings["host"]["port"] = port
                with (
                    mock.patch.object(
                        brunner_host,
                        "CONNECTION_STATUS_HEARTBEAT_SECONDS",
                        0.02,
                    ),
                    mock.patch.object(
                        brunner_host,
                        "send_pairing_result",
                        side_effect=delayed_unpair_response,
                    ),
                ):
                    old_client = await websockets.connect(
                        uri,
                        open_timeout=2,
                        close_timeout=2,
                    )
                    replacement = None
                    unpair_request = None
                    try:
                        announced = await request(
                            old_client,
                            command("announce-old", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        )
                        self.assertEqual(announced["status"], "success")
                        self.assertEqual(len(heartbeat_tasks()), 1)

                        unpair_request = asyncio.create_task(request(
                            old_client,
                            command("unpair-old", "UNPAIR_PROFILE", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        ))
                        await asyncio.wait_for(unpair_response_started.wait(), timeout=2)
                        self.assertEqual(heartbeat_tasks(), [])
                        self.assertFalse(read_connection_status(temp)["connected"])

                        replacement = await websockets.connect(
                            uri,
                            open_timeout=2,
                            close_timeout=2,
                        )
                        paired_replacement = await request(
                            replacement,
                            command("pair-replacement", "PAIR_PROFILE", {
                                "profileInstanceId": PROFILE_B,
                            }),
                        )
                        self.assertEqual(paired_replacement["status"], "success")
                        self.assertEqual(settings.settings["pairedInstanceId"], PROFILE_B)
                        self.assertEqual(len(heartbeat_tasks()), 1)

                        release_unpair_response.set()
                        unpaired = await asyncio.wait_for(unpair_request, timeout=2)
                        self.assertEqual(unpaired["status"], "success")
                        await asyncio.sleep(0.03)
                        self.assertEqual(len(heartbeat_tasks()), 1)
                        self.assertEqual(
                            read_connection_status(temp)["profileInstanceId"],
                            PROFILE_B,
                        )

                        await old_client.close()
                        await asyncio.sleep(0.03)
                        self.assertEqual(len(heartbeat_tasks()), 1)
                        self.assertEqual(
                            read_connection_status(temp)["profileInstanceId"],
                            PROFILE_B,
                        )
                    finally:
                        release_unpair_response.set()
                        if unpair_request is not None and not unpair_request.done():
                            unpair_request.cancel()
                        if not old_client.closed:
                            await old_client.close()
                        if replacement is not None:
                            await replacement.close()

                    for _attempt in range(20):
                        await asyncio.sleep(0.01)
                        if (
                            not heartbeat_tasks()
                            and not read_connection_status(temp)["connected"]
                        ):
                            break
                    self.assertEqual(heartbeat_tasks(), [])
                    self.assertFalse(read_connection_status(temp)["connected"])

    async def test_v2_hello_reports_full_host_and_explicit_routed_capabilities(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = MemorySettings({
                "pairedInstanceId": PROFILE_A,
                "host": {"port": 8999},
                "approvedDirectories": [],
                "hostFallback": {"enabled": True},
            })
            coordinator = PairingCoordinator(settings.load, settings.save)

            async with live_host(temp, settings, coordinator) as (uri, port):
                settings.settings["host"]["port"] = port
                async with websockets.connect(uri, open_timeout=2, close_timeout=2) as client:
                    hello = await request(
                        client,
                        command("profile-a", "PROFILE_HELLO", {
                            "profileInstanceId": PROFILE_A,
                        }),
                    )
                    self.assertEqual(hello["status"], "success")
                    self.assertEqual(hello["code"], "paired")

                    response = await request(
                        client,
                        capability("hello-v2", "host.hello"),
                    )

            self.assertEqual(response["status"], "success")
            self.assertEqual(response["id"], "hello-v2")
            self.assertEqual(response["requestId"], "hello-v2")
            self.assertEqual(response["protocolVersion"], 2)
            self.assertEqual(response["host"]["port"], port)
            self.assertEqual(response["capabilities"], brunner_host.HOST_CAPABILITIES)
            self.assertEqual(
                response["protocolV2Capabilities"],
                brunner_host.PROTOCOL_V2_CAPABILITIES,
            )
            self.assertTrue(
                set(brunner_host.PROTOCOL_V2_CAPABILITIES)
                .issubset(set(brunner_host.HOST_CAPABILITIES))
            )

    async def test_pairing_rejects_other_profile_and_duplicate_live_connection(self):
        with tempfile.TemporaryDirectory() as temp:
            settings = MemorySettings({
                "pairedInstanceId": None,
                "host": {"port": 8999},
                "approvedDirectories": [],
                "hostFallback": {"enabled": True},
            })
            released = asyncio.Event()

            def report_connection(profile_instance_id):
                if profile_instance_id is None:
                    released.set()

            coordinator = PairingCoordinator(
                settings.load,
                settings.save,
                report_connection,
            )

            async with live_host(temp, settings, coordinator) as (uri, _port):
                first = await websockets.connect(uri, open_timeout=2, close_timeout=2)
                try:
                    unpaired = await request(
                        first,
                        command("announce-a", "PROFILE_HELLO", {
                            "profileInstanceId": PROFILE_A,
                        }),
                    )
                    self.assertEqual(unpaired["status"], "failed")
                    self.assertEqual(unpaired["code"], "pairing_required")

                    paired = await request(
                        first,
                        command("pair-a", "PAIR_PROFILE", {
                            "profileInstanceId": PROFILE_A,
                        }),
                    )
                    self.assertEqual(paired["status"], "success")
                    self.assertEqual(settings.settings["pairedInstanceId"], PROFILE_A)

                    async with websockets.connect(uri, open_timeout=2, close_timeout=2) as other:
                        other_result = await request(
                            other,
                            command("announce-b", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_B,
                            }),
                        )
                        self.assertEqual(other_result["status"], "failed")
                        self.assertEqual(other_result["code"], "paired_to_other_profile")

                        refused = await request(
                            other,
                            capability("refused-b", "host.hello"),
                        )
                        self.assertEqual(refused["status"], "failed")
                        self.assertEqual(refused["code"], "paired_to_other_profile")

                    async with websockets.connect(uri, open_timeout=2, close_timeout=2) as duplicate:
                        duplicate_result = await request(
                            duplicate,
                            command("announce-a-duplicate", "PROFILE_HELLO", {
                                "profileInstanceId": PROFILE_A,
                            }),
                        )
                        self.assertEqual(duplicate_result["status"], "failed")
                        self.assertEqual(duplicate_result["code"], "paired_connection_active")
                finally:
                    await first.close()

                await asyncio.wait_for(released.wait(), timeout=2)
                self.assertIsNone(coordinator.active_connection)

                async with websockets.connect(uri, open_timeout=2, close_timeout=2) as replacement:
                    replacement_result = await request(
                        replacement,
                        command("announce-a-replacement", "PROFILE_HELLO", {
                            "profileInstanceId": PROFILE_A,
                        }),
                    )
                    self.assertEqual(replacement_result["status"], "success")
                    self.assertEqual(replacement_result["code"], "paired")

    async def test_approved_file_write_find_round_trip_and_registry_failures(self):
        with tempfile.TemporaryDirectory() as temp:
            base_dir = Path(temp)
            writable = base_dir / "writable"
            read_only = base_dir / "read-only"
            write_only = base_dir / "write-only"
            non_recursive = base_dir / "non-recursive"
            unavailable = base_dir / "unavailable"
            writable.mkdir()
            read_only.mkdir()
            write_only.mkdir()
            non_recursive.mkdir()
            settings = MemorySettings({
                "pairedInstanceId": PROFILE_A,
                "host": {"port": 8999},
                "approvedDirectories": [
                    {
                        "id": "workspace",
                        "displayName": "Workspace",
                        "path": str(writable),
                        "read": True,
                        "write": True,
                        "recursive": True,
                    },
                    {
                        "id": "read_only",
                        "displayName": "Read only",
                        "path": str(read_only),
                        "read": True,
                        "write": False,
                        "recursive": False,
                    },
                    {
                        "id": "write_only",
                        "displayName": "Write only",
                        "path": str(write_only),
                        "read": False,
                        "write": True,
                        "recursive": True,
                    },
                    {
                        "id": "non_recursive",
                        "displayName": "Non-recursive",
                        "path": str(non_recursive),
                        "read": True,
                        "write": True,
                        "recursive": False,
                    },
                    {
                        "id": "unavailable",
                        "displayName": "Unavailable",
                        "path": str(unavailable),
                        "read": True,
                        "write": True,
                        "recursive": True,
                    },
                ],
                "hostFallback": {"enabled": True},
            })
            coordinator = PairingCoordinator(settings.load, settings.save)

            async with live_host(base_dir, settings, coordinator) as (uri, _port):
                async with websockets.connect(uri, open_timeout=2, close_timeout=2) as client:
                    announced = await request(
                        client,
                        command("announce-storage", "PROFILE_HELLO", {
                            "profileInstanceId": PROFILE_A,
                        }),
                    )
                    self.assertEqual(announced["status"], "success")

                    written = await request(
                        client,
                        command("write-approved", "WRITE_APPROVED_FILE", {
                            "directoryAlias": "workspace",
                            "relativePath": "nested/result.txt",
                            "content": "live websocket payload",
                        }),
                    )
                    self.assertEqual(written["status"], "success")
                    self.assertEqual(written["relativePath"], "nested/result.txt")
                    self.assertEqual(
                        (writable / "nested" / "result.txt").read_text(encoding="utf-8"),
                        "live websocket payload",
                    )

                    found = await request(
                        client,
                        command("find-approved", "FIND_APPROVED_FILES", {
                            "directoryAlias": written["directoryAlias"],
                            "pattern": written["relativePath"],
                            "extensions": ["txt"],
                            "maxResults": 1,
                        }),
                    )
                    self.assertEqual(found["status"], "success")
                    self.assertEqual(found["directoryAlias"], "workspace")
                    self.assertEqual(found["count"], 1)
                    self.assertEqual(len(found["files"]), 1)
                    found_file = found["files"][0]
                    self.assertEqual({
                        key: found_file[key]
                        for key in (
                            "directoryAlias",
                            "relativePath",
                            "filename",
                            "mimeType",
                            "size",
                        )
                    }, {
                        "directoryAlias": "workspace",
                        "relativePath": "nested/result.txt",
                        "filename": "result.txt",
                        "mimeType": "text/plain",
                        "size": len("live websocket payload"),
                    })
                    self.assertIsInstance(found_file["modifiedAt"], (int, float))

                    read_back = await request(
                        client,
                        command("read-approved", "READ_FILE", {
                            "directoryAlias": "workspace",
                            "relativePath": "nested/result.txt",
                        }),
                    )
                    self.assertEqual(read_back["status"], "success")
                    self.assertEqual(
                        base64.b64decode(read_back["content"]).decode("utf-8"),
                        "live websocket payload",
                    )

                    permission_denied = await request(
                        client,
                        command("write-read-only", "WRITE_APPROVED_FILE", {
                            "directoryAlias": "read_only",
                            "relativePath": "denied.txt",
                            "content": "must not be written",
                        }),
                    )
                    self.assertEqual(permission_denied["status"], "failed")
                    self.assertEqual(
                        permission_denied["error"],
                        "Approved directory does not allow writes.",
                    )
                    self.assertFalse((read_only / "denied.txt").exists())

                    read_denied = await request(
                        client,
                        command("find-write-only", "FIND_APPROVED_FILES", {
                            "directoryAlias": "write_only",
                        }),
                    )
                    self.assertEqual(read_denied["status"], "failed")
                    self.assertEqual(
                        read_denied["error"],
                        "Approved directory does not allow reads.",
                    )

                    recursive_denied = await request(
                        client,
                        command("write-nested-non-recursive", "WRITE_APPROVED_FILE", {
                            "directoryAlias": "non_recursive",
                            "relativePath": "nested/denied.txt",
                            "content": "must not be written",
                        }),
                    )
                    self.assertEqual(recursive_denied["status"], "failed")
                    self.assertEqual(
                        recursive_denied["error"],
                        "Approved directory does not allow recursive access.",
                    )
                    self.assertFalse((non_recursive / "nested" / "denied.txt").exists())

                    traversal_denied = await request(
                        client,
                        command("write-traversal", "WRITE_APPROVED_FILE", {
                            "directoryAlias": "workspace",
                            "relativePath": "../escape.txt",
                            "content": "must not escape",
                        }),
                    )
                    self.assertEqual(traversal_denied["status"], "failed")
                    self.assertEqual(
                        traversal_denied["error"],
                        "Output file is outside approved directory.",
                    )
                    self.assertFalse((base_dir / "escape.txt").exists())

                    missing_alias = await request(
                        client,
                        command("find-missing-alias", "FIND_APPROVED_FILES", {
                            "pattern": "*",
                        }),
                    )
                    self.assertEqual(missing_alias["status"], "failed")
                    self.assertEqual(
                        missing_alias["error"],
                        "Approved directory alias is missing.",
                    )

                    unknown_alias = await request(
                        client,
                        command("find-unknown-alias", "FIND_APPROVED_FILES", {
                            "directoryAlias": "not_configured",
                        }),
                    )
                    self.assertEqual(unknown_alias["status"], "failed")
                    self.assertEqual(
                        unknown_alias["error"],
                        "Approved directory alias is unavailable.",
                    )

                    unavailable_alias = await request(
                        client,
                        command("find-unavailable-alias", "FIND_APPROVED_FILES", {
                            "directoryAlias": "unavailable",
                        }),
                    )
                    self.assertEqual(unavailable_alias["status"], "failed")
                    self.assertEqual(
                        unavailable_alias["error"],
                        "Approved directory is unavailable.",
                    )

                    settings.settings["approvedDirectories"] = []
                    empty_registry = await request(
                        client,
                        command("list-empty-registry", "LIST_APPROVED_DIRECTORIES"),
                    )
                    self.assertEqual(empty_registry["status"], "success")
                    self.assertEqual(empty_registry["directories"], [])

                    removed_final_alias = await request(
                        client,
                        command("find-after-final-removal", "FIND_APPROVED_FILES", {
                            "directoryAlias": "workspace",
                        }),
                    )
                    self.assertEqual(removed_final_alias["status"], "failed")
                    self.assertEqual(
                        removed_final_alias["error"],
                        "Approved directory alias is unavailable.",
                    )


if __name__ == "__main__":
    unittest.main()
