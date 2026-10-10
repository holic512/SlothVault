# MCP Registry (generated)

<!-- GENERATED FILE: run `npm run mcp:docs` after changing MCP declarations. -->

Tool count: **71**

| Tool | Domain | Risk | Idempotency | Resource permission |
| --- | --- | --- | --- | --- |
| `admin.dashboard.get` | `admin.dashboard` | read | idempotent | - |
| `admin.user.list` | `admin.user` | read | idempotent | - |
| `admin.user.get` | `admin.user` | read | idempotent | - |
| `admin.membership.level.list` | `admin.membership.level` | read | idempotent | - |
| `admin.user.membership.get` | `admin.user.membership` | read | idempotent | - |
| `admin.points.transaction.list` | `admin.points.transaction` | read | idempotent | - |
| `admin.gift_card.batch.list` | `admin.gift_card.batch` | read | idempotent | - |
| `admin.contract.list` | `admin.contract` | read | idempotent | - |
| `admin.contract.get` | `admin.contract` | read | idempotent | - |
| `admin.contract.attachment.get` | `admin.contract.attachment` | read | idempotent | contract-attachment:read |
| `admin.evidence.list` | `admin.evidence` | read | idempotent | - |
| `admin.evidence.get` | `admin.evidence` | read | idempotent | - |
| `admin.settings.get` | `admin.settings` | read | idempotent | - |
| `admin.system.update.get` | `admin.system.update` | read | idempotent | - |
| `content.article.list` | `content.article` | read | idempotent | - |
| `content.article.get` | `content.article` | read | idempotent | - |
| `content.article.create` | `content.article` | write | non-idempotent | - |
| `content.article.update` | `content.article` | write | non-idempotent | - |
| `content.article.publish` | `content.article` | write | non-idempotent | - |
| `content.article.withdraw` | `content.article` | write | non-idempotent | - |
| `content.category.list` | `content.category` | read | idempotent | - |
| `content.category.create` | `content.category` | write | non-idempotent | - |
| `content.category.update` | `content.category` | write | non-idempotent | - |
| `admin.commission.list` | `admin.commission` | read | idempotent | - |
| `admin.commission.get` | `admin.commission` | read | idempotent | - |
| `admin.commission.create` | `admin.commission` | write | idempotent | - |
| `admin.commission.update` | `admin.commission` | write | idempotent | - |
| `admin.commission.document.draft.create` | `admin.commission.document.draft` | write | idempotent | - |
| `admin.contract-template.list` | `admin.contract-template` | read | idempotent | - |
| `content.file.list` | `content.file` | read | idempotent | - |
| `content.file.get` | `content.file` | read | idempotent | managed-file:read |
| `content.file.upload` | `content.file` | write | non-idempotent | - |
| `content.note.content.list_versions` | `content.note.content` | read | idempotent | - |
| `content.note.content.get` | `content.note.content` | read | idempotent | - |
| `content.note.content.create_draft` | `content.note.content` | write | non-idempotent | - |
| `content.note.content.update_draft` | `content.note.content` | write | non-idempotent | - |
| `content.note.content.set_primary` | `content.note.content` | write | non-idempotent | - |
| `content.note.content.update_metadata` | `content.note.content` | write | non-idempotent | - |
| `content.note.tag.list` | `content.note.tag` | read | idempotent | - |
| `content.note.tag.add` | `content.note.tag` | write | idempotent | - |
| `content.note.tag.rename` | `content.note.tag` | write | non-idempotent | - |
| `content.note.tag.remove` | `content.note.tag` | write | idempotent | - |
| `content.note.list` | `content.note` | read | idempotent | - |
| `content.note.get` | `content.note` | read | idempotent | - |
| `content.note.create` | `content.note` | write | non-idempotent | - |
| `content.note.update` | `content.note` | write | non-idempotent | - |
| `content.project.home.list` | `content.project.home` | read | idempotent | - |
| `content.project.home.get` | `content.project.home` | read | idempotent | - |
| `content.project.home.create` | `content.project.home` | write | non-idempotent | - |
| `content.project.home.update` | `content.project.home` | write | non-idempotent | - |
| `content.project.menu.list` | `content.project.menu` | read | idempotent | - |
| `content.project.menu.get` | `content.project.menu` | read | idempotent | - |
| `content.project.menu.create` | `content.project.menu` | write | non-idempotent | - |
| `content.project.menu.update` | `content.project.menu` | write | non-idempotent | - |
| `content.homepage.get` | `content.homepage` | read | idempotent | - |
| `content.homepage.create` | `content.homepage` | write | non-idempotent | - |
| `content.homepage.update` | `content.homepage` | write | non-idempotent | - |
| `content.project.version.list` | `content.project.version` | read | idempotent | - |
| `content.project.version.get` | `content.project.version` | read | idempotent | - |
| `content.project.version.create_draft` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.clone` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.check_draft` | `content.project.version` | read | idempotent | - |
| `content.project.version.integrity` | `content.project.version` | read | idempotent | - |
| `content.project.version.manifest` | `content.project.version` | read | idempotent | - |
| `content.project.version.update` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.publish` | `content.project.version` | write | non-idempotent | - |
| `content.project.version.set_visibility` | `content.project.version` | write | non-idempotent | - |
| `content.project.list` | `content.project` | read | idempotent | - |
| `content.project.get` | `content.project` | read | idempotent | - |
| `content.project.create` | `content.project` | write | non-idempotent | - |
| `content.project.update` | `content.project` | write | non-idempotent | - |

Resource count: **2**

| Resource | URI | MIME | Filename limit | Maximum bytes |
| --- | --- | --- | ---: | ---: |
| `managed-file` | `slothvault://managed-file/{id}` | `application/octet-stream` | 255 | 10485760 |
| `contract-attachment` | `slothvault://contract-attachment/{contractId}` | `application/pdf` | 255 | 26214400 |

This document is generated from the declaration registry. CI must run `npm run mcp:docs:check` and fail when the checked-in output is stale.

## 笔记标签

`content.note.list`、`content.note.get` 和笔记写入工具均返回 `tags: string[]`。
`content.note.create`、`content.note.update` 接受可选的 `tags` 数组：创建时省略表示无标签，更新时省略保留原值，传入 `[]` 清空。
标签去除首尾空白、忽略空项，按大小写敏感文本去重并保留输入顺序；每篇最多 10 个，每个最多 30 个字符。
标签属于笔记元数据，同一笔记的正文版本共用标签。修改标签要求项目版本未发布，复制为草稿时保留标签。
标签不参与发布清单和正文存证哈希计算。
单标签操作优先使用 `content.note.tag.list/add/rename/remove`，全部返回 `{ noteId, tags }`。写操作在事务中保留其他标签，要求所属项目版本未发布。
`list` 接受 `{ noteId }`；`add`、`remove` 接受 `{ noteId, tag }`；`rename` 接受 `{ noteId, tag, newTag }`。标签名称去首尾空白、不能为空，大小写敏感。
重复添加和移除不存在的标签均返回当前列表；改名保持原顺序，原标签不存在返回 404，新名称被其他标签占用返回 409。
