/**
 * @file SlothVaultMcpService
 * @project SlothVault
 * @module External toolkit / MCP services
 * @description 通过官方 MCP SDK 为独立 slothvault-mcp 命令提供 SlothVault 管理员服务发现、调用、诊断与受保护 Resource 下载。
 * @logic 1. 每次操作建立独立无状态连接并验证服务端身份；2. 实时发现能力和 Tool 风险；3. 写 Tool 强制确认且不重试；4. Resource 经校验后排他式原子落盘。
 * @dependencies MCP SDK Client/StreamableHTTPClientTransport, Node: fs/path, Config: ./config.js, History: ./history.js, Plugin: package.json
 * @index_tags slothvault,mcp,client,streamable-http,tools,resources
 * @author holic512
 */

import fs from 'node:fs';
import {businessErrorDetails} from './business-error.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import pluginPackage from '../package.json' with {type: 'json'};
import {getProfileWarnings, resolveProfile, SlothVaultConfigError} from './config.js';
import {appendHistory, createHistorySummary, redactSensitive} from './history.js';

export const EXPECTED_SERVER_NAME = 'slothvault-admin-mcp';
export const MANAGED_FILE_PREFIX = 'slothvault://managed-file/';
export const CONTRACT_ATTACHMENT_PREFIX = 'slothvault://contract-attachment/';
export const MANAGED_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CONTRACT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const RESOURCE_FILE_NAME_META_KEY = 'slothvault/file-name';

export class SlothVaultMcpError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'SlothVaultMcpError';
        this.code = options.code || 'MCP_ERROR';
        this.category = options.category || 'internal';
        this.exitCode = options.exitCode ?? exitCodeForCategory(this.category);
        this.status = options.status ?? null;
        this.details = options.details ?? null;
    }
}

export class SlothVaultMcpBusinessError extends SlothVaultMcpError {
    constructor(message, result, options = {}) {
        super(message, {
            ...options,
            code: options.code || 'MCP_BUSINESS_ERROR',
            category: 'business',
            exitCode: 5,
            details: result
        });
        this.name = 'SlothVaultMcpBusinessError';
        this.result = result;
        this.business = businessErrorDetails(result, options.secrets);
    }
}

/** Maps one stable error category to the public CLI exit-code contract. */
function exitCodeForCategory(category) {
    if (category === 'usage' || category === 'config' || category === 'confirmation') {
        return 2;
    }
    if (category === 'auth') {
        return 3;
    }
    if (category === 'network' || category === 'unavailable' || category === 'protocol' || category === 'timeout') {
        return 4;
    }
    if (category === 'business') {
        return 5;
    }
    return 1;
}

/** Extracts a probable HTTP status from SDK, fetch, or wrapped causes. */
function extractStatus(error) {
    const candidates = [
        error?.status,
        error?.statusCode,
        error?.response?.status,
        error?.cause?.status,
        error?.cause?.statusCode,
        error?.cause?.response?.status,
        Number.isInteger(Number(error?.code)) && Number(error.code) >= 100 && Number(error.code) <= 599
            ? Number(error.code)
            : null
    ];
    return candidates.find(value => (
        value !== null
        && value !== undefined
        && Number.isInteger(Number(value))
        && Number(value) >= 100
        && Number(value) <= 599
    )) ?? null;
}

export function classifyError(error) {
    if (error instanceof SlothVaultMcpError) {
        return error;
    }
    if (error instanceof SlothVaultConfigError) {
        return new SlothVaultMcpError(error.message, {
            code: error.code,
            category: 'config',
            exitCode: 2,
            cause: error
        });
    }

    const status = extractStatus(error);
    const text = `${error?.message || ''}\n${error?.cause?.message || ''}`;
    if (Number(status) === 401 || /\b401\b|unauthorized|invalid bearer|authentication/iu.test(text)) {
        return new SlothVaultMcpError('SlothVault MCP authentication failed.', {
            code: 'MCP_AUTH_FAILED', category: 'auth', exitCode: 3, status: 401, cause: error
        });
    }
    if (Number(status) === 503 || /\b503\b|service unavailable|installation completes/iu.test(text)) {
        return new SlothVaultMcpError('SlothVault MCP is unavailable.', {
            code: 'MCP_UNAVAILABLE', category: 'unavailable', exitCode: 4, status: 503, cause: error
        });
    }
    if (error?.name === 'AbortError' || /timed? out|timeout|aborted/iu.test(text)) {
        return new SlothVaultMcpError('SlothVault MCP request timed out.', {
            code: 'MCP_TIMEOUT', category: 'timeout', exitCode: 4, status, cause: error
        });
    }
    if (/fetch failed|failed to fetch|econnrefused|econnreset|enotfound|eai_again|network|socket|dns/iu.test(text)) {
        return new SlothVaultMcpError('Unable to reach the SlothVault MCP endpoint.', {
            code: 'MCP_NETWORK_ERROR', category: 'network', exitCode: 4, status, cause: error
        });
    }
    return new SlothVaultMcpError(error?.message || 'SlothVault MCP protocol error.', {
        code: 'MCP_PROTOCOL_ERROR', category: 'protocol', exitCode: 4, status, cause: error
    });
}

/** Resolves either a supplied profile object or a configured profile name. */
function selectedProfile(options = {}) {
    if (options.profile && typeof options.profile === 'object') {
        return {...options.profile, timeoutMs: options.profile.timeoutMs || 30_000};
    }
    const name = typeof options.profile === 'string' ? options.profile : options.profileName;
    return resolveProfile(name, options.configOptions || options);
}

/** Creates the production SDK Client unless a test factory is injected. */
async function createClient(profile, options) {
    if (options.client) {
        return options.client;
    }
    if (typeof options.clientFactory === 'function') {
        return await options.clientFactory({profile, options});
    }
    return new Client(
        {name: '@holic512/plugin-slothvault', version: options.clientVersion || pluginPackage.version},
        {capabilities: {}}
    );
}

/** Creates an authenticated Streamable HTTP transport unless a test factory is injected. */
async function createTransport(profile, signal, options) {
    if (options.transport) {
        return options.transport;
    }
    if (typeof options.transportFactory === 'function') {
        return await options.transportFactory({profile, signal, options});
    }
    return new StreamableHTTPClientTransport(new URL(profile.endpoint), {
        requestInit: {
            headers: {Authorization: `Bearer ${profile.apiKey}`}
        }
    });
}

/** Creates the stable timeout error shared by connection-stage guards and the timer. */
function timeoutError(timeoutMs) {
    return new SlothVaultMcpError(`SlothVault MCP request timed out after ${timeoutMs} ms.`, {
        code: 'MCP_TIMEOUT', category: 'timeout', exitCode: 4
    });
}

/** Invokes an async function under a wall-clock timeout and closes HTTP work on expiry. */
async function withTimeout(callback, timeoutMs, controller, onTimeout) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            try {
                Promise.resolve(onTimeout?.()).catch(() => {});
            } catch {
                // Timeout classification takes precedence over cleanup failures.
            }
            reject(timeoutError(timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([callback(), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** Reads the SDK-negotiated protocol version without assuming a fixed server release. */
function negotiatedProtocolVersion(client, transport) {
    return client.getProtocolVersion?.()
        || client.protocolVersion
        || client._protocolVersion
        || transport?.protocolVersion
        || transport?._protocolVersion
        || null;
}

/** Verifies the live server identity before exposing any capability to callers. */
function verifiedServerInfo(client, transport) {
    const server = client.getServerVersion?.() || client.serverVersion;
    if (!server || server.name !== EXPECTED_SERVER_NAME) {
        throw new SlothVaultMcpError(
            `Unexpected MCP server identity: ${server?.name || 'unknown'}; expected ${EXPECTED_SERVER_NAME}.`,
            {code: 'UNEXPECTED_SERVER_IDENTITY', category: 'protocol', exitCode: 4, details: server || null}
        );
    }
    return {
        name: server.name,
        version: String(server.version || ''),
        protocolVersion: negotiatedProtocolVersion(client, transport)
    };
}

/** Runs one operation in a fresh connection and closes both injected and SDK transports. */
async function withConnection(options, callback) {
    const profile = selectedProfile(options);
    const controller = new AbortController();
    let client;
    let transport;
    let connectionStarted = false;
    let operationError;
    let clientClosePromise;
    let transportClosePromise;
    let timedOut = false;

    /** Closes each resource created so far at most once, including late factory results. */
    const closeConnection = () => {
        const pending = [];
        if (client && typeof client.close === 'function' && !clientClosePromise) {
            clientClosePromise = Promise.resolve().then(() => client.close());
            pending.push(clientClosePromise);
        } else if (clientClosePromise) {
            pending.push(clientClosePromise);
        }
        const clientOwnsTransport = connectionStarted && client && typeof client.close === 'function';
        if (!clientOwnsTransport && transport && typeof transport.close === 'function' && !transportClosePromise) {
            transportClosePromise = Promise.resolve().then(() => transport.close());
            pending.push(transportClosePromise);
        } else if (transportClosePromise) {
            pending.push(transportClosePromise);
        }
        return pending.length ? Promise.all(pending) : Promise.resolve();
    };

    /** Rejects late continuation and starts cleanup without waiting for a stuck close hook. */
    const assertActive = () => {
        if (controller.signal.aborted) {
            Promise.resolve(closeConnection()).catch(() => {});
            throw timeoutError(profile.timeoutMs);
        }
    };

    try {
        return await withTimeout(async () => {
            // Step 0: Construct one authenticated client/transport pair for this operation.
            client = await createClient(profile, options);
            assertActive();
            transport = await createTransport(profile, controller.signal, options);
            assertActive();

            // Step 1: Negotiate MCP and reject endpoints with an unexpected server identity.
            connectionStarted = true;
            await client.connect(transport);
            assertActive();
            const server = verifiedServerInfo(client, transport);

            // Step 2: Execute exactly once; callers intentionally own any explicit retry policy.
            return await callback({client, transport, profile, server, signal: controller.signal, assertActive});
        }, profile.timeoutMs, controller, () => {
            timedOut = true;
            return closeConnection();
        });
    } catch (error) {
        operationError = error;
        throw classifyError(error);
    } finally {
        controller.abort();
        try {
            const cleanup = closeConnection();
            if (timedOut) {
                Promise.resolve(cleanup).catch(() => {});
            } else {
                await cleanup;
            }
        } catch (closeError) {
            if (!operationError && options.throwCloseError === true) {
                throw classifyError(closeError);
            }
        }
    }
}

/** Fetches all cursor pages from one MCP list method. */
async function collectPages(client, methodName, collectionName, assertActive = () => {}) {
    const items = [];
    let cursor;
    do {
        assertActive();
        const request = cursor ? {cursor} : {};
        const response = await client[methodName](request);
        assertActive();
        if (!response || !Array.isArray(response[collectionName])) {
            throw new SlothVaultMcpError(`Invalid ${methodName} response from SlothVault MCP.`, {
                code: 'INVALID_MCP_RESPONSE', category: 'protocol', exitCode: 4
            });
        }
        items.push(...response[collectionName]);
        cursor = response.nextCursor || undefined;
    } while (cursor);
    return items;
}

/** Writes one metadata-only audit record without masking the remote operation outcome. */
function recordHistory(entry, options) {
    if (options.recordHistory === false) {
        return;
    }
    try {
        const writer = options.historyWriter || appendHistory;
        writer(entry, options.historyOptions || options.configOptions || options);
    } catch {
        // History is auxiliary and must not replay or change the result of a remote operation.
    }
}

/** Executes and records one connected operation with stable timing/error metadata. */
async function executeRemote(operation, name, options, callback) {
    const startedAt = Date.now();
    let context = {profile: null, server: null, risk: options.risk || 'unknown'};
    try {
        const value = await withConnection(options, async connection => {
            context = {...context, profile: connection.profile, server: connection.server};
            return await callback(connection, context);
        });
        recordHistory({
            profile: context.profile?.name,
            server: context.server,
            operation,
            name,
            risk: context.risk,
            durationMs: Date.now() - startedAt,
            success: true,
            summary: summarizeRemoteResult(value)
        }, options);
        return value;
    } catch (error) {
        const classified = classifyError(error);
        recordHistory({
            profile: context.profile?.name || (typeof options.profile === 'string' ? options.profile : options.profileName),
            server: context.server,
            operation,
            name,
            risk: context.risk,
            durationMs: Date.now() - startedAt,
            success: false,
            errorCategory: classified.category,
            summary: classified.message
        }, options);
        throw classified;
    }
}

/** Reduces a remote result to non-sensitive structural metadata for local history. */
function summarizeRemoteResult(value) {
    if (Array.isArray(value)) {
        return `${value.length} item(s)`;
    }
    if (value?.result?.content) {
        return `${value.result.content.length} content item(s)`;
    }
    if (value?.tools || value?.prompts || value?.resourceTemplates) {
        return `tools=${value.tools?.length || 0}, prompts=${value.prompts?.length || 0}, resources=${value.resourceTemplates?.length || 0}`;
    }
    if (value?.capabilities) {
        return `tools=${value.capabilities.tools || 0}, prompts=${value.capabilities.prompts || 0}, resources=${value.capabilities.resourceTemplates || 0}`;
    }
    if (value?.bytes !== undefined) {
        return `resource saved (${value.bytes} bytes)`;
    }
    return createHistorySummary('completed');
}

export async function inspectServer(options = {}) {
    return await executeRemote('inspect', '', {...options, risk: 'read'}, async ({client, server, profile, assertActive}) => {
        const startedAt = Date.now();
        const tools = await collectPages(client, 'listTools', 'tools', assertActive);
        const prompts = await collectPages(client, 'listPrompts', 'prompts', assertActive);
        const resourceTemplates = await collectPages(client, 'listResourceTemplates', 'resourceTemplates', assertActive);
        return {
            server,
            profile: {name: profile.name, endpoint: profile.endpoint, warnings: getProfileWarnings(profile)},
            tools,
            prompts,
            resourceTemplates,
            durationMs: Date.now() - startedAt
        };
    });
}

export const discoverCapabilities = inspectServer;

export async function doctor(options = {}) {
    return await executeRemote('doctor', '', {...options, risk: 'read'}, async ({client, server, profile, assertActive}) => {
        const startedAt = Date.now();
        const tools = await collectPages(client, 'listTools', 'tools', assertActive);
        const prompts = await collectPages(client, 'listPrompts', 'prompts', assertActive);
        const resourceTemplates = await collectPages(client, 'listResourceTemplates', 'resourceTemplates', assertActive);
        return {
            ok: true,
            server,
            profile: {name: profile.name, endpoint: profile.endpoint, warnings: getProfileWarnings(profile)},
            capabilities: {
                tools: tools.length,
                prompts: prompts.length,
                resourceTemplates: resourceTemplates.length
            },
            durationMs: Date.now() - startedAt
        };
    });
}

export async function listTools(options = {}) {
    return await executeRemote('tools.list', '', {...options, risk: 'read'}, async ({client, server, assertActive}) => ({
        server,
        tools: await collectPages(client, 'listTools', 'tools', assertActive)
    }));
}

export async function getTool(name, options = {}) {
    return await executeRemote('tools.show', name, {...options, risk: 'read'}, async ({client, server, assertActive}) => {
        const tools = await collectPages(client, 'listTools', 'tools', assertActive);
        const tool = tools.find(item => item.name === name);
        if (!tool) {
            throw new SlothVaultMcpError(`Tool not found: ${name}.`, {
                code: 'TOOL_NOT_FOUND', category: 'usage', exitCode: 2
            });
        }
        return {server, tool};
    });
}

export async function callTool(name, args = {}, options = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new SlothVaultMcpError('Tool arguments must be a JSON object.', {
            code: 'INVALID_ARGUMENTS', category: 'usage', exitCode: 2
        });
    }

    return await executeRemote('tools.call', name, options, async ({client, server, profile, signal, assertActive}, context) => {
        // Step 0: Discover the live Tool declaration on this exact connection.
        const tools = await collectPages(client, 'listTools', 'tools', assertActive);
        const tool = tools.find(item => item.name === name);
        if (!tool) {
            throw new SlothVaultMcpError(`Tool not found: ${name}.`, {
                code: 'TOOL_NOT_FOUND', category: 'usage', exitCode: 2
            });
        }
        const risk = tool.annotations?.readOnlyHint === true ? 'read' : 'write';
        context.risk = risk;

        // Step 1: Require an affirmative callback for every non-read-only Tool.
        if (risk === 'write') {
            if (typeof options.confirm !== 'function') {
                throw new SlothVaultMcpError(`Confirmation is required for write Tool: ${name}.`, {
                    code: 'CONFIRMATION_REQUIRED', category: 'confirmation', exitCode: 2
                });
            }
            const confirmed = await options.confirm({
                tool,
                risk,
                arguments: redactSensitive(args),
                argumentsSummary: createHistorySummary(args),
                signal
            });
            assertActive();
            if (confirmed !== true) {
                throw new SlothVaultMcpError(`Tool call was not confirmed: ${name}.`, {
                    code: 'CONFIRMATION_DECLINED', category: 'confirmation', exitCode: 2
                });
            }
        }

        // Step 2: Execute once and surface MCP business errors distinctly.
        const startedAt = Date.now();
        assertActive();
        const result = await client.callTool({name, arguments: args});
        assertActive();
        if (result?.isError === true) {
            throw new SlothVaultMcpBusinessError(`SlothVault Tool reported an error: ${name}.`, result, {secrets: [profile.apiKey]});
        }
        return {server, tool, result, risk, durationMs: Date.now() - startedAt};
    });
}

export async function listPrompts(options = {}) {
    return await executeRemote('prompts.list', '', {...options, risk: 'read'}, async ({client, server, assertActive}) => ({
        server,
        prompts: await collectPages(client, 'listPrompts', 'prompts', assertActive)
    }));
}

export async function getPrompt(name, args = {}, options = {}) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new SlothVaultMcpError('Prompt arguments must be a JSON object.', {
            code: 'INVALID_ARGUMENTS', category: 'usage', exitCode: 2
        });
    }
    return await executeRemote('prompts.get', name, {...options, risk: 'read'}, async ({client, server, assertActive}) => {
        // Step 0: Require the prompt to exist in the live discovered catalog.
        const prompts = await collectPages(client, 'listPrompts', 'prompts', assertActive);
        const prompt = prompts.find(item => item.name === name);
        if (!prompt) {
            throw new SlothVaultMcpError(`Prompt not found: ${name}.`, {
                code: 'PROMPT_NOT_FOUND', category: 'usage', exitCode: 2
            });
        }

        // Step 1: Fetch standard MCP messages without interpreting or executing them.
        assertActive();
        const result = await client.getPrompt({name, arguments: args});
        assertActive();
        return {server, prompt, result};
    });
}

export async function listResourceTemplates(options = {}) {
    return await executeRemote('resources.list', '', {...options, risk: 'read'}, async ({client, server, assertActive}) => ({
        server,
        resourceTemplates: await collectPages(client, 'listResourceTemplates', 'resourceTemplates', assertActive)
    }));
}

export const listResources = listResourceTemplates;

/** Parses and constrains a SlothVault Resource URI to one supported protected namespace. */
function resourcePolicy(uri) {
    let parsed;
    try {
        parsed = new URL(uri);
    } catch {
        throw new SlothVaultMcpError('Resource URI is invalid.', {
            code: 'INVALID_RESOURCE_URI', category: 'usage', exitCode: 2
        });
    }
    if (parsed.protocol !== 'slothvault:' || !['managed-file', 'contract-attachment'].includes(parsed.hostname)) {
        throw new SlothVaultMcpError('Resource URI must use a supported SlothVault protected resource prefix.', {
            code: 'UNSUPPORTED_RESOURCE_URI', category: 'usage', exitCode: 2
        });
    }
    if (
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.search ||
        parsed.hash ||
        !/^\/[1-9][0-9]*$/u.test(parsed.pathname)
    ) {
        throw new SlothVaultMcpError('Resource URI must contain one positive decimal identifier.', {
            code: 'INVALID_RESOURCE_URI', category: 'usage', exitCode: 2
        });
    }
    const canonical = parsed.href;
    if (parsed.hostname === 'managed-file') {
        return {uri: canonical, maxBytes: MANAGED_FILE_MAX_BYTES, requiredMimeType: null};
    }
    if (parsed.hostname === 'contract-attachment') {
        return {uri: canonical, maxBytes: CONTRACT_ATTACHMENT_MAX_BYTES, requiredMimeType: 'application/pdf'};
    }
    throw new SlothVaultMcpError('Resource URI is unsupported.', {
        code: 'UNSUPPORTED_RESOURCE_URI', category: 'usage', exitCode: 2
    });
}

/** Decodes strict standard Base64 after enforcing the policy's encoded and decoded limits. */
function decodeResourceBlob(blob, maxBytes) {
    if (typeof blob !== 'string' || !blob) {
        throw new SlothVaultMcpError('Resource blob is empty.', {
            code: 'INVALID_RESOURCE_BLOB', category: 'protocol', exitCode: 4
        });
    }
    if (blob.length > Math.ceil(maxBytes / 3) * 4) {
        throw new SlothVaultMcpError('Encoded Resource exceeds its size limit.', {
            code: 'RESOURCE_TOO_LARGE', category: 'protocol', exitCode: 4
        });
    }

    const paddingLength = blob.endsWith('==') ? 2 : blob.endsWith('=') ? 1 : 0;
    const dataLength = blob.length - paddingLength;
    let valid = blob.length % 4 === 0 && dataLength > 0;
    for (let index = 0; valid && index < dataLength; index += 1) {
        const code = blob.charCodeAt(index);
        valid = (code >= 65 && code <= 90)
            || (code >= 97 && code <= 122)
            || (code >= 48 && code <= 57)
            || code === 43
            || code === 47;
    }
    for (let index = dataLength; valid && index < blob.length; index += 1) {
        valid = blob.charCodeAt(index) === 61;
    }
    if (!valid) {
        throw new SlothVaultMcpError('Resource blob is not valid Base64.', {
            code: 'INVALID_RESOURCE_BLOB', category: 'protocol', exitCode: 4
        });
    }
    const buffer = Buffer.from(blob, 'base64');
    if (buffer.length === 0 || buffer.length > maxBytes) {
        throw new SlothVaultMcpError('Decoded Resource exceeds its size limit.', {
            code: 'RESOURCE_TOO_LARGE', category: 'protocol', exitCode: 4
        });
    }
    if (buffer.toString('base64') !== blob) {
        throw new SlothVaultMcpError('Resource blob is not canonical Base64.', {
            code: 'INVALID_RESOURCE_BLOB', category: 'protocol', exitCode: 4
        });
    }
    return buffer;
}

/** Validates the singular binary Resource response and returns safe file metadata. */
function validatedResourceContent(result, policy) {
    if (!result || !Array.isArray(result.contents) || result.contents.length !== 1) {
        throw new SlothVaultMcpError('Expected exactly one Resource content item.', {
            code: 'INVALID_RESOURCE_RESPONSE', category: 'protocol', exitCode: 4
        });
    }
    const content = result.contents[0];
    if (content.uri !== policy.uri || typeof content.blob !== 'string' || typeof content.mimeType !== 'string') {
        throw new SlothVaultMcpError('Resource response metadata does not match the request.', {
            code: 'INVALID_RESOURCE_RESPONSE', category: 'protocol', exitCode: 4
        });
    }
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/u.test(content.mimeType)) {
        throw new SlothVaultMcpError('Resource response contains an invalid MIME type.', {
            code: 'INVALID_RESOURCE_MIME', category: 'protocol', exitCode: 4
        });
    }
    if (policy.requiredMimeType && content.mimeType.toLowerCase() !== policy.requiredMimeType) {
        throw new SlothVaultMcpError(`Resource MIME type must be ${policy.requiredMimeType}.`, {
            code: 'INVALID_RESOURCE_MIME', category: 'protocol', exitCode: 4
        });
    }
    const metadataFileName = content._meta && typeof content._meta === 'object'
        ? content._meta[RESOURCE_FILE_NAME_META_KEY]
        : undefined;
    const fileName = String(metadataFileName || content.name || '');
    if (!fileName || fileName === '.' || fileName === '..' || fileName.length > 255 || /[\\/\0]/u.test(fileName)) {
        throw new SlothVaultMcpError('Resource response contains an invalid file name.', {
            code: 'INVALID_RESOURCE_NAME', category: 'protocol', exitCode: 4
        });
    }
    return {content, fileName, buffer: decodeResourceBlob(content.blob, policy.maxBytes)};
}

/** Publishes a complete temporary file to a previously absent target without overwrite races. */
function writeExclusiveAtomic(outputPath, buffer) {
    const targetPath = path.resolve(outputPath);
    const directory = path.dirname(targetPath);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        throw new SlothVaultMcpError(`Output directory does not exist: ${directory}.`, {
            code: 'OUTPUT_DIRECTORY_NOT_FOUND', category: 'usage', exitCode: 2
        });
    }
    const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        // Step 0: Fully materialize a private temporary file in the target directory.
        fs.writeFileSync(temporaryPath, buffer, {flag: 'wx', mode: 0o600});

        // Step 1: Hard-link publication is atomic and fails if the requested target exists.
        fs.linkSync(temporaryPath, targetPath);
        try {
            fs.chmodSync(targetPath, 0o600);
        } catch {
            // Best effort on platforms without POSIX permissions.
        }

        // Step 2: Remove the temporary name while retaining the fully written target link.
        fs.unlinkSync(temporaryPath);
        return targetPath;
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, {force: true});
        } catch {
            // Preserve the original filesystem error.
        }
        if (error?.code === 'EEXIST') {
            throw new SlothVaultMcpError(`Output file already exists: ${targetPath}.`, {
                code: 'OUTPUT_EXISTS', category: 'usage', exitCode: 2, cause: error
            });
        }
        if (error instanceof SlothVaultMcpError) {
            throw error;
        }
        throw new SlothVaultMcpError(`Unable to save Resource: ${error.message}`, {
            code: 'RESOURCE_WRITE_FAILED', category: 'internal', exitCode: 1, cause: error
        });
    }
}

/** Rejects unusable or already occupied output paths before issuing a remote read. */
function assertOutputTarget(outputPath) {
    const targetPath = path.resolve(outputPath);
    const directory = path.dirname(targetPath);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        throw new SlothVaultMcpError(`Output directory does not exist: ${directory}.`, {
            code: 'OUTPUT_DIRECTORY_NOT_FOUND', category: 'usage', exitCode: 2
        });
    }
    if (fs.existsSync(targetPath)) {
        throw new SlothVaultMcpError(`Output file already exists: ${targetPath}.`, {
            code: 'OUTPUT_EXISTS', category: 'usage', exitCode: 2
        });
    }
    return targetPath;
}

export async function readResource(uri, outputPathOrOptions, maybeOptions = {}) {
    const callOptions = outputPathOrOptions && typeof outputPathOrOptions === 'object'
        ? outputPathOrOptions
        : maybeOptions;
    const outputPath = typeof outputPathOrOptions === 'string'
        ? outputPathOrOptions
        : outputPathOrOptions?.outputPath || outputPathOrOptions?.output;
    if (!outputPath) {
        throw new SlothVaultMcpError('Resource output path is required.', {
            code: 'OUTPUT_REQUIRED', category: 'usage', exitCode: 2
        });
    }
    const policy = resourcePolicy(uri);
    const targetPath = assertOutputTarget(outputPath);

    return await executeRemote('resources.read', policy.uri, {...callOptions, risk: 'read'}, async ({client, server, assertActive}) => {
        // Step 0: Read one protected Resource without retrying the remote operation.
        assertActive();
        const result = await client.readResource({uri: policy.uri});
        assertActive();

        // Step 1: Validate URI, MIME, Base64 and byte size before touching the destination.
        const {content, fileName, buffer} = validatedResourceContent(result, policy);

        // Step 2: Publish the complete file only if the destination does not already exist.
        assertActive();
        const savedPath = writeExclusiveAtomic(targetPath, buffer);
        return {
            server,
            uri: policy.uri,
            path: savedPath,
            mimeType: content.mimeType,
            fileName,
            bytes: buffer.length
        };
    });
}

export default {
    callTool,
    classifyError,
    discoverCapabilities,
    doctor,
    getPrompt,
    getTool,
    inspectServer,
    listPrompts,
    listResourceTemplates,
    listResources,
    listTools,
    readResource
};
