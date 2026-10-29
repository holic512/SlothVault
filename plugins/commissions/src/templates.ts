/**
 * @file templates.ts
 * @project SlothVault
 * @module Commissions templates
 * @description Eight editable scenario-specific business templates, with typed field migration and explicit missing inputs.
 * @logic Published versions are immutable; retain only type/semantic-compatible values when switching templates.
 * @dependencies Commissions domain DTOs
 * @index_tags commissions,templates,contracts
 * @author holic512
 */
import type { ContractTemplate, FieldValue, TemplateField } from './domain'
const field = (key: string, label: string, type: TemplateField['type'] = 'string', defaultValue?: FieldValue): TemplateField => ({
  key,
  label,
  type,
  required: true,
  semantic: key,
  ...(defaultValue === undefined ? {} : { default: defaultValue })
})
const common = [
  field('projectName', '项目名称'),
  field('customerName', '委托方名称'),
  field('providerName', '服务方名称'),
  field('scope', '服务范围与边界'),
  field('deliverables', '交付物与完成标准'),
  field('excluded', '明确不包含的服务'),
  field('amount', '服务总价及币种'),
  field('paymentSchedule', '付款节点与比例'),
  field('schedule', '实施周期及里程碑'),
  field('cooperation', '双方资料与配合义务'),
  field('intellectualProperty', '知识产权与授权范围'),
  field('confidentiality', '保密范围与期限'),
  field('maintenanceDays', '维护天数', 'number', 30),
  field('maintenanceScope', '维护范围与响应方式'),
  field('disputeResolution', '争议处理约定')
]
const shared = `## 当事人与项目\n委托方：{{customerName}}\n服务方：{{providerName}}\n项目：{{projectName}}\n\n## 服务、交付与排除事项\n范围：{{scope}}\n交付物与可核验标准：{{deliverables}}\n不包含：{{excluded}}\n周期与里程碑：{{schedule}}\n\n## 费用与配合\n总价与币种：{{amount}}\n付款安排：{{paymentSchedule}}\n双方配合：{{cooperation}}\n需求变化应另行确认影响与费用，不因沟通记录自动扩大范围。\n\n## 权利与保密\n知识产权、第三方许可与使用授权：{{intellectualProperty}}\n保密范围、例外及期限：{{confidentiality}}\n\n## 交付与维护\n正式交付存证完成后进入维护，维护期 {{maintenanceDays}} 天。\n维护范围、渠道与响应：{{maintenanceScope}}\n新增需求、第三方服务故障及超出原范围工作不当然属于免费维护。\n\n## 确认与争议\n客户在线确认或管理员记录线下确认后，由管理员统一办理主网摘要存证；管理员签名不代表客户使用钱包签署。\n争议处理：{{disputeResolution}}\n本模板为可编辑业务范本，不保证适用于所有法律管辖区，正式采用前应核对双方真实意思与具体约定。`
const specifications = [
  {
    family: 'website',
    title: '网站与管理后台开发',
    scenario: 'website',
    applicableWhen: '企业网站、内容系统与管理后台的新建或改造',
    requiredMaterials: ['页面与角色清单', '业务流程', '部署环境和域名资料'],
    extras: [field('pagesAndRoles', '页面、角色与权限矩阵')],
    body: '## 网站专属约定\n页面、角色与权限矩阵：{{pagesAndRoles}}\n逐项约定响应式断点、浏览器支持、后台权限和部署环境。SEO、内容录入、域名及云资源费用仅在范围明确列出时包含；生产数据迁移须另行确认备份与回退。'
  },
  {
    family: 'miniapp',
    title: '小程序与移动端应用',
    scenario: 'mobile',
    applicableWhen: '小程序或移动应用开发，不承诺第三方审核结果',
    requiredMaterials: ['平台主体与账号', '页面原型', '设备与系统版本范围'],
    extras: [field('platforms', '平台、机型与版本范围')],
    body: '## 移动端专属约定\n支持平台与机型：{{platforms}}\n登录、支付、推送及隐私权限分别核对平台资质；应用商店与小程序平台审核由平台决定。适配测试、签名证书归属、发布账号及升级方式应在交付清单列明。'
  },
  {
    family: 'automation',
    title: '自动化脚本与数据处理',
    scenario: 'automation',
    applicableWhen: '合法授权的数据转换、批处理及自动化任务',
    requiredMaterials: ['合法来源样本', '输入输出格式', '执行频率与数据量'],
    extras: [field('dataRules', '数据来源、规模与清洗规则')],
    body: '## 自动化专属约定\n数据规则：{{dataRules}}\n约定异常数据、重试、幂等和日志保留方式。委托方保证数据及访问授权；不含绕过访问控制、验证码或违反来源站点限制。第三方格式变更与超出约定规模的数据另行评估。'
  },
  {
    family: 'integration',
    title: 'API 与第三方系统集成',
    scenario: 'integration',
    applicableWhen: '已获接口授权的系统对接与同步',
    requiredMaterials: ['接口文档及版本', '测试授权', '字段映射与调用限额'],
    extras: [field('integrationBoundary', '系统边界、认证与同步规则')],
    body: '## 集成专属约定\n系统边界与同步规则：{{integrationBoundary}}\n确认接口版本、认证方式、字段映射、限流、重试和失败补偿。外部平台可用性与收费由对应平台负责；密钥经安全渠道交接，不进入合同正文或公开存证。'
  },
  {
    family: 'deployment',
    title: '部署迁移与运维配置',
    scenario: 'deployment',
    applicableWhen: '服务器部署、迁移与可恢复的运维配置',
    requiredMaterials: ['资产清单', '备份现状', '维护窗口与恢复目标'],
    extras: [field('migrationPlan', '维护窗口、备份与回退计划')],
    body: '## 部署专属约定\n迁移与回退计划：{{migrationPlan}}\n变更前核对备份可恢复性、访问授权及停机窗口；明确监控、证书、日志与密钥交接。硬件、带宽及云服务费用不默认包含，未在范围列明的不提供全天候值守承诺。'
  },
  {
    family: 'support',
    title: '软件维护与技术支持',
    scenario: 'support',
    applicableWhen: '已有软件的约定范围维护和技术支持',
    requiredMaterials: ['版本和已知问题', '可复现步骤', '服务时间及响应要求'],
    extras: [field('supportLevels', '支持渠道、时间与优先级')],
    body: '## 支持专属约定\n服务级别：{{supportLevels}}\n区分缺陷修复、使用咨询与需求开发，明确工作时段、紧急等级和响应目标。响应不等于解决承诺；未纳入版本、缺少复现环境或第三方故障单独处理。'
  },
  {
    family: 'general',
    title: '通用软件开发委托',
    scenario: 'general',
    applicableWhen: '其他已明确范围与交付标准的软件项目',
    requiredMaterials: ['需求说明', '里程碑', '可核验交付标准'],
    extras: [field('qualityCriteria', '质量标准与验证方式')],
    body: '## 通用开发约定\n质量与验证：{{qualityCriteria}}\n明确源码、文档、可运行产物及环境说明的交付范围。性能指标应约定数据规模、环境和测量方式；未经确认的口头设想不自动成为交付义务。'
  },
  {
    family: 'change',
    title: '需求变更与费用调整补充协议',
    scenario: 'change',
    applicableWhen: '仅限已有生效主合同的委托，不能独立发布',
    requiredMaterials: ['生效主合同编号', '变更前后对照', '费用和周期影响'],
    extras: [field('baseContractId', '生效主合同编号'), field('changeComparison', '变更前后范围对照')],
    body: '## 补充协议\n主合同编号：{{baseContractId}}\n变更前后对照：{{changeComparison}}\n明确增加、减少及保持不变的内容，逐项列出费用和期限影响。本协议经确认并完成存证后生效，未明确修改的主合同条款继续有效；变更前的合同和交付记录保持不变。'
  },
] as const
export const DEFAULT_TEMPLATES: ContractTemplate[] = specifications.map(spec => ({
  id: `builtin-${spec.family}-v1`,
  family: spec.family,
  version: 1,
  kind: spec.family === 'change' ? 'SUPPLEMENT' : 'MAIN',
  title: spec.title,
  scenario: spec.scenario,
  applicableWhen: spec.applicableWhen,
  requiredMaterials: [...spec.requiredMaterials],
  fields: [...common, ...spec.extras],
  body: `${shared}\n\n${spec.body}`,
  published: true,
  createdAt: '2026-10-23T00:00:00.000Z'
}))
export function compatibleFields(previous: ContractTemplate | null, next: ContractTemplate, values: Record<string, FieldValue>): Record<string, FieldValue> {
  const result: Record<string, FieldValue> = {}
  for (const item of next.fields) {
    const old = previous?.fields.find(candidate => candidate.key === item.key && candidate.semantic === item.semantic && candidate.type === item.type)
    if (old && typeof values[item.key] === item.type) result[item.key] = values[item.key]
    else if (item.default !== undefined) result[item.key] = item.default
  }
  return result
}
export function missingTemplateFields(template: ContractTemplate, values: Record<string, FieldValue>): string[] {
  return template.fields.filter(item => item.required && (typeof values[item.key] !== item.type || (item.type === 'string' && !String(values[item.key]).trim()) || (item.type === 'number' && !Number.isFinite(values[item.key])))).map(item => item.key)
}
export function renderTemplate(template: ContractTemplate, values: Record<string, FieldValue>): string {
  return template.body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => String(values[key] ?? `【待填写：${template.fields.find(field => field.key === key)?.label ?? key}】`).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&'))
}
