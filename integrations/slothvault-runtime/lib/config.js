/**
 * @file SlothVaultMcpConfigStore
 * @project SlothVault
 * @module External toolkit / MCP storage
 * @description 管理 SlothVault MCP 多配置档案及明文 Bearer Key，并安全迁移 MCP-only 插件遗留位置。
 * @logic 1. 严格校验档案名称、端点、Key 和超时；2. 通过同目录临时文件原子替换配置；3. 对 HTTP 和明文凭据给出可展示警告。
 * @dependencies Node: fs/os/path/crypto
 * @index_tags slothvault,mcp,profile,config,api-key
 * @author holic512
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const CONFIG_SCHEMA_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 300_000;
export const PROFILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
export const API_KEY_PATTERN = /^svmcp_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/u;

export class SlothVaultConfigError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'SlothVaultConfigError';
        this.code = options.code || 'INVALID_CONFIG';
        this.exitCode = 2;
    }
}

export function getSlothToolHome(options = {}) {
    return options.slothToolHome || path.join(options.homeDir || os.homedir(), '.pipker', 'slothtool');
}

export function getConfigPath(options = {}) {
    return options.configPath || path.join(getSlothToolHome(options), 'plugin-configs', 'slothvault.json');
}

/** Return the v1 configuration location used before the multifunction plugin rename. */
export function getLegacyConfigPath(options = {}) {
    return options.legacyConfigPath || path.join(getSlothToolHome(options), 'plugin-configs', 'slothvault-mcp.json');
}

/** Inspect profile storage paths without opening either document or triggering migration. */
export function getConfigStorageStatus(options = {}) {
    const targetPath = getConfigPath(options);
    if (options.configPath) {
        return {state: 'custom', targetPath, legacyPath: null};
    }
    const legacyPath = getLegacyConfigPath(options);
    const canonicalExists = fs.existsSync(targetPath);
    const legacyExists = fs.existsSync(legacyPath);
    return {
        state: canonicalExists && legacyExists
            ? 'conflict'
            : canonicalExists
                ? 'current'
                : legacyExists
                    ? 'legacy-only'
                    : 'absent',
        targetPath,
        legacyPath
    };
}

/** Move a v1 profile file only when the canonical target has not been created yet. */
function migrateLegacyConfigIfNeeded(options = {}) {
    if (options.configPath) {
        return {state: 'custom'};
    }
    const targetPath = getConfigPath(options);
    const legacyPath = getLegacyConfigPath(options);
    if (fs.existsSync(targetPath)) {
        return {state: fs.existsSync(legacyPath) ? 'conflict' : 'current', targetPath, legacyPath};
    }
    if (!fs.existsSync(legacyPath)) {
        return {state: 'absent', targetPath, legacyPath};
    }
    fs.mkdirSync(path.dirname(targetPath), {recursive: true, mode: 0o700});
    fs.renameSync(legacyPath, targetPath);
    return {state: 'migrated', targetPath, legacyPath};
}

/** Report the canonical and legacy locations without reading credential content. */
export function getConfigMigrationStatus(options = {}) {
    return migrateLegacyConfigIfNeeded(options);
}

export function getDefaultConfig() {
    return {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        defaultProfile: null,
        profiles: {}
    };
}

export function validateProfileName(value) {
    const name = String(value || '').trim();
    if (!PROFILE_NAME_PATTERN.test(name)) {
        throw new SlothVaultConfigError('Profile name must be 1-64 letters, numbers, dots, underscores, or hyphens.', {
            code: 'INVALID_PROFILE_NAME'
        });
    }
    return name;
}

export function validateApiKey(value) {
    const apiKey = String(value || '').trim();
    if (!API_KEY_PATTERN.test(apiKey)) {
        throw new SlothVaultConfigError('MCP key must match svmcp_<24 characters>.<43 characters>.', {
            code: 'INVALID_API_KEY'
        });
    }
    return apiKey;
}

export function validateTimeoutMs(value = DEFAULT_TIMEOUT_MS) {
    const timeoutMs = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
        throw new SlothVaultConfigError('Timeout must be an integer between 1000 and 300000 milliseconds.', {
            code: 'INVALID_TIMEOUT'
        });
    }
    return timeoutMs;
}

export function normalizeEndpoint(value) {
    let endpoint;
    try {
        endpoint = new URL(String(value || '').trim());
    } catch {
        throw new SlothVaultConfigError('Endpoint must be a valid HTTP or HTTPS URL.', {
            code: 'INVALID_ENDPOINT'
        });
    }

    if (!['http:', 'https:'].includes(endpoint.protocol)) {
        throw new SlothVaultConfigError('Endpoint must use HTTP or HTTPS.', {code: 'INVALID_ENDPOINT'});
    }
    if (!endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new SlothVaultConfigError('Endpoint must not contain credentials, query parameters, or a fragment.', {
            code: 'INVALID_ENDPOINT'
        });
    }

    if (endpoint.pathname === '' || endpoint.pathname === '/') {
        endpoint.pathname = '/mcp';
    } else if (!endpoint.pathname.endsWith('/mcp')) {
        throw new SlothVaultConfigError('Endpoint path must end with /mcp.', {code: 'INVALID_ENDPOINT'});
    }

    return endpoint.toString();
}

export function maskApiKey(value) {
    const apiKey = String(value || '');
    if (!apiKey) {
        return '';
    }
    const publicId = /^svmcp_([^.]*)/u.exec(apiKey)?.[1] || '';
    return publicId ? `svmcp_${publicId.slice(0, 8)}...` : '[redacted]';
}

export function getProfileWarnings(profile) {
    const warnings = ['The MCP key is stored as plaintext in the local SlothTool plugin configuration.'];
    if (profile?.endpoint?.startsWith('http:')) {
        warnings.unshift('The HTTP endpoint transmits the MCP key without transport encryption.');
    }
    return warnings;
}

/** Normalizes one persisted profile and rejects incomplete or unsafe fields. */
function normalizeProfile(name, input = {}) {
    const normalizedName = validateProfileName(name);
    const createdAt = normalizeTimestamp(input.createdAt, 'createdAt');
    const updatedAt = normalizeTimestamp(input.updatedAt || input.createdAt, 'updatedAt');
    return {
        name: normalizedName,
        endpoint: normalizeEndpoint(input.endpoint ?? input.url),
        apiKey: validateApiKey(input.apiKey),
        timeoutMs: validateTimeoutMs(input.timeoutMs ?? input.timeout ?? DEFAULT_TIMEOUT_MS),
        createdAt,
        updatedAt
    };
}

/** Normalizes an ISO timestamp while supplying a current timestamp for new records. */
function normalizeTimestamp(value, fieldName) {
    if (value === undefined || value === null || value === '') {
        return new Date().toISOString();
    }
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) {
        throw new SlothVaultConfigError(`Profile ${fieldName} must be a valid timestamp.`, {
            code: 'INVALID_CONFIG'
        });
    }
    return timestamp.toISOString();
}

/** Validates the complete persisted configuration and returns a canonical copy. */
function normalizeConfig(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new SlothVaultConfigError('SlothVault MCP configuration must be a JSON object.', {
            code: 'INVALID_CONFIG'
        });
    }
    if (input.schemaVersion !== undefined && input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
        throw new SlothVaultConfigError(`Unsupported configuration schema version: ${input.schemaVersion}.`, {
            code: 'UNSUPPORTED_CONFIG_VERSION'
        });
    }

    const sourceProfiles = input.profiles ?? {};
    if (!sourceProfiles || typeof sourceProfiles !== 'object' || Array.isArray(sourceProfiles)) {
        throw new SlothVaultConfigError('Configuration profiles must be an object.', {code: 'INVALID_CONFIG'});
    }

    const profiles = {};
    for (const [name, profile] of Object.entries(sourceProfiles)) {
        const normalized = normalizeProfile(name, profile);
        profiles[normalized.name] = normalized;
    }

    let defaultProfile = input.defaultProfile ?? null;
    if (defaultProfile !== null) {
        defaultProfile = validateProfileName(defaultProfile);
        if (!profiles[defaultProfile]) {
            throw new SlothVaultConfigError(`Default profile does not exist: ${defaultProfile}.`, {
                code: 'PROFILE_NOT_FOUND'
            });
        }
    }

    return {schemaVersion: CONFIG_SCHEMA_VERSION, defaultProfile, profiles};
}

/** Writes JSON through a private, same-directory temporary file and atomic rename. */
function writePrivateJsonAtomic(filePath, value) {
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);

    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600, flag: 'wx'});
        try {
            fs.chmodSync(temporaryPath, 0o600);
        } catch {
            // Windows may not implement POSIX permission bits; exclusive creation still applies.
        }
        fs.renameSync(temporaryPath, filePath);
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {
            // Best effort on platforms without POSIX permissions.
        }
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, {force: true});
        } catch {
            // Preserve the original write error.
        }
        throw error;
    }
}

export function readConfig(options = {}) {
    migrateLegacyConfigIfNeeded(options);
    const configPath = getConfigPath(options);
    if (!fs.existsSync(configPath)) {
        return getDefaultConfig();
    }

    try {
        return normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
    } catch (error) {
        if (error instanceof SlothVaultConfigError) {
            throw error;
        }
        throw new SlothVaultConfigError(`Unable to read SlothVault MCP configuration: ${error.message}`, {
            code: 'INVALID_CONFIG',
            cause: error
        });
    }
}

export function writeConfig(config, options = {}) {
    migrateLegacyConfigIfNeeded(options);
    const normalized = normalizeConfig(config);
    writePrivateJsonAtomic(getConfigPath(options), normalized);
    return normalized;
}

export function listProfiles(options = {}) {
    const config = readConfig(options);
    return Object.values(config.profiles)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(profile => ({
            ...profile,
            apiKey: maskApiKey(profile.apiKey),
            isDefault: profile.name === config.defaultProfile,
            warnings: getProfileWarnings(profile)
        }));
}

export function resolveProfile(name, options = {}) {
    const config = readConfig(options);
    const requestedName = name ? validateProfileName(name) : config.defaultProfile;
    if (!requestedName) {
        throw new SlothVaultConfigError('No default SlothVault MCP profile is configured.', {
            code: 'DEFAULT_PROFILE_NOT_SET'
        });
    }
    const profile = config.profiles[requestedName];
    if (!profile) {
        throw new SlothVaultConfigError(`Profile not found: ${requestedName}.`, {code: 'PROFILE_NOT_FOUND'});
    }
    return structuredClone(profile);
}

export function getProfile(name, options = {}) {
    const profile = resolveProfile(name, options);
    return {
        ...profile,
        apiKey: maskApiKey(profile.apiKey),
        isDefault: readConfig(options).defaultProfile === profile.name,
        warnings: getProfileWarnings(profile)
    };
}

export function addProfile(name, input, options = {}) {
    // Step 0: Validate all fields before reading or changing persisted state.
    const normalizedName = validateProfileName(name);
    const now = new Date().toISOString();
    const profile = normalizeProfile(normalizedName, {...input, createdAt: now, updatedAt: now});

    // Step 1: Insert the profile and select a deterministic default.
    const config = readConfig(options);
    if (config.profiles[normalizedName]) {
        throw new SlothVaultConfigError(`Profile already exists: ${normalizedName}.`, {
            code: 'PROFILE_EXISTS'
        });
    }
    config.profiles[normalizedName] = profile;
    if (!config.defaultProfile || input?.makeDefault === true || input?.default === true) {
        config.defaultProfile = normalizedName;
    }

    // Step 2: Persist atomically and return only a masked public view.
    writeConfig(config, options);
    return getProfile(normalizedName, options);
}

export function updateProfile(name, patch = {}, options = {}) {
    // Step 0: Resolve the existing record and retain immutable creation metadata.
    const normalizedName = validateProfileName(name);
    const config = readConfig(options);
    const existing = config.profiles[normalizedName];
    if (!existing) {
        throw new SlothVaultConfigError(`Profile not found: ${normalizedName}.`, {code: 'PROFILE_NOT_FOUND'});
    }

    // Step 1: Validate only the supplied replacements as one complete profile.
    const next = normalizeProfile(normalizedName, {
        ...existing,
        ...(patch.endpoint !== undefined || patch.url !== undefined
            ? {endpoint: patch.endpoint ?? patch.url}
            : {}),
        ...(patch.apiKey !== undefined ? {apiKey: patch.apiKey} : {}),
        ...(patch.timeoutMs !== undefined || patch.timeout !== undefined
            ? {timeoutMs: patch.timeoutMs ?? patch.timeout}
            : {}),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
    });

    // Step 2: Persist atomically after optional default selection.
    config.profiles[normalizedName] = next;
    if (patch.makeDefault === true || patch.default === true) {
        config.defaultProfile = normalizedName;
    }
    writeConfig(config, options);
    return getProfile(normalizedName, options);
}

export function useProfile(name, options = {}) {
    const normalizedName = validateProfileName(name);
    const config = readConfig(options);
    if (!config.profiles[normalizedName]) {
        throw new SlothVaultConfigError(`Profile not found: ${normalizedName}.`, {code: 'PROFILE_NOT_FOUND'});
    }
    config.defaultProfile = normalizedName;
    writeConfig(config, options);
    return getProfile(normalizedName, options);
}

export function removeProfile(name, options = {}) {
    // Step 0: Remove only an existing named profile.
    const normalizedName = validateProfileName(name);
    const config = readConfig(options);
    if (!config.profiles[normalizedName]) {
        throw new SlothVaultConfigError(`Profile not found: ${normalizedName}.`, {code: 'PROFILE_NOT_FOUND'});
    }
    delete config.profiles[normalizedName];

    // Step 1: Migrate the default deterministically to the first remaining name.
    if (config.defaultProfile === normalizedName) {
        config.defaultProfile = Object.keys(config.profiles).sort((left, right) => left.localeCompare(right))[0] || null;
    }

    // Step 2: Persist and return only non-secret removal metadata.
    writeConfig(config, options);
    return {name: normalizedName, defaultProfile: config.defaultProfile};
}

export function getConfigSummary(options = {}) {
    const config = readConfig(options);
    return {
        schemaVersion: config.schemaVersion,
        defaultProfile: config.defaultProfile,
        configPath: getConfigPath(options),
        profiles: listProfiles(options)
    };
}

export default {
    addProfile,
    getConfigPath,
    getConfigStorageStatus,
    getConfigSummary,
    getDefaultConfig,
    getProfile,
    getProfileWarnings,
    listProfiles,
    maskApiKey,
    normalizeEndpoint,
    readConfig,
    removeProfile,
    resolveProfile,
    updateProfile,
    useProfile,
    validateApiKey,
    validateProfileName,
    validateTimeoutMs,
    writeConfig
};
