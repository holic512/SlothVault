/**
 * @file business-error.js
 * @project SlothVault
 * @module SlothVault Business Errors
 * @description Preserves actionable server conflicts while excluding payloads and credentials.
 * @logic Decode the MCP error envelope, allowlist reason/IDs/issues, and bound and redact all text.
 * @dependencies none
 * @index_tags mcp,error,redaction
 * @author holic512
 */
function safeText(value, secrets = []) {
    let text = String(value ?? '');
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[redacted]');
    return text.replace(/svmcp_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[redacted]')
        .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]')
        .replace(/\b(password|token|secret|api[-_]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
        .replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 512);
}
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value);
export function businessErrorDetails(result, secrets = []) {
    let error = result?.structuredContent?.error;
    if (!error) {
        for (const item of result?.content || []) {
            if (item.type !== 'text') continue;
            try { error = JSON.parse(item.text)?.error; } catch { /* No structured server error. */ }
            if (error) break;
        }
    }
    if (!error || typeof error !== 'object') return {};
    const details = {};
    if (Number.isInteger(error.status)) details.status = error.status;
    if (Number.isInteger(error.code)) details.serverCode = error.code;
    if (typeof error.message === 'string') details.serverMessage = safeText(error.message, secrets);
    const data = error.data || {};
    if (typeof data.reason === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(data.reason)) details.reason = data.reason;
    for (const field of ['projectId', 'projectVersionId', 'targetVersionId', 'categoryId', 'noteInfoId', 'noteContentId', 'articleId']) {
        if (identifier(String(data[field] ?? ''))) details[field] = String(data[field]);
    }
    if (Array.isArray(data.issues)) details.issues = data.issues.slice(0, 100).flatMap(issue => {
        if (!identifier(issue?.code) || !identifier(issue?.entity) || !identifier(issue?.entityId)) return [];
        return [{code: issue.code, entity: issue.entity, entityId: issue.entityId, message: safeText(issue.message, secrets)}];
    });
    return details;
}
