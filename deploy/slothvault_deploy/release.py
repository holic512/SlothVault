"""
@file deploy/slothvault_deploy/release.py
@project SlothVault
@module Deployment release update checks
@description Compares the packaged deployment script and its managed SlothVault container with published official GitHub Releases.
@logic Parse immutable release tags, fetch only published release records through the public API, retain the ordered upgrade path when possible, and keep remote or legacy-image failures explicit before any Docker update is attempted.
@dependencies Python standard library, Docker Compose v2, GitHub Releases REST API
@index_tags deployment,update,release,github,version,docker,commit-log
@author holic512
"""

from __future__ import annotations

import json
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import RELEASE_COMMIT_SHA, RELEASE_REPOSITORY, RELEASE_TAG
from .compose import COMPOSE_FILE_NAME, compose_command, inspect_managed_application, require_managed_compose
from .system import InstallerError, print_info, prompt_yes_no, run_command


RELEASE_TAG_PATTERN = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-build\.(0|[1-9]\d*)$")
RELEASES_PER_PAGE = 100
MAX_RELEASE_PAGES = 10
REQUEST_TIMEOUT_SECONDS = 8
OFFICIAL_IMAGES = ("holic512/slothvault", "docker.io/holic512/slothvault")


@dataclass(frozen=True, order=True)
class ReleaseVersion:
    major: int
    minor: int
    patch: int
    build: int
    tag: str


@dataclass(frozen=True)
class PublishedRelease:
    tag: str
    title: str
    commit_sha: Optional[str]
    published_at: Optional[str]
    html_url: str
    notes: str


@dataclass(frozen=True)
class DeploymentUpdateCheck:
    repository: str
    script_tag: Optional[str]
    script_commit_sha: Optional[str]
    application_tag: Optional[str]
    application_commit_sha: Optional[str]
    application_image: Optional[str]
    latest: Optional[PublishedRelease]
    missing_releases: tuple[PublishedRelease, ...]
    history_complete: bool
    status: str
    error: Optional[str]
    application_update_available: bool
    script_update_available: bool


class ReleaseCheckError(RuntimeError):
    """A public GitHub Release check failure that must not hide deployment state."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def parse_release_tag(value: Optional[str]) -> Optional[ReleaseVersion]:
    if not value:
        return None
    tag = value.strip()
    match = RELEASE_TAG_PATTERN.fullmatch(tag)
    if match is None:
        return None
    major, minor, patch, build = (int(item) for item in match.groups())
    return ReleaseVersion(major, minor, patch, build, tag)


def compare_release_versions(left: ReleaseVersion, right: ReleaseVersion) -> int:
    left_value = (left.major, left.minor, left.patch, left.build)
    right_value = (right.major, right.minor, right.patch, right.build)
    return (left_value > right_value) - (left_value < right_value)


def _release_from_payload(value: object) -> Optional[PublishedRelease]:
    if not isinstance(value, dict):
        return None
    if value.get("draft") is True or value.get("prerelease") is True:
        return None
    tag = value.get("tag_name")
    html_url = value.get("html_url")
    if not isinstance(tag, str) or parse_release_tag(tag) is None or not isinstance(html_url, str):
        return None
    title = value.get("name")
    commit_sha = value.get("target_commitish")
    published_at = value.get("published_at")
    notes = value.get("body")
    return PublishedRelease(
        tag=tag,
        title=title.strip() if isinstance(title, str) and title.strip() else tag,
        commit_sha=commit_sha.strip() if isinstance(commit_sha, str) and commit_sha.strip() else None,
        published_at=published_at if isinstance(published_at, str) else None,
        html_url=html_url,
        notes=notes if isinstance(notes, str) else "",
    )


def _sort_newest_first(releases: Iterable[PublishedRelease]) -> list[PublishedRelease]:
    return sorted(
        releases,
        key=lambda item: parse_release_tag(item.tag) or ReleaseVersion(0, 0, 0, 0, item.tag),
        reverse=True,
    )


def _release_check_error_for_status(status: int) -> ReleaseCheckError:
    if status == 404:
        return ReleaseCheckError("RELEASE_SOURCE_NOT_FOUND")
    if status in (403, 429):
        return ReleaseCheckError("RELEASE_RATE_LIMITED")
    return ReleaseCheckError("RELEASE_CHECK_FAILED")


def fetch_published_releases(
    repository: str,
    installed_tag: Optional[str],
    *,
    opener: Any = urlopen,
) -> list[PublishedRelease]:
    """Read enough public GitHub Release pages to locate the installed release when known."""

    releases: list[PublishedRelease] = []
    found_installed = False
    try:
        for page in range(1, MAX_RELEASE_PAGES + 1):
            request = Request(
                "https://api.github.com/repos/{0}/releases?per_page={1}&page={2}".format(
                    repository, RELEASES_PER_PAGE, page
                ),
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "SlothVault-Deploy-Update",
                },
            )
            with opener(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, list):
                raise ReleaseCheckError("RELEASE_CHECK_FAILED")
            page_releases = [release for release in (_release_from_payload(item) for item in payload) if release]
            releases.extend(page_releases)
            found_installed = found_installed or any(release.tag == installed_tag for release in page_releases)
            if not installed_tag or found_installed or len(payload) < RELEASES_PER_PAGE:
                break
    except HTTPError as error:
        raise _release_check_error_for_status(error.code) from error
    except (URLError, TimeoutError, socket.timeout) as error:
        raise ReleaseCheckError("RELEASE_REQUEST_TIMEOUT") from error
    except (UnicodeDecodeError, json.JSONDecodeError, OSError) as error:
        raise ReleaseCheckError("RELEASE_CHECK_FAILED") from error

    sorted_releases = _sort_newest_first(releases)
    if not sorted_releases:
        raise ReleaseCheckError("RELEASE_SOURCE_NOT_FOUND")
    return sorted_releases


def _environment_values(container: dict[str, object]) -> dict[str, str]:
    config = container.get("Config")
    if not isinstance(config, dict):
        return {}
    environment = config.get("Env")
    if not isinstance(environment, list):
        return {}
    values: dict[str, str] = {}
    for entry in environment:
        if not isinstance(entry, str) or "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        values[key] = value
    return values


def _label_values(container: dict[str, object]) -> dict[str, str]:
    config = container.get("Config")
    if not isinstance(config, dict):
        return {}
    labels = config.get("Labels")
    if not isinstance(labels, dict):
        return {}
    return {key: value for key, value in labels.items() if isinstance(key, str) and isinstance(value, str)}


def application_identity(container: dict[str, object]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Return the running application release tag, commit SHA, and image from one managed container."""

    config = container.get("Config")
    image = config.get("Image") if isinstance(config, dict) and isinstance(config.get("Image"), str) else None
    environment = _environment_values(container)
    labels = _label_values(container)
    tag = environment.get("SLOTHVAULT_RELEASE_TAG") or labels.get("org.opencontainers.image.version")
    commit_sha = environment.get("SLOTHVAULT_RELEASE_COMMIT_SHA") or labels.get("org.opencontainers.image.revision")
    return tag or None, commit_sha or None, image


def is_official_image(image: Optional[str]) -> bool:
    if not image:
        return False
    normalized = image.split("@", 1)[0].split(":", 1)[0]
    return normalized in OFFICIAL_IMAGES


def _status_for(
    *,
    application_update_available: bool,
    script_update_available: bool,
    application_local_newer: bool,
    script_local_newer: bool,
    application_verifiable: bool,
    error: Optional[str],
    custom_image: bool,
) -> str:
    if error:
        return "CHECK_FAILED"
    if custom_image:
        return "CUSTOM_IMAGE"
    if application_update_available and script_update_available:
        return "BOTH_UPDATE_AVAILABLE"
    if application_update_available:
        return "APPLICATION_UPDATE_AVAILABLE"
    if script_update_available:
        return "SCRIPT_UPDATE_AVAILABLE"
    if application_local_newer or script_local_newer:
        return "LOCAL_NEWER"
    if not application_verifiable:
        return "UNVERIFIABLE"
    return "UP_TO_DATE"


def check_deployment_update(root: Path) -> DeploymentUpdateCheck:
    """Compare the managed application and this package with the latest published Release without writing state."""

    compose_path = root / COMPOSE_FILE_NAME
    require_managed_compose(compose_path)
    application_tag: Optional[str] = None
    application_commit_sha: Optional[str] = None
    application_image: Optional[str] = None
    application_problem: Optional[str] = None
    try:
        container = inspect_managed_application(compose_path)
        application_tag, application_commit_sha, application_image = application_identity(container)
    except InstallerError as error:
        application_problem = str(error)

    custom_image = application_problem is None and not is_official_image(application_image)
    application_version = parse_release_tag(application_tag) if not custom_image else None
    script_version = parse_release_tag(RELEASE_TAG)

    try:
        releases = fetch_published_releases(RELEASE_REPOSITORY, application_tag if application_version else None)
    except ReleaseCheckError as error:
        return DeploymentUpdateCheck(
            repository=RELEASE_REPOSITORY,
            script_tag=RELEASE_TAG,
            script_commit_sha=RELEASE_COMMIT_SHA,
            application_tag=application_tag,
            application_commit_sha=application_commit_sha,
            application_image=application_image,
            latest=None,
            missing_releases=(),
            history_complete=False,
            status=_status_for(
                application_update_available=False,
                script_update_available=False,
                application_local_newer=False,
                script_local_newer=False,
                application_verifiable=application_version is not None,
                error=error.code,
                custom_image=custom_image,
            ),
            error=error.code,
            application_update_available=False,
            script_update_available=False,
        )

    latest = releases[0]
    latest_version = parse_release_tag(latest.tag)
    assert latest_version is not None
    application_comparison = compare_release_versions(application_version, latest_version) if application_version else None
    script_comparison = compare_release_versions(script_version, latest_version) if script_version else None
    history_complete = application_tag is not None and any(release.tag == application_tag for release in releases)
    missing_releases = tuple(
        sorted(
            (
                release
                for release in releases
                if application_version
                and (release_version := parse_release_tag(release.tag))
                and compare_release_versions(release_version, application_version) > 0
            ),
            key=lambda item: parse_release_tag(item.tag) or ReleaseVersion(0, 0, 0, 0, item.tag),
        )
    )
    application_update_available = application_comparison is not None and application_comparison < 0
    script_update_available = script_comparison is not None and script_comparison < 0
    return DeploymentUpdateCheck(
        repository=RELEASE_REPOSITORY,
        script_tag=RELEASE_TAG,
        script_commit_sha=RELEASE_COMMIT_SHA,
        application_tag=application_tag,
        application_commit_sha=application_commit_sha,
        application_image=application_image,
        latest=latest,
        missing_releases=missing_releases,
        history_complete=history_complete,
        status=_status_for(
            application_update_available=application_update_available,
            script_update_available=script_update_available,
            application_local_newer=application_comparison is not None and application_comparison > 0,
            script_local_newer=script_comparison is not None and script_comparison > 0,
            application_verifiable=application_version is not None,
            error=None,
            custom_image=custom_image,
        ),
        error=application_problem,
        application_update_available=application_update_available,
        script_update_available=script_update_available,
    )


def _display_tag(tag: Optional[str]) -> str:
    return tag or "未嵌入发布标识"


def _display_commit(commit_sha: Optional[str]) -> str:
    return commit_sha[:12] if commit_sha else "不可用"


def print_update_check(check: DeploymentUpdateCheck) -> None:
    """Print the human-readable read-only update result and its plain-text Release logs."""

    print_info("部署脚本版本：{0}（提交 {1}）".format(_display_tag(check.script_tag), _display_commit(check.script_commit_sha)))
    print_info("当前应用版本：{0}（提交 {1}）".format(_display_tag(check.application_tag), _display_commit(check.application_commit_sha)))
    if check.application_image:
        print_info("当前应用镜像：{0}".format(check.application_image))
    if check.latest is not None:
        print_info("最新正式版本：{0}（提交 {1}）".format(check.latest.tag, _display_commit(check.latest.commit_sha)))
        print_info("发布地址：{0}".format(check.latest.html_url))
    if check.error:
        print_info("更新检查未完成：{0}".format(check.error))
    print_info("更新状态：{0}".format(check.status))
    if check.script_update_available:
        print_info(
            "部署脚本存在新版本；请下载最新部署包后手动解压运行："
            " https://github.com/{0}/releases/latest/download/slothvault-deploy.zip".format(check.repository)
        )
    if check.latest and check.missing_releases:
        print_info("本次升级包含以下提交日志：")
        for release in check.missing_releases:
            print("\n[{0}] {1}".format(release.tag, release.title))
            print(release.notes or "（该 Release 未提供提交日志）")
            print(release.html_url)
    if check.latest and not check.history_complete and check.application_tag:
        print_info("当前应用版本不在已获取的正式 Release 历史中，无法确认完整累计日志。")


def update_managed_application(root: Path) -> None:
    """Run a confirmed Docker image update and verify that the managed application reached the target release."""

    initial = check_deployment_update(root)
    print_update_check(initial)
    compose_path = root / COMPOSE_FILE_NAME
    if initial.application_update_available:
        if not prompt_yes_no("确认拉取最新 SlothVault 镜像并重启受管应用", default=False):
            print_info("已取消更新，未拉取镜像或重启容器。")
            return
    elif initial.status == "UP_TO_DATE":
        print_info("当前应用已是最新正式版本，不拉取镜像或重启容器。")
        return
    else:
        if not prompt_yes_no("当前版本无法可靠比较，是否仍按原方式拉取镜像并重启受管应用", default=False):
            print_info("已取消更新，未拉取镜像或重启容器。")
            return

    for command in (("pull",), ("up", "-d"), ("ps",)):
        run_command(compose_command(compose_path, *command))

    verified = check_deployment_update(root)
    if initial.application_update_available and initial.latest and (verified.error or verified.application_tag != initial.latest.tag):
        raise InstallerError(
            "镜像更新命令已执行，但运行中的应用未确认达到目标版本 {0}；请检查容器日志和镜像拉取结果。".format(
                initial.latest.tag
            )
        )
    if initial.application_update_available:
        print_info("已更新并确认运行中的应用达到 {0}；持久化数据已保留。".format(initial.latest.tag))
        return
    print_info(
        "已执行 {0} 中声明镜像的 pull/up；由于更新前版本不可可靠比较，未声明应用已达到特定 Release。".format(
            compose_path
        )
    )
