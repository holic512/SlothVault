/**
 * @file server.ts
 * @project SlothVault
 * @module Plugin Server SDK
 * @description Exposes a Kysely driver over the authenticated worker-to-host transaction bridge.
 * @logic Compile portable SQL in the plugin worker; let the host own transactions, market quotes and fixed SOL transfers.
 * @dependencies Kysely, Node worker messaging supplied by the host
 * @index_tags plugins,sdk,transactions,kysely,worker
 * @author holic512
 */
import { Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type CompiledQuery, type DatabaseConnection, type Dialect, type Driver, type QueryResult } from 'kysely'
import type { PluginInvocation, PluginManifest, MarketQuote, SolTransferIntent, PreparedSolTransfer, SolTransferObservation } from './protocol'
export { sql } from 'kysely'
export type { PluginManifest, PluginInvocation, MarketQuote, SolTransferIntent, PreparedSolTransfer, SolTransferObservation } from './protocol'
export type HostCall = (method: string, payload?: unknown) => Promise<unknown>
export type PluginContext = {
  manifest: PluginManifest; config: Record<string, unknown>; provider: 'sqlite' | 'mysql' | 'postgresql'
  db: Kysely<Record<string, Record<string, unknown>>>
  table(name: string): string
  marketData: { quote(): Promise<MarketQuote> }
  solana: {
    validateIntent(input: SolTransferIntent): Promise<void>
    prepare(input: SolTransferIntent): Promise<PreparedSolTransfer>
    validateSigned(input: { prepared: PreparedSolTransfer; signedTransaction: string }): Promise<{ signature: string }>
    broadcast(input: { prepared: PreparedSolTransfer; signedTransaction: string }): Promise<{ signature: string }>
    observe(input: { prepared: PreparedSolTransfer; signature?: string }): Promise<SolTransferObservation>
  }
  points: { credit(input: { userId: number; amount: number; sourceKey: string; description: string; referenceId?: string; type?: string }, transaction?: Kysely<Record<string, Record<string, unknown>>>): Promise<{ pointsBalance: number; replayed: boolean }> }
  users: { snapshot(userId: number): Promise<{ username: string; displayName: string | null; role: string; userId: string; installationId: string | null }> }
  emit(event: string, payload: unknown, transaction?: Kysely<Record<string, Record<string, unknown>>>): Promise<void>
  service(pluginId: string, service: string, input: unknown): Promise<unknown>
}
export type PluginTaskContext = { id: string; attempt: number; scheduledAt: string }
export type PluginServer = {
  api?: Record<string, (input: PluginInvocation) => Promise<unknown>>
  services?: Record<string, (input: PluginInvocation) => Promise<unknown>>
  events?: Record<string, (payload: unknown, task: PluginTaskContext) => Promise<void>>
  jobs?: Record<string, (task: PluginTaskContext) => Promise<void>>
  migrations?: Record<string, () => Promise<void>>
  onInstall?(): Promise<void>; onEnable?(): Promise<void>; onDisable?(): Promise<void>; onUninstall?(): Promise<void>; onUpgrade?(): Promise<void>; dispose?(): Promise<void>
}
export function definePlugin(factory: (context: PluginContext) => PluginServer | Promise<PluginServer>) { return factory }

class RemoteConnection implements DatabaseConnection {
  transactionId?: string
  constructor(readonly call: HostCall) {}
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    return await this.call('db.query', { sql: query.sql, parameters: query.parameters, kind: query.query.kind, ast: query.query, transactionId: this.transactionId }) as QueryResult<R>
  }
  async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> { void query; throw new Error('Streaming is not part of plugin SQL API v1') }
}
class RemoteDriver implements Driver {
  constructor(readonly call: HostCall) {}
  async init() {}
  async acquireConnection() { return new RemoteConnection(this.call) }
  async releaseConnection() {}
  async beginTransaction(connection: RemoteConnection) { connection.transactionId = await this.call('db.begin') as string }
  async commitTransaction(connection: RemoteConnection) { await this.call('db.commit', { transactionId: connection.transactionId }); connection.transactionId = undefined }
  async rollbackTransaction(connection: RemoteConnection) { await this.call('db.rollback', { transactionId: connection.transactionId }); connection.transactionId = undefined }
  async destroy() {}
}
export function createPluginContext(input: { manifest: PluginManifest; config: Record<string, unknown>; provider: PluginContext['provider']; tables: Record<string, string> }, call: HostCall): PluginContext {
  const dialects = {
    postgresql: { adapter: PostgresAdapter, compiler: PostgresQueryCompiler, introspector: PostgresIntrospector },
    mysql: { adapter: MysqlAdapter, compiler: MysqlQueryCompiler, introspector: MysqlIntrospector },
    sqlite: { adapter: SqliteAdapter, compiler: SqliteQueryCompiler, introspector: SqliteIntrospector },
  }
  const d = dialects[input.provider]
  const dialect: Dialect = { createAdapter: () => new d.adapter(), createQueryCompiler: () => new d.compiler(), createDriver: () => new RemoteDriver(call), createIntrospector: db => new d.introspector(db) }
  const db = new Kysely<Record<string, Record<string, unknown>>>({ dialect })
  // Kysely's connection provider preserves the current transaction connection.
  const credit = async (values: Parameters<PluginContext['points']['credit']>[0], transaction?: Kysely<Record<string, Record<string, unknown>>>) => {
    const executor = (transaction ?? db).getExecutor()
    return executor.provideConnection(async connection => call('points.credit', { ...values, transactionId: (connection as RemoteConnection).transactionId })) as Promise<{ pointsBalance: number; replayed: boolean }>
  }
  return { ...input, db,
    marketData: { quote: () => call('market.quote') as Promise<MarketQuote> },
    solana: {
      validateIntent: values => call('solana.validateIntent', values) as Promise<void>,
      prepare: values => call('solana.prepare', values) as Promise<PreparedSolTransfer>,
      validateSigned: values => call('solana.validateSigned', values) as Promise<{ signature: string }>,
      broadcast: values => call('solana.broadcast', values) as Promise<{ signature: string }>,
      observe: values => call('solana.observe', values) as Promise<SolTransferObservation>,
    }, table: name => { const table = input.tables[name]; if (!table) throw new Error(`Undeclared plugin table: ${name}`); return table }, points: { credit }, users: { snapshot: userId => call('users.snapshot', { userId }) as ReturnType<PluginContext['users']['snapshot']> }, emit: async (event, payload, transaction) => { await (transaction ?? db).getExecutor().provideConnection(async connection => { await call('events.emit', { event, payload, transactionId: (connection as RemoteConnection).transactionId }) }) }, service: (pluginId, service, values) => call('services.call', { pluginId, service, input: values }) }
}
