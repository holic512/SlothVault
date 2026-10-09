/**
 * @file simple-templates.ts
 * @project SlothVault
 * @module Markdown Template Versions
 * @description Publishes standalone Markdown templates with automatically extracted variables.
 * @logic Keep legacy versions intact, seed a small editable starting point, and freeze published definitions.
 * @dependencies Prisma, simple template renderer, unit-of-work
 * @index_tags commissions,templates,versions
 * @author holic512
 */
import 'server-only'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'
import { renderSimpleTemplate, synchronizeFields, type SimpleField, type SimpleTemplate, type SimpleTemplateVersion } from '@/lib/commission-workflow'
import { simpleVersionInput } from './workflow-input'
import type { z } from 'zod'

export function templateInput<T>(read: () => T): T {
  try { return read() } catch (error) { throw new HttpError(error instanceof Error ? error.message : '模板内容无效', 400, 400) }
}
const initialBody = '# 软件开发委托合同\n\n项目名称：{{项目名称}}\n\n委托方：{{委托方}}\n\n开发方：{{开发方}}\n\n## 服务范围\n\n{{服务范围}}\n\n具体需求以双方确认的需求记录及附件为准。追加需求须另行确认。\n\n## 费用与交付\n\n合同金额：人民币 {{合同金额}} 元。\n\n付款安排：{{付款安排}}\n\n交付内容：{{交付内容}}\n\n## 维护约定\n\n正式交付后立即进入 {{维护天数}} 个自然日的维护期。双方可在网站查看截止时间。用户或管理员可主动关闭维护通道，到期自动关闭；关闭不会将未解决问题标为已解决。\n\n## 确认方式\n\n{{确认方式}}\n\n其他约定：{{其他约定}}\n'
export async function seedSimpleTemplate(client: Pick<typeof prisma, 'contractTemplate'> = prisma) {
  const fields = synchronizeFields(initialBody).map((field) => ({ ...field, required: field.key !== '其他约定', type: ['服务范围', '付款安排', '交付内容', '其他约定'].includes(field.key) ? 'multiline' as const : 'text' as const }))
  await client.contractTemplate.upsert({ where: { key: 'commission-markdown-v2' }, update: {}, create: {
    key: 'commission-markdown-v2', name: '软件开发委托合同', versions: { create: { version: 1, format: 'SIMPLE', status: 'PUBLISHED', publishedAt: new Date(), documentsJson: JSON.stringify({ body: initialBody }), fieldsJson: JSON.stringify(fields), defaultsJson: '{}' } },
  } })
}
export function simpleVersionDto(row: { id: number; version: number; status: string; documentsJson: string; fieldsJson: string }): SimpleTemplateVersion {
  return { id: String(row.id), version: row.version, status: row.status, body: JSON.parse(row.documentsJson).body as string, fields: JSON.parse(row.fieldsJson) as SimpleField[] }
}
export async function listSimpleTemplates(): Promise<SimpleTemplate[]> {
  await seedSimpleTemplate()
  const rows = await prisma.contractTemplate.findMany({ where: { OR: [{ versions: { some: { format: 'SIMPLE' } } }, { versions: { none: {} } }] }, include: { versions: { where: { format: 'SIMPLE' }, orderBy: { version: 'desc' } } }, orderBy: { id: 'desc' } })
  return rows.map((row) => ({ id: String(row.id), name: row.name, status: row.status, versions: row.versions.map(simpleVersionDto) }))
}
export async function saveSimpleVersion(input: z.infer<typeof simpleVersionInput> & { templateId: number }) {
  const fields = templateInput(() => synchronizeFields(input.body, input.fields))
  for (const field of fields) if (field.type === 'select' && (!field.options?.length || new Set(field.options).size !== field.options.length)) throw new HttpError('选项字段需要不重复的选项', 400, 400)
  templateInput(() => renderSimpleTemplate(input.body, fields, {}))
  return unitOfWork.execute(async (tx) => {
    await tx.contractTemplate.update({ where: { id: input.templateId }, data: { status: 'ACTIVE' } })
    const data = { format: 'SIMPLE', documentsJson: JSON.stringify({ body: input.body }), fieldsJson: JSON.stringify(fields), defaultsJson: '{}' }
    if (input.versionId) {
      const result = await tx.contractTemplateVersion.updateMany({ where: { id: input.versionId, templateId: input.templateId, status: 'DRAFT', format: 'SIMPLE' }, data })
      if (!result.count) throw new HttpError('已发布版本不可覆盖，请建立新版本', 409, 409)
      return simpleVersionDto(await tx.contractTemplateVersion.findUniqueOrThrow({ where: { id: input.versionId } }))
    }
    const latest = await tx.contractTemplateVersion.findFirst({ where: { templateId: input.templateId }, orderBy: { version: 'desc' } })
    return simpleVersionDto(await tx.contractTemplateVersion.create({ data: { ...data, templateId: input.templateId, version: (latest?.version || 0) + 1 } }))
  })
}
export async function publishSimpleVersion(id: number) {
  return unitOfWork.execute(async (tx) => {
    const row = await tx.contractTemplateVersion.findFirst({ where: { id, format: 'SIMPLE', status: 'DRAFT' } })
    if (!row) throw new HttpError('只有草稿可以发布', 409, 409)
    const version = simpleVersionDto(row)
    templateInput(() => renderSimpleTemplate(version.body, version.fields, {}))
    await tx.contractTemplateVersion.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
    return { ...version, status: 'PUBLISHED' }
  })
}
