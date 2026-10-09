#!/usr/bin/env python3
"""
@file check_article.py
@project SlothVault
@module Skill article static checks
@description Reports conservative, line-located Markdown findings without editing or executing input.
@logic Scan ordinary blocks once, mask code/comments, and index normalized prose for exact duplicates.
@dependencies Python 3.10+ standard library
@index_tags skill,article,markdown,validation,offline
@author holic512
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FENCE = re.compile(r"^ {0,3}(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$")
ATX = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$")
SETEXT = re.compile(r"^ {0,3}(=+|-+)\s*$")
LIST = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
TABLE_SEPARATOR = re.compile(r"^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$")
PLACEHOLDER = re.compile(r"\b(?:TODO|TBD|FIXME)\b|待补充|待完善|此处填写", re.IGNORECASE)
EMPTY_LINK = re.compile(r"!?\[[^\[\]\n]*\]\(\s*\)")
MANUAL_REVIEW = [
    "核验技术结论的源码或同版本资料；静态检查不能证明技术正确。",
    "核验示例上下文、预期结果和真实执行状态；本脚本不执行代码。",
    "按文章类型核验必要步骤、适用边界、复杂 Markdown 和链接；本脚本不联网。",
]


def without_inline_code(value: str) -> str:
    """Mask matched code spans in linear scans; leave unmatched literal ticks alone."""
    runs = list(re.finditer(r"`+", value))
    next_same: dict[int, int] = {}
    following: dict[int, int] = {}
    for index in range(len(runs) - 1, -1, -1):
        length = len(runs[index][0])
        if length in next_same:
            following[index] = next_same[length]
        next_same[length] = index
    parts = []
    start = index = 0
    while index < len(runs):
        if index in following:
            end = following[index]
            parts.extend((value[start:runs[index].start()], " " * (runs[end].end() - runs[index].start())))
            start = runs[end].end()
            index = end + 1
        else:
            index += 1
    parts.append(value[start:])
    return "".join(parts)


def check_article(content: str, title: str | None = None) -> dict:
    issues: list[dict] = []

    def issue(code: str, line: int, message: str, severity: str = "warning") -> None:
        issues.append({"code": code, "severity": severity, "line": line, "message": message})

    if not content.strip():
        issue("EMPTY_CONTENT", 1, "正文为空。", "error")
    if title is not None and not title.strip():
        issue("EMPTY_TITLE", 1, "提供的标题为空。", "error")

    lines = content.splitlines()
    paragraph: list[str] = []
    paragraph_line = 1
    seen: dict[str, int] = {}
    paragraph_count = headings = code_blocks = 0
    heading: tuple[int, int, bool] | None = None  # depth, source line, has content
    fence: tuple[str, int, int] | None = None
    in_table = False
    in_comment = False
    skip_line = -1

    def flush() -> None:
        nonlocal paragraph_count
        if not paragraph:
            return
        normalized = " ".join(" ".join(paragraph).split())
        paragraph.clear()
        paragraph_count += 1
        if len(normalized) < 80:
            return
        if normalized in seen:
            issue("DUPLICATE_PARAGRAPH", paragraph_line, f"与第 {seen[normalized]} 行的长段落重复，请确认用途。")
        else:
            seen[normalized] = paragraph_line

    def mark_content() -> None:
        nonlocal heading
        if heading:
            heading = (heading[0], heading[1], True)

    for index, raw in enumerate(lines):
        line_number = index + 1
        if index == skip_line:
            continue
        if fence:
            # A closing fence may be longer, but must use the same character and have no info string.
            if re.fullmatch(r" {0,3}" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*", raw):
                fence = None
            continue
        if not in_comment and (raw.startswith(("    ", "\t")) or raw.lstrip().startswith(">")):
            flush()
            mark_content()
            continue
        # Comments in fenced code are literals. Outside code, mask comments without
        # shifting source lines or interpreting comment markers inside code spans.
        masked = without_inline_code(raw)
        parts: list[str] = []
        start = 0
        while start < len(raw):
            if in_comment:
                end = raw.find("-->", start)
                if end == -1:
                    break
                start = end + 3
                in_comment = False
            else:
                begin = masked.find("<!--", start)
                if begin == -1:
                    parts.append(raw[start:])
                    break
                parts.append(raw[start:begin])
                start = begin + 4
                in_comment = True
        raw = "".join(parts)
        if not raw.strip():
            flush()
            in_table = False
            continue
        match = FENCE.match(raw)
        if match and not (match[1][0] == "`" and "`" in match[2]):
            flush()
            mark_content()
            fence = (match[1][0], len(match[1]), line_number)
            code_blocks += 1
            if not match[2].strip():
                issue("CODE_LANGUAGE_MISSING", line_number, "代码围栏未标语言；日志、伪代码等按用途标注，刻意省略可保留。")
            continue
        # Avoid interpreting quoted examples, reference definitions, HTML, or table cells as prose.
        table_start = index + 1 < len(lines) and "|" in raw and bool(TABLE_SEPARATOR.match(lines[index + 1]))
        if table_start or (in_table and "|" in raw):
            flush()
            in_table = True
            mark_content()
            continue
        in_table = False
        if raw.lstrip().startswith("<") or re.match(r"^ {0,3}\[[^\]]+\]:", raw):
            flush()
            mark_content()
            continue
        text = without_inline_code(raw)
        atx = ATX.match(raw)
        underline = SETEXT.match(lines[index + 1]) if index + 1 < len(lines) else None
        is_setext = bool(underline and raw.strip() and not LIST.match(raw) and not SETEXT.match(raw))
        if atx or is_setext:
            flush()
            depth = len(atx[1]) if atx else (1 if underline[1][0] == "=" else 2)
            title_text = (atx[2] or "") if atx else raw.strip()
            if atx:
                title_text = title_text.strip()
                without_closing_hashes = title_text.rstrip('#')
                if not without_closing_hashes or without_closing_hashes[-1].isspace():
                    title_text = without_closing_hashes.strip()
            if heading:
                if depth > heading[0] + 1:
                    issue("HEADING_LEVEL_JUMP", line_number, "相邻标题层级跳跃，请检查结构。")
                if depth <= heading[0] and not heading[2]:
                    issue("EMPTY_SECTION", heading[1], "标题后没有正文或子章节。")
            if not title_text.strip():
                issue("EMPTY_HEADING", line_number, "标题文字为空。")
            heading = (depth, line_number, False)
            headings += 1
            if is_setext and not atx:
                skip_line = index + 1
        else:
            mark_content()
            if LIST.match(raw) or SETEXT.match(raw):
                flush()
            else:
                if not paragraph:
                    paragraph_line = line_number
                paragraph.append(raw.strip())
        if PLACEHOLDER.search(text):
            issue("PLACEHOLDER", line_number, "存在待补充标记；确认是否为有意引用或未完成内容。")
        if EMPTY_LINK.search(text):
            issue("EMPTY_LINK_TARGET", line_number, "链接目标为空；确认是否为有意的当前页面链接。")
    flush()
    if fence:
        issue("UNCLOSED_FENCE", fence[2], "围栏延伸到文末；Markdown 允许省略闭合，请确认不是遗漏。")
    if heading and not heading[2]:
        issue("EMPTY_SECTION", heading[1], "末尾标题没有正文。")
    issues.sort(key=lambda item: (item["line"], item["code"]))
    return {
        "reportVersion": 1,
        "stats": {"characters": len(content), "lines": len(content.splitlines()),
                  "headings": headings, "codeBlocks": code_blocks, "paragraphs": paragraph_count},
        "issues": issues,
        "manualReview": MANUAL_REVIEW.copy(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only advisory Markdown checks; no network or code execution.")
    parser.add_argument("input", help="UTF-8 Markdown path, or - for stdin")
    parser.add_argument("--title")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args(argv)
    try:
        raw = sys.stdin.buffer.read() if args.input == "-" else Path(args.input).read_bytes()
        content = raw.decode("utf-8-sig")
    except (OSError, UnicodeError) as error:
        # Do not echo document contents, environment, or a traceback.
        message = f"Cannot read UTF-8 input ({type(error).__name__})."
        if args.format == "json":
            print(json.dumps({"reportVersion": 1, "error": {"code": "INPUT_ERROR", "message": message}}))
        else:
            print(message, file=sys.stderr)
        return 2
    report = check_article(content, args.title)
    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False))
    else:
        for finding in report["issues"]:
            print(f'{finding["severity"]} L{finding["line"]} {finding["code"]}: {finding["message"]}')
        if not report["issues"]:
            print("No static findings; technical accuracy remains unverified.")
        for reminder in report["manualReview"]:
            print(f"Review: {reminder}")
    return int(any(item["severity"] == "error" for item in report["issues"]))


if __name__ == "__main__":
    raise SystemExit(main())
