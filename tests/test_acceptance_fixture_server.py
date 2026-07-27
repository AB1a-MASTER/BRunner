import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen


ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from acceptance_fixture_server import NO_STORE_CACHE_CONTROL, create_server


class AcceptanceFixtureServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "fixture.html").write_text(
            "<title>fixture</title>",
            encoding="utf-8",
        )
        self.server = create_server(self.root, port=0)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            daemon=True,
        )
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def assert_no_store_headers(self, headers):
        self.assertEqual(headers["Cache-Control"], NO_STORE_CACHE_CONTROL)
        self.assertEqual(headers["Pragma"], "no-cache")
        self.assertEqual(headers["Expires"], "0")

    def test_serves_query_url_with_no_store_headers(self):
        with urlopen(
            f"{self.base_url}/fixture.html?acceptance=navigate-v2",
            timeout=3,
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(
                response.read().decode("utf-8"),
                "<title>fixture</title>",
            )
            self.assert_no_store_headers(response.headers)

    def test_sends_no_store_headers_on_missing_fixture(self):
        with self.assertRaises(HTTPError) as raised:
            urlopen(f"{self.base_url}/missing.html", timeout=3)

        self.assertEqual(raised.exception.code, 404)
        self.assert_no_store_headers(raised.exception.headers)


if __name__ == "__main__":
    unittest.main()
