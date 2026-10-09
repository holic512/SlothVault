#!/usr/bin/env python3
"""
@file benchmark_article_skill.py
@project SlothVault
@module Skill validation benchmarks
@description Measures routed context bytes and offline checker throughput with reproducible fixtures.
@logic Compare a supplied Git baseline with current Skill files, then time fixed prose and code inputs.
@dependencies Python 3.10+ standard library, Git for baseline reads
@index_tags skill,benchmark,context,markdown,validation
@author holic512
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / 'integrations/skill/slothvault-mcp'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-ref', required=True, help='Git commit/tag before the Skill change')
    parser.add_argument('--runs', type=int, default=9)
    args = parser.parse_args()
    if not 1 <= args.runs <= 100:
        parser.error('--runs must be between 1 and 100')
    baseline = subprocess.check_output(['git', 'rev-parse', '--verify', args.baseline_ref + '^{commit}'], cwd=ROOT, text=True).strip()
    routes = {
        'entry_only': ['SKILL.md'],
        'project_workflow': ['SKILL.md', 'references/native-workflows.md'],
        'project_materials': ['SKILL.md', 'references/project-materials.md'],
        'article_edit': ['SKILL.md', 'references/article-workflow.md'],
        'technical_article': ['SKILL.md', 'references/article-workflow.md', 'references/technical-writing.md'],
    }
    sizes = {}
    for files in routes.values():
        for name in files:
            if name in sizes:
                continue
            after = (SKILL / name).read_bytes()
            previous = subprocess.run(['git', 'show', baseline + ':integrations/skill/slothvault-mcp/' + name],
                                      cwd=ROOT, capture_output=True)
            before = previous.stdout if previous.returncode == 0 else None
            sizes[name] = {'beforeBytes': len(before) if before is not None else None,
                           'afterBytes': len(after), 'afterCharacters': len(after.decode('utf-8'))}
    context = {}
    for name, files in routes.items():
        previous = [sizes[file]['beforeBytes'] for file in files]
        context[name] = {'beforeBytes': sum(previous) if all(value is not None for value in previous) else None,
                         'afterBytes': sum(sizes[file]['afterBytes'] for file in files)}
    spec = importlib.util.spec_from_file_location('check_article', SKILL / 'scripts/check_article.py')
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    timings = []
    for size in (5_000, 50_000, 500_000):
        for kind in ('unique_prose', 'duplicate_prose', 'code_spans', 'unclosed_links', 'spaced_heading'):
            if kind == 'unique_prose':
                content = ''.join(f'段落 {i:06d} ' + '解释前提和结果。' * 20 + '\n\n' for i in range(size // 160 + 1))[:size]
            elif kind == 'duplicate_prose':
                content = (('解释前提和结果。' * 20 + '\n\n') * (size // 160 + 1))[:size]
            elif kind == 'code_spans':
                content = ('代码 `TODO` 与 ``a ` b`` 是示例。\n\n' * (size // 20 + 1))[:size]
            elif kind == 'unclosed_links':
                content = '[' * size
            else:
                content = '# a' + ' ' * (size - 5) + 'b\n'
            assert len(content) == size
            checker.check_article(content)  # one warmup, not included in the median
            samples = []
            for _ in range(args.runs):
                start = time.perf_counter()
                result = checker.check_article(content)
                samples.append((time.perf_counter() - start) * 1000)
            timings.append({'kind': kind, 'characters': size, 'issues': len(result['issues']),
                            'medianMs': round(statistics.median(samples), 3)})
    print(json.dumps({'baselineCommit': baseline, 'python': platform.python_version(),
                      'platform': platform.system() + '/' + platform.machine(), 'runs': args.runs,
                      'files': sizes, 'context': context, 'checker': timings,
                      'limits': 'Bytes are not tokens; checker timings exclude interpreter startup and file I/O. No live model success-rate measurement.'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
