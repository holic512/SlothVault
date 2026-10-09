#!/usr/bin/env python3
"""
@file package_module.py
@project SlothVault
@module Integration module release builder
@description Builds reproducible independent archives, manifests, and factual release notes.
@logic Read one module version, hash every shipped file, produce a deterministic tarball, and summarize passed checks.
@dependencies Python standard library, integrations module.json and CHANGELOG.md
@index_tags integrations,release,manifest,archive,sha256
@author holic512
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = {"skill", "deployment"}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _notes(changelog: str, version: str) -> str:
    match = re.search(rf"(?m)^## {re.escape(version)}\s*$", changelog)
    if not match:
        raise ValueError(f"CHANGELOG.md is missing the {version} section")
    following = re.search(r"(?m)^## ", changelog[match.end():])
    body = changelog[match.end():match.end() + following.start() if following else None].strip()
    if not body:
        raise ValueError(f"CHANGELOG.md has no changes for {version}")
    return body


def verify_package(archive_path: Path, manifest: dict[str, object]) -> None:
    if _sha256(archive_path.read_bytes()) != manifest["sha256"]:
        raise ValueError("archive SHA-256 does not match its manifest")
    actual: dict[str, str] = {}
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile() or not member.name.startswith("package/"):
                raise ValueError("archive contains an unsafe or unexpected entry")
            relative = member.name.removeprefix("package/")
            extracted = archive.extractfile(member)
            if not relative or extracted is None or relative in actual:
                raise ValueError("archive contains an invalid entry")
            actual[relative] = _sha256(extracted.read())
    if actual != manifest["files"]:
        raise ValueError("archive files do not match their manifest")


def package_module(module: str, outdir: Path, commit: str, checks: list[str]) -> tuple[Path, Path, Path]:
    if module not in MODULES:
        raise ValueError(f"unknown module: {module}")
    source = ROOT / module
    metadata = json.loads((source / "module.json").read_text(encoding="utf-8"))
    if metadata.get("schema") != 1 or metadata.get("module") != module or not re.fullmatch(r"\d+\.\d+\.\d+", metadata.get("version", "")):
        raise ValueError(f"invalid {module} module.json")
    version = metadata["version"]
    changed = _notes((source / "CHANGELOG.md").read_text(encoding="utf-8"), version)
    files: dict[str, str] = {}
    payload: list[tuple[str, bytes]] = []
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"{module} package contains a symbolic link: {path.relative_to(source)}")
        if not path.is_file() or path.name in {".DS_Store"} or any(part in {"tests", "__pycache__", ".venv"} for part in path.parts) or path.suffix in {".pyc", ".pyo"}:
            continue
        relative = path.relative_to(source).as_posix()
        if relative in {"README.md", "CHANGELOG.md"}:
            continue
        data = path.read_bytes()
        files[relative] = _sha256(data)
        payload.append((relative, data))
    if module == "skill" and "slothvault-mcp/SKILL.md" not in files:
        raise ValueError("Skill package is incomplete")
    if module == "deployment" and "install.py" not in files:
        raise ValueError("Deployment package is incomplete")
    outdir.mkdir(parents=True, exist_ok=True)
    asset = f"slothvault-{module}-{version}.tgz"
    archive_path = outdir / asset
    with archive_path.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as tar:
                for relative, data in payload:
                    info = tarfile.TarInfo(f"package/{relative}")
                    info.size = len(data)
                    info.mtime = 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mode = 0o755 if relative == "install.py" else 0o644
                    tar.addfile(info, io.BytesIO(data))
    manifest = {
        "schema": 1, "module": module, "version": version, "asset": asset,
        "sha256": _sha256(archive_path.read_bytes()), "bridgeApiMajor": metadata["bridgeApiMajor"],
        "protocolMajor": metadata["bridgeApiMajor"],
        **({"minPython": metadata["minPython"]} if "minPython" in metadata else {}),
        "files": files,
    }
    manifest_path = outdir / f"slothvault-{module}-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    verify_package(archive_path, manifest)
    checks_text = "\n".join(f"- {item}: passed" for item in checks)
    python_line = f'- Minimum Python: `{manifest["minPython"]}+`\n' if "minPython" in manifest else ""
    notes = (
        f"# SlothVault {module} {version}\n\n"
        f"## Changes\n\n{changed}\n\n"
        f"## Build result\n\n"
        f"- Status: success\n"
        f"- Source commit: `{commit}`\n"
        f"- Archive: `{asset}`\n"
        f"- Manifest: `slothvault-{module}-manifest.json`\n"
        f"- SHA-256: `{manifest['sha256']}`\n"
        f"- Module protocol major: `{manifest['protocolMajor']}`\n"
        f"{python_line}"
        f"\n## Checks\n\n{checks_text}\n"
    )
    notes_path = outdir / f"slothvault-{module}-release-notes.md"
    notes_path.write_text(notes, encoding="utf-8")
    return archive_path, manifest_path, notes_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("module", choices=sorted(MODULES))
    parser.add_argument("--outdir", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--check", action="append", default=[])
    args = parser.parse_args()
    print("\n".join(str(path) for path in package_module(args.module, args.outdir, args.commit, args.check)))
