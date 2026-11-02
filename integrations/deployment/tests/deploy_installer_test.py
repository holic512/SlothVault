"""Standard-library regression tests for standalone deployment operations."""
from __future__ import annotations
import sys
import tempfile
import unittest
import json
import subprocess
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

DEPLOY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY_ROOT))
from slothvault_deploy import compose, release
from slothvault_deploy.system import InstallerError
import update
import status as instance

class InstanceSnapshotTests(unittest.TestCase):
    def test_absent_and_unmanaged_directories_do_not_invoke_docker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(instance, "_run") as command:
                self.assertEqual(instance.inspect_instance(directory)["state"], "absent")
                (Path(directory) / "compose.yml").write_text("services: {}\n", encoding="utf-8")
                self.assertEqual(instance.inspect_instance(directory)["state"], "unmanaged")
                command.assert_not_called()

    def test_managed_snapshot_selects_safe_fields_and_reports_partial_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "compose.yml").write_text(
                compose.render_compose(compose.DeploymentConfig(
                    root=root, data_dir=root / "data", provider="sqlite",
                    image="holic512/slothvault:v2.0.0", port=3000, encryption_key="secret-value",
                )), encoding="utf-8",
            )
            records = [{
                "Name": "/slothvault", "State": {"Status": "running", "Health": {"Status": "healthy"}},
                "Config": {"Image": "holic512/slothvault:v2.0.0", "Env": ["ENCRYPTION_KEY=secret-value"],
                           "Labels": {"com.docker.compose.service": "slothvault"}},
            }]
            with patch.object(instance, "_run", side_effect=[
                subprocess.CompletedProcess([], 0, "abc\n", ""),
                subprocess.CompletedProcess([], 0, json.dumps(records), ""),
            ]):
                snapshot = instance.inspect_instance(directory)
            self.assertEqual(snapshot["state"], "managed")
            self.assertEqual(snapshot["containers"][0]["health"], "healthy")
            self.assertEqual(snapshot["appVersion"], "v2.0.0")
            self.assertNotIn("secret-value", json.dumps(snapshot))
            with patch.object(instance, "_run", return_value=subprocess.CompletedProcess([], 1, "", "denied")):
                partial = instance.inspect_instance(directory)
            self.assertEqual(partial["errors"][0]["code"], "COMPOSE_PS_FAILED")


class ComposeRenderingTests(unittest.TestCase):
    def test_sqlite_loopback_rendering_keeps_private_data_contract(self) -> None:
        config = compose.DeploymentConfig(
            root=Path("/data/slothvault"),
            data_dir=Path("/data/slothvault/data"),
            provider="sqlite",
            image="holic512/slothvault:latest",
            port=3000,
            bind_loopback=True,
        )
        source = compose.render_compose(config)

        self.assertIn(compose.MANAGED_COMPOSE_MARKER, source)
        self.assertIn('"127.0.0.1:3000:3000"', source)
        self.assertIn('"/data/slothvault/data:/app/data"', source)

    def test_legacy_compose_marker_remains_operable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            compose_path = Path(directory) / "compose.yml"
            compose_path.write_text(
                "# Managed by SlothVault install.py\nservices: {}\n", encoding="utf-8"
            )
            compose.require_managed_compose(compose_path)


class ReleaseUpdateTests(unittest.TestCase):
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def read(self):
            import json

            return json.dumps(self.payload).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

    @staticmethod
    def release_payload(tag, notes=""):
        return {
            "tag_name": tag,
            "name": "SlothVault {0}".format(tag),
            "target_commitish": "{0}-sha".format(tag),
            "published_at": "2026-08-31T00:00:00.000Z",
            "html_url": "https://github.com/holic512/SlothVault/releases/tag/{0}".format(tag),
            "body": notes,
            "draft": False,
            "prerelease": False,
        }

    def managed_root(self):
        directory = tempfile.TemporaryDirectory()
        root = Path(directory.name)
        (root / "compose.yml").write_text(
            "# Managed by SlothVault deploy installer\nservices:\n  slothvault:\n    image: \"holic512/slothvault:latest\"\n",
            encoding="utf-8",
        )
        return directory, root

    def test_release_tags_compare_semver_before_build_number(self):
        current = release.parse_release_tag("v2.0.0-build.75")
        newer_build = release.parse_release_tag("v2.0.0-build.76")
        newer_minor = release.parse_release_tag("v2.1.0-build.1")

        self.assertIsNotNone(current)
        self.assertEqual(release.compare_release_versions(newer_build, current), 1)
        self.assertEqual(release.compare_release_versions(newer_minor, newer_build), 1)
        self.assertIsNone(release.parse_release_tag("v2.0-build.76"))

    def test_selects_latest_release_and_all_newer_logs(self):
        payload = [
            self.release_payload("v2.0.0-build.77", "newest"),
            self.release_payload("v2.0.0-build.76", "middle"),
            self.release_payload("v2.0.0-build.75", "installed"),
            {**self.release_payload("v2.0.0-build.78"), "prerelease": True},
        ]

        releases = release.fetch_published_releases(
            "holic512/SlothVault",
            "v2.0.0-build.75",
            opener=lambda request, timeout: self.Response(payload),
        )

        self.assertEqual([item.tag for item in releases], ["v2.0.0-build.77", "v2.0.0-build.76", "v2.0.0-build.75"])
        current = release.parse_release_tag("v2.0.0-build.75")
        self.assertIsNotNone(current)
        newer_releases = release.newer_releases_after(current, releases)
        self.assertEqual([item.tag for item in newer_releases], ["v2.0.0-build.76", "v2.0.0-build.77"])
        self.assertEqual([item.notes for item in newer_releases], ["middle", "newest"])

    def test_reads_application_identity_only_from_the_managed_container(self):
        tag, commit_sha, image = release.application_identity({
            "Config": {
                "Image": "holic512/slothvault:latest",
                "Env": ["SLOTHVAULT_RELEASE_TAG=v2.0.0-build.76", "SLOTHVAULT_RELEASE_COMMIT_SHA=abc123"],
                "Labels": {},
            }
        })

        self.assertEqual((tag, commit_sha, image), ("v2.0.0-build.76", "abc123", "holic512/slothvault:latest"))
        self.assertTrue(release.is_official_image(image))
        self.assertFalse(release.is_official_image("example.com/custom/slothvault:latest"))

    def test_check_targets_latest_only_when_current_release_is_known(self):
        package, root = self.managed_root()
        try:
            releases = [release._release_from_payload(self.release_payload(tag, tag)) for tag in (
                "v2.0.0-build.77", "v2.0.0-build.76", "v2.0.0-build.75"
            )]
            container = {"Config": {"Image": "holic512/slothvault:latest", "Env": [
                "SLOTHVAULT_RELEASE_TAG=v2.0.0-build.75"
            ]}}
            with patch.object(release, "inspect_managed_application", return_value=container), patch.object(
                release, "fetch_published_releases", return_value=releases
            ):
                checked = release.check_deployment_update(root)
            self.assertEqual(checked.latest_published_release.tag, "v2.0.0-build.77")
            self.assertEqual(checked.next_application_release.tag, "v2.0.0-build.77")
            self.assertEqual([item.tag for item in checked.newer_application_releases], [
                "v2.0.0-build.76", "v2.0.0-build.77"
            ])
            output = StringIO()
            with redirect_stdout(output):
                release.print_update_check(checked)
            self.assertLess(output.getvalue().index("[v2.0.0-build.76]"), output.getvalue().index("[v2.0.0-build.77]"))

            container["Config"]["Env"] = ["SLOTHVAULT_RELEASE_TAG=v2.0.0-build.74"]
            with patch.object(release, "inspect_managed_application", return_value=container), patch.object(
                release, "fetch_published_releases", return_value=releases
            ):
                unknown = release.check_deployment_update(root)
            self.assertEqual(unknown.status, "UNVERIFIABLE")
            self.assertIsNone(unknown.next_application_release)
            self.assertEqual(unknown.newer_application_releases, ())
        finally:
            package.cleanup()

    def test_update_confirms_once_and_verifies_locally_after_staged_pull(self):
        package, root = self.managed_root()
        try:
            target_release = release.PublishedRelease(
                tag="v2.0.0-build.77",
                title="SlothVault v2.0.0-build.77",
                commit_sha="next-sha",
                published_at=None,
                html_url="https://github.com/holic512/SlothVault/releases/tag/v2.0.0-build.77",
                notes="- newest update",
            )
            intermediate_release = release.PublishedRelease(
                tag="v2.0.0-build.76",
                title="SlothVault v2.0.0-build.76",
                commit_sha="middle-sha",
                published_at=None,
                html_url="https://github.com/holic512/SlothVault/releases/tag/v2.0.0-build.76",
                notes="- middle update",
            )
            initial = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                application_tag="v2.0.0-build.75",
                application_commit_sha="previous-sha",
                application_image="holic512/slothvault:latest",
                next_application_release=target_release,
                history_complete=True,
                status="APPLICATION_UPDATE_AVAILABLE",
                error=None,
                application_update_available=True,
                latest_published_release=target_release,
                newer_application_releases=(intermediate_release, target_release),
            )
            original = (root / "compose.yml").read_text()
            calls = []
            def execute(command, **kwargs):
                calls.append(command)
                if "pull" in command:
                    self.assertEqual((root / "compose.yml").read_text(), original)
                    staged = Path(command[command.index("-f") + 1])
                    self.assertIn('image: "holic512/slothvault:v2.0.0-build.77"', staged.read_text())
            with patch.object(update, "check_deployment_update", return_value=initial) as check, patch.object(
                update, "prompt_yes_no", return_value=True
            ) as confirm, patch.object(compose, "run_command"), patch.object(update, "run_command", side_effect=execute), patch.object(
                update, "verify_application", return_value={"currentVersion": target_release.tag, "verified": True, "health": "healthy"}
            ) as verify:
                result = update.update_managed_application(root)
            check.assert_called_once_with(root)
            confirm.assert_called_once()
            verify.assert_called_once_with(root / "compose.yml", target_release.tag, "holic512/slothvault:v2.0.0-build.77")
            self.assertEqual(result["outcome"], "updated")
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0][-2:], ("pull", "slothvault"))
            self.assertEqual(calls[1][-3:], ("up", "-d", "slothvault"))
            self.assertEqual(list(root.glob(".slothvault-update-*")), [])
            self.assertIn('image: "holic512/slothvault:v2.0.0-build.77"', (root / "compose.yml").read_text(encoding="utf-8"))
        finally:
            package.cleanup()

    def test_current_release_does_not_pull_or_restart(self):
        package, root = self.managed_root()
        try:
            current = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                application_tag="v2.0.0-build.76",
                application_commit_sha="latest-sha",
                application_image="holic512/slothvault:latest",
                next_application_release=None,
                history_complete=True,
                status="UP_TO_DATE",
                error=None,
                application_update_available=False,
            )
            with patch.object(update, "check_deployment_update", return_value=current), patch.object(
                update, "run_command"
            ) as run_command:
                update.update_managed_application(root)

            run_command.assert_not_called()
        finally:
            package.cleanup()

    def test_unverifiable_release_does_not_fall_back_to_the_latest_image(self):
        package, root = self.managed_root()
        try:
            unknown = release.DeploymentUpdateCheck(
                repository="holic512/SlothVault",
                application_tag=None,
                application_commit_sha=None,
                application_image="holic512/slothvault:latest",
                next_application_release=None,
                history_complete=False,
                status="UNVERIFIABLE",
                error=None,
                application_update_available=False,
            )
            with patch.object(update, "check_deployment_update", return_value=unknown), patch.object(
                update, "run_command"
            ) as run_command:
                with self.assertRaises(InstallerError):
                    update.update_managed_application(root)

            run_command.assert_not_called()
            self.assertIn('image: "holic512/slothvault:latest"', (root / "compose.yml").read_text(encoding="utf-8"))
        finally:
            package.cleanup()


class ApplicationVerificationTests(unittest.TestCase):
    def application(self, tag="v2.5.20", image="holic512/slothvault:v2.5.20", health=None, running=True):
        return {"Config": {"Image": image, "Env": ["SLOTHVAULT_RELEASE_TAG=" + tag]},
                "State": {"Running": running, "Health": {"Status": health}}}


    def test_verification_requires_running_identity_image_and_health(self):
        with patch.object(release, "inspect_managed_application", return_value=self.application()):
            self.assertEqual(release.verify_application(Path("/tmp/compose.yml"), "v2.5.20", "holic512/slothvault:v2.5.20")["health"], "not-configured")
        for app in [self.application(tag="v2.3.1"), self.application(health="unhealthy"),
                    self.application(running=False), self.application(image="holic512/slothvault:latest"), self.application(tag="")]:
            with patch.object(release, "inspect_managed_application", return_value=app), self.assertRaises(InstallerError):
                release.verify_application(Path("/tmp/compose.yml"), "v2.5.20", "holic512/slothvault:v2.5.20", timeout=0)
        with patch.object(release, "inspect_managed_application", side_effect=[self.application(health="starting"), self.application(health="healthy")]), patch.object(release.time, "sleep") as sleep:
            result = release.verify_application(Path("/tmp/compose.yml"), "v2.5.20", "holic512/slothvault:v2.5.20")
            self.assertTrue(result["verified"])
            sleep.assert_called_once_with(2)
        with patch.object(release, "inspect_managed_application", side_effect=InstallerError("unavailable")), self.assertRaises(InstallerError):
            release.verify_application(Path("/tmp/compose.yml"), "v2.5.20", "holic512/slothvault:v2.5.20", timeout=0)


    def test_health_verification_keeps_its_bounded_deadline(self):
        with patch.object(release, "inspect_managed_application", return_value=self.application(health="starting")), patch.object(release.time, "monotonic", side_effect=[0, 0, 0, 120, 120]), patch.object(release.time, "sleep") as sleep, self.assertRaises(InstallerError):
            release.verify_application(Path("/tmp/compose.yml"), "v2.5.20", "holic512/slothvault:v2.5.20")
        sleep.assert_called_once_with(2)

    def test_staged_pull_failure_preserves_config_and_post_recreation_does_not_rollback(self):
        helper = ReleaseUpdateTests()
        package, root = helper.managed_root()
        target = release.PublishedRelease("v2.5.20", "update", "sha", None, "https://example.org", "notes")
        check = release.DeploymentUpdateCheck(repository="holic512/SlothVault", application_tag="v2.3.1", application_commit_sha="old", application_image="holic512/slothvault:latest", next_application_release=target, history_complete=True, status="APPLICATION_UPDATE_AVAILABLE", error=None, application_update_available=True)
        try:
            original = (root / "compose.yml").read_text()
            for fail_at in ("pull", "up"):
                (root / "compose.yml").write_text(original)
                def execute(command, **kwargs):
                    if fail_at in command:
                        raise InstallerError("controlled failure")
                with patch.object(update, "check_deployment_update", return_value=check), patch.object(update, "prompt_yes_no", return_value=True), patch.object(compose, "run_command"), patch.object(update, "run_command", side_effect=execute), self.assertRaises(InstallerError):
                    update.update_managed_application(root)
                if fail_at == "pull":
                    self.assertEqual((root / "compose.yml").read_text(), original)
                else:
                    self.assertIn("holic512/slothvault:v2.5.20", (root / "compose.yml").read_text())
                self.assertEqual(list(root.glob(".slothvault-update-*")), [])
            with patch.object(update, "check_deployment_update", return_value=check), patch.object(update, "prompt_yes_no", return_value=False) as confirm, patch.object(update, "run_command") as execute:
                self.assertEqual(update.update_managed_application(root)["outcome"], "cancelled")
                confirm.assert_called_once()
                execute.assert_not_called()
        finally:
            package.cleanup()



class ComposeValidationTests(unittest.TestCase):
    def test_image_pinning_validates_quietly_and_restores_on_validation_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"compose.yml"
            original = '# Managed by SlothVault install.py\nservices:\n  slothvault:\n    image: "holic512/slothvault:v2.0.0"\n    ports:\n      - "127.0.0.1:3000:3000"\n'
            path.write_text(original)
            with patch.object(compose,"run_command") as command:
                compose.pin_managed_application_image(path,"holic512/slothvault:v2.0.1")
                command.assert_called_once_with(compose.compose_command(path,"config","--quiet"))
            self.assertIn('127.0.0.1:3000:3000',path.read_text())
            before=path.read_text()
            with patch.object(compose,"run_command",side_effect=InstallerError("invalid")), self.assertRaises(InstallerError):
                compose.pin_managed_application_image(path,"holic512/slothvault:v2.0.2")
            self.assertEqual(path.read_text(),before)
