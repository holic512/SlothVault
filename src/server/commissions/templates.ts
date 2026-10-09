/**
 * @file templates.ts
 * @project SlothVault
 * @module Versioned Contract Template Service
 * @description Manages editable template revisions and seeds the complete supplied development agreement.
 * @logic Seed once, validate bounded template definitions, and only update draft revisions while published text remains immutable.
 * @dependencies Prisma, unit-of-work, deterministic contract templates
 * @index_tags commissions,templates,versions,seed
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { validateTemplateDefinition, validateTemplateValues } from '@/lib/contract-template'
import builtin from './builtin-template.json'
import type { TemplateDto, TemplateField, TemplateVersionDto } from '@/types/commissions'

const fieldSchema: z.ZodType<TemplateField> = z.lazy(() => z.object({
  key: z.string().min(1).max(100), label: z.string().min(1).max(120),
  type: z.enum(['text', 'multiline', 'date', 'money', 'number', 'select', 'multiselect', 'boolean', 'rows']),
  required: z.boolean().optional(), documents: z.array(z.enum(['AGREEMENT', 'CHANGE', 'ACCEPTANCE'])).optional(),
  options: z.array(z.object({ value: z.string().max(200), label: z.string().max(200) }).strict()).max(100).optional(),
  fields: z.array(fieldSchema).optional(), when: z.object({ key: z.string().max(100), value: z.string().max(200) }).strict().optional(), help: z.string().max(500).optional(),
}).strict())
export const templateVersionInput = z.object({
  documents: z.object({ AGREEMENT: z.string().min(1).max(100000), REQUIREMENTS: z.string().min(1).max(100000), CHANGE: z.string().min(1).max(100000), ACCEPTANCE: z.string().min(1).max(100000) }).strict(),
  fields: z.array(fieldSchema).min(1).max(120), defaults: z.record(z.string(), z.unknown()),
}).strict()
export function templateVersionDto(record: { id: number; templateId: number; version: number; status: string; publishedAt: Date | null; documentsJson: string; fieldsJson: string; defaultsJson: string }): TemplateVersionDto {
  const content = templateVersionInput.parse({ documents: JSON.parse(record.documentsJson), fields: JSON.parse(record.fieldsJson), defaults: JSON.parse(record.defaultsJson) })
  return { id: String(record.id), templateId: String(record.templateId), version: record.version, status: record.status, publishedAt: record.publishedAt?.toISOString() || null, ...content }
}
export async function seedCommissionTemplates(client: Pick<Prisma.TransactionClient, 'contractTemplate' | 'contractTemplateVersion' | 'commissionSettings'> = prisma) {
  const template = await client.contractTemplate.upsert({
    where: { key: builtin.key }, update: {},
    create: { key: builtin.key, name: builtin.name, versions: { create: { version: 1, status: 'PUBLISHED', publishedAt: new Date(), documentsJson: JSON.stringify(builtin.documents), fieldsJson: JSON.stringify(builtin.fields), defaultsJson: JSON.stringify(builtin.defaults) } } },
    include: { versions: true },
  })
  // An early prelaunch seed used fixed reminder terms. Preserve that published version and
  // add the complete field-driven revision once; user-edited later versions take precedence.
  if (template.versions.length === 1 && template.versions[0].version === 1 && !JSON.parse(template.versions[0].fieldsJson).some((field: TemplateField) => field.key === 'acceptanceDays')) {
    await client.contractTemplateVersion.upsert({ where: { templateId_version: { templateId: template.id, version: 2 } }, update: {}, create: { templateId: template.id, version: 2, status: 'PUBLISHED', publishedAt: new Date(), documentsJson: JSON.stringify(builtin.documents), fieldsJson: JSON.stringify(builtin.fields), defaultsJson: JSON.stringify(builtin.defaults) } })
  }
  await client.commissionSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })
}
export async function listContractTemplates(): Promise<TemplateDto[]> {
  await seedCommissionTemplates()
  return (await prisma.contractTemplate.findMany({ where: { versions: { some: { format: 'LEGACY' } } }, include: { versions: { where: { format: 'LEGACY' }, orderBy: { version: 'desc' } } }, orderBy: { id: 'asc' } })).map((item) => ({ id: String(item.id), key: item.key, name: item.name, status: item.status, versions: item.versions.map(templateVersionDto) }))
}
export async function requireTemplateVersion(id: number) {
  const record = await prisma.contractTemplateVersion.findUnique({ where: { id }, include: { template: true } })
  if (!record) throw new HttpError('模板版本不存在', 404, 404)
  return { ...templateVersionDto(record), templateKey: record.template.key, templateStatus: record.template.status }
}
export async function saveTemplateVersion(input: z.infer<typeof templateVersionInput> & { templateId: number; versionId?: number }) {
  try { validateTemplateDefinition(input.documents, input.fields); for (const kind of ['AGREEMENT', 'CHANGE', 'ACCEPTANCE'] as const) validateTemplateValues(input.fields, input.defaults, kind, false) }
  catch (e) { throw new HttpError(e instanceof Error ? e.message : '模板定义不合法', 400, 400) }
  return unitOfWork.execute(async (tx) => {
    const data = { documentsJson: JSON.stringify(input.documents), fieldsJson: JSON.stringify(input.fields), defaultsJson: JSON.stringify(input.defaults) }
    if (input.versionId) {
      const changed = await tx.contractTemplateVersion.updateMany({ where: { id: input.versionId, templateId: input.templateId, status: 'DRAFT' }, data })
      if (changed.count !== 1) throw new HttpError('已发布版本不可修改，请创建新版本', 409, 409)
      return templateVersionDto((await tx.contractTemplateVersion.findUniqueOrThrow({ where: { id: input.versionId } })))
    }
    const latest = await tx.contractTemplateVersion.findFirst({ where: { templateId: input.templateId }, orderBy: { version: 'desc' } })
    return templateVersionDto(await tx.contractTemplateVersion.create({ data: { ...data, templateId: input.templateId, version: (latest?.version || 0) + 1 } }))
  })
}
export async function publishTemplateVersion(id: number) {
  const version = await requireTemplateVersion(id)
  try { validateTemplateDefinition(version.documents, version.fields) } catch (e) { throw new HttpError(e instanceof Error ? e.message : '模板定义不合法', 400, 400) }
  const result = await prisma.contractTemplateVersion.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
  if (result.count !== 1) throw new HttpError('只有草稿版本可以发布', 409, 409)
  return requireTemplateVersion(id)
}
