/**
 * @file setup.js
 * @project SlothVault
 * @module SlothVault Connection Setup
 * @description Saves a URL and key, reuses matching connections, and reports connection health separately from persistence.
 * @logic Normalize and validate before writing; select a deterministic profile; optionally prepare managed entry points; inspect once after saving.
 * @dependencies config, service, skill-manager, mcp-command-manager
 * @index_tags setup,profile,connection
 * @author holic512
 */
import {readConfig, normalizeEndpoint, validateApiKey, addProfile, updateProfile} from './config.js';
import {doctor, classifyError} from './service.js';
import {getSkillStatus, installSkill} from './skill-manager.js';
import {getMcpCommandStatus, registerMcpCommand} from './mcp-command-manager.js';

export function prepareManagedSetup(options = {}) {
    let registration;
    let skill;
    try {
        const command = getMcpCommandStatus(options.commandOptions);
        registration = ['registered', 'conflict', 'unavailable'].includes(command.state)
            ? command : registerMcpCommand(options.commandOptions);
    } catch (error) { registration = {state: 'error', code: error.code || 'MCP_COMMAND_ERROR'}; }
    try {
        const initial = getSkillStatus(options.skillOptions);
        skill = initial.agents.some(agent => agent.detected)
            ? installSkill({...options.skillOptions, skipConflicts: true}) : initial;
    } catch (error) { skill = {state: 'error', code: error.code || 'SKILL_ERROR'}; }
    return {command: registration, skill};
}

export async function setupConnection(input, options = {}) {
    const configOptions = options.configOptions || options;
    const endpoint = normalizeEndpoint(input.endpoint);
    const apiKey = validateApiKey(input.apiKey);
    const config = readConfig(configOptions);
    const existing = Object.values(config.profiles).find(profile => profile.endpoint === endpoint);
    let name = existing?.name || 'default';
    for (let index = 2; !existing && config.profiles[name]; index++) name = `connection-${index}`;
    const profile = existing
        ? updateProfile(name, {endpoint, apiKey, makeDefault: true}, configOptions)
        : addProfile(name, {endpoint, apiKey, makeDefault: true}, configOptions);
    const managed = options.managed ? prepareManagedSetup(options) : undefined;
    try {
        const connection = await (options.checkConnection || doctor)({profileName: name, configOptions, recordHistory: false});
        return {saved: true, connected: true, profile, server: connection.server, ...(managed ? {managed} : {})};
    } catch (error) {
        const safe = classifyError(error);
        return {saved: true, connected: false, profile, error: {code: safe.code, category: safe.category}, ...(managed ? {managed} : {})};
    }
}
