import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupConnection} from '../lib/setup.js';
import {readConfig} from '../lib/config.js';
import {getSkillPaths, getSkillStatus, installSkill} from '../lib/skill-manager.js';
import {createSkillMetadata, verifySkillMetadata} from '../lib/skill-metadata.js';

const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
const key = `svmcp_${'a'.repeat(24)}.${'b'.repeat(43)}`;

function isolated(t) {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slothvault-runtime-'));
    t.after(() => fs.rmSync(homeDir, {recursive: true, force: true}));
    return {homeDir, env: {PATH: ''}, detectedAgents: ['codex', 'claude-code']};
}

test('two-field setup reuses normalized URLs without exposing keys', async t => {
    const options = isolated(t);
    const checkConnection = async () => ({server: {name: 'slothvault-admin-mcp'}});
    const first = await setupConnection({endpoint: 'https://vault.example/', apiKey: key}, {...options, checkConnection});
    const second = await setupConnection({endpoint: 'https://vault.example/mcp', apiKey: key}, {...options, checkConnection});
    assert.equal(first.profile.endpoint, 'https://vault.example/mcp');
    assert.equal(first.profile.name, second.profile.name);
    assert.ok(!JSON.stringify(first).includes(key));
    assert.equal(Object.keys(readConfig(options).profiles).length, 1);
});

test('Skill metadata verifies bundled files and rejects changes', t => {
    const options = isolated(t);
    const source = getSkillStatus(options).sourcePath;
    const copy = path.join(options.homeDir, 'skill');
    fs.cpSync(source, copy, {recursive: true});
    const metadata = createSkillMetadata(copy, '1.0.0');
    assert.equal(verifySkillMetadata(copy, metadata, '1.0.0').skillVersion, '1.0.0');
    fs.appendFileSync(path.join(copy, 'SKILL.md'), '\nmodified\n');
    assert.throws(() => verifySkillMetadata(copy, metadata, '1.0.0'));
});

test('managed old Skill links migrate; custom targets remain untouched', t => {
    const options = isolated(t);
    const paths = getSkillPaths(options);
    fs.mkdirSync(path.dirname(paths.agents[0].targetPath), {recursive: true});
    fs.symlinkSync(path.join(options.homeDir, '.pipker/slothtool/plugins/slothvault/skills/slothvault-mcp'), paths.agents[0].targetPath, 'dir');
    fs.mkdirSync(paths.agents[1].targetPath, {recursive: true});
    fs.writeFileSync(path.join(paths.agents[1].targetPath, 'custom.txt'), 'keep');
    const result = installSkill({...options, skipConflicts: true});
    assert.equal(result.agents[0].state, 'installed');
    assert.equal(result.agents[1].state, 'conflict');
    assert.equal(fs.readFileSync(path.join(paths.agents[1].targetPath, 'custom.txt'), 'utf8'), 'keep');
});

test('CLI setup JSON masks a stdin key even when connection fails', t => {
    const options = isolated(t);
    const entry = path.join(runtimeRoot, 'bin', 'slothvault-mcp.js');
    const result = spawnSync(process.execPath, [entry, 'setup', '--url', 'http://127.0.0.1:1', '--key-stdin', '--json'], {
        input: key, encoding: 'utf8', timeout: 10_000,
        env: {...process.env, HOME: options.homeDir, USERPROFILE: options.homeDir, CODEX_HOME: path.join(options.homeDir, '.codex')}
    });
    assert.equal(result.status, 4, result.stderr);
    assert.equal(JSON.parse(result.stdout).saved, true);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(key));
});
