from __future__ import annotations

import argparse
import ipaddress
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Sequence


NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate"


class NoStoreHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Serve repository fixtures without allowing browser cache reuse."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", NO_STORE_CACHE_CONTROL)
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class AcceptanceFixtureServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def create_server(
    directory: str | Path,
    *,
    bind: str = "127.0.0.1",
    port: int = 8765,
) -> AcceptanceFixtureServer:
    address = ipaddress.ip_address(bind)
    if not address.is_loopback:
        raise ValueError("Acceptance fixtures may bind only to a loopback address.")

    root = Path(directory).resolve(strict=True)
    if not root.is_dir():
        raise NotADirectoryError(f"Acceptance fixture root is not a directory: {root}")

    handler = partial(NoStoreHTTPRequestHandler, directory=str(root))
    return AcceptanceFixtureServer((str(address), port), handler)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Serve BRunner acceptance fixtures without browser caching.",
    )
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args(argv)

    try:
        server = create_server(
            args.directory,
            bind=args.bind,
            port=args.port,
        )
    except (OSError, ValueError) as error:
        parser.error(str(error))

    host, port = server.server_address[:2]
    print(
        f"Serving no-store BRunner acceptance fixtures from "
        f"{args.directory.resolve()} on http://{host}:{port}",
        flush=True,
    )
    try:
        with server:
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
