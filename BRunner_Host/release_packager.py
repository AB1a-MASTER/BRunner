import shutil
from pathlib import Path

from atomic_io import atomic_write_json
from packaging_config import APP_NAME, RELEASE_EXCLUDE_PATTERNS


RELEASE_DOCS = ("README.md",)


def normalize_release_name(version=""):
    suffix = str(version or "").strip()
    if suffix:
        safe = "".join(ch if ch.isalnum() or ch in ".-_" else "-" for ch in suffix)
        return f"{APP_NAME}-{safe}"
    return APP_NAME


def is_release_excluded(relative_path, is_dir=False):
    path = Path(relative_path)
    normalized = path.as_posix().strip("/")
    if not normalized:
        return False

    path_parts = set(path.parts)
    for pattern in RELEASE_EXCLUDE_PATTERNS:
        clean = pattern.strip().replace("\\", "/").strip("/")
        if not clean:
            continue
        if pattern.endswith("/"):
            folder = Path(clean).parts[0]
            if folder in path_parts:
                return True
            continue
        if normalized == clean or normalized.endswith(f"/{clean}"):
            return True
        if _wildcard_match(normalized, clean):
            return True
        if is_dir and normalized == clean.rstrip("/"):
            return True
    return False


def build_release_manifest(host_dir, version=""):
    root = Path(host_dir).resolve()
    exe_path = root / "dist" / f"{APP_NAME}.exe"
    if not exe_path.is_file():
        raise FileNotFoundError(f"Built executable not found: {exe_path}")

    files = [
        {
            "source": exe_path,
            "target": Path(f"{APP_NAME}.exe"),
            "kind": "executable",
        }
    ]

    for name in RELEASE_DOCS:
        source = root / name
        if source.is_file() and not is_release_excluded(name):
            files.append({
                "source": source,
                "target": Path(name),
                "kind": "documentation",
            })

    return {
        "name": normalize_release_name(version),
        "files": files,
        "excludedPatterns": list(RELEASE_EXCLUDE_PATTERNS),
    }


def stage_release_bundle(host_dir, output_dir, version=""):
    manifest = build_release_manifest(host_dir, version)
    output_root = Path(output_dir).resolve() / manifest["name"]
    output_root.mkdir(parents=True, exist_ok=True)

    staged = []
    for entry in manifest["files"]:
        target = output_root / entry["target"]
        if is_release_excluded(entry["target"], is_dir=False):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(entry["source"], target)
        staged.append({
            "target": entry["target"].as_posix(),
            "kind": entry["kind"],
            "bytes": target.stat().st_size,
        })

    manifest_path = output_root / "release_manifest.json"
    atomic_write_json(
        manifest_path,
        {
            "name": manifest["name"],
            "files": staged,
            "excludedPatterns": manifest["excludedPatterns"],
        },
        indent=2,
    )
    return output_root


def _wildcard_match(path, pattern):
    from fnmatch import fnmatch

    return fnmatch(path, pattern) or fnmatch(Path(path).name, pattern)


def main(argv=None):
    import argparse

    parser = argparse.ArgumentParser(description="Stage a BRunner companion release bundle.")
    parser.add_argument("--host-dir", default=Path(__file__).resolve().parent)
    parser.add_argument("--output-dir", default=Path(__file__).resolve().parent / "release")
    parser.add_argument("--version", default="")
    args = parser.parse_args(argv)

    output_root = stage_release_bundle(args.host_dir, args.output_dir, args.version)
    print(f"Release bundle staged at {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
