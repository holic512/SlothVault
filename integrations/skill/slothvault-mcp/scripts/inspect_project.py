#!/usr/bin/env python3
"""
@file inspect_project.py
@project SlothVault
@module Project documentation source inspection
@description Produces a credential-free checkout baseline and change-to-document candidates without writing or networking.
@logic Inspect tracked non-symlink manifests, resolve commit differences, and match source paths to stable document keys.
@dependencies Python 3.10+ standard library, optional local git
@index_tags skill,documentation,baseline,git,read-only
@author holic512
"""
from __future__ import annotations
import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

SKIP = {'.git', 'node_modules', '.next', '.venv', 'venv', 'dist', 'target', '__pycache__'}
SHA = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')


def git(root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(['git', '-C', str(root), *args], env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'},
                                capture_output=True, timeout=30, check=False)
        return result.stdout.decode('utf-8', errors='replace').rstrip('\n') if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def remote_identity(remote: str) -> str | None:
    if '://' in remote:
        parsed = urlsplit(remote)
        if parsed.scheme not in {'https', 'http', 'ssh', 'git'} or not parsed.hostname:
            return None
        path = parsed.path
        host = parsed.hostname.lower()
    else:
        match = re.fullmatch(r'(?:[^@/:]+@)?([^/:]+):(.+)', remote)
        if not match:
            return None
        host, path = match[1].lower(), match[2]
        path = path.split('?', 1)[0].split('#', 1)[0]
    path = path.strip('/').removesuffix('.git')
    if not path or '..' in path.split('/') or not re.fullmatch(r'[\w./-]+', path):
        return None
    return host + '/' + path


def inspect(root: Path, previous: dict | None = None) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError('Project directory not found')
    head = git(root, 'rev-parse', '--verify', 'HEAD')
    if head and not SHA.fullmatch(head):
        head = None
    tracked = git(root, 'ls-files', '-z') if head else None
    if tracked is not None:
        files = sorted(set(filter(None, tracked.split('\0'))))
    else:
        files = []
        for folder, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if d not in SKIP and not (Path(folder) / d).is_symlink())
            files.extend((Path(folder) / n).relative_to(root).as_posix() for n in sorted(names))
            if len(files) > 10000:
                raise ValueError('Unversioned project exceeds 10000 files; select a smaller source directory')
    manifests = []; packages = []; digest = hashlib.sha256()
    for rel in files:
        p = root / rel
        if any(part in SKIP for part in Path(rel).parts) or p.is_symlink() or not p.is_file():
            continue
        if not p.resolve().is_relative_to(root):
            continue
        name = p.name
        if name not in {'package.json', 'pyproject.toml', 'Cargo.toml', 'pom.xml', 'go.mod'}:
            continue
        if p.stat().st_size > 1024 * 1024:
            continue
        raw = p.read_bytes(); digest.update(rel.encode() + b'\0' + raw)
        manifests.append(rel)
        if name == 'package.json':
            try:
                data = json.loads(raw)
                if isinstance(data, dict) and isinstance(data.get('version'), str):
                    packages.append({'path': rel, 'name': data.get('name', rel), 'version': data['version']})
            except (ValueError, UnicodeError):
                pass
        elif name in {'pyproject.toml', 'Cargo.toml'}:
            try:
                import tomllib
                data = tomllib.loads(raw.decode('utf-8'))
                section = data.get('project' if name == 'pyproject.toml' else 'package', {})
                if isinstance(section.get('version'), str):
                    packages.append({'path': rel, 'name': section.get('name', rel), 'version': section['version']})
            except (ImportError, ValueError, UnicodeError):
                pass
    origin = git(root, 'remote', 'get-url', 'origin') if head else None
    identity = remote_identity(origin) if origin else None
    if not identity and head:
        roots = git(root, 'rev-list', '--max-parents=0', 'HEAD') or ''
        identity = 'git:' + hashlib.sha256('\n'.join(sorted(roots.splitlines())).encode()).hexdigest()
    prefix = git(root, 'rev-parse', '--show-prefix') if head else None
    if identity and prefix:
        identity += '::' + prefix.rstrip('/')
    status = git(root, 'status', '--porcelain=v1', '-z') if head else None
    baseline = (previous or {}).get('sourceBaseline') or (previous or {}).get('baseline') or {}
    base_commit = baseline.get('commit')
    changed: list[str] = []; base_state = 'absent'
    if baseline and baseline.get('repositoryIdentity') != identity:
        base_state = 'identity-mismatch'
    elif base_commit and SHA.fullmatch(str(base_commit)) and head:
        raw = git(root, 'diff', '--relative', '--no-renames', '--name-only', '-z', base_commit, head, '--', '.')
        base_state = 'available' if raw is not None else 'unavailable'
        changed = sorted(set(filter(None, (raw or '').split('\0'))))
    elif baseline:
        base_state = 'unavailable'
    documents = (previous or {}).get('documents', [])
    affected = []
    for doc in documents:
        matches = [path for path in changed if any(fnmatch.fnmatchcase(path, pat) for pat in doc.get('sourcePaths', []))]
        if matches:
            affected.append({'key': doc['key'], 'changedFiles': matches})
    root_package = next((p for p in packages if p['path'] in {'package.json', 'pyproject.toml', 'Cargo.toml'}), None)
    return {'schemaVersion': 1, 'sourceBaseline': {'repositoryIdentity': identity, 'version': (root_package or {}).get('version'),
            'commit': head, 'packageVersions': {p['path']: p['version'] for p in packages}},
            'dirty': bool(status), 'baselineStatus': base_state, 'changedFiles': changed,
            'affectedDocuments': affected, 'manifestCandidates': manifests, 'packages': packages,
            'manualReview': ['Confirm unresolved manifest versions and external component versions.',
                             'Git changes identify candidates, not semantic documentation completeness.']}


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only local project inspection; no fetch, checkout, writes or network.')
    parser.add_argument('project'); parser.add_argument('--baseline', help='JSON from outline.documentationState or a previous source report')
    args = parser.parse_args()
    try:
        previous = json.loads(Path(args.baseline).read_text(encoding='utf-8')) if args.baseline else None
        if previous is not None and not isinstance(previous, dict):
            raise ValueError('Baseline must be an object')
        print(json.dumps(inspect(Path(args.project), previous), ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'error': 'INSPECTION_INPUT_ERROR', 'message': 'Cannot inspect this project or baseline; no files changed.'}))
        return 2

if __name__ == '__main__':
    sys.exit(main())
