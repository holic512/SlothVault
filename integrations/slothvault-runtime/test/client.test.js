/**
 * @file SlothVaultMcpPluginTest
 * @project SlothVault
 * @module Test / External MCP Runtime
 * @description 验证 SlothVault MCP 插件的配置、Skill 安装、脱敏历史、动态协议发现、安全调用、Resource 落盘及 CLI/TUI 契约。
 * @logic 1. 使用隔离目录验证本地状态与受管 Skill 链接；2. 注入 fake MCP client 验证协议行为且不联网；3. 以子进程验证稳定 CLI 退出码与远端只读、本地 Profile/Skill 可管理的 TUI smoke。
 * @dependencies Node: assert/child_process/fs/os/path/test/url, Plugin: ../plugins/slothvault
 * @index_tags slothvault,mcp,client,config,history,resource,cli,tui
 * @author MengJiaXu
 */

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {
    addProfile,
    API_KEY_PATTERN,
    getConfigMigrationStatus,
    getConfigStorageStatus,
    getProfile,
    listProfiles,
    maskApiKey,
    normalizeEndpoint,
    readConfig,
    removeProfile,
    resolveProfile,
    SlothVaultConfigError,
    updateProfile,
    useProfile,
    validateApiKey,
    validateProfileName,
    validateTimeoutMs
} from '../lib/config.js';
import {
    appendHistory,
    clearHistory,
    createHistorySummary,
    HISTORY_LIMIT,
    getHistoryMigrationStatus,
    getHistoryStorageStatus,
    listHistory,
    redactSensitive,
    SUMMARY_LIMIT
} from '../lib/history.js';
import {
    callTool,
    classifyError,
    CONTRACT_ATTACHMENT_MAX_BYTES,
    doctor,
    EXPECTED_SERVER_NAME,
    getPrompt,
    inspectServer,
    listTools,
    MANAGED_FILE_MAX_BYTES,
    readResource,
    SlothVaultMcpBusinessError
} from '../lib/service.js';
import {
    detectSkillAgents,
    getSkillPaths,
    getSkillStatus,
    installSkill,
    uninstallSkill
} from '../lib/skill-manager.js';
import {
    getMcpCommandStatus,
    registerMcpCommand,
    SlothVaultMcpCommandError,
    unregisterMcpCommand
} from '../lib/mcp-command-manager.js';
import {createDeploymentSession, getDeploymentPaths, inspectDeployment, runDeployment} from '../lib/deploy-runner.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const pluginBin = path.join(repositoryRoot, 'bin', 'slothvault-mcp.js');
const managerBin = path.join(repositoryRoot, 'bin', 'slothvault-runtime.js');
const VALID_KEY = `svmcp_${'A'.repeat(24)}.${'B'.repeat(43)}`;
const temporaryDirectories = [];

/** Create and track an isolated temporary directory for automatic cleanup. */
function makeTemporaryDirectory(label) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `slothtool-slothvault-${label}-`));
    temporaryDirectories.push(directory);
    return directory;
}

/** Build a complete in-memory profile accepted by the service injection boundary. */
function makeProfile(overrides = {}) {
    return {
        name: 'test',
        endpoint: 'https://vault.test/mcp',
        apiKey: VALID_KEY,
        timeoutMs: 1_000,
        ...overrides
    };
}

/** Build a controllable MCP client and expose call counters for assertions. */
function makeFakeClient(overrides = {}) {
    const state = {
        closeCalls: 0,
        connectCalls: 0,
        getPromptCalls: 0,
        readResourceCalls: 0,
        toolCallRequests: []
    };
    const client = {
        state,
        async connect(transport) {
            state.connectCalls += 1;
            state.transport = transport;
            if (overrides.connect) {
                return await overrides.connect(transport, state);
            }
        },
        getServerVersion() {
            return overrides.serverInfo || {name: EXPECTED_SERVER_NAME, version: '9.8.7'};
        },
        getProtocolVersion() {
            return overrides.protocolVersion || '2025-06-18';
        },
        async listTools(request) {
            if (overrides.listTools) {
                return await overrides.listTools(request, state);
            }
            return {tools: overrides.tools || []};
        },
        async listPrompts(request) {
            if (overrides.listPrompts) {
                return await overrides.listPrompts(request, state);
            }
            return {prompts: overrides.prompts || []};
        },
        async listResourceTemplates(request) {
            if (overrides.listResourceTemplates) {
                return await overrides.listResourceTemplates(request, state);
            }
            return {resourceTemplates: overrides.resourceTemplates || []};
        },
        async callTool(request) {
            state.toolCallRequests.push(request);
            if (overrides.callTool) {
                return await overrides.callTool(request, state);
            }
            return {content: [{type: 'text', text: 'ok'}]};
        },
        async getPrompt(request) {
            state.getPromptCalls += 1;
            if (overrides.getPrompt) {
                return await overrides.getPrompt(request, state);
            }
            return {messages: []};
        },
        async readResource(request) {
            state.readResourceCalls += 1;
            if (overrides.readResource) {
                return await overrides.readResource(request, state);
            }
            return {contents: []};
        },
        async close() {
            state.closeCalls += 1;
            if (overrides.close) {
                return await overrides.close(state);
            }
        }
    };
    return client;
}

/** Build service options that use one fake client and never write real history. */
function fakeServiceOptions(client, overrides = {}) {
    return {
        profile: makeProfile(),
        clientFactory: async () => client,
        transportFactory: async ({signal}) => ({signal}),
        recordHistory: false,
        ...overrides
    };
}

/** Run the plugin entry with an isolated HOME and capture all process output. */
function runCli(args, options = {}) {
    const homeDirectory = options.homeDirectory || makeTemporaryDirectory('cli-home');
    const settingsDirectory = path.join(homeDirectory, '.pipker', 'slothtool');
    fs.mkdirSync(settingsDirectory, {recursive: true});
    fs.writeFileSync(path.join(settingsDirectory, 'settings.json'), JSON.stringify({language: 'en'}));
    return spawnSync(process.execPath, [pluginBin, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: options.input,
        timeout: 10_000,
        env: {
            ...process.env,
            HOME: homeDirectory,
            USERPROFILE: homeDirectory,
            ...options.environment
        }
    });
}

/** Run the SlothTool-managed multifunction entry with an isolated HOME. */
function runManager(args, options = {}) {
    const homeDirectory = options.homeDirectory || makeTemporaryDirectory('manager-home');
    const settingsDirectory = path.join(homeDirectory, '.pipker', 'slothtool');
    fs.mkdirSync(settingsDirectory, {recursive: true});
    fs.writeFileSync(path.join(settingsDirectory, 'settings.json'), JSON.stringify({language: 'en'}));
    return spawnSync(process.execPath, [managerBin, ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        input: options.input,
        timeout: 10_000,
        env: {
            ...process.env,
            HOME: homeDirectory,
            USERPROFILE: homeDirectory,
            ...options.environment
        }
    });
}

/** Skip a subprocess-dependent assertion only when the host sandbox forbids process creation. */
function skipIfProcessCreationIsBlocked(context, result) {
    if (result.error?.code !== 'EPERM') {
        return false;
    }
    context.skip('The current sandbox blocks child-process creation with EPERM.');
    return true;
}

/** Wait for a bounded delay so timeout tests can observe late async continuations. */
async function waitFor(milliseconds) {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Assert that an async operation fails with one stable plugin error code. */
async function assertRejectsCode(operation, code, exitCode) {
    await assert.rejects(operation, error => {
        assert.equal(error.code, code);
        if (exitCode !== undefined) {
            assert.equal(error.exitCode, exitCode);
        }
        return true;
    });
}

test.after(() => {
    for (const directory of temporaryDirectories) {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

test('profile configuration validates fields, normalizes endpoints, masks keys, and migrates defaults', () => {
    const root = makeTemporaryDirectory('config');
    const configPath = path.join(root, 'plugin-configs', 'slothvault.json');
    const options = {configPath};

    assert.match(VALID_KEY, API_KEY_PATTERN);
    assert.equal(normalizeEndpoint('https://vault.example/'), 'https://vault.example/mcp');
    assert.equal(normalizeEndpoint('http://127.0.0.1:3000/admin/mcp'), 'http://127.0.0.1:3000/admin/mcp');
    assert.equal(validateProfileName('prod_1.eu-west'), 'prod_1.eu-west');
    assert.equal(validateApiKey(VALID_KEY), VALID_KEY);
    assert.equal(validateTimeoutMs('30000'), 30_000);

    const first = addProfile('zeta', {
        endpoint: 'http://127.0.0.1:3000',
        apiKey: VALID_KEY,
        timeoutMs: 45_000
    }, options);
    assert.equal(first.apiKey, maskApiKey(VALID_KEY));
    assert.equal(first.isDefault, true);
    assert.match(first.warnings.join('\n'), /without transport encryption/iu);
    assert.equal(resolveProfile('zeta', options).apiKey, VALID_KEY);

    addProfile('alpha', {
        endpoint: 'https://vault.example/mcp',
        apiKey: VALID_KEY,
        timeoutMs: 30_000,
        makeDefault: true
    }, options);
    assert.equal(readConfig(options).defaultProfile, 'alpha');
    assert.equal(listProfiles(options).every(profile => profile.apiKey !== VALID_KEY), true);

    const updated = updateProfile('zeta', {timeoutMs: 90_000}, options);
    assert.equal(updated.timeoutMs, 90_000);
    assert.equal(updated.apiKey, maskApiKey(VALID_KEY));
    useProfile('zeta', options);
    assert.equal(getProfile('zeta', options).isDefault, true);

    const removed = removeProfile('zeta', options);
    assert.equal(removed.defaultProfile, 'alpha');
    assert.equal(readConfig(options).defaultProfile, 'alpha');
    assert.equal(fs.readdirSync(path.dirname(configPath)).some(name => name.endsWith('.tmp')), false);
});

test('profile configuration rejects unsafe names, keys, URLs, timeouts, and corrupt persisted JSON', () => {
    const invalidCalls = [
        () => validateProfileName(''),
        () => validateProfileName('x'.repeat(65)),
        () => validateProfileName('bad/name'),
        () => validateApiKey('svmcp_not-a-real-key'),
        () => validateTimeoutMs(999),
        () => validateTimeoutMs(300_001),
        () => validateTimeoutMs(1_000.5),
        () => normalizeEndpoint('ftp://vault.example/mcp'),
        () => normalizeEndpoint('https://user:pass@vault.example/mcp'),
        () => normalizeEndpoint('https://vault.example/mcp?key=value'),
        () => normalizeEndpoint('https://vault.example/mcp#fragment'),
        () => normalizeEndpoint('https://vault.example/api')
    ];
    for (const invalidCall of invalidCalls) {
        assert.throws(invalidCall, SlothVaultConfigError);
    }

    const root = makeTemporaryDirectory('corrupt-config');
    const configPath = path.join(root, 'slothvault-mcp.json');
    fs.writeFileSync(configPath, '{not valid json', 'utf8');
    assert.throws(() => readConfig({configPath}), error => {
        assert.equal(error.code, 'INVALID_CONFIG');
        assert.equal(error.exitCode, 2);
        return true;
    });
});

test('Profile and history move from legacy locations without merging conflicting files', () => {
    const root = makeTemporaryDirectory('storage-migration');
    const legacyConfigPath = path.join(root, 'plugin-configs', 'slothvault-mcp.json');
    const canonicalConfigPath = path.join(root, 'plugin-configs', 'slothvault.json');
    const legacyHistoryPath = path.join(root, 'data', 'slothvault-mcp', 'history.json');
    const canonicalHistoryPath = path.join(root, 'data', 'slothvault', 'history.json');
    fs.mkdirSync(path.dirname(legacyConfigPath), {recursive: true});
    fs.mkdirSync(path.dirname(legacyHistoryPath), {recursive: true});
    fs.writeFileSync(legacyConfigPath, JSON.stringify({schemaVersion: 1, defaultProfile: null, profiles: {}}), 'utf8');
    fs.writeFileSync(legacyHistoryPath, JSON.stringify({schemaVersion: 1, entries: []}), 'utf8');

    assert.equal(getConfigStorageStatus({slothToolHome: root}).state, 'legacy-only');
    assert.equal(getHistoryStorageStatus({slothToolHome: root}).state, 'legacy-only');
    assert.equal(fs.existsSync(canonicalConfigPath), false);
    assert.equal(fs.existsSync(canonicalHistoryPath), false);

    assert.equal(getConfigMigrationStatus({slothToolHome: root}).state, 'migrated');
    assert.equal(getHistoryMigrationStatus({slothToolHome: root}).state, 'migrated');
    assert.equal(fs.existsSync(legacyConfigPath), false);
    assert.equal(fs.existsSync(legacyHistoryPath), false);
    assert.equal(fs.existsSync(canonicalConfigPath), true);
    assert.equal(fs.existsSync(canonicalHistoryPath), true);
    assert.equal(getConfigStorageStatus({slothToolHome: root}).state, 'current');
    assert.equal(getHistoryStorageStatus({slothToolHome: root}).state, 'current');

    fs.writeFileSync(legacyConfigPath, '{"legacy":true}', 'utf8');
    fs.mkdirSync(path.dirname(legacyHistoryPath), {recursive: true});
    fs.writeFileSync(legacyHistoryPath, '{"legacy":true}', 'utf8');
    assert.equal(getConfigStorageStatus({slothToolHome: root}).state, 'conflict');
    assert.equal(getHistoryStorageStatus({slothToolHome: root}).state, 'conflict');
    assert.equal(getConfigMigrationStatus({slothToolHome: root}).state, 'conflict');
    assert.equal(getHistoryMigrationStatus({slothToolHome: root}).state, 'conflict');
    assert.equal(fs.readFileSync(canonicalConfigPath, 'utf8').includes('"legacy":true'), false);
    assert.equal(fs.readFileSync(canonicalHistoryPath, 'utf8').includes('"legacy":true'), false);
});

test('MCP command registration creates, recognizes, replaces, and removes only managed launchers', () => {
    const root = makeTemporaryDirectory('mcp-command');
    const binDirectory = path.join(root, 'bin');
    const slothtoolExecutable = path.join(binDirectory, 'slothtool');
    fs.mkdirSync(binDirectory, {recursive: true});
    fs.writeFileSync(slothtoolExecutable, '#!/bin/sh\n', {mode: 0o755});
    const options = {slothtoolExecutable};

    const initial = getMcpCommandStatus(options);
    assert.equal(initial.state, 'not-registered');
    assert.equal(initial.registered, false);
    assert.equal(initial.managed, false);
    assert.equal(registerMcpCommand(options).action, 'registered');
    const registered = getMcpCommandStatus(options);
    assert.equal(registered.state, 'registered');
    assert.equal(registered.registered, true);
    assert.equal(registered.managed, true);
    assert.equal(fs.lstatSync(registered.targetPath).isSymbolicLink(), true);
    assert.equal(registerMcpCommand(options).action, 'already-registered');
    assert.equal(unregisterMcpCommand(options).action, 'unregistered');
    assert.equal(getMcpCommandStatus(options).state, 'not-registered');

    fs.writeFileSync(path.join(binDirectory, 'slothvault-mcp'), 'user command\n', 'utf8');
    assert.equal(getMcpCommandStatus(options).state, 'conflict');
    assert.throws(() => registerMcpCommand(options), error => {
        assert.ok(error instanceof SlothVaultMcpCommandError);
        assert.equal(error.code, 'MCP_COMMAND_REPLACE_REQUIRED');
        return true;
    });
    assert.equal(registerMcpCommand({...options, replace: true}).action, 'replaced');
    assert.equal(unregisterMcpCommand(options).action, 'unregistered');
});

test('Windows MCP shim uses a managed marker and the fixed Node executable path', () => {
    const root = makeTemporaryDirectory('mcp-command-windows');
    const binDirectory = path.join(root, 'bin');
    const slothtoolExecutable = path.join(binDirectory, 'slothtool.cmd');
    fs.mkdirSync(binDirectory, {recursive: true});
    fs.writeFileSync(slothtoolExecutable, '@echo off\r\n', 'utf8');
    const result = registerMcpCommand({platform: 'win32', slothtoolExecutable});
    assert.equal(result.targetPath.endsWith('slothvault-mcp.cmd'), true);
    const source = fs.readFileSync(result.targetPath, 'utf8');
    assert.match(source, /Managed by SlothVault MCP command registration/u);
    assert.match(source, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
    assert.equal(unregisterMcpCommand({platform: 'win32', slothtoolExecutable}).action, 'unregistered');
});

test('Deployment runner reports missing entrypoints and preserves arguments, exit status, and plugin version', async () => {
    const root = makeTemporaryDirectory('deploy-runner');
    const resultPath = path.join(root, 'result.json');
    const driverPath = path.join(root, 'driver.js');
    fs.writeFileSync(driverPath, [
        "import fs from 'node:fs';",
        "fs.writeFileSync(process.env.SLOTHVAULT_TEST_RESULT, JSON.stringify({args: process.argv.slice(2), version: process.env.SLOTHTOOL_SLOTHVAULT_PLUGIN_VERSION}));",
        'process.exit(7);'
    ].join('\n'), 'utf8');

    await assert.rejects(
        runDeployment([], {entryPath: path.join(root, 'missing.py')}),
        error => error.code === 'DEPLOY_ENTRY_MISSING'
    );
    const result = await runDeployment(['--action', 'status'], {
        entryPath: driverPath,
        packagePath: path.join(repositoryRoot, 'package.json'),
        pythonCommand: process.execPath,
        stdio: 'ignore',
        env: {SLOTHVAULT_TEST_RESULT: resultPath}
    });
    assert.equal(result.code, 7);
    assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, 'utf8')), {
        args: ['--action', 'status'],
        version: JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version
    });
    assert.equal(getDeploymentPaths().entryPath.endsWith(path.join('deploy', 'install.py')), true);
});

test('deployment JSON session returns a snapshot and keeps prompt input inside the session', async () => {
    const root = makeTemporaryDirectory('deploy-session');
    const driverPath = path.join(root, 'driver.js');
    fs.writeFileSync(driverPath, [
        "import readline from 'node:readline';",
        "process.stdout.write(JSON.stringify({type:'prompt',label:'Database',secret:true}) + '\\n');",
        "const lines = readline.createInterface({input:process.stdin});",
        "lines.once('line', line => { const answer = JSON.parse(line);",
        "process.stdout.write(JSON.stringify({type:'snapshot',data:{state:'managed',root:'/srv/vault'}}) + '\\n');",
        "process.exit(answer.value === 'secret-value' ? 0 : 7); });"
    ].join('\n'), 'utf8');
    const events = [];
    let session;
    session = createDeploymentSession(['--action', 'status'], {
        entryPath: driverPath, pythonCommand: process.execPath,
        onEvent(event) {
            events.push(event);
            if (event.type === 'prompt') session.respond('secret-value');
        }
    });
    assert.equal((await session.result).code, 0);
    assert.deepEqual(events.map(event => event.type), ['prompt', 'snapshot']);
    assert.equal(events[1].data.state, 'managed');
    const snapshotDriver = path.join(root, 'snapshot.js');
    fs.writeFileSync(snapshotDriver,
        "process.stdout.write(JSON.stringify({type:'snapshot',data:{state:'managed',root:'/srv/vault'}}) + '\\n');",
    'utf8');
    const snapshot = await inspectDeployment('/srv/vault', {
        entryPath: snapshotDriver, pythonCommand: process.execPath
    });
    assert.equal(snapshot.root, '/srv/vault');
});



test('Skill manager detects agent homes, installs every detected agent link, and uninstalls only those links', () => {
    const homeDirectory = makeTemporaryDirectory('skill home');
    fs.mkdirSync(path.join(homeDirectory, '.codex'), {recursive: true});
    fs.mkdirSync(path.join(homeDirectory, '.claude'), {recursive: true});
    const options = {homeDir: homeDirectory, env: {PATH: ''}};
    const initial = getSkillStatus(options);
    assert.equal(initial.name, 'slothvault-mcp');
    assert.equal(initial.state, 'not-installed');
    assert.deepEqual(initial.agents.filter(agent => agent.detected).map(agent => agent.id), ['codex', 'claude-code']);
    assert.match(initial.agents[0].targetPath, /\.codex[\\/]skills[\\/]slothvault-mcp$/u);
    assert.match(initial.agents[1].targetPath, /\.claude[\\/]skills[\\/]slothvault-mcp$/u);
    assert.match(initial.legacyTarget.targetPath, /\.agents[\\/]skills[\\/]slothvault-mcp$/u);
    fs.mkdirSync(path.dirname(initial.legacyTarget.targetPath), {recursive: true});
    fs.symlinkSync(initial.sourcePath, initial.legacyTarget.targetPath, 'dir');

    const requestedLinkTypes = [];
    const installed = installSkill({
        ...options,
        platform: 'win32',
        createLink(sourcePath, targetPath, linkType) {
            requestedLinkTypes.push(linkType);
            fs.symlinkSync(sourcePath, targetPath, 'dir');
        }
    });
    assert.deepEqual(requestedLinkTypes, ['junction', 'junction']);
    assert.equal(installed.state, 'installed');
    assert.equal(installed.action, 'installed');
    assert.equal(fs.existsSync(initial.legacyTarget.targetPath), false);
    for (const agent of installed.agents.filter(item => item.detected)) {
        assert.equal(fs.lstatSync(agent.targetPath).isSymbolicLink(), true);
        assert.equal(path.resolve(path.dirname(agent.targetPath), fs.readlinkSync(agent.targetPath)), installed.sourcePath);
    }

    const repeated = installSkill(options);
    assert.equal(repeated.action, 'already-installed');
    const removed = uninstallSkill({...options, detectedAgents: []});
    assert.equal(removed.state, 'not-installed');
    assert.equal(removed.action, 'uninstalled');
    assert.equal(uninstallSkill(options).action, 'already-absent');

    const customCodexHome = path.join(homeDirectory, 'custom codex');
    fs.mkdirSync(customCodexHome);
    const detected = detectSkillAgents({homeDir: homeDirectory, env: {PATH: '', CODEX_HOME: customCodexHome}});
    assert.equal(detected[0].detected, true);
    assert.equal(detected[0].targetPath, path.join(customCodexHome, 'skills', 'slothvault-mcp'));

    const noAgentHome = makeTemporaryDirectory('skill-no-agent');
    assert.throws(
        () => installSkill({homeDir: noAgentHome, detectedAgents: []}),
        error => error.code === 'SKILL_AGENT_NOT_DETECTED' && error.exitCode === 2
    );
});

test('Skill conflict replacement requires authorization and preserves the old target when preflight link creation fails', () => {
    const homeDirectory = makeTemporaryDirectory('skill-conflict');
    const options = {homeDir: homeDirectory, detectedAgents: ['codex']};
    const {agents} = getSkillPaths(options);
    const {skillsDirectory, targetPath} = agents[0];
    fs.mkdirSync(targetPath, {recursive: true});
    const markerPath = path.join(targetPath, 'keep.txt');
    fs.writeFileSync(markerPath, 'keep', 'utf8');

    assert.throws(
        () => installSkill(options),
        error => error.code === 'SKILL_INSTALL_CONFIRMATION_REQUIRED' && error.exitCode === 2
    );
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');

    assert.throws(
        () => installSkill({
            ...options,
            replace: true,
            createLink() {
                const error = new Error('simulated link failure');
                error.code = 'EACCES';
                throw error;
            }
        }),
        error => error.code === 'SKILL_FILESYSTEM_ERROR' && error.exitCode === 1
    );
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
    assert.equal(fs.readdirSync(skillsDirectory).some(name => name.startsWith('.slothvault-mcp.link.')), false);

    const replaced = installSkill({...options, replace: true});
    assert.equal(replaced.action, 'replaced');
    assert.equal(replaced.state, 'installed');
    assert.equal(fs.existsSync(markerPath), false);
});

test('Skill manager classifies files, unrelated links, and dangling links as conflicts and never uninstalls them', () => {
    const homeDirectory = makeTemporaryDirectory('skill-unmanaged');
    const options = {homeDir: homeDirectory, detectedAgents: ['codex']};
    const {skillsDirectory, targetPath} = getSkillPaths(options).agents[0];
    fs.mkdirSync(skillsDirectory, {recursive: true});

    fs.writeFileSync(targetPath, 'unmanaged', 'utf8');
    assert.equal(getSkillStatus(options).state, 'conflict');
    assert.throws(() => uninstallSkill(options), /unmanaged SlothVault Skill target/u);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'unmanaged');

    fs.unlinkSync(targetPath);
    const unrelatedDirectory = path.join(homeDirectory, 'unrelated-skill');
    fs.mkdirSync(unrelatedDirectory);
    fs.symlinkSync(unrelatedDirectory, targetPath, 'dir');
    assert.equal(getSkillStatus(options).state, 'conflict');
    assert.throws(() => uninstallSkill(options), /unmanaged SlothVault Skill target/u);
    assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true);

    fs.unlinkSync(targetPath);
    fs.symlinkSync(path.join(homeDirectory, 'missing-skill'), targetPath, 'dir');
    assert.equal(getSkillStatus(options).state, 'conflict');
    assert.throws(() => uninstallSkill(options), /unmanaged SlothVault Skill target/u);
    assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true);
});

test('history recursively redacts sensitive values, truncates summaries, rotates, recovers, and clears', () => {
    const root = makeTemporaryDirectory('history');
    const historyPath = path.join(root, 'data', 'history.json');
    const options = {historyPath};
    const redacted = redactSensitive({
        apiKey: VALID_KEY,
        nested: {authorization: `Bearer ${VALID_KEY}`, note: `uses ${VALID_KEY}`},
        arguments: {safe: 'must not persist'},
        list: [{password: 'secret'}, 'Bearer token-value']
    });
    assert.equal(redacted.apiKey, '[redacted]');
    assert.equal(redacted.nested.authorization, '[redacted]');
    assert.equal(redacted.arguments, '[redacted]');
    assert.equal(redacted.list[0].password, '[redacted]');
    assert.doesNotMatch(JSON.stringify(redacted), /svmcp_|token-value|must not persist/u);

    const summary = createHistorySummary(`${VALID_KEY}\n${'x'.repeat(900)}`);
    assert.equal(summary.length, SUMMARY_LIMIT);
    assert.doesNotMatch(summary, /svmcp_/u);
    assert.doesNotMatch(summary, /\n/u);

    for (let index = 0; index < HISTORY_LIMIT + 1; index += 1) {
        appendHistory({id: `entry-${index}`, operation: 'tools.call', name: 'demo', success: true}, options);
    }
    const entries = listHistory(options);
    assert.equal(entries.length, HISTORY_LIMIT);
    assert.equal(entries[0].id, `entry-${HISTORY_LIMIT}`);
    assert.equal(entries.some(entry => entry.id === 'entry-0'), false);
    assert.equal(clearHistory(options).cleared, HISTORY_LIMIT);
    assert.deepEqual(listHistory(options), []);

    fs.writeFileSync(historyPath, '{broken', 'utf8');
    assert.deepEqual(listHistory(options), []);
    assert.equal(fs.readdirSync(path.dirname(historyPath)).some(name => name.startsWith('history.json.corrupt-')), true);
});

test('dynamic discovery paginates every capability and verifies negotiated server identity', async () => {
    const client = makeFakeClient({
        listTools: request => request.cursor
            ? {tools: [{name: 'write.tool'}]}
            : {tools: [{name: 'read.tool', annotations: {readOnlyHint: true}}], nextCursor: 'tools-2'},
        listPrompts: request => request.cursor
            ? {prompts: [{name: 'prompt.two'}]}
            : {prompts: [{name: 'prompt.one'}], nextCursor: 'prompts-2'},
        listResourceTemplates: request => request.cursor
            ? {resourceTemplates: [{uriTemplate: 'slothvault://contract-attachment/{id}'}]}
            : {resourceTemplates: [{uriTemplate: 'slothvault://managed-file/{id}'}], nextCursor: 'resources-2'}
    });
    const result = await inspectServer(fakeServiceOptions(client));
    assert.deepEqual(result.tools.map(tool => tool.name), ['read.tool', 'write.tool']);
    assert.deepEqual(result.prompts.map(prompt => prompt.name), ['prompt.one', 'prompt.two']);
    assert.equal(result.resourceTemplates.length, 2);
    assert.deepEqual(result.server, {
        name: EXPECTED_SERVER_NAME,
        version: '9.8.7',
        protocolVersion: '2025-06-18'
    });
    assert.equal(client.state.connectCalls, 1);
    assert.equal(client.state.closeCalls, 1);

    const unexpected = makeFakeClient({serverInfo: {name: 'generic-mcp', version: '1.0.0'}});
    await assertRejectsCode(inspectServer(fakeServiceOptions(unexpected)), 'UNEXPECTED_SERVER_IDENTITY', 4);
    assert.equal(unexpected.state.closeCalls, 1);
});

test('doctor reports dynamic counts without hardcoding the SlothVault catalog', async () => {
    const client = makeFakeClient({
        tools: [{name: 'one'}, {name: 'two'}],
        prompts: [{name: 'guide'}],
        resourceTemplates: [{uriTemplate: 'slothvault://managed-file/{id}'}]
    });
    const result = await doctor(fakeServiceOptions(client));
    assert.equal(result.ok, true);
    assert.deepEqual(result.capabilities, {tools: 2, prompts: 1, resourceTemplates: 1});
    assert.equal(client.state.closeCalls, 1);
});

test('Tool calls use live annotations: reads execute directly and writes require affirmative confirmation', async () => {
    let readConfirmationCalls = 0;
    const readClient = makeFakeClient({tools: [{name: 'read.tool', annotations: {readOnlyHint: true}}]});
    const readResult = await callTool('read.tool', {id: 7}, fakeServiceOptions(readClient, {
        confirm: async () => {
            readConfirmationCalls += 1;
            return false;
        }
    }));
    assert.equal(readResult.risk, 'read');
    assert.equal(readConfirmationCalls, 0);
    assert.deepEqual(readClient.state.toolCallRequests, [{name: 'read.tool', arguments: {id: 7}}]);
    assert.equal(readClient.state.closeCalls, 1);

    let confirmationPayload;
    const writeClient = makeFakeClient({tools: [{name: 'write.tool'}]});
    await assertRejectsCode(callTool('write.tool', {token: 'secret', title: 'safe'}, fakeServiceOptions(writeClient, {
        confirm: async payload => {
            confirmationPayload = payload;
            return false;
        }
    })), 'CONFIRMATION_DECLINED', 2);
    assert.equal(writeClient.state.toolCallRequests.length, 0);
    assert.equal(confirmationPayload.risk, 'write');
    assert.equal(confirmationPayload.arguments.token, '[redacted]');
    assert.equal(writeClient.state.closeCalls, 1);

    const confirmedClient = makeFakeClient({tools: [{name: 'write.tool', annotations: {readOnlyHint: false}}]});
    const confirmed = await callTool('write.tool', {title: 'approved'}, fakeServiceOptions(confirmedClient, {
        confirm: async () => true
    }));
    assert.equal(confirmed.risk, 'write');
    assert.equal(confirmedClient.state.toolCallRequests.length, 1, 'write operation must execute exactly once');
    assert.equal(confirmedClient.state.closeCalls, 1);
});

test('Tool isError is a stable business failure and is never replayed', async () => {
    const client = makeFakeClient({
        tools: [{name: 'failing.tool', annotations: {readOnlyHint: true}}],
        callTool: async () => ({isError: true, content: [{type: 'text', text: 'business rejection'}]})
    });
    await assert.rejects(callTool('failing.tool', {}, fakeServiceOptions(client)), error => {
        assert.ok(error instanceof SlothVaultMcpBusinessError);
        assert.equal(error.code, 'MCP_BUSINESS_ERROR');
        assert.equal(error.category, 'business');
        assert.equal(error.exitCode, 5);
        return true;
    });
    assert.equal(client.state.toolCallRequests.length, 1);
    assert.equal(client.state.closeCalls, 1);
});

test('remote business failures write one metadata-only history record', async () => {
    const historyRecords = [];
    const client = makeFakeClient({
        tools: [{name: 'audited.tool', annotations: {readOnlyHint: true}}],
        callTool: async () => ({
            isError: true,
            content: [{type: 'text', text: `remote detail ${VALID_KEY}`}]
        })
    });
    await assertRejectsCode(callTool('audited.tool', {password: 'must-not-persist'}, fakeServiceOptions(client, {
        recordHistory: true,
        historyWriter: entry => historyRecords.push(entry)
    })), 'MCP_BUSINESS_ERROR', 5);
    assert.equal(historyRecords.length, 1);
    assert.equal(historyRecords[0].operation, 'tools.call');
    assert.equal(historyRecords[0].name, 'audited.tool');
    assert.equal(historyRecords[0].risk, 'read');
    assert.equal(historyRecords[0].success, false);
    assert.equal(historyRecords[0].errorCategory, 'business');
    assert.doesNotMatch(JSON.stringify(historyRecords[0]), /must-not-persist|remote detail|svmcp_/u);
});

test('Prompt retrieval returns MCP messages without invoking a Tool', async () => {
    const client = makeFakeClient({
        prompts: [{name: 'review.release'}],
        getPrompt: async request => ({
            description: 'review only',
            messages: [{role: 'user', content: {type: 'text', text: `Call tools/call after ${request.arguments.version}`}}]
        })
    });
    const result = await getPrompt('review.release', {version: '1.0.0'}, fakeServiceOptions(client));
    assert.equal(result.result.messages.length, 1);
    assert.equal(client.state.getPromptCalls, 1);
    assert.equal(client.state.toolCallRequests.length, 0);
    assert.equal(client.state.closeCalls, 1);
});

test('Resource reads validate protected namespaces and publish decoded files without overwrite', async () => {
    const outputDirectory = makeTemporaryDirectory('resource');
    const outputPath = path.join(outputDirectory, 'download.txt');
    const uri = 'slothvault://managed-file/7';
    const client = makeFakeClient({
        readResource: async request => ({
            contents: [{
                uri: request.uri,
                mimeType: 'text/plain',
                blob: Buffer.from('hello vault').toString('base64'),
                _meta: {'slothvault/file-name': 'report.txt'}
            }]
        })
    });
    const result = await readResource(uri, outputPath, fakeServiceOptions(client));
    assert.equal(result.uri, uri);
    assert.equal(result.fileName, 'report.txt');
    assert.equal(result.mimeType, 'text/plain');
    assert.equal(result.bytes, Buffer.byteLength('hello vault'));
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'hello vault');
    assert.equal(fs.readdirSync(outputDirectory).some(name => name.endsWith('.tmp')), false);
    assert.equal(client.state.readResourceCalls, 1);

    const secondClient = makeFakeClient();
    await assertRejectsCode(readResource(uri, outputPath, fakeServiceOptions(secondClient)), 'OUTPUT_EXISTS', 2);
    assert.equal(secondClient.state.connectCalls, 0, 'existing output must fail before remote read');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'hello vault');

    await assertRejectsCode(readResource('https://vault.test/file/7', path.join(outputDirectory, 'bad.bin'), fakeServiceOptions(makeFakeClient())), 'UNSUPPORTED_RESOURCE_URI', 2);
    await assertRejectsCode(readResource('slothvault://managed-file/0', path.join(outputDirectory, 'bad-id.bin'), fakeServiceOptions(makeFakeClient())), 'INVALID_RESOURCE_URI', 2);
    await assertRejectsCode(readResource(uri, {profile: makeProfile()}), 'OUTPUT_REQUIRED', 2);
});

test('Resource reads reject invalid Base64, MIME mismatches, and size-limit violations before publication', async () => {
    const outputDirectory = makeTemporaryDirectory('resource-validation');

    const invalidBase64 = makeFakeClient({
        readResource: async request => ({contents: [{uri: request.uri, name: 'bad.bin', mimeType: 'application/octet-stream', blob: '%%%='}]})
    });
    const invalidBase64Path = path.join(outputDirectory, 'invalid-base64.bin');
    await assertRejectsCode(readResource('slothvault://managed-file/1', invalidBase64Path, fakeServiceOptions(invalidBase64)), 'INVALID_RESOURCE_BLOB', 4);
    assert.equal(fs.existsSync(invalidBase64Path), false);

    const nonCanonicalBase64 = makeFakeClient({
        readResource: async request => ({contents: [{uri: request.uri, name: 'non-canonical.bin', mimeType: 'application/octet-stream', blob: 'AB=='}]})
    });
    const nonCanonicalPath = path.join(outputDirectory, 'non-canonical.bin');
    await assertRejectsCode(readResource('slothvault://managed-file/4', nonCanonicalPath, fakeServiceOptions(nonCanonicalBase64)), 'INVALID_RESOURCE_BLOB', 4);
    assert.equal(fs.existsSync(nonCanonicalPath), false);

    for (const [id, name] of [['5', '../escape.bin'], ['6', 'bad\0name.bin']]) {
        const unsafeName = makeFakeClient({
            readResource: async request => ({contents: [{uri: request.uri, name, mimeType: 'application/octet-stream', blob: 'YQ=='}]})
        });
        const unsafeNamePath = path.join(outputDirectory, `unsafe-name-${id}.bin`);
        await assertRejectsCode(readResource(`slothvault://managed-file/${id}`, unsafeNamePath, fakeServiceOptions(unsafeName)), 'INVALID_RESOURCE_NAME', 4);
        assert.equal(fs.existsSync(unsafeNamePath), false);
    }

    const wrongMime = makeFakeClient({
        readResource: async request => ({contents: [{uri: request.uri, name: 'contract.txt', mimeType: 'text/plain', blob: 'YQ=='}]})
    });
    const wrongMimePath = path.join(outputDirectory, 'wrong-mime.bin');
    await assertRejectsCode(readResource('slothvault://contract-attachment/2', wrongMimePath, fakeServiceOptions(wrongMime)), 'INVALID_RESOURCE_MIME', 4);
    assert.equal(fs.existsSync(wrongMimePath), false);

    const tooLarge = makeFakeClient({
        readResource: async request => ({
            contents: [{
                uri: request.uri,
                name: 'large.bin',
                mimeType: 'application/octet-stream',
                blob: Buffer.alloc(MANAGED_FILE_MAX_BYTES + 3, 1).toString('base64')
            }]
        })
    });
    const tooLargePath = path.join(outputDirectory, 'too-large.bin');
    await assertRejectsCode(readResource('slothvault://managed-file/3', tooLargePath, fakeServiceOptions(tooLarge)), 'RESOURCE_TOO_LARGE', 4);
    assert.equal(fs.existsSync(tooLargePath), false);
    assert.equal(MANAGED_FILE_MAX_BYTES, 10 * 1024 * 1024);
    assert.equal(CONTRACT_ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024);
});

test('service classifies auth, availability, timeout, network, and protocol failures with stable exit codes', async () => {
    const cases = [
        [{status: 401, message: 'Unauthorized'}, 'MCP_AUTH_FAILED', 'auth', 3],
        [{status: null, code: 401, message: 'request rejected'}, 'MCP_AUTH_FAILED', 'auth', 3],
        [{statusCode: 503, message: 'Service unavailable'}, 'MCP_UNAVAILABLE', 'unavailable', 4],
        [{status: null, response: {status: 503}, message: 'request rejected'}, 'MCP_UNAVAILABLE', 'unavailable', 4],
        [{name: 'AbortError', message: 'aborted'}, 'MCP_TIMEOUT', 'timeout', 4],
        [new Error('fetch failed: ECONNREFUSED'), 'MCP_NETWORK_ERROR', 'network', 4],
        [new Error('invalid JSON-RPC response'), 'MCP_PROTOCOL_ERROR', 'protocol', 4]
    ];
    for (const [input, code, category, exitCode] of cases) {
        const error = classifyError(input);
        assert.equal(error.code, code);
        assert.equal(error.category, category);
        assert.equal(error.exitCode, exitCode);
    }

    const timeoutClient = makeFakeClient({connect: async () => await new Promise(() => {})});
    await assertRejectsCode(listTools(fakeServiceOptions(timeoutClient, {
        profile: makeProfile({timeoutMs: 15})
    })), 'MCP_TIMEOUT', 4);
    assert.equal(timeoutClient.state.closeCalls, 1);
});

test('connection failures close the client and remote operations are not automatically retried', async () => {
    const authClient = makeFakeClient({connect: async () => {
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }});
    await assertRejectsCode(listTools(fakeServiceOptions(authClient)), 'MCP_AUTH_FAILED', 3);
    assert.equal(authClient.state.connectCalls, 1);
    assert.equal(authClient.state.closeCalls, 1);

    let attempts = 0;
    const operationClient = makeFakeClient({
        tools: [{name: 'unstable.tool', annotations: {readOnlyHint: true}}],
        callTool: async () => {
            attempts += 1;
            throw new Error('socket reset');
        }
    });
    await assertRejectsCode(callTool('unstable.tool', {}, fakeServiceOptions(operationClient)), 'MCP_NETWORK_ERROR', 4);
    assert.equal(attempts, 1);
    assert.equal(operationClient.state.closeCalls, 1);
});

test('a timeout during delayed Tool discovery never permits the later Tool call', async () => {
    const client = makeFakeClient({
        listTools: async () => {
            await waitFor(80);
            return {tools: [{name: 'late.tool', annotations: {readOnlyHint: true}}]};
        }
    });
    await assertRejectsCode(callTool('late.tool', {}, fakeServiceOptions(client, {
        profile: makeProfile({timeoutMs: 20})
    })), 'MCP_TIMEOUT', 4);

    await waitFor(120);
    assert.equal(client.state.toolCallRequests.length, 0);
    assert.equal(client.state.closeCalls, 1);
});

test('a timeout during delayed Resource reading never publishes the later payload', async () => {
    const outputDirectory = makeTemporaryDirectory('resource-timeout');
    const outputPath = path.join(outputDirectory, 'late-resource.bin');
    const client = makeFakeClient({
        readResource: async request => {
            await waitFor(80);
            return {
                contents: [{
                    uri: request.uri,
                    name: 'late-resource.bin',
                    mimeType: 'application/octet-stream',
                    blob: Buffer.from('late payload').toString('base64')
                }]
            };
        }
    });
    await assertRejectsCode(readResource('slothvault://managed-file/99', outputPath, fakeServiceOptions(client, {
        profile: makeProfile({timeoutMs: 20})
    })), 'MCP_TIMEOUT', 4);

    await waitFor(120);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.readdirSync(outputDirectory).some(name => name.endsWith('.tmp')), false);
    assert.equal(client.state.readResourceCalls, 1);
    assert.equal(client.state.closeCalls, 1);
});

test('a client created after its timeout is eventually closed without connecting', async () => {
    const client = makeFakeClient();
    await assertRejectsCode(listTools(fakeServiceOptions(client, {
        profile: makeProfile({timeoutMs: 20}),
        clientFactory: async () => {
            await waitFor(80);
            return client;
        }
    })), 'MCP_TIMEOUT', 4);

    await waitFor(120);
    assert.equal(client.state.connectCalls, 0);
    assert.equal(client.state.closeCalls, 1);
});

test('CLI help, JSON errors, input-source exclusivity, key handling, and exit codes remain stable', context => {
    const help = runCli(['--help']);
    if (skipIfProcessCreationIsBlocked(context, help)) return;
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /profile add <name>/u);
    assert.match(help.stdout, /tools call <tool>/u);
    assert.match(help.stdout, /resources list \[--profile/u);
    assert.match(help.stdout, /resources read <uri> --output <path>/u);
    assert.match(help.stdout, /storage status/u);
    assert.doesNotMatch(help.stdout, /skill status\|install\|uninstall/u);
    assert.match(help.stdout, /--args-file <path>/u);

    const unknown = runCli(['unknown', '--json']);
    assert.equal(unknown.status, 2);
    const unknownJson = JSON.parse(unknown.stdout);
    assert.equal(unknownJson.ok, false);
    assert.equal(unknownJson.error.category, 'usage');

    const exclusive = runCli(['tools', 'call', 'demo', '--args', '{}', '--args-file', '-', '--json'], {input: '{}'});
    assert.equal(exclusive.status, 2);
    assert.equal(JSON.parse(exclusive.stdout).error.category, 'usage');
    assert.match(JSON.parse(exclusive.stdout).error.message, /only one|只能使用一个/iu);

    const invalidDirect = runCli(['tools', 'call', 'demo', '--args', '[]', '--json']);
    assert.equal(invalidDirect.status, 2);
    assert.match(JSON.parse(invalidDirect.stdout).error.message, /JSON object/iu);

    const root = makeTemporaryDirectory('cli-profile');
    const envName = 'SLOTHTOOL_TEST_SLOTHVAULT_KEY';
    const added = runCli([
        'profile', 'add', 'production', '--url', 'http://127.0.0.1:3000', '--key-env', envName, '--json'
    ], {homeDirectory: root, environment: {[envName]: VALID_KEY}});
    assert.equal(added.status, 0, added.stderr);
    assert.doesNotMatch(`${added.stdout}\n${added.stderr}`, new RegExp(VALID_KEY, 'u'));
    assert.equal(JSON.parse(added.stdout).apiKey, maskApiKey(VALID_KEY));
    assert.match(added.stderr, /warning/iu);

    const stdinRoot = makeTemporaryDirectory('cli-stdin-key');
    const stdinAdded = runCli([
        'profile', 'add', 'stdin-profile', '--url', 'https://vault.example/mcp', '--key-stdin', '--json'
    ], {homeDirectory: stdinRoot, input: `${VALID_KEY}\n`});
    assert.equal(stdinAdded.status, 0, stdinAdded.stderr);
    assert.doesNotMatch(`${stdinAdded.stdout}\n${stdinAdded.stderr}`, new RegExp(VALID_KEY, 'u'));

    const directKey = runCli(['profile', 'add', 'bad', '--url', 'https://vault.example/mcp', '--key', VALID_KEY, '--json']);
    assert.equal(directKey.status, 2);
    assert.match(JSON.parse(directKey.stdout).error.message, /--key option is not supported/u);

    const missingConfirmation = runCli(['history', 'clear', '--json']);
    assert.equal(missingConfirmation.status, 2);
    const cleared = runCli(['history', 'clear', '--yes', '--json']);
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.equal(JSON.parse(cleared.stdout).cleared, 0);
});

test('storage status reports path state without reading, migrating, or exposing local credentials', context => {
    const homeDirectory = makeTemporaryDirectory('storage-status-cli');
    const slothToolHome = path.join(homeDirectory, '.pipker', 'slothtool');
    const canonicalConfigPath = path.join(slothToolHome, 'plugin-configs', 'slothvault.json');
    const legacyConfigPath = path.join(slothToolHome, 'plugin-configs', 'slothvault-mcp.json');
    const canonicalHistoryPath = path.join(slothToolHome, 'data', 'slothvault', 'history.json');
    const legacyHistoryPath = path.join(slothToolHome, 'data', 'slothvault-mcp', 'history.json');

    const absent = runCli(['storage', 'status', '--json'], {homeDirectory});
    if (skipIfProcessCreationIsBlocked(context, absent)) return;
    assert.equal(absent.status, 0, absent.stderr);
    assert.equal(JSON.parse(absent.stdout).config.state, 'absent');
    assert.equal(JSON.parse(absent.stdout).history.state, 'absent');

    fs.mkdirSync(path.dirname(legacyConfigPath), {recursive: true});
    fs.mkdirSync(path.dirname(canonicalHistoryPath), {recursive: true});
    fs.mkdirSync(path.dirname(legacyHistoryPath), {recursive: true});
    fs.writeFileSync(legacyConfigPath, JSON.stringify({
        schemaVersion: 1,
        defaultProfile: 'legacy',
        profiles: {legacy: makeProfile({name: 'legacy'})}
    }), 'utf8');
    fs.writeFileSync(canonicalHistoryPath, JSON.stringify({schemaVersion: 1, entries: []}), 'utf8');
    fs.writeFileSync(legacyHistoryPath, JSON.stringify({schemaVersion: 1, entries: [{summary: VALID_KEY}]}), 'utf8');

    const mixed = runCli(['storage', 'status', '--json'], {homeDirectory});
    assert.equal(mixed.status, 0, mixed.stderr);
    const result = JSON.parse(mixed.stdout);
    assert.equal(result.config.state, 'legacy-only');
    assert.equal(result.history.state, 'conflict');
    assert.equal(fs.existsSync(canonicalConfigPath), false);
    assert.doesNotMatch(`${mixed.stdout}\n${mixed.stderr}`, new RegExp(VALID_KEY, 'u'));
});


test('multifunction CLI exposes stable Skill status, install, conflict replacement, and uninstall contracts', context => {
    const homeDirectory = makeTemporaryDirectory('skill-cli');
    fs.mkdirSync(path.join(homeDirectory, '.codex'), {recursive: true});
    fs.mkdirSync(path.join(homeDirectory, '.claude'), {recursive: true});
    const status = runManager(['skill', 'status', '--json'], {homeDirectory});
    if (skipIfProcessCreationIsBlocked(context, status)) return;
    assert.equal(status.status, 0, status.stderr);
    const statusResult = JSON.parse(status.stdout);
    assert.equal(statusResult.state, 'not-installed');
    assert.deepEqual(statusResult.agents.filter(agent => agent.detected).map(agent => agent.id), ['codex', 'claude-code']);

    const installed = runManager(['skill', 'install', '--json'], {homeDirectory});
    assert.equal(installed.status, 0, installed.stderr);
    const installedResult = JSON.parse(installed.stdout);
    assert.equal(installedResult.state, 'installed');
    assert.equal(installedResult.action, 'installed');

    const repeated = runManager(['skill', 'install', '--json'], {homeDirectory});
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).action, 'already-installed');

    const uninstalled = runManager(['skill', 'uninstall', '--json'], {homeDirectory});
    assert.equal(uninstalled.status, 0, uninstalled.stderr);
    assert.equal(JSON.parse(uninstalled.stdout).action, 'uninstalled');

    const conflictHome = makeTemporaryDirectory('skill-cli-conflict');
    fs.mkdirSync(path.join(conflictHome, '.codex'), {recursive: true});
    const conflictTarget = getSkillPaths({homeDir: conflictHome, env: {PATH: ''}}).agents[0].targetPath;
    fs.mkdirSync(conflictTarget, {recursive: true});
    const markerPath = path.join(conflictTarget, 'keep.txt');
    fs.writeFileSync(markerPath, 'keep', 'utf8');

    const denied = runManager(['skill', 'install', '--json'], {homeDirectory: conflictHome});
    assert.equal(denied.status, 0);
    const deniedResult = JSON.parse(denied.stdout);
    assert.equal(deniedResult.state, 'conflict');
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');

    const replaced = runManager(['skill', 'install', '--replace', '--json'], {homeDirectory: conflictHome});
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(JSON.parse(replaced.stdout).action, 'replaced');
    assert.equal(fs.existsSync(markerPath), false);
});

test('CLI validates inline, file, and stdin JSON object sources before any network operation', context => {
    const root = makeTemporaryDirectory('cli-args');
    const invalidJsonPath = path.join(root, 'invalid.json');
    const arrayJsonPath = path.join(root, 'array.json');
    fs.writeFileSync(invalidJsonPath, '{broken', 'utf8');
    fs.writeFileSync(arrayJsonPath, '[]', 'utf8');

    const inline = runCli(['prompts', 'get', 'demo', '--args', '{broken', '--json']);
    if (skipIfProcessCreationIsBlocked(context, inline)) return;
    assert.equal(inline.status, 2);
    assert.match(JSON.parse(inline.stdout).error.message, /valid JSON|合法的 JSON/iu);

    const file = runCli(['prompts', 'get', 'demo', '--args-file', invalidJsonPath, '--json']);
    assert.equal(file.status, 2);
    assert.match(JSON.parse(file.stdout).error.message, /valid JSON|合法的 JSON/iu);

    const stdin = runCli(['prompts', 'get', 'demo', '--args-file', '-', '--json'], {input: '[]'});
    assert.equal(stdin.status, 2);
    assert.match(JSON.parse(stdin.stdout).error.message, /JSON object/iu);

    const fileObject = runCli(['prompts', 'get', 'demo', '--args-file', arrayJsonPath, '--json']);
    assert.equal(fileObject.status, 2);
    assert.match(JSON.parse(fileObject.stdout).error.message, /JSON object/iu);
});
