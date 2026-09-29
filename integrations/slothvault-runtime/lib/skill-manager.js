/**
 * @file SlothVaultSkillManager
 * @project SlothVault
 * @module External toolkit / Skill Management
 * @description 检测本机 Codex 与 Claude Code，并将插件内置 SlothVault Skill 安装到各智能体的用户级 Skill 目录。
 * @logic 1. 通过配置目录或 PATH 检测受支持智能体；2. 为每个已检测智能体解析固定目标并识别受管链接、未安装和冲突状态；3. 预创建全部链接后按显式授权替换冲突；4. 卸载时只删除准确指向当前来源的受管链接。
 * @dependencies Node: fs/os/path/crypto/url
 * @index_tags slothvault,mcp,codex,claude-code,skill,installer,symlink
 * @author holic512
 */

import fs from 'node:fs';
import pluginPackage from '../package.json' with {type: 'json'};
import {readSkillVersion, verifySkillMetadata} from './skill-metadata.js';
import {getSlothToolHome} from './config.js';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const SKILL_NAME = 'slothvault-mcp';

export const SKILL_AGENTS = Object.freeze([
    Object.freeze({
        id: 'codex',
        name: 'Codex',
        command: 'codex',
        configEnvironment: 'CODEX_HOME',
        defaultConfigDirectory: '.codex'
    }),
    Object.freeze({
        id: 'claude-code',
        name: 'Claude Code',
        command: 'claude',
        configEnvironment: 'CLAUDE_CONFIG_DIR',
        defaultConfigDirectory: '.claude'
    })
]);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const bundledSkillPath = path.resolve(moduleDirectory, '..', 'skills', SKILL_NAME);

export class SlothVaultSkillError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'SlothVaultSkillError';
        this.code = options.code || 'SKILL_ERROR';
        this.category = options.category || 'internal';
        this.exitCode = options.exitCode ?? (this.category === 'confirmation' || this.category === 'config' ? 2 : 1);
        if (Array.isArray(options.targetPaths)) {
            this.targetPaths = options.targetPaths;
        }
    }
}

/** Compare resolved paths while respecting Windows case-insensitive path semantics. */
function pathsEqual(left, right, platform = process.platform) {
    const normalizeComparable = value => {
        const normalized = path.normalize(path.resolve(value));
        if (platform !== 'win32') {
            return normalized;
        }
        return normalized
            .replace(/^\\\\\?\\UNC\\/iu, '\\\\')
            .replace(/^\\\\\?\\/u, '')
            .toLowerCase();
    };
    return normalizeComparable(left) === normalizeComparable(right);
}

/** Return whether a directory exists without treating a missing path as an error. */
function directoryExists(directory, fileSystem = fs) {
    try {
        return fileSystem.statSync(directory).isDirectory();
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/** Detect an executable from PATH without spawning the third-party agent. */
function commandExists(command, options = {}) {
    if (options.commandExists) {
        return Boolean(options.commandExists(command));
    }
    const fileSystem = options.fileSystem || fs;
    const environment = options.env || process.env;
    const platform = options.platform || process.platform;
    const pathValue = environment.PATH || environment.Path || environment.path || '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const extensions = platform === 'win32'
        ? (environment.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
        : [''];

    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
        for (const extension of extensions) {
            const candidate = path.join(directory, platform === 'win32' ? `${command}${extension}` : command);
            try {
                fileSystem.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                return true;
            } catch {
                // Continue searching the remaining PATH entries.
            }
        }
    }
    return false;
}

/** Resolve an agent-specific configuration directory, honoring its official override. */
function resolveAgentConfigDirectory(agent, homeDirectory, environment) {
    const configured = String(environment[agent.configEnvironment] || '').trim();
    return configured ? path.resolve(configured) : path.join(homeDirectory, agent.defaultConfigDirectory);
}

/** Detect supported agents and resolve their immutable Skill installation slots. */
export function detectSkillAgents(options = {}) {
    const fileSystem = options.fileSystem || fs;
    const environment = options.env || process.env;
    const homeDirectory = path.resolve(options.homeDir || os.homedir());
    const forcedAgents = Array.isArray(options.detectedAgents) ? new Set(options.detectedAgents) : null;

    return SKILL_AGENTS.map(agent => {
        const configDirectory = resolveAgentConfigDirectory(agent, homeDirectory, environment);
        const skillsDirectory = path.join(configDirectory, 'skills');
        const detection = [];
        if (forcedAgents) {
            if (forcedAgents.has(agent.id)) {
                detection.push('explicit');
            }
        } else {
            if (directoryExists(configDirectory, fileSystem)) {
                detection.push('config-directory');
            }
            if (commandExists(agent.command, options)) {
                detection.push('command');
            }
        }
        return {
            id: agent.id,
            name: agent.name,
            command: agent.command,
            detected: detection.length > 0,
            detection,
            configDirectory,
            skillsDirectory,
            targetPath: path.join(skillsDirectory, SKILL_NAME)
        };
    });
}

/** Resolve the immutable bundled source and every supported agent target. */
export function getSkillPaths(options = {}) {
    const homeDirectory = path.resolve(options.homeDir || os.homedir());
    const activeSkillPath = path.join(getSlothToolHome({...options, homeDir: homeDirectory}), 'runtimes', 'slothvault', 'current', 'skills', SKILL_NAME);
    return {
        homeDirectory,
        sourcePath: path.resolve(options.sourcePath || (fs.existsSync(activeSkillPath) ? activeSkillPath : bundledSkillPath)),
        agents: detectSkillAgents({...options, homeDir: homeDirectory}),
        legacyTargetPath: path.join(homeDirectory, '.agents', 'skills', SKILL_NAME)
    };
}

/** Ensure the package contains a usable Skill before any user path can change. */
function assertSkillSource(sourcePath, fileSystem = fs) {
    let sourceStats;
    let manifestStats;
    try {
        sourceStats = fileSystem.statSync(sourcePath);
        manifestStats = fileSystem.statSync(path.join(sourcePath, 'SKILL.md'));
    } catch (error) {
        throw new SlothVaultSkillError(`Bundled SlothVault Skill is unavailable: ${sourcePath}`, {
            code: 'SKILL_SOURCE_INVALID',
            cause: error
        });
    }
    if (!sourceStats.isDirectory() || !manifestStats.isFile()) {
        throw new SlothVaultSkillError(`Bundled SlothVault Skill is invalid: ${sourcePath}`, {
            code: 'SKILL_SOURCE_INVALID'
        });
    }
}

/** Reject attempts to mutate anything outside an agent's configured Skill slot. */
function assertFixedTarget(target, paths, options = {}) {
    const agent = SKILL_AGENTS.find(candidate => candidate.id === target.id);
    if (!agent) {
        throw new SlothVaultSkillError(`Unsupported Skill agent: ${target.id}`, {
            code: 'SKILL_TARGET_INVALID',
            category: 'config'
        });
    }
    const environment = options.env || process.env;
    const expectedConfig = resolveAgentConfigDirectory(agent, paths.homeDirectory, environment);
    const expected = path.join(expectedConfig, 'skills', SKILL_NAME);
    if (!pathsEqual(target.targetPath, expected, options.platform)) {
        throw new SlothVaultSkillError(`Invalid SlothVault Skill target: ${target.targetPath}`, {
            code: 'SKILL_TARGET_INVALID',
            category: 'config'
        });
    }
}

/** Inspect a target without following its final link, including dangling links. */
function inspectTarget(targetPath, sourcePath, options = {}) {
    const fileSystem = options.fileSystem || fs;
    let stats;
    try {
        stats = fileSystem.lstatSync(targetPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return 'not-installed';
        }
        throw error;
    }

    if (!stats.isSymbolicLink()) {
        return 'conflict';
    }

    let linkValue;
    try {
        linkValue = fileSystem.readlinkSync(targetPath);
    } catch {
        return 'conflict';
    }
    const resolvedLink = path.resolve(path.dirname(targetPath), linkValue);
    if (pathsEqual(resolvedLink, sourcePath, options.platform)) return 'installed';
    const home = path.resolve(options.homeDir || os.homedir());
    const managedRoots = ['slothvault', 'slothvault-mcp'].map(alias => path.join(home, '.pipker', 'slothtool', 'plugins', alias, 'skills', SKILL_NAME));
    return managedRoots.some(root => pathsEqual(root, resolvedLink, options.platform)) ? 'outdated' : 'conflict';
}

/** Convert unexpected filesystem failures into the plugin's stable local error contract. */
function wrapSkillError(error, operation) {
    if (error instanceof SlothVaultSkillError) {
        return error;
    }
    return new SlothVaultSkillError(`${operation}: ${error?.message || String(error)}`, {
        code: 'SKILL_FILESYSTEM_ERROR',
        cause: error
    });
}

/** Aggregate detected-agent states without hiding each target's detailed state. */
function aggregateState(agents) {
    const detected = agents.filter(agent => agent.detected);
    if (detected.some(agent => agent.state === 'conflict')) {
        return 'conflict';
    }
    if (detected.length > 0 && detected.every(agent => agent.state === 'installed')) {
        return 'installed';
    }
    return 'not-installed';
}

/** Return installation status for Codex and Claude Code plus the former shared target. */
export function getSkillStatus(options = {}) {
    try {
        const paths = getSkillPaths(options);
        const fileSystem = options.fileSystem || fs;
        assertSkillSource(paths.sourcePath, fileSystem);
        const metadataPath = path.resolve(moduleDirectory, '..', 'skill-release.json');
        if (!options.sourcePath) verifySkillMetadata(paths.sourcePath, JSON.parse(fileSystem.readFileSync(metadataPath, 'utf8')), pluginPackage.version, fileSystem);
        const version = readSkillVersion(paths.sourcePath, fileSystem);
        const agents = paths.agents.map(agent => {
            assertFixedTarget(agent, paths, options);
            return {
                id: agent.id,
                name: agent.name,
                detected: agent.detected,
                detection: agent.detection,
                state: inspectTarget(agent.targetPath, paths.sourcePath, options),
                targetPath: agent.targetPath,
                version: (() => { try { return readSkillVersion(agent.targetPath, fileSystem); } catch { return null; } })()
            };
        });
        return {
            name: SKILL_NAME,
            version,
            pluginVersion: pluginPackage.version,
            state: aggregateState(agents),
            sourcePath: paths.sourcePath,
            agents,
            legacyTarget: {
                state: inspectTarget(paths.legacyTargetPath, paths.sourcePath, options),
                targetPath: paths.legacyTargetPath
            }
        };
    } catch (error) {
        throw wrapSkillError(error, 'Unable to inspect the SlothVault Skill installation');
    }
}

/** Create a platform-appropriate directory link. */
function createDirectoryLink(sourcePath, targetPath, options = {}) {
    const linkType = (options.platform || process.platform) === 'win32' ? 'junction' : 'dir';
    if (options.createLink) {
        options.createLink(sourcePath, targetPath, linkType);
        return;
    }
    const fileSystem = options.fileSystem || fs;
    fileSystem.symlinkSync(sourcePath, targetPath, linkType);
}

/** Remove an existing conflict after the caller has obtained explicit authorization. */
function removeConflictTarget(targetPath, fileSystem = fs) {
    const stats = fileSystem.lstatSync(targetPath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
        fileSystem.rmSync(targetPath, {recursive: true, force: false});
        return;
    }
    fileSystem.unlinkSync(targetPath);
}

/** Remove the former shared target only when it is still a link managed by this plugin. */
function removeManagedLegacyTarget(status, fileSystem = fs) {
    if (['installed', 'outdated'].includes(status.legacyTarget.state)) {
        fileSystem.unlinkSync(status.legacyTarget.targetPath);
        return true;
    }
    return false;
}

/** Install the Skill for every detected agent, replacing conflicts only when authorized. */
export function installSkill(options = {}) {
    try {
        const fileSystem = options.fileSystem || fs;
        const paths = getSkillPaths(options);
        const initial = getSkillStatus(options);
        const detected = initial.agents.filter(agent => agent.detected);
        if (detected.length === 0) {
            throw new SlothVaultSkillError('No supported local agent was detected.', {
                code: 'SKILL_AGENT_NOT_DETECTED',
                category: 'config'
            });
        }

        const conflicts = detected.filter(agent => agent.state === 'conflict');
        if (conflicts.length > 0 && !options.replace && !options.skipConflicts) {
            throw new SlothVaultSkillError(`The SlothVault Skill target already exists: ${conflicts.map(agent => agent.targetPath).join(', ')}`, {
                code: 'SKILL_INSTALL_CONFIRMATION_REQUIRED',
                category: 'confirmation',
                targetPaths: conflicts.map(agent => agent.targetPath)
            });
        }

        const pending = detected.filter(agent => agent.state !== 'installed' && !(options.skipConflicts && agent.state === 'conflict'));
        const plans = [];
        try {
            for (const agentStatus of pending) {
                const target = paths.agents.find(agent => agent.id === agentStatus.id);
                assertFixedTarget(target, paths, options);
                fileSystem.mkdirSync(target.skillsDirectory, {recursive: true});
                const temporaryPath = path.join(target.skillsDirectory, `.${SKILL_NAME}.link.${randomUUID()}`);
                createDirectoryLink(paths.sourcePath, temporaryPath, options);
                const plan = {...target, temporaryPath, temporaryCreated: true};
                plans.push(plan);
                if (inspectTarget(temporaryPath, paths.sourcePath, options) !== 'installed') {
                    throw new SlothVaultSkillError('Unable to verify a temporary SlothVault Skill link.', {
                        code: 'SKILL_LINK_INVALID'
                    });
                }
            }

            const currentStates = plans.map(plan => ({plan, state: inspectTarget(plan.targetPath, paths.sourcePath, options)}));
            const lateConflicts = currentStates.filter(item => item.state === 'conflict');
            if (lateConflicts.length > 0 && !options.replace && !options.skipConflicts) {
                throw new SlothVaultSkillError(`The SlothVault Skill target already exists: ${lateConflicts.map(item => item.plan.targetPath).join(', ')}`, {
                    code: 'SKILL_INSTALL_CONFIRMATION_REQUIRED',
                    category: 'confirmation',
                    targetPaths: lateConflicts.map(item => item.plan.targetPath)
                });
            }

            for (const {plan, state} of currentStates) {
                if (state === 'installed') {
                    fileSystem.unlinkSync(plan.temporaryPath);
                    plan.temporaryCreated = false;
                    continue;
                }
                if (state === 'conflict' && options.skipConflicts) continue;
                if (state === 'conflict' || state === 'outdated') {
                    removeConflictTarget(plan.targetPath, fileSystem);
                }
                fileSystem.renameSync(plan.temporaryPath, plan.targetPath);
                plan.temporaryCreated = false;
            }

            const installed = getSkillStatus(options);
            const incomplete = installed.agents.filter(agent => agent.detected && agent.state !== 'installed' && !(options.skipConflicts && agent.state === 'conflict'));
            if (incomplete.length > 0) {
                throw new SlothVaultSkillError('One or more agent Skill links could not be verified after installation.', {
                    code: 'SKILL_LINK_INVALID'
                });
            }
            removeManagedLegacyTarget(installed, fileSystem);
            const result = getSkillStatus(options);
            const action = conflicts.length > 0
                ? options.skipConflicts ? 'conflict' : 'replaced'
                : pending.length > 0
                    ? 'installed'
                    : 'already-installed';
            return {...result, action};
        } finally {
            for (const plan of plans) {
                if (!plan.temporaryCreated) {
                    continue;
                }
                try {
                    fileSystem.unlinkSync(plan.temporaryPath);
                } catch {
                    // Preserve the primary failure while making a best-effort cleanup.
                }
            }
        }
    } catch (error) {
        throw wrapSkillError(error, 'Unable to install the SlothVault Skill');
    }
}

/** Remove only links managed by this plugin from detected agents and the former shared slot. */
export function uninstallSkill(options = {}) {
    try {
        const fileSystem = options.fileSystem || fs;
        const status = getSkillStatus(options);
        const detected = status.agents.filter(agent => agent.detected);
        const conflicts = detected.filter(agent => agent.state === 'conflict');
        if (conflicts.length > 0 && !options.skipConflicts) {
            throw new SlothVaultSkillError(`Refusing to remove unmanaged SlothVault Skill targets: ${conflicts.map(agent => agent.targetPath).join(', ')}`, {
                code: 'SKILL_UNINSTALL_CONFLICT',
                category: 'config',
                targetPaths: conflicts.map(agent => agent.targetPath)
            });
        }

        // An agent may have been removed from PATH since installation. Its
        // verified managed link still belongs to this runtime and must go.
        const installed = status.agents.filter(agent => ['installed', 'outdated'].includes(agent.state));
        for (const agent of installed) {
            fileSystem.unlinkSync(agent.targetPath);
        }
        const legacyRemoved = removeManagedLegacyTarget(status, fileSystem);
        return {
            ...getSkillStatus(options),
            action: installed.length > 0 || legacyRemoved ? 'uninstalled' : 'already-absent',
            conflicts: conflicts.map(agent => agent.targetPath)
        };
    } catch (error) {
        throw wrapSkillError(error, 'Unable to uninstall the SlothVault Skill');
    }
}

export default {detectSkillAgents, getSkillPaths, getSkillStatus, installSkill, uninstallSkill};
