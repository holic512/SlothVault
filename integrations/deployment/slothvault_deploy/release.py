"""
@file integrations/deployment/slothvault_deploy/release.py
@project SlothVault
@module Deployment release update checks
@description Compares the managed SlothVault container with the latest published official GitHub Release.
@logic Fix one confirmed Release target, pull with private staged configuration, activate before recreation, and verify the running container locally without another network query.
@dependencies Python standard library, Docker Compose v2, GitHub Releases REST API
@index_tags deployment,update,release,github,version,docker,commit-log
@author holic512
"""

from __future__ import annotations

import json
import os
import re
import socket
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import RELEASE_REPOSITORY, __version__
from .compose import (
    COMPOSE_FILE_NAME,
    compose_command,
    inspect_managed_application,
    pin_managed_application_image,
    require_managed_compose,
)
from .system import InstallerError, print_info, prompt_yes_no, run_command, publish_event, report_progress, write_text_atomically, bridge_active


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
    application_tag: Optional[str]
    application_commit_sha: Optional[str]
    application_image: Optional[str]
    next_application_release: Optional[PublishedRelease]
    history_complete: bool
    status: str
    error: Optional[str]
    application_update_available: bool
    latest_published_release: Optional[PublishedRelease] = None
    newer_application_releases: tuple[PublishedRelease, ...] = ()


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


def newer_releases_after(version: ReleaseVersion, releases: Iterable[PublishedRelease]) -> tuple[PublishedRelease, ...]:
    """Return all published Releases newer than a known version, oldest first."""

    newer_releases = [
        release
        for release in releases
        if (release_version := parse_release_tag(release.tag))
        and compare_release_versions(release_version, version) > 0
    ]
    return tuple(sorted(
        newer_releases,
        key=lambda item: _release_sort_key(parse_release_tag(item.tag) or ReleaseVersion(0, 0, 0, None, item.tag)),
    ))


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
    application_local_newer: bool,
    application_verifiable: bool,
    error: Optional[str],
    custom_image: bool,
) -> str:
    if error:
        return "CHECK_FAILED"
    if custom_image:
        return "CUSTOM_IMAGE"
    if application_update_available:
        return "APPLICATION_UPDATE_AVAILABLE"
    if application_local_newer:
        return "LOCAL_NEWER"
    if not application_verifiable:
        return "UNVERIFIABLE"
    return "UP_TO_DATE"


def check_deployment_update(root: Path) -> DeploymentUpdateCheck:
    """Compare the managed application with the latest published Release without writing state."""

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
    application_release_tag = application_version.tag if application_version else None

    try:
        releases = fetch_published_releases(
            RELEASE_REPOSITORY,
            application_release_tag,
        )
    except ReleaseCheckError as error:
        return DeploymentUpdateCheck(
            repository=RELEASE_REPOSITORY,
            application_tag=application_tag,
            application_commit_sha=application_commit_sha,
            application_image=application_image,
            next_application_release=None,
            history_complete=False,
            status=_status_for(
                application_update_available=False,
                application_local_newer=False,
                application_verifiable=application_version is not None,
                error=error.code,
                custom_image=custom_image,
            ),
            error=error.code,
            application_update_available=False,
        )

    latest_release = releases[0]
    latest_version = parse_release_tag(latest_release.tag)
    assert latest_version is not None
    application_comparison = compare_release_versions(application_version, latest_version) if application_version else None
    history_complete = application_release_tag is not None and any(release.tag == application_release_tag for release in releases)
    newer_application_releases = newer_releases_after(application_version, releases) if application_version and history_complete else ()
    next_application_release = newer_application_releases[-1] if newer_application_releases else None
    application_update_available = next_application_release is not None
    return DeploymentUpdateCheck(
        repository=RELEASE_REPOSITORY,
        application_tag=application_tag,
        application_commit_sha=application_commit_sha,
        application_image=application_image,
        next_application_release=next_application_release,
        history_complete=history_complete,
        status=_status_for(
            application_update_available=application_update_available,
            application_local_newer=application_comparison is not None and application_comparison > 0,
            application_verifiable=application_version is not None and history_complete,
            error=None,
            custom_image=custom_image,
        ),
        error=application_problem,
        application_update_available=application_update_available,
        latest_published_release=latest_release,
        newer_application_releases=newer_application_releases,
    )


def _display_tag(tag: Optional[str]) -> str:
    return tag or "未嵌入发布标识"


def _display_commit(commit_sha: Optional[str]) -> str:
    return commit_sha[:12] if commit_sha else "不可用"


def release_image_reference(image: str, release_tag: str) -> str:
    """Replace an official image's mutable tag or digest with one Release tag."""

    version = parse_release_tag(release_tag)
    if version is None or not is_official_image(image):
        raise InstallerError("无法为非官方或无效的 SlothVault 镜像生成更新目标。")
    without_digest = image.split("@", 1)[0]
    repository = without_digest.rsplit(":", 1)[0] if ":" in without_digest else without_digest
    return "{0}:{1}".format(repository, version.tag)


def print_update_check(check: DeploymentUpdateCheck) -> None:
    """Print the read-only update result and all newer official Release logs."""

    print_info("SlothVault 部署脚本包版本：{0}（使用 slothtool slothvault deploy package update 更新）".format(__version__))
    print_info("当前应用版本：{0}（提交 {1}）".format(_display_tag(check.application_tag), _display_commit(check.application_commit_sha)))
    if check.application_image:
        print_info("当前应用镜像：{0}".format(check.application_image))
    if check.latest_published_release is not None:
        print_info("GitHub 最新正式版本：{0}".format(check.latest_published_release.tag))
    if check.next_application_release is not None:
        print_info(
            "本次更新目标版本：{0}（提交 {1}）".format(
                check.next_application_release.tag,
                _display_commit(check.next_application_release.commit_sha),
            )
        )
        print_info("发布地址：{0}".format(check.next_application_release.html_url))
    if check.error:
        print_info("更新检查未完成：{0}".format(check.error))
    print_info("更新状态：{0}".format(check.status))
    if check.newer_application_releases:
        print_info("本次跨版本更新包含的提交日志：")
        for release in check.newer_application_releases:
            print("\n[{0}] {1}".format(release.tag, release.title))
            print(release.notes or "（该 Release 未提供提交日志）")
            print(release.html_url)
    if not check.history_complete and check.application_tag:
        print_info("当前应用版本不在已获取的正式 Release 历史中，无法安全确定更新目标。")


def verify_application(compose_path: Path, target_tag: str, target_image: str, timeout: float = 120) -> dict[str, object]:
    """Verify the running container locally, independently of Release network availability."""
    deadline = time.monotonic() + timeout
    while True:
        remaining = max(0, deadline - time.monotonic())
        try:
            container = inspect_managed_application(compose_path, timeout=max(0.01, min(12, remaining / 2)))
        except InstallerError:
            container = None
        if container:
            actual_tag, _, actual_image = application_identity(container)
            state = container.get("State", {})
            health = state.get("Health", {}).get("Status")
            if health == "unhealthy":
                raise InstallerError("目标应用健康检查失败，请检查应用日志。")
            if state.get("Running") is True and actual_tag == target_tag and actual_image == target_image and health in (None, "healthy"):
                return {"currentVersion": actual_tag, "runtimeImage": actual_image, "verified": True,
                        "health": health or "not-configured"}
            if actual_tag and actual_tag != target_tag:
                raise InstallerError("运行中的应用版本仍为 {0}，未达到目标 {1}。".format(actual_tag, target_tag))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise InstallerError("应用版本或健康状态未在 120 秒内通过核验；请查看实际容器状态。")
        publish_event("progress", {"phase": "verify", "heartbeat": True, "status": "running"})
        time.sleep(min(2, remaining))


def update_managed_application(root: Path) -> dict[str, object]:
    """Review one immutable target, pull before activation, and verify the actual running application."""
    report_progress("release", stageIndex=1, stageCount=5, status="running")
    initial = check_deployment_update(root)
    publish_event("update", asdict(initial))
    # The bridge presents notes separately; the ordinary CLI retains its complete output.
    if not bridge_active():
        print_update_check(initial)
    compose_path = root / COMPOSE_FILE_NAME
    target_release = initial.next_application_release
    outcome = {"currentVersion": initial.application_tag, "beforeVersion": initial.application_tag, "verified": False}
    if initial.error:
        raise InstallerError("无法检查应用更新：{0}。当前运行版本未改变。".format(initial.error))
    if target_release is not None:
        if not initial.application_image:
            raise InstallerError("无法读取当前应用镜像，无法安全执行更新。")
        target_image = release_image_reference(initial.application_image, target_release.tag)
        outcome["targetVersion"] = target_release.tag
        publish_event("preview", {"currentVersion": initial.application_tag, "targetVersion": target_release.tag,
                                  "image": target_image, "root": str(root), "impact": "restart-application",
                                  "releaseCount": len(initial.newer_application_releases)})
        report_progress("release", stageIndex=1, stageCount=5, status="completed")
        if not prompt_yes_no("确认拉取 {0} 并重启受管应用".format(target_release.tag), default=False):
            print_info("已取消更新，未拉取镜像或重启容器。")
            return {**outcome, "outcome": "cancelled"}
    elif initial.status in ("UP_TO_DATE", "LOCAL_NEWER"):
        print_info("当前应用版本高于最新正式版本，不拉取镜像或重启容器。" if initial.status == "LOCAL_NEWER" else "当前应用已是最新正式版本，不拉取镜像或重启容器。")
        return {**outcome, "outcome": "unchanged", "verified": True}
    else:
        print_info("当前版本无法安全确定最新更新目标；不会拉取 latest 镜像或重启容器。")
        raise InstallerError("当前应用版本无法安全确定更新目标，请先检查实际运行版本和正式 Release。")

    original = compose_path.read_text(encoding="utf-8")
    mode = compose_path.stat().st_mode & 0o777
    descriptor, name = tempfile.mkstemp(prefix=".slothvault-update-", suffix=".yml", dir=root)
    staged = Path(name)
    recreating = False
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(original)
        pin_managed_application_image(staged, target_image)
        run_command(("docker", "compose", "--project-directory", str(root), "-f", str(staged), "pull", "slothvault"),
                    phase="pull", stage_index=2, stage_count=5)
        report_progress("activate", stageIndex=3, stageCount=5, status="running")
        pin_managed_application_image(compose_path, target_image)
        report_progress("activate", stageIndex=3, stageCount=5, status="completed")
        recreating = True
        run_command(compose_command(compose_path, "up", "-d", "slothvault"), phase="recreate", stage_index=4, stage_count=5)
        report_progress("verify", stageIndex=5, stageCount=5, status="running")
        verified = verify_application(compose_path, target_release.tag, target_image)
        report_progress("verify", stageIndex=5, stageCount=5, status="completed")
    except BaseException:
        if not recreating and compose_path.read_text(encoding="utf-8") != original:
            write_text_atomically(compose_path, original, mode)
        raise
    finally:
        staged.unlink(missing_ok=True)
    print_info("已更新并确认运行中的应用达到 {0}；持久化数据已保留。".format(target_release.tag))
    return {**outcome, **verified, "outcome": "updated"}
