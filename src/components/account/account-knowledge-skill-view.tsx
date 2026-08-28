'use client'

/**
 * @file account-knowledge-skill-view.tsx
 * @project SlothVault
 * @module Account Knowledge Package Skill
 * @description Presents the repository-managed knowledge-package Skill and its safe handoff path to signed-in users.
 * @logic Keep AI execution outside SlothVault, surface the exact package commands and hard validation boundaries, and reveal the existing import workspace only to administrators.
 * @dependencies Ant Design, Lucide React, Next Link, account session context
 * @index_tags account, skill, knowledge-package, codex, zip, import, source-evidence
 * @author holic512
 */
import { App, Alert, Button, Card, Space, Tag, Typography } from 'antd'
import {
  Archive,
  BookOpenText,
  Copy,
  FileText,
  FolderTree,
  Import,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'

import { useAccountUser } from '@/components/account/account-shell'

const projectCommand = `node skills/project-knowledge-base/scripts/build-package.mjs \\
  --input /absolute/path/knowledge-base.json \\
  --source-root /absolute/path/inspected-project \\
  --kind project \\
  --output /absolute/path/project-knowledge.zip`

const articleCommand = `node skills/project-knowledge-base/scripts/build-package.mjs \\
  --input /absolute/path/knowledge-base.json \\
  --source-root /absolute/path/inspected-project \\
  --kind article \\
  --output /absolute/path/project-article.zip`

function CommandCard({
  title,
  description,
  command,
}: {
  title: string
  description: string
  command: string
}) {
  const { message } = App.useApp()

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      message.success('打包命令已复制')
    } catch {
      message.error('无法自动复制，请手动选择命令')
    }
  }

  return (
    <section className="account-skill-command-card">
      <div className="account-skill-command-heading">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <Button size="small" icon={<Copy size={14} />} onClick={() => void copyCommand()}>复制命令</Button>
      </div>
      <pre className="account-skill-command"><code>{command}</code></pre>
    </section>
  )
}

export function AccountKnowledgeSkillView() {
  const user = useAccountUser()

  return (
    <div className="account-route account-skill-route">
      <section className="account-skill-hero">
        <div>
          <Typography.Text className="account-eyebrow">Source-grounded authoring</Typography.Text>
          <Typography.Title level={2}>知识库打包 Skill</Typography.Title>
          <Typography.Paragraph>
            使用仓库内置的 <code>project-knowledge-base</code> Skill，让支持 Skill 的 AI 工具基于真实本地源码产出可编辑的项目知识库或单篇技术文章 ZIP。
          </Typography.Paragraph>
        </div>
        <div className="account-skill-signal" aria-label="Skill package validation status">
          <Archive size={21} />
          <span>ZIP v1</span>
          <strong>强校验</strong>
        </div>
      </section>

      <Alert
        showIcon
        type="info"
        icon={<ShieldCheck size={17} />}
        message="AI 在你的工具中运行，SlothVault 不保存模型密钥，也不会读取你的本地源码。"
        description="Skill 只生成带来源证据的 ZIP；平台会在导入前再次校验归档结构、字段、摘要和 Markdown 镜像。"
      />

      <div className="account-skill-grid">
        <Card className="account-card account-skill-workflow-card" title={<span className="account-card-title"><BookOpenText size={16} />线性使用流程</span>}>
          <ol className="account-skill-steps">
            <li>
              <span>01</span>
              <div><strong>打开真实项目源码</strong><p>在本地项目中加载 <code>skills/project-knowledge-base/SKILL.md</code>，让 AI 先检查配置、模块、迁移和测试。</p></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>选择输出范围</strong><p>项目包覆盖完整知识树；文章包仅含一篇文章，适合追加到已有草稿版本。</p></div>
            </li>
            <li>
              <span>03</span>
              <div><strong>构建并复验 ZIP</strong><p>构建器会验证每一条来源引用在源码根目录下真实存在，并在输出前复验 ZIP。</p></div>
            </li>
            <li>
              <span>04</span>
              <div><strong>交付给项目管理员</strong><p>管理员在项目管理的知识包导入工作台选择目标项目和版本，再将内容作为草稿继续编辑。</p></div>
            </li>
          </ol>
        </Card>

        <Card className="account-card account-skill-contract-card" title={<span className="account-card-title"><ShieldCheck size={16} />导入前硬校验</span>}>
          <div className="account-skill-limits">
            <div><strong>500,000</strong><span>单篇正文最大字符数</span></div>
            <div><strong>100 / 500</strong><span>分类 / 文章总量上限</span></div>
            <div><strong>250 MB</strong><span>ZIP 文件最大体积</span></div>
          </div>
          <ul className="account-skill-checklist">
            <li>每篇文章必须至少关联一个真实源码文件。</li>
            <li>标题、摘要、ID、slug、排序和标签都按导入契约校验。</li>
            <li>不接受额外文件、摘要不匹配或不同步的 Markdown 镜像。</li>
            <li>文章包必须恰好包含一个分类和一篇文章。</li>
          </ul>
        </Card>
      </div>

      <Card className="account-card account-skill-package-card" title={<span className="account-card-title"><FolderTree size={16} />选择导入包类型</span>}>
        <div className="account-skill-package-grid">
          <CommandCard
            title="项目知识库包"
            description="新建一个草稿项目版本，导入完整分类与文章树。"
            command={projectCommand}
          />
          <CommandCard
            title="单篇文章包"
            description="追加一篇文章到已有的草稿版本。"
            command={articleCommand}
          />
        </div>
        <div className="account-skill-validation-command">
          <FileText size={16} />
          <span>构建后再次执行：</span>
          <code>node skills/project-knowledge-base/scripts/validate-package.mjs &lt;package.zip&gt; --source-root &lt;project-directory&gt;</code>
        </div>
      </Card>

      <Card className="account-card account-skill-handoff-card">
        <div>
          <Typography.Text className="account-eyebrow">Handoff</Typography.Text>
          <Typography.Title level={4}>{user.role === 'ADMIN' ? '验证完成后，直接导入项目草稿' : '验证完成后，将 ZIP 交给项目管理员'}</Typography.Title>
          <Typography.Text type="secondary">
            {user.role === 'ADMIN'
              ? '导入工作台会先预览内容，再让你选择目标项目及版本；不会直接发布。'
              : '内容会先以草稿形式导入，管理员可以在现有编辑器中复核、调整并决定何时发布。'}
          </Typography.Text>
        </div>
        <Space wrap>
          {user.role === 'ADMIN' ? (
            <Link href="/admin/mm/import"><Button type="primary" icon={<Import size={15} />}>打开导入工作台</Button></Link>
          ) : <Tag color="blue">需要管理员导入权限</Tag>}
        </Space>
      </Card>
    </div>
  )
}
