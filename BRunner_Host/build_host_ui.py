import subprocess
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def main():
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconsole",
        "--onefile",
        "--name",
        "BRunnerHost",
        "--hidden-import",
        "brunner_host",
        "--hidden-import",
        "pyautogui",
        "--exclude-module",
        "tkinter",
        "--exclude-module",
        "_tkinter",
        "host_ui.py",
    ]
    try:
        subprocess.run(command, cwd=BASE_DIR, check=True)
    except FileNotFoundError as error:
        raise SystemExit("PyInstaller is not installed.") from error
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from error


if __name__ == "__main__":
    main()
