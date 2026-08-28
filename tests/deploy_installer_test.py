"""Standard-library regression tests for the release deployment package."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPOSITORY_ROOT / "deploy"
sys.path.insert(0, str(DEPLOY_ROOT))

from slothvault_deploy import certbot, compose, nginx  # noqa: E402
from slothvault_deploy.system import InstallerError  # noqa: E402


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


class NginxRenderingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.proxy = nginx.NginxProxyConfig(
            executable="nginx",
            config_path=Path("/etc/nginx/conf.d/slothvault.conf"),
            enabled_path=None,
            server_names=("vault.example.com", "www.vault.example.com"),
            upstream_port=3000,
        )

    def test_https_config_keeps_acme_path_and_proxy_headers(self) -> None:
        source = nginx.render_https_proxy_config(
            self.proxy, Path("/data/slothvault/acme-challenge")
        )

        self.assertIn("listen 80;", source)
        self.assertIn("listen 443 ssl;", source)
        self.assertIn("location ^~ /.well-known/acme-challenge/", source)
        self.assertIn("return 301 https://$host$request_uri;", source)
        self.assertIn("/etc/letsencrypt/live/vault.example.com/fullchain.pem", source)
        self.assertIn("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", source)
        self.assertIn("proxy_pass http://127.0.0.1:3000;", source)

    def test_unmanaged_nginx_file_is_never_accepted_for_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "slothvault.conf"
            path.write_text("server {}\n", encoding="utf-8")
            proxy = nginx.NginxProxyConfig(
                executable="nginx",
                config_path=path,
                enabled_path=None,
                server_names=("vault.example.com",),
                upstream_port=3000,
            )
            with self.assertRaises(InstallerError):
                nginx.snapshot_nginx_site(proxy)


class CertbotTests(unittest.TestCase):
    def test_certificate_domains_reject_wildcards_and_ip_addresses(self) -> None:
        self.assertEqual(
            certbot.validate_certificate_domains(("vault.example.com", "www.vault.example.com")),
            ("vault.example.com", "www.vault.example.com"),
        )
        with self.assertRaises(InstallerError):
            certbot.validate_certificate_domains(("*.example.com",))
        with self.assertRaises(InstallerError):
            certbot.validate_certificate_domains(("192.0.2.1",))

    def test_debian_certbot_install_uses_apt_without_other_installers(self) -> None:
        with patch.object(certbot, "certbot_executable", side_effect=[None, "/usr/bin/certbot"]), patch.object(
            certbot, "read_os_release", return_value={"ID": "ubuntu", "ID_LIKE": "debian"}
        ), patch.object(certbot, "require_root"), patch.object(
            certbot.shutil, "which", return_value="/usr/bin/apt-get"
        ), patch.object(certbot, "run_command") as run_command:
            executable = certbot.ensure_certbot()

        self.assertEqual(executable, "/usr/bin/certbot")
        self.assertEqual(
            [call[0][0] for call in run_command.call_args_list],
            [("/usr/bin/apt-get", "update"), ("/usr/bin/apt-get", "install", "-y", "certbot")],
        )

    def test_unsupported_distribution_refuses_automatic_certbot_install(self) -> None:
        with patch.object(certbot, "certbot_executable", return_value=None), patch.object(
            certbot, "read_os_release", return_value={"ID": "arch"}
        ), patch.object(certbot, "require_root"):
            with self.assertRaisesRegex(InstallerError, "仅自动安装"):
                certbot.ensure_certbot()

    def test_fedora_certbot_install_uses_dnf(self) -> None:
        with patch.object(certbot, "certbot_executable", side_effect=[None, "/usr/bin/certbot"]), patch.object(
            certbot, "read_os_release", return_value={"ID": "fedora", "ID_LIKE": "fedora"}
        ), patch.object(certbot, "require_root"), patch.object(
            certbot.shutil, "which", return_value="/usr/bin/dnf"
        ), patch.object(certbot, "run_command") as run_command:
            executable = certbot.ensure_certbot()

        self.assertEqual(executable, "/usr/bin/certbot")
        self.assertEqual([call[0][0] for call in run_command.call_args_list], [("/usr/bin/dnf", "install", "-y", "certbot")])

    def test_active_certbot_timer_is_reused(self) -> None:
        systemd_runtime = unittest.mock.Mock()
        systemd_runtime.exists.return_value = True
        with patch.object(certbot.shutil, "which", return_value="/usr/bin/systemctl"), patch.object(
            certbot, "Path", return_value=systemd_runtime
        ), patch.object(certbot, "command_succeeds", side_effect=[True, True]):
            self.assertEqual(certbot.existing_certbot_timer(), "certbot.timer")

    def test_cron_fallback_is_generated_when_systemd_is_unavailable(self) -> None:
        with patch.object(certbot, "require_root"), patch.object(
            certbot, "existing_certbot_timer", return_value=None
        ), patch.object(certbot.shutil, "which", return_value=None), patch.object(
            certbot, "write_managed_host_file"
        ) as write_file:
            result = certbot.configure_automatic_renewal("/usr/bin/certbot")

        self.assertIn("/etc/cron.d/slothvault-certbot-renew", result)
        self.assertEqual(
            [call[0][0] for call in write_file.call_args_list],
            [certbot.CRON_WRAPPER_PATH, certbot.CRON_RENEWAL_PATH],
        )

    def test_dry_run_renewal_runs_deploy_hooks(self) -> None:
        with patch.object(certbot, "run_command") as run_command:
            certbot.renew_certificate("/usr/bin/certbot", dry_run=True)

        self.assertEqual(
            run_command.call_args[0][0],
            ("/usr/bin/certbot", "renew", "--quiet", "--dry-run", "--run-deploy-hooks"),
        )

    def test_renewal_sources_include_systemd_timer_and_cron_random_delay(self) -> None:
        self.assertIn("RandomizedDelaySec=3600", certbot.managed_systemd_timer_source())
        self.assertIn("renew --quiet", certbot.managed_systemd_service_source("/usr/bin/certbot"))
        self.assertIn("/dev/urandom", certbot.managed_cron_wrapper_source("/usr/bin/certbot"))
        self.assertIn("slothvault-certbot-renew", certbot.managed_cron_source())


if __name__ == "__main__":
    unittest.main()
