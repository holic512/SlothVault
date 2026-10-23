import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { PluginContext, PluginInvocation, PluginServer, PluginManifest } from '@slothvault/plugin-sdk/server'
import factory, { digest } from './server'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { DEFAULT_TEMPLATES, compatibleFields, missingTemplateFields, renderTemplate } from './templates'
import type { CommissionDetail, ContractTemplate, EvidencePrepared, PrivateFile } from './domain'

const admin = { userId: 1, role: 'ADMIN' }, customer = { userId: 2, role: 'USER' }, stranger = { userId: 3, role: 'USER' }
const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8')) as PluginManifest
let sql: Database.Database, ctx: PluginContext, server: PluginServer, observation: 'FINALIZED' | 'PENDING' | 'FAILED' | 'EXPIRED', files: Map<string, PrivateFile>
const invoke = async <T = {detail: CommissionDetail}>(key: string, input?: unknown, actor: PluginInvocation['actor'] = admin, query?: Record<string, string>): Promise<T> => server.api![key]({ actor, input, query }) as Promise<T>
const get = (id: string, actor = admin) => invoke<CommissionDetail>('detail', undefined, actor, { commissionId: id })
const create = async (actor = admin, extra = {}) => (await invoke('create', { commandId: randomUUID(), revision: 0, title: 'Example', description: 'Real requirements', customerId: customer.userId, ...extra }, actor)).detail
const cmd = async (view: CommissionDetail, action: string, data = {}, actor = admin) => (await invoke('command', { commissionId: view.commission.id, revision: view.commission.revision, commandId: randomUUID(), action, data }, actor)).detail
const prepare = async (view: CommissionDetail) => invoke<{detail: CommissionDetail; attempt: {id: string; prepared: EvidencePrepared}}>('prepare', { commissionId: view.commission.id, evidenceId: view.pendingAction!.id, revision: view.commission.revision, commandId: randomUUID(), signerAddress: 'A'.repeat(44) })
const submitted = async (view: CommissionDetail) => {
  const prepared = await prepare(view)
  return (await invoke('submit', { commissionId: view.commission.id, evidenceId: view.pendingAction!.id, attemptId: prepared.attempt.id, revision: prepared.detail.commission.revision, commandId: randomUUID(), signedTransactionBase64: 'signed' })).detail
}
const reconcile = async (view: CommissionDetail) => (await invoke('reconcile', { commissionId: view.commission.id, evidenceId: view.pendingAction!.id, revision: view.commission.revision, commandId: randomUUID() })).detail
const finalize = async (view: CommissionDetail) => reconcile(await submitted(view))
const completeFields = (template: ContractTemplate) => Object.fromEntries(template.fields.map(field => [field.key, field.type === 'number' ? 30 : field.type === 'boolean' ? true : `Agreed ${field.label}`]))
const publish = async (view: CommissionDetail, template = DEFAULT_TEMPLATES[0]) => {
  const fields = completeFields(template)
  if (template.kind === 'SUPPLEMENT') fields.baseContractId = view.commission.contracts.find(item => item.kind === 'MAIN' && item.effectiveAt)!.id
  view = await cmd(view, 'save-contract', { draft: { templateId: template.id, kind: template.kind, title: template.title, fields, body: renderTemplate(template, fields) } })
  return finalize(await cmd(view, 'publish-contract', { fileIds: [] }))
}
const ready = async () => {
  let view = await create()
  view = await finalize(await cmd(view, 'submit-request', { fileIds: [] }))
  view = await cmd(view, 'accept')
  view = await publish(view)
  return finalize(await cmd(view, 'confirm-contract', { contractId: view.commission.contracts[0].id }, customer))
}
const upload = async (view: CommissionDetail, purpose: string, actor = admin) => {
  const file: PrivateFile = { id: randomUUID(), name: '../private.txt', size: '12', sha256: 'a'.repeat(64), createdAt: new Date().toISOString() }; files.set(file.id, file)
  const query = { commissionId: view.commission.id, commandId: randomUUID(), revision: String(view.commission.revision), purpose }
  await invoke('upload', { phase: 'authorize' }, actor, query)
  const result = await invoke('upload', { phase: 'complete', upload: file }, actor, query)
  return { view: result.detail, file, query }
}

beforeEach(async () => {
  sql = new Database(':memory:'); sql.pragma('foreign_keys = ON')
  sql.exec('CREATE TABLE auth_user (id INTEGER PRIMARY KEY); INSERT INTO auth_user VALUES (1), (2), (3);')
  for (const table of manifest.tables) {
    const columns = table.columns.map(col => `${col.name} ${col.type === 'integer' ? 'INTEGER' : 'TEXT'}${col.primary ? ' PRIMARY KEY' : ''}${col.nullable ? '' : ' NOT NULL'}${col.references ? ` REFERENCES ${col.references.table}(${col.references.column}) ON DELETE ${col.references.onDelete}` : ''}`)
    sql.exec(`CREATE TABLE ${table.name} (${columns.join(',')})`)
    for (const [i, index] of table.indexes.entries()) sql.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${table.name}_${i} ON ${table.name}(${index.columns.join(',')})`)
  }
  files = new Map(); observation = 'FINALIZED'
  ctx = {
    manifest, provider: 'sqlite', config: { providerName: 'Provider' }, table: (name: string) => name,
    db: new Kysely({ dialect: new SqliteDialect({ database: sql }) }),
    users: { find: vi.fn(async ({userId}: {userId?: number}) => [admin, customer, stranger].filter(actor => !userId || actor.userId === userId).map(actor => ({ id: actor.userId, username: `u${actor.userId}`, displayName: null, role: actor.role, status: 1 }))), snapshot: vi.fn() },
    evidence: {
      prepare: vi.fn(async ({memo, signerAddress}) => ({ transactionBase64: 'unsigned', memo, signerAddress, messageHash: 'hash', blockhash: 'block', lastValidBlockHeight: '100', feeLamports: 5000, balanceLamports: 10000 })),
      validateSigned: vi.fn(async () => ({signature: randomUUID()})), broadcast: vi.fn(async () => ({signature: 'same'})), observe: vi.fn(async () => ({status: observation, blockTime: '2026-01-01T00:00:00.000Z'})),
    },
    files: { inspect: vi.fn(async id => files.get(id)!), ensure: vi.fn(async (ids: string[]) => ids.map(id => files.get(id)!)) },
  } as unknown as PluginContext
  server = await factory(ctx); await server.onInstall!()
})
afterEach(async () => { vi.useRealTimers(); await ctx.db.destroy() })

describe('commissions plugin', () => {
  it('installs eight real templates once, and GET never seeds', async () => {
    expect((await invoke<{list: ContractTemplate[]}>('templates')).list).toHaveLength(8)
    sql.prepare('UPDATE templates SET data_json = ? WHERE id = ?').run(JSON.stringify({...DEFAULT_TEMPLATES[0], title:'Custom'}), DEFAULT_TEMPLATES[0].id)
    await server.onInstall!()
    expect((await invoke<{list: ContractTemplate[]}>('templates')).list.some(item => item.title === 'Custom')).toBe(true)
    sql.exec('DELETE FROM templates')
    expect((await invoke<{list: ContractTemplate[]}>('templates')).list).toEqual([])
  })
  it('enforces request freeze, finality, contract confirmation, delivery and stable maintenance', async () => {
    let view = await create()
    view = await cmd(view, 'submit-request', {fileIds: []})
    expect(view.commission.stage).toBe('DRAFT')
    await expect(cmd(view, 'accept')).rejects.toThrow('ACTION_NOT_ALLOWED')
    view = await finalize(view); expect(view.commission.stage).toBe('REQUESTED')
    view = await cmd(view, 'accept'); view = await publish(view)
    expect(view.commission.stage).toBe('AWAITING_CONFIRMATION')
    view = await cmd(view, 'confirm-contract', {contractId:view.commission.contracts[0].id}, customer)
    expect(view.commission.stage).toBe('AWAITING_CONFIRMATION')
    view = await finalize(view); expect(view.commission.stage).toBe('READY')
    view = await cmd(view, 'payment', {percent: 15, reason:'Deposit'})
    view = await cmd(view, 'start')
    const uploaded = await upload(view, 'delivery'); view = uploaded.view
    view = await cmd(view, 'deliver', {description:'Release', fileIds:[uploaded.file.id]})
    const frozen = structuredClone(view.pendingAction!.snapshot)
    view = await finalize(view)
    expect(view.commission.stage).toBe('MAINTENANCE'); expect(view.commission.paymentPercent).toBe(15)
    expect(view.evidence.at(-1)!.snapshot).toEqual(frozen)
    const started = view.commission.maintenanceStartedAt
    server = await factory(ctx); await server.onEnable!()
    expect((await get(view.commission.id)).commission.maintenanceStartedAt).toBe(started)
    expect(new Date(started!).getTime()).toBeGreaterThan(new Date('2026-01-01').getTime())
  })
  it('rejects stale revisions and idempotency mismatches without side effects', async () => {
    const view = await create(), input = {commissionId:view.commission.id, commandId:randomUUID(), revision:0, action:'update-draft', data:{title:'New'}}
    const first = await invoke('command', input); expect(await invoke('command', input)).toEqual(first)
    await expect(invoke('command', {...input,data:{title:'Other'}})).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    await expect(cmd(view,'update-draft',{title:'Stale'})).rejects.toThrow('STALE_REVISION')
    expect((await get(view.commission.id)).commission.title).toBe('New')
  })
  it('keeps broadcast uncertainty durable, prevents withdrawal and lifecycle stop, then recovers', async () => {
    let view = await cmd(await create(),'submit-request',{fileIds:[]})
    vi.mocked(ctx.evidence.broadcast).mockRejectedValue(new Error('network unknown'))
    view = await submitted(view); expect(view.pendingAction!.status).toBe('SUBMITTED')
    await expect(cmd(view,'withdraw',{evidenceId:view.pendingAction!.id})).rejects.toThrow('ACTION_NOT_ALLOWED')
    await expect(server.onDisable!()).rejects.toThrow('Reconcile')
    await expect(server.onUninstall!()).rejects.toThrow('Reconcile')
    observation='PENDING'; await server.jobs!.reconcile({id:'job',attempt:1,scheduledAt:''})
    expect((await get(view.commission.id)).pendingAction!.status).toBe('SUBMITTED')
    server=await factory(ctx); observation='FINALIZED'; await server.onEnable!()
    expect((await get(view.commission.id)).commission.stage).toBe('REQUESTED')
    await expect(server.onDisable!()).resolves.toBeUndefined()
    expect(manifest.lifecycleGuards[0]).toMatchObject({table:'attempts',column:'status',values:['SUBMITTED']})
  })
  it.each(['FAILED','EXPIRED'] as const)('allows safe retry after authoritative %s', async status => {
    let view = await submitted(await cmd(await create(),'submit-request',{fileIds:[]}))
    observation=status; view=await reconcile(view)
    expect(view.pendingAction!.status).toBe(status); expect(view.commission.stage).toBe('DRAFT')
    const hash=view.pendingAction!.digest
    observation='FINALIZED'; view=await finalize(view)
    expect(view.commission.stage).toBe('REQUESTED'); expect(view.evidence[0].digest).toBe(hash)
  })
  it('resumes signing with the same attempt and preserves frozen contents after rejection or insufficient funds', async () => {
    let view=await cmd(await create(),'submit-request',{fileIds:[]})
    const original=ctx.evidence.prepare
    vi.mocked(ctx.evidence.prepare).mockImplementationOnce(async input => ({...await original(input),balanceLamports:0}))
    await expect(prepare(view)).rejects.toThrow('Insufficient SOL')
    expect((await get(view.commission.id)).pendingAction!.status).toBe('AWAITING_ADMIN')
    const first=await prepare(view), second=await prepare(first.detail)
    expect(first.attempt.id).toBe(second.attempt.id)
    view=await cmd(second.detail,'withdraw',{evidenceId:second.detail.pendingAction!.id})
    expect(view.pendingAction).toBeNull()
  })
  it('protects private drafts, explicitly selected attachments and public receipts', async () => {
    let view=await create()
    const hidden=await upload(view,'contract'); view=hidden.view
    expect((await get(view.commission.id,customer)).attachments).toEqual([])
    await expect(invoke('download',undefined,customer,{commissionId:view.commission.id,fileId:hidden.file.id})).rejects.toThrow('File not found')
    await expect(get(view.commission.id,stranger)).rejects.toThrow('not found')
    view=await finalize(await cmd(view,'submit-request',{fileIds:[]})); view=await cmd(view,'accept')
    const fields=completeFields(DEFAULT_TEMPLATES[0])
    view=await cmd(view,'save-contract',{draft:{templateId:DEFAULT_TEMPLATES[0].id,kind:'MAIN',title:'Secret draft',fields,body:renderTemplate(DEFAULT_TEMPLATES[0],fields)}})
    expect((await get(view.commission.id,customer)).commission.contractDraft).toBeNull()
    view=await cmd(view,'publish-contract',{fileIds:[]})
    expect((await get(view.commission.id,customer)).pendingAction!.snapshot).toEqual({})
    const publicView=await invoke<Record<string,unknown>>('receipt',undefined,null,{evidenceId:view.pendingAction!.id})
    expect(Object.keys(publicView).sort()).toEqual(['digest','evidenceId','finalizedAt','memo','network','signature','status'])
    expect(JSON.stringify(publicView)).not.toContain('Secret draft')
    view=await finalize(view)
    expect((await get(view.commission.id,customer)).attachments).toEqual([])
    const archive=await invoke<{entries:Array<{path:string;text?:string;fileId?:string}>}>('archive',undefined,customer,{commissionId:view.commission.id})
    expect(archive.entries.some(entry=>entry.fileId===hidden.file.id)).toBe(false)
  })
  it('rejects attachment tampering before freezing and before download', async () => {
    const uploaded=await upload(await create(),'request',customer)
    files.set(uploaded.file.id,{...uploaded.file,sha256:'b'.repeat(64)})
    await expect(cmd(uploaded.view,'submit-request',{fileIds:[uploaded.file.id]},customer)).rejects.toThrow('INTEGRITY')
    await expect(invoke('download',undefined,customer,{commissionId:uploaded.view.commission.id,fileId:uploaded.file.id})).rejects.toThrow('INTEGRITY')
  })
  it('requires preflight and completion authorization; upload races cannot mutate frozen snapshots', async () => {
    const view=await create(), file:PrivateFile={id:randomUUID(),name:'x',size:'1',sha256:'a'.repeat(64),createdAt:new Date().toISOString()}; files.set(file.id,file)
    const query={commissionId:view.commission.id,purpose:'request',revision:'0',commandId:randomUUID()}
    await invoke('upload',{phase:'authorize'},customer,query)
    await cmd(view,'submit-request',{fileIds:[]},customer)
    await expect(invoke('upload',{phase:'complete',upload:file},customer,query)).rejects.toThrow('STALE_REVISION')
    expect(sql.prepare('SELECT count(*) n FROM attachments').get()).toEqual({n:0})
  })
  it('supports customer objections, immutable replacement versions and offline confirmations', async () => {
    let view=await finalize(await cmd(await create(),'submit-request',{fileIds:[]})); view=await cmd(view,'accept'); view=await publish(view)
    const first=structuredClone(view.commission.contracts[0])
    view=await cmd(view,'decline-contract',{contractId:first.id,reason:'Change the scope'},customer)
    expect(view.commission.stage).toBe('CONTRACT_PREPARATION')
    view=await publish(view)
    expect(view.commission.contracts).toHaveLength(2); expect(view.commission.contracts[0].body).toBe(first.body)
    await expect(cmd(view,'record-confirmation',{contractId:view.commission.contracts[1].id})).rejects.toThrow('traceable')
    view=await finalize(await cmd(view,'record-confirmation',{contractId:view.commission.contracts[1].id,note:'Email confirmation reference'}))
    expect(view.commission.stage).toBe('READY'); expect(view.commission.contracts[1].confirmation!.method).toBe('OFFLINE')
  })
  it('enforces supplement prerequisites and keeps the effective lifecycle independent', async () => {
    let view=await create(); const template=DEFAULT_TEMPLATES[7],fields=completeFields(template)
    await expect(cmd(view,'save-contract',{draft:{templateId:template.id,kind:'SUPPLEMENT',title:template.title,fields,body:renderTemplate(template,fields)}})).rejects.toThrow('effective main contract')
    view=await ready(); view=await cmd(view,'start'); view=await publish(view,template)
    expect(view.commission.stage).toBe('IN_PROGRESS')
    view=await finalize(await cmd(view,'confirm-contract',{contractId:view.commission.contracts[1].id},customer))
    expect(view.commission.contracts[1].effectiveAt).not.toBeNull(); expect(view.commission.stage).toBe('IN_PROGRESS')
  })
  it('rotates and revokes invitation tokens, claims only once and protects linked users', async () => {
    let view=await create(admin,{customerId:null})
    const issue=async () => invoke<{detail:CommissionDetail;invitationToken:string}>('command',{commissionId:view.commission.id,commandId:randomUUID(),revision:view.commission.revision,action:'invite',data:{}})
    const first=await issue(); view=first.detail; const second=await issue();view=second.detail
    expect(await invoke('invitation',undefined,null,{token:first.invitationToken})).toEqual({valid:false,expiresAt:null})
    const claimed=await invoke('claim',{token:second.invitationToken,commandId:randomUUID(),revision:0},customer)
    expect(claimed.detail.commission.customerId).toBe(2)
    await expect(invoke('claim',{token:second.invitationToken,commandId:randomUUID(),revision:0},stranger)).rejects.toThrow('invalid')
    expect(()=>sql.prepare('DELETE FROM auth_user WHERE id=2').run()).toThrow('FOREIGN KEY')
  })
  it('supports pause, resume, termination and payment without artificial completion', async () => {
    let view=await ready(); view=await cmd(view,'payment',{percent:20,reason:'Deposit'})
    view=await cmd(view,'pause'); await expect(cmd(view,'start')).rejects.toThrow('ACTION_NOT_ALLOWED')
    view=await cmd(view,'resume'); view=await cmd(view,'terminate',{reason:'Mutual agreement'})
    expect(view.commission.stage).toBe('TERMINATED'); expect(view.commission.paymentPercent).toBe(20)
    expect(view.allowedActions).toEqual([])
  })
  it('auto-closes maintenance after re-enable and supports early closure', async () => {
    let view=await cmd(await ready(),'start'); const uploaded=await upload(view,'delivery'); view=uploaded.view
    view=await finalize(await cmd(view,'deliver',{description:'Done',fileIds:[uploaded.file.id]}))
    view=await cmd(view,'maintenance-feedback',{text:'Question'},customer); view=await cmd(view,'maintenance-resolve',{text:'Resolved'})
    vi.useFakeTimers();vi.setSystemTime(new Date(view.commission.maintenanceEndsAt!).getTime()+1)
    server=await factory(ctx);await server.onEnable!()
    expect((await get(view.commission.id)).commission.stage).toBe('CLOSED')
    vi.useRealTimers()
    let other=await cmd(await ready(),'start');const more=await upload(other,'delivery');other=await finalize(await cmd(more.view,'deliver',{description:'Done',fileIds:[more.file.id]}))
    other=await cmd(other,'close-maintenance',{reason:'Completed by agreement'})
    expect(other.commission.stage).toBe('CLOSED')
  })
  it('pauses new intake without blocking existing work and restricts MCP to queries and drafts', async () => {
    const view=await create()
    await invoke('settings-save',{commandId:randomUUID(),revision:0,acceptingNew:false})
    await expect(create()).rejects.toThrow('paused')
    await expect(cmd(view,'update-draft',{title:'Existing'})).resolves.toBeDefined()
    expect(Object.keys(server.mcp!)).toEqual(['list','detail','templates','create-draft','update-draft'])
    await expect(server.mcp!['update-draft']({actor:admin,input:{commandId:randomUUID(),revision:1,commissionId:view.commission.id,data:{},action:'submit-request'}})).rejects.toThrow()
  })
  it('publishes immutable template versions and retains only compatible fields', async () => {
    const source=DEFAULT_TEMPLATES[0], next={...source,title:'Updated'}
    const response=await invoke<{template:ContractTemplate}>('template-save',{commandId:randomUUID(),revision:1,template:next})
    expect(response.template.version).toBe(2)
    expect(sql.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:9})
    expect((await invoke<{list:ContractTemplate[]}>('templates')).list.find(item=>item.family===source.family)!.title).toBe('Updated')
    const migrated=compatibleFields(source,DEFAULT_TEMPLATES[1],{projectName:'Project',pagesAndRoles:'Old'})
    expect(migrated).toEqual({projectName:'Project',maintenanceDays:30})
    expect(missingTemplateFields(source,{})).toContain('customerName')
  })

  it('validates the manifest, public capability declarations and SDK contract', () => {
    const parsed = pluginManifestSchema.parse(manifest)
    expect(parsed.engines.sdk).toBe('^1.4.0')
    expect(parsed.mcp.every(tool => tool.name.startsWith('slothvault.commissions.') && tool.readOnly === (tool.operation === 'read'))).toBe(true)
    expect(parsed.api.filter(api => api.transport).map(api => api.transport).sort()).toEqual(['archive','download','upload'])
  })
  it('serializes concurrent draft commands with revision CAS, and identical commands replay once', async () => {
    const view=await create(), input={commissionId:view.commission.id,revision:0,commandId:randomUUID(),action:'update-draft',data:{title:'One'}}
    const same=await Promise.all([invoke('command',input),invoke('command',input)])
    expect(same[0]).toEqual(same[1]); expect(same[0].detail.commission.revision).toBe(1)
    const results=await Promise.allSettled(['Two','Three'].map(title=>invoke('command',{...input,revision:1,commandId:randomUUID(),data:{title}})))
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(item=>item.status==='rejected')).toHaveLength(1)
    expect((await get(view.commission.id)).commission.revision).toBe(2)
  })
  it('serializes simultaneous finality application without duplicate contracts or audit entries', async () => {
    const view=await submitted(await cmd(await create(),'submit-request',{fileIds:[]}))
    await Promise.all([server.jobs!.reconcile({id:'a',attempt:1,scheduledAt:''}),server.jobs!.reconcile({id:'b',attempt:1,scheduledAt:''})])
    const result=await get(view.commission.id)
    expect(result.commission.stage).toBe('REQUESTED')
    expect(result.events.filter(event=>event.type==='evidence-finalized')).toHaveLength(1)
    expect(result.commission.revision).toBe(view.commission.revision+1)
  })
  it('shares only explicitly selected contract files after FINALIZED and strips unpublished metadata', async () => {
    let view=await create()
    const hidden=await upload(view,'contract'); const selected=await upload(hidden.view,'contract');view=selected.view
    const before=await get(view.commission.id,customer)
    expect(JSON.stringify(before)).not.toContain(hidden.file.id)
    expect(JSON.stringify(before)).not.toContain(selected.file.id)
    view=await finalize(await cmd(view,'submit-request',{fileIds:[]}));view=await cmd(view,'accept')
    const template=DEFAULT_TEMPLATES[0], fields=completeFields(template)
    view=await cmd(view,'save-contract',{draft:{templateId:template.id,kind:template.kind,title:template.title,fields,body:renderTemplate(template,fields)}})
    view=await cmd(view,'publish-contract',{fileIds:[selected.file.id]})
    expect(JSON.stringify(await get(view.commission.id,customer))).not.toContain(selected.file.id)
    view=await finalize(view)
    const published=await get(view.commission.id,customer)
    expect(published.attachments.map(file=>file.id)).toEqual([selected.file.id])
    expect(JSON.stringify(published)).not.toContain(hidden.file.id)
    expect(await invoke('download',undefined,customer,{commissionId:view.commission.id,fileId:selected.file.id})).toEqual({fileId:selected.file.id,name:selected.file.name})
  })
  it('rejects foreign-commission file references and disabled customers', async () => {
    const first=await upload(await create(),'request',customer), second=await create()
    await expect(cmd(second,'submit-request',{fileIds:[first.file.id]})).rejects.toThrow('not attached')
    vi.mocked(ctx.users.find).mockResolvedValue([{id:2,username:'disabled',displayName:null,role:'USER',status:0}])
    await expect(create()).rejects.toThrow('enabled account')
  })
  it('holds finalized transactions for integrity repair rather than applying altered snapshots', async () => {
    const view=await submitted(await cmd(await create(),'submit-request',{fileIds:[]}))
    const record=structuredClone(view.pendingAction!);record.snapshot.description='tampered'
    sql.prepare('UPDATE evidence SET data_json=? WHERE id=?').run(JSON.stringify(record),record.id)
    await expect(reconcile(view)).rejects.toThrow('FROZEN_CONTENT_INTEGRITY')
    expect((await get(view.commission.id)).commission.stage).toBe('DRAFT')
    await expect(server.onDisable!()).rejects.toThrow('Reconcile')
  })
  it('never stores invitation secrets in command receipts or audit snapshots', async () => {
    const view=await create(admin,{customerId:null}),input={commissionId:view.commission.id,revision:0,commandId:randomUUID(),action:'invite',data:{}}
    const result=await invoke<{detail:CommissionDetail;invitationToken:string}>('command',input)
    expect(result.invitationToken).toHaveLength(43)
    expect(JSON.stringify(sql.prepare('SELECT * FROM commands').all())).not.toContain(result.invitationToken)
    expect(JSON.stringify(sql.prepare('SELECT * FROM invitations').all())).not.toContain(result.invitationToken)
    const replay=await invoke<{invitationToken?:string}>('command',input)
    expect(replay.invitationToken).toBeUndefined()
  })
  it('allows maintenance to expire without signing unsubmitted supplementary actions', async () => {
    let view=await cmd(await ready(),'start'); const uploaded=await upload(view,'delivery')
    view=await finalize(await cmd(uploaded.view,'deliver',{description:'Done',fileIds:[uploaded.file.id]}))
    const template=DEFAULT_TEMPLATES[7],fields=completeFields(template);fields.baseContractId=view.commission.contracts[0].id
    view=await cmd(view,'save-contract',{draft:{templateId:template.id,kind:template.kind,title:template.title,fields,body:renderTemplate(template,fields)}})
    view=await cmd(view,'publish-contract',{fileIds:[]})
    vi.useFakeTimers();vi.setSystemTime(new Date(view.commission.maintenanceEndsAt!).getTime()+1)
    await server.jobs!.maintenance({id:'timer',attempt:1,scheduledAt:''})
    const closed=await get(view.commission.id)
    expect(closed.commission.stage).toBe('CLOSED');expect(closed.pendingAction).toBeNull()
    expect(closed.evidence.at(-1)!.status).toBe('WITHDRAWN')
  })

  it('hashes snapshots canonically and forms a verifiable audit chain', async () => {
    expect(digest({b:2,a:1})).toBe(digest({a:1,b:2}))
    let view=await create();view=await cmd(view,'comment',{text:'Update'})
    for (const [i,event] of view.events.entries()) {
      const {hash,...payload}=event;expect(digest(payload)).toBe(hash)
      expect(event.previousHash).toBe(i===0?null:view.events[i-1].hash)
    }
  })
})
