#!/usr/bin/env node

/**
 * @file slothvault-runtime.js
 * @project SlothVault
 * @module External runtime adapter protocol
 * @description Provides the stable local JSON and deployment bridge consumed by SlothTool.
 * @logic Dispatch local status, setup, Skill, command registration, discovery, and deployment requests without exposing stored credentials.
 * @dependencies MCP client services, Skill manager, deployment Python package
 * @index_tags integration,adapter,cli,skill,deploy
 * @author holic512
 */
import process from 'node:process';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pkg from '../package.json' with {type: 'json'};
import contract from '../runtime-contract.json' with {type: 'json'};
import {getConfigSummary} from '../lib/config.js';
import {inspectServer} from '../lib/service.js';
import {getSkillStatus, installSkill, uninstallSkill} from '../lib/skill-manager.js';
import {getMcpCommandStatus, registerMcpCommand, unregisterMcpCommand} from '../lib/mcp-command-manager.js';
import {runSetupCli} from '../lib/setup-cli.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function help() {
    process.stdout.write('slothvault-runtime status|config|discovery|setup|skill|mcp|deploy [options]\n');
}

async function deploy(args) {
    const python = process.env.SLOTHTOOL_SLOTHVAULT_PYTHON || 'python3';
    const entry = path.join(root, 'deploy', 'install.py');
    const child = spawn(python, [entry, ...args], {
        stdio: 'inherit',
        env: {...process.env, SLOTHTOOL_SLOTHVAULT_PLUGIN_VERSION: pkg.version}
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', code => {process.exitCode = code ?? 1; resolve();});
    });
}

async function main(args) {
    if (!args.length || args.includes('--help')) return help();
    if (args.includes('--version')) return output({schema: contract.schema, adapterApiMajor: contract.adapterApiMajor, version: pkg.version});
    const [command, action = 'status', ...rest] = args;
    if (command === 'status') return output({schema: contract.schema, adapterApiMajor: contract.adapterApiMajor,
        version: pkg.version, skill: getSkillStatus(), mcp: getMcpCommandStatus(), config: getConfigSummary()});
    if (command === 'config') return output(getConfigSummary());
    if (command === 'discovery') return output(await inspectServer());
    if (command === 'setup') return runSetupCli(args.slice(1), {managed: true});
    if (command === 'skill') {
        if (action === 'status') return output(getSkillStatus());
        if (action === 'install' || action === 'update') return output(installSkill({skipConflicts: !args.includes('--replace'), replace: args.includes('--replace')}));
        if (action === 'uninstall') return output(uninstallSkill({skipConflicts: args.includes('--skip-conflicts')}));
    }
    if (command === 'mcp') {
        if (action === 'status') return output(getMcpCommandStatus());
        if (action === 'register') return output(registerMcpCommand({replace: args.includes('--replace')}));
        if (action === 'unregister') return output(unregisterMcpCommand());
    }
    if (command === 'deploy') return deploy(args.slice(1));
    throw Object.assign(new Error(`Unknown runtime command: ${args.join(' ')}`), {code: 'USAGE_ERROR'});
}

main(process.argv.slice(2)).catch(error => {
    output({ok: false, error: {code: error.code || 'RUNTIME_ERROR', category: error.category || 'internal', message: error.message}});
    process.exitCode = error.exitCode || 1;
});
