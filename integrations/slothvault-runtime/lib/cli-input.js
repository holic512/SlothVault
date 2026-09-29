/**
 * @file cli-input.js
 * @project SlothVault
 * @module SlothVault CLI Input
 * @description Shares hidden, stdin and environment key input between connection entry points.
 * @logic Validate one key source, read without echo, and restore terminal state on completion.
 * @dependencies node:process, i18n
 * @index_tags setup,credentials,cli
 * @author holic512
 */
import process from 'node:process';
import {t} from './i18n.js';
const hasFlag = (args, flag) => args.includes(flag);
function usageError(message) { return Object.assign(new Error(message), {code: 'USAGE_ERROR', category: 'usage', exitCode: 2}); }
function readOption(args, option) {
    const index = args.indexOf(option);
    if (index < 0) return '';
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw usageError(t('optionValueRequired', {option}));
    return value;
}

/** Read a hidden line from an interactive terminal without echoing the MCP key. */
async function readHiddenLine(prompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw usageError(t('keyStdinEmpty'));
    }
    process.stdout.write(prompt);
    const wasRaw = Boolean(process.stdin.isRaw);
    let value = '';
    let onData;
    try {
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        return await new Promise((resolve, reject) => {
            onData = chunk => {
                for (const character of String(chunk)) {
                    if (character === '\u0003') {
                        reject(usageError(t('cancelled')));
                        return;
                    }
                    if (character === '\r' || character === '\n') {
                        process.stdout.write('\n');
                        resolve(value.trim());
                        return;
                    }
                    if (character === '\u007f' || character === '\b') {
                        value = value.slice(0, -1);
                    } else {
                        value += character;
                    }
                }
            };
            process.stdin.on('data', onData);
        });
    } finally {
        if (onData) {
            process.stdin.off('data', onData);
        }
        process.stdin.setRawMode?.(wasRaw);
        process.stdin.pause();
    }
}

/** Read all stdin text for key or JSON argument sources. */
export async function readStdinText() {
    let value = '';
    for await (const chunk of process.stdin) {
        value += String(chunk);
    }
    return value.trim();
}

/** Resolve a profile key from hidden input, stdin, or a named environment variable. */
export async function resolveApiKey(args) {
    const stdin = hasFlag(args, '--key-stdin');
    const envName = readOption(args, '--key-env');
    if (stdin && envName) {
        throw usageError(t('keySourceExclusive'));
    }
    if (stdin) {
        const value = await readStdinText();
        if (!value) {
            throw usageError(t('keyStdinEmpty'));
        }
        return value;
    }
    if (envName) {
        const value = process.env[envName]?.trim();
        if (!value) {
            throw usageError(t('keyEnvEmpty', {name: envName}));
        }
        return value;
    }
    return await readHiddenLine(t('keyPrompt'));
}
