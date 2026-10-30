#!/usr/bin/env python3
"""
@file check_project_docs.py
@project SlothVault
@module Project documentation validation
@description Checks a local documentation bundle without executing examples, fetching links, or editing files.
@logic Reuse article checks, validate baseline and document links, and index prose duplicates with advisory style findings.
@dependencies Python 3.10+ standard library, check_article.py
@index_tags skill,documentation,writing,validation,read-only
@author holic512
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from check_article import check_article

NOISE = re.compile(r'综上所述|总而言之|赋能|现代化架构|极大(?:地)?提升|本次文档(?:制作|创建)|本次验证环境|SlothVault\s*(?:项目|版本)\s*ID|文档基线：')
HEADING = re.compile(r'^ {0,3}#{1,6}[ \t]+(.*)$')
FENCE = re.compile(r'^\s*(`{3,}|~{3,})')
SHA = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')


def link_targets(text: str):
    """Conservative inline targets in linear scans; complex CommonMark is manual review."""
    start = 0
    while True:
        separator = text.find('](', start)
        if separator < 0:
            return
        opening = text.rfind('[', start, separator)
        closing = text.find(')', separator + 2)
        if closing < 0:
            return
        if opening >= 0 and (opening == 0 or text[opening - 1] != '!'):
            destination = text[separator + 2:closing].strip()
            if destination:
                yield destination.split(None, 1)[0].strip('<>')
        start = closing + 1


def prose_lines(content: str):
    fence = None
    comment = False
    for number, raw in enumerate(content.splitlines(), 1):
        marker = FENCE.match(raw)
        if fence:
            if re.fullmatch(r'\s*' + re.escape(fence[0]) + '{' + str(fence[1]) + r',}\s*', raw):
                fence = None
            continue
        if marker:
            fence = (marker[1][0], len(marker[1]))
            continue
        if raw.startswith(('    ', '\t')) or raw.lstrip().startswith('>'):
            continue
        if re.match(r'^ {0,3}:{3,}(?:[a-z][a-z0-9-]*(?:\{.*\})?)?\s*$', raw):
            continue
        raw = re.sub(r'`+[^`]*`+', '', raw)
        if comment:
            if '-->' not in raw:
                continue
            raw = raw.split('-->', 1)[1]
            comment = False
        while '<!--' in raw:
            begin, tail = raw.split('<!--', 1)
            if '-->' in tail:
                raw = begin + tail.split('-->', 1)[1]
            else:
                raw = begin
                comment = True
                break
        yield number, raw


def heading_title(text: str) -> str:
    title = text.strip()
    end = len(title)
    while end and title[end - 1] == '#':
        end -= 1
    return title[:end].rstrip() if end < len(title) and end and title[end - 1].isspace() else title


def normalized_title(title: str) -> str:
    return re.sub(r'^\s*\d+(?:\.\d+)*\s*[·、.\-]?\s*', '', title).strip()


def changelog_version(content: str, version: str) -> bool:
    normalized = re.sub(r'^v(?=\d)', '', version)
    token = re.compile(r'^' + ('v?' if normalized[:1].isdigit() else '') + re.escape(normalized) + r'(?=$|[\s（(:：])')
    for _, text in prose_lines(content):
        heading = HEADING.match(text)
        if heading:
            label = re.sub(r'^\[([^\]]+)\]\([^)]*\)', r'\1', heading[1].strip())
            if token.search(label):
                return True
    return False


def check_bundle(bundle: dict, root: Path) -> dict:
    issues = []
    docs = bundle.get('documents', [])
    def issue(code, key, line, message, severity='warning'):
        issues.append({'code': code, 'severity': severity, 'documentKey': key, 'line': line, 'message': message})
    baseline = bundle.get('sourceBaseline')
    if not isinstance(baseline, dict) or not baseline.get('repositoryIdentity') or not baseline.get('version') or not SHA.fullmatch(str(baseline.get('commit', ''))):
        issue('BASELINE_MISSING', None, 1, '源码身份、版本和完整 Commit 未确认；非 Git 项目需先明确版本基线。', 'error')
    if not isinstance(docs, list) or not docs:
        issue('EMPTY_BUNDLE', None, 1, '文档集合为空。', 'error')
        docs = []
    seen_keys = set()
    urls = {}
    prepared = []
    for doc in docs:
        if doc.get('status') == 0:
            continue
        key = doc.get('key')
        title = doc.get('title')
        if not isinstance(key, str) or not key or key in seen_keys:
            issue('DOCUMENT_KEY_INVALID', key, 1, '文档键必须非空且唯一。', 'error')
        seen_keys.add(key)
        if not isinstance(title, str) or not title.strip():
            issue('TITLE_MISSING', key, 1, '标题为空。', 'error')
            title = ''
        content = doc.get('content')
        if content is None:
            p = (root / doc.get('contentFile', '')).resolve()
            if not p.is_relative_to(root.resolve()) or not p.is_file():
                issue('CONTENT_FILE_INVALID', key, 1, '正文文件不存在或位于检查目录之外。', 'error')
                content = ''
            else:
                content = p.read_text(encoding='utf-8-sig')
        if not isinstance(content, str):
            issue('CONTENT_INVALID', key, 1, '正文必须是字符串。', 'error')
            content = ''
        for finding in check_article(content, title)['issues']:
            severity = 'error' if finding['code'] in {'UNCLOSED_FENCE', 'EMPTY_LINK_TARGET'} else finding['severity']
            issue(finding['code'], key, finding['line'], finding['message'], severity)
        if doc.get('url'):
            path = urlsplit(doc['url']).path
            if path in urls:
                issue('DUPLICATE_URL', key, 1, '文档链接重复。', 'error')
            urls[path] = key
        if not doc.get('sourcePaths') and not doc.get('sourceNotes'):
            issue('SOURCE_UNMAPPED', key, 1, '未记录源码关联或独立资料来源；无法自动判断影响范围。')
        prepared.append((doc, title, content, list(prose_lines(content))))
    changelogs = [item for item in prepared if item[0].get('kind') == 'changelog']
    if len(changelogs) != 1:
        issue('CHANGELOG_COUNT', None, 1, '项目文档应有且仅有一篇集中更新日志。', 'error')
    elif baseline and baseline.get('version') and not changelog_version(changelogs[0][2], str(baseline['version'])):
        issue('CHANGELOG_VERSION_MISSING', changelogs[0][0]['key'], 1, '更新日志没有记录当前源码版本。', 'error')
    paragraphs = {}
    for doc, title, content, lines in prepared:
        key = doc.get('key')
        h1 = [(n, heading_title(HEADING.match(text)[1])) for n, text in lines if re.match(r'^ {0,3}#[ \t]+', text)]
        for index, (number, text) in enumerate(lines):
            if index and re.fullmatch(r' {0,3}=+[ \t]*', text) and lines[index - 1][0] == number - 1 and lines[index - 1][1].strip():
                h1.append((number - 1, lines[index - 1][1].strip()))
        h1.sort()
        if h1 and normalized_title(h1[0][1]) != normalized_title(title):
            issue('TITLE_MISMATCH', key, h1[0][0], '正文一级标题与侧栏标题不一致。', 'error')
        paragraph = []
        start = 1
        def flush():
            text = ' '.join(' '.join(paragraph).split())
            paragraph.clear()
            if len(text) < 80:
                return
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest in paragraphs and paragraphs[digest][0] != key:
                issue('CROSS_DOCUMENT_DUPLICATE', key, start, '长段落与文档 ' + str(paragraphs[digest][0]) + ' 重复；考虑链接或合并。')
            else:
                paragraphs[digest] = (key, start)
        if doc.get('kind') == 'tutorial' and not re.search(r'运行|执行|选择|选中|输入|点击|打开|安装|按|\b(?:run|click|select|enter|install)\b', content, re.I):
            issue('TUTORIAL_TASK_UNCLEAR', key, 1, '教程未明确读者操作；请检查是否只有概念介绍，不按字数扩写。')
        for number, text in lines:
            if not text.strip() or HEADING.match(text) or re.match(r'^\s*(?:[-*+]|\d+[.)]|\|)', text):
                flush()
            else:
                if not paragraph:
                    start = number
                paragraph.append(text)
            if doc.get('kind') != 'changelog' and NOISE.search(text):
                issue('PROSE_REVIEW', key, number, '检查空泛表达或面向智能体的过程记录；此提示不判断作者身份。')
            for target in link_targets(text):
                parsed = urlsplit(target)
                if parsed.scheme == 'doc':
                    if parsed.path not in seen_keys:
                        issue('BROKEN_DOCUMENT_LINK', key, number, '内部文档键不存在。', 'error')
                    else:
                        issue('UNRESOLVED_DOCUMENT_LINK', key, number, '保存前应将 doc: 键替换为实际文档 URL。', 'error')
                    continue
                if parsed.scheme or parsed.netloc or target.startswith('#'):
                    continue
                path = unquote(parsed.path)
                if path.startswith('doc:'):
                    if path[4:] not in seen_keys:
                        issue('BROKEN_DOCUMENT_LINK', key, number, '内部文档键不存在。', 'error')
                    else:
                        issue('UNRESOLVED_DOCUMENT_LINK', key, number, '保存前应将 doc: 键替换为实际文档 URL。', 'error')
                elif '/project/' in path and '/docs/' in path and path not in urls:
                    issue('BROKEN_DOCUMENT_LINK', key, number, '内部链接不属于当前文档集合或版本。', 'error')
                elif path.endswith('.md') and path not in urls:
                    issue('BROKEN_DOCUMENT_LINK', key, number, 'Markdown 文档目标不在当前清单中。', 'error')
        flush()
    return {'reportVersion': 1, 'ready': not any(i['severity'] == 'error' for i in issues),
            'documentCount': len(prepared), 'issues': issues,
            'manualReview': ['技术准确性、教程可执行性、语义重复、锚点及复杂/引用式 Markdown 链接需人工核验；脚本不执行示例或联网。']}


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only checks for a project documentation JSON bundle.')
    parser.add_argument('input')
    parser.add_argument('--format', choices=['json', 'text'], default='json')
    args = parser.parse_args()
    try:
        path = Path(args.input).resolve()
        bundle = json.loads(path.read_text(encoding='utf-8-sig'))
        if not isinstance(bundle, dict):
            raise ValueError('Expected object')
        result = check_bundle(bundle, path.parent)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        print(json.dumps({'error': 'INPUT_ERROR', 'message': 'Cannot read documentation bundle; no files changed.'}))
        return 2
    if args.format == 'json':
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for finding in result['issues']:
            print(f"{finding['severity']} {finding['documentKey']} L{finding['line']} {finding['code']}: {finding['message']}")
        print('Ready' if result['ready'] else 'Blocked')
    return 0 if result['ready'] else 1

if __name__ == '__main__':
    sys.exit(main())
