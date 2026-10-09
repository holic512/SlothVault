import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT_ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_module", SCRIPT_ROOT / "package_module.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class IndependentPackagesTest(unittest.TestCase):
    def test_only_current_modules_can_be_packaged(self):
        with tempfile.TemporaryDirectory() as tmp:
            for retired in ("mcp-client", "slothvault-runtime", "toolkit"):
                with self.assertRaisesRegex(ValueError, "unknown module"):
                    builder.package_module(retired, Path(tmp), "pending", [])

    def test_deterministic_archives_and_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            for module in ("skill", "deployment"):
                with self.subTest(module=module):
                    first, manifest_path, notes = builder.package_module(module, Path(tmp) / "one", "pending", ["test"])
                    second, _, _ = builder.package_module(module, Path(tmp) / "two", "pending", ["test"])
                    self.assertEqual(first.read_bytes(), second.read_bytes())
                    manifest = json.loads(manifest_path.read_text())
                    self.assertEqual(manifest["schema"], 1)
                    self.assertEqual(manifest["protocolMajor"], 1)
                    self.assertEqual(manifest["bridgeApiMajor"], 1)
                    builder.verify_package(first, manifest)
                    with tarfile.open(first) as archive:
                        self.assertTrue(all(item.name.startswith("package/") and item.isfile() for item in archive))
                        self.assertFalse(any("/tests/" in item.name or "__pycache__" in item.name for item in archive))
                    self.assertNotIn("README.md", manifest["files"])
                    self.assertNotIn("CHANGELOG.md", manifest["files"])
                    self.assertIn("pending", notes.read_text())

    def test_corrupt_archives_fail_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive, manifest_path, _ = builder.package_module("skill", Path(tmp), "pending", [])
            archive.write_bytes(archive.read_bytes() + b"corruption")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                builder.verify_package(archive, json.loads(manifest_path.read_text()))

    def test_missing_entry_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "integrations"
            shutil.copytree(builder.ROOT / "skill", root / "skill")
            entry = root / "skill/slothvault-mcp/SKILL.md"
            entry.unlink()
            with patch.object(builder, "ROOT", root):
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    builder.package_module("skill", Path(tmp) / "out", "pending", [])
                entry.symlink_to(root / "skill/module.json")
                with self.assertRaisesRegex(ValueError, "symbolic link"):
                    builder.package_module("skill", Path(tmp) / "out", "pending", [])

    def test_release_notes_require_versioned_changes(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            builder._notes("## 1.0.0\n- Old", "1.1.0")
        with self.assertRaisesRegex(ValueError, "no changes"):
            builder._notes("## 1.1.0\n\n## 1.0.0\n- Old", "1.1.0")

    def test_native_skill_metadata_and_references_are_shipped(self):
        source = builder.ROOT / "skill"
        metadata = json.loads((source / "module.json").read_text())
        skill = (source / "slothvault-mcp/SKILL.md").read_text()
        self.assertIn('name: slothvault-mcp', skill)
        self.assertIn(f'version: "{metadata["version"]}"', skill)
        self.assertEqual(metadata["version"], "1.2.0")
        self.assertNotIn("minPython", metadata)
        for relative in re.findall(r'\]\((references/[^)]+)\)', skill):
            self.assertTrue((source / "slothvault-mcp" / relative).is_file(), relative)
        # Inspect shipped text, not local files such as .DS_Store or bytecode caches.
        with tempfile.TemporaryDirectory() as tmp:
            archive_path, _, _ = builder.package_module("skill", Path(tmp), "pending", [])
            with tarfile.open(archive_path) as archive:
                combined = "\n".join(archive.extractfile(item).read().decode("utf-8")
                                     for item in archive.getmembers()
                                     if Path(item.name).suffix in {".md", ".yaml", ".py"})
        self.assertNotRegex(combined, r'slothvault-mcp\s+(doctor|setup|tools|profile)|--args-file|--yes|--key-stdin|mcp register')
        for invariant in ("targetVersionId", "check_draft", "VERSION_FROZEN", "resourceUri", "filePath", "commandId"):
            self.assertIn(invariant, combined)
        self.assertIn("allow_implicit_invocation: true", (source / "slothvault-mcp/agents/openai.yaml").read_text())

    def test_skill_archive_ignores_system_files_and_runs_checker_without_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "integrations"
            shutil.copytree(builder.ROOT / "skill", root / "skill")
            (root / "skill/slothvault-mcp/.DS_Store").write_bytes(b"\xff\x00")
            with patch.object(builder, "ROOT", root):
                path, manifest_path, _ = builder.package_module("skill", Path(tmp) / "out", "pending", [])
            files = json.loads(manifest_path.read_text())["files"]
            self.assertNotIn("slothvault-mcp/.DS_Store", files)
            for name in ("references/article-workflow.md", "references/technical-writing.md", "scripts/check_article.py"):
                self.assertIn("slothvault-mcp/" + name, files)
            # Extract only the verified regular files; do not rely on tar extraction policies.
            with tarfile.open(path) as archive:
                for item in archive.getmembers():
                    target = Path(tmp) / "installed" / item.name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(item).read())
            installed = Path(tmp) / "installed/package/slothvault-mcp"
            for source in installed.rglob("*.md"):
                for link in re.findall(r'\]\(([^)]+)\)', source.read_text()):
                    if "://" not in link:
                        self.assertTrue((source.parent / link.split("#")[0]).is_file(), link)
            result = subprocess.run([sys.executable, "scripts/check_article.py", "-", "--format", "json"],
                                    cwd=installed, input="短篇正文".encode(), capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["issues"], [])


if __name__ == "__main__":
    unittest.main()
