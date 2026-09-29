/**
 * @file SlothVaultMcpHistoryStore
 * @project SlothVault
 * @module External toolkit / MCP storage
 * @description 保存不含完整请求、结果、凭据或 Resource 内容的 MCP 调用历史，并安全迁移 MCP-only 插件遗留位置。
 * @logic 1. 递归移除敏感字段；2. 将摘要限制到 512 字符；3. 使用私有原子文件轮转最近 200 条记录。
 * @dependencies Node: fs/os/path/crypto
 * @index_tags slothvault,mcp,history,redaction,audit
 * @author holic512
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const HISTORY_SCHEMA_VERSION = 1;
export const HISTORY_LIMIT = 200;
export const SUMMARY_LIMIT = 512;

const SENSITIVE_KEY_PATTERN = /(?:authorization|api[-_]?key|token|secret|password|credential|cookie|content[-_]?base64|blob|file[-_]?content|private[-_]?key)/iu;
const CONTENT_KEY_PATTERN = /^(?:args|arguments|body|content|data|payload|result)$/iu;
const INLINE_SECRET_PATTERNS = [
    /svmcp_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}/gu,
    /Bearer\s+[^\s"']+/giu
];

export function getHistoryPath(options = {}) {
    const slothToolHome = options.slothToolHome || path.join(options.homeDir || os.homedir(), '.pipker', 'slothtool');
    return options.historyPath || path.join(slothToolHome, 'data', 'slothvault', 'history.json');
}

/** Return the v1 history path used by the former MCP-only plugin. */
export function getLegacyHistoryPath(options = {}) {
    const slothToolHome = options.slothToolHome || path.join(options.homeDir || os.homedir(), '.pipker', 'slothtool');
    return options.legacyHistoryPath || path.join(slothToolHome, 'data', 'slothvault-mcp', 'history.json');
}

/** Inspect redacted-history storage paths without opening content or triggering migration. */
export function getHistoryStorageStatus(options = {}) {
    const targetPath = getHistoryPath(options);
    if (options.historyPath) {
        return {state: 'custom', targetPath, legacyPath: null};
    }
    const legacyPath = getLegacyHistoryPath(options);
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

/** Move v1 redacted history only when no canonical history exists. */
function migrateLegacyHistoryIfNeeded(options = {}) {
    if (options.historyPath) {
        return {state: 'custom'};
    }
    const targetPath = getHistoryPath(options);
    const legacyPath = getLegacyHistoryPath(options);
    if (fs.existsSync(targetPath)) {
        return {state: fs.existsSync(legacyPath) ? 'conflict' : 'current', targetPath, legacyPath};
    }
    if (!fs.existsSync(legacyPath)) {
        return {state: 'absent', targetPath, legacyPath};
    }
    fs.mkdirSync(path.dirname(targetPath), {recursive: true, mode: 0o700});
    fs.renameSync(legacyPath, targetPath);
    const legacyDirectory = path.dirname(legacyPath);
    try {
        if (fs.readdirSync(legacyDirectory).length === 0) {
            fs.rmdirSync(legacyDirectory);
        }
    } catch {
        // The moved history is already safe; an empty legacy directory is harmless.
    }
    return {state: 'migrated', targetPath, legacyPath};
}

/** Report migration state without exposing stored history content. */
export function getHistoryMigrationStatus(options = {}) {
    return migrateLegacyHistoryIfNeeded(options);
}

/** Replaces key-shaped and inline secrets while retaining useful structural context. */
function redactValue(value, seen) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        return INLINE_SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), value);
    }
    if (typeof value !== 'object') {
        return String(value);
    }
    if (seen.has(value)) {
        return '[circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map(item => redactValue(item, seen));
        seen.delete(value);
        return result;
    }

    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = SENSITIVE_KEY_PATTERN.test(key) || CONTENT_KEY_PATTERN.test(key)
            ? '[redacted]'
            : redactValue(item, seen);
    }
    seen.delete(value);
    return result;
}

export function redactSensitive(value) {
    return redactValue(value, new WeakSet());
}

export function createHistorySummary(value) {
    let text;
    if (typeof value === 'string') {
        text = redactSensitive(value);
    } else {
        try {
            text = JSON.stringify(redactSensitive(value));
        } catch {
            text = '[unserializable]';
        }
    }
    return String(text).replace(/[\r\n\t]+/gu, ' ').slice(0, SUMMARY_LIMIT);
}

/** Produces a strict metadata-only history entry. */
function normalizeEntry(input = {}) {
    const timestamp = new Date(input.timestamp || new Date());
    return {
        id: String(input.id || randomUUID()),
        timestamp: Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString(),
        profile: String(input.profile || ''),
        server: input.server && typeof input.server === 'object'
            ? {
                name: String(input.server.name || ''),
                version: String(input.server.version || ''),
                protocolVersion: input.server.protocolVersion ? String(input.server.protocolVersion) : null
            }
            : null,
        operation: String(input.operation || input.type || ''),
        name: String(input.name || ''),
        risk: input.risk === 'read' ? 'read' : input.risk === 'write' ? 'write' : 'unknown',
        durationMs: Math.max(0, Number.isFinite(Number(input.durationMs)) ? Math.round(Number(input.durationMs)) : 0),
        success: input.success === true,
        errorCategory: input.errorCategory ? String(input.errorCategory) : null,
        summary: createHistorySummary(input.summary ?? '')
    };
}

/** Returns an empty canonical history document. */
function emptyHistory() {
    return {schemaVersion: HISTORY_SCHEMA_VERSION, entries: []};
}

/** Writes a complete history document with private permissions and atomic replacement. */
function writeHistoryDocument(document, options = {}) {
    migrateLegacyHistoryIfNeeded(options);
    const historyPath = getHistoryPath(options);
    const directory = path.dirname(historyPath);
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    const temporaryPath = path.join(directory, `.${path.basename(historyPath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        fs.renameSync(temporaryPath, historyPath);
        try {
            fs.chmodSync(historyPath, 0o600);
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

/** Quarantines malformed history so later writes can recover without losing evidence. */
function quarantineCorruptHistory(historyPath) {
    const corruptPath = `${historyPath}.corrupt-${Date.now()}`;
    try {
        fs.renameSync(historyPath, corruptPath);
        return corruptPath;
    } catch {
        return null;
    }
}

/** Reads, validates, and caps the stored history document. */
function readHistoryDocument(options = {}) {
    migrateLegacyHistoryIfNeeded(options);
    const historyPath = getHistoryPath(options);
    if (!fs.existsSync(historyPath)) {
        return emptyHistory();
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        const sourceEntries = Array.isArray(parsed) ? parsed : parsed?.entries;
        if (!Array.isArray(sourceEntries)) {
            throw new Error('History entries must be an array.');
        }
        return {
            schemaVersion: HISTORY_SCHEMA_VERSION,
            entries: sourceEntries.slice(0, HISTORY_LIMIT).map(normalizeEntry)
        };
    } catch (error) {
        if (options.recover === false) {
            throw error;
        }
        quarantineCorruptHistory(historyPath);
        return emptyHistory();
    }
}

export function appendHistory(entry, options = {}) {
    const document = readHistoryDocument(options);
    const normalized = normalizeEntry(entry);
    document.entries = [normalized, ...document.entries].slice(0, HISTORY_LIMIT);
    writeHistoryDocument(document, options);
    return normalized;
}

export function listHistory(options = {}) {
    const entries = readHistoryDocument(options).entries;
    const limit = options.limit === undefined ? HISTORY_LIMIT : Math.max(0, Math.min(HISTORY_LIMIT, Number(options.limit) || 0));
    return entries.slice(0, limit);
}

export function getHistory(id, options = {}) {
    return readHistoryDocument(options).entries.find(entry => entry.id === String(id)) || null;
}

export function clearHistory(options = {}) {
    const count = readHistoryDocument(options).entries.length;
    writeHistoryDocument(emptyHistory(), options);
    return {cleared: count, historyPath: getHistoryPath(options)};
}

export default {
    appendHistory,
    clearHistory,
    createHistorySummary,
    getHistory,
    getHistoryStorageStatus,
    getHistoryPath,
    listHistory,
    redactSensitive
};
