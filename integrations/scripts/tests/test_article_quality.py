import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'skill/slothvault-mcp/scripts/check_article.py'
spec = importlib.util.spec_from_file_location('check_article', SCRIPT)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def codes(text, title=None):
    return [item['code'] for item in checker.check_article(text, title)['issues']]


class ArticleQualityTest(unittest.TestCase):
    def test_short_chinese_article_needs_no_headings_or_code(self):
        result = checker.check_article('列表用于定位文章，详情接口用于读取正文。')
        self.assertEqual(result['issues'], [])
        self.assertTrue(result['manualReview'])
        self.assertNotIn('score', result)

    def test_blank_content_and_explicit_blank_title_are_errors(self):
        result = checker.check_article(' \n', ' ')
        self.assertEqual({item['code'] for item in result['issues']}, {'EMPTY_CONTENT', 'EMPTY_TITLE'})
        self.assertTrue(all(item['severity'] == 'error' for item in result['issues']))

    def test_atx_and_setext_headings(self):
        self.assertEqual(codes('题目\n===\n说明。\n\n章节\n---\n正文。'), [])
        findings = checker.check_article('# 开始\n正文\n### 跳级\n## 空章\n## 结尾')['issues']
        self.assertIn('HEADING_LEVEL_JUMP', [item['code'] for item in findings])
        self.assertEqual([item['line'] for item in findings if item['code'] == 'EMPTY_SECTION'], [3, 4, 5])
        self.assertNotIn('EMPTY_SECTION', codes('# 父章\n## 子章\n内容。'))

    def test_code_blocks_mask_fake_prose_and_allow_longer_closers(self):
        text = '# 示例\n````markdown\n```python\n# TODO\n### fake\n```\n`````\n'
        self.assertEqual(codes(text), [])
        self.assertEqual(codes('~~~text\nTODO\n# fake\n~~~~\n'), [])
        self.assertEqual(codes('    TODO\n    ### fake'), [])

    def test_long_incomplete_links_and_spaced_headings_do_not_backtrack_quadratically(self):
        self.assertEqual(codes('[' * 50_000), [])
        self.assertEqual(codes('# a' + ' ' * 50_000 + 'b\n正文'), [])
        self.assertIn('EMPTY_HEADING', codes('# ###'))
        self.assertNotIn('EMPTY_HEADING', codes('# title###\n正文'))

    def test_unclosed_and_unlabelled_fences_are_advisory(self):
        findings = checker.check_article('```\nprint(1)')['issues']
        self.assertEqual({item['code'] for item in findings}, {'UNCLOSED_FENCE', 'CODE_LANGUAGE_MISSING'})
        self.assertTrue(all(item['severity'] == 'warning' for item in findings))
        self.assertIn('UNCLOSED_FENCE', codes('```python\n~~~\n'))

    def test_duplicate_long_prose_with_whitespace_normalization(self):
        para = '正文要解释问题的前提和结果。' * 8
        result = checker.check_article(para + '  测试\n\n' + para + '\n测试')
        duplicate = [item for item in result['issues'] if item['code'] == 'DUPLICATE_PARAGRAPH']
        self.assertEqual(len(duplicate), 1)
        self.assertEqual(duplicate[0]['line'], 3)
        self.assertEqual(codes('短句\n\n短句'), [])

    def test_repeated_code_quotes_and_tables_are_not_duplicate_prose(self):
        para = '这是一段重复内容' * 20
        for text in [f'```text\n{para}\n```\n\n```text\n{para}\n```',
                     f'> {para}\n\n> {para}',
                     f'|列|值|\n|---|---|\n|{para}|1|\n|{para}|1|']:
            self.assertNotIn('DUPLICATE_PARAGRAPH', codes(text))

    def test_placeholders_links_inline_code_and_comments(self):
        self.assertEqual(codes('`TODO` 和 ``[example]()`` 是代码。\n<!-- TODO -->'), [])
        self.assertEqual(codes('``a ` TODO ` b``'), [])
        result = checker.check_article('<!-- 注释\nTODO -->\n待补充 [链接]()')['issues']
        self.assertEqual({item['code'] for item in result}, {'PLACEHOLDER', 'EMPTY_LINK_TARGET'})
        self.assertTrue(all(item['line'] == 3 for item in result))
        self.assertEqual(codes('[实际链接](https://example.com/path_(part))'), [])
        self.assertEqual(codes('```html\n<!-- example\n```\n正文'), [])
        self.assertEqual(codes('`<!--` 是注释起始符，TODO'), ['PLACEHOLDER'])
        self.assertEqual(codes('    <!--\n\nTODO'), ['PLACEHOLDER'])
        self.assertEqual(codes('> <!--\n\nTODO'), ['PLACEHOLDER'])

    def run_cli(self, *args, data=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], input=data, capture_output=True,
                              env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})

    def test_stdin_json_and_warning_exit_status(self):
        output = self.run_cli('-', '--format', 'json', data='TODO 待补充'.encode())
        self.assertEqual(output.returncode, 0)
        self.assertEqual(json.loads(output.stdout)['issues'][0]['code'], 'PLACEHOLDER')
        self.assertEqual(self.run_cli('-', data=b'').returncode, 1)
        self.assertEqual(self.run_cli('-', '--title', ' ', data=b'body').returncode, 1)

    def test_input_errors_and_read_only_utf8_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'article.md'
            data = '\ufeff正文'.encode('utf-8')
            path.write_bytes(data)
            self.assertEqual(self.run_cli(str(path)).returncode, 0)
            self.assertEqual(path.read_bytes(), data)
            path.write_bytes(b'\xff')
            output = self.run_cli(str(path), '--format', 'json')
            self.assertEqual(output.returncode, 2)
            self.assertEqual(json.loads(output.stdout)['error']['code'], 'INPUT_ERROR')
            self.assertEqual(self.run_cli(str(path) + '.missing').returncode, 2)
        self.assertEqual(self.run_cli('-', data=b'\xff').returncode, 2)
        self.assertEqual(self.run_cli('--unknown').returncode, 2)


if __name__ == '__main__':
    unittest.main()
