"""Exercise the real script and subprocess boundary without host Docker side effects."""
import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from io import StringIO
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from slothvault_deploy import compose
from slothvault_deploy.system import InstallerError
import menu

SCRIPTS = ['menu', 'install', 'check_update', 'update', 'start', 'stop', 'restart', 'status']

class StandaloneCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name).resolve()
        self.root = self.work / 'instance'
        self.root.mkdir()
        self.log = self.work / 'commands.jsonl'
        self.bin = self.work / 'bin'
        self.bin.mkdir()
        docker = self.bin / 'docker'
        docker.write_text('#!' + sys.executable + '\n' + r"""
import json, os, sys
args = sys.argv[1:]
with open(os.environ['DEPLOY_TEST_LOG'], 'a') as stream:
    stream.write(json.dumps(args) + '\n')
if os.environ.get('DEPLOY_FAIL') in args:
    sys.exit(7)
if args[0] == 'inspect':
    print(json.dumps([{'Name':'/app','Config':{'Image':'holic512/slothvault:v2.0.0','Env':['SLOTHVAULT_RELEASE_TAG=v2.0.0','ENCRYPTION_KEY=private-test-value'],'Labels':{'com.docker.compose.service':'slothvault'}},'State':{'Running':True,'Status':'running','Health':{'Status':'healthy'}}}]))
elif '--quiet' in args or '-q' in args:
    print('app')
else:
    print('Docker fixture')
""")
        docker.chmod(0o755)
        self.env = {**os.environ, 'PYTHONDONTWRITEBYTECODE':'1', 'PATH':str(self.bin), 'DEPLOY_TEST_LOG':str(self.log)}
        (self.root / 'compose.yml').write_text(compose.render_compose(compose.DeploymentConfig(root=self.root, data_dir=self.root/'data', provider='sqlite', image='holic512/slothvault:v2.0.0', port=3000, bind_loopback=True)))

    def call(self, script, *args, input=None, env=None):
        return subprocess.run([sys.executable, str(ROOT / (script+'.py')), *args], input=input, text=True, capture_output=True, cwd=self.work, env=env or self.env, timeout=10)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_all_entrypoints_have_help_version_and_reject_old_dispatch_without_docker(self):
        for script in SCRIPTS:
            for option in ['--help', '--version']:
                result = self.call(script, option)
                self.assertEqual(result.returncode, 0, result.stderr)
            for args in [('--unknown',), ('--root',), ('--root', 'relative'), ('--bridge',), ('--action','status')]:
                result = self.call(script, *args)
                self.assertEqual(result.returncode, 2, (script, args, result.stderr))
        self.assertEqual(self.commands(), [])

    def test_real_script_dispatch_preserves_config_and_restart_targets_only_application(self):
        original = (self.root/'compose.yml').read_bytes()
        for script in ['start','stop','restart','status']:
            result = self.call(script, '--root', str(self.root))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('private-test-value', result.stdout + result.stderr)
        commands = self.commands()
        self.assertIn(['compose','-f',str(self.root/'compose.yml'),'up','-d'], commands)
        self.assertIn(['compose','-f',str(self.root/'compose.yml'),'stop'], commands)
        self.assertIn(['compose','-f',str(self.root/'compose.yml'),'restart','slothvault'], commands)
        self.assertFalse(any('pull' in call or 'down' in call for call in commands))
        self.assertEqual((self.root/'compose.yml').read_bytes(), original)

    def test_operation_errors_and_missing_docker_return_failure(self):
        failed = self.call('restart','--root',str(self.root),env={**self.env,'DEPLOY_FAIL':'restart'})
        self.assertEqual(failed.returncode,1)
        missing = self.call('start','--root',str(self.root),env={**self.env,'PATH':''})
        self.assertEqual(missing.returncode,1)
        self.assertIn('Docker',missing.stderr)
        (self.root/'compose.yml').write_text('services: {}\n')
        unmanaged = self.call('stop','--root',str(self.root))
        self.assertEqual(unmanaged.returncode,1)
        self.assertIn('拒绝操作',unmanaged.stderr)

    def test_install_cancellation_writes_nothing_and_confirmed_install_is_private(self):
        target = self.work/'new-instance'
        args = ['--root',str(target),'--provider','sqlite','--data-dir',str(target/'data'),'--port','3100','--image','holic512/slothvault:v2.0.0','--encryption-key','a'*43]
        result = self.call('install',*args,input='n\n')
        self.assertEqual(result.returncode,1)
        self.assertFalse(target.exists())
        result = self.call('install',*args,input='y\n')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((target/'compose.yml').stat().st_mode & 0o777,0o600)
        self.assertEqual((target/'data').stat().st_mode & 0o777,0o700)
        original=(target/'compose.yml').read_bytes()
        again=self.call('install',*args,input='y\n')
        self.assertEqual(again.returncode,1)
        self.assertEqual((target/'compose.yml').read_bytes(),original)

    def test_menu_retains_changed_root_and_blank_input_never_installs(self):
        target=self.work/'another'
        modules={name:importlib.import_module(name) for name in SCRIPTS if name!='menu'}
        with patch('builtins.input',side_effect=['','8',str(target),'4','0']), patch.object(modules['start'],'main',return_value=1) as start, patch.object(modules['install'],'main') as install, redirect_stdout(StringIO()):
            self.assertEqual(menu.main(['--root',str(self.root)]),0)
        start.assert_called_once_with(['--root',str(target)])
        install.assert_not_called()
        for index,(_,module) in enumerate(menu.OPERATIONS,1):
            with patch('builtins.input',side_effect=[str(index),'0']), patch.object(modules[module],'main',return_value=0) as action, redirect_stdout(StringIO()):
                self.assertEqual(menu.main(['--root',str(self.root)]),0)
                action.assert_called_once_with(['--root',str(self.root)])
        with patch('builtins.input',side_effect=KeyboardInterrupt), redirect_stdout(StringIO()):
            self.assertEqual(menu.main([]),130)

    def test_all_database_renderers_preserve_private_data_and_port_contract(self):
        for provider in compose.PROVIDERS:
            config=compose.DeploymentConfig(root=self.root,data_dir=self.root/'data',database_dir=self.root/provider if provider!='sqlite' else None,provider=provider,image='holic512/slothvault:v2.0.0',port=3100,database_name='vault',database_user='vault',database_password='secret',database_root_password='root-secret',bind_loopback=True)
            source=compose.render_compose(config)
            self.assertIn('127.0.0.1:3100:3000',source)
            self.assertIn(str(self.root/'data'),source)
            self.assertIn(compose.MANAGED_COMPOSE_MARKER,source)

if __name__ == '__main__':
    unittest.main()
