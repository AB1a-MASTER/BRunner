import asyncio
import os
import sys
import traceback
from pathlib import Path


HOST_DIR = Path(__file__).resolve().parent
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

SERVE_HOST_FLAG = "--serve-host"
SELF_CHECK_FLAG = "--self-check"
SERVE_HOST_ENV = "BRUNNER_SERVE_HOST"
LAUNCHER_DEBUG_ENV = "BRUNNER_LAUNCHER_DEBUG"


def run_embedded_host():
    from brunner_host import main

    asyncio.run(main())


def should_serve_host(argv=None, environ=None):
    args = sys.argv if argv is None else argv
    env = os.environ if environ is None else environ
    value = str(env.get(SERVE_HOST_ENV, "")).strip().lower()
    return SERVE_HOST_FLAG in args or value in {"1", "true", "yes"}


def should_run_self_check(argv=None):
    args = sys.argv if argv is None else argv
    return SELF_CHECK_FLAG in args


def run_self_check():
    from app_paths import active_workflows_directory, application_directory, default_config_file
    from host_settings import load_or_create_config
    from workflow_location import ensure_writable_directory

    base_dir = application_directory(HOST_DIR / "app.py")
    config = load_or_create_config(default_config_file(base_dir), base_dir)
    ensure_writable_directory(active_workflows_directory(config, base_dir))
    return 0


def launcher_log_file():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "brunner_launcher.log"
    return HOST_DIR / "brunner_launcher.log"


def write_launcher_error(error):
    try:
        launcher_log_file().write_text(
            "".join(traceback.format_exception(type(error), error, error.__traceback__)),
            encoding="utf-8",
        )
    except Exception:
        pass


def write_launcher_debug(message):
    if str(os.environ.get(LAUNCHER_DEBUG_ENV, "")).strip() != "1":
        return
    try:
        with open(launcher_log_file(), "a", encoding="utf-8") as handle:
            handle.write(f"{message}\n")
    except Exception:
        pass


def main():
    write_launcher_debug(
        f"argv={sys.argv!r} frozen={getattr(sys, 'frozen', False)!r} "
        f"serve_env={os.environ.get(SERVE_HOST_ENV)!r}"
    )
    if should_run_self_check():
        write_launcher_debug("mode=self-check")
        try:
            return run_self_check()
        except Exception as error:
            write_launcher_error(error)
            return 2

    if should_serve_host():
        write_launcher_debug("mode=serve-host")
        try:
            run_embedded_host()
        except Exception as error:
            write_launcher_error(error)
            return 2
        return 0

    write_launcher_debug("mode=companion-app")
    from desktop.main_window import run_companion_app

    return run_companion_app()


if __name__ == "__main__":
    raise SystemExit(main())
