/**
 * @file SlothVaultDeployRunner
 * @project SlothVault
 * @module External toolkit / Deployment runner
 * @description Starts the bundled standard-library SlothVault deployment program from the Node plugin without shell interpolation.
 * @logic 1. Resolve the packaged Python entrypoint; 2. launch python3 with inherited terminal streams and a plugin-version marker; 3. preserve the deployment process exit status and surface missing-runtime errors clearly.
 * @dependencies Node: child_process/fs/path/url, Plugin: package.json and deploy/install.py
 * @index_tags slothvault,deploy,python,docker,runner,security
 * @author holic512
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(moduleDirectory, '..');

export class SlothVaultDeployError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'SlothVaultDeployError';
        this.code = options.code || 'DEPLOY_ERROR';
        this.exitCode = options.exitCode || 1;
    }
}

export function getDeploymentPaths(options = {}) {
    const root = path.resolve(options.pluginRoot || pluginRoot);
    return {
        pluginRoot: root,
        entryPath: path.resolve(options.entryPath || path.join(root, 'deploy', 'install.py')),
        packagePath: path.resolve(options.packagePath || path.join(root, 'package.json'))
    };
}

function readPluginVersion(paths) {
    try {
        return String(JSON.parse(fs.readFileSync(paths.packagePath, 'utf8')).version || 'source');
    } catch {
        return 'source';
    }
}

/** Run the bundled deployment program without changing its argument or terminal contract. */
export function runDeployment(deploymentArguments = [], options = {}) {
    const paths = getDeploymentPaths(options);
    const python = options.pythonCommand || process.env.SLOTHTOOL_SLOTHVAULT_PYTHON || 'python3';
    if (!fs.existsSync(paths.entryPath)) {
        return Promise.reject(new SlothVaultDeployError(`Bundled SlothVault deployment entrypoint is missing: ${paths.entryPath}`, {
            code: 'DEPLOY_ENTRY_MISSING'
        }));
    }

    return new Promise((resolve, reject) => {
        const child = spawn(python, [paths.entryPath, ...deploymentArguments], {
            cwd: options.cwd || process.cwd(),
            stdio: options.stdio || 'inherit',
            env: {
                ...process.env,
                ...(options.env || {}),
                SLOTHTOOL_SLOTHVAULT_PLUGIN_VERSION: readPluginVersion(paths)
            }
        });
        child.on('error', error => {
            if (error?.code === 'ENOENT') {
                reject(new SlothVaultDeployError('python3 is required for SlothVault deployment. Install Python 3.8 or newer and retry.', {
                    code: 'DEPLOY_PYTHON_UNAVAILABLE',
                    cause: error
                }));
                return;
            }
            reject(new SlothVaultDeployError(`Unable to start SlothVault deployment: ${error.message}`, {
                code: 'DEPLOY_START_FAILED',
                cause: error
            }));
        });
        child.on('exit', (code, signal) => resolve({code: code ?? 1, signal: signal || null}));
    });
}

/** Open the private JSON-line channel used by the TUI; CLI stdio remains unchanged. */
export function createDeploymentSession(deploymentArguments = [], options = {}) {
    const paths = getDeploymentPaths(options);
    if (!fs.existsSync(paths.entryPath)) throw new SlothVaultDeployError(`Bundled SlothVault deployment entrypoint is missing: ${paths.entryPath}`, {code: 'DEPLOY_ENTRY_MISSING'});
    const python = options.pythonCommand || process.env.SLOTHTOOL_SLOTHVAULT_PYTHON || 'python3';
    const child = spawn(python, [paths.entryPath, '--bridge', ...deploymentArguments], {
        cwd: options.cwd || process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
        env: {...process.env, ...(options.env || {}), SLOTHTOOL_SLOTHVAULT_PLUGIN_VERSION: readPluginVersion(paths)}
    });
    let settled = false;
    let protocolError = null;
    const result = new Promise((resolve, reject) => {
        child.on('error', error => {
            if (settled) return;
            settled = true;
            reject(new SlothVaultDeployError(error.code === 'ENOENT'
                ? 'python3 is required for SlothVault deployment. Install Python 3.8 or newer and retry.'
                : `Unable to start SlothVault deployment: ${error.message}`,
            {code: error.code === 'ENOENT' ? 'DEPLOY_PYTHON_UNAVAILABLE' : 'DEPLOY_START_FAILED', cause: error}));
        });
        child.on('close', (code, signal) => {
            if (settled) return;
            settled = true;
            if (protocolError) reject(protocolError);
            else resolve({code: code ?? 1, signal: signal || null});
        });
    });
    const lines = readline.createInterface({input: child.stdout});
    lines.on('line', line => {
        if (line.length > 1_000_000) {
            protocolError = new SlothVaultDeployError('Deployment response exceeded the supported size.', {code: 'DEPLOY_PROTOCOL_ERROR'});
            child.kill();
            return;
        }
        try {
            const event = JSON.parse(line);
            if (event && typeof event.type === 'string') options.onEvent?.(event);
            else throw new Error('Missing event type');
        } catch {
            protocolError = new SlothVaultDeployError('Invalid deployment response from Python.', {code: 'DEPLOY_PROTOCOL_ERROR'});
            child.kill();
        }
    });
    // Python reports safe errors on the JSON channel. Its raw stderr is never rendered.
    child.stderr.resume();
    return {
        result,
        respond(value) {if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({type: 'answer', value: String(value)})}\n`);},
        cancel() {if (!child.stdin.destroyed) child.stdin.write('{"type":"cancel"}\n');},
        stop() {child.kill();}
    };
}

export async function inspectDeployment(root = '/data/slothvault', options = {}) {
    let snapshot = null;
    const session = createDeploymentSession(['--action', 'status', '--root', root], {
        ...options, onEvent(event) {if (event.type === 'snapshot') snapshot = event.data; options.onEvent?.(event);}
    });
    const outcome = await session.result;
    if (outcome.code !== 0 || !snapshot) throw new SlothVaultDeployError('Unable to inspect the selected deployment.', {code: 'DEPLOY_INSPECT_FAILED'});
    return snapshot;
}

export default {getDeploymentPaths, runDeployment, createDeploymentSession, inspectDeployment, SlothVaultDeployError};
