import argparse
import json
import shutil
import zipfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
EXTENSION_DIR = ROOT_DIR / "BRunner"
HOST_DIR = ROOT_DIR / "BRunner_Host"
DEFAULT_RELEASE_DIR = ROOT_DIR / "release"

EXTENSION_PACKAGE_NAME = "BRunner-extension.zip"
HOST_PACKAGE_NAME = "BRunnerHost.exe"
HOST_EXE = HOST_DIR / "dist" / "BRunnerHost.exe"
REQUIRED_EXTENSION_FILES = {"manifest.json", "background.js"}

EXTENSION_EXCLUDE_PATTERNS = [
    "New folder/",
    "studio-graph-src/",
    "__pycache__/",
    "test.html",
    "todo",
    "icons/icon1.jfif",
    "icons/icon3.jfif",
    "icons/icon4.jfif",
]


def normalize_path(path):
    return str(path).replace("\\", "/")


def is_extension_excluded(relative_path, is_dir=False):
    normalized = normalize_path(relative_path).strip("/")
    candidate = f"{normalized}/" if is_dir and normalized else normalized
    for pattern in EXTENSION_EXCLUDE_PATTERNS:
        clean = pattern.strip("/")
        if pattern.endswith("/"):
            if candidate == pattern or normalized == clean or normalized.startswith(f"{clean}/"):
                return True
        elif normalized == clean:
            return True
    return False


def extension_files(extension_dir=EXTENSION_DIR):
    base = Path(extension_dir)
    files = []
    for path in sorted(base.rglob("*")):
        relative = path.relative_to(base)
        if path.is_dir():
            continue
        if any(is_extension_excluded(parent, is_dir=True) for parent in relative.parents if str(parent) != "."):
            continue
        if is_extension_excluded(relative):
            continue
        files.append(relative)
    return files


def package_extension(extension_dir=EXTENSION_DIR, output_file=None):
    base = Path(extension_dir)
    target = Path(output_file or DEFAULT_RELEASE_DIR / EXTENSION_PACKAGE_NAME)
    if not (base / "manifest.json").is_file():
        raise FileNotFoundError(f"Missing extension manifest: {base / 'manifest.json'}")

    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for relative in extension_files(base):
            archive.write(base / relative, normalize_path(relative))
    return target


def package_host_executable(host_exe=HOST_EXE, output_file=None):
    source = Path(host_exe)
    target = Path(output_file or DEFAULT_RELEASE_DIR / HOST_PACKAGE_NAME)
    if not source.is_file():
        raise FileNotFoundError(f"Missing host executable: {source}")
    if source.stat().st_size < 2 or source.read_bytes()[:2] != b"MZ":
        raise ValueError(f"Host artifact is not a Windows executable: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return target


def build_release(output_dir=DEFAULT_RELEASE_DIR):
    destination = Path(output_dir)
    extension = package_extension(EXTENSION_DIR, destination / EXTENSION_PACKAGE_NAME)
    host = package_host_executable(HOST_EXE, destination / HOST_PACKAGE_NAME)
    artifacts = [extension, host]
    validate_release_artifacts(destination)
    return artifacts


def validate_release_artifacts(output_dir=DEFAULT_RELEASE_DIR):
    destination = Path(output_dir)
    if not destination.is_dir():
        raise FileNotFoundError(f"Missing release directory: {destination}")

    files = sorted(path.name for path in destination.iterdir() if path.is_file())
    expected = sorted([EXTENSION_PACKAGE_NAME, HOST_PACKAGE_NAME])
    if files != expected or any(path.is_dir() for path in destination.iterdir()):
        raise ValueError(
            "Release directory must contain exactly BRunner-extension.zip and BRunnerHost.exe."
        )

    host = destination / HOST_PACKAGE_NAME
    if host.stat().st_size < 2 or host.read_bytes()[:2] != b"MZ":
        raise ValueError("Packaged host is not a valid Windows executable artifact.")

    extension = destination / EXTENSION_PACKAGE_NAME
    try:
        with zipfile.ZipFile(extension) as archive:
            names = set(archive.namelist())
            missing = REQUIRED_EXTENSION_FILES - names
            if missing:
                raise ValueError(
                    f"Extension archive is missing required files: {', '.join(sorted(missing))}."
                )
            manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
    except (zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Extension artifact is not a valid BRunner archive.") from error
    if manifest.get("manifest_version") not in {2, 3}:
        raise ValueError("Extension manifest version is unsupported.")
    return {
        "extension": extension,
        "host": host,
        "manifestVersion": manifest["manifest_version"],
        "extensionFileCount": len(names),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Build the final two BRunner release artifacts.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_RELEASE_DIR),
        help="Directory that receives BRunner-extension.zip and BRunnerHost.exe.",
    )
    args = parser.parse_args(argv)

    artifacts = build_release(args.output_dir)
    print("Release artifacts:")
    for artifact in artifacts:
        print(f"- {artifact}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
