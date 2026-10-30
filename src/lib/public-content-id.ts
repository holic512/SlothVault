/**
 * @file public-content-id.ts
 * @project SlothVault
 * @module Public Content Identity
 * @description Defines the canonical opaque identifiers accepted by public content routes.
 * @logic Share lowercase UUID v4 syntax without exposing database identity or server dependencies.
 * @dependencies None
 * @index_tags public-id,url,uuid
 * @author holic512
 */
export const PUBLIC_CONTENT_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
export const publicContentIdPattern = new RegExp(`^${PUBLIC_CONTENT_ID_PATTERN}$`)
