/**
 * @file protocol.ts
 * @project SlothVault
 * @module Plugin Protocol v1
 * @description Defines portable packages, bilingual display metadata, navigation icons and native SOL/Mainnet USDT settlement contracts.
 * @logic Validate metadata without importing executable code; keep browser metadata separate from server configuration.
 * @dependencies zod, semver
 * @index_tags plugins,sdk,manifest,permissions
 * @author holic512
 */
import { z } from 'zod'
import semver from 'semver'

export const PLUGIN_API_VERSION = '1.3.0'
export const GIFT_CARDS_PLUGIN_ID = 'slothvault.gift-cards'
export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(100)
export const assetPathSchema = z.string().max(200).refine(value => /^[a-zA-Z0-9_./-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..'), 'Invalid package path')
const version = z.string().refine(value => !!semver.valid(value), 'Invalid SemVer')
const range = z.string().refine(value => !!semver.validRange(value), 'Invalid version range')
export const audienceSchema = z.enum(['admin', 'user', 'public', 'memberships'])
export const accessSchema = z.object({ audience: audienceSchema.default('admin'), membershipLevelIds: z.array(z.number().int().positive()).max(100).default([]) }).strict()
export const CORE_TABLES: Record<string, string> = { users: 'auth_user', articles: 'blog_article', projects: 'collections_project', projectVersions: 'collections_project_version', categories: 'collections_category', noteInfos: 'docs_note_info', noteContents: 'docs_note_content', fileManagements: 'files_file_management', membershipLevels: 'membership_level', contracts: 'contract' }
export const columnSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
  type: z.enum(['string', 'text', 'integer', 'bigint', 'boolean', 'datetime', 'json', 'binary']),
  nullable: z.boolean().default(false), primary: z.boolean().default(false), generated: z.boolean().default(false),
  length: z.number().int().min(1).max(2000).optional(),
  references: z.object({ table: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), column: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/), onDelete: z.enum(['CASCADE', 'SET NULL']), coreCollection: z.string().max(50).optional(), attributionField: z.string().max(50).optional() }).strict().optional(),
}).strict()
export const tableSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  columns: z.array(columnSchema).min(1).max(100),
  indexes: z.array(z.object({ columns: z.array(z.string()).min(1), unique: z.boolean().default(false) }).strict()).max(30).default([]),
}).strict().superRefine((table, ctx) => {
  const names = table.columns.map(c => c.name)
  if (new Set(names).size !== names.length || table.columns.filter(c => c.primary).length !== 1) ctx.addIssue({ code: 'custom', message: 'Tables need unique columns and one primary key' })
  for (const index of table.indexes) if (index.columns.some(name => !names.includes(name))) ctx.addIssue({ code: 'custom', message: 'Index column does not exist' })
  for (const col of table.columns) {
    if (col.primary && (col.nullable || !['integer', 'bigint', 'string'].includes(col.type))) ctx.addIssue({ code: 'custom', message: 'Portable primary keys must be non-null integer, bigint or string' })
    if (col.generated && (!col.primary || col.type !== 'integer')) ctx.addIssue({ code: 'custom', message: 'Generated columns must be integer primary keys' })
  }
  for (const col of table.columns) if (col.references?.onDelete === 'SET NULL' && !col.nullable) ctx.addIssue({ code: 'custom', message: 'SET NULL requires a nullable column' })
})
/** Protocol v1 intentionally excludes cyclic/self foreign keys and undeclared DB objects. */
export function assertPortableTableGraph(tables: PluginTable[]) {
  const names = new Set(tables.map(t => t.name))
  if (names.size !== tables.length) throw new Error('Duplicate table name')
  const visited = new Set<string>(), visiting = new Set<string>()
  const visit = (table: PluginTable) => {
    if (visiting.has(table.name)) throw new Error('Cyclic/self foreign keys are unsupported in protocol v1')
    if (visited.has(table.name)) return
    visiting.add(table.name)
    for (const col of table.columns) if (col.references) {
      const ref = col.references
      if (ref.coreCollection) {
        if (CORE_TABLES[ref.coreCollection] !== ref.table || ref.column !== 'id' || col.type !== 'integer') throw new Error('Core references require a declared collection integer ID')
      } else {
        const target = tables.find(t => t.name === ref.table)
        const pk = target?.columns.find(c => c.primary)
        if (!target || !pk || pk.name !== ref.column || pk.type !== col.type) throw new Error('Foreign keys must reference a matching owned primary key')
        visit(target)
      }
      if (ref.attributionField && (ref.coreCollection !== 'users' || !table.columns.some(c => c.name === 'attribution_json' && ['json', 'text'].includes(c.type)))) throw new Error('User attribution requires an attribution_json text/JSON column')
    }
    visiting.delete(table.name); visited.add(table.name)
  }
  for (const table of tables) visit(table)
}
const localizedText = z.object({ zh: z.string().max(2000), en: z.string().max(2000) }).strict()
export const pluginDisplaySchema = z.object({
  name: localizedText.optional(), description: localizedText.optional(),
  config: z.record(z.string(), z.object({ label: localizedText, description: localizedText.optional(), placeholder: localizedText.optional() }).strict()).optional(),
}).strict()
export const pluginIconSchema = z.enum(['blocks', 'coins', 'ticket', 'wallet', 'settings'])
export const pluginManifestSchema = z.object({
  schema: z.literal(1), id: pluginIdSchema, name: z.string().min(1).max(100), version,
  display: pluginDisplaySchema.optional(),
  description: z.string().max(2000).default(''), author: z.string().max(200),
  engines: z.object({ slothvault: range, sdk: range, node: range }).strict(),
  server: assetPathSchema.refine(path => path.startsWith('server/') && path.endsWith('.mjs'), 'Backend entry must be server/*.mjs').optional(), capabilities: z.array(z.enum(['database', 'points.credit', 'points.credit.background', 'market.read', 'solana.transfer', 'users.read', 'events', 'services'])).max(20).default([]),
  dependencies: z.record(pluginIdSchema, range).default({}),
  configSchema: z.record(z.string(), z.unknown()).default({ type: 'object', properties: {}, additionalProperties: false }),
  configDefaults: z.record(z.string(), z.unknown()).default({}), secretFields: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(30).default([]),
  tables: z.array(tableSchema).max(30).default([]), migrations: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).max(100).default([]),
  api: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/), path: z.string().regex(/^[a-z0-9][a-z0-9/-]{0,100}$/), method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']), access: accessSchema.default({ audience: 'admin', membershipLevelIds: [] }) }).strict()).max(100).default([]),
  services: z.array(z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,79}$/)).max(50).default([]),
  events: z.array(z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,99}$/)).max(50).default([]),
  jobs: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/), intervalSeconds: z.number().int().min(60).max(2_592_000) }).strict()).max(20).default([]),
  ui: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9.-]{0,79}$/), asset: assetPathSchema.refine(path => path.startsWith('client/') && path.endsWith('.js'), 'UI entry must be client/*.js'), css: assetPathSchema.refine(path => path.startsWith('client/') && path.endsWith('.css'), 'UI CSS must be client/*.css').optional(),
    surface: z.enum(['admin', 'account', 'public']), wallet: z.boolean().optional(), kind: z.enum(['page', 'slot']),
    icon: pluginIconSchema.optional(), title: z.string().min(1).max(100), titleZh: z.string().max(100).optional(),
    path: z.string().regex(/^[a-z0-9/-]*$/).default(''), menu: z.boolean().default(false),
    slot: z.enum(['admin.dashboard.cards', 'admin.article.actions', 'account.points', 'public.home.before', 'public.home.after']).optional(),
    access: accessSchema.default({ audience: 'admin', membershipLevelIds: [] }), order: z.number().int().min(-1000).max(1000).default(0),
  }).strict()).max(100).default([]),
}).strict().superRefine((manifest, ctx) => {
  try { assertPortableTableGraph(manifest.tables) } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }) }
  if (new Set(manifest.api.map(a => `${a.method}:${a.path}`)).size !== manifest.api.length) ctx.addIssue({ code: 'custom', message: 'Duplicate API route' })
  for (const values of [manifest.api.map(a => a.key), manifest.ui.map(a => a.key), manifest.tables.map(a => a.name), manifest.migrations, manifest.jobs.map(job => job.key), manifest.events, manifest.services]) if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'Duplicate contribution key' })
  if (new Set(manifest.ui.map(ui => ui.asset)).size !== manifest.ui.length) ctx.addIssue({ code: 'custom', message: 'Each UI contribution needs its own entry asset' })
  if (manifest.ui.some(ui => ui.kind === 'slot' && !ui.slot)) ctx.addIssue({ code: 'custom', message: 'Slot contribution requires a slot name' })
  if (!manifest.server && (manifest.api.length || manifest.services.length || manifest.events.length || manifest.jobs.length || manifest.migrations.length)) ctx.addIssue({ code: 'custom', message: 'Backend contributions require a server entrypoint' })
  if (manifest.capabilities.includes('points.credit.background') && !manifest.capabilities.includes('points.credit')) ctx.addIssue({ code: 'custom', message: 'Background point credits require points.credit capability' })
  if (manifest.events.length && !manifest.capabilities.includes('events')) ctx.addIssue({ code: 'custom', message: 'Event subscriptions require events capability' })
  if (manifest.tables.length && !manifest.capabilities.includes('database')) ctx.addIssue({ code: 'custom', message: 'Tables require database capability' })
})
export type PluginManifest = z.infer<typeof pluginManifestSchema>
export type PluginTable = z.infer<typeof tableSchema>
export type PluginAccess = z.infer<typeof accessSchema>
export type PluginActor = { userId: number; role: string } | null
export type PluginUi = PluginManifest['ui'][number] & { pluginId: string; version: string; digest: string }
export type PluginInvocation = { actor: PluginActor; input?: unknown; query?: Record<string, string>; params?: string[] }
export type PluginListItem = { id: string; name: string; description: string; version: string; installed: boolean; enabled: boolean; generation: number; digest: string; codeState: 'PRESENT' | 'MISSING'; runtime: string; error: string | null; retainedTables: number; manifest: PluginManifest; source: string | null; updatedAt: string }

export type MarketQuote = { base: 'SOL'; quote: 'USDT'; price: string; provider: 'okx' | 'bitget'; observedAt: string; fetchedAt: string }
export type SolTransferIntent = { orderId: string; payer: string; recipient: string; network: 'mainnet' } & (
  { asset?: 'SOL'; lamports: string } | { asset: 'USDT'; tokenAmount: string }
)
export type PreparedSolTransfer = SolTransferIntent & { transactionBase64: string; messageHash: string; blockhash: string; lastValidBlockHeight: number }
export type SolTransferObservation = { status: 'FINALIZED' | 'FAILED' | 'PENDING' | 'EXPIRED'; slot?: number }

export type PluginRelease = { repository: string; tag: string; asset: string; notes: string; size: number; version: string }
export type PluginUpdateInfo = { currentVersion: string; status: 'available' | 'current' | 'manual' | 'noRelease'; release: PluginRelease | null; checkedAt: string }
