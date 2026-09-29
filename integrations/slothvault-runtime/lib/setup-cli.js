/**
 * @file setup-cli.js
 * @project SlothVault
 * @module SlothVault Setup CLI
 * @description Presents the two-field connection flow and a concise, secret-free result.
 * @logic Read URL and hidden key, invoke the shared setup service, then distinguish saved from connected.
 * @dependencies cli-input, setup, i18n, node:readline/promises
 * @index_tags setup,cli,url,key
 * @author holic512
 */
import {createInterface} from 'node:readline/promises';
import {resolveApiKey} from './cli-input.js';
import {setupConnection} from './setup.js';
import {maskApiKey} from './config.js';
import {t, formatSlothVaultError} from './i18n.js';

export function setupResultText(result) {
    const lines = [result.connected ? t('setup.connected', {url: result.profile.endpoint})
        : t('setup.savedOffline', {message: formatSlothVaultError(result.error)})];
    if (result.managed?.command?.state !== undefined && result.managed.command.state !== 'registered') lines.push(t('setup.commandPending', {state: result.managed.command.state}));
    const conflicts = result.managed?.skill?.agents?.filter(agent => agent.detected && agent.state === 'conflict') || [];
    if (conflicts.length) lines.push(t('setup.skillConflict', {targets: conflicts.map(agent => agent.name).join(', ')}));
    if (result.managed?.skill?.state === 'error') lines.push(t('setup.skillPending'));
    return lines.join('\n');
}
export async function runSetupCli(args, options = {}) {
    if (args.some(arg => arg === '--key' || arg.startsWith('--key='))) throw Object.assign(new Error(t('directKeyUnsupported')), {code: 'USAGE_ERROR', exitCode: 2});
    const index = args.indexOf('--url');
    let endpoint = index >= 0 ? args[index + 1] : '';
    if (index >= 0 && (!endpoint || endpoint.startsWith('--'))) throw Object.assign(new Error(t('optionValueRequired', {option: '--url'})), {code: 'USAGE_ERROR', exitCode: 2});
    if (!endpoint) {
        if (!process.stdin.isTTY || !process.stdout.isTTY || args.includes('--json')) throw Object.assign(new Error(t('optionRequired', {option: '--url'})), {code: 'USAGE_ERROR', exitCode: 2});
        const reader = createInterface({input: process.stdin, output: process.stdout});
        try { endpoint = await reader.question(t('setup.urlPrompt')); } finally { reader.close(); }
    }
    const apiKey = await resolveApiKey(args);
    const result = await setupConnection({endpoint, apiKey}, options);
    const safeResult = {...result, profile: result.profile ? {...result.profile, apiKey: maskApiKey(result.profile.apiKey)} : result.profile};
    console.log(args.includes('--json') ? JSON.stringify(safeResult, null, 2) : setupResultText(safeResult));
    if (!result.connected) process.exitCode = 4;
    return result;
}
