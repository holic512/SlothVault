"""
@file nginx_config.py
@project SlothVault
@module Nginx configuration inspection and transfer policies
@description Parses loaded Nginx sources and patches transfer directives without regenerating sites.
@logic Preserve source spans, resolve includes and inherited limits, and isolate policy overrides inside an existing proxy location.
@dependencies Python standard library, system.InstallerError
@index_tags nginx,parser,include,upload,download,configuration
@author holic512
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from .system import InstallerError


@dataclass
class Directive:
    words: tuple[str, ...]
    start: int
    end: int
    opening: int | None = None
    children: list["Directive"] = field(default_factory=list)


def parse(source: str) -> list[Directive]:
    """Tokenize comments, quoting, escapes and ${variables}, retaining edit offsets."""
    tokens: list[tuple[str, int, int]] = []
    index = 0
    while index < len(source):
        if source[index].isspace():
            index += 1
            continue
        if source[index] == '#':
            newline = source.find('\n', index)
            index = len(source) if newline < 0 else newline + 1
            continue
        start = index
        if source[index] in '{};':
            tokens.append((source[index], start, start + 1))
            index += 1
            continue
        word, quote = '', None
        while index < len(source):
            char = source[index]
            if char == '\\' and index + 1 < len(source):
                word += source[index:index + 2] if source[index + 1] not in "\\\"' " else source[index + 1]
                index += 2
            elif quote:
                if char == quote:
                    quote = None
                else:
                    word += char
                index += 1
            elif char in "\"'":
                quote = char
                index += 1
            elif source.startswith('${', index):
                end = source.find('}', index + 2)
                if end < 0:
                    raise InstallerError('Nginx 变量未闭合')
                word += source[index:end + 1]
                index = end + 1
            elif char.isspace() or char in '{};#':
                break
            else:
                word += char
                index += 1
        if quote or index == start:
            raise InstallerError('Nginx 配置引号或指令无效')
        tokens.append((word, start, index))
    cursor = 0

    def block(nested: bool = False) -> list[Directive]:
        nonlocal cursor
        result = []
        while cursor < len(tokens):
            if tokens[cursor][0] == '}':
                if not nested:
                    raise InstallerError('Nginx 配置包含多余的右括号')
                return result
            start, words = tokens[cursor][1], []
            while cursor < len(tokens) and tokens[cursor][0] not in '{};':
                words.append(tokens[cursor][0])
                cursor += 1
            if not words or cursor == len(tokens) or tokens[cursor][0] == '}':
                raise InstallerError('Nginx 配置指令不完整')
            token = tokens[cursor]
            cursor += 1
            if token[0] == ';':
                result.append(Directive(tuple(words), start, token[2]))
            else:
                children = block(True)
                if cursor == len(tokens):
                    raise InstallerError('Nginx 配置块未闭合')
                result.append(Directive(tuple(words), start, tokens[cursor][2], token[1], children))
                cursor += 1
        if nested:
            raise InstallerError('Nginx 配置块未闭合')
        return result

    return block()


def loaded_sources(dump: str) -> dict[str, str]:
    matches = list(re.finditer(r'^# configuration file (.+):\s*$', dump, re.MULTILINE))
    if not matches:
        raise InstallerError('nginx -T 未返回带来源的配置文件')
    return {match[1]: dump[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(dump)].lstrip('\r\n')
            for index, match in enumerate(matches)}


class Configuration:
    def __init__(self, sources: dict[str, str], main: str, prefix: str = '') -> None:
        self.sources, self.main = sources, main
        # Nginx resolves include paths against conf_prefix, the main config directory.
        self.prefix = str(PurePosixPath(main).parent)
        self.nodes = {path: parse(source) for path, source in sources.items()}

    def expanded(self, nodes: list[Directive], origin: str, seen: tuple[str, ...] = ()) -> list[tuple[str, Directive]]:
        result = []
        for node in nodes:
            if node.words[0] != 'include':
                result.append((origin, node))
                continue
            if len(node.words) != 2 or '$' in node.words[1]:
                raise InstallerError('无法安全解析动态 include')
            pattern = node.words[1]
            if not pattern.startswith('/'):
                pattern = str(PurePosixPath(self.prefix) / pattern)
            for path in sorted(self.nodes):
                if len(PurePosixPath(path).parts) == len(PurePosixPath(pattern).parts) and all(
                    fnmatch.fnmatchcase(part, mask) for part, mask in zip(PurePosixPath(path).parts, PurePosixPath(pattern).parts)
                ):
                    if path in seen:
                        raise InstallerError('Nginx include 存在循环')
                    result.extend(self.expanded(self.nodes[path], path, (*seen, path)))
        return result

    def values(self, nodes: list[Directive], origin: str, inherited: dict[str, str] | None = None) -> dict[str, str]:
        result = dict(inherited or {})
        for _, node in self.expanded(nodes, origin):
            if node.opening is None and len(node.words) > 1:
                result[node.words[0]] = ' '.join(node.words[1:])
        return result

    def servers(self) -> list[tuple[str, Directive, dict[str, str]]]:
        result = []
        for path, node in self.expanded(self.nodes[self.main], self.main, (self.main,)):
            if node.words == ('http',):
                http = self.values(node.children, path)
                for site_path, site in self.expanded(node.children, path):
                    if site.words == ('server',):
                        result.append((site_path, site, http))
        return result

    def proxy_targets(self, server: Directive, origin: str) -> list[str]:
        targets = []
        for path, node in self.expanded(server.children, origin):
            if node.words[0] == 'proxy_pass' and len(node.words) == 2:
                targets.append(node.words[1])
            if node.opening is not None:
                targets.extend(self.proxy_targets(node, path))
        # Resolve named upstream groups as well as direct proxy endpoints.
        upstreams: dict[str, list[str]] = {}
        for path, node in self.expanded(self.nodes[self.main], self.main):
            if node.words == ('http',):
                for up_path, up in self.expanded(node.children, path):
                    if up.words[0] == 'upstream' and len(up.words) == 2:
                        upstreams[up.words[1]] = [entry.words[1] for _, entry in self.expanded(up.children, up_path)
                                                  if entry.words[0] == 'server' and len(entry.words) > 1]
        result = []
        for target in targets:
            parsed = urlsplit(target)
            if '://' in target:
                host = parsed.hostname or ''
                host = '[' + host + ']' if ':' in host else host
                endpoint = host + (':' + str(parsed.port) if parsed.port else '')
            else:
                endpoint = target
            result.extend(upstreams.get(endpoint, [endpoint]))
        return result


@dataclass(frozen=True)
class Policy:
    name: str
    pattern: str
    paths: tuple[str, ...]
    minimum: int | None
    settings: tuple[tuple[str, str], ...] = ()


POLICIES = (
    Policy('backup-upload', r'^/api/admin/mm/backup/imports(?:/|$)',
           ('/api/admin/mm/backup/imports', '/api/admin/mm/backup/imports/sample'), 0,
           (('proxy_request_buffering', 'off'), ('proxy_http_version', '1.1'))),
    Policy('backup-download', r'^/api/admin/mm/backup/snapshots/[^/]+/download$',
           ('/api/admin/mm/backup/snapshots/sample/download',), None,
           (('proxy_buffering', 'off'), ('proxy_max_temp_file_size', '0'), ('proxy_pass_request_headers', 'on'), ('proxy_cache', 'off'))),
    Policy('file-upload', r'^/(?:api/admin/mm/file|api/account/profile/avatar)$',
           ('/api/admin/mm/file', '/api/account/profile/avatar'), 25 * 1024 * 1024),
    Policy('commission-upload', r'^/api/(?:admin|account)/commissions/[^/]+/files$',
           ('/api/admin/commissions/1/files', '/api/account/commissions/1/files'), 100 * 1024 * 1024),
)
TIMEOUTS = ('client_body_timeout', 'proxy_read_timeout', 'proxy_send_timeout', 'send_timeout')


def size_bytes(value: str) -> int:
    match = re.fullmatch(r'(\d+)([kKmMgG]?)', value)
    if not match:
        raise InstallerError('无法解析 Nginx 请求体上限：' + value)
    return int(match[1]) * {'': 1, 'k': 1024, 'm': 1024 ** 2, 'g': 1024 ** 3}[match[2].lower()]


def seconds(value: str) -> float:
    parts = re.findall(r'(\d+)(ms|[smhdwMy]?)', value)
    if not parts or ''.join(number + unit for number, unit in parts) != value.replace(' ', ''):
        raise InstallerError('无法解析 Nginx 超时：' + value)
    units = {'': 1, 'ms': .001, 's': 1, 'm': 60, 'h': 3600, 'd': 86400, 'w': 604800, 'M': 2592000, 'y': 31536000}
    return sum(int(number) * units[unit] for number, unit in parts)


def policy_settings(policy: Policy, values: dict[str, str]) -> dict[str, str]:
    result = dict(policy.settings)
    if policy.minimum is not None:
        existing = size_bytes(values.get('client_max_body_size', '1m'))
        if policy.minimum == 0:
            result['client_max_body_size'] = '0'
        elif existing != 0 and existing < policy.minimum:
            result['client_max_body_size'] = str(policy.minimum // (1024 * 1024)) + 'm'
    if policy.name.startswith('backup-'):
        for key in TIMEOUTS:
            if seconds(values.get(key, '60s')) < 3600:
                result[key] = '3600s'
    return result


def patch_server(config: Configuration, origin: str, server: Directive, http: dict[str, str]) -> tuple[str, list[dict[str, str]]]:
    source, edits, changes = config.sources[origin], [], []
    inherited = config.values(server.children, origin, http)
    locations = [(path, node) for path, node in config.expanded(server.children, origin) if node.words[0] == 'location']
    if any(node.words[0] in ('rewrite', 'if') for _, node in config.expanded(server.children, origin)):
        raise InstallerError('站点含 server 级 rewrite/if，无法保证传输路由不变；请手工应用传输策略')
    # Existing regular expressions can change nested-location precedence. Never override them by guessing.
    if any(len(node.words) > 2 and node.words[1] in ('~', '~*') for _, node in locations):
        raise InstallerError('站点含顶层正则 location，无法安全隔离传输策略；请手工应用传输策略')
    additions: dict[int, list[str]] = {}
    for policy in POLICIES:
        parents = []
        for route in policy.paths:
            matches = [(path, node) for path, node in locations if node.words[1] not in ('~', '~*', '=')
                       and route.startswith(node.words[-1]) and not node.words[-1].startswith('@')]
            exact = [(path, node) for path, node in locations if node.words[1] == '=' and node.words[-1] == route]
            if exact:
                raise InstallerError('传输接口已有精确 location，请先将其规则统一到可继承的代理 location：' + route)
            if not matches:
                raise InstallerError('未找到传输接口的代理 location：' + route)
            parents.append(max(matches, key=lambda item: len(item[1].words[-1])))
        if len({(path, node.start) for path, node in parents}) != 1:
            raise InstallerError('同类传输接口分属不同 location，无法安全合并策略：' + policy.name)
        path, parent = parents[0]
        if path != origin:
            raise InstallerError('代理 location 来自共享 include；请为选定站点提供独立代理 location')
        members = config.expanded(parent.children, origin)
        values = config.values(parent.children, origin, inherited)
        target = values.get('proxy_pass', '')
        if not target or '$' in target or urlsplit(target).path or urlsplit(target).query or urlsplit(target).username:
            raise InstallerError('代理包含动态目标或 URI 替换，无法保证传输路径不变')
        if any(node.words[0] in ('rewrite', 'if', 'limit_except') for _, node in members):
            raise InstallerError('代理含 rewrite/if/limit_except，请手工应用传输策略')
        if policy.name == 'backup-download' and any(
            (node.words[0] == 'proxy_set_header' and len(node.words) > 1 and node.words[1].lower() in ('range', 'if-range'))
            or (node.words[0] == 'proxy_hide_header' and len(node.words) > 1 and node.words[1].lower() in ('accept-ranges', 'etag', 'content-range'))
            for _, node in members
        ):
            raise InstallerError('代理自定义了 Range 或下载响应头，请先确认这些规则后手工应用传输策略')
        managed_words = ('location', '~', policy.pattern)
        managed = [node for member_path, node in members if member_path == origin and node.words == managed_words]
        if any(node.words[0] == 'location' and node.words not in {('location', '~', item.pattern) for item in POLICIES}
               for _, node in members):
            raise InstallerError('代理已有嵌套 location，无法安全隔离传输策略')
        if managed:
            node = managed[0]
            current = config.values(node.children, origin, values)
            settings = policy_settings(policy, current)
            settings['proxy_pass'] = target
            for key, value in settings.items():
                if current.get(key) == value:
                    continue
                direct = [entry for entry in node.children if entry.words[0] == key]
                if len(direct) > 1:
                    raise InstallerError('传输策略存在重复指令：' + key)
                if direct:
                    entry = direct[0]
                    edits.append((entry.start, entry.end, key + ' ' + value + ';'))
                else:
                    additions.setdefault(node.end - 1, []).append('            ' + key + ' ' + value + ';\n')
                changes.append({'policy': policy.name, 'directive': key, 'value': value})
        else:
            settings = policy_settings(policy, values)
            if not settings:
                continue
            # Nginx does not inherit the proxy content handler into regex sublocations.
            # Reuse the checked URI-preserving target; header/auth settings still inherit.
            settings['proxy_pass'] = target
            lines = ['\n        # SlothVault transfer policy: ' + policy.name,
                     '        location ~ ' + policy.pattern + ' {']
            lines.extend('            ' + key + ' ' + value + ';' for key, value in settings.items())
            lines.append('        }\n')
            additions.setdefault(parent.end - 1, []).append('\n'.join(lines))
            changes.extend({'policy': policy.name, 'directive': key, 'value': value} for key, value in settings.items())
    edits.extend((offset, offset, ''.join(lines)) for offset, lines in additions.items())
    for start, end, value in sorted(edits, reverse=True):
        source = source[:start] + value + source[end:]
    return source, changes


def transfer_status(config: Configuration, origin: str, server: Directive, http: dict[str, str]) -> list[dict[str, object]]:
    result = []
    inherited = config.values(server.children, origin, http)
    locations = [(path, node) for path, node in config.expanded(server.children, origin) if node.words[0] == 'location']
    for policy in POLICIES:
        limits = []
        for route in policy.paths:
            matches = [(path, node) for path, node in locations if node.words[1] not in ('~', '~*', '=') and route.startswith(node.words[-1])]
            exact = [(path, node) for path, node in locations if node.words[1] == '=' and node.words[-1] == route]
            if not exact and not matches:
                limits.append({'path': route, 'state': 'unknown'})
                continue
            path, parent = exact[0] if exact else max(matches, key=lambda item: len(item[1].words[-1]))
            values = config.values(parent.children, path, inherited)
            children = config.expanded(parent.children, path)
            nested = [entry for _, entry in children if entry.words == ('location', '~', policy.pattern)]
            if nested:
                values = config.values(nested[0].children, path, values)
            ambiguous = any(entry.words[0] == 'location' and entry.words[1] in ('~', '~*') for _, entry in locations)
            limits.append({'path': route, 'state': 'unknown' if ambiguous else 'checked',
                           'clientMaxBodySize': values.get('client_max_body_size', '1m'),
                           'requestBuffering': values.get('proxy_request_buffering', 'on'),
                           'responseBuffering': values.get('proxy_buffering', 'on'),
                           'readTimeout': values.get('proxy_read_timeout', '60s')})
        result.append({'name': policy.name, 'routes': limits})
    return result
