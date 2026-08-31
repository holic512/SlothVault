"""
@file deploy/slothvault_deploy/release.py
@project SlothVault
@module Deployment release update checks
@description Compares the packaged deployment script and its managed SlothVault container with their immediately next published official GitHub Releases.
@logic Parse immutable release tags, fetch only published release records through the public API, select one adjacent upgrade target only when its history is known, pin the managed Compose image to that target, and keep remote or legacy-image failures explicit before any Docker update is attempted.
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
from .compose import (
    COMPOSE_FILE_NAME,
    compose_command,
    inspect_managed_application,
    pin_managed_application_image,
    require_managed_compose,
)
from .system import InstallerError, print_info, prompt_yes_no, run_command


RELEASE_TAG_PATTERN = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-build\.(0|[1-9]\d*))?$")
RELEASES_PER_PAGE = 100
MAX_RELEASE_PAGES = 10
REQUEST_TIMEOUT_SECONDS = 8
OFFICIAL_IMAGES = ("holic512/slothvault", "docker.io/holic512/slothvault")


@dataclass(frozen=True)
class ReleaseVersion:
    major: int
    minor: int
    patch: int
    build: Optional[int]
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
    next_application_release: Optional[PublishedRelease]
    next_script_release: Optional[PublishedRelease]
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
    major, minor, patch = (int(item) for item in match.groups()[:3])
    build = match.group(4)
    return ReleaseVersion(major, minor, patch, int(build) if build is not None else None, tag)


def compare_release_versions(left: ReleaseVersion, right: ReleaseVersion) -> int:
    left_value = (left.major, left.minor, left.patch)
    right_value = (right.major, right.minor, right.patch)
    if left_value != right_value:
        return (left_value > right_value) - (left_value < right_value)
    if left.build == right.build:
        return 0
    if left.build is None:
        return 1
    if right.build is None:
        return -1
    return (left.build > right.build) - (left.build < right.build)


def _release_sort_key(version: ReleaseVersion) -> tuple[int, int, int, int, int]:
    return (
        version.major,
        version.minor,
        version.patch,
        1 if version.build is None else 0,
        version.build if version.build is not None else 0,
    )


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
        key=lambda item: _release_sort_key(parse_release_tag(item.tag) or ReleaseVersion(0, 0, 0, None, item.tag)),
        reverse=True,
    )


def next_release_after(version: ReleaseVersion, releases: Iterable[PublishedRelease]) -> Optional[PublishedRelease]:
    """Return the one published Release immediately after a known version."""

    newer_releases = [
        release
        for release in releases
        if (release_version := parse_release_tag(release.tag))
        and compare_release_versions(release_version, version) > 0
    ]
    if not newer_releases:
        return None
    return min(
        newer_releases,
        key=lambda item: _release_sort_key(parse_release_tag(item.tag) or ReleaseVersion(0, 0, 0, None, item.tag)),
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
    additional_tags: Iterable[Optional[str]] = (),
    opener: Any = urlopen,
) -> list[PublishedRelease]:
    """Read enough public GitHub Release pages to locate every known local Release."""

    releases: list[PublishedRelease] = []
    required_tags = {tag for tag in (installed_tag, *additional_tags) if tag}
    found_tags = set()
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
            found_tags.update(release.tag for release in page_releases if release.tag in required_tags)
            if not required_tags or found_tags == required_tags or len(payload) < RELEASES_PER_PAGE:
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
    """Compare the managed application and this package with their next published Release without writing state."""

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
    application_release_tag = application_version.tag if application_version else None
    script_release_tag = script_version.tag if script_version else None

    try:
        releases = fetch_published_releases(
            RELEASE_REPOSITORY,
            application_release_tag,
            additional_tags=(script_release_tag,),
        )
    except ReleaseCheckError as error:
        return DeploymentUpdateCheck(
            repository=RELEASE_REPOSITORY,
            script_tag=RELEASE_TAG,
            script_commit_sha=RELEASE_COMMIT_SHA,
            application_tag=application_tag,
            application_commit_sha=application_commit_sha,
            application_image=application_image,
            next_application_release=None,
            next_script_release=None,
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

    latest_release = releases[0]
    latest_version = parse_release_tag(latest_release.tag)
    assert latest_version is not None
    application_comparison = compare_release_versions(application_version, latest_version) if application_version else None
    script_comparison = compare_release_versions(script_version, latest_version) if script_version else None
    history_complete = application_release_tag is not None and any(release.tag == application_release_tag for release in releases)
    script_history_complete = script_release_tag is not None and any(release.tag == script_release_tag for release in releases)
    next_application_release = next_release_after(application_version, releases) if application_version and history_complete else None
    next_script_release = next_release_after(script_version, releases) if script_version and script_history_complete else None
    application_update_available = next_application_release is not None
    script_update_available = next_script_release is not None
    return DeploymentUpdateCheck(
        repository=RELEASE_REPOSITORY,
        script_tag=RELEASE_TAG,
        script_commit_sha=RELEASE_COMMIT_SHA,
        application_tag=application_tag,
        application_commit_sha=application_commit_sha,
        application_image=application_image,
        next_application_release=next_application_release,
        next_script_release=next_script_release,
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


def release_image_reference(image: str, release_tag: str) -> str:
    """Replace an official image's mutable tag or digest with one Release tag."""

    version = parse_release_tag(release_tag)
    if version is None or not is_official_image(image):
        raise InstallerError("无法为非官方或无效的 SlothVault 镜像生成逐版本更新目标。")
    without_digest = image.split("@", 1)[0]
    repository = without_digest.rsplit(":", 1)[0] if ":" in without_digest else without_digest
    return "{0}:{1}".format(repository, version.tag)


def print_update_check(check: DeploymentUpdateCheck) -> None:
    """Print the human-readable read-only update result and one adjacent Release log."""

    print_info("部署脚本版本：{0}（提交 {1}）".format(_display_tag(check.script_tag), _display_commit(check.script_commit_sha)))
    print_info("当前应用版本：{0}（提交 {1}）".format(_display_tag(check.application_tag), _display_commit(check.application_commit_sha)))
    if check.application_image:
        print_info("当前应用镜像：{0}".format(check.application_image))
    if check.next_application_release is not None:
        print_info(
            "下一个可安装版本：{0}（提交 {1}）".format(
                check.next_application_release.tag,
                _display_commit(check.next_application_release.commit_sha),
            )
        )
        print_info("发布地址：{0}".format(check.next_application_release.html_url))
    if check.error:
        print_info("更新检查未完成：{0}".format(check.error))
    print_info("更新状态：{0}".format(check.status))
    if check.next_script_release is not None:
        print_info(
            "部署脚本可更新至下一个版本 {0}；请下载对应部署包后手动解压运行："
            " https://github.com/{1}/releases/download/{0}/slothvault-deploy.zip".format(
                check.next_script_release.tag,
                check.repository,
            )
        )
    if check.next_application_release is not None:
        release = check.next_application_release
        print_info("下一步升级提交日志：")
        print("\n[{0}] {1}".format(release.tag, release.title))
        print(release.notes or "（该 Release 未提供提交日志）")
        print(release.html_url)
    if not check.history_complete and check.application_tag:
        print_info("当前应用版本不在已获取的正式 Release 历史中，无法安全确定下一个升级版本。")


def update_managed_application(root: Path) -> None:
    """Advance a confirmed managed application by exactly one published Release."""

    initial = check_deployment_update(root)
    print_update_check(initial)
    compose_path = root / COMPOSE_FILE_NAME
    target_release = initial.next_application_release
    if target_release is not None:
        if not initial.application_image:
            raise InstallerError("无法读取当前应用镜像，无法安全执行逐版本更新。")
        target_image = release_image_reference(initial.application_image, target_release.tag)
        if not prompt_yes_no("确认拉取 {0} 并重启受管应用".format(target_release.tag), default=False):
            print_info("已取消更新，未拉取镜像或重启容器。")
            return
        pin_managed_application_image(compose_path, target_image)
    elif initial.status == "UP_TO_DATE":
        print_info("当前应用已是最新正式版本，不拉取镜像或重启容器。")
        return
    else:
        print_info("当前版本无法安全确定下一个 Release；不会拉取 latest 镜像或重启容器。")
        return

    for command in (("pull",), ("up", "-d"), ("ps",)):
        run_command(compose_command(compose_path, *command))

    verified = check_deployment_update(root)
    if verified.error or verified.application_tag != target_release.tag:
        raise InstallerError(
            "镜像更新命令已执行，但运行中的应用未确认达到目标版本 {0}；请检查容器日志和镜像拉取结果。".format(
                target_release.tag
            )
        )
    print_info("已更新并确认运行中的应用达到 {0}；持久化数据已保留。".format(target_release.tag))
