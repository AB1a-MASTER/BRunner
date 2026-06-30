import asyncio
import sys


def run_embedded_host():
    from brunner_host import main

    asyncio.run(main())


def main():
    if "--serve-host" in sys.argv:
        run_embedded_host()
        return 0

    from desktop.main_window import run_companion_app

    return run_companion_app()


if __name__ == "__main__":
    raise SystemExit(main())
