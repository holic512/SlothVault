import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / 'skill/slothvault-mcp/scripts'
sys.path.insert(0, str(SCRIPTS))
from check_project_docs import check_bundle
from inspect_project import inspect, remote_identity

BASE = {'repositoryIdentity': 'github.com/example/repo', 'version': '1.0.0', 'commit': 'a' * 40}

def bundle(text='命令返回当前配置。'):
    return {'sourceBaseline': BASE.copy(), 'documents': [
        {'key': 'config', 'title': '配置', 'sourcePaths': ['src/**'], 'content': text},
        {'key': 'changelog', 'title': '更新日志', 'kind': 'changelog', 'sourcePaths': ['package.json'], 'content': '# 更新日志\n\n## 1.0.0\n\n新增配置教程。'}]}

class DocumentationTest(unittest.TestCase):
    def test_short_valid_document_does_not_need_boilerplate(self):
        result = check_bundle(bundle(), Path.cwd())
        self.assertTrue(result['ready']); self.assertEqual(result['issues'], [])
        self.assertNotIn('score', result)

    def test_changelog_does_not_accept_a_version_substring_or_example(self):
        data = bundle(); data['sourceBaseline']['version'] = '1.0.0'
        data['documents'][1]['content'] = '# 更新日志\n\n## 1.0.01\n\n其他版本。\n\n```markdown\n## 1.0.0\n```'
        self.assertFalse(check_bundle(data, Path.cwd())['ready'])
        data['documents'][1]['content'] = '# 更新日志\n\n## [v1.0.0](https://example.invalid/release)（日期）\n\n修订。'
        self.assertTrue(check_bundle(data, Path.cwd())['ready'])

    def test_long_malformed_links_are_bounded_and_inactive_pages_are_excluded(self):
        data = bundle('[' * 500000 + '](x )'); data['documents'].append({'key': 'hidden', 'status': 0, 'kind': 'changelog'})
        self.assertTrue(check_bundle(data, Path.cwd())['ready'])

    def test_legal_closing_hashes_and_setext_titles(self):
        self.assertTrue(check_bundle(bundle('# 配置 ###\n\n真实操作。'), Path.cwd())['ready'])
        self.assertTrue(check_bundle(bundle('配置\n===\n\n真实操作。'), Path.cwd())['ready'])
        self.assertFalse(check_bundle(bundle('错误标题\n===\n\n真实操作。'), Path.cwd())['ready'])

    def test_structural_errors_block_and_style_is_advisory(self):
        data = bundle('# 另一个标题\n\n综上所述，现代化架构为用户赋能。\n\n[链接](/project/1/v/2/docs/999)')
        codes = {i['code']: i['severity'] for i in check_bundle(data, Path.cwd())['issues']}
        self.assertEqual(codes['TITLE_MISMATCH'], 'error'); self.assertEqual(codes['BROKEN_DOCUMENT_LINK'], 'error')
        self.assertEqual(codes['PROSE_REVIEW'], 'warning')

    def test_exact_cross_document_duplicates_are_advisory(self):
        text = '操作之前保存配置，在同一个目录中运行命令并核对返回字段。' * 8
        data = bundle(text); data['documents'].append({'key': 'other', 'title': '其他', 'content': text, 'sourcePaths': ['src/**']})
        report = check_bundle(data, Path.cwd()); self.assertTrue(report['ready'])
        self.assertIn('CROSS_DOCUMENT_DUPLICATE', [i['code'] for i in report['issues']])

    def test_code_quotes_comments_are_not_style_or_duplicate_prose(self):
        data = bundle('# 配置\n\n```text\n综上所述，现代化架构。\n```\n\n> 本次文档创建。\n\n<!-- 文档基线： -->\n\n命令中的 `赋能` 是输入示例。')
        self.assertNotIn('PROSE_REVIEW', [i['code'] for i in check_bundle(data, Path.cwd())['issues']])

    def test_baseline_keys_changelog_and_paths_are_checked(self):
        data = bundle(); data['sourceBaseline']['commit'] = 'abc'; data['documents'][1]['kind'] = 'reference'
        data['documents'][1]['key'] = 'config'
        codes = [i['code'] for i in check_bundle(data, Path.cwd())['issues']]
        self.assertIn('BASELINE_MISSING', codes); self.assertIn('DOCUMENT_KEY_INVALID', codes); self.assertIn('CHANGELOG_COUNT', codes)

    def test_real_links_and_unresolved_doc_keys(self):
        data = bundle('[日志](/preview/project/1/v/2/docs/4)'); data['documents'][1]['url'] = '/preview/project/1/v/2/docs/4'
        self.assertTrue(check_bundle(data, Path.cwd())['ready'])
        data['documents'][0]['content'] = '[日志](doc:changelog)'
        self.assertFalse(check_bundle(data, Path.cwd())['ready'])

    def test_cli_readonly_and_content_cannot_escape_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); data = bundle(); data['documents'][0].pop('content'); data['documents'][0]['contentFile'] = '../outside.md'
            path = root / 'docs.json'; path.write_text(json.dumps(data)); before = path.read_bytes()
            result = subprocess.run([sys.executable, str(SCRIPTS/'check_project_docs.py'), str(path)], capture_output=True)
            self.assertEqual(result.returncode, 1); self.assertEqual(path.read_bytes(), before)
            self.assertIn('CONTENT_FILE_INVALID', result.stdout.decode())

    def test_remote_credentials_are_not_in_identity(self):
        self.assertEqual(remote_identity('https://account:secret@github.com/example/repo.git?token=secret#x'), 'github.com/example/repo')
        self.assertEqual(remote_identity('git@github.com:example/repo.git'), 'github.com/example/repo')
        self.assertIsNone(remote_identity('/private/local/path'))

    def test_inspection_tracks_versions_renames_dirty_state_and_affected_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def run(*args): return subprocess.check_output(['git', '-C', tmp, *args], stderr=subprocess.DEVNULL).decode().strip()
            run('init'); run('config', 'user.email', 'test@example.invalid'); run('config', 'user.name', 'Fixture')
            (root/'package.json').write_text('{"name":"fixture","version":"1.0.0"}')
            (root/'src').mkdir(); (root/'src/a.py').write_text('a=1\n'); run('add', '.'); run('commit', '-m', 'base')
            first = inspect(root); before = first['sourceBaseline']; self.assertFalse(first['dirty'])
            run('mv', 'src/a.py', 'src/b.py'); run('commit', '-m', 'rename')
            result = inspect(root, {'sourceBaseline': before, 'documents': [{'key': 'guide', 'sourcePaths': ['src/**']}]})
            self.assertEqual(result['baselineStatus'], 'available'); self.assertEqual(result['affectedDocuments'][0]['key'], 'guide')
            self.assertIn('src/b.py', result['changedFiles'])
            (root/'src/b.py').write_text('a=2\n'); self.assertTrue(inspect(root)['dirty'])
            before['repositoryIdentity'] = 'other/project'; self.assertEqual(inspect(root, {'sourceBaseline': before})['baselineStatus'], 'identity-mismatch')

    def test_symlinks_do_not_read_external_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root/'package.json').symlink_to('/etc/passwd')
            result = inspect(root); self.assertEqual(result['packages'], []); self.assertEqual(result['manifestCandidates'], [])

if __name__ == '__main__': unittest.main()
