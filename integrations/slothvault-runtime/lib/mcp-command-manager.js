/**
 * @file SlothVaultMcpCommandManager
 * @project SlothVault
 * @module External toolkit / MCP Command Registration
 * @description Safely registers the bundled slothvault-mcp executable beside the active SlothTool command.
 * @logic 1. Resolve the immutable plugin MCP entry and caller-provided SlothTool bin directory; 2. classify absent, managed and conflicting targets without following unsafe links; 3. create or remove only verifiable managed launchers after explicit authorization.
 * @dependencies Node: fs/path/process/url, Plugin: bin/slothvault-mcp.js
 * @index_tags slothvault,mcp,command,register,symlink,windows,security
 * @author holic512
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {getSlothToolHome} from './config.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(moduleDirectory, '..');
const WINDOWS_MARKER = ':: Managed by SlothVault MCP command registration';

export class SlothVaultMcpCommandError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'SlothVaultMcpCommandError';
        this.code = options.code || 'MCP_COMMAND_ERROR';
        this.exitCode = options.exitCode || 2;
    }
}

function pathsEqual(left, right, platform = process.platform) {
    const normalize = value => {
        const resolved = path.normalize(path.resolve(value));
        return platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
}

export function getMcpCommandPaths(options = {}) {
    const root = path.resolve(options.pluginRoot || pluginRoot);
    const suppliedExecutable = String(options.slothtoolExecutable || '').trim();
    const slothtoolPath = suppliedExecutable || String(process.env.SLOTHTOOL_COMMAND_PATH || '').trim();
    if (!slothtoolPath) {
        throw new SlothVaultMcpCommandError('The SlothTool command path is unavailable. Run this through slothtool instead of directly from the plugin source.', {
            code: 'MCP_COMMAND_SLOTHTOOL_PATH_UNAVAILABLE'
        });
    }
    if (!suppliedExecutable && process.env.SLOTHTOOL_COMMAND_PATH_VERIFIED !== '1') {
        throw new SlothVaultMcpCommandError('The SlothTool command path could not be verified. Run an installed slothtool command whose bin directory is on PATH.', {
            code: 'MCP_COMMAND_SLOTHTOOL_PATH_UNAVAILABLE'
        });
    }
    const binDirectory = path.dirname(path.resolve(slothtoolPath));
    const stableEntryPath = path.join(getSlothToolHome(options), 'runtimes', 'slothvault', 'current', 'bin', 'slothvault-mcp.js');
    const mcpEntryPath = fileSystemExists(stableEntryPath) ? stableEntryPath : path.join(root, 'bin', 'slothvault-mcp.js');
    const platform = options.platform || process.platform;
    const targetPath = path.join(binDirectory, platform === 'win32' ? 'slothvault-mcp.cmd' : 'slothvault-mcp');
    return {pluginRoot: root, slothtoolPath: path.resolve(slothtoolPath), binDirectory, mcpEntryPath, targetPath};
}

function fileSystemExists(value) {
    try { return fs.statSync(value).isFile(); } catch { return false; }
}

function windowsShimSource(paths, nodeExecutable = process.execPath) {
    return `${WINDOWS_MARKER}\r\n@"${nodeExecutable.replaceAll('"', '""')}" "${paths.mcpEntryPath.replaceAll('"', '""')}" %*\r\n`;
}

function inspectTarget(paths, options = {}) {
    const fileSystem = options.fileSystem || fs;
    const platform = options.platform || process.platform;
    const legacyEntryPath = path.join(getSlothToolHome(options), 'plugins', 'slothvault', 'bin', 'slothvault-mcp.js');
    try {
        const stats = fileSystem.lstatSync(paths.targetPath);
        if (platform === 'win32') {
            if (!stats.isFile()) return 'conflict';
            const content = fileSystem.readFileSync(paths.targetPath, 'utf8');
            if (content === windowsShimSource(paths, options.nodeExecutable || process.execPath)) return 'registered';
            return content === windowsShimSource({...paths, mcpEntryPath: legacyEntryPath}, options.nodeExecutable || process.execPath) ? 'outdated' : 'conflict';
        }
        if (!stats.isSymbolicLink()) return 'conflict';
        const linkValue = fileSystem.readlinkSync(paths.targetPath);
        const resolved = path.resolve(path.dirname(paths.targetPath), linkValue);
        if (pathsEqual(resolved, paths.mcpEntryPath, platform)) return 'registered';
        return pathsEqual(resolved, legacyEntryPath, platform) ? 'outdated' : 'conflict';
    } catch (error) {
        if (error?.code === 'ENOENT') return 'not-registered';
        throw error;
    }
}

function commandState(paths, state, extra = {}) {
    return {
        ...paths,
        state,
        registered: state === 'registered',
        managed: state === 'registered',
        ...extra
    };
}

export function getMcpCommandStatus(options = {}) {
    try {
        const paths = getMcpCommandPaths(options);
        const fileSystem = options.fileSystem || fs;
        if (!fileSystem.existsSync(paths.mcpEntryPath)) {
            return commandState(paths, 'unavailable', {reason: 'MCP entrypoint is missing'});
        }
        return commandState(paths, inspectTarget(paths, options));
    } catch (error) {
        if (error instanceof SlothVaultMcpCommandError) {
            return {state: 'unavailable', registered: false, managed: false, reason: error.message};
        }
        throw error;
    }
}

export function registerMcpCommand(options = {}) {
    const paths = getMcpCommandPaths(options);
    const fileSystem = options.fileSystem || fs;
    const platform = options.platform || process.platform;
    if (!fileSystem.existsSync(paths.mcpEntryPath)) {
        throw new SlothVaultMcpCommandError(`Bundled MCP executable is missing: ${paths.mcpEntryPath}`, {code: 'MCP_COMMAND_ENTRY_MISSING'});
    }
    try {
        fileSystem.accessSync(paths.binDirectory, fs.constants.W_OK);
    } catch (error) {
        throw new SlothVaultMcpCommandError(`The SlothTool command directory is not writable: ${paths.binDirectory}`, {
            code: 'MCP_COMMAND_BIN_NOT_WRITABLE',
            cause: error
        });
    }
    const state = inspectTarget(paths, options);
    if (state === 'registered') return commandState(paths, state, {action: 'already-registered'});
    if (state === 'conflict' && !options.replace) {
        throw new SlothVaultMcpCommandError(`A non-managed slothvault-mcp command already exists: ${paths.targetPath}`, {
            code: 'MCP_COMMAND_REPLACE_REQUIRED'
        });
    }
    try {
        if (state === 'conflict' || state === 'outdated') fileSystem.unlinkSync(paths.targetPath);
        if (platform === 'win32') {
            const temporaryPath = `${paths.targetPath}.${process.pid}.tmp`;
            fileSystem.writeFileSync(temporaryPath, windowsShimSource(paths, options.nodeExecutable || process.execPath), {encoding: 'utf8', flag: 'wx'});
            fileSystem.renameSync(temporaryPath, paths.targetPath);
        } else {
            fileSystem.symlinkSync(paths.mcpEntryPath, paths.targetPath);
        }
    } catch (error) {
        throw new SlothVaultMcpCommandError(`Unable to register slothvault-mcp at ${paths.targetPath}: ${error.message}`, {
            code: 'MCP_COMMAND_REGISTER_FAILED', cause: error
        });
    }
    return commandState(paths, 'registered', {action: state === 'conflict' ? 'replaced' : state === 'outdated' ? 'migrated' : 'registered'});
}

export function unregisterMcpCommand(options = {}) {
    const paths = getMcpCommandPaths(options);
    const fileSystem = options.fileSystem || fs;
    const state = inspectTarget(paths, options);
    if (state === 'not-registered') return commandState(paths, state, {action: 'already-absent'});
    if (state !== 'registered' && state !== 'outdated') {
        throw new SlothVaultMcpCommandError(`Refusing to remove a non-managed slothvault-mcp command: ${paths.targetPath}`, {
            code: 'MCP_COMMAND_UNMANAGED_TARGET'
        });
    }
    fileSystem.unlinkSync(paths.targetPath);
    return commandState(paths, 'not-registered', {action: 'unregistered'});
}

export default {getMcpCommandPaths, getMcpCommandStatus, registerMcpCommand, unregisterMcpCommand, SlothVaultMcpCommandError};
